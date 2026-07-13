# Calidad Funcional (UX, sonido, accesibilidad) Checklist: Capa de experiencia

**Purpose**: Validar la **calidad de los requisitos** de la capa de experiencia (completitud,
claridad, consistencia, medibilidad y cobertura) antes de planificar. Esto NO es un plan de
pruebas: cada ítem interroga lo que la spec **dice o deja de decir**, no si el código funciona.
**Created**: 2026-07-13
**Feature**: [spec.md](../spec.md)

> ⚠️ **DECISIÓN TOMADA (2026-07-13)**: el conflicto de alcance se resolvió a favor de 002 (cola
> heterogénea agrupada por categoría), con tope global de 10 archivos. La contradicción sigue
> viva **hasta que 001 se enmiende**: ver DEP-003 en la spec. CHK004 queda como la puerta
> pendiente.

## Conflictos con 001 (resueltos en 002, pendientes de ejecutar en 001)

- [x] CHK001 ¿Se reconcilió el modelo de cola? **Resuelto**: gana 002 (cola con formatos mezclados agrupados por categoría). Registrado en §Clarifications y en FR-010. [Conflict → Resolved, Spec §FR-010 ↔ 001 §FR-023]
- [x] CHK002 ¿Se reconcilió el tope de archivos? **Resuelto**: se conserva el tope de **10 archivos en total** (FR-010b). Los escenarios de 20 y 40 archivos de 002 fueron corregidos a 10. [Conflict → Resolved, Spec §FR-010b]
- [x] CHK003 ¿Está definido qué pasa con una carpeta de tipos mezclados? **Resuelto**: los archivos se reparten en los grupos de su categoría respetando el tope de 10, ya no se rechazan por diferir del primero. [Conflict → Resolved, Spec §Edge Cases]
- [x] CHK004 **Resuelto en specs (2026-07-13)**: 001 fue enmendada (FR-023 admite formatos mezclados; FR-023b/c definen destino por archivo; data-model y US4 actualizados). **El código y los tests siguen pendientes**: tareas T047–T051 de `specs/001-convertitodo/tasks.md`, a ejecutar con `/speckit-implement`. [Conflict → Resolved en spec, código pendiente]
- [x] CHK005 (No aplica: ganó el modelo de 002, no el de 001. FR-010..FR-013 se conservan y se ampliaron con FR-010b.) [Resolved]
- [x] CHK006 **Resuelto (2026-07-13, hallazgo A1)**: "No soportados" es una **vista agrupada de los rechazos** (`state: 'rejected'` de 001), no un grupo convertible. Sin selector, sin convertir, no cuenta para el tope de 10, no dispara sonidos de éxito. FR-012 aclarado; T020 lo testea. [Ambiguity → Resolved, Spec §FR-012]

## Completitud: los cinco estados de archivo

- [ ] CHK007 ¿Los cinco estados (`pending`, `converting`, `done`, `error`, `prep`) tienen cada uno definidos sus **tres canales** (color, ícono/forma, texto), o solo se enuncia la regla en abstracto? [Completeness, Spec §FR-015]
- [ ] CHK008 ¿Está especificado el **texto exacto** de cada estado, o solo el de `prep` ("esperando al conversor…")? [Gap, Spec §FR-020]
- [x] CHK009 ¿Está definida la acción disponible en cada estado sin ambigüedad? En `error`, la spec dice "quitar o reintentar, **según el caso**" sin definir **cuáles** casos son reintentables. [Ambiguity, Spec §FR-019]
- [ ] CHK010 ¿Está definido el estado de un archivo **cancelado**? 001 lo lista como estado propio ("cancelado"); 002 solo enumera cinco y no dice a cuál cae tras cancelar. [Gap, Spec §FR-015 ↔ 001 §Key Entities]
- [ ] CHK011 ¿Está definida la transición `prep` → `converting` y qué se muestra si el motor **falla al cargar** (no es un fallo de conversión)? [Coverage, Gap]
- [ ] CHK012 ¿La "marca de ya-descargado" tiene definido su canal no-cromático, o es el único indicador que podría quedar solo-por-color? [Completeness, Spec §FR-018]

