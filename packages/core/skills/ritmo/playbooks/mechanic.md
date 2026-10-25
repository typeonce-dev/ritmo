# A rule or mechanic

1. Find the systems, components, and resources the behaviour touches. Extend a system when the behaviour is a variant of what it already does; add one only for behaviour no system covers.
2. Name the data before the logic: what the system reads and writes, and where each value lives (see [`state-and-upgrades.md`](state-and-upgrades.md)). Declare exactly that access in the system spec.
   - A system that starts with an early return on a mode field (`if (run.phase !== "playing") return`) is gated instead: the mode is a `Game.StateMachine`, and the system or its group is gated with `Game.Condition.inState` in `when`.
   - A field that means something only for one kind or phase (a nullable `target` next to `kind`, a `revive` timer that matters only while `hp <= 0`) is a sign the record is several states: split it into a `Descriptor.EntityState` (per entity) or a `Game.StateMachine` (game-wide) whose states hold only their own fields.
   - Data that exists only in one phase of the behaviour (a windup timer, a launch speed) lives on that phase's state of a `Descriptor.EntityState`. A system moves between phases with `transition`, which takes the new phase's fields; a pure function returns the new phase's value written out from its own fields, never a spread of the previous phase. Either way nothing from the previous phase survives.
   - A cooldown, timer, or anything that ends after a while is a deadline: store `Clock.deadline(time, duration)` (the step it ends on, `null` while nothing is pending) and check `Clock.reached(time, ready)` each tick. Never count a float down by `dt`: it drifts, and its saved value means nothing once the step changes. Something that repeats is `Clock.every(time, duration)`.
3. When the player triggers it, add or extend a typed intent (a host event sent with `runtime.send(...)`, or the input resource) and validate it in the system, never in UI code.
   - Input is actions, never keys: add the action to the game's `Controls.actions({ buttons, vectors })` (a button for jump, a vector for movement), bind it on every device (or mark the device with `lacking`; a game with one device only binds it there), and read `input.actions.<name>` or `input.vectors.<name>` from the resource `InputCapture.system` writes. Never call a source's `snapshot()` in a system: it drains the source. In a local multiplayer game (`Controls.players`), read each player's slot (`input.p1.actions.<name>`).
4. A system that despawns while looping still sees the entity in its queries until `applyDeferred()`; skip what it despawned this run (see `despawn`'s JSDoc).
5. Place the system in its schedule. The `Schedule` module header explains markers and `thisTick` reads.
6. Write a headless test: script the input (`Keyboard.scripted`, `Gamepad.scripted`, `Gamepad.scriptedPads` for several pads, or the same intents the UI sends), run the schedule, and assert the outcome a player would see.
7. When the mechanic uses time or randomness, add a `Determinism.check` over a scripted run.

**Done when** the headless test passes and the game's check passes.
