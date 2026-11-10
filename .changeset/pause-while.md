---
"@typeonce/ritmo": minor
---

**Breaking: `pauseWhen` is now `pauseWhile`, and it pauses while a condition holds.** `Game.Schedule.pauseWhen(conditions, ...)` and a system spec's `pauseWhen: conditions` paused the systems while a condition *failed*, the same polarity as `when`, so the name read backwards: `pauseWhen([Game.Condition.inState(HitStop, "Frozen")], Move)` ran `Move` only during the freeze, with no error. `Game.Schedule.pauseWhile(conditions, ...)` and the spec key `pauseWhile` pause while *any* of their conditions holds (`pauseWhile([frozen, cutscene])` pauses during either). `when` keeps its meaning (runs while all hold), so the two read together: `{ when: [playing], pauseWhile: [frozen] }` runs when playing and pauses while frozen. Everything else about pausing is unchanged: a paused reader holds its stream entries, marker steps in the group still run, and `when` and pauses nest as before.

`pauseWhen` no longer compiles, so no call keeps its old meaning silently. Rename it and invert each condition: drop a `Game.Condition.not(...)` the old call needed, and add one where it had none. A list `pauseWhen([a, b])` (paused while `a` or `b` failed) becomes `pauseWhile([Game.Condition.not(a), Game.Condition.not(b)])`.

```diff
 const frozen = Game.Condition.inState(HitStop, "Frozen")
-Game.Schedule.pauseWhen([Game.Condition.not(frozen)], Move, ApplyHits)
+Game.Schedule.pauseWhile([frozen], Move, ApplyHits)
-Game.System("Game/Read", { events, pauseWhen: [ready] }, run)
+Game.System("Game/Read", { events, pauseWhile: [Game.Condition.not(ready)] }, run)
```

Debug output follows the name: `SystemDescription.pauseWhen` is `pauseWhile`, the `stream-loss-unread` lint says `under pauseWhile`, and a `system.skipped` event with `held: true` carries the `pauseWhile` condition that held.
