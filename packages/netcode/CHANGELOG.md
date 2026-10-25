# @typeonce/ritmo-netcode

## 0.15.0

### Minor Changes

- c75daff: **Breaking: `Ops` and `Random` moved from `@typeonce/ritmo-math` into `@typeonce/ritmo`.** Determinism belongs to the runtime: every simulation needs same-bits math and a seeded generator, with or without the 2D helpers. The modules are unchanged; only the import path moves, and `@typeonce/ritmo-math` no longer exports them. The `Ops` header now states that its list is closed: the 22 functions engines may approximate and `**`; everything else on `Math` is already exact. `@typeonce/ritmo-devtools` and `@typeonce/ritmo-netcode` no longer depend on `@typeonce/ritmo-math`.

  ```diff
  - import { Ops, Random } from "@typeonce/ritmo-math"
  + import { Ops, Random } from "@typeonce/ritmo"
  - import * as Random from "@typeonce/ritmo-math/Random"
  + import * as Random from "@typeonce/ritmo/Random"
  - import * as Ops from "@typeonce/ritmo-math/Ops"
  + import * as Ops from "@typeonce/ritmo/Ops"
  ```

  `oxlint --fix` with `ritmo/use-ops-for-math` adds the new import where a `Math` call is rewritten; other imports need the path changed by hand.

- b77b17d: **A library that keeps its own world (Rapier, Box2D) can run inside a rewound schedule: `Checkpoint.rewindable`.** `runtime.checkpoint(simulate)` refused any service that is not a `snapshot()` source or plain data, since a rewind would call it again for every tick run again. A rewindable service gives a typed `save` and `restore`: every checkpoint keeps its `save` output (freed when the checkpoint is released), and `runtime.rewind` restores it and makes the result `current`.

  ```ts
  const physics = Checkpoint.rewindable(world, {
    save: (world) => world.takeSnapshot(),
    restore: (bytes) => {
      const restored = RAPIER.World.restoreSnapshot(bytes);
      return restored === undefined
        ? Result.failure({ _tag: "CorruptSnapshot" as const })
        : Result.success(restored);
    },
  });
  const Physics = Descriptor.Service<typeof physics>()("Game/Physics");
  // Systems read `services.physics.current` each run; `runtime.checkpoint(simulate)` compiles.
  ```

  - Cost: one `save` per checkpoint for each rewindable service the runtime was given, one `restore` per rewind. A runtime without one pays nothing.
  - A failing `restore` fails the rewind with the new `RewindError` member `RestoreFailed { service, error }`, changing nothing. `runtime.rewind` types it by each service's name and `restore` error; a runtime without rewindable services never returns it. `RewindError` takes the failures as a parameter (`RewindError<never>` for none); bare `RewindError` covers every runtime. Netcode reports it as `CheckpointLost`.
  - Not in saves or checksums: `runtime.snapshot()` does not include a rewindable service, `runtime.restore(save)` (and a netcode resync) leaves it as it is, and `runtime.checksum()` does not cover it. Mirror what gameplay reads from the library into components.

  **Breaking (types only):** bare `Checkpoint.RewindError` (and so `Netcode.CheckpointLost["error"]`) now includes `RestoreFailed`. An exhaustive `switch` on its `_tag` adds the case; one over `runtime.rewind(...)`'s own result needs nothing for a runtime without rewindable services:

  ```diff
    switch (error._tag) {
      case "OtherRuntime": ...
      case "Released": ...
  +   case "RestoreFailed": console.error(error.service, error.error); break
    }
  ```

