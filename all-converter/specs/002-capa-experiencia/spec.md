# Feature Specification: Capa de experiencia (UI visual, sonido y accesibilidad)

**Feature Branch**: `002-capa-experiencia`

**Created**: 2026-07-13

**Status**: Draft

**Input**: User description: "Desarrollar la capa de experiencia (UI visual, sonido y accesibilidad) de ConvertiTodo sobre el núcleo funcional ya definido en specs/001-convertitodo/. Esta feature NO reimplementa conversión: consume el registry, los workers y los estados de 001 y les da forma visual, sonora y accesible."

## Contexto y frontera con 001

Esta feature es una **capa sobre 001**, no un reemplazo. La lógica de conversión, la matriz
de formatos, los workers, los límites de tamaño y los estados de archivo ya existen y son la
fuente de verdad. La capa de experiencia los **descubre y los presenta**: no duplica la
matriz, no reimplementa conversores, no cambia el comportamiento funcional.

Toda regla que aquí se enuncia sobre "qué formatos se ofrecen" o "cuál es el límite de
tamaño" significa: **lo que el registry de 001 declare en ese momento**.

## Clarifications

### Session 2026-07-13

- Q: MP3→MP4, ¿imagen obligatoria o waveform automático? ¿Qué bloquea? → A: Waveform generado automáticamente por defecto; el usuario puede reemplazarlo por una imagen. Nunca bloquea "Convertir": siempre hay un resultado válido.
- Q: ¿Qué umbral concreto degrada el fondo animado a estático? → A: Degrada si no hay WebGL, O si `prefers-reduced-motion` está activo, O si el promedio de FPS cae por debajo de 30 durante ~2 segundos seguidos. Una vez degradado, no reintenta en esa sesión (evita parpadeo).
- Q: ¿Qué granularidad tienen los anuncios `aria-live`? → A: Consolidados por lote, siempre, para éxitos y errores ("7 archivos listos, 3 con error"). Nunca uno por archivo. La causa concreta de cada error queda disponible al enfocar la fila.
- Q: ¿Cómo se consolidan los sonidos cuando un lote termina de golpe? → A: No hay sonido de éxito por archivo. Suena un único sonido cuando la cola entera termina (no queda nada convirtiendo), distinto según si todo salió bien o si hubo errores.
- Q: ¿El sonido arranca silenciado o respeta la preferencia del sistema? → A: Siempre silenciado por defecto (no existe una media query estándar de "menos sonido" en navegadores). `prefers-reduced-motion` actúa como veto: silencia aunque el usuario haya activado el sonido.
- Q: ¿Qué mecanismo de persistencia y qué se guarda? → A: `localStorage`, una única clave con un objeto de preferencias de interfaz. Solo el estado del sonido. Nunca datos de archivos, nombres ni contenidos.
- Q: ¿El OCR deshabilitado es visible-pero-inerte o está ausente? → A: Visible pero inerte, rotulado con el texto exacto "OCR (próximamente)", con `aria-disabled` y sin acción al activarlo.
- Q: Conflicto de alcance con 001: ¿la cola admite lotes heterogéneos (grupos simultáneos de distintas categorías) o sigue siendo mono-formato? → A: Gana el modelo de 002: la cola admite formatos de origen mezclados, agrupados por categoría. Esto **requiere enmendar 001** (ver DEP-003), que hoy declara los lotes heterogéneos fuera de alcance.
- Q: Al levantar la restricción mono-formato, ¿qué tope protege la memoria del navegador? → A: Se conserva el tope de **10 archivos en total** en la cola, ahora de formatos mezclados. Los límites de tamaño por archivo de 001 siguen vigentes.
- Q: Si el usuario activó el sonido pero `prefers-reduced-motion` está activo, ¿suena? → A: **No suena**: la preferencia del sistema vetea. El control muestra el efecto real (silenciado) junto con el motivo, y la preferencia del usuario queda guardada para cuando desactive reduce-motion.
- Q: ¿Cuándo se ofrece "reintentar" en un error? → A: Solo ante errores **transitorios** (memoria insuficiente, fallo del motor, cancelación previa). Nunca ante errores **determinísticos** (archivo corrupto, formato no soportado, excede tamaño, PDF escaneado sin texto), donde reintentar daría el mismo resultado.
- Q: ¿Qué pasa si un sonido se dispara mientras otro suena? → A: Se **descarta** el nuevo (no se encola, no se mezcla). Evita audio que suena después de que el evento ya pasó.
- Q: ¿"No soportados" es un grupo de la cola o una lista de rechazos? → A: Una **vista agrupada de los rechazos** (`state: 'rejected'` de 001), no un grupo convertible. No tiene selector, no convierte, no cuenta para el tope de 10, y no dispara sonidos de éxito. Reconcilia 002 con el modelo de 001 sin cambiar ninguno de los dos.
- Q: MP3→MP4, ¿el usuario debe elegir portada o waveform? → A: **No**. El waveform es el **default** y la conversión nunca se bloquea. Esto **enmienda 001 FR-030**, que exigía la elección (hallazgo C1 de `/speckit-analyze`). Ejecutado el 2026-07-13; queda pendiente la tarea de código T052 en 001.
- Q: ¿El formato destino se elige por grupo o por archivo? → A: **Por archivo**. Cada fila tiene su propio selector, con los destinos válidos para su tipo detectado. Esto enmienda FR-011 (que decía "selector único para todo el grupo") y quedó reflejado en 001 §FR-023b. **DEP-003 quedó ejecutada**: 001 fue enmendada el 2026-07-13.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Los estados se entienden sin depender del color (Priority: P1)

