---
"@typeonce/oxlint-plugin-ritmo": minor
---

New rule `ritmo/no-kept-query-values`: reports an entity from `queries.x.each()` or a query's `data` kept past its run, in `local` state (directly, in a literal, pushed or set into a collection there, or captured by a closure stored there) or in a variable outside the `Game.System` / `Game.Inspector` callback. Kept data throws in the next run, and a kept entity is not checked against its query again. The report says to keep `entity.id` and resolve it with `queries.x.get(id)`, or to keep plain values from `queries.x.rows()`. Add it to `.oxlintrc.json` for every file:

```jsonc
"ritmo/no-kept-query-values": "error"
```
