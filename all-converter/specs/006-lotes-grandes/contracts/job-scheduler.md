# Contrato: planificador con pausa y particionado

**Feature**: 006-lotes-grandes | Implementa FR-017, FR-018, FR-019, FR-020

Extiende `src/lib/job-scheduler.ts`. Las garantías actuales se conservan **todas**: orden de
resultados por índice, tope de concurrencia, `RangeError` con límite inválido, y ningún
trabajo nuevo arranca después de un abort. Los tests existentes
(`tests/lib/job-scheduler.test.ts`, 6 casos) deben seguir pasando sin cambios.

---

## PauseGate

```ts
export interface PauseGate {
  readonly paused: boolean
  wait(): Promise<void>   // resuelve inmediato si no está pausado
  pause(): void
  resume(): void
}
```

`runWithConcurrency` acepta una `PauseGate` opcional. Cada runner la consulta **antes de tomar
el siguiente índice del cursor**.

### Reglas

1. **Pausar no interrumpe trabajo en vuelo.** Los trabajos ya iniciados corren hasta terminar.
   Sólo se frena el despacho de nuevos. (FR-018)
2. **Reanudar continúa en orden.** El cursor no se reinicia ni se saltea nada. (FR-019)
3. **Pausa y abort son ortogonales.** Cancelar estando pausado DEBE funcionar: los pendientes
   quedan rechazados con `AbortError` sin esperar un `resume`. (FR-020)
4. **Sin gate, comportamiento idéntico al actual.** El parámetro es opcional.
5. `pause()` y `resume()` son idempotentes.

### Casos límite

- `resume()` sin `pause()` previo: no hace nada.
- `pause()` después de que todos los trabajos terminaron: no cuelga a nadie.
- Abort mientras hay runners esperando en `wait()`: se despiertan y terminan.

---

## Particionado por tipo

**Problema actual**: `src/components/FileQueue.tsx:193` calcula la concurrencia con
`reduce` + `Math.min` sobre **todo** el lote. Un solo MP3 entre 199 imágenes baja el lote
entero a concurrencia 1.

**Contrato**: los trabajos se parten en dos grupos que corren con su propio tope.

| Grupo | Concurrencia | Criterio |
|---|---|---|
| Audio / video | 1 | `converter.from` incluye `kind: 'audio'` o `'video'` |
| Todo lo demás | 2 | resto |

`concurrencyForConverter` ya expresa el criterio por conversor
(`src/lib/job-scheduler.ts:3-5`) y se reutiliza; lo que cambia es que deja de colapsarse a un
mínimo global.

**Seguridad**: la serialización real de ffmpeg ya la garantiza `runMediaExclusive`
(`src/lib/media-pool.ts`), de forma independiente. El mínimo global no protegía nada que no
estuviera ya protegido — sólo costaba tiempo. Los dos grupos pueden avanzar en paralelo sin
riesgo.

**Progreso y orden**: el progreso global del lote se sigue calculando sobre todos los
archivos, sin importar en qué grupo cayeron. El orden de las filas en la UI no cambia.
