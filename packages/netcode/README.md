# `@typeonce/ritmo-netcode`

Online multiplayer for ritmo: peers that run the same simulation and agree on it. A session per peer exchanges inputs over any transport and ticks the simulation with every seat's input: `Netcode.rollback` runs at once on guesses and rolls back when real input contradicts one (with the runtime's checkpoints); `Netcode.lockstep` waits for every seat's input. Sessions start and resync every peer from one save, pace the peer that runs ahead, and compare checksums to catch a desync the tick it happens.

```sh
pnpm add @typeonce/ritmo-netcode @typeonce/ritmo
```

The package carries no server and opens no connection: a `NetworkLink` wraps one the game made. `WebSocketNetworkLink.make(socket)` (to a relay that forwards every message to the other peers) and `WebRtcNetworkLink.make(channel)` (straight between peers) ship here; any other transport, an Effect `Socket` for example, implements the three methods of `NetworkLink`. `MemoryNetworkLink.make(...)` joins peers in one process with seeded latency, jitter, and loss, for headless tests.

```ts
import { Descriptor, FixedLoop } from "@typeonce/ritmo"
import { BrowserHostClock, BrowserTickSource, InputCapture } from "@typeonce/ritmo-browser"
import { Netcode, WebSocketNetworkLink } from "@typeonce/ritmo-netcode"

// The simulation reads every seat's input from one source, captured once per tick.
const Seats = Descriptor.Service<Netcode.Source<PlayerInput>>()("Game/Seats")
const Inputs = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof Seats>>()("Game/Inputs")
const Capture = InputCapture.system(Game, { name: "Game/Capture", source: Seats, resource: Inputs })
const simulate = Game.Schedule(Capture, Move, Fire)

// PlayerInput here is the game's own Standard Schema: remote input is decoded with it.
const seats = Netcode.seats(PlayerInput, { count: 2, idle: { dx: 0, fire: false } })
if (!seats.ok) throw new Error(seats.error.reason)
const runtime = Game.Runtime.make({
  services: Game.Runtime.services(Game.Runtime.service(Seats, seats.value.source)),
  resources: { ... }
}).value

const session = Netcode.rollback(runtime, {
  simulate,
  seats: seats.value,
  seat: 0, // seat 0 hosts: it starts the match and answers resyncs
  links: [WebSocketNetworkLink.make(socket)],
  hostClock: BrowserHostClock.make(window),
  step
})
if (!session.ok) throw new Error(session.error.reason)

FixedLoop.start({
  source: BrowserTickSource.make(window), step, maxFrameSeconds: 0.25, maxStepsPerFrame: 5,
  rate: session.value.rate, // slows this peer while it runs ahead of the others
  // Advances the session each step. A halt (a desync, a failed tick) is reported and answered with a resync.
  update: session.value.update({ input: readLocalInput, onHalted: (error) => console.error(error) }),
  render: () => runtime.tick(draw),
  onFailure: (failure) => showDisconnected(failure) // the session ended: a peer left, or the peers run different versions
})
```

## Input delay

A session records the local input for a tick a few ticks ahead (`inputDelay`, 2 by default): a little lag that lets the input reach the other peers before its tick runs, so rollback guesses less often and lockstep waits less. The right value depends on the connection, which changes during a match. Give `adaptiveDelay` instead and the session moves the delay with the measured round trip:

```ts
Netcode.rollback(runtime, { ...options, adaptiveDelay: { min: 1, max: 4 } })
session.status().inputDelay // the delay in use; status().delayChanges counts moves
```

It starts at `max` and moves to `ceil(roundTripMS / 2 / step ms)` (the round trip to the slowest other seat, smoothed), clamped to the bounds, once that target held for 4 measurements in a row (one every 250 ms), so a noisy link does not move it back and forth. Each seat moves only its own delay: every input message names its tick, so peers never agree on a change and seats may run different delays. A rise leaves the ticks it skips idle (`seats.idle`); a fall drops the local input for as many frames (`Advanced.input` is `undefined`). Giving both `inputDelay` and `adaptiveDelay` does not compile. Every peer must give the same `inputDelay`, or the same `adaptiveDelay.max`: after a save, that many ticks are idle for every seat.

In tests, `link.setLatency(ms)` on a `MemoryNetworkLink` changes a peer's latency mid-match.

What does not compile: a rollback `simulate` that cannot be rewound (a service with effects, `local` state; a library that keeps its own world, like a physics engine, is provided through `Checkpoint.rewindable` from `@typeonce/ritmo` instead), a schedule whose requirements the runtime does not provide, and a runtime that cannot save (a component or resource without a schema), and both `inputDelay` and `adaptiveDelay`. What fails at construction, as a typed `Result`: a seat out of range, seats the runtime does not provide or another session took, and a `maxRollback` larger than the checkpoints the runtime keeps.

## Effects under rollback

A rollback runs ticks again, and a tick run again publishes its events again: a sound played from an event would play once per run. Host code (sound, particles, a message to a server) reads the simulation's events through the session, one reader per place that acts on them:

