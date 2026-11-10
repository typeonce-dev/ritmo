---
"@typeonce/ritmo": minor
---

**Breaking: an `update` callback that returns a field the value does not have no longer compiles, spread or not.** A spread in a callback's result escapes TypeScript's excess property check, so `data.position.update(entity, (p) => ({ ...p, xx: p.x + 1 }))` compiled, stored `xx` next to `x` and `y`, and a save holding it then failed to restore against a strict schema (`InvalidComponent ... Unrecognized key: "xx"`). Component and resource `update`, and `updateRaw` on constructed descriptors, now fail with a message naming the descriptor and the field:

```
Game/Position has no field xx: return only its own fields
```

Fix the field name, or drop the field. Values with an index signature (`Record<string, number>`), arrays, tuples, primitives, `Map`s, `Set`s, and unions of object shapes (any field of any member) are accepted as before. `WriteCell` and `ConstructedWriteCell` take the resource's name as a last, optional type parameter. A helper generic over the value type (`<T, D>(slot: WriteSlot<T, D>) => slot.update(entity, (v) => v)`) cannot be checked and no longer compiles: write the result there with `slot.set(entity, next(slot.get(entity)))`.

```diff
-data.position.update(entity, (p) => ({ ...p, xx: p.x + 1 }))
+data.position.update(entity, (p) => ({ ...p, x: p.x + 1 }))
```
