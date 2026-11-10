---
"@typeonce/ritmo": patch
---

`runtime.rewind` gives readers what a runtime that never rewound gives them:

- A system of the rewound schedule whose first run came after the checkpoint (one in an `onEnter`/`onExit` schedule, or after a failing system) is back to never having run. It used to stay registered with its positions at zero, so it held every event, removal, and despawn published after the checkpoint and read them all on its next run, where a runtime that never rewound had dropped them. The frames ticked after a rewind also keep what the frames after the checkpoint kept the first time, so a reader's first run sees the same events either way.
- A system or inspector outside the schedule (a HUD, render sync) sees every resource the rewind put back as changed: `changedResource(...).changed()` was `false` for a value it had already drawn and the rewind undid.
- An entity the rewind took away and the ticks after it brought back (the same id) no longer matches `Game.Query.added(X)` a second time for a reader outside the schedule that had seen `X` on it: it matches `changed(X)`, as the `Checkpoint` module doc says. A component that reader never saw on that id is still `added`. A render system creating a node on `added` created two before.

No code changes.
