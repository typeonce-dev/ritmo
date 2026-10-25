---
"@typeonce/ritmo": minor
"@typeonce/oxlint-plugin-ritmo": minor
---

**Cooldowns and timers are deadlines: the step they end on, exact through saves and rollback.** A timer counted down by `dt` drifts by a rounded float every tick, and the float it saves means nothing once the fixed step changes. `Clock.Deadline<Hz>` is the absolute step a duration ends on, a plain number branded with the clock's rate:

```ts
// ready: Clock.Deadline<60> | null, its schema narrowing with Clock.isDeadline(step)
const Weapon = Descriptor.ConstructedComponent(z.object({ ready: z.unknown().refine(Clock.isDeadline(step)).nullable() }))("Game/Weapon")

const time = resources.time.get()
const { ready } = data.weapon.get()
if (ready === null || Clock.reached(time, ready)) {
  fire()
  data.weapon.set({ ready: Clock.deadline(time, Clock.duration(step, 0.5)) })
}
```

- `Clock.deadline(time, duration)`, `Clock.reached(time, deadline)`, and `Clock.remaining(time, deadline)` (whole steps left, for a readout). A deadline of a 60 Hz clock does not compile against a 30 Hz `Time`, and a raw number is not a deadline.
- `Clock.isDeadline(step)` is the guard for a game's schema, like `Entity.isHandle`: any whole number of steps, 0 or more.
- New lint rule `ritmo/no-float-timers` for simulation files: reports `timer -= dt`, `cooldown - time.dt`, and the like, and names `Clock.deadline` / `Clock.reached`. `position.x += velocity.x * dt` is integration and is not reported. Turn it on in the simulation override of `.oxlintrc.json`: `"ritmo/no-float-timers": "error"`.
