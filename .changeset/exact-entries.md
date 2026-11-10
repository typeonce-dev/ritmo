---
"@typeonce/ritmo": minor
---

**Breaking: a `[Descriptor, value]` entry is checked against its own component, and `Game.Command.entry` is removed.** A tuple entry of `Game.Command.spawn(...)`, `Game.Command.extend(...)`, or `commands.insert(...)` has an inferred value, so TypeScript's excess property check never reached it: `commands.insert(entity, [Position, { x: 0, y: 0, zzz: 1 }])` compiled and stored `zzz`. Its other errors were checked against every component of the schema at once and named an unrelated one (`'"Game/Health"' is not assignable to type '"Game/Velocity"'`). Each entry is now checked on its own, and the error is on that entry:

| Entry | Message now |
| --- | --- |
| `[Position, { x: 1, y: 2, z: 3 }]` | `Type '{ x: number; y: number; z: number; }' is not assignable to type '"Game/Position has no field z: pass only its own fields"'` |
| `[Position, { x: 1 }]` | `Type '{ x: number; }' is not assignable to type '{ readonly x: number; readonly y: number; } & ValueOf<"Game/Position">'` / `Property 'y' is missing ...` |
| `[Position, { x: 1, y: "2" }]` | `Type 'string' is not assignable to type 'number & FieldOf<"Game/Position", "y">'` |
| `[Outside, { x: 1 }]` (not in the schema) | `... is not assignable to type '"Game/Outside is not a component of this game's schema: spawn and insert take components registered in Schema.fragment({ components: { ... } })"'` |

A tuple built outside the call (returned by a helper, pushed into an array) widens to an array and fails with `this entry widened to an array: ...`. Add `as const` where it is built, or annotate it with `Command.Entry` (from `@typeonce/ritmo/Command`):

```diff
-const wear = () => [[Risk, { fire: 0 }]]
+const wear = () => [[Risk, { fire: 0 }]] as const
-const roles = []
+const roles: Array<Command.Entry<typeof Hp>> = []
 roles.push([Hp, 1])
```

Values with an index signature, arrays, tuples, primitives (branded too), `Map`s, `Set`s, functions, `unknown`, and unions of shapes (any field of any member) are accepted as before, and a value written in place is still typed by the schema (`[Ease, (t) => t * 2]`, `[Seen, new Set()]`). Fix the field, or drop it.

`Game.Command.entry(Descriptor, value)` built the same tuple, a second way to do one job that was strict where the tuple was not: write the tuple. `Game.Command.entryRaw` stays, for raw input that returns a `Result`. The message for writing an immutable component through a query now reads `replace it with commands.insert(entity, [Game/Kind, value])`.

```diff
-commands.insert(entity, Game.Command.entry(Kind, "pickup"))
+commands.insert(entity, [Kind, "pickup"])
 Game.Command.spawn(
   Game.Command.entryRaw(Position, { x, y }),
-  Game.Command.entry(Wall, {})
+  [Wall, {}]
 )
```

**Breaking: an initial resource in `Game.Runtime.make({ resources })` with a field the resource does not have no longer compiles.** `resources: { Config: { speed: 1, bogus: 2 } }` compiled and stored `bogus`, which then failed to restore from a save against a strict schema. It now fails with `Game/Config has no field bogus: pass only its own fields` (for a constructed resource, against its raw input). Drop the field.

```diff
-Game.Runtime.make({ services, resources: { Config: { speed: 1, bogus: 2 } } })
+Game.Runtime.make({ services, resources: { Config: { speed: 1 } } })
```
