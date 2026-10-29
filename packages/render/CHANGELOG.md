# @typeonce/ritmo-render

## 0.19.0

### Patch Changes

- Updated dependencies [6e69a51]
- Updated dependencies [612c30a]
- Updated dependencies [832169a]
- Updated dependencies [818ad0b]
- Updated dependencies [1a36354]
  - @typeonce/ritmo@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [8322cd7]
  - @typeonce/ritmo@0.18.0

## 0.17.0

### Minor Changes

- 39aeaf4: **Breaking: an optional query slot is the read cell, or `undefined` when the entity does not hold the component.** `Game.Query.optional(X)`, `Game.Query.optionalRelation(R)`, and `Game.Query.optionalRelated(R)` (and `select` slots of `RenderSync.system`) gave a slot that was always an object, so `if (data.hero !== undefined)` compiled and was always true, and there were two ways to read it (`present` then `get()`, or `value()`). The slot is now `ReadCell<T> | undefined`: reading it without a check does not compile (`'data.sprite' is possibly 'undefined'`). `present`, `value()`, and the `OptionalReadCell`, `PresentOptionalReadCell`, and `AbsentOptionalReadCell` types are removed. A component whose own value can be `undefined` stays unambiguous: an `undefined` slot means absent, and `get()` returning `undefined` means present.

  ```diff
  - burning: data.burning.present
  + burning: data.burning !== undefined
  - const parent = !data.parent.present ? undefined : data.parent.get()
  + const parent = data.parent?.get()
  - const stride = data.stride.value()
  + const stride = data.stride?.get()
  - if (data.sprite.present) draw(data.sprite.get())
  + if (data.sprite !== undefined) draw(data.sprite.get())
  - QueryTypes.OptionalReadCell<T>
  + QueryTypes.ReadCell<T> | undefined
  ```

  To match only entities that hold a component ("is this the player?"), list it in the query's `with: [Player]` filter instead of an optional slot.

  `@typeonce/oxlint-plugin-ritmo` removes `ritmo/use-cell-value`: with one way to read an optional slot there is nothing to steer between. Delete `"ritmo/use-cell-value"` from `.oxlintrc.json`: oxlint stops with `Rule 'use-cell-value' not found in plugin 'ritmo'` while the config names it.

### Patch Changes

- 9346953: The `@typeonce/oxlint-plugin-ritmo` README lists built-in oxlint rules that pair well with Ritmo, each with the Ritmo mistake it catches: a `Result` checked with `if` instead of `.ok`, a switch over a closed set that misses a new member, an asset load or upload that is never awaited, `[object Object]` in HUD text, and oxlint's default `correctness` rules. The type-aware ones need `oxlint-tsgolint` and `oxlint --type-aware`.

  The packages' sources pass these rules: unnecessary type assertions and default type arguments are gone, unused imports are removed, and switches over closed sets name every member. The published types are the same types, written without their default arguments.

- Updated dependencies [15c55ac]
- Updated dependencies [39aeaf4]
- Updated dependencies [9346953]
- Updated dependencies [db0804a]
- Updated dependencies [3d1f862]
  - @typeonce/ritmo@0.17.0

## 0.16.1

### Patch Changes

- @typeonce/ritmo@0.16.1

## 0.16.0

### Patch Changes

- 9b0379e: **Every JSDoc `@example` now compiles against the current API.** Examples are type-checked in CI as a game would import them, so they no longer cite exports that do not exist or call them with the wrong arguments. What changed in meaning:

  - `Game.Runtime.make(...)` with a constructed resource (a `Clock.resource`, a `Descriptor.ConstructedResource`) returns a `Result` that may fail: the examples check `ok` instead of reading `.value`.
  - A captured input resource is typed from its source: `Descriptor.TransientResource<InputCapture.SnapshotOf<typeof KeyboardInput>>()`, not `Keyboard.Snapshot<...>`.
  - `Netcode.seats(...)` returns a `Result`: check it instead of `.value!`.
  - `Lint.Target<typeof Game.schema, typeof Root>` takes the schema root second.
  - `NodeRegistry.make` infers the node type from `attach`'s parameter, with no explicit generic.

