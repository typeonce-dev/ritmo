---
"@typeonce/ritmo-netcode": patch
"@typeonce/ritmo": patch
---

Rollback sessions no longer end with `CheckpointLost` (`Released` for `"window"`) while every wrong guess is within `maxRollback`, when the runtime keeps no more checkpoints than that. A rollback rewinds to the checkpoint of its tick, which the runtime keeps, and the session then took a second checkpoint for the same tick: each rollback spent one slot of the window for nothing, so with several seats correcting guesses inside one window it covered fewer than `maxRollback` ticks (4 seats, `maxRollback: 12`, `checkpoints: 12`: lost at frame 25). The session now reuses the checkpoint it rewound to, as `RollbackOptions.maxRollback` already says: the runtime must keep at least `maxRollback` checkpoints.

If you drive `runtime.checkpoint` and `runtime.rewind` yourself, do the same: a rewind keeps the checkpoint it went to, so take no new one for that tick when it runs again (the `Checkpoint` module's example shows it).