Un usuario suelta archivos, los convierte y en todo momento entiende en qué estado está cada
uno: en cola, esperando al motor, convirtiendo (con porcentaje real), listo o fallado. Cada
estado se distingue por color **y además** por ícono/forma **y** por texto, de modo que un
usuario daltónico, uno que ve en escala de grises y uno con lector de pantalla obtienen la
misma información. Cada estado ofrece la acción que le corresponde: quitar, cancelar,
descargar, reintentar.

**Why this priority**: es el corazón de la feature y el único bloque que, por sí solo, ya
mejora el producto de forma verificable. Sin estados legibles y accionables, el fondo animado
y el sonido son decoración sobre una app confusa. Además es lo que la Constitución exige de
forma no negociable (Principio XII).

**Independent Test**: se prueba completo sin shader ni sonido: cargar archivos, convertir, y
verificar que los cinco estados (`pending`, `converting`, `done`, `error`, `prep`) son
distinguibles en escala de grises, alcanzables por teclado, anunciados por lector de pantalla,
y que cada uno expone su acción correcta.

**Acceptance Scenarios**:

1. **Given** un archivo recién agregado, **When** se observa su fila en la cola, **Then**
   muestra estado `pending` con ícono propio, texto propio y acción "Quitar".
2. **Given** un archivo convirtiéndose, **When** el progreso avanza, **Then** muestra
   `converting` con porcentaje numérico real y barra determinística, y ofrece "Cancelar".
3. **Given** la primera conversión de audio/video de la sesión, **When** el motor todavía se
   está cargando, **Then** el archivo muestra el estado `prep` ("esperando al conversor…"),
   visualmente distinto de `converting` y sin porcentaje falso.
4. **Given** una conversión terminada, **When** se observa la fila, **Then** muestra `done`
   con acción "Descargar"; tras descargar queda marcada como ya-descargada, sin perder la
   posibilidad de volver a descargarla.
5. **Given** una conversión fallida, **When** se observa la fila, **Then** muestra `error`
   con la causa concreta (nunca un mensaje genérico) y una acción de salida (quitar o
   reintentar, según el caso).
6. **Given** la interfaz vista en escala de grises, **When** se comparan los cinco estados,
   **Then** cada uno es identificable sin ambigüedad por su ícono y su texto.
7. **Given** una conversión en curso, **When** el usuario navega solo con Tab, **Then**
   alcanza el control "Cancelar" de esa fila con foco visible.
