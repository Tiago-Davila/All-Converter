# Contrato: Fondo animado (ShaderBackground)

## Invariantes (verificables con test)

1. **Nunca bloquea**: el canvas es decorativo. `pointer-events: none`, y ningún control depende
   de él. Si el shader no arranca, la app es 100% usable (FR-006).
2. **Degradación sin error**: sin WebGL, o al perderse el contexto en caliente, se cae a un
   gradiente CSS equivalente. **Cero errores visibles al usuario** (FR-004).
3. **Umbral medible**: promedio de FPS < 30 durante 2 s seguidos → congela a estático. Se
   descartan los primeros ~500 ms (arranque no representativo) (FR-004, research D7).
4. **No reintenta**: una vez degradado por rendimiento, no vuelve al modo animado en esa sesión
   (FR-004b). Evita el parpadeo de entrar y salir.
5. **Pausa con pestaña oculta**: `document.hidden` → se cancela el rAF; al volver, se reanuda
   (FR-005). Pausar **no** es degradar: es reversible.
6. **Reduce-motion**: queda estático desde el inicio, sin animar nunca (FR-005).
7. **El texto siempre legible**: el contenido va sobre el scrim (α ≥ 0.85), así que el contraste
   **no depende del fotograma** (FR-007, research D1). El fondo puede hacer lo que quiera.

## Superficie

```ts
export function targetFor(activity: BackgroundActivity, progress?: number): number
```

Función **pura**, sin WebGL: es el corazón testeable del fondo.

| Actividad | Intensidad objetivo |
|---|---|
| `idle` | 0.25 |
| `hover` | 0.78 |
| `drag-over` | 1.00 |
| `converting` | `0.40 + 0.45 × progress` |

El componente interpola la intensidad actual hacia el objetivo; `targetFor` solo dice adónde ir.

## Tests exigidos

| Test | Verifica |
|---|---|
| `targetFor` para las 4 actividades | Mapeo evento → intensidad |
| `targetFor('converting', p)` crece con `p` y queda en [0.40, 0.85] | Progreso ligado a intensidad |
| `planFor({ webgl: false })` → `background: 'static'` | Invariante 2 |
| `planFor({ reducedMotion: true })` → `background: 'static'` | Invariante 6 |
| Media de FPS bajo 30 durante 2 s → degrada; luego no reintenta | Invariantes 3 y 4 |
| Contraste de todos los tokens sobre `SURFACE` ≥ 4.5 (3.0 para foco) | Invariante 7 |
