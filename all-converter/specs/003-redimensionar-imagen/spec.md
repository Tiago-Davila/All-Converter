# Feature Specification: Redimensionador de imágenes (página aparte)

**Feature Branch**: `003-redimensionar-imagen`

**Created**: 2026-07-27

**Status**: Draft

**Input**: User description: "1) Permita el cambio de resolución a una imagen con cualquier formato, ya sea webp, jpg, png, etc. 2) El máximo de resolución permitida sea de 1920x1080. 3) El mínimo 32x32. 4) El cambiador de resolución debe poder ajustar los píxeles automáticamente, es decir cuando bajo los píxeles de alto también bajen en proporción los de ancho. 5) Debe poder cambiar alto y ancho sin importar la proporción. 6) Debe ser una sección aparte del convertidor, mostrada como una página aparte con botón en la página principal."

## Contexto y frontera con 001 / 002

Esta feature **no forma parte de la matriz de conversión** de 001. Es una herramienta
independiente con su propia página. Consume la infraestructura existente (canal tipado de
workers, `startWorker`, detección por magic bytes, tokens visuales de 002) pero **no toca**
el registry, la cola de archivos ni ningún conversor existente.

Lo que hoy existe y **queda intacto**: el campo "Ancho máximo" dentro de las opciones de
imagen del convertidor (`image-convert`), que solo achica y solo actúa junto a un cambio de
formato.

## Clarifications

### Session 2026-07-27

