---
"@typeonce/oxlint-plugin-ritmo": minor
---

**`oxlint --fix` does the whole job for `ritmo/use-ops-for-math`.** The rule points at `Ops` from `@typeonce/ritmo` (it moved from `@typeonce/ritmo-math`), and its fix now adds `import { Ops } from "@typeonce/ritmo"` when the file has none, once per file, after the last import (a `const { Ops } = require("@typeonce/ritmo")` in CommonJS, for vendored code). `x **= y` is fixed to `x = Ops.pow(x, y)` when `x` is a variable. `ritmo/use-random-for-randomness` names `Random` from `@typeonce/ritmo` the same way.

**Aliasing `Math` is reported.** `const { sin } = Math`, `const M = Math`, passing `Math` to a function, `globalThis.Math.sin`, and `Math[name]` with a computed key hid a non-exact call from the rule; each is now reported (without a fix). Exact members (`Math.PI`, `Math.abs`, `const { floor } = Math`) stay valid.

**New rule `ritmo/no-brand-cast`.** A cast to a branded type (`raw as ItemId` where `ItemId` comes from `.brand()`, `Schema.brand`, `Brand.Branded`, or a Ritmo brand such as `Random.State` or `Clock.Deadline`) skips the check the brand stands for. The rule reports it in simulation code and names the fix: decode through the schema, or the Ritmo constructor (`Random.seed`, `Clock.deadline`, `Game.Entity.handle`). Turn it on in the simulation override:

```json
{ "files": ["src/simulation/**"], "rules": { "ritmo/no-brand-cast": "error" } }
```
