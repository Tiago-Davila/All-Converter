# feat: lotes grandes y confiables — tope de 200 archivos (006)

## Qué resuelve

La cola rechazaba todo lo que pasara del décimo archivo (`MAX_BATCH_FILES = 10`). Arrastrar una
carpeta de 60 dejaba 10 adentro y 50 filas rojas. Este PR sube el tope a **200** y, en el mismo
movimiento, arregla lo que hacía que ese número no se pudiera subir a secas.

Ese tope de 10 era lo único que sostenía el diseño en pie: el pipeline mantenía **tres copias
completas de las salidas vivas al mismo tiempo** (los `ArrayBuffer` en `resultsRef`, un
`Blob`+ObjectURL por resultado, y el ZIP entero en RAM), y rearmaba el ZIP desde cero en cada
corrida.

## Cambios principales

### 1. Los resultados se retienen como `Blob`, no como `ArrayBuffer`

Los `ArrayBuffer` viven en el heap de JS; los `Blob` grandes los respalda el navegador en disco.
El `Blob` que ya se creaba para la descarga individual pasa a ser la **única** copia y alimenta
también el empaquetado.

### 2. Escritor ZIP STORE incremental, propio

**JSZip quedó descartado y esto se midió, no se supuso.** Instrumentando `FileReader` con JSZip
3.10.1:

```
Lecturas tras agregar 40 archivos (antes de generar): 40
Lecturas durante generate: 0
VEREDICTO: EAGER — JSZip lee TODO al agregar.
```

`zip.file(nombre, blob)` lee el blob entero en el acto y retiene los bytes hasta el `generate`:
el pico sería la suma de todas las salidas, justo lo que este PR evita. Y hay un segundo
bloqueo: JSZip sólo lee un `Blob` `if (typeof FileReader !== "undefined")`, y los tests corren
con `environment: 'node'`, donde `FileReader` no existe.

En su lugar, un generador propio (~150 líneas) que lee **un blob por vez** y emite trozos.
Validado por round-trip contra `JSZip.loadAsync` con 200 entradas, nombres con acentos,
subcarpetas y colisiones. **Sin dependencias nuevas.** Sin ZIP64: por encima de 4 GB se avisa
en vez de emitir un archivo corrupto.

### 3. El ZIP se arma al hacer clic, no al terminar el lote

No estaba en el plan; salió al implementar. `showSaveFilePicker()` **exige activación
transitoria del usuario**, así que no puede llamarse automáticamente al final del lote. De paso
no se empaqueta lo que nadie va a descargar.

### 4. El ingreso no lee bytes de archivos que no van a entrar

`intakeFiles` evaluaba el cupo *después* de `detectFileType`, que lee el blob. Soltar una
carpeta de 5000 archivos costaba 5000 lecturas de magic bytes para descartar 4990. Ahora el cupo
va primero, y la detección corre por olas del tamaño del cupo libre — lo que preserva la
semántica original de que un tipo no soportado no consume cuota.

Además `readDroppedItems` corta en `MAX_SCAN_FILES = 5000`, y los aportes se encadenan para que
dos arrastres seguidos no se pasen del tope.

### 5. Concurrencia particionada

La concurrencia del lote era el mínimo de todos los conversores elegidos: **un solo MP3 entre
199 imágenes bajaba el lote entero a 1**. Ahora son dos grupos con su propio tope —audio/video
de a 1, el resto de a 2— avanzando en paralelo. La serialización real de ffmpeg ya la garantiza
`runMediaExclusive`, aparte; el mínimo global no protegía nada, sólo costaba tiempo.

### 6. Un archivo roto no arruina el lote (US2)

- **Watchdog por archivo**: cada uno tiene su `AbortController` encadenado al del lote. Si deja
  de reportar avance por 300 s (900 s en audio/video) se aborta **sólo ese archivo**. Mide falta
  de avance, no duración: una conversión larga que reporta progreso no se aborta nunca.
- **Errores clasificados**: se consume `classifyError`, que existía desde 002 sin consumidor
  vivo. "Reintentar" aparece en el 100% de los fallos transitorios y en el 0% de los
  determinísticos — ofrecerlo en un corrupto sería prometer un resultado que no va a llegar.
- **Reintentar reprocesa sólo ese archivo**, por el mismo camino que el lote.
- **Resumen del lote**: listos / con error / cancelados, con un solo sonido y un solo anuncio.

### 7. Pausar y reanudar (US3)

`PauseGate` en el scheduler, consultada antes de tomar cada índice del cursor. Pausar no
interrumpe lo que ya está en vuelo: frena el despacho. Reanudar sigue en orden. **Cancelar
estando pausado funciona sin reanudar** — si no, la promesa del lote quedaría esperando un
`resume` que quizá nunca llegue. El estado `Pausado` se distingue por ícono y texto, no por
color.

### 8. Fluidez con 200 filas

La fila salió a `src/components/QueueRow.tsx` memoizada, con los callbacks en un objeto de
identidad estable, y el progreso se acumula en un ref y se vuelca de a un cuadro con
`requestAnimationFrame`. Antes, cada evento de progreso volvía a dibujar las 200 filas y
recalculaba los destinos de cada una contra el registry.

## Defectos preexistentes que se arreglan de paso

1. `convertAll` tenía `setRunning(false)` en el camino feliz: cancelar el lote habiendo
   resultados previos dejaba **la UI trabada con "Cancelar lote" para siempre**. Ahora va en un
   `finally` y hay test.
2. Los archivos cancelados **antes de que les tocara turno** quedaban en "Pendiente" para
   siempre: el scheduler los rechaza sin ejecutar el trabajo, así que nadie tocaba su fila.

## El defecto que encontró el e2e

El escritor ZIP producía archivos **corruptos en el navegador** y correctos en los tests.

`streamZip` calculaba `offset += header.length + bytes.length` después de emitir los trozos. El
worker transfiere el buffer de cada trozo (`postMessage(..., [chunk.buffer])`), lo que deja la
vista en `length` 0: el directorio central salía con tamaños y offsets en cero. El ZIP abría
"bien" —60 cabeceras locales, 60 centrales, EOCD en su lugar— pero ningún lector podía extraer
nada.

Ningún test unitario lo veía porque el camino de tests no transfiere. Ahora sí: se reproduce con
`structuredClone(chunk.buffer, { transfer: [chunk.buffer] })`. Los trozos son de un solo uso.

## Verificación

| | |
|---|---|
| `npm run ci` | **verde** (lint → coverage → build → budget → workers → offline → e2e) |
| Tests unitarios | 576 pasando, 84,9% de líneas |
| E2E | 19 pasando, incluido el lote de 60 archivos con pausa, reanudación y ZIP completo |
| Bundle inicial | 82,7 KB gzip de 204,8 KB permitidos (quitar JSZip del camino de escritura no lo movió) |

Memoria con 200 archivos, medida por CDP (`Runtime.getHeapUsage`):

| Momento | Heap |
|---|---|
| Inicio | 1,6 MB |
| 200 archivos en la cola | 7,4 MB |
| 200 convertidos | 16,1 MB |
| ZIP de 200 entradas empaquetado | 20,2 MB |

El heap no crece con el total de bytes producidos. La medición usa imágenes chicas: prueba el
comportamiento estructural, no el caso de archivos grandes.

## Qué queda fuera

La pasada **manual** de accesibilidad de T045: escala de grises para confirmar que "Pausado" se
distingue sin color y recorrido por teclado de Pausar / Reanudar / Cancelar. Todo lo demás de
`tasks.md` (45 de 46 tareas) está hecho y verificado.
