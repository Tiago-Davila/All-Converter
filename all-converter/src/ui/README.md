# Capa de experiencia (`src/ui/`)

Presentación, sonido y accesibilidad sobre el núcleo funcional de `specs/001-convertitodo/`.
No contiene lógica de conversión. Ver `specs/002-capa-experiencia/plan.md`.

## Regla de frontera (obligatoria)

- Nada dentro de `src/ui/` importa de `src/converters/` salvo `registry.ts` y `types.ts`.
- Ningún módulo de `src/converters/`, `src/lib/` o `src/workers/` importa de `src/ui/`.

Esto mantiene el registry como única fuente de verdad de la matriz de conversiones
(Principio III de la Constitución): la UI la descubre, nunca la duplica.

## Mapa

| Directorio | Contenido |
|---|---|
| `background/` | Fondo animado por shader WebGL, con degradación a gradiente CSS |
| `sound/` | `SoundManager` + adaptador de Web Audio, desacoplados |
| `prefs/` | Persistencia de preferencias de UI (`localStorage`) |
| `a11y/` | Tokens de color, contraste, matriz de capacidades/degradación, `aria-live` |
| `components/` | Cola de archivos, estados, selector de destino, tiles de borde |

Cada módulo espeja su ubicación en `tests/ui/`.
