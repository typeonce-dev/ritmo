# Online multiplayer, rollback, and prediction

**Goal:** every peer runs the same simulation from the same input and agrees on it tick for tick, on every engine, through rollbacks, resyncs, and hidden tabs.

**Principles:** the simulation is the game; each piece of state has an owner and a lifetime; intents in, plain data out; make the next mistake fail loudly. The `@typeonce/ritmo-netcode` README and the `Netcode` module header hold the API; this playbook holds what they assume.

- **A session owns the loop.** Never hand-roll rollback with `runtime.checkpoint` and `runtime.rewind`. Rollback for real-time play, lockstep for turn-based or slow play; client prediction against a server is rollback with the server as seat 0.
- **The simulation is a pure function of seat input.** One schedule every peer ticks the same way, with no `local` state, no service that remembers, and no module variable. A library with its own world enters only through `Checkpoint.rewindable` and only if it is deterministic itself ([`../references/third-party.md`](../references/third-party.md)); rebuild it from components after a resync.
- **Seat 0's save starts every peer.** Only seat 0 sets up the world before the match; every peer restores its save at the first tick and on every resync, so host code that caches entities must survive a restore.
- **Input is held state, read from one seats source.** Remote input never goes through `runtime.send`, and one-frame edges are lost when a frame stalls.
- **A desync is a bug, not noise.** Log every halt; fix the determinism bug a `Desynced` names, don't retry past it.
- **Effects come from `session.events(...)`, never from host systems reading the world's events.** Ticks rolled back publish their events again; the session hands out confirmed, predicted, and withdrawn events so nothing plays twice.
- **A browser tab hides.** Pass the session `hidden` and draw who everyone is waiting for; without it a hidden peer times out the match.

Order matters for the proofs, which come before shipping:

1. A `Netcode.syncTest` over scripted or recorded input, rewinding every tick: it names the first tick a rewind cannot reproduce.
2. A headless match over a seeded faulty `MemoryNetworkLink`, then a fuzzed one (`Fuzz.run` with `network`), which shrinks a desync to the presses that cause it.
3. A committed replay of a scripted match, verified across engines (`ritmo-devtools verify ... --engines node,chromium,webkit,firefox`) in CI: an engine that diverges is a desync waiting to happen between players on those browsers.

**Check:** the sync test passes; the headless match plays every seat with latency, jitter, and loss, rolls back (`status().rollbacks > 0` for rollback), ends with every peer's `runtime.checksum()` equal to one runtime ticked with the recorded inputs, and keeps `status().verified` climbing through a `resync()`; the cross-engine verify passes in CI.