## Completitud: los seis casos borde de negocio

- [ ] CHK013 ¿Cada uno de los seis casos borde (PDF con contraseña, límite de tamaño, formato no soportado, PDF escaneado, video sin audio, fidelidad DOCX↔PDF) tiene criterios de aceptación **testeables**, o alguno queda solo enunciado? [Completeness, Spec §FR-021..FR-026]
- [ ] CHK014 ¿Está definido qué pasa si la contraseña del PDF es **incorrecta** (reintentos, mensaje, bloqueo)? La spec define el input pero no el camino de fallo. [Gap, Spec §FR-021]
- [ ] CHK015 ¿Está definido **cómo detecta el sistema** que un PDF está escaneado o que un video no tiene pista de audio, y en qué momento (al agregar o al elegir destino)? El aviso debe darse "antes de convertir", lo que exige inspección previa. [Ambiguity, Spec §FR-024/FR-025]
- [ ] CHK016 ¿El aviso de fidelidad parcial DOCX↔PDF especifica **dónde** aparece y si es descartable/persistente? [Clarity, Spec §FR-026]
- [ ] CHK017 ¿Los seis avisos están definidos como **bloqueantes o informativos**? FR-027 exige avisar antes, pero no dice si el usuario puede proceder igual. [Ambiguity, Spec §FR-027]
- [ ] CHK018 ¿El texto de los mensajes de error es responsabilidad de 001 (conversores) o de 002 (UI)? La spec asume que vienen de 001, pero FR-019 exige "causa concreta" sin definir quién la redacta. [Dependency, Spec §Assumptions]

## Sonido: equivalencia visual y consistencia

- [ ] CHK019 ¿Cada evento sonoro tiene su **equivalente visual explícitamente definido**, o FR-033 solo enuncia la regla sin nombrar el equivalente de cada uno? La regla es verificable únicamente si el equivalente está escrito. [Completeness, Spec §FR-033]
- [ ] CHK020 ¿Está definido el equivalente visual concreto del evento `fin-de-cola` en sus dos variantes (`todo-ok` / `con-errores`)? Es el único sonido que no corresponde a un cambio de fila individual. [Gap, Spec §FR-029]
- [x] CHK021 ¿Es consistente la relación entre "silenciado por defecto" (§FR-031), el veto de `prefers-reduced-motion` (§FR-034) y la persistencia (§FR-032)? Concretamente: si el usuario activó el sonido y `prefers-reduced-motion` está activo, ¿el **control** muestra "activado" (preferencia) o "silenciado" (efecto real)? [Ambiguity, Conflict, Spec §FR-031/FR-034]
- [x] CHK022 ¿Está definido si el usuario puede **anular** el veto de reduce-motion? La spec dice que no hay override (§Assumptions), lo que implica que el control de sonido puede quedar sin efecto sin explicación visible. ¿Se comunica ese estado? [Gap, Spec §Assumptions]
- [ ] CHK023 ¿La regla de consolidación cubre el caso de **varias colas encadenadas** (el usuario agrega archivos mientras otra tanda convierte)? "Fin de cola" asume una cola que se vacía una vez. [Coverage, Gap, Spec §FR-029]
- [ ] CHK024 ¿Está definido el comportamiento sonoro cuando la cola termina **con todo cancelado**? La spec dice que no suena éxito, pero no si suena la variante de error o nada. [Ambiguity, Spec §Edge Cases]
- [ ] CHK025 ¿Está cuantificado "volumen moderado" y "sonidos cortos", o son adjetivos no verificables? [Measurability, Spec §FR-035]
- [x] CHK026 ¿La política anti-solapamiento está definida sin ambigüedad? FR-035 ofrece dos comportamientos distintos ("se descarta el nuevo **o** se encola") sin elegir uno. [Ambiguity, Spec §FR-035]

