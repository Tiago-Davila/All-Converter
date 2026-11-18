# Contrato: empaquetado ZIP incremental

**Feature**: 006-lotes-grandes | Implementa FR-006, FR-007, FR-008, FR-009, FR-010

Reemplaza el empaquetado de `src/workers/zip-operations.ts`. Ver `research.md` D1 para la
evidencia de por qué `JSZip.generateAsync` no sirve.

---

## Formato

ZIP con método **STORE** (sin compresión), sin ZIP64.

- Las salidas ya vienen comprimidas (PNG/JPG/PDF/MP3/MP4); deflate gastaría CPU sin ganar tamaño.
- Nombres en UTF-8 con el flag `0x800` en el bit de propósito general. Verificado con
  `ñandú-café.txt`.
- Estructura: por entrada, cabecera local (`0x04034b50`) + bytes; al final, directorio central
  (`0x02014b50`) por entrada + EOCD (`0x06054b50`).

**Límite duro**: los campos de offset y tamaño son de 32 bits. Si la suma de tamaños supera
**4 GB**, el empaquetado DEBE rechazarse antes de empezar, con mensaje honesto, y las descargas
individuales DEBEN seguir disponibles (Principio XV). No se implementa ZIP64.

---

## Contrato de memoria (la razón de existir de este contrato)

> El empaquetado DEBE leer **un resultado por vez**. En ningún momento puede haber más de un
> contenido de archivo materializado en memoria de trabajo.

Concretamente: `blob.arrayBuffer()` se llama para la entrada N, se emiten sus bytes, y la
referencia se suelta antes de pasar a N+1. Prohibido acumular los bytes de todas las entradas
antes de emitir — es exactamente el defecto que se está corrigiendo.

`blob.arrayBuffer()` se elige sobre `FileReader` a propósito: existe en el navegador, en los
Web Workers y en Node. `FileReader` **no** existe en Node, y `vitest.config.ts` corre con
`environment: 'node'` (ver research.md D1).

---

## Canal de chunks worker → hilo principal

Se agrega una respuesta nueva en `src/workers/types.ts`, sin tocar las existentes:

```ts
| { kind: 'chunk'; jobId: string; chunk: Uint8Array }
```

`startWorker` (`src/workers/client.ts`) recibe un callback opcional `onChunk`. Reglas:

- `onChunk` es **opcional**: todos los conversores actuales siguen funcionando sin pasarlo.
- Una respuesta `chunk` NO resuelve el trabajo. Sigue valiendo el latch `settled`: sólo
  `result`, `error`, un abort o un fallo del worker lo cierran.
- Los chunks DEBEN entregarse en orden de emisión.
- Cada `chunk` se postea con su buffer como transferable (Principio IV: transferibles, no copias).

---

## Destino de escritura

| Camino | Cuándo | Comportamiento |
|---|---|---|
| `showSaveFilePicker()` | Si el navegador lo expone | Cada chunk se escribe al `FileSystemWritableFileStream`; el archivo nunca existe entero en memoria |
| Acumular chunks | Fallback (Firefox, Safari) | Los chunks se juntan en un único `new Blob(chunks)` al cerrar; queda respaldado en disco, sin el `ArrayBuffer` intermedio de hoy |

El fallback NO es opcional: `showSaveFilePicker` no está en Firefox ni Safari.

---

## Errores y cancelación

- Un fallo del empaquetado **nunca** puede dejar la UI inoperable (FR-009). El llamador
  envuelve la llamada en `try/catch` y devuelve el estado de "corriendo" a falso en un
  `finally`. Este es el defecto real que hoy existe en `src/components/FileQueue.tsx:211-219`.
- Si el lote fue cancelado, NO se genera ZIP.
- Si se aborta a mitad de la escritura con el picker, el archivo parcial se descarta.

---

## Reconstrucción

El ZIP NO se rearma si no se agregaron resultados nuevos desde el último empaquetado (FR-010).
Hoy `FileQueue.tsx:212-218` lo rehace desde cero en cada corrida sobre todo lo acumulado.

---

## Invariantes verificables

1. Releer la salida con `JSZip.loadAsync` devuelve exactamente las entradas escritas, con sus
   bytes intactos. *(Verificación independiente: se valida contra otra implementación.)*
2. Las rutas relativas de origen se preservan, y las colisiones se resuelven con el
   `resolveZipPaths` existente (`informe.pdf`, `informe-2.pdf`, …).
3. Los nombres con acentos y las subcarpetas sobreviven al round-trip.
4. Con 200 entradas, el pico de memoria es del orden del archivo más grande, no de la suma.
