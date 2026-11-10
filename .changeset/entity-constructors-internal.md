---
"@typeonce/ritmo": minor
---

**Breaking: `Entity.makeEntityId`, `Entity.makeHandle`, and `Entity.draft` are no longer exported.** They were the runtime's own constructors and checked nothing: `commands.spawn(Entity.draft(Entity.makeEntityId(7), { "Game/Position": { x: 1, y: 2 } }))` compiled under `spawns(Position)` and spawned an entity with no components while its type said it held `Position`. Use the checked ways instead:

```diff
-commands.spawn(Entity.draft(Entity.makeEntityId(7), { "Game/Position": { x: 1, y: 2 } }))
+commands.spawn(Game.Command.spawn([Position, { x: 1, y: 2 }]))

-const handle = Entity.makeHandle(entity.id)
+const handle = Game.Entity.handle(entity)

-// a number read from a save or a network message
-const id = Entity.makeEntityId(raw)
+if (Entity.isHandle(Root)(raw)) {
+  const id = Game.Entity.id(raw) // still proves nothing: resolve it with queries.x.get(id)
+}
```
