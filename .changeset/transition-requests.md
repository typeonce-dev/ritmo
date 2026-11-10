---
"@typeonce/ritmo": minor
---

Two changes to how `applyStateTransitions(...)` runs transition schedules:

- **A request queued after `cancelPending()` in a transition schedule takes the cancelled one's place at this marker.** A system in one machine's `onEnter`/`onExit`/`onTransition` that cancelled another machine's request, queued before the marker, and then queued a new one, had the cancelled request commit anyway and the new one wait for the next marker. Now the first request queued after the cancel (`set`, `setIfChanged`, or `transition`) commits at this marker and the cancelled one never does, when the marker has not reached that machine yet:

  ```ts
  // Flow's onEnter system, while Music -> Quiet is queued for this marker
  nextMachines.music.cancelPending()
  nextMachines.music.set({ _tag: "Off" }) // now: Off at this marker, never Quiet (was: Quiet now, Off at the next marker)
  ```

  A `set` without the cancel keeps the old rule (the queued value commits now, the new one at the next marker), and so does any request for a machine the marker already applied. Game code that worked around this by ticking a second marker can drop it.

- **A failing `onEnter` schedule no longer skips the others.** When one enter schedule of a state returned a failure, the other enter schedules of that state, and those of the sub-states that start existing with it, never ran, on that tick or any later one. Each enter schedule now runs in its usual order whatever the ones before it returned; the tick still returns the first failure, the transition is still committed, and it is still traced as `enterFailed`. Exit and `onTransition` schedules keep their rule: a failure there undoes the exit phase and queues the transition again.
