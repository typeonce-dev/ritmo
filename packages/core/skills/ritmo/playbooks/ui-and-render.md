# UI, readouts, and rendering

1. Find the projection: the one place the world is read into plain view data for UIs and renderers (an inspector run with `runtime.inspect(...)`, or a system writing a transient resource). Add the new fields there. If the game has none, add one instead of reading queries from UI code.
2. Give each UI piece a narrow view model and intent callbacks, not the runtime or a whole host object.
3. Send player actions back as intents ([`mechanic.md`](mechanic.md), step 3). UI and render code never change saved world state.
4. Mirror entities into a renderer with `RenderSync` and a `NodeRegistry` service declared in render code. The schema and simulation name no renderer type, so another renderer can replace this one. For parts that move with an entity (a turret on a tank, a label over a head), make them child entities in a `Descriptor.Hierarchy` with a local `Position`, and pass `hierarchy` to `RenderSync.system`: the renderer composes the transforms. Do not add the child's node to its parent's node by hand, or compute world positions in a system for drawing.
5. Keep render-only state (animation timers, effects, camera easing) in render code, a transient resource, or a system's `local`, and decide what it does when a save loads.
6. Lint the import direction: the simulation imports no UI or render code, and each host folder gets a `no-restricted-imports` rule whose message says where the code belongs.

**Done when** the simulation's headless tests pass unchanged and the game's check passes. A second UI or renderer would need no change to the simulation.