- 637fa1f: **Adaptive input delay.** `inputDelay` is a fixed number of ticks, and the right value depends on a connection that changes during a match. Give `adaptiveDelay` instead and the session moves the delay within the bounds from the measured round trip:

  ```ts
  Netcode.rollback(runtime, { ...options, adaptiveDelay: { min: 1, max: 4 } });
  session.status().inputDelay; // the delay in use
  ```

  - The delay starts at `max` and moves to `ceil(roundTripMS / 2 / step ms)` for the slowest other seat (the smoothed round trip), clamped to the bounds, once that target held for 4 measurements in a row (one every 250 ms).
  - Each seat moves only its own delay. Every input message already names its tick, so a change needs no agreement and no protocol change; seats may run different delays. A rise leaves the ticks it skips idle (`seats.idle`); a fall drops the local input for as many frames (`Advanced.input` is `undefined`), so no tick gets two inputs.
  - Every peer must give the same `inputDelay`, or the same `adaptiveDelay.max`: after a save, that many ticks are idle for every seat.
  - Giving both `inputDelay` and `adaptiveDelay` does not compile (`give inputDelay or adaptiveDelay, not both`). Bounds that are not whole numbers with `0 <= min <= max` fail with `InvalidOptions` (`field: "adaptiveDelay"`).
  - `Status` gains `inputDelay` (the delay in use) and `delayChanges` (how many times it moved).
  - `MemoryNetworkLink` links gain `setLatency(ms)`, to change a peer's latency mid-match in tests.
  - The netcode playbook recommends `adaptiveDelay` for play over the internet.
  - **Breaking: `inputDelay` moved from `Netcode.Options` to the new `Netcode.Delay`.** Options passed inline to `rollback` and `lockstep` are unchanged. Where options are typed by hand, add the delay type:

    ```diff
    - const options: Netcode.Options<PlayerInput> = { seats, seat, links, hostClock, step, inputDelay: 3 }
    + const options: Netcode.Options<PlayerInput> & Netcode.Delay = { seats, seat, links, hostClock, step, inputDelay: 3 }
    ```

- 44e9b42: **Effects under rollback: `session.events(Event)` hands host code the simulation's events as confirmed, predicted, and withdrawn streams.** A rolled-back tick runs again and publishes its events again, so a sound played from an event played once per run, and every game de-duplicated events by confirmed tick by hand. A session now owns that: each `session.events(descriptor)` call is one host reader, pulled after the session advanced.

  ```ts
  const hits = session.events(Hit); // an event of the runtime's schema
  for (const { tick } of hits.withdrawn()) particles.cancel(tick); // a rollback undid this tick's hits
  for (const { tick, value } of hits.predicted())
    particles.burst(tick, value.at); // may still be undone
  for (const { value } of hits.confirmed()) sounds.play(value.kind); // exactly once per hit
  const lost = hits.lost(); // EventsLost when the reader fell more than Netcode.eventWindow ticks behind
  ```

  - `confirmed()` hands out each event once, when its tick can no longer run again (a lockstep session confirms every tick it runs). `predicted()` hands out events of ticks that may still be rolled back, stamped with the tick. A tick a rollback runs again keeps what was handed out when its events are the same (plain data, compared by value); otherwise `withdrawn()` names it and its new events are predicted again. A resync withdraws every predicted tick.
  - An event outside the runtime's schema does not compile. `Netcode.Session` takes the schema's events as a third type parameter (`never` by default): a session annotated as `Netcode.Session<Input, TickError>` reads none. Annotate it with the events to read, `Netcode.Session<Input, TickError, typeof Hit>`, or let `Netcode.rollback(...)` infer it.
  - New exports: `EventStreams`, `EventRecord`, `Withdrawn`, `EventsLost`, `eventWindow`.
  - Replaces acting on events once `status().confirmed` passed their tick: the `Checkpoint` docs and the netcode playbook now point to `session.events(...)`.

