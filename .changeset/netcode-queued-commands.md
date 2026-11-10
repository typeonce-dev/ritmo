---
"@typeonce/ritmo-netcode": patch
---

`SyncFailed`'s doc names `QueuedCommands`: a session whose `simulate` leaves a command queued after its last marker ends with it on the first checksum or save, since `runtime.checksum()` and `runtime.snapshot()` now fail then. End `simulate` with `Game.Schedule.applyDeferred()`. Peers that restore a save no longer keep their own transient resources or report the replaced world's despawns (see `@typeonce/ritmo`), which made a match desync after its first save or after every resync. No code changes.
