/**
 * intensity.ts: mapeo puro evento → intensidad objetivo del fondo animado.
 * Sin WebGL, sin side effects. Testeable de forma aislada (T026, FR-004, US3).
 *
 * | Actividad    | Intensidad objetivo               |
 * |--------------|-----------------------------------|
 * | idle         | 0.25                              |
 * | hover        | 0.78                              |
 * | drag-over    | 1.00                              |
 * | converting   | 0.40 + 0.45 × progress (0–1)      |
 */

export type BackgroundActivity = 'idle' | 'hover' | 'drag-over' | 'converting'

/**
 * Devuelve la intensidad objetivo [0, 1] para una actividad dada.
 * Para 'converting', `progress` es 0–1 (0 = inicio, 1 = fin).
 * Si se omite progress en converting, se asume 0.
 */
export function targetFor(activity: BackgroundActivity, progress?: number): number {
  switch (activity) {
    case 'idle':
      return 0.25
    case 'hover':
      return 0.78
    case 'drag-over':
      return 1.0
    case 'converting': {
      const p = Math.max(0, Math.min(1, progress ?? 0))
      return 0.40 + 0.45 * p
    }
  }
}