- 6b0d73e: **Hidden tabs announce themselves instead of timing out.** A browser stops a hidden tab's frames, so its peer went silent and the match ended with `Disconnected { reason: "timeout" }`. Sessions take an optional `hidden` option: the session hears the moment its page hides, tells the others, and they apply the declared policy and show it in the new `status().hidden` (one boolean per seat):

  ```ts
  import { BrowserVisibility } from "@typeonce/ritmo-browser";

  const session = Netcode.rollback(runtime, {
    ...options,
    hidden: {
      visibility: BrowserVisibility.make(document),
      afterMS: 30_000,
      then: "resync-on-return",
    },
  });
  // HUD: session.status().hidden[seat] → "waiting for Ada"
  ```

  - `"stall"`: the others wait for the hidden seat; it goes on from where it stopped when it returns.
  - `"resync-on-return"`: the others play on with idle input for it; on return, seat 0 sends a save and it restores it (its `advance` is `Waiting` meanwhile). While seat 0 itself is hidden, the others wait.
  - A hidden seat that never returns still ends the session with `Disconnected`, at most `afterMS + timeoutMS` after it hid.

  New in netcode: `Visibility` (the contract), `MemoryVisibility` (a page a test hides and shows), `Netcode.HiddenPolicy`, `Netcode.HiddenOptions`. New in browser: `BrowserVisibility.make(document)` over the Page Visibility API.

  **Breaking:** the session protocol is now version 2, so peers on an older version end with `ProtocolMismatch`. Fix: update every peer to the same release.

- 7722666: **`Netcode.syncTest` proves a rollback game rewinds exactly, on one peer with no network.** Each `advance(local)` runs the next tick with seat 0's input (every other seat gets `predict` of its previous one), then forces a rollback of `rewind` ticks and runs them again, comparing the world's checksum at the start of every tick with the first run's. State a rewind cannot put back (a module variable, a service with its own memory) fails with the new `RewindDiffers` error at the first tick whose world differs, carrying both checksums and, with `keepSnapshots: true`, both saves for `Desync.compare` (`@typeonce/ritmo-devtools`). It takes `rollback`'s types, so a schedule that cannot be rewound or a runtime that cannot save does not compile, and a `rewind` deeper than the runtime's checkpoints fails at construction. `status()` counts the forced rollbacks. Run it in the game's tests before shipping:

  ```ts
  const test = Netcode.syncTest(runtime, { simulate, seats, rewind: 8 });
  if (test.ok)
    for (const local of script) expect(test.value.advance(local).ok).toBe(true);
  ```

### Patch Changes

- d01a735: **Zod schemas work with Ritmo: the schema back to the saved form is under `"~encode"`, not `encode`.** Zod (from 4.1) gives every schema an `encode()` method, which Ritmo read as its encode schema: `Descriptor.ConstructedComponent(z.object(...))` did not compile, and with a cast `runtime.snapshot()` threw `Cannot read properties of undefined (reading 'validate')`. The key now starts with `~`, like Standard Schema's own `~standard`, so no library's methods collide with it. A Zod, Valibot, or ArkType schema of plain data passes as it is; Ritmo's tests now save and load a schema of each, and of Effect, through JSON.

  - **Breaking: a codec carries its encode schema as `"~encode"`.** The Effect helper from the skill's `references/effect.md` (or a hand-written codec) renames the key:

    ```diff
     return {
       "~standard": Schema.toStandardSchemaV1(json)["~standard"],
    -  encode: Schema.toStandardSchemaV1(Schema.flip(json))
    +  "~encode": Schema.toStandardSchemaV1(Schema.flip(json))
     }
    ```

    A transforming schema without it fails with `give it a ~encode schema back to the saved form`.

  - **Values that transform** (a `Date`, a `Map`) save through a `"~encode"` from any library. Zod's comes from the new `references/zod.md` helper, built on Zod's own `safeEncode`: `Descriptor.ConstructedComponent(codec(z.codec(z.iso.datetime(), z.date(), { decode, encode })))`. With Valibot, ArkType, or any other Standard Schema library, write the reverse schema by hand:

    ```ts
    const Born = Descriptor.ConstructedComponent({
      "~standard": v.pipe(
        v.string(),
        v.isoTimestamp(),
        v.transform((text) => new Date(text))
      )["~standard"],
      "~encode": v.pipe(
        v.date(),
        v.transform((date) => date.toISOString())
      ),
    })("Game/Born");
    ```

  - **Handles and deadlines inside a game's schema** are built from their guards with a schema that narrows to the guard's type: `z.unknown().refine(Entity.isHandle(Root))` in Zod, `v.pipe(v.unknown(), v.guard(...))` in Valibot, `type("unknown").narrow(...)` in ArkType, `Schema.declare(...)` in Effect. The docs said `z.custom(guard)`, which types the value as `unknown`.

