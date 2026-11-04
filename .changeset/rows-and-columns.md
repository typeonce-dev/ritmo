---
"@typeonce/ritmo": minor
"@typeonce/ritmo-render": patch
"@typeonce/oxlint-plugin-ritmo": patch
---

**Breaking: a query's `each()` returns entities, and values are read through `queries.x.data`. Matches, their `data` cells, and `entity.proof` are gone.** Iterating no longer keeps an object per entity and query, so loops over many entities run up to 3x faster, a game-shaped frame about 2x faster, and memory no longer grows with each query.

```diff
-for (const { data } of queries.movers.each()) {
-  const velocity = data.velocity.get()
-  data.position.update((position) => ({ x: position.x + velocity.x, y: position.y + velocity.y }))
-}
+const { data } = queries.movers
+for (const entity of queries.movers.each()) {
+  const velocity = data.velocity.get(entity)
+  data.position.update(entity, (position) => ({ x: position.x + velocity.x, y: position.y + velocity.y }))
+}
```

Every slot method takes the entity first. The fix for each old form:

| Before | After |
|---|---|
| `match.data.x.get()` | `data.x.get(entity)` |
| `data.x.set(value)`, `update(f)` | `data.x.set(entity, value)`, `update(entity, f)` |
| `data.x.setRaw(raw)`, `updateRaw(f)` | `data.x.setRaw(entity, raw)`, `updateRaw(entity, f)` |
| `data.state.transition({ from, to })` | `data.state.transition(entity, { from, to })` |
| `data.state.update({ state, data })` | `data.state.update(entity, { state, data })` |
| `data.sprite?.get()` | `data.sprite.get(entity)`, `undefined` when it lacks the component |
| `data.note !== undefined` | `data.note.has(entity)` |
| `commands.despawn(match.entity)` | `commands.despawn(entity)` |
| `match.entity.id` | `entity.id` |
| `found.value.data.x.get()` after `queries.q.get(id)` | `queries.q.data.x.get(found.value)` |
| `QueryMatch<S, Q>` | `QueryEntity<S, Q>`, with `QueryData<Q>` for the slots |
| `Query.Cells<Q>` | `QueryData<Q>` |
| `WriteCellForDescriptor<D>` | `WriteSlotOf<D>` |
| `match.entity.proof.position` | `data.position.get(entity)` |

`single()`, `singleOptional()`, `get`, `getHandle`, `children`, and `descendants` return entities too. `ReadCell` and `WriteCell` remain for resources.

`Entity.EntityRef` now takes `<S, Root, Proves, Lacks, Relates>`. `Entity.EntityMut`, `Entity.ref`, and `Entity.mut` are removed: only a query produces an entity.

The type checks are the same or stricter: a read slot has no `set`, a slot rejects an id or an entity whose query does not prove its component, and entities carry their proofs to `commands`.

**Kept values changed.** `queries.x.data` kept past its run throws, as a kept match did. A kept entity no longer throws by itself: it keeps naming its entity, reading its current value, and throws once the entity no longer holds the component. It never reads another entity, since ids are never reused, but it does not re-check the query, so an entity that left through `without` stays readable. To follow an entity across runs and re-check the query, keep `entity.id` and resolve it with `queries.x.get(id)`, as before.

`RenderSync` callbacks are unchanged: `context.data.x.get()` still works. Lint messages name the new forms.
