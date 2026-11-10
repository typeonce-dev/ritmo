---
"@typeonce/ritmo": minor
---

**Breaking: `lookup.parent`, `Result.isSuccess`, and `Result.isFailure` are removed; each had another name for the same job.** `lookup.parent(id, R)` was `lookup.related(id, R)` for a hierarchy, and `result.ok` already narrows a `Result`. `lookup`'s methods now say in their JSDoc what each one is for and which query slot or query handle method to use instead.

```diff
-const hand = lookup.parent(item.id, ChildOf)
+const hand = lookup.related(item.id, ChildOf)

-if (Result.isSuccess(made)) use(made.value)
-if (Result.isFailure(made)) report(made.error)
+if (made.ok) use(made.value)
+if (!made.ok) report(made.error)
```
