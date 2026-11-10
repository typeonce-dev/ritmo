---
"@typeonce/oxlint-plugin-ritmo": minor
---

`ritmo/no-kept-query-values` follows entities and `data` through more forms. Newly reported, with the message saying to keep `entity.id` and resolve it with `queries.x.get(id)`, or to keep plain values from `queries.x.rows()`:

- entities copied or picked into a kept value: `local.list = Array.from(queries.x.each())`, `.map((e) => e)` and `.reduce((best, e) => ...)` results kept in `local` or a module variable, `const [first] = queries.x.each()` then `local.target = first`;
- `Object.assign(local, { target: queries.x.each()[0] })`;
- a context destructured or renamed: `({ queries: q })` then `q.x.data`, `({ queries: { x } })` then `x.data`, `({ local: kept })` then `kept.target = ...`, and `(ctx) => { ctx.local.target = ctx.queries.x.each()[0] }`;
- a system function declared apart and passed to `Game.System(...)` or `Game.Inspector(...)` by name in the same file, keeping an entity in a module variable (`cache.set(1, entity)`).

Ids stay unreported in each form (`Array.from(queries.x.each(), (e) => e.id)`, `first?.id`).
