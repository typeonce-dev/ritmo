# @typeonce/oxlint-plugin-ritmo

## 0.16.1

### Patch Changes

- 8918c31: `ritmo/handle-runtime-result` no longer reports a `tick`, `tryTick`, `restore`, or `rewind` result passed to a function: that function is a helper that checks it (`expectOk(runtime.tick(update))`, `orCrash(runtime.tick(setup), "Setup")`). It still reports one passed to `JSON.stringify`, `String`, or `console.*`, and any unchecked `snapshot()` or `checksum()` result, which is data on its way to a save or a log. Spirit Call's 180 reports on 0.16.0 were all checking helpers.

## 0.16.0

### Minor Changes

- be9af72: **Breaking: `ritmo/handle-tick-result` is `ritmo/handle-runtime-result`, and it also catches a `Result` passed on unchecked.** Besides a dropped `tick`, `tryTick`, `restore`, or `rewind`, it reports `runtime.snapshot()` and `runtime.checksum()`, and any of them handed to a function, printed in a template string, put in an object or array, or used as an operand without a check: a save function that takes `unknown` otherwise stores the `{ ok, value }` wrapper instead of the world. A variable, a field, a `return`, `.ok`, and `void` keep the `Result` for the code to check; a helper that takes the `Result` gets it once it is named.

  Fix: rename the rule in `.oxlintrc.json`, then check each new report.

  ```diff
  -"ritmo/handle-tick-result": "error",
  +"ritmo/handle-runtime-result": "error",
  ```

  ```diff
  -persist(runtime.snapshot())
  +const saved = runtime.snapshot()
  +if (saved.ok) persist(saved.value)
  ```

### Patch Changes

- be9af72: `ritmo/no-float-timers` says what to do with a timer that must stop while the world clock runs (hit-stop, a menu over gameplay): measure it against a second clock that holds, `Clock.resource` advanced by `Clock.system(Game, { name, resource, hold })`, so its deadlines wait with it. Only time scaled by a fraction is a real float, kept with a disable comment that gives the reason. The README and the `Clock.system` JSDoc show the pattern.
- 9290521: Docs from upgrading two games across several versions:

  - The skill's state-and-upgrades playbook lists the breaks that still compile, per version, and `SETUP.md` says a new lint rule is off until `.oxlintrc.json` lists it.
  - The 0.13 `Decode` entry has a table from each `Decode` codec to Zod and Effect; handle schemas use `z.unknown().refine(Entity.isHandle(...))`, not `z.custom`.
  - The `Snapshot.version` JSDoc says how to rewrite a format 2 save; `WorldSnapshot.relations` says targets are sorted by id while each target's sources keep their order.
  - `ritmo-devtools lint`'s `uncovered-simulation-module` message names the usual cause: a host module imported at the top of the lint entry instead of inside `lintTarget`. The README shows a debug script reusing `lintTarget`.
  - The `Replay` docs and the 0.15 changelog say how to keep a playtester's save button without the monitor: `recorder.save(reason)` from a key handler.
  - `Touch.Layout` shows how to draw a layout with no `null` zones, and `Pointer.Actions` says to build test doubles with `Pointer.scripted`.
  - The `use-ops-for-math` example uses `Angle.wrap` for a signed turn, and the spatial-grid reference defines its `made` helper.

## 0.15.0

### Minor Changes

