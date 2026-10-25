---
"@typeonce/ritmo-devtools": minor
---

**`Fuzz.run` fuzzes a rollback game over a faulty network with an optional `network`.** Declare every seat's input with `Fuzz.seats(Seats, { codec, count, idle, generate: (random, frame, seat) => input })` and pass `network: { seed, latencyMS, jitterMS, loss, step }`: each seat plays on its own peer (a fresh `make(playback)`, whose `playback.source(Seats)` is that peer's `seats.source`), joined by a seeded `MemoryNetworkLink` and driven by `Netcode.rollback` sessions, with invariants checked on every peer. A desync or any other session failure is the new `SessionFailed` violation (`seat`, and the `Netcode.SessionError`), and shrinking shrinks the input timeline one seat at a time with the network seed fixed. Over a network, a schedule that cannot be rewound or a runtime that cannot save does not compile, as for `Netcode.rollback`. Devtools now depends on `@typeonce/ritmo-netcode`.

`Fuzz.Violation` gains `SessionFailed`: a `switch` over it that must be exhaustive needs the new case:

```diff
   case "Defect": return ...
+  case "SessionFailed": return `seat ${violation.seat}: ${violation.error._tag}`
```
