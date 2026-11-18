# Research: Lotes grandes y confiables

**Feature**: 006-lotes-grandes | **Fecha**: 2026-08-11

Todas las decisiones de abajo se tomaron contra evidencia medida, no contra memoria de API.
Los spikes viven fuera del repositorio (scratchpad de sesión); acá quedan los resultados.

---

## D1 — El empaquetado ZIP no puede usar `JSZip.generateAsync`

**Decisión**: escribir un **generador ZIP incremental propio, sólo con método STORE**, que lea
un resultado por vez y emita chunks. NO usar `JSZip.generateAsync` ni `generateInternalStream`
para producir el archivo.

**Racional (medido)**: la hipótesis inicial del plan era "JSZip acepta `Blob` y lo lee
perezosamente al generar, así que el pico de memoria es un archivo". **Es falsa.** Medición
con JSZip 3.10.1 (la versión del `package-lock.json`), instrumentando `FileReader`:

```
Lecturas disparadas tras agregar 40 archivos (antes de generar): 40
Lecturas durante generate: 0
VEREDICTO: EAGER — JSZip lee TODO al agregar.
```

`zip.file(nombre, blob)` dispara la lectura completa del blob en el acto y retiene el
`Uint8Array` resultante hasta el `generate`. El pico de memoria es **la suma de todas las
salidas**, que es exactamente lo que FR-006 y FR-007 prohíben. El flujo de *salida* de
`generateInternalStream` sí es incremental (281 chunks en la medición), pero eso no sirve de
nada si la *entrada* ya está toda en memoria.

Confirmado además en el código de la dependencia, `jszip/lib/utils.js:455-471`: si el dato es
un `Blob`, se lo lee con `FileReader` inmediatamente dentro de `prepareContent`, que
`fileAdd` invoca al agregar.

**Segundo hallazgo, igual de bloqueante**: `jszip/lib/utils.js:457` sólo lee el Blob
`if (isBlob && typeof FileReader !== "undefined")`; si no, lo deja pasar sin leer y el
`generate` falla con *"Can't read the data of ... Is it in a supported JavaScript type?"*.
En Node `FileReader` es `undefined` — verificado — y **`vitest.config.ts:8` corre con
`environment: 'node'`**. O sea: pasarle Blobs a JSZip habría roto la suite de tests, no sólo
la memoria. `src/lib/zip.ts:9-12` hace `import.meta.env.MODE === 'test'` → `executeZip`
directo, así que los tests pegan justo en ese camino.

**Viabilidad verificada**: se prototipó el escritor STORE incremental y se validó de forma
independiente releyendo el resultado con `JSZip.loadAsync`:

```
Emitidos 157 chunks, 1005649 bytes, 52 entradas
JSZip releyó 52 entradas
  bytes binarios: OK    texto UTF-8: OK    archivo grande: OK    entradas ==: OK
```

Incluye rutas con subcarpetas y nombres con acentos (`ñandú-café.txt`) usando el flag de
nombre UTF-8 (`0x800`). El formato STORE es un contenedor trivial: cabecera local + bytes +
directorio central + EOCD.

**Alternativas evaluadas**:

| Alternativa | Por qué se descartó |
|---|---|
| `JSZip.generateAsync` (hoy) | Lectura eager: pico = suma de todas las salidas. Medido. |
| `JSZip` con `generateInternalStream` | Mismo problema: el streaming es de salida, la entrada ya está en RAM. |
| Dependencia `fflate` (streaming zip real) | Es la opción estándar y sería válida, pero agrega dependencia y las Restricciones Técnicas piden justificarla antes. Se prefiere no agregarla si 150 líneas propias y verificadas resuelven el caso. **Queda como plan B** si el escritor propio da problemas. |
| No hacer ZIP; escribir a carpeta con `showDirectoryPicker` | Excelente UX y memoria O(1), pero sólo Chromium. Necesita el ZIP como fallback igual, así que no elimina trabajo. Anotada como mejora futura. |

**Consecuencias**:
- `STORE` en vez de `DEFLATE` no es una pérdida: las salidas ya vienen comprimidas
  (PNG/JPG/PDF/MP3/MP4). Deflate quemaría CPU para no ganar tamaño.
