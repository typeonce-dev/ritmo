# A rule or mechanic

**Goal:** new or changed behaviour lives in a system that reads and writes declared data, is triggered by intents, and is proven by a headless test.

**Principles:** extend what exists before adding; make impossible states unrepresentable; intents in, plain data out; a handle is not proof the entity is alive.

1. Find the systems, components, and resources the behaviour touches. Extend a system when the behaviour is a variant of what it does; add one only for behaviour no system covers.
2. Name the data before the logic: what the system reads and writes, and where each value lives ([`state-and-upgrades.md`](state-and-upgrades.md)). Declare exactly that access in the system spec. A system that would return early on a mode field is gated instead (`Game.Condition.inState` in `when`); data that exists only in one phase of the behaviour lives on that phase's state.
3. When the player triggers it, add or extend a typed intent and validate it in the system, never in UI code. Input is actions, never keys: the `@typeonce/ritmo-browser` README has the controls and input-source setup that replays and the fuzzer rely on.
4. Before the simulation calls a library (physics, pathfinding, noise), read [`../references/third-party.md`](../references/third-party.md). Many bodies testing each other need a broad phase: [`../references/spatial-grid.md`](../references/spatial-grid.md).
5. Place the system in its schedule (the `Schedule` module header explains markers and `thisTick` reads).

**Check:** a headless test scripts the input (scripted devices, or the intents the UI sends), runs the schedule, and asserts what a player would see; a mechanic that uses time or randomness also passes `Determinism.check` over a scripted run; the game's check passes.
