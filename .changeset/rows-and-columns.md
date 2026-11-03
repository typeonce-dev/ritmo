---
"@typeonce/ritmo": minor
---

**Query handles gain `rows()` and `columns()`: a loop over many entities that keeps no object per entity.** A row is one entity, what its query proves included, and a column is one read or write slot of the query. Reads, writes, rollback, and `changed` work as they do through a match's cells, and a read column has no `set`:

```ts
const { position, velocity } = queries.movers.columns()
for (const row of queries.movers.rows()) {
  const p = position.get(row)
  const v = velocity.get(row)
  position.set(row, { x: p.x + v.x, y: p.y + v.y })
}
```

A kept column throws after its run. A kept row keeps naming its entity: a column reads that entity's current value or throws once the component is gone. Rows go to `commands` where a match's `entity` goes. Optional, relation, constructed, and entity state slots have no column yet: reach them through `each()`.

Queries now build matches only when `each()` or a lookup asks for them, and commit is faster, so existing `each()` loops also run faster without a change.
