---
"@typeonce/ritmo": patch
"@typeonce/ritmo-browser": patch
"@typeonce/ritmo-devtools": patch
"@typeonce/ritmo-netcode": patch
"@typeonce/ritmo-render": patch
"@typeonce/oxlint-plugin-ritmo": patch
---

The `@typeonce/oxlint-plugin-ritmo` README lists built-in oxlint rules that pair well with Ritmo, each with the Ritmo mistake it catches: a `Result` checked with `if` instead of `.ok`, a switch over a closed set that misses a new member, an asset load or upload that is never awaited, `[object Object]` in HUD text, and oxlint's default `correctness` rules. The type-aware ones need `oxlint-tsgolint` and `oxlint --type-aware`.

The packages' sources pass these rules: unnecessary type assertions and default type arguments are gone, unused imports are removed, and switches over closed sets name every member. The published types are the same types, written without their default arguments.
