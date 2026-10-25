---
name: ritmo
description: "Apply on every change to a game built on @typeonce/ritmo: a mechanic, content, UI or rendering, a bug fix, a refactor, saves, or a Ritmo upgrade. Routes the change to its playbook, says where the Ritmo docs are, and holds the principles for where code and state belong."
---

# Ritmo games

Follow the game's existing structure and conventions. The playbooks give the steps for each kind of change and the check that proves it; the game decides its folders, UI framework, renderer, timing, and design.

## Where the docs are

- The API reference is the JSDoc in `node_modules/@typeonce/*/src`. Read a module's header before using the module, and an export's JSDoc before calling it. Do not work from memory or the web: the API changes between versions.
- Each package's `README.md` in `node_modules` covers its setup and workflow.
- When upgrading, read each package's `CHANGELOG.md` from the installed version up. Breaking entries name the fix.
- Compiler errors and lint messages name the fix. Apply it; never cast around it.

## Pick the playbook

Read the playbook for the change before writing code. A change that spans several kinds reads each.

| Change | Playbook |
|---|---|
| A rule, mechanic, or behaviour | [`playbooks/mechanic.md`](playbooks/mechanic.md) |
| Items, kinds, levels, or tuning that reuse behaviour | [`playbooks/content.md`](playbooks/content.md) |
| A readout, panel, menu, or anything drawn | [`playbooks/ui-and-render.md`](playbooks/ui-and-render.md) |
| Something behaves wrong | [`playbooks/bug-fix.md`](playbooks/bug-fix.md) |
| Moving or splitting code without changing behaviour | [`playbooks/refactor.md`](playbooks/refactor.md) |
| New state, saves, or a Ritmo upgrade | [`playbooks/state-and-upgrades.md`](playbooks/state-and-upgrades.md) |
| Online multiplayer, rollback, or prediction | [`playbooks/netcode.md`](playbooks/netcode.md) |
| Many bodies that test each other (separation, pickups, hits) | [`playbooks/spatial-grid.md`](playbooks/spatial-grid.md) |
| Schemas in a game that uses Effect | [`playbooks/effect.md`](playbooks/effect.md) |
| Schemas in a game that uses Zod | [`playbooks/zod.md`](playbooks/zod.md) |

## Validating and saving values

