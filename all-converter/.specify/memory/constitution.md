<!--
Sync Impact Report
==================
Version change: 1.0.0 → 1.1.0 (MINOR: cinco principios nuevos, ninguno removido ni
redefinido de forma incompatible).

Modified principles: ninguno. Los principios I–XI se mantienen intactos, con su
redacción y su numeración original (privacidad absoluta, client-side, registry de
conversores, Web Workers, carga diferida, magic bytes, TypeScript estricto, tests con
fixtures, honestidad en la UI, límites de tamaño, sin código fuera de fase).

Added sections:
- Principio XII — Accesibilidad no negociable
- Principio XIII — El sonido es complementario, nunca portador único
- Principio XIV — Rendimiento percibido y fondo animado
- Principio XV — Honestidad de la interfaz (reafirma el Principio IX en la capa visual)
- Principio XVI — Sonido y animaciones sin telemetría
- Restricciones Técnicas: subsección "Capa de experiencia (UI, sonido, shaders)"
- Flujo de Trabajo: puertas de merge (5), (6) y (7) para la capa de experiencia

Removed sections: ninguna.

Templates requiring updates:
- ✅ .specify/templates/plan-template.md — compatible sin cambios; su "Constitution
  Check" deriva los gates de este archivo y no hardcodea principios.
- ✅ .specify/templates/spec-template.md — compatible; sin referencias a principios.
- ✅ .specify/templates/tasks-template.md — compatible; sin referencias a principios.
- ✅ .specify/templates/constitution-template.md — es el template base; no se modifica.
- ⚠ CLAUDE.md — NO existe actualmente en el repositorio (el reporte de la v1.0.0 lo
  daba por presente). Si se crea, DEBE reflejar los principios XII–XVI en sus reglas
  duras.

Follow-up TODOs: ninguno.
-->

# Constitución de ConvertiTodo

ConvertiTodo es un convertidor de archivos web 100% client-side, inspirado en iLovePDF
pero con más tipos de conversión. Es un proyecto personal con doble objetivo: portfolio
y uso real. Esta constitución define los principios no negociables que gobiernan toda
especificación, plan, tarea e implementación del proyecto.

## Core Principles

### I. La especificación manda

La especificación manda sobre la implementación. NO se programa funcionalidad que no
esté trazada a una historia de usuario o requisito en los artefactos de
`specs/<feature>/` (spec.md, plan.md, tasks.md). Ante ambigüedad entre un pedido y la
spec, gana la spec y se debe avisar la discrepancia.

**Racional**: el proyecto se gestiona con Spec-Driven Development; el código sin
trazabilidad genera alcance fantasma imposible de verificar o mantener.

### II. Privacidad absoluta (NO NEGOCIABLE)

Ningún archivo del usuario se sube a ningún servidor, nunca. Todo el procesamiento
ocurre en el navegador con librerías JS/WASM. NO existe backend ni base de datos.
Cualquier solución que requiera enviar archivos (o su contenido, total o parcial)
fuera del navegador queda automáticamente descartada, sin importar la mejora de
fidelidad o rendimiento que prometa.

**Racional**: la privacidad es la propuesta de valor central del producto; una sola
excepción la destruye por completo.

### III. Interfaz Converter única y registry central

Toda conversión implementa una única interfaz `Converter`
(`src/converters/types.ts`) y se registra en el registry central
(`src/converters/registry.ts`). La UI solo conoce el registry. Agregar una conversión
nueva NO debe requerir tocar la UI ni otras conversiones. Los conversores NO importan
React ni tocan el DOM: lógica y UI separadas siempre.

**Racional**: el crecimiento del producto es agregar conversiones; sin un contrato
único, cada alta se convierte en una refactorización transversal.

### IV. Main thread libre: Web Workers obligatorios

Toda conversión pesada (más de ~50ms de CPU) DEBE correr en un Web Worker. El main
thread nunca se bloquea. Los `ArrayBuffer` se pasan como transferables, no copiados.

**Racional**: una UI congelada durante una conversión de minutos equivale a un
producto roto para el usuario.

### V. Carga diferida y presupuesto de bundle

Las librerías pesadas (ffmpeg.wasm, pdfjs-dist, SheetJS, mammoth, docx) se cargan con
`dynamic import()` solo cuando el usuario elige una conversión que las necesita. El
bundle inicial DEBE mantenerse por debajo de 200KB gzip; se verifica en cada
`npm run build`.

**Racional**: la primera carga define la percepción de calidad; nadie debe descargar
30MB de WASM para convertir un PNG.

### VI. Detección de tipo por magic bytes

El tipo de archivo se detecta por magic bytes (librería `file-type`) además de la
extensión, que funciona solo como fallback. NUNCA se confía únicamente en la
extensión.

**Racional**: las extensiones mienten (por error o malicia); operar sobre el tipo real
evita conversiones corruptas y errores confusos.

### VII. TypeScript estricto

TypeScript en modo estricto. Prohibido `any`, salvo justificación documentada en un
comentario junto a cada uso.

