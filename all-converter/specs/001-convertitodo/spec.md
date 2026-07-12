# Feature Specification: ConvertiTodo — Convertidor de archivos 100% en el navegador

**Feature Branch**: `001-convertitodo`

**Created**: 2026-07-12

**Status**: Draft

**Input**: User description: "Desarrollar ConvertiTodo, una aplicación web que permite convertir archivos entre formatos directamente en el navegador, sin subir nada a ningún servidor. El usuario arrastra uno o más archivos (o una carpeta), la app detecta el tipo de cada archivo y le ofrece las conversiones disponibles. El usuario elige el formato destino, convierte y descarga el resultado. Si son varios archivos, descarga un ZIP."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Convertir un archivo individual (Priority: P1)

Una persona tiene una imagen en un formato que no le sirve (por ejemplo, un WebP que
un formulario no acepta). Abre ConvertiTodo, arrastra el archivo (o lo elige con el
selector), la app detecta que es una imagen y le muestra los formatos destino
disponibles (PNG, JPG, WebP), con opciones de compresión y redimensionado. Elige el
formato, convierte y descarga el resultado. Todo ocurre en su navegador; el archivo
nunca sale de su máquina.

**Why this priority**: es el flujo central del producto (soltar → elegir → descargar)
y la conversión de imágenes es la más liviana de implementar y la de uso más
frecuente. Con solo esta historia ya existe un producto usable y demostrable.

**Independent Test**: se puede probar de punta a punta arrastrando un PNG real,
eligiendo JPG y verificando que el archivo descargado abre correctamente y conserva el
contenido visual. No depende de ninguna otra historia.

**Acceptance Scenarios**:

1. **Given** la app cargada, **When** el usuario arrastra un archivo PNG válido,
   **Then** el archivo aparece en la cola con nombre, tamaño, tipo detectado
   ("Imagen PNG") y estado "listo", y se ofrecen como destinos JPG y WebP.
2. **Given** un PNG en la cola, **When** el usuario elige JPG y presiona convertir,
   **Then** se muestra una barra de progreso, al finalizar se ofrece un preview del
   resultado y un botón de descarga que entrega un archivo `.jpg` válido.
3. **Given** una imagen JPG de 10MB, **When** el usuario la convierte a WebP,
   **Then** la conversión termina en menos de 3 segundos en hardware promedio y la
   interfaz permanece fluida durante todo el proceso.
4. **Given** las opciones de conversión abiertas, **When** el usuario define un ancho
   máximo de 800px y calidad 70%, **Then** el archivo resultante respeta esas
   dimensiones y pesa menos que el original.
5. **Given** un archivo de tipo no soportado (por ejemplo `.exe`), **When** el usuario
   lo arrastra, **Then** la app lo rechaza con un mensaje claro que indica el tipo
   detectado y que no hay conversiones disponibles para él.

---

### User Story 2 - Convertir planillas y documentos de oficina (Priority: P2)

Una persona recibe datos en un formato que no puede usar: una planilla XLSX que
necesita como CSV para importar en otro sistema, un CSV que quiere entregar como
planilla, o un DOCX que necesita compartir como PDF. Arrastra el archivo, la app
detecta el tipo y ofrece los destinos válidos, convierte y descarga.

**Why this priority**: las conversiones de documentos de oficina son el segundo caso
de uso más demandado y amplían el producto de "convertidor de imágenes" a
"convertidor de archivos". Dependen solo del flujo base de la historia 1.

**Independent Test**: se prueba arrastrando un XLSX real con datos, convirtiéndolo a
CSV y verificando que el CSV contiene las mismas filas y columnas. Cada par de
conversión se valida con un archivo real.

**Acceptance Scenarios**:

1. **Given** un XLSX con datos en la cola, **When** el usuario elige CSV, **Then** el
   CSV descargado contiene las mismas filas, columnas y valores visibles (las fórmulas
   se exportan por su valor calculado).