- Updated dependencies [9b0379e]
- Updated dependencies [be9af72]
- Updated dependencies [9b0379e]
- Updated dependencies [9290521]
- Updated dependencies [9290521]
- Updated dependencies [1b55d21]
  - @typeonce/ritmo@0.16.0

## 0.15.0

### Minor Changes

- b58d75b: **Child entities' nodes attach under their parent's node.** `RenderSync.system(Game, { ..., hierarchy: Attached })` takes a `Descriptor.Hierarchy` of the game: a child's node is added under its parent's node instead of the root, so the renderer composes the transforms and `apply` sets the child's local transform. A child moves when its parent changes, is removed, or gains or loses its node, in the same run; parents move before their children. Despawning a parent despawns its children, so their nodes go with it. A parent that only loses its renderable hands its children's nodes back to the root.

  ```ts
  const { relation: Attached } = Descriptor.Hierarchy(
    "Game/Attached",
    "Game/Attachments"
  );
  const Render = RenderSync.system(Game, {
    name: "Game/Render",
    renderable: Body,
    transform: Position,
    registry: Sprites,
    hierarchy: Attached,
    create,
    apply,
  });
  ```

  - A `Descriptor.Relation` as `hierarchy` does not compile (`hierarchy must be a Descriptor.Hierarchy relation`), and neither does a relation missing from the schema (`hierarchy must be a relation of the game's schema`).
  - `NodeRegistry` keeps the node tree: `ensure(entity, create, parent?)` creates a node under a parent's node, `reparent(entity, parent)` moves one (and refuses a loop), and `parents` maps each nested node's entity to its parent's. `remove` moves a removed node's children back to the root before detaching it, and `clear` detaches children before their parents.
  - `PixiNodeRegistry.make(container)` adds a node with `(parent ?? container).addChild(node)`. Its nodes must be able to hold children (`addChild` and `removeChild`, as every Pixi display object has); otherwise it does not compile (`each node must be a container`).
  - **Breaking: `RegistryOptions.attach` receives the parent node**, `(node, parent: Node | undefined)`, `undefined` meaning the root, and is also called to move an attached node, so it must take the node out of its current parent. A one-parameter `attach` still compiles but puts every node on the root, so a game passing `hierarchy` sees children unattached. Update a custom registry:

    ```diff
     NodeRegistry.make<Mesh>({
    -  attach: (mesh) => scene.add(mesh),
    -  detach: (mesh) => scene.remove(mesh)
    +  attach: (mesh, parent) => (parent ?? scene).add(mesh),
    +  detach: (mesh) => mesh.removeFromParent()
     })
    ```

  - **Breaking: a hand-written `NodeRegistry<Node>` object needs `reparent` and `parents`**, and `ensure` takes an optional `parent`. Build registries with `NodeRegistry.make` instead of implementing the interface.
  - **Breaking: `PixiNodeRegistry.make`'s nodes must have `addChild` and `removeChild`.** Pixi display objects already do; a test double adds the two methods.

### Patch Changes

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

### Patch Changes

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

### Patch Changes

- Updated dependencies [791b52a]
- Updated dependencies [b3d6502]
- Updated dependencies [835f6ba]
  - @typeonce/ritmo@0.13.0

## 0.12.0

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

### Patch Changes

