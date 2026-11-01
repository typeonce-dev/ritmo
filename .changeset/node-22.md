---
"@typeonce/ritmo": minor
"@typeonce/ritmo-browser": minor
"@typeonce/ritmo-render": minor
"@typeonce/ritmo-pixi": minor
"@typeonce/ritmo-math": minor
"@typeonce/ritmo-netcode": minor
"@typeonce/ritmo-devtools": minor
"@typeonce/oxlint-plugin-ritmo": minor
"@typeonce/ritmo-tools": minor
---

**Breaking: the packages require Node 22 or newer (Node 20 reached end of life on 2026-04-30).** `engines.node` is `>=22` for `@typeonce/ritmo`, `-browser`, `-render`, `-pixi`, `-math`, and `-netcode`; `>=22.12` for `@typeonce/oxlint-plugin-ritmo` (oxlint's own floor); `>=22.15` for `@typeonce/ritmo-devtools` (unchanged); and `>=22.19` for `@typeonce/ritmo-tools` (what `@effect/platform-node` needs). On Node 20, upgrade Node: `nvm install 22` (or 24), or `"node": ">=22"` in your CI's setup step.
