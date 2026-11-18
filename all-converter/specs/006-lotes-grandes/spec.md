# Feature Specification: Lotes grandes y confiables

**Feature Branch**: `006-lotes-grandes`

**Created**: 2026-08-11

**Status**: Draft

**Input**: User description: "Quiero que se puedan agregar más archivos, hacelo más de un tope de 50 archivos por carpeta. Quiero que la conversión sea segura y confiada."

## Contexto y frontera

Esta feature **no agrega ninguna conversión nueva**. Sube el techo de la cola y hace que un
lote de ese tamaño no se caiga. El registry, los conversores y la fidelidad de cada
conversión quedan intactos.

### El límite actual

`src/lib/directory-input.ts:4` fija `MAX_BATCH_FILES = 10`. Arrastrar una carpeta de 60
archivos deja 10 en la cola y genera 50 filas de rechazo, una por archivo, con el texto
*"Límite de 10 archivos por lote excedido."*

Ese número no es caprichoso: es lo único que hoy sostiene el diseño. Subirlo a secas rompe
la app por cuatro caminos distintos, todos verificables en el código actual:

1. **Tres copias de las salidas vivas a la vez.** `src/components/FileQueue.tsx:104`
   (`resultsRef`) retiene el `ArrayBuffer` de cada resultado durante toda la sesión;
   `:138` crea además un `Blob` + ObjectURL por resultado; `:216-217` arma el ZIP entero y
   lo copia otra vez. Todo en el heap de JS.
2. **El ZIP se rearma desde cero en cada corrida** sobre todo lo acumulado
   (`FileQueue.tsx:212-218`), lo que vuelve el costo cuadrático entre lotes incrementales.
3. **Un fallo del empaquetado deja la UI trabada.** `createZip` no está en `try/catch`
   (`FileQueue.tsx:211-219`) y el llamador es `void convertAll()` (`:404`): cancelar el lote
   habiendo resultados previos rechaza la promesa, `setRunning(false)` nunca corre y la
   pantalla queda con "Cancelar lote" para siempre. Defecto real, hoy sin cobertura de test.
4. **El ingreso lee bytes que no necesita.** `intakeFiles` llama a `detectFileType` en la
   línea `:41` — **antes** del chequeo de cupo de la línea `:45` — y de forma secuencial.
   Soltar una carpeta de 5000 archivos son 5000 lecturas de magic bytes para después
   rechazar 4990. `readDroppedItems` (`:9-30`) además camina el árbol sin cota alguna.

A eso se suma que no hay timeouts en ninguna ruta (un worker colgado espera para siempre),
no hay reintento en la cola viva, y la concurrencia baja a 1 para **todo** el lote si entra
un solo archivo de audio o video (`FileQueue.tsx:193` toma el mínimo sobre el lote entero).

### Discrepancia con specs anteriores

El tope de 10 está fijado en `specs/001-convertitodo/data-model.md:20,24`,
`specs/001-convertitodo/plan.md:38`, `specs/002-capa-experiencia/spec.md:41`,
`specs/002-capa-experiencia/plan.md:54` y `specs/002-capa-experiencia/contracts/sound.md:14-15`.
Esta feature los supera de forma deliberada. Conforme al Principio I, se deja constancia:
**donde aquellas specs digan 10, manda esta.** Las specs anteriores no se editan.

### Deuda ya especificada que esta feature salda

`specs/002-capa-experiencia/spec.md` ya define el modelo de reintento (FR-019, FR-019b,
FR-019c: reintento sólo para errores transitorios; FR-015: cancelado cuenta como transitorio;
FR-020: fallo de carga del motor es transitorio). Está implementado en
`src/ui/components/error-class.ts` pero **ningún componente vivo lo importa**: la cola real
sólo muestra una píldora de "Error" sin acción. Esta feature conecta lo que ya está escrito.

## Clarifications

### Session 2026-08-11

