# Research: Capa de experiencia (Phase 0)

Todas las decisiones de este documento están **verificadas con números**, no estimadas. Los
ratios de contraste se calcularon con la fórmula WCAG 2.1 (luminancia relativa) sobre los
valores hex exactos.

---

## D1 — El contenido no se apoya sobre el shader: va sobre un scrim

**Decisión**: ningún texto ni control se dibuja directamente sobre el fondo animado. Todo el
contenido vive sobre una **superficie (scrim)** de color `#0b0c11` con opacidad **≥ 0.85**.

**Racional**: este es el hallazgo central de la investigación. FR-007 y SC-002 exigen contraste
AA **en el peor fotograma** de la animación, no en promedio. Medido, el problema es real: con el
shader en un pico de brillo, los tokens más débiles caen por debajo de AA.

Contraste de cada token **directamente sobre el fondo**, según el brillo del fotograma:

| Fondo | texto principal `#f2f4f8` | texto tenue `#7d8598` | borde/foco `#8b7cf0` |
|---|---|---|---|
| Base `#0b0c11` | 17.74 ✅ | 5.28 ✅ | 5.80 ✅ |
| Pico moderado `#241f38` | 14.36 ✅ | **4.28 ❌** | 4.70 ✅ |
| Pico alto `#3a3157` | 10.86 ✅ | **3.23 ❌** | **3.55 ❌** (foco exige 3.0, pasa justo) |
| Pico excesivo `#55497e` | 7.22 ✅ | **2.15 ❌** | **2.36 ❌** |

Con el scrim, el contraste deja de depender del fotograma. Superficie efectiva = scrim
compuesto sobre el **peor** pico imaginable (`#55497e`):

| Alfa del scrim | Superficie efectiva | texto principal | texto tenue | borde/foco |
|---|---|---|---|---|
| 0.80 | `#1a1827` | 15.84 ✅ | 4.72 ✅ | 5.18 ✅ |
| **0.85** | `#161521` | 16.39 ✅ | **4.88 ✅** | 5.36 ✅ |
| 0.90 | `#12121c` | 16.89 ✅ | 5.03 ✅ | 5.53 ✅ |

**Se adopta α = 0.85** como mínimo (margen sobre 4.5 sin apagar del todo el fondo).

**Alternativas descartadas**:
- *Limitar el brillo máximo del shader*: frágil. El brillo depende del ruido, del punto de foco
  y de la intensidad; garantizar una cota superior exige analizar el shader, y cualquier cambio
  futuro en el GLSL podría romper AA en silencio.
- *Sombra de texto (`text-shadow`)*: WCAG no la reconoce como forma de alcanzar contraste, y no
  es medible de forma automatizada.
- *Bajar la intensidad global*: mata la identidad visual que es el objetivo de la feature.

**Consecuencia testeable**: el test de contraste corre sobre `tokens.ts` contra la **superficie**,
no contra la base. Es determinista y no requiere renderizar el shader.

---

## D2 — Tokens de color (provisionales hasta DEP-001)

**Estado**: el mockup (DEP-001) **no existe todavía en el repositorio**. Estos tokens se derivan
de lo único firme del enunciado (base `#0b0c11`, acentos cálidos/violáceos) y **todos pasan AA**.
Cuando llegue el mockup, cada color suyo DEBE pasar por esta misma verificación; si falla, gana
la accesibilidad (FR-001).

Contraste sobre la superficie `#161521` (scrim α=0.85 sobre el peor pico):

| Token | Hex | Ratio | Uso | AA |
|---|---|---|---|---|
| `text-primary` | `#f2f4f8` | 16.39 | Texto principal | ✅ 4.5 |
| `text-secondary` | `#a8b0c0` | 8.28 | Texto secundario | ✅ 4.5 |
| `text-muted` | `#7d8598` | 4.88 | Texto tenue (el más ajustado) | ✅ 4.5 |
| `accent-violet` | `#b39dff` | 7.89 | Acento primario | ✅ 4.5 |
| `accent-warm` | `#ffb37a` | 10.30 | Acento cálido | ✅ 4.5 |
| `state-done` | `#6ee7a8` | 11.74 | Estado `done` | ✅ 4.5 |
| `state-error` | `#ff8a8a` | 7.95 | Estado `error` | ✅ 4.5 |
| `state-converting` | `#7cc4ff` | 9.63 | Estado `converting` | ✅ 4.5 |
| `state-prep` | `#ffd479` | 12.84 | Estado `prep` | ✅ 4.5 |
| `state-pending` | `#9aa3b5` | 7.12 | Estado `pending` | ✅ 4.5 |
| `focus-ring` | `#8b7cf0` | 5.36 | Anillo de foco | ✅ 3.0 (exigido para UI) |

