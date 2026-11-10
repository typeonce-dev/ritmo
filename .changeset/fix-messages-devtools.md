---
"@typeonce/ritmo-devtools": patch
---

An invariant or `labels` inspector that reads a resource, service, or machine the runtime does not provide fails with the same message as `runtime.tick`, naming every one and where to provide it: `the runtime is missing resource Game/Limit: add to Game.Runtime.make({ resources: { Key: value } })`. It used to be a cut union under `__fixInvariantRequirements__` or `__fixLabelsRequirements__`.
