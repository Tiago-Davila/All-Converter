/**
 * La clasificación de errores dejó de ser presentación y pasó a `src/lib/error-class.ts`:
 * la consume también la cola de lotes (006, contracts/reliability.md). Se conserva este
 * reexport para los consumidores de la capa `ui/` y sus tests.
 */
export { classifyError, makeRowError, CANCELLED_ERROR, ENGINE_LOAD_ERROR } from '../../lib/error-class'
export type { ErrorClass, RowError } from '../../lib/error-class'
