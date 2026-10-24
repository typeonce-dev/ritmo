# @typeonce/ritmo-devtools

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

### Patch Changes

- 01681a3: **The `ritmo-devtools lint` docs put the entry beside the simulation** (`src/lint.ts`), loading the render and audio schedules inside `lintTarget`. With the entry inside the simulation, `describe` made the simulation import host code, which a game's own import rules forbid. The CLI already treated the entry as host code; the docs now say so.
- Updated dependencies [c3719a5]
- Updated dependencies [70d054e]
- Updated dependencies [adb4066]
- Updated dependencies [97e95fb]
- Updated dependencies [dbfbd9d]
- Updated dependencies [343660e]
- Updated dependencies [d24258e]
- Updated dependencies [cfe332a]
- Updated dependencies [8aa1e85]
  - @typeonce/ritmo@0.14.0

## 0.13.0

### Minor Changes

- b3d6502: **Machine values print with their fields.** Dumps, `describe()`, the monitor, and the journal print a machine as its state, then its fields (`Talking {speaker:"Mira",page:2}`), through the new `Format.state(value)`. A system's access lists `updates machine fields` for `Game.System.updateMachine`, and each immediate update is a journal line of the new kind `"machine"` (`machine Game/Mode {...} -> {...}`), filterable with `journal({ kinds: ["machine"] })`.
- 835f6ba: **Replays follow `runtime.snapshot()` returning a `Result`.** `Replay.Target`'s and `ReplaySession`'s `snapshot` return `Result<WorldSnapshot, SnapshotError>`, the recorder skips a tick whose world an `encode` rejects, and `extract` fails with the new `SnapshotFailed` when its start cannot be saved. **Breaking** for a custom `Replay.Target`: return the runtime's `snapshot()` result as it is.

### Patch Changes

- Updated dependencies [791b52a]
- Updated dependencies [b3d6502]
- Updated dependencies [835f6ba]
  - @typeonce/ritmo@0.13.0

## 0.12.0

### Minor Changes

- 04a2ac7: **A described-only schedule named like a runnable one is a type error, and system descriptions show who drains a service.**

  - **`Session.make` no longer throws for a name in both `schedules` and `describe`**: it does not compile (`already a runnable schedule in schedules`). Such a call already failed at runtime; rename the described-only schedule:

    ```diff
    -Session.make(runtime, { hostClock, schedules: { update }, describe: { update: render } })
    +Session.make(runtime, { hostClock, schedules: { update }, describe: { render } })
    ```

  - `Format.system` (and `session.system(name).text`) prints the services a system drains on their own line, `consumes (drains each run): ...`, apart from the `services` it only calls, so a "where did my input go" question has an answer in the description.

### Patch Changes

- Updated dependencies [04a2ac7]
  - @typeonce/ritmo@0.12.0

## 0.11.0

### Patch Changes

- e46f284: **Documentation pass over every public module.** Every export has JSDoc saying what it is for and which neighbouring API to use instead; examples that no longer compiled (`Session.make` without `hostClock`, `Replay.session`, the `Pointer` rebind) are fixed; `Debug.Lint` lists every lint code the runtime emits. The `stale-target` lint's fix now names `queries.x.getHandle(handle)`.
- Updated dependencies [778301a]
- Updated dependencies [866bcff]
- Updated dependencies [e46f284]
  - @typeonce/ritmo@0.11.0

## 0.10.0

### Minor Changes

- 7002f4d: **Everything a game's agent needs now ships with the packages, and `ritmo-devtools lint` reports simulation modules the lint rules miss.**

  - **Breaking: `ritmo-devtools lint` fails on an uncovered simulation module.** Every module the entry loads that the `ritmo/keep-simulation-headless` override in `.oxlintrc.json` does not cover is reported as `uncovered-simulation-module`, and the command exits 1. Add the module (or its folder) to the simulation override's `"files"`, or stop importing values from it. Modules loaded only inside `lintTarget` are not checked. Requires Node 22.15 or newer (`engines.node` is now `>=22.15`).
  - **An agent skill ships with `@typeonce/ritmo`** in `skills/ritmo/SKILL.md`, for every change: where the docs are, and principles for where a game's code and state belong. Link it into the folder the game's agent reads skills from, for example `ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo .agents/skills/ritmo`. `SETUP.md` in `@typeonce/ritmo` is the one-time setup: the base packages and checks every game uses, the add-ons, and linking the skill.
  - **Every package ships its `CHANGELOG.md`.** The upgrade notes for 0.8.0 and 0.9.0 are in the `@typeonce/ritmo` changelog.
  - **JSDoc corrections.** Examples no longer provide randomness or time as services (use the `Random` resource and `Clock`), the `Command` module example declares its commands, inspector docs state that `added`/`changed` reads report records since the inspector's previous evaluation, and every example uses prefixed names (`"Game/Position"`). Guidance that lived only in the repository's guides (spawn order, `ReadonlyValue` helpers, re-entering a state, `thisTick` and plugin systems, service effects and rollback) is now in the JSDoc.
  - Package READMEs link other packages' READMEs by GitHub URL, so the links work on npm.