- Q: El tope de 1920x1080, ¿cómo aplica a imágenes verticales? → A: **Por lado largo/corto**. El lado largo nunca supera 1920 y el lado corto nunca supera 1080. Paisaje llega a 1920×1080, retrato a 1080×1920, cuadrado a 1080×1080. Es un invariante sobre el **par de salida**, no sobre la orientación de la fuente.
- Q: ¿Qué formatos de entrada acepta? → A: **Cualquiera que el navegador sepa decodificar** (png, jpg, webp, gif, bmp, avif, ico…). No hay whitelist propia: la capacidad del navegador es la frontera.
- Q: ¿Qué formatos de salida ofrece? → A: **Original, WebP, JPG y PNG** — los mismos que ya ofrece el convertidor de 001, más la opción de conservar el de entrada.
- Q: Si la entrada es un formato que el navegador no puede **codificar** (gif, bmp, avif, ico) y el usuario eligió "Original", ¿qué pasa? → A: **Cae a PNG con aviso visible**. Nunca bloquea: el usuario siempre obtiene su imagen redimensionada.
- Q: ¿Una imagen por vez o lote? → A: **Una por vez**, con vista previa grande y descarga directa. El lote es el territorio del convertidor.
- Q: Cuando la proporción original hace imposible cumplir mínimo y máximo a la vez (p. ej. 4000×50), ¿qué gana? → A: **Gana el máximo**. El eje derivado puede quedar por debajo de 32 px y la página lo avisa, en vez de bloquear o romper la proporción.
- Q: ¿Se puede agrandar una imagen? → A: **Sí**, hasta el tope de 1920/1080. Es la diferencia central con `image-convert`, que está clavado a `Math.min(1, …)` y solo achica. La página avisa que agrandar puede verse borroso.
- Q: ¿Qué pasa con imágenes animadas (GIF, PNG/WebP animados)? → A: **Se aceptan** y se usa el **primer fotograma**, con aviso. (En `image-convert` el rechazo actual se mantiene sin cambios.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bajar la resolución manteniendo la proporción (Priority: P1)

Un usuario con una foto de celular de 3024×4032 entra a la página de redimensionado, la
suelta, ve sus dimensiones reales, escribe `1080` en Ancho y el Alto se ajusta solo a
`1440`. Descarga la imagen y pesa una fracción de la original.

**Why this priority**: es el caso de uso dominante y por sí solo justifica la feature.

**Acceptance**:
1. Al cargar la imagen se muestran las dimensiones originales y una vista previa.
2. Con "Mantener proporción" activo, editar un eje recalcula el otro conservando la
   relación de aspecto (±1 px por redondeo).
3. El archivo descargado mide exactamente lo indicado.

### User Story 2 - Fijar alto y ancho sin respetar la proporción (Priority: P1)

Un usuario necesita exactamente 500×500 a partir de una imagen 4:3. Desactiva "Mantener
proporción", escribe ambos valores y descarga. La imagen sale deformada a propósito.

**Acceptance**:
1. Con la proporción desactivada, editar un eje **no** modifica el otro.
2. El archivo descargado mide exactamente 500×500.

### User Story 3 - Cualquier formato entra, el formato de salida se elige (Priority: P2)

Un usuario carga un GIF o un AVIF. La página lo abre igual. Elige salida WebP y descarga.
Si deja "Original", ve un aviso de que se descargará como PNG porque el navegador no sabe
guardar GIF.

**Acceptance**:
1. Entradas gif/bmp/avif/ico se aceptan si el navegador las decodifica.
2. El selector de salida ofrece Original / WebP / JPG / PNG.
3. Con "Original" no codificable, la salida es PNG y hay un aviso visible.
4. Un formato que el navegador no puede abrir produce un mensaje claro, no un fallo mudo.

### User Story 4 - Los límites se respetan solos (Priority: P2)

El usuario escribe `4000` en Ancho y el campo lo deja en `1920`. Escribe `10` y queda en
`32`. Nunca ve un error: los valores se corrigen y el texto de ayuda dice el rango vigente.

**Acceptance**:
1. `max(ancho, alto) ≤ 1920` y `min(ancho, alto) ≤ 1080` siempre.
2. `ancho ≥ 32` y `alto ≥ 32`, salvo el caso de proporción imposible (que se avisa).
3. La corrección ocurre en la UI **y** se revalida en el worker (defensa en profundidad).

### User Story 5 - Es una página aparte (Priority: P1)

Desde la portada hay un botón "Redimensionar imagen" que lleva a una página propia. Hay un
camino de vuelta al convertidor, y volver **no pierde** los archivos que ya estaban en la
cola.

**Acceptance**:
1. La portada muestra el botón.
2. La página tiene URL propia (`#/redimensionar`) y es enlazable/recargable.
3. Ir y volver conserva el estado de la cola del convertidor.

## Requirements *(mandatory)*

- **FR-001**: La página acepta una imagen por vez, por selector de archivo o arrastrando.
- **FR-002**: La entrada no tiene whitelist de formato; la frontera es lo que el navegador
  decodifica. El tipo real se detecta por magic bytes (Regla 7 de `Claude.md`).
- **FR-003**: Se muestran las dimensiones originales y una vista previa de la imagen.
- **FR-004**: Ancho y alto son editables numéricamente.
- **FR-005**: Con "Mantener proporción" (activo por defecto), editar un eje recalcula el
  otro conservando la relación de aspecto de la fuente.
- **FR-006**: Con "Mantener proporción" desactivado, cada eje es independiente.
- **FR-007**: Invariante del par de salida: `32 ≤ w,h`, `max(w,h) ≤ 1920`, `min(w,h) ≤ 1080`.
- **FR-008**: Se permite **agrandar** hasta el tope de FR-007, con aviso de posible pérdida
  de nitidez.
- **FR-009**: El formato de salida se elige entre Original, WebP, JPG y PNG. "Original" no
  codificable cae a PNG con aviso visible.
- **FR-010**: Para salidas JPG/WebP hay control de calidad.
- **FR-011**: JPG sobre fuente con transparencia aplana sobre blanco, con la misma
  advertencia que ya usa el convertidor.
- **FR-012**: Fuentes animadas producen el primer fotograma, con aviso.
- **FR-013**: El nombre de salida incluye las dimensiones (`foto-1080x1440.png`).
- **FR-014**: El redimensionado corre en un Web Worker; el main thread no se bloquea
  (Regla 5).
- **FR-015**: La página vive en `#/redimensionar`, con botón de entrada en la portada y
  camino de vuelta. Navegar no destruye la cola del convertidor.
- **FR-016**: Ningún byte sale del dispositivo (Regla 1).

### Key Entities

- **ResizeTarget**: `{ width, height }` — el par de salida, siempre sujeto al invariante
  FR-007.
- **NaturalSize**: `{ width, height }` — dimensiones reales de la fuente, leídas del
  `naturalWidth/naturalHeight` de la vista previa.
- **OutputChoice**: `'original' | 'image/png' | 'image/jpeg' | 'image/webp'`.

## Out of Scope

- Lotes de imágenes (lo cubre el convertidor de 001).
- Recorte, rotación, filtros o cualquier edición que no sea escalar.
- Codificar formatos que el navegador no soporta (GIF, AVIF, BMP de salida): requeriría
  wasm adicional y rompería el presupuesto de bundle sin justificación.
- Preservar la animación de un GIF.

## Discrepancias con las reglas del proyecto

- **Regla 3** (`Claude.md`): "toda conversión se registra en `registry.ts`". `image-resize`
  implementa la interfaz `Converter` pero **no se registra**, porque registrarlo lo haría
  aparecer como destino dentro de la cola del convertidor — justo lo que el pedido separa
  (FR-015). Queda documentado en el módulo.