**Tipografías**: self-hosteadas en `public/fonts/`, ya resueltas en 001 (COEP `require-corp`
rompe cualquier font de CDN, así que la restricción se aplica sola).

---

## D3 — Mapeo evento → sonido → equivalente visual

Todo evento sonoro **debe** tener un equivalente visual (FR-033). La tabla es el contrato: si
una fila no tiene equivalente visual, el evento no existe.

| Evento (`SoundEvent`) | Cuándo dispara | Equivalente visual **obligatorio** | Asset |
|---|---|---|---|
| `DROP` | Un gesto de soltar con ≥1 archivo aceptado. **Uno por gesto**, no por archivo | Las filas aparecen en la cola; el dropzone colapsa a tira | `drop.*` |
| `REJECT` | Un gesto de soltar que produjo ≥1 rechazo. **Uno por gesto** | Tile de rechazo con el motivo concreto | `reject.*` |
| `QUEUE_DONE_OK` | La cola queda sin nada en `converting`/`prep`, sin errores | Todas las filas en `done`; aparece la ZipBar | `done-ok.*` |
| `QUEUE_DONE_ERRORS` | Ídem, pero con ≥1 error | Filas en `done` + filas en `error` con su causa | `done-errors.*` |
| *(opcionales)* `HOVER`, `DOWNLOAD`, `ZIP` | Hover en dropzone, descarga, generación de ZIP | Cambio de estado del control correspondiente | — |

**Divergencia deliberada respecto del argumento del comando**: el argumento proponía un enum de
8 eventos incluyendo `CONVERT_START` y `CONVERT_DONE` (por archivo). **Se descartan ambos**: la
spec (FR-029b, decidido en la clarificación) prohíbe el sonido por archivo, precisamente porque
una cola de 10 archivos produciría 10 sonidos. `BATCH_DONE` se desdobla en dos variantes
(`QUEUE_DONE_OK` / `QUEUE_DONE_ERRORS`) porque FR-029(c) exige distinguir "terminó bien" de
"terminó con errores". **Total: 4 assets obligatorios**, no 3.

---

## D4 — Consolidación de sonidos en lote

**Decisión**: no hace falta debounce ni coalescing. La regla de FR-029 elimina el problema **por
construcción**: como no existe sonido de éxito por archivo, no hay N disparos que consolidar. El
único sonido de finalización se emite en la transición de la cola a "nada convirtiendo".

**Política anti-solapamiento** (FR-035): si un sonido se dispara mientras otro está sonando, el
nuevo **se descarta**. No se encola (sonaría desfasado del evento) ni se mezcla a volumen sumado.
Implementación: una única referencia al `AudioBufferSourceNode` activo; si existe, se ignora el
disparo.

**Caso borde resuelto**: si la cola termina porque el usuario **canceló todo**, no suena
`QUEUE_DONE_OK` (cancelar no es un logro). Solo suena si hubo al menos una conversión terminada.

**Alternativa descartada**: debounce de 300 ms sobre eventos por archivo. Es la solución obvia si
uno conserva el sonido por archivo, pero agrega un temporizador, una ventana que testear y un
comportamiento dependiente del timing. Eliminar el evento es más simple que amortiguarlo.

---

## D5 — Desbloqueo de Web Audio y qué pasa antes del primer gesto

**Contexto**: los navegadores no permiten reproducir audio hasta que hay una interacción real del
usuario (política de autoplay). Un `AudioContext` creado antes nace en estado `suspended`.

**Decisión**:
1. El `AudioContext` **no se crea al cargar la app**. Se crea de forma perezosa, en el primer
   gesto del usuario (`pointerdown`/`keydown`), y **solo si la preferencia de sonido está
   activada**. Así, quien nunca habilita el sonido no paga ni el contexto ni los assets.
2. Los eventos sonoros disparados **antes** del desbloqueo **se descartan**, no se encolan. Un
   sonido de "drop" que suena tres segundos tarde es peor que el silencio.