- CRC32: JSZip ya está instalado y expone `jszip/lib/crc32.js`. Se puede reutilizar (import
  de ruta interna, algo frágil) o incluir una tabla CRC32 propia de ~15 líneas. **Se decide
  tabla propia**: evita depender de una ruta interna no pública de la dependencia.
- **Límite ZIP64**: el formato base usa campos de 32 bits para offsets y tamaños. Por encima
  de 4 GB totales haría falta ZIP64. Con 200 archivos es alcanzable sólo con video. Decisión:
  **no implementar ZIP64**; detectar el desborde y avisar honestamente al usuario que descargue
  individualmente (Principio XV). El límite de entradas de ZIP64 (65535) no se alcanza nunca
  con un techo de 200.

---

## D2 — `Blob` en vez de `ArrayBuffer` para retener resultados

**Decisión**: `resultsRef` (`src/components/FileQueue.tsx:104`) pasa a guardar `Blob`, no
`ArrayBuffer`.

**Racional**: es una decisión **independiente de D1** y sigue siendo correcta. Los
`ArrayBuffer` viven en el heap de JS; los `Blob` grandes los respalda el navegador en disco.
Hoy se retienen las dos cosas a la vez: el `ArrayBuffer` en `resultsRef` **y** el `Blob` que
`registerResults` (`:138`) crea para la descarga. Quedarse sólo con el `Blob` elimina una
copia completa del heap sin perder ninguna funcionalidad, y es el `Blob` lo que el escritor
de D1 consume, uno por vez.

**Alternativas evaluadas**: retener `ArrayBuffer` y crear el `Blob` bajo demanda — peor: deja
la copia pesada justamente en el heap.

---

## D3 — Pausa cooperativa en el planificador

**Decisión**: agregar un `PauseGate` (`wait()` / `pause()` / `resume()`) que cada runner de
`runWithConcurrency` (`src/lib/job-scheduler.ts:21-34`) consulta **antes de tomar el siguiente
índice** del cursor.

**Racional**: el planificador ya es un pool con cursor compartido, así que la pausa entra en
un solo punto y no toca ningún conversor. Pausar entre trabajos (no dentro) cumple FR-018 —
lo ya iniciado termina — y no requiere que los conversores sepan nada de pausa, respetando el
Principio III.

**Alternativas evaluadas**: abortar los trabajos en vuelo y reencolarlos. Descartada: tira
minutos de CPU ya gastados, y en audio/video puede ser la mayor parte del lote.

---

## D4 — Watchdog por archivo, encadenado al del lote

**Decisión**: un `AbortController` por archivo, encadenado al `AbortController` del lote, con
un temporizador que se **reinicia con cada evento de progreso**. Al vencer, aborta sólo ese
archivo con causa transitoria.

**Racional**: hoy hay un único controller para todo el lote (`FileQueue.tsx:144`), así que no
existe forma de matar un archivo colgado sin matar el lote entero. Encadenar da granularidad
sin cambiar la firma `Converter.convert(file, onProgress, options, signal)` (Principio III
intacto). Reiniciar con el progreso —en vez de un plazo fijo total— evita abortar
conversiones legítimamente largas: lo que se castiga es la **ausencia de avance**, no la
duración.

**Umbrales**: 300 s sin progreso por defecto; 900 s para conversores de audio/video. Se
derivan de que `mp4-to-mp3` admite archivos de 250 MB (`src/converters/mp4-to-mp3.ts:3`) y
ffmpeg en WASM es legítimamente lento.

---

## D5 — Concurrencia por partición, no por mínimo global

**Decisión**: partir los trabajos en dos pools — audio/video con concurrencia 1, el resto con
concurrencia 2 — en lugar del mínimo global actual.

**Racional**: `FileQueue.tsx:193` hace `reduce` con `Math.min` sobre **todo** el lote, así que
un solo MP3 entre 199 imágenes baja el lote entero a concurrencia 1 y duplica el tiempo total.
La serialización de ffmpeg ya está garantizada aparte por `runMediaExclusive`
(`src/lib/media-pool.ts`), así que el mínimo global no protege nada que no esté ya protegido:
es sólo una pérdida de rendimiento.

