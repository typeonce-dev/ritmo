---
"@typeonce/ritmo-browser": minor
"@typeonce/ritmo-devtools": minor
---

**Browser input replays and fuzzes through the one descriptor the page reads.** A game that declared its input service as the whole `Controls` merge (or a device) could not be opened from a replay or fuzzed: `playback.source(...)` hands back a plain `snapshot()` source, which has no `rebind` or `dispose`. Declare the service as `InputCapture.SourceOf<...>` the merge, device, or pool (its `snapshot()` only, still marked as draining, so systems keep reading the captured resource). The live merge provides it in the page, scripted devices in tests, `playback.source(ControlsInput)` in a replay, and `Fuzz.input` in the fuzzer; the page keeps the merge to rebind and dispose it.

```ts
const ControlsInput = Descriptor.Service<InputCapture.SourceOf<ReturnType<typeof makeControls>>>()("Game/Controls")
const devices = { keyboard: Keyboard.idle(keys), gamepad: Gamepad.idle(pad) }
const Fuzzed = Fuzz.input(ControlsInput, { generate: (random) => Actions.random(random, devices), neutral: Actions.idle(devices) })
```

- `Controls.actions(...).random(random, devices)` draws a merged snapshot a real merge could report: each button idle, held, just pressed, tapped, or just released, and each vector zero, one of eight directions, or a tilt shorter than 1. Device data stays as given, every action is available, and no device is last used.
- `Controls.players(...).random(random, frame, { devices, seats })` draws a pool's snapshot with the listed slots seated from frame 1 (reporting `event: "joined"` there, with idle input, as `pool.seat` in setup does) and their input drawn after. A pool is one source carrying every slot, because one `snapshot()` drains every pooled device and decides joins across them.
- `Replay.Playback.source` and `Fuzz.input` take any `snapshot()`-only source service, including ones that mark `snapshot()` with `System.Consumes` (`InputCapture.SourceOf`, `Netcode.Source`). A service declared as the whole device is a compile error naming the fix: "has more than snapshot(), so a replay cannot provide it". `Replay.SourceData<Value>` names the data a source returns.
