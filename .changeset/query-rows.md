---
"@typeonce/ritmo": minor
---

`queries.x.rows()` reads every entity of a query into plain values: each row is `{ id, values }`, with one field per slot of the query's `selection` (`undefined` for an optional slot whose entity lacks the component), in `each()` order and with the query's filters applied. The values stay readable after the run, so a view layer, an inspector's result, a memoized helper, or a test can keep them, where a kept `queries.x.data` throws.

```ts
const BuildingView = Game.Inspector("Town/BuildingView", { queries: { buildings: BuildingRead } }, ({ queries }) =>
  queries.buildings.rows())

for (const { id, values } of runtime.inspect(BuildingView)) panel.show(id, values.tile, values.site?.progress)
```

`QueryValues<Q>` and `QueryRow<S, Q>` (from `@typeonce/ritmo/Query`) type them. A row carries the entity's `id`, not the entity, so it cannot be read through `data` later: resolve it with `queries.x.get(id)` to act on the entity again. `rows()` reads every slot of every entity and makes an object per row (about 50 ns per entity with two slots in the new `query/rows-10k` bench case, and about 110 ns with five, against about 20 ns for five slots read through `each()` and `data`), so systems keep reading `data`.

A game that wrote its own rows helper can replace it:

```diff
-type Row<Q> = { readonly entity: QueryEntity<typeof Game.schema, Q>; readonly data: { readonly [K in keyof QueryData<Q>]: ReturnType<QueryData<Q>[K]["get"]> } }
-const rowsOf = (query) => query.each().map((entity) => ({ entity, data: /* every slot's get(entity), with casts */ }))
-const buildings = rowsOf(queries.buildings)
+const buildings = queries.buildings.rows() // ReadonlyArray<QueryRow<GameSchema, typeof BuildingRead>>
```
