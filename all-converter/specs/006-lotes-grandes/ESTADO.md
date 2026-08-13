# Estado de la implementación — 006-lotes-grandes

**Última actualización**: 2026-08-12 | **Rama**: `006-lotes-grandes` | **Todo commiteado**

> **La feature está completa y verificada.** `npm run ci` pasa entero: lint, 576 tests
> unitarios (84.9% de líneas), build, presupuesto de bundle, workers, offline y 19 e2e.
> Lo único que queda es la pasada **manual** de T045 (a11y en escala de grises y recorrido por
> teclado), que necesita ojos humanos.

---

## Estado por fase

| Fase | Estado |
|---|---|
| 1 · Setup (T001–T002) | ✅ |
| 2 · Foundational (T003–T008) | ✅ |
| 3 · US1 — carpeta grande (T009–T025) | ✅ |
| 4 · US2 — un archivo roto no arruina el lote (T026–T033) | ✅ |
| 5 · US3 — pausar y reanudar (T034–T039) | ✅ |
| 6 · Polish (T040–T046) | ✅ salvo la parte manual de T045 |

---

## Lo que se cerró en esta sesión

Al retomar, la suite estaba en rojo (11 tests en 4 archivos): parte por deriva de API esperada
y parte por dos regresiones que habían entrado con la agrupación por carpeta y el waveform por
default.

1. **Suite en verde** — mock del registry con `getCommonTargets`, aserción del ZIP como
   `<button>`, y la limitación de MP3→MP4 con el orden nuevo (waveform primero).
2. **Tests de US1** (T009–T013) — cupo de 200, **cero lecturas de magic bytes fuera de cupo**,
   techo de exploración, round-trip de 200 entradas y una lectura de blob por vez.
3. **T008** — `error-class` pasó a `src/lib/` con reexport en `ui/`.
4. **T025** — `runPartitioned`: audio/video de a 1 y el resto de a 2, en paralelo. Se terminó
   el mínimo global que bajaba el lote entero a 1 por un solo MP3.
5. **US2 completa** — watchdog por archivo (`convertWatched`), clasificación de errores en la
   fila, "Reintentar" sólo en transitorios, resumen de listos / con error / cancelados.
6. **US3 completa** — `PauseGate` en el scheduler + controles Pausar/Reanudar y estado
   `paused` en la fila, con ícono y texto propios.
7. **Polish** — `QueueRow` memoizada, progreso throttleado a un cuadro, e2e de 60 archivos,
   READMEs, presupuesto de bundle y `npm run ci` en verde.

---

## El defecto que encontró el e2e

El escritor ZIP producía **archivos corruptos en el navegador** y no en los tests.

`streamZip` calculaba `offset += header.length + bytes.length` **después** de emitir los
trozos. El worker transfiere el buffer de cada trozo (`postMessage(..., [chunk.buffer])`), lo
que deja la vista en `length` 0: el directorio central salía con tamaños y offsets mentirosos.
El ZIP abría "bien" —60 cabeceras locales, 60 centrales, EOCD— pero ningún lector podía
extraer nada.

No lo veía ningún test unitario porque el camino de tests no transfiere nada. Ahora sí:
`tests/lib/zip.test.ts` reproduce la transferencia con
`structuredClone(chunk.buffer, { transfer: [chunk.buffer] })`. El arreglo es medir los tamaños
antes de emitir.

Moraleja para el que siga: **los trozos son de un solo uso**. Nada puede mirarlos después del
`yield`.

---

## Medición de memoria (SC-009)

Con 200 imágenes reales, medido por CDP (`Runtime.getHeapUsage`) en Chromium:

| Momento | Heap |
|---|---|
| Inicio | 1,6 MB |
| Cola con 200 archivos cargados | 7,4 MB |
| 200 convertidos | 16,1 MB |
| ZIP de 200 entradas empaquetado y descargado | 20,2 MB |

El heap no crece con el total de bytes producidos: los resultados viven como `Blob` y el ZIP se
escribe leyendo un blob por vez. La medición usa imágenes chicas, así que prueba el
comportamiento estructural; la comparación con archivos grandes sigue siendo la prueba manual
del `quickstart.md`.

---

## Decisiones de diseño que conviene conocer

1. **El ZIP se arma al hacer clic, no al terminar el lote.** `showSaveFilePicker()` exige
   activación transitoria del usuario, así que no puede llamarse automáticamente al final del
   lote. De paso no se empaqueta lo que nadie va a descargar (FR-010).
2. **Sin JSZip para escribir.** Se midió que lee el blob entero al agregarlo (research.md D1).
   El generador propio no agrega dependencias y lee de a un blob por vez.
3. **El watchdog mide falta de avance, no duración.** 300 s por defecto, 900 s para
   audio/video, y el plazo se reinicia con cada evento de progreso.
4. **Reintentar sólo en transitorios.** Ofrecerlo en un fallo determinístico sería prometer un
   resultado que no va a llegar (Principio XV).
5. **La fila es un componente memoizado** (`src/components/QueueRow.tsx`) y sus callbacks
   viajan en un objeto de identidad estable. Si alguien lo reemplaza por lambdas inline, la
   memoización deja de servir en silencio.
6. **La carpeta de 60 imágenes del e2e se genera**, no se versiona: `tests/helpers/large-folder.ts`
   copia `tests/fixtures/sample.png`. Son imágenes reales y el repo no engorda.

---

## Trampa al correr los e2e a mano

`npm run test:e2e` levanta `npm run preview`, que sirve `dist/` **sin rebuildear**. Con un
`dist/` viejo los tests miden la versión anterior (pasa desapercibido: el lote se corta en 10 y
parece un bug nuevo). `npm run ci` no tiene el problema porque buildea antes. Corriendo
Playwright suelto, `npm run build` primero.

---

## Qué queda

- **T045 manual**: escala de grises para confirmar que "Pausado" se distingue sin color,
  recorrido por teclado de Pausar / Reanudar / Cancelar con foco visible, y un lote real con
  archivos grandes (video) mirando el heap en DevTools.
- Nada más: `tasks.md` está en 45/46 con esa única tarea parcial.