2. **Given** un XLSX en la cola, **When** el usuario elige JSON, **Then** el JSON
   descargado representa las filas como objetos usando la primera fila como claves.
3. **Given** un CSV válido, **When** el usuario elige XLSX, **Then** la planilla
   descargada abre correctamente y contiene los mismos datos.
4. **Given** un XLSX o CSV, **When** el usuario elige PDF, **Then** el PDF descargado
   muestra los datos como tabla legible.
5. **Given** un DOCX con texto, títulos y listas, **When** el usuario elige PDF,
   **Then** antes de convertir la app comunica que la fidelidad visual es parcial, y el
   PDF resultante conserva el texto y la estructura general.
6. **Given** un DOCX, **When** el usuario elige TXT o HTML, **Then** el archivo
   descargado contiene el texto del documento (y en HTML, la estructura de títulos,
   párrafos y listas).

---

### User Story 3 - Trabajar con PDFs (Priority: P3)

Una persona necesita manipular PDFs sin instalar nada ni subirlos a un servicio de
terceros: extraer las páginas como imágenes, sacar el texto, convertirlo a un
documento editable, unir varios PDFs en uno, dividir uno por rangos de páginas, rotar
páginas, o armar un PDF a partir de imágenes.

**Why this priority**: las herramientas PDF son el diferencial frente a convertidores
simples y el caso donde la promesa de privacidad pesa más (los PDFs suelen contener
información sensible). Depende del flujo base pero no de las historias 2, 4 ni 5.

**Independent Test**: se prueba con un PDF real de varias páginas: convertirlo a PNG
verifica que se genera una imagen por página; unir dos PDFs reales verifica que el
resultado tiene la suma de páginas en orden.

**Acceptance Scenarios**:

1. **Given** un PDF de 5 páginas, **When** el usuario elige PNG o JPG, **Then** se
   generan 5 imágenes (una por página) y, al ser múltiples, se descargan como un ZIP.
2. **Given** un PDF con capa de texto, **When** el usuario elige TXT, **Then** el
   archivo descargado contiene el texto extraído en orden de lectura.
3. **Given** un PDF con capa de texto, **When** el usuario elige DOCX, **Then** antes
   de convertir la app comunica que se conserva texto y estructura (títulos por tamaño
   de fuente, párrafos por espaciado) pero no diseño ni imágenes, y el DOCX resultante
   refleja esa estructura.
4. **Given** dos o más PDFs en la cola, **When** el usuario elige "unir" y define el
   orden, **Then** el PDF resultante contiene todas las páginas en el orden indicado.
5. **Given** un PDF de 10 páginas, **When** el usuario define los rangos "1-3, 7-10" y
   divide, **Then** obtiene dos PDFs con esas páginas.
6. **Given** un PDF con páginas apaisadas, **When** el usuario rota páginas
   seleccionadas 90°, **Then** el PDF descargado muestra esas páginas rotadas.
7. **Given** varias imágenes en la cola, **When** el usuario elige "imágenes a PDF" y
   reordena las imágenes, **Then** el PDF resultante tiene una página por imagen en el
   orden elegido.

---

### User Story 4 - Convertir en lote y carpetas completas (Priority: P4)

Una persona tiene una carpeta con decenas de fotos que necesita en otro formato, o
varios documentos del mismo tipo. Arrastra la carpeta completa (o selecciona varios
archivos), elige un único formato destino para todos, y la app los convierte en cola
mostrando progreso individual y global. Al terminar descarga todos los resultados como
un único ZIP.

**Why this priority**: el procesamiento por lote multiplica el valor de cada conversor
ya existente, pero requiere que las historias 1-3 provean conversores que ejecutar.

**Independent Test**: se prueba arrastrando una carpeta con 10 imágenes PNG reales,
convirtiéndolas a JPG en una sola operación y verificando que el ZIP descargado
contiene 10 JPG válidos.

**Acceptance Scenarios**:

1. **Given** una carpeta con archivos arrastrada a la app, **When** la app la procesa,
   **Then** todos los archivos soportados (incluidos los de subcarpetas) aparecen en
   la cola y los no soportados se listan como rechazados con motivo.