8. **Given** un lote que termina, **When** todos los archivos alcanzaron `done` o `error`,
   **Then** se emite **un** anuncio consolidado para lectores de pantalla ("7 archivos listos,
   3 con error"), y no uno por archivo.
9. **Given** una fila en estado `error`, **When** recibe el foco, **Then** el lector de
   pantalla lee la causa concreta de ese fallo.

---

### User Story 2 - Todos los estados de borde son visibles y accionables (Priority: P1)

Un usuario que carga archivos problemáticos (PDF con contraseña, archivo demasiado pesado,
formato no soportado, PDF escaneado sin texto, video sin pista de audio, DOCX↔PDF de
fidelidad parcial) entiende **antes de convertir** qué va a pasar y qué puede hacer. Nunca
descubre la limitación después de haber esperado.

**Why this priority**: es el Principio XV (honestidad de la interfaz) hecho pantalla, y la
diferencia entre una app que se siente confiable y una que se siente rota. Comparte P1 con la
historia 1 porque ambas son requisitos constitucionales no negociables, y porque los estados
de borde son justamente donde una app client-side pierde la confianza del usuario.

**Independent Test**: cargar uno a uno los seis archivos problemáticos y verificar que cada
uno produce su aviso específico, con sus acciones, **antes** de que exista la posibilidad de
convertirlo.

**Acceptance Scenarios**:

1. **Given** un PDF protegido con contraseña, **When** se agrega a la cola, **Then** la fila
   ofrece un campo de contraseña con la nota de que se usa solo localmente, y las acciones
   "Desbloquear" y "Quitar".
2. **Given** un archivo que excede el tamaño máximo de su conversión, **When** se agrega,
   **Then** se rechaza ANTES de convertir, mostrando el peso real del archivo y el máximo
   permitido para esa conversión.
3. **Given** un archivo de formato no soportado, **When** se agrega, **Then** cae en el grupo
   "No soportados" con un mensaje que enumera qué formatos sí se aceptan, y la acción
   "Quitar".
4. **Given** un PDF escaneado sin capa de texto, **When** se elige destino DOCX o TXT,
   **Then** se avisa que no se puede extraer texto, y aparece el control **"OCR
   (próximamente)"**, visible pero inerte: no ejecuta nada al activarlo y se anuncia como
   deshabilitado a los lectores de pantalla.
5. **Given** un video sin pista de audio, **When** se elige destino MP3, **Then** se avisa
   que no hay audio que extraer y se ofrece como alternativa convertir el video a otro
   formato de video.
6. **Given** un grupo de documentos con una conversión DOCX↔PDF elegida, **When** se observa
   el grupo antes de convertir, **Then** muestra el aviso de fidelidad parcial ("el formato
   puede variar levemente").
7. **Given** un grupo con conversión MP3→MP4 elegida, **When** el usuario no eligió ninguna
   imagen, **Then** el grupo muestra que se usará un waveform generado automáticamente, ofrece
   reemplazarlo por una imagen propia, y el botón "Convertir" permanece **habilitado**.

---

### User Story 3 - Identidad visual: fondo animado reactivo (Priority: P2)

Un usuario abre la app y encuentra un tema oscuro con un fondo que respira despacio. Al
arrastrar archivos, el fondo se enciende al máximo; al pasar el cursor sobre la zona de carga,
reacciona a media intensidad y el brillo sigue al puntero; durante una conversión, la actividad
del fondo acompaña al progreso. Nada de esto interfiere con la lectura del contenido ni con la
interacción.

**Why this priority**: es la identidad del producto y lo que lo vuelve memorable como pieza de
portfolio, pero es puramente aditivo: la app es plenamente utilizable sin él, y de hecho DEBE
serlo por el requisito de degradación. Va después de los dos bloques no negociables.

**Independent Test**: se prueba aislado verificando los cinco modos de reacción (reposo,
drag-over, hover, seguimiento del cursor, conversión activa), la degradación sin WebGL y la
legibilidad del texto por encima del fondo.

**Acceptance Scenarios**:

1. **Given** la app en reposo, **When** no hay interacción, **Then** el fondo se mueve con
   intensidad baja y movimiento lento.
2. **Given** el usuario arrastrando archivos sobre la ventana, **When** entra en drag-over,
   **Then** el fondo sube a intensidad máxima, y vuelve a su estado previo al soltar o al
   salir.
3. **Given** el cursor sobre el área principal, **When** se mueve, **Then** el punto de brillo
   del fondo lo sigue.
4. **Given** una conversión activa, **When** el progreso avanza, **Then** la intensidad del
   fondo está ligada a esa actividad.
5. **Given** un navegador o equipo sin WebGL disponible, **When** carga la app, **Then** se
   muestra un fondo estático equivalente (gradiente o color sólido), sin ningún error visible
   y sin pérdida de funcionalidad.
6. **Given** el contexto WebGL perdido en caliente, **When** ocurre, **Then** la app cae al
   fondo estático sin romperse ni mostrar errores.
7. **Given** `prefers-reduced-motion: reduce`, **When** carga la app, **Then** el fondo queda
   casi estático o desactivado.
8. **Given** la pestaña oculta, **When** el usuario cambia de pestaña, **Then** la animación
   se detiene, y se reanuda al volver.
9. **Given** cualquier fotograma de la animación, **When** se mide el contraste del texto
   sobre el fondo, **Then** cumple WCAG AA en el **peor** fotograma, no solo en promedio.

---

### User Story 4 - Sonido opcional, sutil y complementario (Priority: P3)

Un usuario que lo desea activa el sonido y recibe confirmaciones cortas y reconocibles al
soltar archivos, al terminar una conversión con éxito y al ocurrir un error. Quien no lo desea
(la mayoría, por defecto) no oye nada nunca. El sonido jamás es la única forma de enterarse de
algo.

**Why this priority**: es el toque de personalidad más prescindible y el más riesgoso si se
hace mal (ruidoso, invasivo). Depende además de que los equivalentes visuales de las historias
1 y 2 ya existan, porque el sonido solo puede ser *redundante* respecto de algo que ya se ve.

**Independent Test**: con el sonido activado, disparar los tres momentos sonoros (drop, rechazo
al agregar, fin de cola) y verificar que suenan distinto, que cada uno tiene equivalente visual,
que una cola llena (10 archivos) produce **un** sonido y no 10, y que con el sonido silenciado o bajo
reduce-motion la app funciona idéntica pero muda.

**Acceptance Scenarios**:

1. **Given** un usuario que nunca tocó la preferencia, **When** abre la app por primera vez y
   opera, **Then** no se reproduce ningún sonido (silencio por defecto).
2. **Given** el control de sonido visible, **When** el usuario lo activa, **Then** los eventos
   posteriores suenan, y la preferencia sobrevive a recargar la página.
3. **Given** el sonido activado, **When** se sueltan archivos, se rechaza un archivo al
   agregarlo y termina la cola, **Then** cada uno de esos tres momentos reproduce un sonido
   distinto y reconocible.
4. **Given** el sonido activado y una cola de 10 archivos, **When** los archivos van
   terminando uno a uno, **Then** **no** suena nada por archivo; suena **un solo** sonido
   cuando la cola entera termina.
5. **Given** una cola que terminó con al menos un error, **When** finaliza, **Then** el sonido
   de fin de cola es la variante "terminó con errores", distinguible de la de éxito total.
6. **Given** el sonido activado, **When** se sueltan 10 archivos de una vez, **Then** el sonido
   de drop suena **una** vez (es por gesto, no por archivo).
7. **Given** el sonido activado y `prefers-reduced-motion` activo, **When** el usuario observa
   el control de sonido, **Then** este muestra "silenciado" con el motivo visible, y la
   preferencia guardada permanece intacta.
8. **Given** `prefers-reduced-motion: reduce`, **When** ocurren eventos sonoros, **Then** no
   suena nada, aunque la preferencia de sonido esté activada.
9. **Given** un navegador sin Web Audio, o con el audio bloqueado hasta la primera
   interacción, **When** el usuario opera, **Then** la app funciona muda y sin errores; el
   primer gesto del usuario habilita el audio si la preferencia lo permitía.
10. **Given** el grupo "No soportados", **When** se opera sobre él, **Then** no dispara ningún
    sonido de éxito.
11. **Given** cualquier evento sonoro, **When** se reproduce, **Then** existe un cambio visual
    simultáneo que transmite la misma información.
12. **Given** una preferencia de sonido corrupta o ilegible en el almacenamiento local,
    **When** carga la app, **Then** cae al valor por defecto (silenciado) sin mostrar error.
13. **Given** un sonido reproduciéndose, **When** se dispara otro evento sonoro, **Then** el
    nuevo se descarta: nunca se solapan ni se suman.

---

### Edge Cases

- **Sin WebGL / contexto perdido**: fondo estático equivalente, cero errores visibles, cero
  pérdida de funcionalidad. La pérdida de contexto en caliente degrada, no rompe.
- **Equipo lento**: si el promedio de FPS cae por debajo de 30 durante 2 segundos seguidos, el
  fondo se congela a estático y no se reintenta la animación en esa sesión (evita el parpadeo
  de entrar y salir del modo animado).
- **Sin Web Audio / audio bloqueado por política del navegador**: la app funciona muda; el
  primer gesto del usuario habilita el audio si la preferencia estaba activada. Nunca se
  muestra un error por no poder sonar.
- **`prefers-reduced-motion` activo**: fondo casi estático o desactivado **y** sin sonidos,
  aunque el sonido esté habilitado.
- **Lote que termina de golpe**: no existe sonido de éxito por archivo, así que no hay
  avalancha posible. Suena un único sonido cuando la cola entera termina, en su variante
  "todo bien" o "con errores". Dos sonidos nunca se solapan a volumen sumado.
- **Cola que nunca termina (todo cancelado)**: si el usuario cancela todo y no queda nada
  convirtiendo, el fin de cola no dispara el sonido de éxito; la cancelación no es un logro.
- **Preferencia corrupta en el almacenamiento local**: se cae al valor por defecto (silenciado)
  sin error visible.
- **Grupo "No soportados"**: no ofrece selector de formato, no ofrece convertir, no dispara
  sonidos de éxito.
- **Foco de teclado durante conversión**: la fila en `converting` y su acción "Cancelar" son
  alcanzables por Tab con foco visible; los cambios de estado no roban el foco ni lo dejan
  huérfano cuando una fila desaparece.
- **Cola llena**: al soltar más archivos de los que caben (tope de 10 en total), los excedentes
  se rechazan ANTES de agregarse, con un mensaje que dice cuántos entraron y cuál es el tope.
  Los que sí entraron quedan en la cola: soltar de más no cancela la operación entera.
- **Carpeta con tipos mezclados**: los archivos se reparten en los grupos de su categoría (ya no
  se rechazan por diferir del formato del primero, ver DEP-003), respetando el tope de 10.
- **Error determinístico vs transitorio**: un archivo corrupto o de formato no soportado ofrece
  solo "Quitar"; uno que falló por memoria o por el motor ofrece además "Reintentar".
- **Descarga repetida**: un archivo ya descargado sigue siendo descargable; la marca de
  ya-descargado es informativa, no un bloqueo.

## Requirements *(mandatory)*

### Functional Requirements

**Identidad visual y fondo animado**

- **FR-001**: La app MUST presentar un tema oscuro con base `#0b0c11` y acentos
  cálidos/violáceos, coherente con el mockup versionado en el repositorio (ver DEP-001). Si un
  color del mockup no cumple el contraste de FR-040, prevalece la accesibilidad.
- **FR-002**: La app MUST mostrar un fondo animado que reaccione a la actividad con al menos
  estos modos: reposo (intensidad baja, movimiento lento), drag-over (intensidad máxima),
  hover sobre zonas activas (intensidad intermedia) y conversión activa (intensidad ligada al
  progreso o a la actividad).
- **FR-003**: El punto de foco del brillo del fondo MUST seguir al cursor mientras este se
  mueve sobre el área principal.
- **FR-004**: La app MUST degradar el fondo a estático (gradiente o color sólido equivalente),
  sin error visible y sin pérdida de funcionalidad, cuando se cumpla **cualquiera** de estas
  condiciones: (a) no hay WebGL disponible, (b) el contexto WebGL se pierde en caliente,
  (c) `prefers-reduced-motion: reduce` está activo, o (d) el promedio de FPS de la animación
  cae por debajo de **30 durante 2 segundos seguidos**.
- **FR-004b**: Una vez degradado el fondo por bajo rendimiento, el sistema MUST NOT reintentar
  la animación durante esa sesión, para evitar el parpadeo de entrar y salir del modo animado.
- **FR-005**: El fondo animado MUST detenerse cuando la pestaña no está visible, y MUST
  reanudarse al volver (salvo que ya se haya degradado por FR-004).
- **FR-006**: El fondo MUST NOT bloquear ni degradar la interacción; la app MUST permanecer
  fluida durante las conversiones.
- **FR-007**: Todo texto y control MUST permanecer legible por encima del fondo en cualquier
  fotograma de la animación.

**Estructura de pantalla**

- **FR-008**: La pantalla MUST incluir un header con el nombre/logo y un sello de privacidad
  visible ("Tus archivos nunca salen del navegador").
- **FR-009**: La zona de carga (dropzone) MUST ser el elemento protagonista cuando la cola
  está vacía, y MUST colapsar a una tira fina cuando hay archivos.
- **FR-010**: La cola MUST admitir archivos de **formatos de origen mezclados** y agruparlos por
  categoría (imagen, documento, video, audio, no soportados), respetando el origen por carpeta
  cuando el usuario cargó carpetas. Un archivo MUST NOT rechazarse por diferir del formato de
  otro archivo de la cola. (Esto amplía el alcance de 001; ver DEP-003.)
- **FR-010b**: La cola MUST aceptar un máximo de **10 archivos en total**, contando todas las
  categorías juntas. Al intentar superarlo, el sistema MUST rechazar los excedentes ANTES de
  agregarlos, indicando el tope y cuántos entraron. Los límites de tamaño por archivo definidos
  en 001 siguen vigentes y son independientes de este tope.
- **FR-011** *(enmendado 2026-07-13)*: Cada grupo MUST mostrar su nombre, la cantidad de
  archivos y las filas de sus archivos. El formato destino MUST elegirse **por archivo**, no
  por grupo: cada fila expone su propio selector, poblado únicamente con los destinos que el
  registry declara válidos para el tipo detectado de ese archivo (001 §FR-023b).
- **FR-011b** *(nuevo 2026-07-13)*: Las filas sin formato destino elegido MUST señalarse de
  forma visible y no-cromática, y MUST NOT bloquear la conversión del resto de la cola
  (001 §FR-023c).
- **FR-012** *(aclarado 2026-07-13)*: El grupo "No soportados" **no es un grupo de la cola**:
  es una **vista agrupada de los archivos rechazados**. 001 marca esas entradas con estado
  `rejected` y nunca entran a la cola convertible; 002 simplemente las **agrupa visualmente**
  en lugar de listarlas sueltas. En consecuencia, el grupo MUST NOT ofrecer selector de
  formato ni acción de convertir, MUST NOT contar para el tope de 10 archivos convertibles, y
  MUST NOT disparar sonidos de éxito (FR-036). Cada entrada muestra su motivo de rechazo
  concreto y la acción "Quitar".
- **FR-013**: La barra de descarga en ZIP MUST ser visible cuando haya 2 o más archivos listos.
- **FR-014**: Los formatos destino ofrecidos en cada grupo MUST derivarse del registry de
  conversiones de 001; la capa de experiencia MUST NOT duplicar ni redefinir la matriz de
  conversiones.

**Estados de archivo**

- **FR-015**: El sistema MUST representar los cinco estados (`pending`, `converting`, `done`,
  `error`, `prep`) con **color + ícono/forma + texto**, de modo que cada estado sea
  distinguible sin percibir el color.
- **FR-016**: El estado `pending` MUST ofrecer la acción "Quitar".
- **FR-017**: El estado `converting` MUST mostrar un porcentaje real y una barra
  determinística, y ofrecer la acción "Cancelar".
- **FR-018**: El estado `done` MUST ofrecer la acción "Descargar" y MUST marcar visualmente
  los archivos ya descargados, sin impedir volver a descargarlos.
- **FR-019**: El estado `error` MUST mostrar la causa concreta del fallo (nunca un mensaje
  genérico) y una acción de salida.
- **FR-019b**: La acción **"Reintentar"** MUST ofrecerse únicamente ante errores **transitorios**,
  es decir aquellos que pueden resolverse repitiendo la operación: memoria insuficiente, fallo
  del motor de conversión, o una cancelación previa del usuario.
- **FR-019c**: La acción "Reintentar" MUST NOT ofrecerse ante errores **determinísticos**, donde
  repetir daría exactamente el mismo resultado: archivo corrupto, formato no soportado, tamaño
  excedido, o PDF escaneado sin capa de texto. En esos casos la única salida es "Quitar".
  Ofrecer un reintento condenado al mismo error violaría la honestidad de la interfaz.
- **FR-020**: El estado `prep` (motor cargando) MUST ser visualmente distinto de `converting`,
  mostrar el texto "esperando al conversor…" y su propio indicador, y MUST NOT mostrar un
  porcentaje de progreso falso.

**Estados de borde**

- **FR-021**: Ante un PDF protegido con contraseña, el sistema MUST ofrecer un campo para
  ingresarla, con la nota de que se usa solo localmente, y las acciones "Desbloquear" y
  "Quitar".
- **FR-022**: Ante un archivo que excede el tamaño máximo de su conversión, el sistema MUST
  rechazarlo ANTES de convertir, mostrando el peso del archivo y el máximo permitido para esa
  conversión.
- **FR-023**: Ante un formato no soportado, el sistema MUST explicar qué formatos sí se
  aceptan y ofrecer la acción "Quitar".
- **FR-024**: Ante un PDF escaneado sin capa de texto con destino DOCX o TXT, el sistema MUST
  avisar que no se puede extraer texto, y MUST mostrar la acción de OCR **visible pero
  inerte**: rotulada con el texto exacto **"OCR (próximamente)"**, marcada como deshabilitada
  para tecnologías asistivas (`aria-disabled`), y sin ejecutar ninguna acción al activarla. La
  acción MUST NOT estar ausente (el usuario debe enterarse de que la función existirá) ni
  MUST NOT parecer activa.
- **FR-025**: Ante un video sin pista de audio con destino MP3, el sistema MUST avisar que no
  hay audio que extraer y MUST ofrecer como alternativa convertir el video a otro formato de
  video.
- **FR-026**: Ante una conversión DOCX↔PDF, el sistema MUST mostrar el aviso de fidelidad
  parcial ("el formato puede variar levemente") en el grupo de documentos **antes** de
  convertir.
- **FR-027**: Toda limitación conocida MUST comunicarse antes de iniciar la conversión, nunca
  como error posterior.

**Input previo requerido**

- **FR-028**: Ante una conversión MP3→MP4, el sistema MUST generar automáticamente un waveform
  como imagen de fondo por defecto, de modo que la conversión siempre tenga un resultado válido
  sin intervención del usuario.
- **FR-028b**: El usuario MUST poder reemplazar ese waveform por una imagen de portada propia,
  y MUST poder volver al waveform si cambia de idea. La interfaz MUST mostrar cuál de las dos
  opciones está activa.
- **FR-028c**: La conversión MP3→MP4 MUST NOT bloquear el botón "Convertir" en ningún momento,
  ni para su grupo ni para la cola: al haber siempre un waveform por defecto, no existe un
  estado de "falta un insumo".

**Sonido**

- **FR-029**: Con el sonido habilitado, el sistema MUST reproducir un sonido distinto y
  reconocible para exactamente estos tres momentos, y ninguno más entre los obligatorios:
  - **(a) Drop**: un sonido por **gesto de soltar**, no por archivo. Soltar 10 archivos suena
    una vez.
  - **(b) Rechazo al agregar**: si el gesto de soltar produjo archivos rechazados (no
    soportados, vacíos, o que exceden el tamaño), suena **un** sonido de error por gesto,
    independientemente de cuántos archivos se rechazaron.
  - **(c) Fin de cola**: un único sonido cuando la cola **termina por completo** (no queda
    ningún archivo en `converting` ni en `prep`), con dos variantes distinguibles: "terminó
    todo bien" y "terminó con errores".

  Los assets concretos los aporta el propietario (ver DEP-002); esta spec fija los eventos, no
  los archivos.
- **FR-029b**: El sistema MUST NOT reproducir un sonido de éxito por cada archivo que termina.
  El progreso archivo por archivo se comunica **solo visualmente** (barra y estado en la fila).
- **FR-030**: El sistema MAY reproducir sonidos adicionales sutiles para hover/entrada en el
  dropzone, descarga y generación de ZIP. MUST NOT agregar sonidos por archivo individual.
- **FR-031**: El sonido MUST estar **silenciado por defecto** en la primera visita, sin
  excepción: la app MUST NOT intentar inferir una preferencia de sonido del sistema (no existe
  hoy una señal estándar y confiable para ello). El usuario MUST poder activarlo o silenciarlo
  con un control visible y alcanzable por teclado, cuyo estado (activado/silenciado) sea
  evidente sin depender del color.
- **FR-032**: La preferencia de sonido MUST persistir entre sesiones en `localStorage`, bajo
  una **única clave** que contenga un objeto de preferencias de interfaz. El contenido
  persistido MUST limitarse al estado del sonido. MUST NOT persistirse ningún dato de archivos:
  ni contenidos, ni nombres, ni tamaños, ni historial de conversiones.
- **FR-032b**: Si el valor almacenado está ausente, corrupto o es ilegible, el sistema MUST
  caer al valor por defecto (silenciado) sin mostrar ningún error.
- **FR-033**: Todo evento sonoro MUST tener un equivalente visual simultáneo. Ningún estado ni
  resultado MUST existir únicamente en el canal de audio.
- **FR-034**: Bajo `prefers-reduced-motion: reduce`, el sistema MUST NOT reproducir sonidos,
  aunque la preferencia de sonido esté activada. La preferencia del sistema **vetea** a la del
  usuario (Principio XIII).
- **FR-034b**: Cuando el veto de FR-034 esté activo, el control de sonido MUST mostrar su
  **efecto real** (silenciado), no la preferencia guardada, y MUST explicar el motivo de forma
  visible (por ejemplo: "silenciado por tu preferencia de menos movimiento"). MUST NOT
  presentarse como "activado" mientras no suena nada.
- **FR-034c**: La preferencia del usuario MUST conservarse intacta en el almacenamiento local
  aunque esté vetada, de modo que el sonido vuelva a funcionar si el usuario desactiva
  `prefers-reduced-motion` en su sistema, sin tener que volver a activarlo a mano.
- **FR-035**: Los sonidos MUST ser cortos y de volumen moderado. Por construcción de FR-029 no
  puede haber una avalancha de sonidos de éxito (solo suena el fin de cola), pero el sistema
  MUST además garantizar que dos sonidos nunca se solapen: si un sonido se dispara mientras otro
  está sonando, el nuevo se **descarta**. MUST NOT encolarse (sonaría después de que el evento
  ya pasó) ni mezclarse a volumen sumado.
- **FR-036**: El grupo "No soportados" MUST NOT disparar sonidos de éxito.
- **FR-037**: Los assets de audio MUST ser locales y estar precargados; MUST NOT haber ninguna
  petición de red en runtime para reproducir un sonido.
- **FR-038**: El sistema MUST exponer una interfaz de sonido única (del tipo
  `playSound(evento)`) desacoplada de la librería concreta de audio, de modo que cambiarla no
  obligue a tocar el resto de la app.
- **FR-039**: Si el navegador no soporta audio o lo bloquea hasta la primera interacción del
  usuario, la app MUST funcionar muda y sin errores, habilitando el audio en el primer gesto
  del usuario si la preferencia lo permitía.

**Accesibilidad**

- **FR-040**: Todo texto y componente de UI MUST cumplir el contraste WCAG 2.1 AA: 4.5:1 texto
  normal, 3:1 texto grande y componentes/elementos gráficos informativos.
- **FR-041**: Todo control operable con mouse MUST ser operable con teclado, en un orden de
  tabulación lógico y con foco visible que cumpla el contraste 3:1.
- **FR-042**: Los controles MUST tener roles y etiquetas accesibles; los íconos que transmiten
  información MUST tener alternativa textual.
- **FR-043**: Los cambios de estado MUST anunciarse a lectores de pantalla mediante una región
  `aria-live` **cortés** (no asertiva), con anuncios **siempre consolidados por lote**, tanto
  para éxitos como para errores. Ejemplo: "7 archivos listos, 3 con error". El sistema MUST
  NOT emitir un anuncio por cada archivo que cambia de estado.
- **FR-043b**: Como el anuncio consolidado no nombra los archivos fallados, cada fila en estado
  `error` MUST exponer su causa concreta como texto accesible al recibir el foco, de modo que
  un usuario de lector de pantalla pueda recorrer la cola y averiguar qué falló y por qué sin
  depender del anuncio.
- **FR-043c**: El inicio de una conversión y la aparición del estado `prep` MUST anunciarse una
  sola vez por lote (por ejemplo "convirtiendo 10 archivos", "esperando al conversor"), nunca
  por archivo.
- **FR-044**: Ningún estado ni resultado MUST comunicarse únicamente por color.

**Privacidad y preferencias**

- **FR-045**: La app MUST NOT realizar ninguna petición de red en runtime para fuentes, audio
  ni shaders; todos esos assets MUST ser locales. MUST NOT haber telemetría de ningún tipo.
- **FR-046**: El almacenamiento local MUST contener exclusivamente preferencias de interfaz
  (sonido on/off), nunca datos de archivos.

### Key Entities

- **Preferencias de interfaz**: un único objeto en `localStorage` bajo una única clave, con el
  estado del sonido (activado/silenciado) como su único contenido. No contiene datos de
  archivos. Ante un valor ausente o corrupto, se cae al default (silenciado).
- **Evento sonoro**: un nombre semántico al que la capa de sonido asocia un asset. Los
  obligatorios son exactamente tres: `drop` (por gesto), `rechazo` (por gesto), y
  `fin-de-cola` con dos variantes (`todo-ok` y `con-errores`). Los opcionales: hover en el
  dropzone, descarga y zip. Todo evento tiene un equivalente visual obligatorio, y **no existe
  ningún evento sonoro por archivo individual**.
- **Estado visual de archivo**: la representación de los cinco estados de 001 como una terna
  (color, ícono/forma, texto) más el conjunto de acciones disponibles.
- **Grupo de la cola**: una categoría (imagen, documento, video, audio, no soportados) con su
  nombre, cantidad, formato destino único y avisos previos aplicables. Varios grupos coexisten
  en la cola (formatos de origen mezclados), sujetos a un tope global de 10 archivos.
- **Clase de error**: cada error es **transitorio** (reintentable: memoria, motor, cancelación)
  o **determinístico** (no reintentable: corrupto, no soportado, tamaño excedido, PDF escaneado).
  La clase determina qué acciones de salida ofrece la fila.
- **Estado de actividad del fondo**: el nivel de intensidad derivado de la interacción (reposo,
  hover, drag-over, conversión) y la posición del foco de brillo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Los cinco estados de archivo son identificables sin ambigüedad viendo la
  interfaz en escala de grises, verificado sobre los cinco.
- **SC-002**: El 100% del texto y de los componentes de UI cumple el contraste WCAG AA (4.5:1
  texto normal, 3:1 texto grande y componentes), medido también contra el fotograma más claro
  del fondo animado.
- **SC-003**: Un usuario completa el flujo entero (cargar, elegir formato, convertir, cancelar,
  descargar) usando solo el teclado, con foco visible en cada paso.
- **SC-004**: Cada uno de los seis estados de borde produce su aviso específico **antes** de
  que la conversión pueda iniciarse, verificado con un archivo real por caso.
- **SC-005**: La app permanece interactiva, sin bloqueos perceptibles, mientras el fondo
  animado corre y hay conversiones en curso.
- **SC-006**: Sin aceleración por hardware disponible, o con el fondo degradado por bajo
  rendimiento (FPS < 30 durante 2s), la app conserva el 100% de su funcionalidad y no muestra
  ningún error al usuario.
- **SC-006b**: Una conversión MP3→MP4 se completa sin que el usuario aporte ninguna imagen: el
  waveform automático garantiza que "Convertir" nunca queda bloqueado.
- **SC-007**: Un usuario nuevo no oye ningún sonido hasta que lo habilita explícitamente, y la
  preferencia sobrevive a recargar la página.
- **SC-008**: Una cola llena (10 archivos) produce exactamente 1 sonido (el de fin de cola), no
  10: ningún archivo individual suena al terminar.
- **SC-008b**: Una cola llena (10 archivos) produce exactamente 1 anuncio de lector de pantalla
  al terminar, no 10, y ese anuncio informa cuántos quedaron listos y cuántos con error.
- **SC-008c**: La causa concreta de cada error es alcanzable con el teclado y legible por un
  lector de pantalla, recorriendo las filas de la cola.
- **SC-009**: Con `prefers-reduced-motion` activo no se reproduce ningún sonido y el fondo no
  anima, conservando el 100% de la funcionalidad.
- **SC-010**: Cero peticiones de red en runtime más allá de la carga inicial de la propia app y
  sus assets, verificable en el panel de red del navegador durante un flujo completo.
- **SC-011**: Cada evento sonoro tiene un equivalente visual verificable: con el sonido
  silenciado, no se pierde ninguna información.

## Assumptions

- **Silencio por defecto** (decidido, ver Clarifications): no existe hoy una preferencia de
  sistema estándar y confiable para "menos sonido" en los navegadores, a diferencia de
  `prefers-reduced-motion`. Por eso la disyuntiva del Principio XIII ("desactivado por defecto
  **o** respeta la preferencia del sistema") se resuelve eligiendo **desactivado por defecto**,
  con `prefers-reduced-motion` como veto adicional que silencia aunque el usuario haya activado
  el sonido.
- **Reduce-motion sin override** (decidido): se respeta la preferencia del sistema y no se
  ofrece un override en la interfaz, para no multiplicar controles. En consecuencia, la única
  preferencia persistida es el estado del sonido (FR-032).
- **Tema único**: solo el tema oscuro. No hay conmutador claro/oscuro.
- **Categorías y formatos destino** salen del registry de 001; esta feature no los define ni
  los altera.
- **Los límites de tamaño y los mensajes de error concretos** provienen de los conversores de
  001; esta capa los muestra, no los inventa.
- **Los cinco estados** ya existen como concepto en 001; esta feature les da forma visual,
  sonora y accesible.
- **El OCR permanece fuera de alcance** (diferido desde 001): solo se muestra deshabilitado y
  rotulado "próximamente".
- **Navegadores**: versiones actuales de Chrome, Firefox, Edge y Safari, con degradación
  elegante sin WebGL y sin Web Audio.

## Dependencias externas (prerrequisitos del propietario)

Dos insumos que esta spec da por existentes **todavía no están versionados en el repositorio**.
Ambos serán aportados por el propietario del proyecto. Son prerrequisitos bloqueantes de las
historias que dependen de ellos; el resto de la feature puede avanzar sin ellos.

- **DEP-001 — Mockup de identidad visual** (bloquea FR-001, y por lo tanto la Historia 3):
  el propietario versionará el mockup en el repositorio, y ese archivo pasa a ser la fuente de
  verdad de la identidad visual (paleta exacta, tipografía, espaciado, tratamiento del fondo).
  Hasta que exista, los únicos valores firmes son la base `#0b0c11` y los acentos
  cálidos/violáceos. La paleta final DEBE validarse contra el contraste AA de FR-040 antes de
  adoptarse: si un color del mockup no cumple, gana la accesibilidad (Principio XII).
- **DEP-003 — Enmienda a la spec 001: ✅ EJECUTADA (2026-07-13)**: 001 declaraba los lotes
  heterogéneos fuera de alcance y rechazaba todo archivo cuyo formato difiriera del primero.
  Fue enmendada: su FR-023 ahora admite hasta 10 archivos de **formatos mezclados**, y sus
  nuevos FR-023b/FR-023c establecen **un formato destino por archivo** (no por lote ni por
  grupo). Ver `specs/001-convertitodo/spec.md` §Enmiendas.

  **Pendiente**: la enmienda al **código y los tests** de 001 está especificada en las tareas
  **T047–T051** de `specs/001-convertitodo/tasks.md`, pero **todavía no implementada**. Hasta
  ejecutarlas, `src/lib/directory-input.ts` sigue rechazando archivos de formato distinto, y la
  UI de esta feature no tendrá lotes mixtos sobre los que operar.

- **DEP-002 — Assets de audio** (bloquea FR-029/FR-037, y por lo tanto la Historia 4): el
  propietario aportará los archivos de sonido y los versionará localmente en el repositorio.
  Esta spec define únicamente los **eventos semánticos** (los tres obligatorios: `drop`,
  `rechazo`, `fin-de-cola` en sus variantes `todo-ok` y `con-errores`; más los opcionales hover
  / descarga / zip); el mapeo evento → archivo se resuelve cuando los assets existan. Se
  necesitan por lo tanto **al menos 4 sonidos distinguibles**. Requisitos que deben cumplir:
  cortos, volumen moderado, licencia apta para publicar el proyecto, y servidos localmente sin
  CDN en runtime (Principio XVI).

## Fuera de alcance

- OCR real (solo se muestra deshabilitado y rotulado "próximamente").
- Cualquier cambio a la matriz de conversiones, a los conversores o a la lógica de 001.
- Temas claro/oscuro conmutables (solo el tema oscuro).
- Sonidos generados proceduralmente; se usan assets pregrabados locales.
- Backend, cuentas de usuario, sincronización de preferencias entre dispositivos.