3. Si el navegador no soporta Web Audio, o el desbloqueo falla, la app funciona **muda y sin
   errores** (FR-039). El fallo de audio nunca produce un mensaje de error al usuario.

**Consecuencia sobre la carga**: los assets se cargan (diferido) recién cuando el sonido queda
habilitado y desbloqueado, lo que mantiene el bundle inicial intacto (Principio V).

---

## D6 — Matriz de degradación (WebGL × Web Audio × reduce-motion)

Un único módulo (`capabilities.ts`) resuelve esta matriz y expone el resultado. Los componentes
**leen**, no deciden. Esto evita que la lógica de degradación se disperse en `if` por toda la UI.

| WebGL | Web Audio | reduce-motion | Fondo | Sonido | Funcionalidad |
|---|---|---|---|---|---|
| ✅ | ✅ | ❌ | Shader animado | Según preferencia | 100% |
| ✅ | ✅ | ✅ | **Estático** (gradiente) | **Mudo** (veto RM) | 100% |
| ✅ | ❌ | ❌ | Shader animado | **Mudo** (sin error) | 100% |
| ❌ | ✅ | ❌ | **Gradiente CSS** | Según preferencia | 100% |
| ❌ | ❌ | ✅ | **Gradiente CSS** | **Mudo** | 100% |

**Invariante**: la funcionalidad es **100% en las cinco filas**. Ninguna degradación quita una
capacidad; solo quita adorno. Ninguna produce un mensaje de error.

**Pérdida de contexto WebGL en caliente**: se escucha `webglcontextlost`, se cae al gradiente CSS
y **no se reintenta** en esa sesión.

---

## D7 — Costo del shader y política de pausa

**Objetivo**: 60 fps. **Umbral de degradación**: promedio por debajo de **30 fps durante 2 s
seguidos** → congela a estático y **no reintenta en la sesión** (FR-004/FR-004b). El no-reintento
es deliberado: sin él, un equipo que oscila alrededor del umbral entraría y saldría del modo
animado, que es peor que cualquiera de los dos estados.

**Medición**: media móvil sobre los deltas de `requestAnimationFrame`. Se **descartan los primeros
~500 ms** (el arranque siempre tiene fotogramas lentos por compilación de shaders y no son
representativos del rendimiento sostenido).

**Pausas** (no cuentan como degradación, son reversibles):
- `document.hidden` → se cancela el rAF. Al volver, se reanuda. Una pestaña oculta que sigue
  animando gasta batería a cambio de nada.
- `prefers-reduced-motion: reduce` → no se anima (queda estático desde el inicio).

**Costo**: un fragment shader FBM a pantalla completa es fill-rate bound. Mitigaciones: se
renderiza a **resolución reducida** (~0.75× DPR, escalado por CSS) y se limitan las octavas de
ruido. El canvas es puramente decorativo: `pointer-events: none`, y está detrás del scrim.

**Alternativa descartada**: three.js / ogl. Costo (~150 KB gzip three, ~15 KB ogl) contra
beneficio nulo: un quad a pantalla completa con un fragment shader no necesita un motor 3D.
WebGL2 crudo son ~150 líneas y no toca el presupuesto del Principio V.

---

## D8 — El control de sonido muestra el efecto real, no la preferencia

**Decisión** (FR-034b): cuando `prefers-reduced-motion` vetea el sonido, el control muestra
**"silenciado"** con el motivo visible, aunque la preferencia guardada diga "activado". La
preferencia se conserva intacta (FR-034c) y vuelve a tener efecto si el usuario desactiva
reduce-motion.

**Racional**: un control que dice "activado" mientras no suena nada es exactamente la mentira que
el Principio XV prohíbe. El estado mostrado es el efecto, no la intención.

---

## D9 — Sin dependencias nuevas

**Decisión**: cero librerías nuevas. Web Audio API para el sonido, WebGL2 crudo para el fondo.

**Racional**: la Constitución exige justificar toda dependencia nueva antes de agregarla, y el
Principio V fija un presupuesto de 200 KB gzip (hoy consumidos 67.7 KB). Ninguna de las dos
necesidades justifica una librería: el `SoundManager` que la spec pide son ~80 líneas, y el
shader ~150.

El `WebAudioAdapter` existe **precisamente** para que esta decisión sea reversible: si más
adelante aparece la "librería de sonidos provista" (DEP-002) y conviene usarla, se reemplaza el
adaptador y ni el `SoundManager` ni los componentes se enteran (FR-038).
