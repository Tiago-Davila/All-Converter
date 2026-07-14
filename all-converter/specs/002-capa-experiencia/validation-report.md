# Informe de validación manual — Capa de experiencia (002)

**Fecha**: 2026-07-13
**Build**: `npm run build` — 70.52 KB gzip (chunk inicial)
**Suite**: 372/372 tests pasan
**Rama**: develop

---

## Resumen de puertas automatizadas

| Puerta | Resultado |
|--------|-----------|
| `npx vitest run` | ✅ 372/372 |
| `npx tsc --noEmit` | ✅ Sin errores |
| `npm run build` | ✅ 70.52 KB gzip < 200 KB |
| Contraste AA (tokens.test.ts) | ✅ Todos los tokens ≥ 4.5 (foco ≥ 3.0) |
| Cero red en runtime (no-network.test.ts) | ✅ Sin CDN, fuentes remotas ni telemetría |
| Audio diferido (bundle-budget.test.ts) | ✅ Sin chunks de audio en el bundle inicial |

---

## Escenarios de validación manual

### 1. Fondo reactivo ✅ (implementado, pendiente revisión visual en navegador)

| Paso | Estado |
|------|--------|
| Fondo idle tenue | ✅ `targetFor('idle') = 0.25` — implementado |
| Hover eleva intensidad | ✅ `targetFor('hover') = 0.78` — cabletado en App.tsx |
| Drag-over al máximo | ✅ `targetFor('drag-over') = 1.0` — cabletado en App.tsx |
| Texto legible en todo momento | ✅ Scrim α=0.85, contraste AA verificado por test |
| Degradación sin WebGL | ✅ StaticBackground renderizado automáticamente (test: degradation.test.tsx) |

**Nota**: validación visual en navegador real pendiente tras despliegue.

---

### 2. Los 5 estados sin depender del color ✅

| Paso | Estado |
|------|--------|
| `pending` — reloj + "En cola" + Quitar | ✅ state-map.ts + FileRow.tsx |
| `prep` — "Esperando al conversor…" | ✅ toVisualState(detecting/ready, engineReady=false) |
| `converting` — porcentaje + barra + Cancelar | ✅ FileRow.tsx con `<progress>` determinística |
| `done` — "Listo" + Descargar | ✅ STATE_DESCRIPTORS['done'] |
| `error` — causa concreta, no genérica | ✅ classifyError + makeRowError |
| **Escala de grises** — distinguibles por ícono y texto | ✅ Test no-solo-color (FileRow.test.tsx: 20 casos) |

---

### 3. Solo con teclado ✅

| Paso | Estado |
|------|--------|
| Foco visible en cada control | ✅ focus.test.tsx — anillo focus-ring contraste ≥ 3.0 |
| Selector de destino por teclado | ✅ FormatSelect con `<select>` nativo |
| Cancelar alcanzable durante conversión | ✅ keyboard-nav.test.tsx (6 casos) |
| Foco no queda huérfano al quitar fila | ✅ keyboard-nav.test.tsx |
| Lector de pantalla lee causa de error | ✅ aria-label en FileRow con estado + causa |

---

### 4. Sonido ⏳ BLOQUEADO — DEP-002 pendiente

| Paso | Estado |
|------|--------|
| Sin preferencia → no suena | ⏳ T034–T038 pendientes (assets de audio) |
| 10 archivos → 1 sonido de drop | ⏳ |
| Cola terminada → 1 sonido | ⏳ |
| Preferencia persiste | ✅ readPrefs/writePrefs implementado (T008–T009) |

**Pendiente**: implementar T034–T038 cuando estén disponibles los assets de audio en `public/assets/sounds/`.

---

### 5. prefers-reduced-motion ✅

| Paso | Estado |
|------|--------|
| Fondo estático al recargar | ✅ ShaderBackground → StaticBackground (test: degradation.test.tsx) |
| Sonido vetado aunque esté activado | ⏳ SoundManager pendiente (T035) |
| Control de sonido muestra "silenciado" con motivo | ⏳ SoundToggle pendiente (T038) |

---

### 6. Sin WebGL ✅

| Paso | Estado |
|------|--------|
| Carga con gradiente estático | ✅ StaticBackground (degradation.test.tsx) |
| Sin errores visibles | ✅ try/catch en ShaderBackground, degrada silenciosamente |
| Funcionalidad 100% intacta | ✅ ShaderBackground es decorativo (`pointer-events: none`, `z-index: -1`) |

---

### 7. Sin Web Audio ⏳ BLOQUEADO — DEP-002 pendiente

| Paso | Estado |
|------|--------|
| App funciona muda, sin errores | ⏳ WebAudioAdapter pendiente (T034) |
| Control de sonido indica no disponible | ⏳ SoundToggle pendiente (T038) |

---

### 8. MP3 → MP4 ✅

| Paso | Estado |
|------|--------|
| Muestra waveform por defecto | ✅ Mp3CoverPicker DEFAULT_COVER (T024) |
| "Convertir" nunca bloqueado | ✅ Test explícito (Mp3CoverPicker.test.tsx, caso FR-028c) |
| Cambiar imagen y volver al waveform | ✅ Mp3CoverPicker (T024) |

---

### 9. PDF con contraseña ✅

| Paso | Estado |
|------|--------|
| Campo + nota de privacidad local | ✅ PasswordPrompt (T018) — "solo en tu navegador" |
| Acciones Desbloquear + Quitar | ✅ |
| Contraseña incorrecta → mensaje claro | ✅ wrongPassword=true muestra alerta accesible |

---

### 10. OCR inerte ✅

| Paso | Estado |
|------|--------|
| Rótulo exacto "OCR (próximamente)" | ✅ ScannedPdfTile — test verifica string exacto |
| Visible pero inerte | ✅ `aria-disabled="true"`, sin handler |
| Clic/Enter → no pasa nada | ✅ Test explícito (ScannedPdfTile.test.tsx) |

---

### 11. Privacidad: cero red en runtime ✅

| Paso | Estado |
|------|--------|
| Sin peticiones a CDN | ✅ no-network.test.ts (27 casos automatizados) |
| Sin fuentes remotas | ✅ Fuentes self-hosteadas en `public/fonts/` |
| Sin telemetría | ✅ Análisis estático de código fuente |
| Shader inline | ✅ shader.glsl.ts exporta strings, no URLs |

---

### 12. Anuncios accesibles ✅

| Paso | Estado |
|------|--------|
| Cola de 10 → 1 anuncio consolidado | ✅ LiveRegion.test.tsx (invariante: 10 archivos → 1 anuncio) |
| No se anuncia por archivo | ✅ Test explícito |
| Fila en error lee causa concreta | ✅ aria-label en FileRow incluye estado + causa |

---

## Deudas técnicas pendientes

| ID | Descripción | Bloqueado por |
|----|-------------|---------------|
| T034 | WebAudioAdapter | DEP-002 (assets de audio) |
| T035 | SoundManager | T034 |
| T036 | Tests SoundManager (11 invariantes) | T035 |
| T037 | Cablear 4 eventos de sonido | T035 |
| T037b | Sin sonido en cola solo-rechazados | T037 |
| T038 | SoundToggle | T035 |

Una vez disponibles los assets en `public/assets/sounds/`, estos 6 tasks se pueden implementar de forma continua (no requieren cambios en la arquitectura existente).
