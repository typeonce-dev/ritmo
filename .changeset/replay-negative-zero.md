---
"@typeonce/ritmo": patch
"@typeonce/ritmo-devtools": patch
---

A replay saved to disk verifies when the world holds `-0`. `runtime.checksum()` hashed `-0` apart from `0`, but JSON writes `-0` as `0`, so every replay read back from a file failed `Verify.acrossEngines` and `ritmo-devtools verify` ("DIVERGED at tick N") while the same replay verified in memory. `checksum()` now hashes `-0` as `0`, as a save writes it. Replays recorded before this fix with `-0` in the world still hold the old hashes: record them again.

`Desync.compare` and every devtools printout write `-0` with its sign, so a `-0` / `0` difference no longer reads `0 -> 0`.
