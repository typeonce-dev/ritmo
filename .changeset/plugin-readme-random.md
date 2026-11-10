---
"@typeonce/oxlint-plugin-ritmo": patch
---

The README's `ritmo/no-brand-cast` example compiles: the random resource is `Descriptor.ConstructedResource(Random.codec)("Game/Rng")`, given `Random.seed(1)` in `Game.Runtime.make`, and the reported line is the raw cast `1 as Random.State`. `Random.resource` never existed.