**Racional**: los conversores manipulan datos binarios y contratos entre workers;
los tipos son la primera línea de defensa contra corrupción silenciosa.

### VIII. Sin test no hay merge

Toda conversión nueva se mergea con al menos un test de Vitest usando un archivo
fixture real en `tests/fixtures/`. Sin test, no hay merge. Los fixtures deben ser
archivos chicos y reales, no sintéticos triviales.

**Racional**: una conversión solo se puede validar contra archivos reales; los tests
sin fixture real dan falsa confianza.

### IX. Honestidad en la UI

La UI DEBE comunicar limitaciones con honestidad: fidelidad parcial en DOCX↔PDF,
necesidad de imagen o waveform en MP3→MP4, y límites de tamaño por memoria del
navegador. NO se intenta "arreglar" limitaciones de diseño con soluciones que violen
el Principio II.

**Racional**: la confianza del usuario vale más que aparentar una fidelidad que el
procesamiento client-side no puede garantizar.

### X. Manejo de memoria y límites de tamaño

Los archivos grandes pueden crashear la pestaña. Cada conversor DEBE definir
`maxSizeMB` según su tipo de conversión, y la UI DEBE rechazar archivos que lo
excedan ANTES de intentar convertir, con un mensaje claro al usuario.

**Racional**: un crash de pestaña destruye la sesión completa del usuario y es el peor
fallo posible en una app client-side; prevenirlo es más barato que recuperarse.

### XI. Sin código fuera de fase

NO se implementa código durante las fases de especificación, aclaración, checklist,
planificación y generación de tareas. En esas fases solo se crean o actualizan los
documentos correspondientes. La implementación ocurre exclusivamente en la fase de
implementación, una tarea por diff por commit.

**Racional**: mezclar diseño e implementación invalida el proceso Spec-Driven: el
código escrito antes de tiempo condiciona la spec en vez de derivarse de ella.

### XII. Accesibilidad no negociable

- **Contraste**: todo texto y todo componente de UI DEBE cumplir WCAG 2.1 nivel AA:
  4.5:1 para texto normal, 3:1 para texto grande (≥24px, o ≥18.66px en negrita) y 3:1
  para componentes de UI y elementos gráficos que transmitan información (bordes de
  campos, íconos de estado, indicadores de foco).
- **Nada solo por color**: ningún estado se comunica ÚNICAMENTE por color. Cada estado
  (`pending`, `converting`, `done`, `error`, `prep`) DEBE tener además al menos un
  diferenciador no cromático: ícono, forma o texto propio. Un usuario en escala de
  grises debe poder distinguir los cinco estados sin ambigüedad.
- **Teclado**: todo control operable con mouse DEBE ser operable con teclado, con orden
  de tabulación lógico y foco visible que cumpla el contraste 3:1. No se elimina el
  outline de foco sin reemplazarlo por un indicador equivalente o mejor.

**Racional**: una app que procesa los archivos de cualquiera debe ser usable por
cualquiera; el color y el mouse son canales que no todos los usuarios tienen.

### XIII. El sonido es complementario, nunca portador único

- **Redundancia obligatoria**: todo evento sonoro DEBE tener un equivalente visual
  simultáneo. Ninguna información existe solo en el canal de audio.
- **Silencio por defecto**: el sonido está desactivado por defecto o respeta la
  preferencia del sistema. Nunca suena sin que el usuario lo haya habilitado
  explícita o implícitamente vía esa preferencia.
- **Control y persistencia**: existe un control de silencio claro, alcanzable por
  teclado y rotulado; la preferencia persiste entre sesiones (almacenamiento local del
  navegador, coherente con el Principio II).
- **Menos estímulo**: bajo `prefers-reduced-motion: reduce` NO se reproducen sonidos,
  como equivalente auditivo de la reducción de movimiento.

**Racional**: el audio es un canal que muchos usuarios no perciben, no habilitan o no
toleran; usarlo como único portador de información excluye y molesta.

### XIV. Rendimiento percibido y fondo animado

- **Nunca bloquea**: el fondo animado (shader WebGL) NO bloquea ni retrasa la
  interacción. Su carga y ejecución nunca compiten con una conversión en curso ni con
  la respuesta del main thread (coherente con el Principio IV).
- **Degradación con gracia**: si WebGL no está disponible o falla, la app cae a un
  fondo estático equivalente sin error visible ni pérdida de funcionalidad.
- **Se detiene o simplifica**: bajo `prefers-reduced-motion: reduce` y cuando la
  pestaña no está visible (`document.hidden`), la animación se detiene o se simplifica.
- **No compite con el contenido**: el texto DEBE permanecer legible por encima del
  fondo en todo momento, cumpliendo el contraste del Principio XII contra el peor
  fotograma de la animación, no contra un fotograma favorable.

**Racional**: la estética no puede pagarse con la interacción; un fondo bonito que
tironea la UI o vuelve ilegible el texto es un defecto, no una función.

### XV. Honestidad de la interfaz

Reafirma el Principio IX en la capa visual, con reglas verificables:

