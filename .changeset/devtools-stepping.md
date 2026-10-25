---
"@typeonce/ritmo": minor
"@typeonce/ritmo-devtools": minor
---

Step one frame a system at a time.

- `session.step(name)` begins one frame of a named schedule and returns a `SteppedFrame`: `until(System)` runs the steps before that system and stops there, `next()` runs exactly one step (a system or a marker), `check()` asks the invariants mid-frame, and `finish()` runs the rest and returns the same `RunResult` as `run(name, { frames: 1 })`, with labels and invariants evaluated at the end of the frame. `until` takes the system value, and only a system the schedule runs as a step compiles. `journal`, `why`, and `dump` show the partial frame.
- Core: `runtime.debug.beginFrame(schedule)` returns a `Debug.FrameCursor` (`next()`, `remaining()`) for the frame `tryTick(schedule)` would run, with the same commits, markers, reader cursors, and trace and host events. While a frame is open, `tick`, `tryTick`, `send`, `snapshot`, `checksum`, `restore`, `checkpoint`, `rewind`, and another `beginFrame` throw; `session.run` and `session.step` throw until `finish()`.
- `Format.step` prints one schedule step.
- `Session.Session` takes a third type parameter, the record of schedules, which `Session.make` infers.
