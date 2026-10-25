---
"@typeonce/ritmo-netcode": minor
"@typeonce/ritmo": patch
---

**Adaptive input delay.** `inputDelay` is a fixed number of ticks, and the right value depends on a connection that changes during a match. Give `adaptiveDelay` instead and the session moves the delay within the bounds from the measured round trip:

```ts
Netcode.rollback(runtime, { ...options, adaptiveDelay: { min: 1, max: 4 } })
session.status().inputDelay // the delay in use
```

- The delay starts at `max` and moves to `ceil(roundTripMS / 2 / step ms)` for the slowest other seat (the smoothed round trip), clamped to the bounds, once that target held for 4 measurements in a row (one every 250 ms).
- Each seat moves only its own delay. Every input message already names its tick, so a change needs no agreement and no protocol change; seats may run different delays. A rise leaves the ticks it skips idle (`seats.idle`); a fall drops the local input for as many frames (`Advanced.input` is `undefined`), so no tick gets two inputs.
- Every peer must give the same `inputDelay`, or the same `adaptiveDelay.max`: after a save, that many ticks are idle for every seat.
- Giving both `inputDelay` and `adaptiveDelay` does not compile (`give inputDelay or adaptiveDelay, not both`). Bounds that are not whole numbers with `0 <= min <= max` fail with `InvalidOptions` (`field: "adaptiveDelay"`).
- `Status` gains `inputDelay` (the delay in use) and `delayChanges` (how many times it moved).
- `MemoryNetworkLink` links gain `setLatency(ms)`, to change a peer's latency mid-match in tests.
- The netcode playbook recommends `adaptiveDelay` for play over the internet.
- **Breaking: `inputDelay` moved from `Netcode.Options` to the new `Netcode.Delay`.** Options passed inline to `rollback` and `lockstep` are unchanged. Where options are typed by hand, add the delay type:

  ```diff
  - const options: Netcode.Options<PlayerInput> = { seats, seat, links, hostClock, step, inputDelay: 3 }
  + const options: Netcode.Options<PlayerInput> & Netcode.Delay = { seats, seat, links, hostClock, step, inputDelay: 3 }
  ```
