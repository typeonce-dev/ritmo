---
"@typeonce/ritmo": minor
---

**Breaking: `Schema.bind` takes the game's root, always.** Without a root, a game was branded by its schema type, which is covariant: a game and a game whose schema is a superset were interchangeable, so a system, schedule, query, or entity id of one compiled in the other, and a system that spawned and queried `Velocity` ran inside a runtime with no `Velocity`. Declare the root with `Schema.defineRoot` and pass it last:

```diff
-const Game = Schema.bind(Schema.fragment({ components: { Position } }))
+const Root = Schema.defineRoot("Game")
+const Game = Schema.bind(Schema.fragment({ components: { Position } }), Root)
```

```diff
-const Game = Schema.bind(Core, Combat)
+const Root = Schema.defineRoot("Game")
+const Game = Schema.bind(Core, Combat, Root)
```

This replaces 0.7's `Schema.merge` fix: `Schema.bind(A, B)` is now `Schema.bind(A, B, Root)`. A call without a root fails with `Schema.bind takes the game's root last: const Root = Schema.defineRoot('Game'), then Schema.bind(...fragments, Root)`. Values of games with different roots do not mix: the error names both, `Type 'RootToken<"Editor">' is not assignable to type 'RootToken<"Game">'`.

The root's name is its identity: two `defineRoot("Game")` calls, in one module or in two, make the same type, and games bound under them mix as one game would. Declare one root per game, under a name no other game in the program uses, and import that constant where descriptors name it (`Entity.Handle<typeof Root>`).

Types a game spelled with the schema in the root's place name the root instead:

```diff
-type Id = Entity.EntityId<typeof Game.schema, typeof Game.schema>
+type Id = Entity.EntityId<typeof Game.schema, typeof Root>
```

The same goes for `Command.SpawnedId`, `Schema.Schema.BoundSchedule`, `Schema.Schema.BoundStateMachine`, `EntityScope.EntityScope`, and the other types that take a root. `Schema.Schema.Game<S, Root>` no longer defaults `Root` to `S`. `Entity.isHandle` takes the root, not the schema:

```diff
-const isHandle = Entity.isHandle(Game.schema)
+const isHandle = Entity.isHandle(Root)
```