- **Antes, no después**: las limitaciones se comunican ANTES de convertir, no en el
  error posterior. Como mínimo: fidelidad parcial en DOCX↔PDF, límite de tamaño del
  conversor elegido, requisito de imagen en MP3→MP4, y aviso de motor pesado en la
  primera carga de una conversión que descarga WASM.
- **Ninguna promesa falsa**: ninguna acción primaria promete un resultado que la
  implementación no entrega.
- **Fuera de alcance, deshabilitado**: las funciones no implementadas (p. ej. OCR) se
  muestran deshabilitadas y rotuladas como "próximamente". NUNCA se presentan como
  acción activa que luego falla o no hace nada.

**Racional**: una limitación anunciada es una característica del producto; la misma
limitación descubierta después de esperar una conversión es una traición.

### XVI. Sonido y animaciones sin telemetría

Todos los assets de audio y todos los shaders son LOCALES, servidos desde el bundle.
Sin CDN en runtime, sin fetch a terceros, sin telemetría ni analytics de interacción
sonora o visual. Esta regla es una extensión del Principio II y hereda su carácter no
negociable: ninguna mejora estética justifica una petición a un tercero.

**Racional**: la privacidad no admite excepciones "menores"; un pedido a un CDN por un
sonido filtra IP y hábitos de uso igual que uno por un archivo, y además rompe COEP.

## Restricciones Técnicas

- **Stack fijo**: React 19 + Vite + TypeScript estricto + Tailwind CSS v4; Vitest para
  tests; deploy estático en Vercel. Sin backend, sin base de datos, sin excepciones.
- **COOP/COEP**: ffmpeg.wasm multithread necesita `SharedArrayBuffer`; `vercel.json`
  define los headers COOP/COEP y no deben quitarse. Si no hay `SharedArrayBuffer`, se
  degrada a single-thread. COEP rompe recursos externos: fonts self-hosteadas, nada de
  CDNs en runtime.
- **pdfjs-dist**: `workerSrc` se configura con el asset local del bundle, nunca CDN.
- **SheetJS**: se instala desde https://cdn.sheetjs.com (la versión de npm está
  desactualizada); esto es una fuente de instalación, no un recurso de runtime.
- **Dependencias nuevas**: no se agregan sin justificarlas primero.

### Capa de experiencia (UI, sonido, shaders)

- **Assets locales**: audio y shaders viven en el repositorio y se sirven desde el
  bundle. Cualquier URL de tercero en runtime es una violación del Principio XVI (y
  además la bloquea COEP).
- **Presupuesto**: los assets de audio y el código del shader entran en el presupuesto
  de bundle del Principio V. El audio se carga de forma diferida y solo si el usuario
  habilitó el sonido.
- **Preferencias del usuario**: `prefers-reduced-motion` y la preferencia de sonido se
  leen en un único lugar y se respetan en toda la app; el estado de sonido persiste en
  `localStorage`, nunca en un servidor.

## Flujo de Trabajo y Puertas de Calidad

- **Fuente de verdad**: `specs/001-convertitodo/` (spec, plan, data-model, tasks). No
  se modifica durante la implementación.
- **Commits**: chicos y descriptivos, con conventional commits (feat, fix, test,
  chore). Una tarea, un diff, un commit.
- **Puertas de merge**:
  1. Trazabilidad a una tarea de tasks.md (Principio I).
  2. Test con fixture real (Principio VIII).
  3. TypeScript estricto sin `any` no justificado (Principio VII).
  4. Verificación del tamaño de chunks en `npm run build` (Principio V).
  5. Contraste AA verificado y ningún estado distinguible solo por color; todo control
     nuevo alcanzable y operable por teclado con foco visible (Principio XII).
  6. Todo evento sonoro nuevo tiene equivalente visual, respeta el silencio por defecto
     y `prefers-reduced-motion` (Principios XIII y XIV).
  7. Ningún asset de audio, shader o font referencia un origen externo en runtime
     (Principios II y XVI).
- **Verificación local de headers**: `npm run preview` para validar COOP/COEP antes de
  deploy.

## Governance

Esta constitución prevalece sobre cualquier otra práctica, documento o preferencia del
proyecto, incluido CLAUDE.md, que debe mantenerse consistente con ella.

- **Enmiendas**: cualquier cambio a esta constitución se hace por commit dedicado que
  documente el cambio, su justificación y el nuevo número de versión. Los templates y
  documentos dependientes (`.specify/templates/*`, CLAUDE.md) se actualizan en el
  mismo cambio si resultan afectados.
- **Versionado**: semántico. MAJOR: eliminación o redefinición incompatible de un
  principio; MINOR: principio o sección nueva, o ampliación material de una guía;
  PATCH: aclaraciones y correcciones de redacción sin cambio semántico.
- **Revisión de cumplimiento**: todo plan de implementación pasa el "Constitution
  Check" contra estos principios antes de la fase de investigación y se re-verifica
  tras el diseño. Toda violación debe justificarse explícitamente en la sección
  "Complexity Tracking" del plan o rechazarse.

**Version**: 1.1.0 | **Ratified**: 2026-07-12 | **Last Amended**: 2026-07-13
