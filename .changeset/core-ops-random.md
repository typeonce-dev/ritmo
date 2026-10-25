---
"@typeonce/ritmo": minor
"@typeonce/ritmo-math": minor
"@typeonce/ritmo-devtools": minor
"@typeonce/ritmo-netcode": minor
"@typeonce/ritmo-browser": minor
---

**Breaking: `Ops` and `Random` moved from `@typeonce/ritmo-math` into `@typeonce/ritmo`.** Determinism belongs to the runtime: every simulation needs same-bits math and a seeded generator, with or without the 2D helpers. The modules are unchanged; only the import path moves, and `@typeonce/ritmo-math` no longer exports them. The `Ops` header now states that its list is closed: the 22 functions engines may approximate and `**`; everything else on `Math` is already exact. `@typeonce/ritmo-devtools` and `@typeonce/ritmo-netcode` no longer depend on `@typeonce/ritmo-math`.

```diff
- import { Ops, Random } from "@typeonce/ritmo-math"
+ import { Ops, Random } from "@typeonce/ritmo"
- import * as Random from "@typeonce/ritmo-math/Random"
+ import * as Random from "@typeonce/ritmo/Random"
- import * as Ops from "@typeonce/ritmo-math/Ops"
+ import * as Ops from "@typeonce/ritmo/Ops"
```

`oxlint --fix` with `ritmo/use-ops-for-math` adds the new import where a `Math` call is rewritten; other imports need the path changed by hand.
