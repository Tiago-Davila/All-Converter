# Contrato: aislamiento de fallos, watchdog y reintento

**Feature**: 006-lotes-grandes | Implementa FR-011 … FR-016, FR-021

---

## Aislamiento de fallos

Ya se cumple parcialmente: cada trabajo tiene su `try/catch` y los errores no escapan
(`src/components/FileQueue.tsx:199-208`). El test
`tests/components/batch-flow.test.tsx` *"conserva los éxitos ante fallos parciales"* lo fija.

**Lo que falta**: el empaquetado posterior no está protegido y puede tumbar todo el flujo. Ver
`contracts/zip-stream.md` §Errores. Regla: **`setRunning(false)` va en un `finally`**, nunca
en el camino feliz.

---

## Watchdog por archivo

```
AbortController del lote
        └── AbortController del archivo N  ──► converter.convert(file, onProgress, opts, signal)
```

| Parámetro | Valor |
|---|---|
| Plazo por defecto | 300 s **sin progreso** |
| Plazo audio/video | 900 s **sin progreso** |
| Reinicio del plazo | Con cada evento de progreso recibido |
| Al vencer | Aborta sólo ese archivo; error de clase `transient` |

### Reglas

1. Mide **ausencia de avance**, no duración total. Una conversión larga que reporta progreso
   nunca se aborta. Los umbrales salen de que `mp4-to-mp3` admite 250 MB y ffmpeg-WASM es
   legítimamente lento.
2. Abortar el lote aborta todos los controllers hijo (encadenamiento).
3. Abortar un archivo NO afecta a los demás. Este es el punto: hoy hay un solo controller para
   todo el lote (`FileQueue.tsx:144`) y no existe forma de matar un archivo colgado sin matar
   el lote.
4. La firma de `Converter.convert` **no cambia**: sigue recibiendo un `AbortSignal` y no sabe
   nada del watchdog (Principio III).
5. Un vencimiento se distingue de una cancelación del usuario: el primero es `error`
   transitorio, el segundo es `cancelled`.

---

## Clasificación de errores y reintento

**No se escribe clasificación nueva.** Se reutiliza `classifyError` / `makeRowError` /
`CANCELLED_ERROR` / `ENGINE_LOAD_ERROR`, hoy en `src/ui/components/error-class.ts`, ya probados
en `tests/ui/components/error-class.test.ts` y ya especificados en
`specs/002-capa-experiencia/spec.md` (FR-019b/c). Les falta un consumidor vivo.

**Movimiento**: pasa a `src/lib/error-class.ts` (deja de ser presentación y pasa a ser lógica
compartida). Los consumidores actuales de la capa `ui/` importan desde la ubicación nueva para
que sus tests sigan verdes.

### Reglas de reintento

| Clase | Ejemplos | ¿Se ofrece reintentar? |
|---|---|---|
| `transient` | Memoria insuficiente, fallo de carga del motor, cancelación, **vencimiento del watchdog** | **Sí** |
| `deterministic` | Corrupto, protegido con contraseña, no soportado, excede `maxSizeMB`, PDF escaneado | **No** |

1. Reintentar reprocesa **sólo** ese archivo (FR-014): no toca la cola ni los resultados de
   los demás.
2. Ofrecer reintento en un error determinístico está **prohibido** por el Principio XV: es
   prometer un resultado que no va a llegar.
3. Ante un mensaje no clasificable, se asume `transient` — el default seguro ya implementado.
4. El reintento vuelve a leer el `File` original. Necesario: los `ArrayBuffer` de entrada se
   transfieren al worker y quedan *detached* en el hilo principal
   (`src/workers/worker-utils.ts`).

---

## Resumen de lote (FR-016)

Al terminar, se informa cuántos quedaron **listos**, cuántos con **error** y cuántos
**cancelados**.

- El anuncio accesible consolidado ya existe (`LiveRegion`, `FileQueue.tsx:226`) y hoy lleva
  `{ done, failed }`; se le agrega `cancelled`.
- Se mantiene la regla vigente: **un solo sonido por lote**, nunca por archivo (FR-029 de 002).
  Cancelar todo sin nada terminado no suena.

---

## Estado "pausado" en la UI (FR-021, Principio XII)

- Diferenciador **no cromático** obligatorio: ícono propio + texto "Pausado". Un usuario en
  escala de grises debe distinguirlo de pendiente, convirtiendo, listo, error y cancelado.
- Los controles Pausar / Reanudar / Cancelar son operables por teclado, con foco visible que
  cumpla contraste 3:1.
- El botón alterna su rótulo y su `aria-label` entre "Pausar lote" y "Reanudar lote"; el estado
  se refleja en el `aria-label`, no sólo en el ícono.
