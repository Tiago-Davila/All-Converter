# Quickstart: validar lotes grandes y confiables

**Feature**: 006-lotes-grandes | **Fecha**: 2026-08-11

Guía de validación de punta a punta. Detalles de diseño en `plan.md`, `data-model.md` y
`contracts/`.

---

## Prerrequisitos

```bash
cd all-converter
npm install
```

Fixtures nuevos necesarios en `tests/fixtures/` (Principio VIII: archivos reales, no
sintéticos triviales):

| Fixture | Para qué |
|---|---|
| Carpeta con ≥60 imágenes reales pequeñas | US1: lote grande de punta a punta |
| PDF corrupto y PDF escaneado (ya existen) | US2: error determinístico sin reintento |
| Archivo cuyo conversor se puede hacer colgar (doble) | US2: vencimiento del watchdog |

---

## Puerta completa

```bash
npm run ci
```

Equivale a: `lint` → `test:coverage` → `build` → `test:budget` → `test:workers` →
`test:offline` → `test:e2e`. Ninguna puede romperse.

Durante el desarrollo, el ciclo corto:

```bash
npm test                      # Vitest, environment: 'node'
npm test -- tests/lib/zip     # sólo el empaquetado
```

---

## Validación por historia

### US1 — Convertir una carpeta grande (P1)

**Automático**

```bash
npm test -- tests/lib/directory-input tests/lib/zip
```

Debe cubrir:
- 200 archivos aceptados; el 201 rechazado por cupo.
- El cupo cuenta las entradas ya presentes en la cola.
- **`detectFileType` NO se invoca para los excedentes** (espía sobre el módulo). Es la
  verificación directa de FR-002.
- Vacío y tipo-no-soportado siguen rechazándose por su causa, no por cupo, y no consumen cuota.
- ZIP de 200 entradas: round-trip contra `JSZip.loadAsync`, rutas relativas preservadas,
  colisiones resueltas (`informe.pdf` / `informe-2.pdf`), acentos y subcarpetas intactos.

**Manual**

```bash
npm run dev
```

1. Arrastrar una carpeta con 60+ imágenes → los 60 entran, **ninguna fila roja de cupo**.
2. Elegir formato destino → Convertir.
3. "Descargar ZIP" → abre el diálogo de guardado (Chromium) o descarga directa (Firefox/Safari).
4. Abrir el ZIP fuera del navegador y verificar 60 archivos con la estructura de carpetas.

**Verificación de memoria (el objetivo real del tramo)**

Con DevTools → Memory → *Allocation instrumentation on timeline*, durante un lote de 200:

> El heap de JS debe mantenerse **estable**, sin crecer de forma proporcional al total de bytes
> producidos. Si crece linealmente con las salidas, el tramo de memoria no funcionó.

Comparación honesta: hacer la misma medición en `main` con `MAX_BATCH_FILES` subido a mano a
200 muestra la curva creciente que esta feature elimina.

### US2 — Un archivo roto no arruina el lote (P1)

```bash
npm test -- tests/components/batch-flow
```

Debe cubrir:
- Lote con un archivo que falla: los demás terminan y quedan descargables *(ya existe; se
  conserva)*.
- **Cancelar el lote habiendo resultados previos no deja la UI trabada** — el defecto real de
  `FileQueue.tsx:211-219`, hoy sin cobertura. Sin esta prueba el arreglo no está verificado.
- El reintento aparece en fallos transitorios y **no** aparece en determinísticos.
- Vencimiento del watchdog → error transitorio, y el lote continúa.
- El resumen final informa listos / con error / cancelados.

**Manual**: mezclar en un lote un PDF corrupto, un PDF escaneado y 20 imágenes sanas.
Las 20 terminan; el corrupto y el escaneado explican su causa y **no** ofrecen reintentar.

### US3 — Pausar y reanudar (P2)

```bash
npm test -- tests/lib/job-scheduler
```

Debe cubrir:
- Pausar no arranca trabajos nuevos; los en vuelo terminan.
- Reanudar sigue en orden, sin saltear ni repetir.
- Cancelar estando pausado funciona sin necesidad de reanudar antes.
- `pause()` / `resume()` idempotentes.
- Audio/video y el resto corren en grupos separados: un MP3 no baja el lote entero a
  concurrencia 1.
- Los 6 casos existentes siguen verdes sin modificarse.

**Manual**: lote de 60, pausar a mitad, comprobar que el avance se detiene y no arranca nada
nuevo, reanudar, verificar que termina completo sin reconvertir lo ya hecho.

**Accesibilidad (Principio XII)**: con el lote pausado, poner la pantalla en escala de grises y
confirmar que "Pausado" se distingue por ícono y texto. Recorrer Pausar / Reanudar / Cancelar
sólo con teclado, con foco visible.

### Casos límite

| Caso | Verificación |
|---|---|
| Carpeta de 5000+ archivos | Responde en <5 s y avisa cuántos ignoró; no cuelga la pestaña |
| Dos arrastres casi simultáneos | El total nunca supera 200 |
| Lote cancelado por completo | No se genera ZIP ni suena el fin de cola |
| Fallo del empaquetado | Se informa; las descargas individuales siguen funcionando |
| Suma > 4 GB | Se rechaza el ZIP con aviso honesto; descarga individual disponible |
| Un solo archivo | Se comporta igual que antes de la feature (sin regresión) |

---

## Criterios de aceptación de la feature

| # | Criterio | Cómo se verifica |
|---|---|---|
| SC-001 | 200 archivos de punta a punta sin caídas | Manual US1 + e2e |
| SC-002 | 60 archivos entran completos | `tests/lib/directory-input` |
| SC-003 | UI responde en <1 s durante el lote | Manual, DevTools Performance |
| SC-004 | 95% termina con 1 de cada 20 fallando | `tests/components/batch-flow` |
| SC-005 | Reintento en 100% de transitorios, 0% de determinísticos | `tests/components/batch-flow` |
| SC-006 | Ningún archivo queda colgado | Test de watchdog |
| SC-007 | Pausa <1 s; reanudar no reconvierte | `tests/lib/job-scheduler` + manual |
| SC-008 | Cancelar siempre deja la UI operable | `tests/components/batch-flow` |
| SC-009 | Memoria estable con 200 archivos | Manual, DevTools Memory |
| SC-010 | 5000 archivos → respuesta <5 s con aviso | Manual + test de `readDroppedItems` |