### Patch Changes

- Updated dependencies [7002f4d]
- Updated dependencies [388a696]
  - @typeonce/ritmo@0.10.0

## 0.9.0

### Patch Changes

- c2c32e0: **API additions from a second review.**

  - **Writes take what reads return.** `set`, `update`, `emit`, `runtime.send`, `Command.entry`, and plain `[Descriptor, value]` entries accept `ReadonlyValue<T>`, so a value read from one cell (deeply readonly) can be written to another without a copy or a cast.
  - **`Clock.durationOfSteps(step, n)`** builds a duration from a whole number of steps, instead of a round trip through seconds and `durationRaw`. A literal zero, negative, or fractional count does not compile; a computed one throws.
  - **`Game.Entity.id(handle)`** returns the entity id a handle names, so games no longer store the id beside the handle.
  - **Save migrations.** `Game.Runtime.make({ saves: Snapshot.migrations(Snapshot.migration(1, ...), Snapshot.migration(2, ...)) })`: snapshots carry a `gameVersion` (the last step; 0 without migrations and for older saves), and `restore` runs every step after the save's version in order, checking the structure after each, before validating as usual. A save newer than the last step fails with `NewerGameVersion`. Steps must be numbered 1, 2, 3, ... in order (checked at compile time and at runtime).
  - **Docs** now state that a system does not see its own writes as changes (it does see its own events), how long `Condition.stateChanged` holds, that a sub-state value set at the marker its parent leaves is dropped, and that `restore` keeps a current resource the save lacks.

