# Plan de implementación: ConvertiTodo

**Rama**: `001-convertitodo` | **Fecha**: 2026-07-12 | **Spec**: [spec.md](./spec.md)

## Resumen

SPA estática en Vercel que convierte archivos completamente en el navegador. La Fase 1 cubre imágenes, Office y PDF; la Fase 2 lotes/carpetas; la Fase 3 media y PWA. La trazabilidad es FR-001–FR-044 y SC-001–SC-010.

## Contexto técnico

**Lenguaje**: TypeScript estricto, React 19 y Vite. **UI**: Tailwind CSS v4. **Pruebas**: Vitest con fixtures reales; Playwright en pulido. **Plataforma**: Chrome, Firefox, Edge y Safari actuales; media solo desktop. **Persistencia**: ninguna.

**Dependencias**: `file-type`; Canvas API y `browser-image-compression`; `pdf-lib`, `pdfjs-dist`, `jspdf`+autotable; `mammoth`, `docx`, SheetJS instalado desde `cdn.sheetjs.com`; JSZip; `@ffmpeg/ffmpeg` y cores; `vite-plugin-pwa` en pulido.

**Objetivos**: entry <200 KB gzip, interactividad <2 s/4G, PNG/JPG 10 MB <3 s, UI <100 ms y cancelación <1 s. **Límites**: imagen 50 MB, PDF/Office 25 MB, audio 100 MB, vídeo 250 MB. Sin backend, telemetría, CDN runtime ni archivos fuera del navegador.

## Constitution Check

| Principio | Diseño | Estado |
|---|---|---|
| I, VII, VIII | Trazabilidad FR/SC, TS estricto y fixture real por conversor. | Cumple |
| II | Buffers, assets y procesamiento same-origin; cero telemetría/runtime externo. | Cumple |
| III | `Converter` puro y registry como única matriz conocida por UI. | Cumple |
| IV–V | Workers con transferibles e imports dinámicos; WASM local diferido. | Cumple |
| VI, IX–X | Magic bytes, límites previos y avisos honestos. | Cumple |
| XI | Solo documentación de planificación. | Cumple |

Revisión posterior al diseño: sin violaciones; no requiere Complexity Tracking.

## Fases

### Fase 1: base, imágenes, Office y PDF

Crear tipos/registry/detección, cola y componentes; workers por dominio; conversores FR-009–FR-022; límites, previews, errores, accesibilidad y tests de fixtures. Trazabilidad: US1–US3, FR-001–FR-022 y FR-034–FR-044.

### Fase 2: lote y carpetas

Recorrido recursivo con `relativePath`; máximo 10 homogéneos; scheduler de dos trabajos; cancelación/fallo parcial; JSZip replica rutas. Trazabilidad: US4 y FR-023–FR-028.

### Fase 3: media y PWA

ffmpeg local bajo demanda, MT solo con SAB y fallback ST con aviso; MP4/MP3/audio; PWA cachea solo assets empaquetados. Trazabilidad: US5–US6 y FR-029–FR-033b.

## Estructura

```text
src/{components,converters,workers,lib}/
tests/{fixtures,converters,lib,registry}/
specs/001-convertitodo/{plan,research,data-model,quickstart}.md
vercel.json
```

No hay API externa: los contratos internos están en [data-model.md](./data-model.md), sin carpeta `contracts/`.

## Puertas de validación

`npm run test` (fixtures, registry, límites, ZIP y magic bytes); `npm run build` (chunks/entry); `npm run preview` (COOP/COEP/SAB); inspección de red (solo assets propios); escenarios de [quickstart.md](./quickstart.md).
