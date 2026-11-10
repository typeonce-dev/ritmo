# Performance

**Goal:** the slow system is named from a measurement, its cause fixed, and the gain shown by the same measurement before and after.

**Principles:** prove it headless; extend what exists before adding.

1. Measure on a real clock, without `debug`. Reproduce the slow scene headless (scripted input, or a replay recorded in the browser: the `@typeonce/ritmo-devtools` README), and time a fixed number of ticks of its schedule on a runtime made without `debug`, reading a host clock before and after: `BrowserHostClock.make(globalThis)` in Node, `BrowserHostClock.make(window)` in the browser (both read `performance.now()`). That number is the baseline; compare it with the step (`1000 / hz` ms). When the headless tick fits well inside the step and the browser frame does not, the cost is in render or host code: profile the page instead.
2. Name the system. Run the same scene in a `Session` over a runtime made with `debug: { hostClock }`, giving both the same real clock (`HostClock.test()`, which the debugging loop uses, makes every timing 0); `session.report()` lists the systems by total time. A `debug` runtime adds its own cost (the devtools README), so its timings rank the systems but are not the number to compare: that stays the step 1 measurement.
3. Fix the cause in that system. The usual ones:
   - It calls `queries.x.rows()`, an object per entity each step: loop over `each()` and read `queries.x.data` (the `rows()` JSDoc).
   - It tests every body against every other: a broad phase ([`../references/spatial-grid.md`](../references/spatial-grid.md)).
   - It redoes work on entities that did not change: a `Game.Query.changed(...)` or `Game.Query.added(...)` filter visits only those written or added since its previous run. Work that may run less often runs when `Clock.every(time, duration)` is true; that changes results, so it is a mechanic change ([`mechanic.md`](mechanic.md)).
   - The report warns `population-growing`: entities that are never despawned, so every query that matches them grows.
4. Keep the behaviour: the change is a refactor ([`refactor.md`](refactor.md)) unless it is the mechanic change above.

**Check:** the step 1 measurement, same scene, input, and machine, gives a lower number after the fix than before; the simulation's headless tests pass unchanged, and the game's check passes.