- Q: ¿Cuál es el tope nuevo, y es por carpeta o total? → A: **200 archivos en total en la cola.** No por carpeta. Los arrastres sucesivos suman contra el mismo techo. Supera holgadamente los 50 por carpeta del pedido y es un número defendible en memoria de navegador.
- Q: ¿Cómo debe comportarse la descarga con 200 archivos? → A: **ZIP en streaming, no en RAM.** El empaquetado se escribe de forma incremental y los bytes ya escritos se sueltan.
- Q: ¿Qué significa "conversión segura y confiada"? → A: En orden: **(1)** un fallo no tumba el lote, con reintento del que falló; **(2)** no se cuelga ni se queda sin memoria; **(3)** se puede pausar y reanudar.
- Q: ¿Pausar interrumpe los archivos en vuelo? → A: **No.** Los que ya arrancaron terminan; no se despachan nuevos. Pausar no tira trabajo hecho.
- Q: ¿El reintento se ofrece siempre? → A: **No.** Sólo en errores transitorios (memoria, motor, cancelación, timeout). En determinísticos (corrupto, protegido, no soportado, excede tamaño, PDF escaneado) ofrecer reintento sería mentirle al usuario — Principio XV.
- Q: ¿Qué pasa con los archivos que exceden el cupo? → A: Se colapsan en **una sola fila resumen**, no una fila por archivo. 200 filas rojas idénticas son ruido, no información.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Convertir una carpeta grande completa (Priority: P1)

Un usuario arrastra una carpeta con 60 imágenes. Las 60 entran en la cola, elige el formato
destino y convierte. Al terminar descarga un único ZIP con las 60 salidas, con la estructura
de carpetas preservada. La pestaña no se cae ni se congela en ningún momento.

**Why this priority**: es el pedido literal del usuario y la razón de existir de la feature.
Sin esto, nada más importa.

**Independent Test**: soltar una carpeta de 60+ archivos, convertir, descargar el ZIP y
verificar que tiene 60 entradas con los bytes correctos. Entregable por sí solo.

**Acceptance Scenarios**:

1. **Given** una cola vacía, **When** el usuario suelta una carpeta de 60 archivos soportados, **Then** los 60 quedan en estado listo y ninguno se rechaza por cupo.
2. **Given** 150 archivos ya en la cola, **When** el usuario suelta 80 más, **Then** entran 50 y los 30 restantes se informan en una sola fila resumen que dice cuántos no entraron y por qué.
3. **Given** un lote de 200 archivos convertido, **When** el usuario pide "Descargar todo", **Then** obtiene un ZIP con las 200 salidas y las rutas relativas de origen preservadas.
4. **Given** un lote grande en curso, **When** el usuario observa la app, **Then** la interfaz responde a sus clics durante toda la conversión.

---

### User Story 2 - Un archivo roto no arruina el lote (Priority: P1)

En un lote de 60, tres archivos fallan: uno está corrupto, otro es un PDF escaneado sin capa
de texto, y un tercero falla por falta de memoria momentánea. Los otros 57 se convierten y
quedan descargables. El usuario ve exactamente cuáles fallaron y por qué, y puede reintentar
sólo el que tiene arreglo.

**Why this priority**: en un lote de 10 un fallo se rehace a mano; en uno de 200 es
inaceptable. Es la mitad "confiable" del pedido, y sube de prioridad con el tamaño del lote.

**Independent Test**: lote mixto con archivos sanos y rotos; verificar que los sanos terminan,
que cada roto muestra su causa, y que el botón de reintento aparece sólo en el transitorio.

**Acceptance Scenarios**:

1. **Given** un lote donde un archivo falla, **When** termina el lote, **Then** todos los demás quedan convertidos y descargables.
2. **Given** un archivo que falló por una causa transitoria, **When** el usuario mira su fila, **Then** hay una acción de reintento disponible que reprocesa **sólo** ese archivo.
3. **Given** un archivo que falló por una causa determinística (corrupto, protegido, escaneado, excede el tamaño), **When** el usuario mira su fila, **Then** se explica la causa y **no** se ofrece reintentar.
4. **Given** un archivo cuya conversión se cuelga sin reportar avance, **When** pasa el tiempo máximo de espera, **Then** ese archivo se marca como fallido con causa transitoria y el lote continúa con los demás.
5. **Given** un lote terminado, **When** el usuario lo revisa, **Then** ve un resumen con cuántos quedaron listos, cuántos fallaron y cuántos se cancelaron.

---

### User Story 3 - Pausar y reanudar un lote largo (Priority: P2)

Un lote de 200 archivos lleva varios minutos. El usuario necesita la máquina para otra cosa,
pausa, y más tarde reanuda desde donde iba, sin perder lo ya convertido.

**Why this priority**: valiosa y explícitamente pedida, pero llega después de que el lote
grande funcione y sea confiable. Es control, no corrección.

**Independent Test**: arrancar un lote, pausar a mitad, comprobar que no arranca ningún
archivo nuevo, reanudar y verificar que termina completo.

**Acceptance Scenarios**:

