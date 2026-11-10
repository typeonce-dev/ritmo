---
"@typeonce/ritmo": minor
---

**Breaking: `Clock.durationOfSteps` takes a literal count only; a count from data goes through the new `Clock.durationOfStepsRaw`.** A computed count (a `number`) compiled and threw at runtime for 0, a negative, or a fraction ("Clock.durationOfSteps needs a positive whole number of steps, got 0"). It is now a compile error naming the fix (`Clock.durationOfSteps needs a literal count of steps: use Clock.durationOfStepsRaw for data`), as `Clock.duration` already did for seconds, and `Clock.durationOfStepsRaw(step, n)` returns a `Result` that fails with `InvalidDuration`, the error `Clock.durationRaw` returns (its `seconds` is the count divided by the rate):

```diff
-const reload = Clock.durationOfSteps(step, config.reloadSteps)
+const reload = Clock.durationOfStepsRaw(step, config.reloadSteps)
+if (!reload.ok) return reload
```

Literal counts (`Clock.durationOfSteps(step, 3)`) compile as before. A union of literals (`flag ? 3 : 0`) and a literal past `Number.MAX_SAFE_INTEGER` no longer compile either.

**`Clock.duration` and `Clock.durationRaw` now round a half step up, as documented.** A number of seconds whose exact product with the rate is a whole step and a half often landed just below it in floating point and rounded down. These durations are now one step longer, which changes a game's timing where it uses one: `1.025s` at 60 Hz is 62 steps (was 61), `2.05s` at 30 Hz is 62 (was 61), `0.145s` at 100 Hz is 15 (was 14), and `0.29s`, `0.57s`, `1.13s` at 50 Hz are 15, 29, and 57 (were 14, 28, and 56). 57 durations of up to three decimals and 5 seconds moved across 20, 30, 50, 60, 100, 120, 144, and 240 Hz; every other duration is the same step count as before. Replays and fuzz cases recorded with one of these durations diverge: record them again.
