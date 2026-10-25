# Bug fix

1. Reproduce headless before changing code: build the simulation on a runtime made with `debug: { hostClock: HostClock.test() }`, script the input, and drive it with a `Session` from `@typeonce/ritmo-devtools` (its README has the loop).
2. Read the lints at the top of `describe()` first; they often name the cause.
3. Give the session `labels` for the entities the bug report mentions (the player, the enemy that clips through a wall), so every line names them. Encode the bug as an `Invariant` and `run` until it breaks. Explain the wrong value with `why(entity, Component)` and `journal(...)`.
   - When the wrong value appears within one frame, step it: run to the frame before, then `session.step("update")`, `until(System)` stops before the system you suspect, `dump` / `why` show the world there, `next()` runs one step, `finish()` reports the frame as `run` does.
4. When the input that breaks it is unknown, fuzz it: `Fuzz.run(make, { schedule, inputs: [Fuzz.input(Source, { generate, neutral })], invariants, frames, seed })` with the replay factory (a browser game's `Source` is its `InputCapture.SourceOf<...>` controls service, drawn with `Actions.random(random, devices)` and resting at `Actions.idle(devices)`). A `Found` error carries a shrunk `replay`; save it, and the test is `Replay.session(make, file, { invariants }).play()` stopping at the invariant until the fix. `Flaky` means the simulation reads something besides its input: run `Determinism.check` first.
5. When a script cannot reproduce it, record a play session with `Replay.recorder` in the dev build and open the file headless with `Replay.session`.
6. Fix the system that writes the wrong value. Never patch the symptom in UI or render code.
7. Turn the reproduction into a test next to the game.
8. When the same class of bug could come back, encode it: a type, a lint rule in the game's config, or an invariant in the tests.
   - When the wrong value was an impossible combination (a grounded body that still moves up, hitstun outside a hit), fix the model rather than adding a guard: make the states a `Descriptor.EntityState`, so the combination cannot be written.

**Done when** the test fails without the fix, passes with it, and the game's check passes.
