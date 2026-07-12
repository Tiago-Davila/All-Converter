<!--
Sync Impact Report
==================
Version change: (template, sin versión) → 1.0.0
Ratificación inicial de la constitución del proyecto ConvertiTodo.

Modified principles: N/A (creación inicial; se reemplazaron todos los placeholders
del template por 11 principios concretos provistos por el propietario del proyecto).

Added sections:
- Core Principles (I–XI)
- Restricciones Técnicas
- Flujo de Trabajo y Puertas de Calidad
- Governance

Removed sections: ninguna (se eliminaron solo los comentarios de ejemplo del template).

Templates requiring updates:
- ✅ .specify/templates/plan-template.md — compatible; la sección "Constitution Check"
  deriva sus gates de este archivo, sin referencias hardcodeadas.
- ✅ .specify/templates/spec-template.md — compatible; sin referencias a principios.
- ✅ .specify/templates/tasks-template.md — compatible; sin referencias a principios.
- ✅ CLAUDE.md — ya refleja estos principios en "Reglas duras"; sin cambios necesarios.

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

## Flujo de Trabajo y Puertas de Calidad

- **Fuente de verdad**: `specs/001-convertitodo/` (spec, plan, data-model, tasks). No
  se modifica durante la implementación.
- **Commits**: chicos y descriptivos, con conventional commits (feat, fix, test,
  chore). Una tarea, un diff, un commit.
- **Puertas de merge**: (1) trazabilidad a una tarea de tasks.md (Principio I),
  (2) test con fixture real (Principio VIII), (3) TypeScript estricto sin `any` no
  justificado (Principio VII), (4) verificación del tamaño de chunks en
  `npm run build` (Principio V).
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

**Version**: 1.0.0 | **Ratified**: 2026-07-12 | **Last Amended**: 2026-07-12