2. **Given** 10 imágenes del mismo tipo en la cola, **When** el usuario elige un
   formato destino y convierte, **Then** se procesan con paralelismo limitado (2-3
   simultáneas), mostrando progreso por archivo y progreso global.
3. **Given** un lote convertido con éxito, **When** el usuario descarga, **Then**
   obtiene un único ZIP con todos los resultados, con nombres únicos aunque hubiera
   archivos de origen con el mismo nombre en distintas subcarpetas.
4. **Given** un lote en proceso donde un archivo falla, **When** el lote termina,
   **Then** los archivos exitosos quedan descargables y el fallido muestra su error
   específico sin invalidar al resto.
5. **Given** un DOCX que contiene tablas, **When** el usuario elige XLSX, **Then** la
   planilla descargada contiene las tablas del documento (una hoja por tabla).

---

### User Story 5 - Convertir audio y video (Priority: P5)

Una persona quiere extraer el audio de un video MP4 como MP3, convertir entre formatos
de audio (WAV, OGG, M4A, MP3), o convertir un MP3 en un video MP4 para plataformas que
solo aceptan video, usando una imagen de portada propia o un waveform generado.

**Why this priority**: es la categoría de mayor peso técnico (motor de conversión de
~30MB que se descarga la primera vez) y la de menor frecuencia de uso relativa; se
construye sobre toda la infraestructura anterior.

**Independent Test**: se prueba con un MP4 real corto: extraer el MP3 y verificar que
reproduce el mismo audio.

**Acceptance Scenarios**:

1. **Given** la primera conversión de audio/video de la sesión, **When** el usuario la
   inicia, **Then** la app muestra un indicador de descarga del motor de conversión
   (~30MB) con progreso, antes de comenzar la conversión propiamente dicha.
2. **Given** un MP4 con pista de audio, **When** el usuario elige MP3, **Then** el MP3
   descargado contiene el audio del video.
3. **Given** un MP3 en la cola, **When** el usuario elige MP4, **Then** la app le pide
   elegir entre subir una imagen de portada o generar un waveform, y el MP4 resultante
   reproduce el audio con ese contenido visual.
4. **Given** archivos WAV, OGG o M4A, **When** el usuario elige MP3 (o la conversión
   inversa desde MP3), **Then** el archivo descargado reproduce el mismo audio en el
   formato elegido.
5. **Given** un navegador sin capacidad de procesamiento multihilo, **When** el
   usuario convierte audio/video, **Then** la conversión funciona igualmente (más
   lenta) y la app lo comunica.

---

### User Story 6 - Confiar en la privacidad y usar la app sin conexión (Priority: P6)

Una persona con archivos sensibles (contratos, fotos personales) quiere convertirlos
sin que salgan de su máquina. La app le explica de forma visible que los archivos
nunca abandonan el navegador y que puede verificarlo. Una vez cargada, la app funciona
sin conexión para las conversiones ya utilizadas.

**Why this priority**: la privacidad es la propuesta de valor central, pero el banner
explicativo y el modo offline son capas de comunicación y pulido sobre un
comportamiento que las demás historias ya deben cumplir (ningún archivo sale del
navegador desde la historia 1).

**Independent Test**: con la pestaña abierta y la red desconectada, una conversión de
imagen ya usada antes debe completarse con éxito. La sección de privacidad debe ser
visible sin scroll en la pantalla inicial.

**Acceptance Scenarios**:

1. **Given** la pantalla inicial, **When** el usuario la ve, **Then** existe un
   banner/sección visible que explica que los archivos se procesan localmente y nunca
   se suben a ningún servidor.
2. **Given** la app ya cargada y una conversión de imagen usada previamente, **When**
   el usuario pierde la conexión y convierte otra imagen, **Then** la conversión
   se completa con éxito.
3. **Given** cualquier conversión realizada, **When** se inspecciona el tráfico de red
   del navegador, **Then** no existe ninguna solicitud saliente que contenga el
   archivo del usuario ni su contenido, total o parcial.

