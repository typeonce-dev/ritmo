# Online multiplayer, rollback, and prediction

**Goal:** every peer runs the same simulation from the same input and agrees on it tick for tick, on every engine, through rollbacks, resyncs, and hidden tabs.

**Principles:** the simulation is the game; each piece of state has an owner and a lifetime; intents in, plain data out; make the next mistake fail loudly. The `@typeonce/ritmo-netcode` README and the `Netcode` module header hold the API; this playbook holds what they assume.

- **A session owns the loop.** Never hand-roll rollback with `runtime.checkpoint` and `runtime.rewind`. Rollback for real-time play, lockstep for turn-based or slow play; client prediction against a server is rollback with the server as seat 0.
- **The simulation is a pure function of seat input.** One schedule every peer ticks the same way, with no `local` state, no service that remembers, and no module variable. A library with its own world enters only through `Checkpoint.rewindable` and only if it is deterministic itself ([`../references/third-party.md`](../references/third-party.md)); rebuild it from components after a resync.
- **Seat 0's save starts every peer.** Only seat 0 sets up the world before the match; every peer restores its save at the first tick and on every resync, so host code that caches entities must survive a restore.
- **Input is held state, read from one seats source.** Remote input never goes through `runtime.send`, and one-frame edges are lost when a frame stalls.
- **A desync is a bug, not noise.** Log every halt; fix the determinism bug a `Desynced` names, don't retry past it.
- **Effects come from `session.events(...)`, never from host systems reading the world's events.** Ticks rolled back publish their events again; the session hands out confirmed, predicted, and withdrawn events so nothing plays twice.
- **A browser tab hides.** Pass the session `hidden` and draw who everyone is waiting for (`status().hidden`, `status().waiting`); without it a hidden peer times out the match.
- **A seat leaves and the match plays on.** What a seat without a driver does is a rule of the game, so it lives in the simulation: give `Netcode.seats` a `left` input no player can send, and let one system read it (park it, remove it, hand it to a bot). Never decide it in host code from `status().left`: that is for the HUD, and peers would disagree.
- **Tell the session what the transport knows.** A relay sees a socket close at once: pass it on with `session.drop(seat)`, or every player waits `timeoutMS` behind a stall. Wait before calling it only if a short disconnect should stall the match instead of costing the seat.
- **`onFailure` means this page is out, or alone.** `Disconnected.who` says which, and each gets its own message. Other seats leaving never reach it.
- **A link sends each message as it is.** A session says one message per link per host frame when `session.update` drives it, however many steps the frame ran, and repeats what a lossy link lost, so a link adds no outbox, batching, or copies of its own. A game's own `update` that wraps `session.update` passes the loop's two arguments through. Measure with `status().sent`, and keep the input's saved form small: it is what goes over the wire.
- **A page that comes back builds its session again.** After a reload, make the runtime and the session for the same seat: the match seats it with a save. Nothing of the old page carries over.

Order matters for the proofs, which come before shipping:

1. A `Netcode.syncTest` over scripted or recorded input, rewinding every tick: it names the first tick a rewind cannot reproduce.
2. A headless match over a seeded faulty `MemoryNetworkLink`, then a fuzzed one (`Fuzz.run` with `network`), which shrinks a desync to the presses that cause it. With more than two seats, both again with seats that leave: close a seat's link and stop advancing it, and fuzz with `network.leave`.
3. A committed replay of a scripted match, verified across engines (`ritmo-devtools verify ... --engines node,chromium,webkit,firefox`) in CI: an engine that diverges is a desync waiting to happen between players on those browsers.

**Check:** the sync test passes; the headless match plays every seat with latency, jitter, and loss, rolls back (`status().rollbacks > 0` on the peer ahead, for rollback), ends with every peer's `runtime.checksum()` equal to one runtime ticked with the recorded inputs, and keeps `status().verified` climbing through a `resync()`; with more than two seats, the peers still playing keep running and agreeing after one leaves, the host too; the cross-engine verify passes in CI.
