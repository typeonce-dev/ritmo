---
"@typeonce/ritmo": minor
---

Eight common mistakes now fail with a message that names the cause and the fix, instead of a bare type mismatch. Programs that compiled before still compile.

| Mistake | Message now |
| --- | --- |
| `({ commands }) => commands.spawn(draft)` or `async () => {}` as a system body | `a system returns nothing or Result.failure(...), and runs synchronously: wrap an expression body in braces, and drop async` |
| `Schema.fragment({ relations: { ChildOf } })` with the pair `Descriptor.Hierarchy(...)` returned | `ChildOf is the pair Descriptor.Hierarchy(...) returns: register its relation, ChildOf.relation` |
| `Game.System.relates(Targets)` with the pair | `Game/Targets is passed as the pair Descriptor.Hierarchy/Relation(...) returns: pass the relation itself, the pair's .relation` |
| `querys: {}` next to other keys of a system spec | `querys is not a system spec key: use queries, resources, events, ...` (every category) |
| `Game.Query.write(...)` in an inspector's query | `an inspector only reads: select with Game.Query.read (or optional) instead of Game.Query.write` |
| An entity of another query in a slot of `data` | `Property '"proves component Game/Position"' is missing in type '{ readonly "proves component Game/Health": true; }'` |
| `Schema.fragment({ components: [Position] })` | `components takes a record keyed by name, not an array: components: { Position, Health }` |
| `Descriptor.Component<T>("Game/Name")` (and `Resource`, `Event`, `Service`, `TransientComponent`, `TransientResource`) | `the name goes in the second call: Descriptor.Component<Value>()(name)` |

`Game.System` takes its body as `System.SystemBody` (a `SystemRun` whose return type also carries the message); a system's `run` is still a `SystemRun`.
