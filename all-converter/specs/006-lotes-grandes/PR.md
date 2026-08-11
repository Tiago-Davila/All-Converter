# feat: lotes grandes y confiables — tope de 200 archivos (006)

> **Estado: work in progress.** La suite de tests está en rojo a propósito: los tests que
> cubren la API vieja todavía no se adaptaron. Ver "Tests" abajo. **No mergear así.**

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
con `environment: 'node'`, donde `FileReader` no existe — habría roto la suite además de la
memoria.

En su lugar, un generador propio (~150 líneas) que lee **un blob por vez** y emite trozos.
Validado por round-trip contra `JSZip.loadAsync`: 52 entradas, fidelidad de bytes, nombres con
acentos y subcarpetas correctos. **Sin dependencias nuevas.** Sin ZIP64: por encima de 4 GB se
avisa en vez de emitir un archivo corrupto.

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

## Defecto preexistente que se arregla de paso

`convertAll` tenía `setRunning(false)` en el camino feliz. Cancelar el lote habiendo resultados
previos hacía que `createZip` rechazara con `AbortError`, la promesa se perdía en un
`void convertAll()`, y **la UI quedaba trabada con "Cancelar lote" para siempre**. No tenía
cobertura de test. Ahora va en un `finally`.

## Tests

| | |
|---|---|
| Pasando | 530 |
| Fallando por este PR | **8** (en 3 archivos) |
| Fallando de antes | 5 (`tests/ui/prefs/ui-prefs.test.ts`, no hay `localStorage` en `environment: 'node'`; verificado contra la rama base) |

Los 8 son deriva de API esperada, no defectos:

- `tests/lib/zip.test.ts` — usa `createZip([{ name, buffer }])` con `ArrayBuffer`; ahora
  `ZipEntry` lleva `blob: Blob` y devuelve `Blob`.
- `tests/lib/directory-input.test.ts` — tiene el literal `'Límite de 10'`.
- `tests/components/batch-flow.test.tsx` — el control del ZIP pasó de `<a href>` a `<button>`.

**Falta adaptarlos** (tareas T009–T013 de `tasks.md`), más los tests nuevos del escritor ZIP.

## Qué falta para cerrar la feature

Este PR cubre la fase Foundational y la mayor parte de US1. Queda:

- **T025** — particionar la concurrencia (hoy un solo MP3 baja el lote entero a 1).
- **US2** — watchdog por archivo, reintento sólo en transitorios, resumen del lote.
- **US3** — pausar y reanudar.
- **Polish** — memoizar filas, throttlear el progreso, e2e, README.

Detalle completo en `specs/006-lotes-grandes/ESTADO.md`.

## Verificación pendiente

- [ ] Adaptar los 3 archivos de test y sumar los nuevos
- [ ] `npm run ci` en verde
- [ ] Prueba manual: carpeta de 60+ imágenes de punta a punta
- [ ] Medición de memoria con 200 archivos (el heap debe quedar plano)