- Updated dependencies [3a195b7]
- Updated dependencies [d01a735]
- Updated dependencies [45458dc]
- Updated dependencies [c75daff]
- Updated dependencies [b77b17d]
- Updated dependencies [c20f20b]
- Updated dependencies [01959dd]
- Updated dependencies [637fa1f]
- Updated dependencies [44e9b42]
  - @typeonce/ritmo@0.15.0

## 0.14.0

### Minor Changes

- dbfbd9d: **New package: `@typeonce/ritmo-netcode`, online multiplayer.** A session per peer exchanges inputs over a `NetworkLink` and ticks the simulation with every seat's input: `Netcode.rollback` runs at once on guesses and rolls back with the runtime's checkpoints when real input contradicts one; `Netcode.lockstep` waits for every seat. Seat 0 starts the match and every resync from one save that every peer restores at the same tick; `session.rate` slows the peer that runs ahead; peers compare checksums of confirmed ticks, and a mismatch stops the session with `Desynced` until `resync()`.

  ```ts
  const seats = Netcode.seats(PlayerInput, { count: 2, idle })                       // the simulation's input source
  const session = Netcode.rollback(runtime, { simulate, seats: seats.value, seat, links: [WebSocketNetworkLink.make(socket)], hostClock, step })
  FixedLoop.start({ ..., rate: session.value.rate, update: session.value.update({ input: readInput, onHalted: report }) })
  ```

  - Transports: `WebSocketNetworkLink.make(socket)` (a relay; the browser's, Node's, Deno's, or Bun's WebSocket), `WebRtcNetworkLink.make(channel)` (between peers), `MemoryNetworkLink.make(...)` (seeded latency, jitter, and loss, for headless tests), or any `{ send, receive, status }`.
  - What does not compile: a rollback simulation that cannot be rewound, one whose requirements the runtime does not provide, and a runtime that cannot save. What fails at construction, as a typed `Result`: a seat out of range, seats another session took or the runtime does not provide, and a `maxRollback` beyond the checkpoints the runtime keeps.
  - The skill's `playbooks/netcode.md` now drives the package instead of a hand-written loop.

  **Core:**

  - `FixedLoop.start` takes `rate`, read once per frame, within `FixedLoop.rateRange` (0.9 to 1.1): how fast host time runs into the accumulator, for a networked session's pacing. A value outside the range stops the loop with an `InvalidRate` failure, a new member of `FixedLoop.Failure`.
  - **`runtime.restore` sets the next entity id to the save's**, where it used to keep the higher of the save's and the runtime's own. The same save restored in two runtimes now allocates the same ids afterwards, whatever each held before; peers of a networked game need it. A handle kept from before a restore may now name an entity spawned after it: drop handles across a restore, as their ids could already name restored entities.

  **Lint:** `keep-simulation-headless` reports `WebSocket`, `RTCPeerConnection`, and `RTCDataChannel` with their own message: online play runs the simulation under a netcode session, and remote input goes through `Netcode.seats`, never `runtime.send(...)`.

  **Devtools:** `Desync.compare(mine, theirs)` lists every difference between two saves of a tick, entities by id and values by path: the report for a `Desynced` session made with `keepSnapshots: true`.

### Patch Changes

- Updated dependencies [c3719a5]
- Updated dependencies [70d054e]
- Updated dependencies [adb4066]
- Updated dependencies [97e95fb]
- Updated dependencies [dbfbd9d]
- Updated dependencies [343660e]
- Updated dependencies [d24258e]
- Updated dependencies [e169263]
- Updated dependencies [cfe332a]
- Updated dependencies [8aa1e85]
  - @typeonce/ritmo@0.14.0
  - @typeonce/ritmo-math@0.14.0
