# Contrato: SoundManager

Interfaz pública de la capa de sonido. Los componentes solo conocen `play(event)`; nunca tocan
Web Audio ni los assets.

## Invariantes (verificables con test)

1. **Silencio por defecto**: sin preferencia guardada, `play()` no produce sonido (FR-031).
2. **Nunca canal único**: todo evento tiene equivalente visual (tabla D3 de `research.md`).
   Si un evento no está en esa tabla, no puede existir.
3. **Veto de reduce-motion**: con `prefers-reduced-motion: reduce`, `play()` no suena **aunque
   la preferencia esté activada** (FR-034). `silenceReason()` devuelve `'reduced-motion'`.
4. **Sin sonido por archivo**: no existe ningún evento que se dispare una vez por archivo
   (FR-029b). Una cola de 10 archivos produce **exactamente 1** sonido de finalización.
5. **Un gesto, un sonido**: soltar 10 archivos dispara `drop` **una** vez.
6. **Sin solapamiento**: si `isBusy()`, el nuevo disparo se **descarta** (no se encola, no se
   mezcla) (FR-035).
7. **Bloqueo previo al gesto**: antes del primer gesto del usuario, `play()` no suena y no
   lanza. Los eventos se descartan, no se acumulan (D5).
8. **Falla muda**: sin Web Audio, `play()` es un no-op silencioso. **Nunca** muestra un error
   al usuario (FR-039).
9. **Cero red en runtime**: los assets son locales y precargados. `play()` no dispara ninguna
   petición (FR-037, Principio XVI).
10. **Cancelar no es un logro**: si la cola termina porque el usuario canceló todo, no suena
    `queue-done-ok`.
11. **Cola dinámica**: agregar archivos mientras otros están en `converting` o `prep` pospone el
    disparo de `queue-done-ok`/`queue-done-errors` hasta que **todos** los archivos de la cola
    —incluidos los recién agregados— finalicen. El evento no se dispara en mitad de una
    conversión activa (FR-029c).

## Superficie

```ts
play(event: SoundEvent): void
isAudible(): boolean
silenceReason(): SilenceReason | undefined
```

`isAudible()` refleja el **efecto real**, no la preferencia guardada: es lo que el
`SoundToggle` muestra (FR-034b).

## Tests exigidos

| Test | Verifica |
|---|---|
| No suena sin preferencia | Invariante 1 |
| No suena bajo reduce-motion aunque esté habilitado | Invariante 3 |
| Cola de 10 archivos → 1 solo sonido | Invariante 4 |
| Soltar 10 archivos → 1 solo `drop` | Invariante 5 |
| Segundo disparo mientras suena → descartado | Invariante 6 |
| Sin Web Audio → no-op, sin throw | Invariante 8 |
| `silenceReason()` distingue los 4 motivos | FR-034b |
| Cola cancelada → sin sonido de éxito | Invariante 10 |
| Agregar archivos mid-conversión → fin de cola espera a todos | Invariante 11 |