```ts
const hits = session.events(Hit) // an event of the runtime's schema; one reader per call

// After each frame's steps (in FixedLoop's render):
for (const { tick } of hits.withdrawn()) particles.cancel(tick) // a rollback undid this tick's hits
for (const { tick, value } of hits.predicted()) particles.burst(tick, value.at) // may still be undone
for (const { value } of hits.confirmed()) sounds.play(value.kind) // exactly once per hit
const lost = hits.lost() // a reader that stopped reading: EventsLost, never silent
```

- `confirmed()` hands out each event once, when its tick can no longer run again. A lockstep session confirms every tick it runs.
- `predicted()` hands out events of ticks that may still be rolled back. A tick a rollback runs again keeps what was handed out when it publishes the same events (plain data, compared by value); otherwise it is withdrawn and its new events are predicted again.
- `withdrawn()` names those ticks, so the host cancels what it started. A resync withdraws every predicted tick. A tick waiting to be withdrawn is held back from `predicted()` until `withdrawn()` named it, so a cancel never undoes the new run.
- A reader that does not call `confirmed()` for more than `Netcode.eventWindow` ticks loses the oldest: `lost()` reports them as `EventsLost`.

When checksums differ, `advance` fails with `Desynced` until `resync()`. With `keepSnapshots: true` it carries this peer's save of that tick; `Desync.compare(mine, theirs)` from [`@typeonce/ritmo-devtools`](https://github.com/typeonce-dev/ritmo/blob/main/packages/devtools/README.md) lists what differs.

## Hidden tabs

A browser stops a hidden tab's animation frames, so that peer sends nothing, and after `timeoutMS` the others end with `Disconnected`. With the `hidden` option, the session hears the moment its page hides (`Visibility`, a contract: `BrowserVisibility.make(document)` from [`@typeonce/ritmo-browser`](https://github.com/typeonce-dev/ritmo/blob/main/packages/browser/README.md), `MemoryVisibility.make()` in tests), tells the others, and they apply the policy:

```ts
const session = Netcode.rollback(runtime, {
  ...options,
  hidden: { visibility: BrowserVisibility.make(document), afterMS: 30_000, then: "resync-on-return" }
})
// The HUD: session.status().hidden[seat] is true while that seat's tab is hidden ("waiting for Ada").
```

- `"stall"`: the others wait for the hidden seat's input, as for a slow one (rollback runs `maxRollback` ticks on guesses, then stalls), and it goes on from where it stopped when it shows again.
- `"resync-on-return"`: the others play on with idle input for the hidden seat after its last sent input. When it shows again, seat 0 sends a save and it restores it, as in `resync()`; until then its `advance` is `Waiting`. Seat 0 is never played around, since every save is its world: while seat 0 is hidden, the others wait for it.

The bound: a hidden seat's silence counts only after `afterMS`, so a seat that hides and never returns (the tab was closed) ends the session with `Disconnected` at most `afterMS + timeoutMS` after it hid. Every peer passes the same `afterMS` and `then`; without `hidden`, a hidden peer is silent and times out as before. The session unsubscribes from the visibility once it ends. On return, `FixedLoop` drops the hidden time beyond `maxFrameSeconds` and `maxStepsPerFrame`, so the loop does not burst through the missed frames. Pausing a single-player game on a hidden tab is the game's own policy (read `BrowserVisibility` in host code).

## Sync test

A rollback game is only as good as the code it rewinds. `Netcode.syncTest` runs one peer with no network, forces a rollback of `rewind` ticks after every tick, runs those ticks again with the same input, and compares the world's checksum at the start of each one with the first run's. State a rewind cannot put back (a module variable, a service with its own memory) fails the test on the first tick it matters, where two real peers would only desync later. Run it in the game's tests before shipping:

```ts
const test = Netcode.syncTest(runtime, { simulate, seats: seats.value, rewind: 8, keepSnapshots: true })
if (!test.ok) throw new Error(test.error.reason)
for (const local of scriptedInput) {
  const advanced = test.value.advance(local) // seat 0's input; every other seat gets `predict` of its previous one
  if (!advanced.ok && advanced.error._tag === "RewindDiffers") {
    // The world at the start of `tick` differs: tick `tick - 1` read state outside the world.
    console.log(advanced.error.tick, Desync.compare(advanced.error.snapshots!.expected, advanced.error.snapshots!.actual).text)
  }
}
```

It takes `rollback`'s types: a `simulate` that cannot be rewound, or a runtime that cannot save, does not compile here either, and a `rewind` deeper than the runtime's checkpoints fails at construction. `status()` counts the forced rollbacks. A failure (`RewindDiffers`, `TickFailed`, `CheckpointLost`, or `SyncFailed` when the world does not checksum) is final: fix the game. To shake out two peers over a faulty network, `Fuzz.run` with `network` in [`@typeonce/ritmo-devtools`](https://github.com/typeonce-dev/ritmo/blob/main/packages/devtools/README.md) drives `rollback` sessions over a seeded `MemoryNetworkLink`.

Released together with [`@typeonce/ritmo`](https://github.com/typeonce-dev/ritmo/blob/main/packages/core/README.md), always with the same version.

Source: https://github.com/typeonce-dev/ritmo