- 3a195b7: **Cooldowns and timers are deadlines: the step they end on, exact through saves and rollback.** A timer counted down by `dt` drifts by a rounded float every tick, and the float it saves means nothing once the fixed step changes. `Clock.Deadline<Hz>` is the absolute step a duration ends on, a plain number branded with the clock's rate:

  ```ts
  // ready: Clock.Deadline<60> | null, its schema narrowing with Clock.isDeadline(step)
  const Weapon = Descriptor.ConstructedComponent(
    z.object({ ready: z.unknown().refine(Clock.isDeadline(step)).nullable() })
  )("Game/Weapon");

  const time = resources.time.get();
  const { ready } = data.weapon.get();
  if (ready === null || Clock.reached(time, ready)) {
    fire();
    data.weapon.set({ ready: Clock.deadline(time, Clock.duration(step, 0.5)) });
  }
  ```

  - `Clock.deadline(time, duration)`, `Clock.reached(time, deadline)`, and `Clock.remaining(time, deadline)` (whole steps left, for a readout). A deadline of a 60 Hz clock does not compile against a 30 Hz `Time`, and a raw number is not a deadline.
  - `Clock.isDeadline(step)` is the guard for a game's schema, like `Entity.isHandle`: any whole number of steps, 0 or more.
  - New lint rule `ritmo/no-float-timers` for simulation files: reports `timer -= dt`, `cooldown - time.dt`, and the like, and names `Clock.deadline` / `Clock.reached`. `position.x += velocity.x * dt` is integration and is not reported. Turn it on in the simulation override of `.oxlintrc.json`: `"ritmo/no-float-timers": "error"`.

- c75daff: **`oxlint --fix` does the whole job for `ritmo/use-ops-for-math`.** The rule points at `Ops` from `@typeonce/ritmo` (it moved from `@typeonce/ritmo-math`), and its fix now adds `import { Ops } from "@typeonce/ritmo"` when the file has none, once per file, after the last import (a `const { Ops } = require("@typeonce/ritmo")` in CommonJS, for vendored code). `x **= y` is fixed to `x = Ops.pow(x, y)` when `x` is a variable. `ritmo/use-random-for-randomness` names `Random` from `@typeonce/ritmo` the same way.

  **Aliasing `Math` is reported.** `const { sin } = Math`, `const M = Math`, passing `Math` to a function, `globalThis.Math.sin`, and `Math[name]` with a computed key hid a non-exact call from the rule; each is now reported (without a fix). Exact members (`Math.PI`, `Math.abs`, `const { floor } = Math`) stay valid.

  **New rule `ritmo/no-brand-cast`.** A cast to a branded type (`raw as ItemId` where `ItemId` comes from `.brand()`, `Schema.brand`, `Brand.Branded`, or a Ritmo brand such as `Random.State` or `Clock.Deadline`) skips the check the brand stands for. The rule reports it in simulation code and names the fix: decode through the schema, or the Ritmo constructor (`Random.seed`, `Clock.deadline`, `Game.Entity.handle`). Turn it on in the simulation override:

  ```json
  {
    "files": ["src/simulation/**"],
    "rules": { "ritmo/no-brand-cast": "error" }
  }
  ```

## 0.14.0

### Minor Changes

