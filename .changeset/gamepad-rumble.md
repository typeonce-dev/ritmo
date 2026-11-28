---
"@typeonce/ritmo-browser": minor
---

**Gamepad rumble.** `Gamepad.actions(...).rumble({ duration, strong, weak })` shakes the followed pad's two motors (milliseconds, and each motor from 0 to 1, clamped at the boundary), `Gamepad.pads(...).rumble(place, ...)` one pad of the list by its own browser index, so two pads of the same model each rumble their own motors, and a player pool's `rumble(slot, ...)` the pad that player joined with. A merge lists `rumble` by device name next to `rebind` (`controls.rumble.gamepad(...)`). Before, a game had to call `navigator.getGamepads()[i].vibrationActuator.playEffect(...)` itself, and in a pool it could not tell two pads of one model apart, since a slot's snapshot carries the pad's `id` but not its browser index.

```ts
const sent = pool.rumble("p2", { duration: 300, strong: 1, weak: 0.6 })
if (!sent.ok && sent.error.reason === "no-motor") hideVibrationSetting("p2")
```

Every rumble returns a `Gamepad.RumbleResult`: the rumble as sent, or a `RumbleFailure` with `no-pad` (nothing connected there, an empty slot, a slot on a keyboard) or `no-motor` (no `vibrationActuator` with `"dual-rumble"`, no older `hapticActuators`, or a browser that throws). It never throws, and the pad's own promise is settled inside. `Gamepad.scripted` and `scriptedPads` succeed while connected and record each rumble with its frame (`rumbles()`, `rumbles(place)`), so a test can assert that a crash shook the right player's pad; a recording passes rumbles through to the live pad. A `Controls.Pads` written by hand now needs `rumble(place, rumble)`.
