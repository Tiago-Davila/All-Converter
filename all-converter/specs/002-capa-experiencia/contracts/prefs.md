# Contrato: Preferencias de UI

## Invariantes (verificables con test)

1. **Solo preferencias de interfaz**: lo persistido es exclusivamente `{ soundEnabled: boolean }`.
   **Nunca** datos de archivos: ni contenidos, ni nombres, ni tamaños, ni historial (Principio II,
   FR-046). Un test debe afirmar que la clave guardada no contiene ninguna otra propiedad.
2. **Una sola clave**: `convertitodo:ui-prefs`. No se dispersan preferencias en varias claves.
3. **Default silencioso**: sin valor guardado → `{ soundEnabled: false }` (FR-031).
4. **Tolerante a la corrupción**: valor ausente, JSON inválido, tipo incorrecto, o `localStorage`
   no disponible (modo privado, cuota llena) → se cae al default **sin error visible** (FR-032b).
5. **Sobrevive al reload**: activar el sonido y recargar la página conserva la preferencia
   (FR-032).
6. **La preferencia sobrevive al veto**: bajo reduce-motion la preferencia guardada **no se
   modifica**; solo se ignora su efecto. Al desactivar reduce-motion, el sonido vuelve sin que el
   usuario tenga que reactivarlo (FR-034c).

## Superficie

```ts
export function readPrefs(): UiPrefs
export function writePrefs(prefs: UiPrefs): void
```

Ambas son totales: nunca lanzan. Un fallo de almacenamiento se traga en silencio (invariante 4).

## Tests exigidos

| Test | Verifica |
|---|---|
| Sin valor guardado → `soundEnabled: false` | Invariante 3 |
| JSON corrupto → default, sin throw | Invariante 4 |
| `localStorage` que lanza al escribir → no propaga | Invariante 4 |
| Round-trip: escribir, leer, coincide | Invariante 5 |
| Lo persistido no tiene claves fuera de `soundEnabled` | Invariante 1 |