Ritmo has no validators of its own. Every value it checks or saves is described by a [Standard Schema](https://standardschema.dev) from the game's schema library (Zod, Valibot, ArkType, Effect), and the game uses that one library for all of them:

- A saved component or resource is `Descriptor.ConstructedComponent(schema)` or `ConstructedResource(schema)`. Raw input (`setRaw`, `updateRaw`, `Game.Command.entryRaw`, raw values given to `Game.Runtime.make`) is in the schema's saved form and is decoded by it. A value that is never saved is a `Transient*` descriptor.
- A state of `Descriptor.EntityState` or `Game.StateMachine` is `{}` (no data) or one object schema for all of its data. Ritmo adds only `_tag`.
- A Zod, Valibot, or ArkType schema of plain data passes as it is. A value whose saved form differs from it (a `Map`, an `Option`, a `Date`, a class) needs a schema with a `"~encode"` back to plain data: the helper in [`playbooks/zod.md`](playbooks/zod.md) or [`playbooks/effect.md`](playbooks/effect.md) builds it from the library's own encoding. With another library, write the reverse schema by hand: `{ "~standard": decode["~standard"], "~encode": v.pipe(v.date(), v.transform((date) => date.toISOString())) }`. Without a `"~encode"`, the descriptor does not compile and the error says so.
- `runtime.snapshot()` encodes every value and returns a `Result`; `runtime.restore(...)` decodes. Validation is synchronous: no async checks.
- Ritmo's own types come with a guard to build a schema from: `Entity.isHandle(Root, Intent)` for stored handles, `Clock.isDeadline(step)` for stored deadlines, and `Random.is` for a generator state (which also has a ready `codec`: `Descriptor.ConstructedResource(Random.codec)`). Wrap the guard with a schema that narrows to its type: `Schema.declare(guard)` (Effect), `z.unknown().refine(guard)` (Zod), `v.pipe(v.unknown(), v.guard(guard))` (Valibot), `type("unknown").narrow(guard)` (ArkType). `z.custom(guard)` and `v.custom(guard)` type the value as `unknown`. Never cast a raw number to a handle, a deadline, or a random state.

## Branded values

A value that must not be mixed up with another of the same shape (an item id and a player id, a price and a weight) is branded by the game's schema library, and only that schema makes one: `z.string().brand<"ItemId">()` (Zod), `Schema.String.pipe(Schema.brand("ItemId"))` (Effect), `v.pipe(v.string(), v.brand("ItemId"))` (Valibot), `type("string").brand("ItemId")` (ArkType). Use the library's inferred type (`z.infer<typeof ItemId>`, `typeof ItemId.Type`) everywhere; `Brand.Branded<Value, Key>` from `@typeonce/ritmo` is for a game type that must interoperate with a Ritmo brand. Validate once at the boundary, where the value enters (a descriptor's schema for raw input and restores, a decode for authored data and host input), then pass the branded value along. Never brand with a cast (`raw as ItemId`): it skips the check the brand stands for, and `ritmo/no-brand-cast` reports it in simulation code.

## Third-party code

The lint rules check the game's code, not its dependencies. Before the simulation calls a library (physics, pathfinding, geometry, noise), and when adding or upgrading one:

1. Run `ritmo-devtools scan <entry>` on the simulation entry. It lists, per package, the non-exact `Math` calls, `**`, `Math.random`, and `Date.now` / `performance.now` in every file the simulation imports.
2. A clean scan: use the library, and rely on `Verify.acrossEngines` (`ritmo-devtools verify`) and `Netcode.syncTest` to prove the simulation replays.
3. Findings in code the simulation calls: vendor the library into the game's source (prefer its ESM build), cover it with the simulation override, and run `oxlint --fix`, which rewrites the calls to `Ops` and adds the import (a `require` in CommonJS). Fix what the rules report without a fix by hand.
4. A library that keeps its own world (a physics engine) enters through `Checkpoint.rewindable` only when it is deterministic itself across engines (Rapier's enhanced-determinism build, Box2D v3); otherwise keep the state in components and step it with systems.
5. WebAssembly must not import JavaScript's `Math`: check the module's imports. A WASM build that calls back into `Math.sin` is not deterministic, whatever its own code does.

## Principles

**The simulation is the game; everything else is a host.** Rules that change the world are systems. Input capture, drawing, UI, storage, network, and audio are host code. Keep the simulation in one folder, so one glob in the simulation override covers it. Any code that changes saved world state is gameplay, wherever it lives.

**Intents in, plain data out.** Player actions are typed intents (host events with `runtime.send(...)`, or an input resource) that one system validates and applies. Bots, tests, and replays send the same intents as the UI. UIs and renderers read the world as plain view data and never change saved world state.

**Each fact has one home.** Define each closed set (items, tools, building kinds) once and derive labels, shortcuts, menus, and lookups from it. Tables that must cover the set are `satisfies Record<Id, T>`, so a new id fails to compile until every table has an entry.

**Each piece of state has an owner and a lifetime.** Every mutable value has one home (saved world state, unsaved runtime state, or host state) and a defined fate on new game, restore, and dispose. Module variables are not a home for gameplay state: they survive restore, ignore rollback, and are shared by every runtime in the process.

**Make impossible states unrepresentable.** When a field means something only in one state (a move's hit flag, hitstun frames, an airborne speed), the states are a `Descriptor.EntityState` whose states each hold only their own fields, never a flat record with a `state` field next to fields that can go stale. Prefer distinct states over boolean flags: `grounded: boolean` next to `vy` lets a grounded body rise. Fields every state shares stay in their own component, and two components whose states must agree are one state. A game-wide mode with its own data (a dialogue's pages, a game over's winner) is one `Game.StateMachine` whose states hold their own fields, never a machine next to a resource that must agree with it.

**A handle is not proof the entity is alive.** A stored entity id can outlive its entity, so a lookup through it returns a `Result` that can fail. When one entity points at another (a chaser's target, a turret's lock), make the link a `Descriptor.Relation`: when the target despawns the runtime drops the edge, and a system reads `Game.System.readDroppedRelations(R)` to react once (pick a new target, go idle) instead of checking every tick whether the target still exists.

**Extend what exists before adding.** Search for an existing system, component, definition, or UI piece first, and extend it or add a variant instead of a near copy. New content that reuses behaviour is data, not a system.

**Make the next mistake fail loudly.** When a rule can be a type, a lint, or a headless test, encode it there instead of in a comment. The game's check runs the type check, `oxlint`, `ritmo-devtools lint <entry>`, and the tests; if any is missing, add it as `node_modules/@typeonce/ritmo/SETUP.md` describes.

## Self-check

- Does any UI or render code change saved world state?
- Did adding this id produce a type error everywhere it is needed?
- What happens to this value on restore?
- Can a value I store describe something that cannot happen? A nullable or kind-only field next to a `kind` or `phase` field, or a system that returns early on a mode field, says it can.
- Did I extend an existing piece, or copy it?
- What check fails if someone breaks this tomorrow?