- d47a4f9: **Runtime fixes from a review of 0.8.0.** No API changes; each fix restores what the docs already promised.

  - **Sub-states enter with their parent.** A sub-state now gets its entry value at the parent's commit, before any `onEnter` schedule runs. A failing `onEnter` of the parent no longer leaves it without a value (`inState` false and `set` failing with `SubStateInactive` until the parent came back), and its `despawnOnEnter` scopes no longer despawn what the parent's `onEnter` just spawned. The `onEnter` schedules still run parents first.
  - **A queued transition survives a transition schedule setting the same machine.** A value queued before `applyStateTransitions(...)` is committed there even when an `onEnter` / `onExit` of an earlier machine also calls `set` on it; that newer value waits for the next marker.
  - **`snapshot` and `restore` throw while a schedule is running**, like `send`. A restore from a system let its queued spawns overwrite restored entities, and a snapshot captured writes a failing system then rolled back. `tryTick` now sets the same guard, so `send` inside `tryTick` throws too.
  - **`restore` rejects an unknown scope name** with the new `UnknownScope` error, instead of putting entities in a scope nothing can name.
  - **`describe()` counts reads inside `Query.anyOf`**, so `component-never-read` no longer fires for a component read only through `anyOf`, and `read-before-write` sees it. A system placed directly and under `Schedule.when` / `pauseWhen` is one entry with both placements and the conditions of each.
  - **`Collide2` stops a circle that starts exactly touching a wall** and moves into it, instead of moving it through the wall: `sweepCircleBox` / `sweepCircleBoxes` now report a hit at time 0, and `moveCircle` blocks. This happens whenever a game places a body exactly at a wall without a skin (a snapped spawn point, or a projectile set to a sweep's contact point). Moving away from the wall or sliding along it is unchanged. A game that fingerprints its simulation will see fights that touched a wall this way play differently: re-record the fingerprints with the upgrade.
  - **Replays carry input into their window.** A replay saved after unchanged input (holding a direction longer than `keep`) had no input on its first ticks and handed systems `undefined` when played.
  - **`Session.run` stops with `invariant-threw`** when an invariant throws, naming the invariant and the error, instead of throwing out of `run` and losing the run's text.
  - The `Snapshot` docs now say that unread `runtime.send` events survive a restore, as they always did.

- 330246e: **Safety follow-ups from a second review.** Each closes a way a game could go wrong silently; see Upgrading under 0.9.0 in the `@typeonce/ritmo` CHANGELOG.md.

  - **A `SpawnedId` is valid only in the run that spawned it.** Kept in a closure or resource and passed to `commands.despawn` / `commands.remove` in a later run, it could name an entity despawned meanwhile whose id was reused. Such a command is now skipped, traced as a `staleTarget` effect, and reported by the new `stale-target` lint (`Debug.StaleTarget`). Keep the entity id or a handle and resolve it through a query.
  - **`any` and `never` are not descriptor values.** `Descriptor.Component<any>()`, `Resource`, `Event`, `Service`, and the transient variants fail at the constructor: `any` turned off every check on the descriptor, and `never` erased the fragment listing it.
  - **A saved component cannot require a transient one.** `Schema.bind` rejects `Schema.requires(Ghost, Trail)` when only `Trail` is transient: a restore brought `Ghost` back without it. A transient requirer may still require a transient component.
  - **Queries with `added` / `changed` filters have no lookups.** `get`, `getHandle`, `single`, `children`, and `descendants` failed with `QueryMismatch` whenever the target had not changed since the system's previous run; they no longer compile there. Declare a second query without filters to resolve entities. `each()` and `singleOptional()` are unchanged. The handle types are now `QueryIteration` and `QueryLookups` (`QueryHandle` combines them).
  - **A transition's exit phase is one transaction.** When a system in `onExit` / `onTransition` fails, everything the phase did (component writes, resources, events, queued next states and commands, stream positions) is undone and the transition stays queued, so the retry starts from the same state instead of running the earlier exit systems twice. These schedules can no longer contain `applyDeferred()`.
  - **A service or machine provided twice does not compile.** `Runtime.services` / `Runtime.machines` kept the last of two provisions; the second now fails, naming it.
  - **`RenderSync` recovers from dropped removals.** After a pause longer than a stream keeps entries, the removals it missed left nodes on screen; when its removal stream reports `lagged()`, it now destroys every node whose entity no longer matches. Give each `RenderSync.system` its own registry.
  - **New lint `stream-loss-unread`.** On a debug runtime, a reader of events, transition events, removed, despawned, or relation failures that lost entries without checking `lagged()` is a warning, and one reading under `pauseWhen` without checking it is noted (`Debug.StreamLoss`).

- Updated dependencies [c2c32e0]
- Updated dependencies [9cca78b]
- Updated dependencies [6c09482]
- Updated dependencies [ecfd0f1]
- Updated dependencies [d47a4f9]
- Updated dependencies [330246e]
- Updated dependencies [7f2b2dd]
  - @typeonce/ritmo@0.9.0

## 0.8.0

### Minor Changes

- 0b22113: **Immutable components.** `Descriptor.Component`, `ConstructedComponent`, and `TransientComponent` take an optional `{ immutable: true }` for data that says what an entity is (a kind, a team, a tile). Queries can only read such a component: `Game.Query.write(Kind)` is a compile error naming the fix (`replace it with commands.insert(entity, Game.Command.entry(Kind, ...))`), and it throws the same message when an erased type reaches it. Replacing the component with `commands.insert` still marks it changed for `Game.Query.changed(Kind)`. Descriptors declared without the option keep their exact type.

  - `Descriptor.isImmutable(descriptor)` reports the option at runtime.
  - `describe()` component entries gain `immutable`, and the text report prints it.

- a0fac0a: **`Game.Query.anyOf`.** `anyOf(...filters)` takes two or more `added` / `changed` filters and matches an entity once when any of them passes since the reading system's previous run, for example to redraw when either the position or the sprite changed. Filters listed side by side in `filters: [...]` still all have to pass. `anyOf` does not nest, and `Game.Condition.check` rejects it like every other change filter.

  - `RenderSync.system` now builds one query per sync system (an `anyOf` of its added and changed filters) instead of one query per trigger plus deduplication.
  - `Debug.QueryDescription` gains `anyOf` (one entry per `anyOf` filter, with its `added` and `changed` components); code that builds a `QueryDescription` by hand must add it. The text report prints it as `any of (...)`, and Monitor counts its components as reads.

- 0b22113: **Breaking: required components; `insert` and `remove` take a query match.** See Upgrading under 0.8.0 in the `@typeonce/ritmo` CHANGELOG.md.

  A fragment declares what always comes together: `Schema.fragment({ components: { ... }, requires: [Schema.requires(Player, Position, Velocity)] })`. Requirements chain, may name components of other fragments of the same `Schema.bind` (checked there), and are never filled in with defaults.

  - `commands.spawn` / `spawnIn` reject a draft missing a required component, naming the requirer and the missing component. Drafts may be partial while they are built with `Game.Command.extend`.
  - `Game.System.spawns(Player)` also allows what `Player` requires, transitively, so hand-kept lists of a draft's components are no longer needed.
  - **Breaking:** `commands.remove` takes `match.entity` (or the id `commands.spawn` returned in this run), never a raw id, and removes several components in one call: `commands.remove(match.entity, Player, Velocity)`. Removing a required component compiles only when its requirers are removed in the same call or excluded by the query's `without`.
  - `commands.insert` takes `match.entity` (or a spawned id) as well as a raw id: the target's query proof plus the entries inserted together must cover what the inserted components require. A raw id still inserts components without requirements.
  - When commands are applied, a spawn, insert, or remove that would break a requirement (a query proof gone stale within one flush, erased types) is skipped whole, traced as a `requirementViolated` effect, and reported by the new `requirement-violated` lint.
  - `restore` rejects a saved entity missing a required component with the new `MissingRequiredComponent` error. Requirements on transient components are not checked there, since saves skip them.
  - `describe()` component entries gain `requires`. `Command.InternalWorld` now inserts and removes several components per call (`insertComponents`, `removeComponents`), and `spawnEntity` reports whether it spawned.

- a0fac0a: **Resource change detection.** `Game.System.changedResource(R)` declares a resource read whose view adds `changed()`: whether a committed write left a different value since this system's previous completed run. Use it for work worth doing only when a value moved, such as rewriting a HUD label, instead of keeping a "last value" in `local`.

  - A write of an equal value is not a change: primitives compare with `Object.is`, plain objects and arrays by their entries, other objects by reference. This differs from `Game.Query.changed`, where every component write counts.
  - The first run reports `true`. Writes rolled back by a failed system are not changes, a system does not see its own writes as changes, and a reader skipped by a run condition sees the change when it runs again.
  - `Game.Condition.check` rejects it ("changedResource consumes a per-reader cursor, which a check does not have: use Game.System.readResource here, and changedResource in the gated system"); writing a resource in a check now names `readResource` too.
  - `Game.System.thisTick(changedResource(R))` joins the compile-time and runtime order checks.
  - `describe()` lists these reads in `SystemDescription.resources.changed` (they stay in `reads`), the text report prints them as "reads resources when changed", and the new `resource-changed-never-written` lint warns when no described system writes a resource read with `changedResource`.

- a580c9c: **Scopes despawned by state changes.** `Game.EntityScope(name, { despawnOnExit: [Flow, "Playing"] })` (or `despawnOnEnter`) despawns every member of the scope when `applyStateTransitions(...)` commits that state change: after the `onExit` schedules, which still see the members, and before the `onEnter` schedules, so what they spawn survives. A restart no longer needs a despawn system, a `despawnsScope` permission, and an `applyDeferred()` placed between despawn and respawn. The despawn goes through the normal path (`readDespawned`, `RenderSync`, hierarchy cascades) and appears in the trace as `despawnScope <name>` from `onExit(<machine>=<state>)`.

  - Scopes register with the game when defined, so the runtime knows every trigger; scope names are now unique per game (`Duplicate entity scope name`).
  - A state that does not exist, or a machine of another game, fails to compile. `Game.Condition.inState` and `stateChanged` now reject another game's machine where the condition is built, with the message `<machine> is a state machine of another game: use a machine defined with this game's Game.StateMachine(...)`.
  - New lint `scope-trigger-never-applied`: a trigger whose machine the runtime does not provide, whose next state no described system queues, or that no described schedule applies. `describe()` gains `scopes` (each with its triggers), printed in the text report.

- a580c9c: **Sub-states.** `Game.StateMachine(name, values, { within: [Parent, state] })` declares a machine that exists only while `Parent` is in `state`. Each time the parent enters that state, the sub-state enters the value given to `Game.Runtime.machine(...)`; when the parent leaves it, the sub-state's `onExit` schedules run before the parent's and it loses its value. `Game.Condition.inState(Sub, x)` therefore implies the parent's state, replacing an `and(inState(Parent, ...), inState(Sub, ...))` on every system and the `onExit` system that reset the second machine.

  - For sub-states only: `machines.x.get()` is `Value | undefined`, `nextMachines.x.set` / `setIfChanged` return a `Result` failing with `SubStateInactive` (nothing is queued) while the parent is elsewhere, and transition snapshots use `undefined` for the side where it does not exist. Top-level machines keep their exact types.
  - Snapshots leave out an inactive sub-state; `restore` rejects a saved sub-state value whose parent is elsewhere with the new `InactiveSubState` error, and enters the entry value when a save has the parent in its state but no sub-state value.
  - `describe()` machine entries gain `provided` and `within`; the text report and traces print a missing value as `(inactive)`. `Debug.TransitionEvent` `from` / `to` may be `undefined`.
  - The unused `Machine.MachineView`, `NextMachineView`, `TransitionView`, and `TransitionEventView` interfaces are removed; system views are `System.MachineReadView`, `NextMachineWriteView`, `TransitionReadView`, and `TransitionEventReadView`.

### Patch Changes

- Updated dependencies [0b22113]
- Updated dependencies [a0fac0a]
- Updated dependencies [0b22113]
- Updated dependencies [a0fac0a]
- Updated dependencies [a580c9c]
- Updated dependencies [a580c9c]
  - @typeonce/ritmo@0.8.0

## 0.7.0

### Minor Changes

- 84eac37: Add simulation time through `Clock.hz`, a validated `Clock.resource`, and a schedule built by `Clock.system`. A held clock sets `dt` to zero and preserves its step. Durations carry their rate, reject sub-step literals, and validate seconds from data through `durationRaw`. Restoring a clock saved at another rate fails validation.

  `FixedLoop.start` and `Replay.recorder` take `step: Clock.hz(...)` instead of `stepSeconds`, sharing one fixed step with the simulation. `HostClock` supplies host timing through an injected contract; browser hosts can use `BrowserHostClock.make(window)`. Debug runtimes use `debug: { hostClock }` and the monitor requires an explicit DOM host.

  Add `Determinism.check` over a factory of fresh headless debug runtimes and scripted inputs. It compares all component and resource values, including transient values, and reruns the first differing frame to name its system or schedule marker. Execution failures, defects, and reused runtimes fail explicitly. This checks repeatability on the current engine.

  New replay files and the lint CLI use the Ritmo name.

- 7ebd9af: One way to do each thing. Breaking changes, with no deprecated aliases:

  - **Systems fail with `Result.failure(error)`.** The `Fx` module is removed (`Fx.fail`, `succeed`, `sync`, `map`, `flatMap`, `access`, `accessService`, `provide`, `runSync`). A system returns nothing or a `Result`; returning `Result.failure(error)` rolls back its ECS writes, drops its commands and events, and types `error` into the tick result exactly like `Fx.fail` did. Replace `return Fx.fail(e)` with `return Result.failure(e)`; a returned lookup failure (`if (!found.ok) return found`) also works. `SystemDefinition` and `Schema.BoundSystem` lose their success type parameter: `SystemDefinition<Spec, E, Root, Name, Needs>`, `BoundSystem<S, Root, Spec, E, Name, Needs>`.
  - **`Feature` is removed** (`Schema.Feature.define` / `compose`). A plugin is a function `(Game, options) => System | Schedule`, like `RenderSync.system(Game, ...)`; list every fragment in one `Schema.bind(...)`.
  - **`Schema.merge` is removed**: use `Schema.bind(A, B, ...)`.
  - **A descriptor owns its validator.** `Definition` is removed: validate through the constructed descriptor (`Game.Command.entryRaw(Position, raw)`, for example in a draft built once at module load) or call the constructor (`Vector2.result(raw)`). `Command.entryResult` is removed: `entryRaw` is the one way to validate raw input at spawn. `setResult` / `updateResult` are removed from write cells: use `setRaw` / `updateRaw` on constructed descriptors. `Brand` is documented as a tool for packages that author validated value types.
  - **`Descriptor.State` is renamed `Descriptor.EntityState`** (per-entity state, not to be confused with the game-wide `Game.StateMachine`). Related names follow: `EntityStateDescriptor`, `EntityStateValue`, `EntityStateTransitions`, `isEntityState`, `EntityStateWriteCell`, and the transition failure `EntityStateMismatchError` with `_tag: "EntityStateMismatch"` and `component` (was `state`) naming the component.
  - **Silent failures are loud.** `RemovedReadView` and `DespawnedReadView` gain `lagged()`, like event readers. `describe()` reports a `relation-failure-never-read` warning for a relation that commands have related or reordered while no described system reads its failures.
  - **Devtools invariants are typed.** `Invariant.make(name, () => ...)` is replaced by `Invariant.fromInspector(Game.Inspector(name, access, check))`, where `check` returns a violation message or `undefined`. `Session.make` rejects at compile time an invariant that reads a resource, service, or machine the runtime does not provide. `Runtime.ValidateInspector` is exported for tools like this.
  - JSDoc now states when to use each of `EntityScope` / `Hierarchy`, `when` / `pauseWhen` (on a system and on `Schedule.when` / `Schedule.pauseWhen`), `tryTick` / `tick`, and `Game.StateMachine` / `Descriptor.EntityState`.
  - **`Game.System.thisTick(read)`**: wraps `readEvent(E)` or `readResource(R)` to require that every system writing it runs earlier in the same `runtime.tick(...)` call. `tick` checks it at compile time ("ApplyDamage needs Damage from this tick, but its writer UpdateFrostFields runs after it: move ..."), and calls whose order is not statically known (a read with no writer compiles); `tryTick` checks it at runtime (`TickOrderViolation`) and `describe()` reports `this-tick-order`. Schedule types gain a sixth parameter (`Order`); constraint positions accept any with `Schedule.AnyScheduleOrder`.
  - **Lint as a tool.** `ritmo-devtools lint <entry>` (and `Lint.run` in code) prints every lint of a game's schedules with its fix, and exits 1 on warnings (info does not fail). The entry module exports `lintTarget: () => { runtime, schedules, describe? }`. `Debug.Lint` gains `fix`, the change that resolves it.
  - **Replays.** `Replay.recorder(runtime, { schedule, name, keep, stepSeconds, sink, hostClock, saveOn? })` keeps the last seconds of one schedule's ticks (periodic snapshots, source-service values as changes, host sends) and saves them through a `Replay.Sink`: `Replay.memorySink`, `ReplayNodeSink` (files), `ReplayViteSink` with `ReplayVitePlugin` (dev server), and Monitor's new `replay` option ("Save replay" button). A recorded schedule whose services are not plain-data `snapshot()` sources or plain data is a compile error. `Replay.session`, `verify`, and `extract` replay a file headless. Core's `Debug.Handle` gains `observeHost` (tick start/end and sends, without tracing).
  - **`debug` takes a host clock: `debug: { hostClock }`** (`debug: true` is removed). Core and devtools read no platform clock or globals: the new core `HostClock` module is the injected contract (`HostClock.standard` is `Date.now`, `HostClock.test()` is a manual clock at 0 with `adjust(ms)` returning a `Result`, `HostClock.elapsed` clamps negative durations), and `BrowserHostClock.make(window)` in the browser package reads `window.performance`. A value that may be `undefined` (`debug: import.meta.env.DEV ? { hostClock } : undefined`) gives an optional `debug` handle that code must check, so a dev-only debug runtime needs no second runtime type; omitting `debug` attaches nothing. Devtools take the clock and host explicitly: `Session.make(runtime, { ..., hostClock })`, `Replay.recorder(runtime, { ..., hostClock })`, a replay target returns `hostClock`, and `Monitor.attach(runtime, { ..., host: window })`. With `HostClock.test()` every timing is 0, so session and replay text is identical across runs.
  - **Lookups go through declared queries.** `lookup.get(id, Q)`, `lookup.getHandle(h, Q)`, `lookup.childMatches(id, R, Q)`, and `lookup.descendantMatches(id, R, Q)` are removed: they let a system read or write components it never declared. Use `queries.x.get(id)`, `queries.x.getHandle(h)` (same intent proof), `queries.x.children(id, R)`, and `queries.x.descendants(id, R, options)` on a query in the spec. `lookup` keeps the id-returning helpers (`related`, `relatedSources`, `parent`, `ancestors`, `descendants`, `root`).
  - **Systems declare their commands.** A system has `commands` only when its spec declares them: `commands: Game.System.commands(Game.System.spawns(Position, Enemy), Game.System.inserts(Stunned), Game.System.removes(Stunned), Game.System.despawns(Enemy), Game.System.despawnsScope(Level), Game.System.relates(ChildOf))`. Each method exists only with its permission, and only for what it lists; errors name the fix ("Noise is not declared in this system's commands: add it to Game.System.spawns(...)"). Drafts built from spread arrays or conditional entries are checked over every component they may hold. `despawn` takes `match.entity` from a query proving one of the `despawns` components, or the `SpawnedId` that `spawn` / `spawnIn` returned in the same run, never a raw id. The draft builder `Game.Command.insert` is renamed `Game.Command.extend` (it clashed with `commands.insert`). Spawn-time relations in a draft (`Game.Command.relate(draft, ...)`) are part of the spawn and need no `relates`.
  - **`Game.System.thisTick(query)`**: a query that needs this tick's command changes. Its writers are systems whose declared commands can change what it matches (`spawns` covering every component it requires, or `inserts` / `removes` of any component it names, optional slots, `with`, `without`, and filters included; `despawns` never count). `runtime.tick(...)` rejects a writer that runs after the reader, and one before it with no `applyDeferred()` in between ("AimAtNewest needs this tick's commands for queries.enemies, but SpawnWave queues them with no applyDeferred() in between: add Game.Schedule.applyDeferred() after SpawnWave"). Transition bundles count at their `applyStateTransitions(...)` step (which applies queued commands first), as if every schedule in them runs, markers inside included; this now also holds for event and resource reads. `tryTick` and the `this-tick-order` lint check the same at runtime (`OrderIssue.kind` gains `"unflushedWriter"`); `tryTick` checks each schedule once. Transition schedules and bundles carry their order (a sixth / seventh type parameter, defaulting to any order).
  - **Fix: a `Game.Query(...)` written inline in a spec keeps omitted lists empty.** Without `with` (or `without`, `filters`, relation lists) an inline query in `queries: { ... }` took the spec's widened list type (every component), so it proved every component to `despawn` and `getHandle`. Omitted lists are now `[]` wherever the query is written.
  - **Devtools read declared command permissions.** `describe()` lists each system's permissions (`SystemDescription.commands`) and indexes `spawns` / `inserts` / `removes` as component writers, so `component-never-read` covers components only commands write. `relation-failure-never-read` also fires for a declared `relates` before any command ran. New `command-permission-unused` lint (info): on a debug runtime, "X may insert C but never did in this session" for systems that ran. `session.why(entity, Component)` names the systems whose `spawns` could have spawned the entity.
  - **Ignored tick failures are reported (debug only).** A failed `tick` / `tryTick` result whose `ok` nobody read is reported as a `failure.ignored` trace and host event (`frame`, `schedule`, `system`, `error`, `skipped`: the systems that did not run, `when: "next-tick" | "session-end"`) at the start of the next tick, or by the new `debug.checkIgnoredFailures()`. Core emits only. Devtools: `Session.run` stops with `reason: "ignored-failure"`, `report()` / `journal()` show "tick failure ignored: Load failed with "level file missing"; 2 later systems did not run (not read before the next tick)", the replay recorder saves on it (`saveOn.failure`), and the monitor raises an alert.

### Patch Changes

- 358401a: Link the bevy-ts migration guide from each published package README.
- Updated dependencies [84eac37]
- Updated dependencies [7ebd9af]
- Updated dependencies [358401a]
  - @typeonce/ritmo@0.7.0

## 0.6.0

### Minor Changes

- 130cb6e: Rename the package family from `@typeonce/bevy-ts*` to `@typeonce/ritmo*`.
  Update imports, workspace dependencies, type identity markers, examples, and
  documentation together. There are no compatibility aliases; use the matching
  Ritmo package for each previous Bevy TS package. The separate release preparation
  change coordinates the repository rename and retirement of the generated
  documentation site.
  Use "The agent-first type safe ECS runtime" in package metadata,
  documentation, and brand assets.

### Patch Changes

- a8e0473: Retire the generated documentation site and point package homepages, source links,
  and issue links to the Ritmo repository in the Typeonce GitHub organization.
  Keep source JSDoc and repository guides, including the Pixi walkthrough in its
  example README.
- Updated dependencies [a8e0473]
- Updated dependencies [130cb6e]
- Updated dependencies [a1f18a8]
  - @typeonce/ritmo@0.6.0

## 0.5.0

### Patch Changes

- @typeonce/bevy-ts@0.5.0

## 0.4.0

### Minor Changes

- e2b2275: New package `@typeonce/bevy-ts-render`: the renderer-agnostic part of `@typeonce/bevy-ts-pixi`, the entity-keyed node registry (`NodeRegistry.make`) and the render sync systems (`RenderSync.system`, `RenderSync.interpolate`), for games drawn with Three.js, the DOM, or any other renderer.

  **Breaking:** import `NodeRegistry` and `RenderSync` from `@typeonce/bevy-ts-render`. Pixi exports only `PixiNodeRegistry`, with `make(container)` replacing `NodeRegistry.inContainer(container)`. The platform-prefixed adapter implements the generic registry contract and is provided through the existing typed runtime service API. The old Pixi modules and re-exports are removed immediately. Pixi depends only on the render package, dropping its unused browser and core dependencies.

  This combines the four planned steps into one 0.4.0 release of the fixed package group.

  - `Game.Schedule.pauseWhen` retains event-reader cursors during a pause. Ordinary `when` gates still discard messages across mode changes and take precedence over pause gates in either nesting order. Stream capacity bounds retention, and debug traces expose whether a skipped run held messages.
  - A system's optional `local` factory owns scratch state per runtime, shared by gated copies. Locals are neither rolled back nor snapshotted and are rebuilt after successful restore. Debug descriptions show which systems declare them.
  - Optional and conditional local factories preserve `undefined` in the callback type. Factories allocate fresh scratch state without side effects; mode changes preserve locals, and values needing cleanup belong in host-managed services.
  - `runtime.send` immediately publishes a schema event from the host at a fresh tick. Calls during a tick or with unknown descriptors throw. Unread host messages survive restore without replaying to readers that already consumed them. Devtools trace sends and include external producers in event lints.
  - **Breaking:** `EntityId` and `Handle` are branded numbers. Replace `id.value` and `handle.value` with `id` and `handle`. Handles now compare by numeric identity and work as `Set` keys without allocating objects. `decodeHandle` and `Decode.handle` accept only positive integer numbers. Object-shaped handles are rejected, including inside snapshots; snapshots write numbers.
  - The guides cover fallible lookups, inspector machine reads, `Query.Cells`, shared access objects, simulation-owned time, and seeded random state. `Feature` remains supported and is documented in the package-authoring guide.

### Patch Changes

- Updated dependencies [e2b2275]
  - @typeonce/bevy-ts@0.4.0

## 0.3.0

### Minor Changes

- de2a112: Add `Monitor.attach(runtime, { schedules, pick?, locate? })`: a live browser panel that shows how a running game works, toggled with the backslash key or a corner button.

  - **Overview:** schedule tick times, the busiest systems, entity counts per component with sparklines, state machines, and alerts (failed systems, NaN or infinite writes, discarded messages).
  - **Systems:** each schedule's systems in order, grouped by run conditions. Each one shows its writes, events, spawns (learned while running), and reads, with a live working/idle/skipped status. Hover a name to highlight its writers and readers.
  - **Entity:** pick an entity on screen, by id, or by component, and follow its components and changes live.

  The monitor observes the runtime only while it is open. `Monitor.Collector` exposes the same data without DOM.

- c4d1add: Debug visibility for risks that types cannot rule out.

  - `Debug.Handle.population()` returns the live entity count and the number of entities per component. It is cheap enough to sample every frame.
  - A new info lint, `read-before-write`, names systems that read a component, resource, or event earlier in a schedule than the first system that writes it there, so they see the previous run's value (for events, one run late).
  - Devtools sessions warn with `non-finite-value` when any traced component write, resource write, event, spawn, or insert contains NaN or an infinity. The warning names the system, the entity, and the path.
  - Runs sample the population every frame. They return `entities` (start, peak, end) and `growing`, and warn with `population-growing` when a component's lowest count rises through every quarter of a run of at least 60 frames.
  - `run()` lists the warnings it raised, both as text and in `warnings`. `report()` ends with the current population.

### Patch Changes

- Updated dependencies [2b0fb7e]
- Updated dependencies [c4d1add]
- Updated dependencies [bd9bdd5]
- Updated dependencies [bd9bdd5]
- Updated dependencies [94bdc32]
- Updated dependencies [bd9bdd5]
  - @typeonce/bevy-ts@0.3.0

## 0.2.0

### Minor Changes

- 4b3a312: `Session.make(runtime, { schedules, describe })`: `describe` names more schedules for `describe()`, its lints, and the access maps without making them runnable. A headless session can now include a game's render schedule (which needs services the headless runtime lacks), so events and components only rendering reads are no longer reported as never read.

### Patch Changes

- Updated dependencies [4b3a312]
- Updated dependencies [4b3a312]
- Updated dependencies [4b3a312]
  - @typeonce/bevy-ts@0.2.0

## 0.1.1

### Patch Changes

- c95a102: First release published from CI through npm trusted publishing, with provenance attestations. Declarations are now verified against consumers on both TypeScript 7 and TypeScript 6. No API or output changes.
- Updated dependencies [c95a102]
  - @typeonce/bevy-ts@0.1.1
