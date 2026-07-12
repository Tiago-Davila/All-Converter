# Guía de validación manual: ConvertiTodo

## Preparación

Ejecutar `npm run test`, `npm run build` y `npm run preview`. Usar fixtures reales: DOCX, XLSX, CSV, PNG, PDF con texto y PDF escaneado. En DevTools comprobar `window.crossOriginIsolated` y `SharedArrayBuffer`; si faltan, media continúa single-thread con el aviso definido.

## Escenarios

| Área | Validación esperada |
|---|---|
| Imagen/PDF | PNG↔JPG/WebP (calidad/dimensiones/preview); imágenes→PDF; PDF→imagen/TXT/DOCX; unir/dividir/rotar. |
| Office | XLSX↔CSV/JSON tabular, XLSX/CSV→PDF, DOCX→PDF/TXT/HTML/XLSX; multihoja/tablas sin pérdida. |
| Media | MP4→MP3, MP3→MP4 con portada y waveform, MP3↔WAV/OGG/M4A; indicador de carga de motor separado. |
| Lote | Carpeta con subcarpetas: 10 homogéneos, rechazos con motivo, progreso/fallo parcial y ZIP con rutas relativas. |
| Cancelación | Cancelar trabajo/lote: pendientes y curso paran, completados se conservan y entrada vuelve a listo <1 s. |
| Privacidad/offline | Network no contiene archivos/telemetría; sin red, conversión ya cargada funciona. |
| Bordes | 0 bytes, corrupto, protegido, escaneado, sin audio, sin tablas, tipo falso y exceso de límite tienen mensaje específico y sin salida engañosa. |

Confirmar entry <200 KB gzip, chunks diferidos, fuentes locales y headers en todas las rutas: `Cross-Origin-Opener-Policy: same-origin` y `Cross-Origin-Embedder-Policy: require-corp`.