1. **Given** un lote en curso, **When** el usuario pausa, **Then** los archivos en proceso terminan y no se empieza ninguno nuevo.
2. **Given** un lote pausado, **When** el usuario reanuda, **Then** la conversión sigue con los pendientes, en orden, conservando todo lo ya convertido.
3. **Given** un lote pausado, **When** el usuario cancela en lugar de reanudar, **Then** los pendientes quedan cancelados y lo ya convertido sigue descargable.
4. **Given** un lote pausado, **When** un usuario lo mira en escala de grises, **Then** distingue el estado "pausado" de los demás por ícono y texto, no sólo por color.

---

### Edge Cases

- **Carpeta enorme (5000+ archivos)**: el recorrido de carpetas corta en un techo duro y avisa cuántos archivos ignoró, en vez de colgar el navegador leyendo el árbol entero.
- **Excedentes de cupo**: no se lee ni un byte del contenido de un archivo que ya se sabe que no entra por cupo.
- **Dos arrastres casi simultáneos**: el cupo se respeta igual; no es posible pasarse de 200 soltando dos carpetas en rápida sucesión.
- **Cancelar con resultados previos**: cancelar el lote nunca deja la interfaz trabada; el botón de convertir vuelve a estar disponible y lo ya convertido sigue descargable.
- **Fallo del empaquetado**: si el ZIP no se puede generar, se informa el fallo y las descargas individuales siguen funcionando.
- **Lote cancelado por completo**: no se genera ZIP ni suena el fin de cola; cancelar todo no es un logro.
- **Lote mixto con audio/video**: la restricción de procesar de a uno se aplica sólo a los archivos de audio/video; el resto del lote no se ve frenado por ellos.
- **Un solo archivo**: el comportamiento no cambia respecto de hoy; ninguna mejora para lotes grandes puede degradar el caso de un archivo.
- **Cambiar el destino de un archivo ya convertido**: sigue volviéndolo pendiente y liberando su resultado, como hoy.

## Requirements *(mandatory)*

### Functional Requirements

**Capacidad**

- **FR-001**: El sistema DEBE aceptar hasta **200 archivos** en la cola, contando el total acumulado entre arrastres sucesivos.
- **FR-002**: El sistema DEBE decidir si un archivo entra por cupo **antes** de leer su contenido; los excedentes no consumen lectura de disco.
- **FR-003**: El recorrido recursivo de carpetas DEBE cortar en un techo duro e informar al usuario cuántos archivos quedaron fuera de la exploración.
- **FR-004**: Los archivos rechazados por cupo DEBEN presentarse en **una sola entrada resumen** que indique la cantidad y el motivo, no una entrada por archivo.
- **FR-005**: El cupo DEBE respetarse aun cuando lleguen dos aportes de archivos en rápida sucesión.

**Memoria y estabilidad**

- **FR-006**: El sistema NO DEBE retener en memoria de trabajo más de una copia de cada resultado producido.
- **FR-007**: El empaquetado ZIP DEBE construirse de forma incremental, sin requerir que el archivo completo exista en memoria de trabajo.
- **FR-008**: El sistema DEBE liberar los recursos asociados a un resultado cuando ese resultado deja de ser accesible para el usuario.
- **FR-009**: Un fallo durante el empaquetado NO DEBE dejar la interfaz en un estado inoperable; las descargas individuales DEBEN seguir disponibles.
- **FR-010**: El empaquetado NO DEBE rehacerse desde cero cuando no se agregaron resultados nuevos.

**Confiabilidad**

- **FR-011**: El fallo de un archivo NO DEBE impedir la conversión de los restantes del lote.
- **FR-012**: Cada archivo fallido DEBE mostrar la causa concreta del fallo, en texto comprensible.
- **FR-013**: El sistema DEBE ofrecer reintentar **sólo** los archivos cuyo fallo sea transitorio; en los determinísticos NO DEBE ofrecerlo.
- **FR-014**: El reintento DEBE reprocesar únicamente el archivo elegido, sin tocar el resto de la cola ni los resultados existentes.
- **FR-015**: El sistema DEBE abandonar la conversión de un archivo que no reporte avance dentro de un tiempo máximo, marcarlo como fallo transitorio, y continuar con el lote.
- **FR-016**: Al terminar un lote, el sistema DEBE informar cuántos archivos quedaron listos, cuántos fallaron y cuántos se cancelaron.
- **FR-017**: La restricción de procesar de a uno los archivos de audio y video DEBE aplicarse sólo a esos archivos, sin frenar al resto del lote.

**Control del lote**