## Accesibilidad: verificabilidad de cada requisito

- [ ] CHK027 ¿El requisito de contraste está expresado con **números** y con el umbral correcto por tipo de elemento (4.5:1 texto normal, 3:1 texto grande y componentes)? [Measurability, Spec §FR-040]
- [ ] CHK028 ¿Está definido **contra qué fondo** se mide el contraste, dado que el fondo es animado y cambia? SC-002 dice "el fotograma más claro"; FR-007 dice "cualquier fotograma". ¿Son la misma exigencia? [Consistency, Spec §FR-007 ↔ §SC-002]
- [ ] CHK029 ¿Es verificable el requisito de foco visible, con su propio umbral de contraste (3:1) y no solo como "foco visible"? [Measurability, Spec §FR-041]
- [ ] CHK030 ¿El requisito "no solo por color" es verificable de forma objetiva (p. ej. "distinguible en escala de grises") y no un juicio subjetivo? [Measurability, Spec §FR-044/SC-001]
- [ ] CHK031 ¿Está especificado el tipo de región `aria-live` (polite/assertive) y **qué texto exacto** se anuncia en cada caso? La spec da un ejemplo ("12 archivos listos, 3 con error") pero no la plantilla. [Clarity, Spec §FR-043]
- [ ] CHK032 ¿Está definido el comportamiento del **foco** cuando una fila desaparece de la cola (al quitarla o tras descargar)? Los Edge Cases lo mencionan ("no lo dejan huérfano") pero ningún FR lo exige. [Gap, Spec §Edge Cases]
- [ ] CHK033 ¿El control de sonido y el estado de OCR deshabilitado tienen definido su nombre accesible exacto? OCR sí ("OCR (próximamente)"); el control de sonido no. [Gap, Spec §FR-031]
- [ ] CHK034 ¿Está definido el orden de tabulación esperado, o solo se pide que sea "lógico"? [Ambiguity, Spec §FR-041]

## Rendimiento y degradación del fondo

- [ ] CHK035 ¿El umbral de degradación es medible sin ambigüedad (30 FPS durante 2s), incluyendo **desde cuándo** se empieza a medir (¿se ignoran los primeros fotogramas de arranque?)? [Clarity, Spec §FR-004]
- [ ] CHK036 ¿Está definido qué significa "el fondo no bloquea la interacción" en términos verificables, o es un adjetivo? FR-006 no da métrica. [Measurability, Spec §FR-006]
- [ ] CHK037 ¿Está definida la relación entre la intensidad del fondo y el progreso de conversión con suficiente precisión para ser aceptada o rechazada? "Ligada al progreso" no es verificable. [Ambiguity, Spec §FR-002]
- [ ] CHK038 ¿Está definido qué ocurre si el contexto WebGL se pierde **y luego se recupera**? FR-004b prohíbe reintentar tras degradar por FPS, pero no dice nada sobre recuperación de contexto. [Coverage, Gap, Spec §FR-004b]

## Cumplimiento de la Constitución (v1.1.0)

