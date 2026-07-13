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

La validación automatizada de offline se ejecuta después de `npm run build` con
`npm run test:offline`. Comprueba que ninguno de los dos cores ffmpeg ni los workers
pesados estén en el precache inicial, y que el service worker los conserve con
`CacheFirst` después de su primer uso.

Antes de publicar, repetir los escenarios en Chrome, Firefox, Edge y Safari actuales,
en móvil para conversiones livianas y en desktop para media. Confirmar tres acciones
o menos para el flujo simple (agregar, convertir, descargar), respuesta de UI menor a
100 ms y que, con Network offline tras la primera carga, una conversión de imagen ya
usada continúa funcionando.

## Puertas automatizadas finales — 2026-07-13

- `npm run lint`: aprobado sin errores.
- `npm run test:coverage`: 113 pruebas aprobadas; 85,27% líneas, 79,79% statements,
  85,04% funciones y 65,77% branches.
- `npm run test:e2e`: 13 escenarios Chromium aprobados con conversiones reales de
  imagen y media, aislamiento, red exclusivamente local y repetición offline.
- `npm run test:budget`: entry de 66.740 bytes gzip, debajo del límite de 200 KB.
- `npm run test:workers`: seis workers pesados con implementación real comprobada.
- `npm run test:offline`: ambos cores ffmpeg fuera del precache inicial y cacheados
  localmente bajo demanda.
