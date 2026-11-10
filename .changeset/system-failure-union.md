---
"@typeonce/ritmo": minor
---

A system body that returns failures of different shapes now compiles, and the system fails with their union. Only failures TypeScript could merge into one type compiled before (two string literals); a string in one branch and an object in another, or two objects with different fields, did not:

```ts
Game.System("Game/Buy", spec, ({ resources }) => {
  if (resources.gold.get() < 5) return Result.failure("NotEnoughGold" as const)
  if (resources.stock.get() === 0) return Result.failure({ _tag: "OutOfStock" as const })
})
// fails with "NotEnoughGold" | { _tag: "OutOfStock" }, and so does runtime.tryTick for its schedule
```

`System.SystemBody`'s second type parameter is now the body's whole return type, not its failure type; `System.BodyFailure<R>` gives the failure type of a return type, and `System.SystemReturnFix` is the message a body that returns a value or a promise names. Game code passes neither, so nothing in it changes.
