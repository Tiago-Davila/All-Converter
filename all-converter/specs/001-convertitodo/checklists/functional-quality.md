# Checklist de calidad funcional: ConvertiTodo

**Purpose**: Evaluar que los requisitos funcionales de la especificación sean completos,
claros, consistentes, verificables y conformes con la constitución antes de planificar.
**Created**: 2026-07-12
**Feature**: [spec.md](../spec.md)

**Note**: Este checklist evalúa la calidad de lo especificado, no la implementación.

## Completitud de la matriz de conversiones

- [x] CHK001 ¿Cada conversión de imágenes de PNG, JPG y WebP tiene criterios de aceptación que definan entradas, salida y opciones aplicables? [Completitud, Spec §FR-009–FR-011, US1]
- [x] CHK002 ¿Las conversiones XLSX→CSV/JSON, CSV/JSON tabular→XLSX y XLSX/CSV→PDF tienen criterios de aceptación que cubran conservación de datos y resultados multihoja? [Completitud, Spec §FR-012–FR-014, US2, Edge Cases]
- [x] CHK003 ¿Las conversiones PDF→PNG/JPG, TXT y DOCX tienen criterios de aceptación para resultados normales y restricciones de contenido? [Completitud, Spec §FR-015–FR-017, US3]
- [x] CHK004 ¿Unir, dividir, rotar PDFs e imágenes→PDF tienen criterios de aceptación que definan orden, selección y cantidad de resultados? [Completitud, Spec §FR-011, FR-018–FR-020, US3]
- [x] CHK005 ¿Las conversiones DOCX→PDF/TXT/HTML y DOCX→XLSX tienen criterios de aceptación que definan el contenido preservado y las limitaciones? [Completitud, Spec §FR-021–FR-022, FR-028, US2, US4]
- [x] CHK006 ¿MP4→MP3, MP3→MP4 y todas las rutas MP3↔WAV/OGG/M4A tienen criterios de aceptación para entrada, salida y contenido audiovisual esperado? [Completitud, Spec §FR-029–FR-031, US5]

## Claridad y verificabilidad

- [x] CHK007 ¿Los límites por archivo de 50/25/100/250 MB están asignados sin ambigüedad a cada familia y conversión de la matriz? [Claridad, Spec §FR-008, Clarifications]
- [x] CHK008 ¿La regla de aceptar solo los primeros diez archivos del formato del primer archivo aceptado está definida para todos los medios de ingreso, incluidos carpetas y subcarpetas? [Claridad, Spec §FR-002, FR-023, US4, Edge Cases]
- [x] CHK009 ¿El requisito de paralelismo limitado «2-3 simultáneas» define un criterio suficientemente preciso para planificar y validar el límite efectivo? [Ambigüedad, Spec §FR-024, US4]
- [x] CHK010 ¿Los requisitos de progreso diferencian de forma objetiva progreso medible, actividad estimada y la descarga inicial del motor de audio/video? [Claridad, Spec §FR-032, FR-034, US5]
- [x] CHK011 ¿Las frases «tabla legible», «estructura general» y «preview cuando el formato lo permita» contienen criterios verificables o límites que eviten interpretación subjetiva? [Ambigüedad, Spec §FR-014, FR-021, FR-036]
- [x] CHK012 ¿Las métricas de rendimiento identifican hardware, tamaño y tipo de archivo suficientes para evaluar los objetivos de cada conversión pesada, no solo de imágenes? [Cobertura, Spec §SC-002–SC-004]

## Consistencia interna y de dependencias

- [x] CHK013 ¿Los límites de tamaño de §FR-008 son consistentes con el rechazo previo al procesamiento descrito en los casos de 2 GB y memoria insuficiente? [Consistencia, Spec §FR-008, Edge Cases]
- [x] CHK014 ¿La separación en Fase 1, Fase 2 y Fase 3 es consistente con las historias de usuario, la matriz de conversión y el alcance declarado? [Consistencia, Spec §FR-009–FR-033b, US1–US5]
- [x] CHK015 ¿La estructura del ZIP conserva rutas relativas para carpetas y resuelve colisiones de nombre de manera consistente con los resultados de conversiones multiarchivo? [Consistencia, Spec §FR-026, US4, Assumptions]
- [x] CHK016 ¿Los requisitos offline y de cero solicitudes salientes distinguen con claridad los recursos propios ya cargados de recursos externos prohibidos? [Consistencia, Spec §FR-040–FR-042, SC-006, SC-009]
- [x] CHK017 ¿Las restricciones de dependencias —recursos locales, sin CDN en runtime, carga diferida y compatibilidad con COOP/COEP— están trazadas de forma no contradictoria entre la spec y la constitución? [Consistencia, Constitution §V, Restricciones Técnicas; Spec §FR-032, FR-040–FR-043]
- [x] CHK018 ¿El modo de un solo hilo sin SharedArrayBuffer es consistente con el aviso persistente, la disponibilidad solo en escritorio y las afirmaciones de rendimiento de audio/video? [Consistencia, Spec §FR-033–FR-033b, US5, Clarifications]

## Casos borde y recuperación

