---
"@typeonce/ritmo": minor
"@typeonce/ritmo-render": minor
"@typeonce/oxlint-plugin-ritmo": minor
---

**Breaking: an optional query slot is the read cell, or `undefined` when the entity does not hold the component.** `Game.Query.optional(X)`, `Game.Query.optionalRelation(R)`, and `Game.Query.optionalRelated(R)` (and `select` slots of `RenderSync.system`) gave a slot that was always an object, so `if (data.hero !== undefined)` compiled and was always true, and there were two ways to read it (`present` then `get()`, or `value()`). The slot is now `ReadCell<T> | undefined`: reading it without a check does not compile (`'data.sprite' is possibly 'undefined'`). `present`, `value()`, and the `OptionalReadCell`, `PresentOptionalReadCell`, and `AbsentOptionalReadCell` types are removed. A component whose own value can be `undefined` stays unambiguous: an `undefined` slot means absent, and `get()` returning `undefined` means present.

```diff
- burning: data.burning.present
+ burning: data.burning !== undefined
- const parent = !data.parent.present ? undefined : data.parent.get()
+ const parent = data.parent?.get()
- const stride = data.stride.value()
+ const stride = data.stride?.get()
- if (data.sprite.present) draw(data.sprite.get())
+ if (data.sprite !== undefined) draw(data.sprite.get())
- QueryTypes.OptionalReadCell<T>
+ QueryTypes.ReadCell<T> | undefined
```

To match only entities that hold a component ("is this the player?"), list it in the query's `with: [Player]` filter instead of an optional slot.

`@typeonce/oxlint-plugin-ritmo` removes `ritmo/use-cell-value`: with one way to read an optional slot there is nothing to steer between. Delete `"ritmo/use-cell-value"` from `.oxlintrc.json`: oxlint stops with `Rule 'use-cell-value' not found in plugin 'ritmo'` while the config names it.
