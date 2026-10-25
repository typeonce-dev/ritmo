# Third-party code in the simulation

The lint rules check the game's code, not its dependencies. Before the simulation calls a library (physics, pathfinding, geometry, noise), and when adding or upgrading one, run `ritmo-devtools scan <entry>` on the simulation entry; the `@typeonce/ritmo-devtools` README says what to do with its findings (vendor and `oxlint --fix`) and how to confirm a clean one.

What the scan cannot see:

- **A library that keeps its own world** (a physics engine) must be deterministic itself across engines to enter through `Checkpoint.rewindable` (Rapier's enhanced-determinism build, Box2D v3). Otherwise keep its state in components and step it with systems.
- **WebAssembly must not import JavaScript's `Math`.** Check the module's imports: a WASM build that calls back into `Math.sin` is not deterministic, whatever its own code does.

**Check:** `ritmo-devtools verify` over a recorded replay agrees on every engine, and a rollback game's `Netcode.syncTest` passes.
