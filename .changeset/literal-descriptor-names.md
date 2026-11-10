---
"@typeonce/ritmo": minor
---

**Breaking: a descriptor made with a name typed `string` is no longer a descriptor.** A helper typed `(name: string) => Descriptor.Component<number>()(name)` gave every descriptor it made one type, so the compiler accepted one for another (an entity of a query over one in a slot of the other, a despawn under the other's permission), and the mix-up surfaced at runtime as "An entity was used with the data of ... of a runtime it does not belong to". Every constructor that takes a name (`Descriptor.Component`, `ConstructedComponent`, `TransientComponent`, `Tag`, `EntityState`, `Resource`, `ConstructedResource`, `TransientResource`, `Event`, `Service`, `Hierarchy`, `Relation`, `Game.StateMachine`, `Game.EntityScope`, `EntityScope.make`, and `Clock.resource`) now returns, for a `string` name, a value no API takes, and the first place it is used fails with:

```
a descriptor's name is a literal type: pass the name as a literal or `as const`, or make the helper generic over it, <const Name extends string>(name: Name)
```

Make the helper generic over the name:

```diff
-const counter = (name: string) => Descriptor.Component<number>()(name)
+const counter = <const Name extends string>(name: Name) => Descriptor.Component<number>()(name)
```

Literal names (`Descriptor.Component<number>()("Game/Health")`), names `as const`, and template literal types (`` `Game/${string}` ``) work as before.