**Alternativas evaluadas**: subir la concurrencia general por encima de 2. Descartada por
ahora: cada trabajo crea un `Worker` nuevo que reimporta su librería pesada, así que más
paralelismo también multiplica el pico de memoria. Se deja para la feature de pool de workers.

---

## D6 — Destino de la descarga

**Decisión**: escribir los chunks con `showSaveFilePicker()` cuando exista; si no, acumular
chunks y cerrar en un único `new Blob(chunks)`.

**Racional**: con el picker el ZIP nunca existe entero en memoria — se escribe a disco a
medida. El fallback sigue siendo mejor que hoy: `new Blob(chunks)` queda respaldado en disco
y evita el `ArrayBuffer` intermedio de `src/lib/zip.ts:17` más la copia de
`FileQueue.tsx:217`. Ninguno de los dos caminos exige que la app sostenga el archivo en heap.

**Nota de compatibilidad**: `showSaveFilePicker` no está en Firefox ni Safari, por eso el
fallback no es opcional. COOP/COEP (que `vercel.json` fija para ffmpeg) no lo afectan.

---

## D7 — Orden del ingreso y techo de exploración

**Decisión**: en `intakeFiles`, evaluar el cupo **antes** de llamar a `detectFileType`, y
detectar los que sí entran con concurrencia usando el `runWithConcurrency` que ya existe.
`readDroppedItems` corta al llegar a `MAX_SCAN_FILES = 5000` e informa cuántos ignoró.

**Racional**: hoy el orden es al revés (`src/lib/directory-input.ts:41` antes de `:45`), de
modo que soltar una carpeta grande paga una lectura de magic bytes por archivo para después
descartarlo. Invertir el orden es gratis y cumple FR-002. El techo de 5000 cumple FR-003 y
protege del árbol patológico.

**Cuidado detectado**: el chequeo de archivo vacío y el de tipo desconocido corren **antes**
del de cupo, así que esos rechazos hoy no consumen cuota. Al reordenar hay que preservar esa
semántica: un archivo vacío se sigue rechazando por vacío, no por cupo. Los tests existentes
(`tests/lib/directory-input.test.ts`) la fijan.

**Detalle de concurrencia**: `crypto.randomUUID()` y el orden de las entradas deben seguir
siendo deterministas respecto del orden de entrada, aunque la detección corra en paralelo.

---

## D8 — Reintento: reutilizar lo que ya existe

**Decisión**: importar `classifyError` / `makeRowError` de `src/ui/components/error-class.ts`
en la cola viva. No escribir clasificación nueva.

**Racional**: el módulo ya está implementado, probado
(`tests/ui/components/error-class.test.ts`) y especificado en
`specs/002-capa-experiencia/spec.md` (FR-019b/c). Sólo le falta un consumidor vivo.
Duplicarlo violaría el Principio I y dejaría dos clasificaciones divergentes.

**Ajuste necesario**: el módulo vive bajo `src/ui/components/`, que es la capa de
presentación. Al pasar a ser lógica compartida conviene moverlo a `src/lib/error-class.ts` y
que los componentes existentes lo reexporten o importen desde ahí, para no romper sus tests.

---

## Riesgos abiertos

| Riesgo | Mitigación |
|---|---|
| El escritor ZIP propio es código de formato binario, sensible a errores de offset | Test de round-trip contra `JSZip.loadAsync` (ya probado en el spike), con acentos, subcarpetas y ≥200 entradas |
| Desborde de 4 GB sin ZIP64 | Detectar y avisar; descarga individual sigue disponible |
| `environment: 'node'` en vitest no tiene `FileReader` ni File System Access | El diseño no depende de ninguno de los dos: usa `blob.arrayBuffer()`, disponible en Node y navegador |
| La UI a 200 filas puede seguir pesada aun con memoización | Medir con el lote de 200 antes de decidir si hace falta virtualizar la lista |
