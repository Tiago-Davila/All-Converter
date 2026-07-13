# Modelo de tipos: ConvertiTodo

Sin base de datos: contratos TypeScript en memoria entre UI, registry y workers.

| Tipo | Campos/reglas |
|---|---|
| `DetectedFileType` | `kind`, `mime`, `extension`, `detection`; magic bytes prevalece. |
| `FileEntry` | `id`, `file`, `name`, `sizeBytes`, `relativePath?`, tipo, estado, rechazo. |
| `Converter` | `id`, `label`, `from`, `to`, `maxSizeMB`, opciones, limitaciones y `convert(file,onProgress,options,signal)`; sin React/DOM. |
| `ConversionJob` | entradas, conversor, opciones, estado, progreso, error y resultados. |
| `ConversionResult` | nombre, mime, `ArrayBuffer`, tamaño, ruta ZIP y preview. |
| `Batch` | hasta 10 trabajos homogéneos, destino, progreso, estado y ZIP. |

```text
detectando → listo → en-cola → convirtiendo → completado/error/cancelado
detectando → rechazado
cancelado → listo
```

Rechazos *(enmendado 2026-07-13)*: tipo no soportado, 0 bytes, límite de tamaño, o excedente del tope de 10. **Ya NO se rechaza por "formato diferente al del lote"**. Fallos conservan mensaje; lote conserva resultados completados.

Cada entrada de la cola lleva su **propio formato destino** *(enmendado 2026-07-13)*, elegido entre los destinos que el registry declara válidos para su tipo detectado. Una entrada sin destino elegido no se convierte y no bloquea al resto.

Canal: `start` y `cancel` del main; `progress`, `result` y `error` del worker. Entrada/salida son `ArrayBuffer` transferidos. Invariantes: validar límite antes del trabajo, **hasta 10 archivos por lote (formatos mezclados permitidos)**, preservar ruta relativa en ZIP, y nunca cachear/enviar archivos de usuario.
