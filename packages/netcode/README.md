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

What does not compile: a rollback `simulate` that cannot be rewound (a service with effects, `local` state; a library that keeps its own world, like a physics engine, is provided through `Checkpoint.rewindable` from `@typeonce/ritmo` instead), a schedule whose requirements the runtime does not provide, and a runtime that cannot save (a component or resource without a schema). What fails at construction, as a typed `Result`: a seat out of range, seats the runtime does not provide or another session took, and a `maxRollback` larger than the checkpoints the runtime keeps.

When checksums differ, `advance` fails with `Desynced` until `resync()`. With `keepSnapshots: true` it carries this peer's save of that tick; `Desync.compare(mine, theirs)` from [`@typeonce/ritmo-devtools`](https://github.com/typeonce-dev/ritmo/blob/main/packages/devtools/README.md) lists what differs.

Released together with [`@typeonce/ritmo`](https://github.com/typeonce-dev/ritmo/blob/main/packages/core/README.md), always with the same version.

Source: https://github.com/typeonce-dev/ritmo
