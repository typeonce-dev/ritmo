---
"@typeonce/ritmo-devtools": minor
---

**`Fuzz.run` finds a bug before anyone plays into it, and shrinks it to a replay.** It builds a fresh simulation per run with the same `make(playback)` factory `Replay.session` opens replays with, feeds each fuzzed `snapshot()` source a value drawn from a seeded `Random` (from `@typeonce/ritmo`) every frame, and ticks the schedule in a `Session` until an invariant breaks, a system fails, or something throws. The failing timeline is then shrunk by delta debugging (ranges of frames dropped, then each value moved toward the input's `neutral`), re-running the simulation for every candidate, and returned as a `Found` error carrying the shrunk `Replay.ReplayFile`, the run's seed, the failing frame, and the shrink statistics; `Flaky`, `InvalidOptions`, and `Unreplayable` are the other failures. Declare an input with `Fuzz.input(Source, { generate: (random, frame) => value, neutral })`; the value is typed as the source's. `Replay.session(make, file, { invariants })` now checks invariants on every replayed tick, so the shrunk replay plays to the same violation and becomes the regression test. `Replay.Target` gains optional type parameters for the schedules and provisions, so the invariants are checked against the runtime at compile time.

```ts
const found = Fuzz.run(make, { schedule: "update", setup: "setup", inputs: [Fuzz.input(PadInput, { generate, neutral: { key: 0 } })], invariants: [Alive], frames: 3000, seed: 7 })
if (!found.ok && found.error._tag === "Found") sink.save(found.error.replay)
```
