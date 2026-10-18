# Migration guide

## Native hosts

`@typeonce/ritmo-native` is an optional host package. Existing browser games need no
migration. Add a native entry, native drawing and config; simulation APIs are
unchanged. Native source dependencies and the core package must use matching
versions. Unsupported systems run interpreted and are listed in the compile report.

## Upgrading to 0.9.0

0.9.0 rejects several calls that compiled before but were always wrong.
Fix each error where it is reported; the messages name the fix.

- **`Runtime.make` always returns a `Result`.** When nothing provided can
  fail, its type is `Success`: read `.value`. When a constructed resource
  may be provided, check it as before.

  ```diff
  -const runtime = Game.Runtime.make({ services, resources: { Score: 0 } })
  +const runtime = Game.Runtime.make({ services, resources: { Score: 0 } }).value
  ```

- **A query match is valid only during its run.** Keeping a match in
  `local` and reading or writing it later throws once its entity was
  despawned or lost the component. Keep the entity id or a handle, and
  resolve it with `queries.x.get(id)` / `getHandle(handle)`.
- **A look-alike descriptor must behave like the registered one.** A
  descriptor built elsewhere with the same kind and name but different
  behaviour (an entity state, a constructor, `immutable`, transient) throws
  when its query first runs; use the descriptor the schema registers.
- **New lint `next-state-replaced`.** On a debug runtime, two systems
  queuing different next states for one machine before the same marker are
  reported. Decide in one system, or check `nextMachines.x.getPending()`
  before setting.

- **Draft relations need `relates`.** A system that spawns a draft built
  with `Game.Command.relate(...)` declares the relation:

  ```diff
  -commands: Game.System.commands(Game.System.spawns(Errand))
  +commands: Game.System.commands(Game.System.spawns(Errand), Game.System.relates(WalkerOf))
  ```

  The `relation-failure-never-read` lint then sees these relations: read
  their failures (`Game.System.readRelationFailures(WalkerOf)`) and handle
  them, for example by despawning a child whose parent was gone when it
  spawned.

- **A command target picked from several queries must be valid for each.**
  `commands.despawn(cond ? a.entity : b.entity)` needs both queries to prove
  a `despawns` component; resolve the entity through one query, or branch
  and call the command in each branch. A raw id is never a target, not even
  as one side of a conditional.
- **Conditional and spread entries count as maybe present.** A requirer a
  draft may hold needs its requirements surely held:
  `spawn(Game.Command.spawn(...parts))` with a widened array fails when a
  part requires another; list the required components as fixed entries.
- **`Runtime.make` names unknown resource keys.** Fix the spelling, or
  remove the key.
- **Queries that can never match fail to compile.** Remove the component
  from `without` or from the required side.
- **A bundle's transition schedules require their machine.** Provide it with
  `Game.Runtime.machine(...)`, or drop the schedule.
- **Registries take their own kind.** Move a resource out of `components`,
  and so on.
- **Type-level:** `EntityRef` / `EntityMut` `Proves` and `Lacks` parameters
  are contravariant and default to `never`; `EntityDraft` has a fourth
  parameter (`Relates`). Code that names these types with explicit
  arguments updates them; inferred code is unchanged.
- **Removed duplicates.** Use `Descriptor.Hierarchy` / `Descriptor.Relation`
  instead of `Relation.Hierarchy` / `Relation.Relation`, and
  `Schema.fragment({})` instead of `Schema.empty()`.
- **Permissions name at least one entry**, and a system declares one slot
  per resource (a write or changed view reads too).
- **Optional slots read with `value()`**: `cell.value()` replaces
  `cell.present ? cell.get() : undefined`.
- **A `SpawnedId` is valid only in the run that spawned it.** A `despawn`
  or `remove` given one kept from an earlier run is skipped and reported
  by the `stale-target` lint. Keep the entity id or a handle and resolve it
  through a query (`queries.x.get(id)`), then pass `match.entity`.
- **Descriptor values cannot be `any` or `never`.** Give the value a type;
  use `unknown` for a value no system reads, and `Descriptor.Tag` for a
  marker.
- **A saved component cannot require a transient one.** Make the requirer
  transient too, or give the required component a constructor.
- **Filtered queries have no lookups.** Resolve entities through a second
  query without `added` / `changed` filters:

  ```diff
  -Game.System("Follow", { queries: { moved: Moved } }, ({ queries }) => {
  -  const target = queries.moved.getHandle(handle)
  +Game.System("Follow", { queries: { moved: Moved, targets: Targets } }, ({ queries }) => {
  +  const target = queries.targets.getHandle(handle)
  ```

- **`onExit` / `onTransition` schedules cannot contain `applyDeferred()`.**
  Their commands are applied at the next `applyDeferred()` after the
  marker; a failure in the exit phase now undoes the whole phase.
- **Provide each service and machine once** in `Runtime.services(...)` /
  `Runtime.machines(...)`.
- **Snapshots carry `gameVersion`.** Saves without it restore as version
  0. Code that builds a `Snapshot.WorldSnapshot` by hand adds
  `gameVersion: 0`. To change a game's save format, pass
  `saves: Snapshot.migrations(...)` to `Game.Runtime.make` instead of editing
  raw saves before `restore`.
- **Keep random state with `Random.draw`.** Declare the resource with
  `Descriptor.ConstructedResource(Random)`, start it with `Random.seed(n)`
  (the runtime is then made as a `Result`), and draw with
  `Random.draw(resources.rng)` instead of `Random.make(state)` plus a `set`.
  `Random.integer` / `range` now throw on bounds with nothing to draw, and
  `SpatialGrid` on non-finite input.