- [ ] CHK039 ¿Ningún requisito permite una petición de red en runtime para fuentes, audio o shaders? ¿Está escrito como prohibición verificable y no solo como intención? [Consistency, Spec §FR-045 ↔ Constitución §XVI]
- [ ] CHK040 ¿La persistencia de preferencias respeta el Principio II (nada sale del navegador) y está acotada a **solo** el estado del sonido, sin datos de archivos? [Consistency, Spec §FR-032/FR-046 ↔ Constitución §II]
- [ ] CHK041 ¿Todo estado se comunica por color **+ ícono/forma + texto**, sin excepciones (incluida la marca de ya-descargado y el estado del control de sonido)? [Consistency, Spec §FR-015 ↔ Constitución §XII]
- [ ] CHK042 ¿El sonido es siempre complementario, sin ningún caso donde sea el único portador de información? [Consistency, Spec §FR-033 ↔ Constitución §XIII]
- [ ] CHK043 ¿El OCR está especificado como visible-pero-inerte y rotulado "próximamente", nunca como acción activa? [Consistency, Spec §FR-024 ↔ Constitución §XV]
- [ ] CHK044 ¿Las limitaciones se comunican **antes** de convertir en los seis casos, sin ninguna que aparezca solo como error posterior? [Consistency, Spec §FR-027 ↔ Constitución §XV]
- [ ] CHK045 ¿El fondo animado se detiene con la pestaña oculta y bajo reduce-motion, y degrada sin WebGL? [Consistency, Spec §FR-004/FR-005 ↔ Constitución §XIV]
- [ ] CHK046 ¿Los assets de audio y el shader entran en el presupuesto de bundle (<200KB gzip inicial) del Principio V, y está dicho que el audio se carga diferido solo si el sonido está habilitado? La spec no lo menciona. [Gap, Constitución §V y §Capa de experiencia]

## Cobertura de casos borde (comportamiento definido, no solo mencionado)

- [ ] CHK047 ¿Los seis casos borde técnicos (sin WebGL, sin Web Audio, reduce-motion, lote solapado, grupo no soportado, foco por teclado en `converting`) tienen **comportamiento definido en un FR**, o solo aparecen narrados en la sección Edge Cases sin requisito que los respalde? [Coverage, Spec §Edge Cases]
- [ ] CHK048 ¿"El primer gesto del usuario habilita el audio" está definido con precisión: qué gestos cuentan, y qué pasa con los eventos sonoros disparados **antes** de ese gesto (se pierden o se encolan)? [Ambiguity, Spec §FR-039]
- [ ] CHK049 ¿Está definido el comportamiento cuando `prefers-reduced-motion` **cambia en caliente** (el usuario lo activa con la app abierta)? [Coverage, Gap]
- [ ] CHK050 ¿Está definido el comportamiento de la cola cuando el usuario agrega archivos **mientras** hay conversiones en curso? Afecta al fin-de-cola, a los anuncios y al fondo. [Coverage, Gap]
- [ ] CHK051 ¿Está definido el comportamiento con `localStorage` **no disponible** (modo privado, storage lleno), más allá del valor corrupto que sí está cubierto? [Coverage, Gap, Spec §FR-032b]

## Dependencias y supuestos

- [ ] CHK052 ¿DEP-001 (mockup) tiene definido qué pasa si la paleta del mockup **no cumple** el contraste AA? La spec dice "gana la accesibilidad", pero no quién decide ni cómo se registra la desviación. [Assumption, Spec §DEP-001]
- [ ] CHK053 ¿DEP-002 (assets de audio) especifica el número mínimo de sonidos distinguibles (4) y sus requisitos de licencia de forma verificable antes de aceptarlos? [Completeness, Spec §DEP-002]
- [ ] CHK054 ¿Está validado el supuesto de que 001 expone realmente los cinco estados, las categorías y el `maxSizeMB` de forma consumible por la UI, o es una suposición sin verificar contra el registry? [Assumption, Spec §Assumptions]
- [ ] CHK055 ¿Existe un esquema de IDs trazable entre los FR de 002 y los de 001 para las reglas heredadas (límites, mensajes, matriz)? [Traceability, Gap]

## Notas

- **CHK001–CHK006 son bloqueantes**: el conflicto de alcance con 001 (lotes heterogéneos fuera
  de alcance, tope de 10 archivos) invalida el modelo de cola agrupada de 002 tal como está
  escrito. No tiene sentido planificar la UI de una cola multi-grupo si el núcleo rechaza los
  lotes mixtos. La reconciliación puede ir en cualquiera de las dos direcciones, pero debe ser
  una decisión explícita y documentada, no un silencio.
- Los ítems interrogan la **calidad de los requisitos**, no el comportamiento del sistema: cada
  uno se responde leyendo la spec, no ejecutando la app.
