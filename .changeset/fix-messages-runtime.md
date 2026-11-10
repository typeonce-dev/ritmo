---
"@typeonce/ritmo": minor
---

Four more mistakes now fail with a message that names the cause and the fix. Programs that compiled before still compile.

| Mistake | Message now |
| --- | --- |
| An entity where an id goes: `queries.x.get(entity)`, `queries.x.children`/`descendants`, `lookup.related(entity, R)` (and every `lookup` method), `commands.relate(entity, R, target)`, `unrelate`, `reorderChildren` | `this takes an entity id, not an entity: pass entity.id` |
| A transition schedule (`Game.Schedule.onEnter`, `onExit`, `onTransition`) passed to `runtime.tick`, `tryTick`, `checkpoint`, `debug.beginFrame`, or `Game.Schedule(...)` | `onEnter, onExit, and onTransition schedules run when their machine changes state: bundle them with Game.Schedule.transitions(...) and pass that to Game.Schedule.applyStateTransitions(...) in a schedule you tick` |
| A schedule needing resources, services, or machines the runtime was not made with, at `runtime.tick` (and `runtime.inspect`, `Netcode`'s `simulate`, devtools invariants and labels) | `the runtime is missing resource Game/Score, service Game/Audio, machine Game/Flow: add to Game.Runtime.make({ resources: { Key: value }, services: Game.Runtime.services(Game.Runtime.service(Descriptor, implementation)), machines: Game.Runtime.machines(Game.Runtime.machine(Machine, initial)) })`, every one named, with the fix for each kind that is missing |
| `services: {}` (or a hand-written object) in `Game.Runtime.make` | `services are built with Game.Runtime.services(Game.Runtime.service(Descriptor, implementation)), or Game.Runtime.services() when there are none` |
| `machines: {}` in `Game.Runtime.make` | `machines are started with Game.Runtime.machines(Game.Runtime.machine(Machine, initial)), or left out when there are none` |

`insert`, `remove`, and `despawn` still take the entity, since they check what it proves. The id parameters have the new type `Entity.IdParameter`: an id, plus a member no value has, which carries the message.

The requirements message used to be a union of `{ __runtimeRequirementError__, __requirement__ }` objects under `__fixRuntimeRequirements__`, which the compiler cut after two or three. It is now the name of the one property that `Runtime.ValidateScheduleArray` and `Runtime.ValidateInspector` add, since the compiler prints a missing property's name whole. A package that read `__fixRuntimeRequirements__` out of either type intersects with the type itself instead:

```diff
-type Errors = Runtime.ValidateInspector<I, Services, Resources, Machines> extends { readonly __fixRuntimeRequirements__: infer E } ? E : never
-export type Validate = [Errors] extends [never] ? unknown : { readonly __fixMine__: Errors }
+export type Validate = Runtime.ValidateInspector<I, Services, Resources, Machines>
```
