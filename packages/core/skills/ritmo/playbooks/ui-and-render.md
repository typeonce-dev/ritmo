# UI, readouts, and rendering

**Goal:** what is drawn reads the world as plain view data through one projection, and could be replaced without touching the simulation.

**Principles:** the simulation is the game; intents in, plain data out; each piece of state has an owner and a lifetime.

1. Find the projection: the one place the world is read into view data (an inspector run with `runtime.inspect(...)`, or a system writing a transient resource). Add the new fields there; if the game has none, add one instead of reading queries from UI code.
2. Give each UI piece a narrow view model and intent callbacks, not the runtime or a whole host object. Player actions go back as intents ([`mechanic.md`](mechanic.md), step 3).
3. Mirror entities into a renderer through `@typeonce/ritmo-render` (its README); the simulation names no renderer type. A part that is an entity and moves with another is a child entity in a hierarchy, composed by the renderer, never a node attached by hand or a world position computed for drawing. A part that is not an entity (a procedural limb, a trail) is render state (step 4): computed from view data each frame, never written back.
4. Render-only state (animation timers, effects, camera easing) stays in render code, a transient resource, or a system's `local`, with a decision for what it does when a save loads. Cosmetic randomness (shake, particles) draws from its own `Random.make` stream, never the world's random resource: a render system that writes that resource changes the simulation and breaks replays.
5. Lint the import direction: the simulation imports no UI or render code, and each host folder gets a `no-restricted-imports` rule whose message says where the code belongs.

**Check:** the simulation's headless tests pass unchanged, and the game's check passes.
