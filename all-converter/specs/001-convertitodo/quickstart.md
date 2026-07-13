# Guía de validación manual: ConvertiTodo

## Preparación

Ejecutar `npm run test`, `npm run build` y `npm run preview`. Usar fixtures reales:
DOCX, XLSX, CSV, PNG, PDF con texto y PDF escaneado. En DevTools comprobar
`window.crossOriginIsolated` y `SharedArrayBuffer`; si faltan, media continúa en
single-thread con el aviso definido.

## Escenarios

| Área | Validación esperada |
|---|---|
| Imagen/PDF | PNG↔JPG/WebP (calidad, dimensiones y preview); imágenes→PDF; PDF→imagen/TXT/DOCX; unir, dividir y rotar. |
| Office | XLSX↔CSV/JSON tabular, XLSX/CSV→PDF, DOCX→PDF/TXT/HTML/XLSX; multihoja y tablas sin pérdida. |
| Media | MP4→MP3, MP3→MP4 con portada o waveform, MP3↔WAV/OGG/M4A; indicador de carga de motor separado. |
| Lote | Carpeta con subcarpetas: 10 homogéneos, rechazos con motivo, progreso/fallo parcial y ZIP con rutas relativas. |
| Cancelación | Cancelar trabajo/lote: pendientes y curso paran, completados se conservan y entrada vuelve a listo <1 s. |
| Privacidad/offline | Network no contiene archivos/telemetría; sin red, conversión ya cargada funciona. |
| Bordes | 0 bytes, corrupto, protegido, escaneado, sin audio, sin tablas, tipo falso y exceso de límite tienen mensaje específico y sin salida engañosa. |

## Validación registrada — 2026-07-12

- `npm run test`: 28 archivos y 64 pruebas aprobadas.
- `npm run build`: aprobado; PWA genera `sw.js` y manifiesto con precache solo de
  assets propios.
- `npm run preview` en `127.0.0.1:4173`: respuesta 200 con
  `Cross-Origin-Opener-Policy: same-origin` y
  `Cross-Origin-Embedder-Policy: require-corp`.
- El bundle inicial de interfaz queda por debajo de 200 KB gzip; los recursos pesados
  se emiten como chunks diferidos. Los WASM de ffmpeg se cargan únicamente al iniciar
  una conversión multimedia.

## Revisión manual pendiente de navegador

Antes de publicar, repetir los escenarios en Chrome, Firefox, Edge y Safari actuales,
en móvil para conversiones livianas y en desktop para media. Confirmar tres acciones
o menos para el flujo simple (agregar, convertir, descargar), respuesta de UI menor a
100 ms y que, con Network offline tras la primera carga, una conversión de imagen ya
usada continúa funcionando.