- 70d054e: **Rewind a runtime in memory, for rollback netcode and client prediction.** `runtime.checkpoint(simulate)` marks the world between ticks, and `runtime.rewind(checkpoint)` puts it back exactly: ticking `simulate` again gives the same results, bit for bit, as a runtime that never rewound (entity ids, values and their change ticks, relations, scopes, resources, machines, queued commands, unread events, and the read positions of `simulate`'s systems). See the `Checkpoint` module, and the skill's new `playbooks/netcode.md`.

  ```ts
  const history = new Map<number, Checkpoint.Checkpoint<typeof Root>>();
  history.set(tick, runtime.checkpoint(simulate));
  runtime.tick(simulate);

  // Real input for an earlier tick differs from the guess: go back and run again.
  const rewound = runtime.rewind(history.get(wrongTick)!);
  if (!rewound.ok) resync(rewound.error); // Released: older than the window
  ```

  - Taking a checkpoint copies only resources, machines, and queues; the first change to a page of values, an entity, a relation, or a scope after it keeps what it replaced. The runtime keeps the last `checkpoints` (a new option of `Game.Runtime.make`, `Checkpoint.defaultWindow` = 16 by default); an older one, one newer than a checkpoint rewound to, and every one taken before a `restore` fail with `Released`. A checkpoint of another runtime fails with `OtherRuntime`.
  - A schedule that would not rewind does not compile, and the error (`__fixCheckpoint__`) names the fix: a service that is neither an input source (`snapshot()`) nor plain data, a system with `local` state (in its state transitions too), or a schedule widened to a schedule type.
  - Systems and inspectors outside the rewound schedule, like renderers, see a rewind as ordinary changes. An entity the rewind took away and the ticks after it brought back under the same id is seen as changed, never as despawned and spawned again, so `RenderSync` keeps its node.
  - **`runtime.checksum()`**: a fingerprint of what `snapshot()` saves, as 16 hex digits, that does not depend on how the world was built (component order, object key order). Peers compare it to catch a desync; gated like `snapshot`, and returns a `Result`.
  - `Schedule.Source<Data>` and `Schedule.IsPlain<T>`: the input-source shape and the plain-data check that replays and checkpoints share. `Schedule.SystemsIn` is exported.

  **Devtools:**

  - **Breaking: `Replay.Source` and `Replay.IsPlain` moved to core**, as `Schedule.Source` and `Schedule.IsPlain`.

    ```diff
    -const Controls = Descriptor.Service<Replay.Source<Input>>()("Game/Controls")
    +import type * as Schedule from "@typeonce/ritmo/Schedule"
    +const Controls = Descriptor.Service<Schedule.Source<Input>>()("Game/Controls")
    ```

  - **Breaking: replay checkpoint hashes are `runtime.checksum()`.** Replays recorded with an earlier version report every checkpoint as diverged; record them again. A runtime passed to `Replay.recorder` or `Replay.session` needs `checksum`, which every runtime with `snapshot` has.

  **Lint:** `handle-tick-result` also reports a dropped `runtime.rewind(...)` result: a released checkpoint changes nothing, and the ticks meant to run again would run on top of the present.

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

## 0.13.0

### Minor Changes

- 791b52a: **`ritmo/no-state-spread`** reports `_tag` set over a spread of the previous state, such as `{ ...ground, _tag: "air", vy: 2 }`: the old state's fields survive at runtime while the new state's type hides them. Move an entity state with `cell.transition({ from, to, data })`, queue a state machine's move with the new state's fields (`nextMachines.x.set({ _tag, ...fields })`), or write the new state's fields out. Spreads that change fields of the same state are not reported. Turn it on for every file:

  ```jsonc
  "ritmo/no-state-spread": "error"
  ```

### Patch Changes

- 835f6ba: `ritmo/no-infinity-in-simulation-data` no longer names `Decode`: its fix is a nullable number schema from the game's schema library.

## 0.12.0

## 0.11.0

### Patch Changes

- e46f284: **Documentation pass over every public module.** Every export has JSDoc saying what it is for and which neighbouring API to use instead; examples that no longer compiled (`Session.make` without `hostClock`, `Replay.session`, the `Pointer` rebind) are fixed; `Debug.Lint` lists every lint code the runtime emits. The `stale-target` lint's fix now names `queries.x.getHandle(handle)`.

## 0.10.0

### Minor Changes

- 388a696: **The Ritmo skill routes each change to a playbook, and simulation code names no renderer type.**

  - **Breaking: `ritmo/keep-simulation-headless` reports type-only renderer imports** (`import type { Container } from "pixi.js"`, `export type ... from "three"`) and subpath imports of `@typeonce/ritmo-render` and `@typeonce/ritmo-pixi`. A schema that names a renderer type ties the simulation to that renderer. Move the renderer service (a `Descriptor.Service<NodeRegistry.NodeRegistry<Sprite>>()(...)`) and the systems that use it into render code; services are not registered in the schema, so nothing else changes:

    ```diff
    -// src/game/schema.ts
    -import type { Sprite } from "pixi.js"
    -export const Sprites = Descriptor.Service<NodeRegistry.NodeRegistry<Sprite>>()("Game/Sprites")
    +// src/render/sprites.ts
    +import type { Sprite } from "pixi.js"
    +export const Sprites = Descriptor.Service<NodeRegistry.NodeRegistry<Sprite>>()("Game/Sprites")
    ```

  - **The skill in `skills/ritmo` now has playbooks**: one per kind of change (a mechanic, content, UI and rendering, a bug fix, a refactor, state and upgrades), each a short list of steps that ends with the check that proves it. `SKILL.md` routes to them and keeps the principles. A game that already links the skill folder gets them on upgrade.

### Patch Changes

- 7002f4d: **Everything a game's agent needs now ships with the packages, and `ritmo-devtools lint` reports simulation modules the lint rules miss.**

  - **Breaking: `ritmo-devtools lint` fails on an uncovered simulation module.** Every module the entry loads that the `ritmo/keep-simulation-headless` override in `.oxlintrc.json` does not cover is reported as `uncovered-simulation-module`, and the command exits 1. Add the module (or its folder) to the simulation override's `"files"`, or stop importing values from it. Modules loaded only inside `lintTarget` are not checked. Requires Node 22.15 or newer (`engines.node` is now `>=22.15`).
  - **An agent skill ships with `@typeonce/ritmo`** in `skills/ritmo/SKILL.md`, for every change: where the docs are, and principles for where a game's code and state belong. Link it into the folder the game's agent reads skills from, for example `ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo .agents/skills/ritmo`. `SETUP.md` in `@typeonce/ritmo` is the one-time setup: the base packages and checks every game uses, the add-ons, and linking the skill.
  - **Every package ships its `CHANGELOG.md`.** The upgrade notes for 0.8.0 and 0.9.0 are in the `@typeonce/ritmo` changelog.
  - **JSDoc corrections.** Examples no longer provide randomness or time as services (use the `Random` resource and `Clock`), the `Command` module example declares its commands, inspector docs state that `added`/`changed` reads report records since the inspector's previous evaluation, and every example uses prefixed names (`"Game/Position"`). Guidance that lived only in the repository's guides (spawn order, `ReadonlyValue` helpers, re-entering a state, `thisTick` and plugin systems, service effects and rollback) is now in the JSDoc.
  - Package READMEs link other packages' READMEs by GitHub URL, so the links work on npm.

## 0.9.0

### Minor Changes

- 003b902: **New package: `@typeonce/oxlint-plugin-ritmo`, oxlint rules for Ritmo games.**

  Types reject wrong calls and devtools lints reject wrong runs; these rules catch the source patterns neither can see. Every report says what goes wrong and the Ritmo API to use instead.

  Simulation files (listed in an `overrides` entry, so host, render, and unrelated files keep using the platform):

  - `ritmo/use-clock-for-time`: `Date.now()`, `performance.now()`, `new Date()`, and timers; read the `Clock` resource.
  - `ritmo/use-random-for-randomness`: `Math.random()` and `crypto` randomness; draw with `Random.draw(resources.rng)`.
  - `ritmo/use-ops-for-math`: `Math.sin`, `Math.hypot`, `a ** b`, and the other functions engines approximate; use `Ops` (fixes itself once `Ops` is imported).
  - `ritmo/keep-simulation-headless`: page globals, host I/O, and renderer or UI imports; take input and data from the host, draw in a render schedule.
  - `ritmo/no-infinity-in-simulation-data`: `Infinity` and `NaN` in object literals, which cannot be saved and loaded; use `null`.

  Every file:

  - `ritmo/handle-tick-result`: a dropped `runtime.tick(...)`, `tryTick(...)`, or `restore(...)` result.
  - `ritmo/prefix-descriptor-and-system-names`: names without a `Game/` prefix.
  - `ritmo/use-cell-value`: `cell.present ? cell.get() : undefined`; use `cell.value()` (fixes itself).

  ```jsonc
  {
    "jsPlugins": ["@typeonce/oxlint-plugin-ritmo"],
    "rules": { "ritmo/handle-tick-result": "error" },
    "overrides": [
      {
        "files": ["src/sim/**"],
        "rules": { "ritmo/use-ops-for-math": "error" }
      }
    ]
  }
  ```
