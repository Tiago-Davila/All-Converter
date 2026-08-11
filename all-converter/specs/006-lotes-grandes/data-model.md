# Data Model: Lotes grandes y confiables

**Feature**: 006-lotes-grandes | **Fecha**: 2026-08-11

Este documento describe **sólo los cambios** al modelo existente. Lo no mencionado
(`DetectedFileType`, `Converter`, `ConversionResult`, `ConverterSource`) queda intacto.

---

## Cola

Conjunto acumulado de archivos aportados por el usuario.

| Regla | Valor | Origen |
|---|---|---|
| Techo de aceptados | **200** | FR-001 |
| Alcance del techo | Total de la cola, no por carpeta ni por gesto | FR-001 |
| Techo de exploración de carpetas | **5000** archivos recorridos | FR-003 |

`MAX_BATCH_FILES` pasa de `10` a `200` en `src/lib/directory-input.ts`. Se agrega
`MAX_SCAN_FILES = 5000`.

**Invariante**: el techo se respeta aunque dos aportes lleguen casi simultáneamente (FR-005).
Hoy `App.addFiles` es `async` y dos gestos rápidos leen el mismo snapshot de `entriesRef`,
pudiendo pasarse. Se resuelve serializando los aportes.

---

## FileEntry *(existente, sin cambios de forma)*

`src/converters/types.ts`. Los campos siguen igual. Sólo cambia el volumen: hasta 200
instancias en lugar de 10.

---

## RechazoAgregado *(nuevo)*

Los archivos que no entran **por cupo** dejan de producir una `FileEntry` rechazada cada uno y
se agregan en un único registro (FR-004).

| Campo | Tipo | Descripción |
|---|---|---|
| `cantidad` | `number` | Cuántos archivos no entraron |
| `motivo` | `'cupo' \| 'exploracion'` | Cupo de la cola, o techo de exploración de carpetas |
| `limite` | `number` | El techo que se alcanzó (200 o 5000) |

**Se mantiene sin agregar**: los rechazos por archivo vacío o tipo no soportado siguen siendo
una `FileEntry` rechazada por archivo. Son información accionable y específica; el rechazo por
cupo es repetición.

**Invariante preservado**: vacío y tipo-no-soportado se evalúan **antes** que el cupo, así que
esos rechazos no consumen cuota. Está fijado por los tests existentes.

---

## BatchItem *(modificado)*

`src/components/FileQueue.tsx:18`.

```
state: 'queued' | 'converting' | 'paused' | 'completed' | 'error' | 'cancelled'
```

- **Agregado**: `'paused'`.
- **Agregado**: `errorClass?: 'transient' | 'deterministic'` — decide si se ofrece reintentar
  (FR-013). Se deriva con `classifyError`, nunca se escribe a mano.

### Transiciones

```
queued ──► converting ──► completed
   │            │
   │            ├──► error       (errorClass decide si hay reintento)
   │            └──► cancelled   (abort del lote)
   │
   ├──► paused ──► converting    (reanudar)
   └──► cancelled                (cancelar estando pausado)

error(transient) ──► queued      (reintento manual, sólo ese archivo)
error(deterministic) ──► ∅       (terminal; no se ofrece reintento)
completed ──► ∅                  (terminal, salvo que cambie el formato destino)
```

**Regla de terminalidad (FR-015 / SC-006)**: ningún archivo queda fuera de `{completed, error,
cancelled}` al terminar el lote. El watchdog garantiza que `converting` no sea eterno.

---

## Resultado retenido *(modificado)*

`resultsRef` en `src/components/FileQueue.tsx:104`.

| Antes | Después |
|---|---|
| `{ name, buffer: ArrayBuffer, relativePath? }` | `{ name, blob: Blob, relativePath? }` |

El `ArrayBuffer` que llega del worker se envuelve en `Blob` y se suelta en el acto. El `Blob`
pasa a ser la **única** copia retenida: alimenta tanto la descarga individual (vía ObjectURL)
como el empaquetado ZIP (D1/D2).

---

## PauseGate *(nuevo)*

Compuerta cooperativa del planificador. Ver `contracts/job-scheduler.md`.

| Estado | Efecto sobre el pool |
|---|---|
| `running` | Los runners toman el siguiente índice sin esperar |
| `paused` | Los runners esperan antes de tomar índice; los trabajos ya iniciados terminan |

**Invariante**: pausar nunca aborta trabajo en vuelo (FR-018). `paused` es ortogonal a
`aborted`: cancelar estando pausado tiene que funcionar (FR-020).

---

## Watchdog *(nuevo)*

Por archivo. Ver `contracts/watchdog.md`.

| Campo | Valor |
|---|---|
| Plazo por defecto | 300 s sin progreso |
| Plazo audio/video | 900 s sin progreso |
| Reinicio | Con cada evento de progreso |
| Al vencer | Aborta **sólo** ese archivo; error de clase `transient` |

Mide **ausencia de avance**, no duración total: una conversión legítimamente larga que reporta
progreso nunca se aborta.

---

## Entrada del ZIP *(modificado)*

`ZipEntry` en `src/lib/zip.ts:5`.

| Antes | Después |
|---|---|
| `{ name, buffer: ArrayBuffer, relativePath? }` | `{ name, blob: Blob, relativePath? }` |

`resolveZipPaths` (`src/lib/zip-paths.ts`) **no cambia**: sigue resolviendo rutas y colisiones
a partir de `{ name, relativePath }`.

**Restricción de formato**: sin ZIP64. Si la suma de tamaños supera 4 GB, el empaquetado se
rechaza con aviso honesto y las descargas individuales siguen disponibles (Principio XV).