- **New lints `stale-target` and `stream-loss-unread`** on debug runtimes.
  For the second, check `lagged()` where a missed entry matters and rebuild
  from queries when it is true.
- **Behaviour:** `Collide2` now stops a circle that starts exactly touching
  a wall and moves into it. A game that fingerprints its simulation
  re-records the fingerprints with the upgrade.

- **`FixedLoop` moved to `@typeonce/ritmo`.** Import it from core. The
  browser's animation-frame source is now `BrowserTickSource.make(window)`;
  a source wrapped with `FixedLoop.source(...)` is unchanged.

  ```diff
  -import { FixedLoop } from "@typeonce/ritmo-browser"
  -const source = FixedLoop.animationFrames(window)
  +import { FixedLoop } from "@typeonce/ritmo"
  +import { BrowserTickSource } from "@typeonce/ritmo-browser"
  +const source = BrowserTickSource.make(window)
  ```

## Upgrading to 0.8.0

0.8.0 adds component requirements (`Schema.requires`) and changes how
`commands.insert` and `commands.remove` take their target.

- **`remove` takes a query match, not a raw id.** Pass `match.entity` (or the
  id `commands.spawn` returned in the same run). With only a stored id,
  resolve it first.

  ```diff
  -for (const match of queries.marked.each()) commands.remove(match.entity.id, Marker)
  +for (const match of queries.marked.each()) commands.remove(match.entity, Marker)

  -commands.remove(storedId, Sprite)
  +const found = queries.sprites.get(storedId)
  +if (found.ok) commands.remove(found.value.entity, Sprite)
  ```

  A raw id fails with an error that first prints the id's type (the whole
  schema), then the fix: `remove needs an entity from a query (pass
  match.entity) or the id spawn returned in this run, not a raw id`.

- **`remove` takes several components.** Removing a component together with
  the components that require it must happen in one call:
  `commands.remove(match.entity, Player, Velocity)`.
- **`insert` takes `match.entity` too.** A raw id still works for components
  that require nothing; a component with requirements needs a target whose
  query proves them, or the requirements inserted in the same call.
- **A query's `without` proves absence.** `remove(match.entity, Velocity)`
  compiles when every component that requires `Velocity` is excluded by the
  query (`without: [Player]`) or removed in the same call.
- **Hand-kept part lists can go.** Declare what always comes together in the
  schema, and give `spawns` the main component:

  ```diff
  -export const PlayerParts = [Position, Velocity, Collider, Player] as const
  -commands: Game.System.commands(Game.System.spawns(...PlayerParts))
  +Schema.fragment({ components: { ... }, requires: [Schema.requires(Player, Position, Velocity, Collider)] })
  +commands: Game.System.commands(Game.System.spawns(Player))
  ```

  - Put a requirement on the component that needs it, not on widely shared
    ones. If many components require `Position` or `Renderable`, every
    `remove` of those needs a query with `without` for each requirer.
  - Only `spawns(...)` expands requirements. `inserts(...)`, `removes(...)`,
    and `remove(...)` do not, so a list such as "every part of a body" stays a
    plain array: `removes(...BodyParts)` and `remove(match.entity, ...BodyParts)`.
  - Components a draft may hold that no requirement covers (optional parts)
    are still listed in `spawns(...)` next to the main component.

- **New optional descriptor option.** `{ immutable: true }` on a component
  makes `Game.Query.write` of it a compile error; replace it with `insert`.
- **Debug output.** `describe()` component entries gain `immutable` and
  `requires`; a new effect kind `requirementViolated` and lint
  `requirement-violated` report commands skipped at apply time. Replay schema
  hashes are unchanged.

## Rename from bevy-ts

Ritmo is the new name for bevy-ts. All six packages retain the `@typeonce` scope
and share one version.

| Previous package | Replacement |
| --- | --- |
| `@typeonce/bevy-ts` | `@typeonce/ritmo` |
| `@typeonce/bevy-ts-browser` | `@typeonce/ritmo-browser` |
| `@typeonce/bevy-ts-render` | `@typeonce/ritmo-render` |
| `@typeonce/bevy-ts-pixi` | `@typeonce/ritmo-pixi` |
| `@typeonce/bevy-ts-math` | `@typeonce/ritmo-math` |
| `@typeonce/bevy-ts-devtools` | `@typeonce/ritmo-devtools` |

After the first Ritmo release is available, replace the packages your game uses
in its manifest and update every import, including module paths:

```diff
-import { Descriptor, Schema } from "@typeonce/bevy-ts"
-import * as Result from "@typeonce/bevy-ts/Result"
+import { Descriptor, Schema } from "@typeonce/ritmo"
+import * as Result from "@typeonce/ritmo/Result"
```

Install once to update the lockfile, then run the game's type checks and tests.
Replace the full package family together. There are no compatibility aliases;
old and new packages use different type identity markers.

This guide covers the name change. Review the changelog for other API changes
between your installed version and the Ritmo version you select.

The generated documentation site is retired. Use the [root README](./README.md),
[concepts](./CONCEPTS.md), [game API guide](./GAME_API.md),
[Pixi walkthrough](./examples/pixi/README.md), package READMEs, and source JSDoc.
Existing published bevy-ts versions remain available for pinned installs.