- **FR-018**: Los usuarios DEBEN poder pausar un lote en curso. Pausar NO interrumpe los archivos ya iniciados; impide que se inicien nuevos.
- **FR-019**: Los usuarios DEBEN poder reanudar un lote pausado, conservando todo lo ya convertido.
- **FR-020**: Los usuarios DEBEN poder cancelar un lote, esté corriendo o pausado; lo ya convertido sigue descargable.
- **FR-021**: El estado "pausado" DEBE distinguirse de los demás estados por al menos un diferenciador no cromático, y sus controles DEBEN ser operables por teclado con foco visible.

**Respuesta de la interfaz**

- **FR-022**: La interfaz DEBE seguir respondiendo a la interacción del usuario mientras se convierte un lote de 200 archivos.
- **FR-023**: El avance del lote DEBE reflejarse de forma continua sin que su actualización degrade la respuesta de la interfaz.

### Key Entities

- **Cola**: conjunto de archivos aportados por el usuario, con un techo de 200 aceptados. Acumula entre aportes; conserva la ruta relativa de origen de cada archivo.
- **Entrada de cola**: un archivo con su tipo detectado, su formato destino elegido y su estado.
- **Estado de conversión**: pendiente, convirtiendo, pausado, listo, error o cancelado. Cada uno distinguible sin depender del color.
- **Fallo**: causa en texto más su clase — transitorio (se puede reintentar) o determinístico (no).
- **Resultado**: la salida de una conversión, accesible individualmente y como parte del paquete ZIP.
- **Resumen de rechazos**: agregado de los archivos que no entraron, con cantidad y motivo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un usuario puede convertir una carpeta de 200 archivos de principio a fin sin que la pestaña se cierre, se congele ni pierda resultados.
- **SC-002**: Al soltar una carpeta de 60 archivos, los 60 quedan en la cola y ninguno se rechaza por cupo.
- **SC-003**: Con un lote de 200 archivos en conversión, la interfaz responde a un clic en menos de 1 segundo, en todo momento.
- **SC-004**: En un lote donde falla 1 de cada 20 archivos, el 95% restante termina convertido y descargable.
- **SC-005**: Todo archivo fallido muestra su causa, y la acción de reintento aparece en el 100% de los fallos transitorios y en el 0% de los determinísticos.
- **SC-006**: Ningún archivo puede dejar el lote esperando indefinidamente: todo archivo termina en listo, error o cancelado.
- **SC-007**: Pausar detiene el inicio de archivos nuevos en menos de 1 segundo, y reanudar completa el lote sin reconvertir nada de lo ya terminado.
- **SC-008**: Cancelar un lote, en cualquier momento y con cualquier cantidad de resultados previos, deja siempre la interfaz operable.
- **SC-009**: La memoria de trabajo del navegador durante un lote de 200 archivos se mantiene estable, sin crecer de forma proporcional al total de bytes producidos.
- **SC-010**: Soltar una carpeta con 5000 archivos produce una respuesta de la aplicación en menos de 5 segundos, con aviso de cuántos se ignoraron.

## Assumptions

- **Tope de 200, no por carpeta**: el pedido decía "más de 50 por carpeta"; se resolvió como un techo global de 200 en la cola, confirmado con el usuario. Un techo global es más simple de razonar y de verificar que uno por carpeta, y cubre el caso pedido con margen.
- **200 es un techo de producto, no un límite técnico duro**: se elige por ser defendible en memoria de navegador en equipos modestos. Los límites `maxSizeMB` por conversor (Principio X) siguen vigentes y sin cambios.
- **El techo del recorrido de carpetas** se asume en 5000 archivos explorados: suficiente para que un usuario nunca lo toque por accidente, bajo para que un árbol patológico no cuelgue el navegador.
- **El tiempo máximo sin avance** se asume generoso y distinto según el tipo: los conversores de audio y video son legítimamente lentos y no deben abortarse por serlo.
- **Pausar no interrumpe trabajo en vuelo**: se prefiere no tirar minutos de CPU ya gastados. La alternativa (abortar y rehacer) se descartó por hostil.
- **La clasificación de errores ya existente se reutiliza**: `specs/002-capa-experiencia` ya la definió y está implementada; esta feature la conecta a la cola viva en lugar de redefinirla.
- **Sin dependencias nuevas**: se asume que el empaquetado incremental se resuelve con las capacidades ya disponibles en el proyecto. Agregar una dependencia requeriría justificarla antes (Restricciones Técnicas).
- **Fuera de alcance**: reutilización de workers entre archivos (mejora de CPU, refactorización transversal de todos los conversores); guardas de tamaño descomprimido en documentos comprimidos; limpieza de la capa de UI muerta. Son hallazgos legítimos, no bloqueantes para lotes grandes, y merecen features propias.