- 7002f4d: **Everything a game's agent needs now ships with the packages, and `ritmo-devtools lint` reports simulation modules the lint rules miss.**

  - **Breaking: `ritmo-devtools lint` fails on an uncovered simulation module.** Every module the entry loads that the `ritmo/keep-simulation-headless` override in `.oxlintrc.json` does not cover is reported as `uncovered-simulation-module`, and the command exits 1. Add the module (or its folder) to the simulation override's `"files"`, or stop importing values from it. Modules loaded only inside `lintTarget` are not checked. Requires Node 22.15 or newer (`engines.node` is now `>=22.15`).
  - **An agent skill ships with `@typeonce/ritmo`** in `skills/ritmo/SKILL.md`, for every change: where the docs are, and principles for where a game's code and state belong. Link it into the folder the game's agent reads skills from, for example `ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo .agents/skills/ritmo`. `SETUP.md` in `@typeonce/ritmo` is the one-time setup: the base packages and checks every game uses, the add-ons, and linking the skill.
  - **Every package ships its `CHANGELOG.md`.** The upgrade notes for 0.8.0 and 0.9.0 are in the `@typeonce/ritmo` changelog.
  - **JSDoc corrections.** Examples no longer provide randomness or time as services (use the `Random` resource and `Clock`), the `Command` module example declares its commands, inspector docs state that `added`/`changed` reads report records since the inspector's previous evaluation, and every example uses prefixed names (`"Game/Position"`). Guidance that lived only in the repository's guides (spawn order, `ReadonlyValue` helpers, re-entering a state, `thisTick` and plugin systems, service effects and rollback) is now in the JSDoc.
  - Package READMEs link other packages' READMEs by GitHub URL, so the links work on npm.

- Updated dependencies [7002f4d]
- Updated dependencies [388a696]
  - @typeonce/ritmo@0.10.0

## 0.9.0

### Patch Changes

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

- a0fac0a: **`Game.Query.anyOf`.** `anyOf(...filters)` takes two or more `added` / `changed` filters and matches an entity once when any of them passes since the reading system's previous run, for example to redraw when either the position or the sprite changed. Filters listed side by side in `filters: [...]` still all have to pass. `anyOf` does not nest, and `Game.Condition.check` rejects it like every other change filter.

  - `RenderSync.system` now builds one query per sync system (an `anyOf` of its added and changed filters) instead of one query per trigger plus deduplication.
  - `Debug.QueryDescription` gains `anyOf` (one entry per `anyOf` filter, with its `added` and `changed` components); code that builds a `QueryDescription` by hand must add it. The text report prints it as `any of (...)`, and Monitor counts its components as reads.

### Patch Changes

- Updated dependencies [0b22113]
- Updated dependencies [a0fac0a]
- Updated dependencies [0b22113]
- Updated dependencies [a0fac0a]
- Updated dependencies [a580c9c]
- Updated dependencies [a580c9c]
  - @typeonce/ritmo@0.8.0

## 0.7.0

### Patch Changes

- 358401a: Link the bevy-ts migration guide from each published package README.
- Updated dependencies [84eac37]
- Updated dependencies [7ebd9af]
- Updated dependencies [358401a]
  - @typeonce/ritmo@0.7.0

## 0.6.0

### Minor Changes

- c20bbc0: `RenderSync.interpolate` takes a `blend` option for values beyond a 2D position (3D positions, angles, scales), and `place` receives what `blend` returns. Without `blend` only `x` and `y` are blended, so `blend` is now required when a component is not `{ x, y }` or holds other numbers: a `{ x, y, z }` position no longer type-checks while its `z` is silently left unblended.
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
- a1f18a8: Two fixes:

  - **Snapshots keep entity scopes.** `snapshot()` now saves scope membership (`scopes`: per scope name, its members' ids) and `restore()` rebuilds it, so `despawnScope` finds restored entities. The format moves to version 2. Version 1 snapshots had no scopes and are rejected with `UnsupportedVersion` instead of being restored with every scoped entity loose. Invalid membership (an id that is not a saved entity, or one in two scopes) fails with `InvalidScope`.
  - **RenderSync follows membership.** A node now exists exactly while its entity has the renderable, the transform, and every required `select` slot. It is created whichever of them arrives last, and destroyed when any of them is removed (before, only the renderable's arrival and removal counted). The redundant despawn read is gone, because despawns are recorded as removals.

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
