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

Rechazos: tipo, 0 bytes, límite, formato diferente o excedente. Fallos conservan mensaje; lote conserva resultados completados.

Canal: `start` y `cancel` del main; `progress`, `result` y `error` del worker. Entrada/salida son `ArrayBuffer` transferidos. Invariantes: validar límite antes del trabajo, 10 homogéneos por lote, preservar ruta relativa en ZIP, y nunca cachear/enviar archivos de usuario.
