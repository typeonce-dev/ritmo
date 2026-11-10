---
"@typeonce/oxlint-plugin-ritmo": patch
---

The `handle-runtime-result` docs say why `runtime.snapshot()` and `runtime.checksum()` return a `Result`: a schema's `encode` may reject a value, and a save cannot hold commands still queued. No change for games.