---

### Edge Cases

- **Archivo corrupto o truncado**: un archivo cuyo contenido no puede decodificarse
  (PDF dañado, imagen truncada) debe fallar con un mensaje específico ("el archivo
  parece estar dañado o incompleto"), nunca con un error genérico ni colgando la app.
- **PDF sin capa de texto (escaneado)**: PDF→TXT y PDF→DOCX deben detectar que no se
  extrajo texto y comunicar que el PDF parece ser un escaneo sin texto seleccionable
  (OCR fuera de alcance en esta versión), en lugar de entregar un archivo vacío sin
  explicación.
- **PDF protegido con contraseña**: se rechaza antes de convertir con mensaje
  específico; el desbloqueo de PDFs queda fuera de alcance.
- **Archivo de 2GB**: se rechaza ANTES de intentar convertir, indicando el límite de
  tamaño de esa conversión y el tamaño del archivo, porque excede lo procesable en la
  memoria de una pestaña.
- **Extensión mentirosa**: un archivo `foto.png` que en realidad es JPEG se trata como
  JPEG (manda el tipo real detectado por contenido); un archivo `documento.docx` que
  no es un DOCX real se rechaza indicando el tipo detectado. La extensión solo se usa
  como fallback cuando el contenido no alcanza para identificar el tipo.
- **Carpeta con tipos mezclados**: al arrastrar una carpeta con imágenes, PDFs y
  archivos no soportados, los soportados entran a la cola agrupados por tipo y los no
  soportados se listan como rechazados con motivo; la conversión por lote a un destino
  único aplica solo a los archivos compatibles con ese destino.
- **Cancelación a mitad de conversión**: cancelar una conversión en curso detiene el
  trabajo, libera los recursos, no deja descargas parciales y devuelve el archivo al
  estado "listo" para reintentar. En un lote, cancelar detiene los trabajos en curso y
  pendientes, conservando los resultados ya completados.
- **Archivo de 0 bytes**: se rechaza con mensaje claro antes de convertir.
- **MP4 sin pista de audio**: MP4→MP3 falla con mensaje específico ("el video no
  contiene pista de audio").
- **CSV con delimitador distinto de coma o codificación no UTF-8**: la app intenta
  detectar delimitador y codificación comunes; si el resultado es ilegible, el preview
  permite detectarlo antes de descargar.
- **XLSX con múltiples hojas**: al convertir a CSV/JSON se genera un archivo por hoja
  (ZIP si resultan varios), para no perder datos silenciosamente.
- **DOCX sin tablas convertido a XLSX**: falla con mensaje específico ("el documento
  no contiene tablas").
- **Imagen con transparencia a JPG**: la transparencia se aplana sobre fondo blanco y
  la app lo comunica en las opciones de conversión.
- **Cierre o recarga de la pestaña durante una conversión**: el trabajo se pierde (no
  hay persistencia); si hay conversiones en curso, el navegador pide confirmación
  antes de cerrar.
- **Memoria insuficiente durante una conversión**: si el navegador no puede completar
  la conversión por memoria, el error se reporta como tal, con la sugerencia de
  intentar con un archivo más chico; los límites de tamaño por conversión existen
  precisamente para que esto sea excepcional.

## Requirements *(mandatory)*

### Functional Requirements

#### Ingreso de archivos y detección de tipo

- **FR-001**: El sistema MUST permitir agregar archivos por arrastrar-y-soltar y por
  selector de archivos del sistema.
- **FR-002**: El sistema MUST permitir agregar carpetas completas, incorporando los
  archivos de todas sus subcarpetas.
- **FR-003**: El sistema MUST detectar el tipo real de cada archivo inspeccionando su
  contenido (magic bytes), usando la extensión solo como fallback cuando el contenido
  no permita identificarlo.
- **FR-004**: Cuando el tipo detectado por contenido contradiga la extensión, el
  sistema MUST operar según el tipo real detectado.
- **FR-005**: El sistema MUST rechazar los archivos de tipo no soportado con un
  mensaje que indique el tipo detectado y que no hay conversiones disponibles.
- **FR-006**: El sistema MUST rechazar archivos vacíos (0 bytes) con mensaje claro.
- **FR-007**: El sistema MUST mostrar los archivos aceptados en una cola con nombre,
  tamaño, tipo detectado y estado (listo, en cola, convirtiendo, completado, error,
  cancelado, rechazado).
- **FR-008**: Cada conversión MUST definir un tamaño máximo de archivo, y el sistema
  MUST rechazar los archivos que lo excedan ANTES de intentar convertir, informando el
  límite y el tamaño del archivo. Los valores concretos por categoría (imagen,
  documento, audio, video) se calibran con benchmarks reales durante la fase de plan.

#### Matriz de conversiones — documentos e imágenes (Fase 1)

- **FR-009**: El sistema MUST convertir imágenes entre PNG, JPG y WebP.
- **FR-010**: Las conversiones de imagen MUST ofrecer opciones de compresión (calidad)
  y redimensionado (dimensiones máximas manteniendo proporción).
- **FR-011**: El sistema MUST convertir una o varias imágenes a un único PDF, con una
  página por imagen y orden reordenable por el usuario.
- **FR-012**: El sistema MUST convertir XLSX a CSV y a JSON (filas como objetos usando
  la primera fila como claves). Con múltiples hojas, se genera un archivo por hoja.
- **FR-013**: El sistema MUST convertir CSV a XLSX y JSON tabular (array de objetos
  planos) a XLSX; los JSON con otra forma se rechazan con mensaje específico.
- **FR-014**: El sistema MUST convertir XLSX y CSV a PDF, renderizando los datos como
  tabla legible.
- **FR-015**: El sistema MUST convertir PDF a imágenes PNG o JPG, generando una imagen
  por página.
- **FR-016**: El sistema MUST convertir PDF a TXT extrayendo el texto en orden de
  lectura.
- **FR-017**: El sistema MUST convertir PDF a DOCX conservando texto y estructura
  (títulos inferidos por tamaño de fuente, párrafos por espaciado), sin diseño ni
  imágenes, y MUST comunicar esa limitación antes de convertir.
- **FR-018**: El sistema MUST permitir unir varios PDFs en uno, en un orden definido
  por el usuario.
- **FR-019**: El sistema MUST permitir dividir un PDF por rangos de páginas definidos
  por el usuario, generando un PDF por rango.
- **FR-020**: El sistema MUST permitir rotar páginas de un PDF (90°, 180°, 270°),
  aplicado a páginas seleccionadas o a todas.
- **FR-021**: El sistema MUST convertir DOCX a PDF con fidelidad parcial, comunicando
  la limitación antes de convertir.
- **FR-022**: El sistema MUST convertir DOCX a TXT y a HTML.

#### Conversión por lote (Fase 2)

- **FR-023**: El sistema MUST permitir convertir N archivos compatibles a un mismo
  formato destino en una sola operación.
- **FR-024**: El sistema MUST procesar la cola con paralelismo limitado (2-3
  conversiones simultáneas), sin degradar la fluidez de la interfaz.
- **FR-025**: El sistema MUST mostrar progreso individual por archivo y progreso
  global del lote.
- **FR-026**: Cuando una conversión produzca múltiples archivos o un lote produzca
  múltiples resultados, el sistema MUST empaquetarlos en un único ZIP para descargar,
  garantizando nombres únicos dentro del ZIP.
- **FR-027**: El fallo de un archivo dentro de un lote MUST NOT invalidar los
  resultados de los demás; cada fallo se reporta individualmente.
- **FR-028**: El sistema MUST convertir DOCX a XLSX extrayendo las tablas del
  documento (una hoja por tabla), y MUST fallar con mensaje específico si el documento
  no contiene tablas.

#### Audio y video (Fase 3)

- **FR-029**: El sistema MUST convertir MP4 a MP3 extrayendo la pista de audio, y
  MUST fallar con mensaje específico si el video no tiene pista de audio.
- **FR-030**: El sistema MUST convertir MP3 a MP4, requiriendo que el usuario elija
  entre subir una imagen de portada o generar una visualización de onda (waveform).
- **FR-031**: El sistema MUST convertir WAV, OGG y M4A a MP3, y MP3 a WAV, OGG y M4A.
- **FR-032**: La primera vez que se use una conversión de audio/video, el sistema MUST
  mostrar un indicador con progreso de la descarga del motor de conversión (~30MB),
  diferenciado del progreso de la conversión.
- **FR-033**: En navegadores sin capacidad de procesamiento multihilo, las
  conversiones de audio/video MUST funcionar en modo degradado (más lento) y el
  sistema MUST comunicarlo.

#### Experiencia de conversión

- **FR-034**: El sistema MUST mostrar progreso real por archivo cuando la conversión
  lo permita; cuando no exista progreso medible, MUST indicarse actividad con una
  estimación honesta (nunca un spinner indefinido si hay progreso disponible).
- **FR-035**: El usuario MUST poder cancelar cualquier conversión en curso; la
  cancelación detiene el trabajo, libera recursos y devuelve el archivo al estado
  "listo". En un lote, cancela lo en curso y lo pendiente, conservando lo completado.
- **FR-036**: El sistema MUST ofrecer un preview del resultado antes de descargar
  cuando el formato lo permita (imágenes y PDF como mínimo).
- **FR-037**: Todos los mensajes de error MUST ser específicos y accionables,
  indicando qué pasó y qué puede hacer el usuario; queda prohibido el error genérico
  sin contexto.
- **FR-038**: Las limitaciones conocidas de una conversión (fidelidad parcial,
  aplanado de transparencia, pérdida de diseño) MUST comunicarse ANTES de convertir,
  no después.
- **FR-039**: Si hay conversiones en curso, el sistema MUST pedir confirmación del
  navegador antes de cerrar o recargar la pestaña.

#### Privacidad y disponibilidad

- **FR-040**: Ningún archivo del usuario, ni su contenido total o parcial, MUST NOT
  enviarse fuera del navegador bajo ninguna circunstancia (sin telemetría de
  contenido, sin subida a servicios externos).
- **FR-041**: La pantalla inicial MUST incluir un banner o sección visible que
  explique que los archivos se procesan localmente y nunca salen del navegador.
- **FR-042**: Una vez cargada, la app MUST funcionar sin conexión para las
  conversiones cuyos recursos ya se descargaron (capacidad de app instalable/offline,
  fase de pulido).
- **FR-043**: La app MUST funcionar en las versiones actuales de Chrome, Firefox,
  Edge y Safari, y MUST ser usable desde móviles para conversiones livianas
  (imágenes, PDF simple).

### Key Entities

- **Archivo de entrada**: un archivo aportado por el usuario. Atributos: nombre,
  tamaño, tipo detectado (por contenido, con extensión como fallback), ruta relativa
  de origen (si vino en carpeta), estado en la cola.
- **Conversión (par origen→destino)**: una transformación soportada entre un tipo de
  origen y un formato destino. Atributos: tipos de entrada aceptados, formato de
  salida, opciones configurables (calidad, dimensiones, rangos de páginas, orden),
  tamaño máximo admitido, limitaciones conocidas a comunicar.
- **Trabajo de conversión**: la ejecución de una conversión sobre un archivo (o
  conjunto, en unir/imágenes→PDF) con opciones elegidas. Atributos: archivo(s) de
  entrada, conversión, opciones, progreso (0-100 o indeterminado), estado (pendiente,
  en curso, completado, error, cancelado), mensaje de error específico si falló.
- **Resultado**: archivo(s) producidos por un trabajo completado. Atributos: nombre
  propuesto, tamaño, formato, disponibilidad de preview.
- **Lote**: conjunto de trabajos lanzados en una sola operación hacia un mismo
  destino. Atributos: progreso global, estado agregado, paquete ZIP de resultados.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un usuario nuevo completa su primera conversión (soltar archivo, elegir
  destino, descargar) en un máximo de 3 acciones y sin instrucciones externas.
- **SC-002**: Una imagen de 10MB se convierte en menos de 3 segundos en hardware de
  consumo promedio.
- **SC-003**: La pantalla inicial es interactiva en menos de 2 segundos en una
  conexión móvil promedio (4G); los recursos pesados de conversión se descargan solo
  cuando una conversión los necesita.
- **SC-004**: Durante cualquier conversión, la interfaz responde a las interacciones
  del usuario sin congelarse (ninguna interacción tarda más de 100ms en reaccionar).
- **SC-005**: El 100% de las conversiones publicadas está verificado con al menos un
  archivo real representativo antes de estar disponible para usuarios.
- **SC-006**: Una inspección del tráfico de red durante cualquier conversión muestra
  cero solicitudes salientes que contengan el archivo del usuario o su contenido.
- **SC-007**: El 100% de los casos de error previstos (archivo corrupto, tipo no
  soportado, tamaño excedido, PDF escaneado, PDF con contraseña, MP4 sin audio, DOCX
  sin tablas) produce un mensaje específico y accionable, no un error genérico.
- **SC-008**: Un lote de 20 imágenes se convierte en una sola operación y se descarga
  como un único ZIP con los 20 resultados correctos.
- **SC-009**: Con la app ya cargada y sin conexión, una conversión de imagen usada
  previamente en esa sesión se completa con éxito.
- **SC-010**: Cancelar una conversión en curso surte efecto en menos de 1 segundo y
  deja el archivo listo para reintentar.

## Assumptions

- **Sin cuentas ni persistencia**: no hay registro, login, historial persistente ni
  compartir por link. Al recargar la pestaña, la cola se pierde.
- **Idioma**: la interfaz se redacta en español (mercado inicial); la
  internacionalización queda fuera de alcance de esta feature.
- **XLSX multihoja**: al convertir a CSV/JSON se genera un archivo por hoja (ZIP si
  son varios) para no descartar datos silenciosamente. (Decisión confirmada por el
  propietario del proyecto.)
- **JSON aceptado para conversión**: solo JSON con forma tabular (array de objetos
  planos) es convertible a formatos de planilla; otros JSON se rechazan con mensaje
  específico.
- **PDF→imagen**: resolución de salida con un valor por defecto razonable y legible;
  no se expone configuración de DPI en esta versión.
- **Calidad por defecto**: las conversiones de imagen usan una calidad por defecto
  (~85%) si el usuario no ajusta opciones.
- **GIF y formatos de imagen no listados**: solo PNG, JPG y WebP participan de la
  matriz de conversión de imágenes en esta feature; otros formatos de imagen se
  rechazan como no soportados.
- **WebP/PNG animados**: se tratan como no soportados para conversión de imagen
  estática, con mensaje específico.
- **Orden de lote**: dentro de un ZIP de resultados, los archivos conservan el nombre
  base del archivo de origen con la nueva extensión; las colisiones se resuelven con
  sufijos numéricos.
- **Fuera de alcance confirmado**: PDF→DOCX con fidelidad de layout, OCR de PDFs
  escaneados, PPTX y formatos de presentación, cuentas de usuario, historial,
  compartir por link, y cualquier conversión en servidor.

## Ambigüedades resueltas

Las tres ambigüedades detectadas fueron resueltas con el propietario del proyecto el
2026-07-12:

1. **FR-008 — Límites de tamaño**: los valores concretos por categoría se calibran
   con benchmarks reales durante la fase de plan; la spec solo exige que existan y se
   comuniquen antes de convertir.
2. **FR-013 — JSON→XLSX**: incluido en el alcance, limitado a JSON tabular (array de
   objetos planos).
3. **XLSX multihoja**: se exporta un archivo por hoja (ZIP si resultan varios).
