---
"@typeonce/oxlint-plugin-ritmo": minor
---

**Breaking: `ritmo/handle-tick-result` is `ritmo/handle-runtime-result`, and it also catches a `Result` passed on unchecked.** Besides a dropped `tick`, `tryTick`, `restore`, or `rewind`, it reports `runtime.snapshot()` and `runtime.checksum()`, and any of them handed to a function, printed in a template string, put in an object or array, or used as an operand without a check: a save function that takes `unknown` otherwise stores the `{ ok, value }` wrapper instead of the world. A variable, a field, a `return`, `.ok`, and `void` keep the `Result` for the code to check; a helper that takes the `Result` gets it once it is named.

Fix: rename the rule in `.oxlintrc.json`, then check each new report.

```diff
-"ritmo/handle-tick-result": "error",
+"ritmo/handle-runtime-result": "error",
```

```diff
-persist(runtime.snapshot())
+const saved = runtime.snapshot()
+if (saved.ok) persist(saved.value)
```
