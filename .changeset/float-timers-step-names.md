---
"@typeonce/oxlint-plugin-ritmo": minor
---

`ritmo/no-float-timers` knows more names and shapes of a step's length, and reports `x - dt` only where it is written back, so it counts across ticks.

Newly reported, with the rule's message saying to store a `Clock.deadline` and check `Clock.reached`:

- other names: `x -= fixedDt`, `x -= dtSeconds`, `x -= STEP_SECONDS` (any case, with or without `_`), `x -= time.delta`, `x = x - step.seconds`, and a bare `x -= delta`;
- other shapes: `x -= 1 / 60`, `x -= dt * 1`, `elapsedMs += dt * 1000`, `x -= Math.min(dt, 0.1)`, and a `const` that holds a step's length (`const tick = frame.dt; timer -= tick`).

No longer reported: `x - dt` / `x + dt` whose value is not written back where `x` came from, such as a look-ahead (`const until = horizon + dt`) or a test (`if (accumulator - dt >= 0)`). Written back means a target of the same name (`x = x - dt`, `let cooldown = Math.max(0, state.cooldown - dt)`, `{ left: buff.left - dt }`, `resources.timer.set(timer - dt)`) or an `update` callback's result (`resources.timer.update((left) => left - dt)`); those are still reported.
