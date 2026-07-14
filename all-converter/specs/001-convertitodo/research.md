# Investigación técnica: ConvertiTodo

## Carga diferida, workers y bundle

**Decisión**: el entry contiene UI, tipos, registry de metadatos y detección. Cada worker importa su dominio solo al iniciar: Canvas/compresión, PDF, Office o ffmpeg. Workers de módulo por trabajo reciben y devuelven `ArrayBuffer` como transferibles; `AbortController` envía cancelación y `terminate()` garantiza liberación. Scheduler: 2 simultáneos por defecto.

**Rationale**: protege el entry <200 KB gzip, la UI y memoria; buffers no se copian. **Alternativas descartadas**: imports estáticos, main thread, structured clone y workers persistentes tras cancelar.

Fuentes: [Vite workers](https://vite.dev/guide/features#web-workers), [MDN transferibles](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects).

## SheetJS y PDF.js

**Decisión**: instalar SheetJS como tarball ESM versionado desde `cdn.sheetjs.com` durante desarrollo/CI y empaquetarlo; no usar npm legado ni CDN runtime. `pdfjs-dist` se importa dinámicamente y su `workerSrc` apunta a asset local emitido por Vite con `new URL(..., import.meta.url)`; API y worker usan la misma versión.

**Rationale**: el CDN oficial provee SheetJS actual sin solicitarlo en producción; COEP bloquea recursos remotos y exige worker PDF local. **Alternativas descartadas**: `<script>` remoto, fake worker y versiones PDF mezcladas.

Fuentes: [SheetJS](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/), [PDF.js setup](https://github.com/mozilla/pdf.js/wiki/Setup-PDF.js-in-a-website).

## PDF a DOCX

**Decisión**: extraer texto por página, ordenar Y/X y formar líneas/bloques. Tamaño base = mediana (fallback 11 pt); H1 ≥1.8×, H2 ≥1.35×. Nuevo párrafo con hueco >1.5× altura de línea o indentación >2×. Lista: marcador en dos líneas consecutivas y nivel por indentación. Sin texto: rechazar; no imágenes, tablas, columnas ni layout absoluto.

**Rationale**: heurística determinista y testeable compatible con fidelidad parcial. **Descartado**: OCR, rasterizado, IA/remoto y layout absoluto.

## Media y SharedArrayBuffer

**Decisión**: cargar core MT local solo con `crossOriginIsolated` y `SharedArrayBuffer`; si falta o falla, reiniciar una vez con core ST local y aviso persistente «modo compatible, conversión más lenta». Para MP3→MP4:

```text
-loop 1 -framerate 30 -i cover.png -i input.mp3 -map 0:v:0 -map 1:a:0 -c:v libx264 -tune stillimage -pix_fmt yuv420p -c:a aac -b:a 192k -shortest output.mp4
```

Waveform local: `-i input.mp3 -filter_complex aformat=channel_layouts=mono,showwavespic=s=1280x720:colors=0x22c55e -frames:v 1 waveform.png`.

**Rationale**: `-loop 1` y `-shortest` sincronizan pista visual/audio; H.264/AAC es compatible. **Descartado**: CDN, bloquear sin SAB y MP4 sin vídeo.

## Límites y Vercel

| Familia | MB | Contención |
|---|---:|---|
| Imagen | 50 | Raster se expande; worker y liberación por archivo. |
| PDF/Office | 25 | PDF/ZIP/XML se expanden; procesar página/hoja. |
| Audio | 100 | Input, PCM, salida y WASM; una media a la vez. |
| Vídeo | 250 | Demux/buffers ffmpeg; worker exclusivo. |

Los límites son guardas, no RAM exacta. `vercel.json` aplica en todas las rutas COOP `same-origin` y COEP `require-corp`; assets/fonts self-hosted. PWA cachea únicamente assets propios, nunca archivos de usuario.
