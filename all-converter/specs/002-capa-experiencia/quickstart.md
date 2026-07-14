# Quickstart: validación de la capa de experiencia

Guía de validación manual. Los tests automatizados cubren la lógica (contraste, consolidación,
degradación); esto cubre lo que **solo se valida mirando y escuchando**.

## Prerrequisitos

```bash
npm install
npm run dev            # desarrollo
npm run build && npm run preview   # valida COOP/COEP como en producción
```

Tests y puertas de calidad:

```bash
npx vitest run         # suite completa
npx tsc --noEmit       # TypeScript estricto
npm run build          # verifica el presupuesto de bundle (Principio V)
```

---

## Escenarios de validación

### 1. Fondo reactivo (FR-002/FR-003) — requiere DEP-001

| Paso | Esperado |
|---|---|
| Abrir la app y no tocar nada | Fondo se mueve **lento y tenue** (intensidad baja) |
| Pasar el cursor sobre el dropzone | Intensidad **intermedia**; el brillo **sigue al cursor** |
| Arrastrar un archivo sobre la ventana (sin soltar) | Intensidad al **máximo** |
| Salir del drag sin soltar | Vuelve al estado previo |
| Convertir un archivo | La intensidad **acompaña al progreso** |
| **El texto se lee en todo momento** | Sí, siempre: el contenido va sobre el scrim |

### 2. Los 5 estados, sin depender del color (FR-015, SC-001)

| Paso | Esperado |
|---|---|
| Agregar un archivo | `pending`: ícono de reloj + "En cola" + acción Quitar |
| Convertir audio/video **por primera vez** | `prep`: "Esperando al conversor…", **sin porcentaje falso** |
| Durante la conversión | `converting`: porcentaje **real** + barra determinística + Cancelar |
| Al terminar | `done`: "Listo" + Descargar; tras descargar, queda marcado |
| Forzar un error | `error`: **causa concreta**, nunca genérica |
| **Ver la pantalla en escala de grises** (DevTools → Rendering → Emulate vision deficiency: achromatopsia) | Los 5 estados siguen distinguiéndose **por ícono y texto** |

### 3. Solo con teclado (FR-041, SC-003)

Desenchufá el mouse. Con Tab/Shift+Tab/Enter/Espacio:

| Paso | Esperado |
|---|---|
| Recorrer la app | **Foco visible** en cada control, en orden lógico |
| Alcanzar el selector de destino de una fila | Sí, y se opera con teclado |
| Durante una conversión, alcanzar "Cancelar" | **Sí** (es el caso que se suele romper) |
| Quitar una fila | El foco **no queda huérfano** |
| Enfocar una fila en `error` | El lector de pantalla lee **la causa concreta** |

### 4. Sonido (FR-029 a FR-035)

| Paso | Esperado |
|---|---|
| Primera visita, operar la app | **No suena nada** (silencio por defecto) |
| Activar el sonido y soltar **10 archivos** | Suena **una** vez (por gesto, no por archivo) |
| Convertir los 10 | **No suena por archivo**. Un **único** sonido al terminar la cola |
| Terminar con ≥1 error | Suena la variante **"con errores"**, distinguible |
| Recargar la página | La preferencia de sonido **sobrevive** |
| Cancelar toda la cola | **No** suena el sonido de éxito |
| Silenciar y repetir todo | La app funciona **idéntica pero muda**: no se pierde información |

### 5. reduce-motion (FR-005/FR-034)

Activar en el sistema (o DevTools → Rendering → `prefers-reduced-motion: reduce`).

| Paso | Esperado |
|---|---|
| Recargar | El fondo **no anima** (estático) |
| Con el sonido **activado**, disparar eventos | **No suena nada** (el sistema vetea) |
| Mirar el control de sonido | Muestra **"silenciado"** con el motivo visible, no "activado" |
| Desactivar reduce-motion y recargar | El sonido **vuelve solo**: la preferencia se conservó |
| Funcionalidad | **100% intacta** |

### 6. Sin WebGL (FR-004)

Deshabilitar WebGL (`chrome://flags` o `about:config` → `webgl.disabled`).

| Paso | Esperado |
|---|---|
| Cargar la app | Fondo **gradiente estático**, sin animación |
| Buscar errores | **Ninguno visible**, ni en pantalla ni en consola |
| Funcionalidad | **100%**: se convierte y se descarga igual |

### 7. Sin Web Audio (FR-039)

| Paso | Esperado |
|---|---|
| Navegador sin Web Audio (o `AudioContext` bloqueado) | La app funciona **muda**, sin errores |
| El control de sonido | Indica que el audio no está disponible |

### 8. MP3 → MP4 (FR-028)

| Paso | Esperado |
|---|---|
| Agregar un MP3, elegir destino MP4 | Muestra que usará un **waveform generado** |
| Mirar el botón "Convertir" | **Habilitado**: nunca se bloquea |
| Convertir sin tocar nada | Produce un MP4 válido con el waveform |
| Elegir una imagen de portada | La reemplaza; se puede **volver** al waveform |

### 9. PDF con contraseña (FR-021)

| Paso | Esperado |
|---|---|
| Agregar un PDF protegido | Campo de contraseña + nota de que **se usa solo localmente** |
| Acciones | **Desbloquear** y **Quitar** |
| Contraseña incorrecta | Mensaje claro; se puede reintentar |

### 10. OCR inerte (FR-024)

| Paso | Esperado |
|---|---|
| Agregar un PDF escaneado, destino DOCX/TXT | Avisa que no hay texto que extraer |
| Mirar el control de OCR | Rotulado **exactamente** "OCR (próximamente)", visible pero **inerte** |
| Activarlo (clic o Enter) | **No pasa nada**. El lector de pantalla lo anuncia como deshabilitado |

### 11. Privacidad: cero red en runtime (FR-045, SC-010)

**El más importante.** DevTools → Network, filtro "All", limpiar.

| Paso | Esperado |
|---|---|
| Recargar y hacer un flujo completo (soltar, convertir, sonar, descargar) | **Cero** peticiones más allá de los assets propios de la app |
| Buscar peticiones a CDN de fuentes, audio o shaders | **Ninguna** |
| Buscar telemetría/analytics | **Ninguna** |
| Modo avión tras la primera carga | La app **sigue funcionando** |

### 12. Anuncios accesibles (FR-043)

Con un lector de pantalla (NVDA, VoiceOver, Orca):

| Paso | Esperado |
|---|---|
| Convertir 10 archivos | **Un solo** anuncio al terminar: "7 archivos listos, 3 con error" |
| ¿Se anuncia archivo por archivo? | **No**: satura y es inutilizable |
| Recorrer las filas en `error` con Tab | Cada una lee **su causa concreta** |

---

## Dependencias que bloquean parte de esta validación

- **DEP-001 (mockup)**: bloquea el escenario 1 (fondo). Los tokens actuales son provisionales y
  **todos pasan AA**; cuando llegue el mockup, hay que re-verificar cada color suyo.
- **DEP-002 (assets de audio)**: bloquea el escenario 4. Se necesitan **al menos 4 sonidos
  distinguibles** (`drop`, `reject`, `queue-done-ok`, `queue-done-errors`).

Los escenarios **2, 3, 8, 9, 10, 11 y 12 no dependen de nada** y se pueden validar apenas se
implementen las fases A–D.