- [x] CHK019 ¿Cada caso de archivo corrupto, vacío, protegido, de tipo falso o no soportado define rechazo, mensaje y estado final de la cola? [Cobertura de excepciones, Spec §FR-003–FR-007, FR-037, Edge Cases]
- [x] CHK020 ¿PDF→TXT y PDF→DOCX sin capa de texto definen de forma consistente detección, rechazo y ausencia de archivo de salida? [Consistencia, Spec §FR-016–FR-017, Edge Cases, Clarifications]
- [x] CHK021 ¿Los requisitos para CSV de delimitador/codificación no estándar especifican qué resultado se considera «ilegible» y qué acción permite corregirlo antes de la descarga? [Ambigüedad, Spec Edge Cases]
- [x] CHK022 ¿Los escenarios de XLSX multihoja y DOCX sin tablas definen cantidad de archivos, empaquetado y mensajes de error sin pérdida silenciosa de datos? [Completitud, Spec §FR-012, FR-028, Edge Cases]
- [x] CHK023 ¿La transparencia de imagen, ausencia de audio en MP4 y formatos animados no soportados tienen requisitos consistentes sobre advertencia, rechazo y resultado generado? [Cobertura de excepciones, Spec §FR-029–FR-030, FR-038, Edge Cases, Assumptions]
- [x] CHK024 ¿La cancelación, el fallo parcial de lote, el cierre/recarga y la falta de memoria definen estados terminales, resultados conservados y condiciones de reintento coherentes? [Cobertura de recuperación, Spec §FR-027, FR-035, FR-039, SC-010, Edge Cases]

## Conformidad constitucional y no funcional

- [x] CHK025 ¿Todos los requisitos de conversión, previsualización, ZIP y modo offline preservan explícitamente el procesamiento íntegro en el navegador, sin excepción de red para archivos o contenido parcial? [Conformidad constitucional, Constitution §II; Spec §FR-040–FR-042, SC-006]
- [x] CHK026 ¿La prohibición de telemetría y de solicitudes salientes en runtime es compatible con el requisito de descarga bajo demanda de recursos propios y está expresada sin permitir servicios de terceros? [Conformidad constitucional, Constitution §II, Restricciones Técnicas; Spec §FR-032, FR-040, SC-006]
- [x] CHK027 ¿Los requisitos de accesibilidad, compatibilidad de navegadores, uso móvil limitado y avisos de degradación definen una experiencia no funcional coherente para cada plataforma? [Cobertura no funcional, Spec §FR-033–FR-033b, FR-043–FR-044]
- [x] CHK028 ¿La especificación se limita a comportamiento y criterios de aceptación, sin prescribir implementación ni autorizar código durante las fases previas a implementación? [Conformidad constitucional, Constitution §XI; Spec §Functional Requirements, Assumptions]
- [x] CHK029 ¿Cada conversión publicada está vinculada a una expectativa de evidencia con archivo real y a una tarea futura, sin añadir alcance no trazado? [Trazabilidad, Constitution §I, §VIII; Spec §SC-005]

## Notes

- Marcar cada ítem solo tras revisar la redacción vigente de la especificación y la
  constitución; los ítems con `[Ambigüedad]` señalan decisiones que pueden requerir
  una clarificación antes o durante la planificación.

### Evaluación 2026-07-12 (spec vigente + constitución v1.0.0)

**25/29 ítems pasan.** Los 4 restantes señalan redacción no cuantificada en la spec:

- **CHK009** — FR-024 mantiene el rango «2-3 conversiones simultáneas»; el plan fijó 2
  trabajos, pero la spec no define un valor único ni el criterio para elegirlo.
- **CHK011** — «tabla legible» (FR-014) y «estructura general» (US2.5) siguen sin
  criterio verificable. «Preview cuando el formato lo permita» (FR-036) sí quedó
  acotado («imágenes y PDF como mínimo»).
- **CHK012** — Solo las imágenes tienen objetivo de rendimiento (SC-002, 10 MB < 3 s);
  no hay metas ni exclusión explícita para PDF, planillas, audio o video.
- **CHK021** — El caso borde de CSV no define qué se considera «ilegible» ni qué
  delimitadores/codificaciones se intentan detectar; la única acción ofrecida es
  observar el preview.

Estos cuatro puntos requieren decisión del propietario (vía `/speckit-clarify` o
enmienda de spec fuera de la fase de implementación); la spec no se modifica durante
la implementación (CLAUDE.md / Constitución I y XI).

**Actualización (sesión `/speckit-clarify` 2026-07-12, más tarde): 29/29.** Los cuatro
ítems se resolvieron con decisiones del propietario integradas a la spec: CHK009
(FR-024: exactamente 2 simultáneas), CHK011 (FR-014/FR-021/US2.5: criterios mínimos
verificables de tabla y estructura), CHK012 (SC-002 acotado a imágenes + SC-002b:
indicador visible antes de 2 s en toda conversión) y CHK021 (Edge Cases: delimitadores
y codificaciones concretos, definición objetiva de «ilegible» con rechazo accionable).

Conformidad constitucional verificada: Principio II (CHK025–CHK026: cero telemetría,
procesamiento íntegro en navegador) y Principio XI (CHK028: la spec no prescribe
implementación) sin violaciones.
