---
"@typeonce/ritmo-devtools": minor
---

`Fuzz.run` over a `network` makes seats leave: with `network: { ..., leave: { seats: 2 } }`, up to that many seats leave the match for good in each run, on frames drawn from the run's seed. A seat that leaves closes its link and runs no more, and the peers still playing are told with `session.drop` once the link's latency passed, as a relay that saw the socket close tells them. From the tick they agree on, the simulation reads the seats' `left` input for it (`Fuzz.seats` takes `left`, as `Netcode.seats` does), so a rule of the game that breaks without a driver, or a system that is not deterministic about it, is found and shrunk like any other bug. Invariants are checked on the peers still there. A `Found` names the seats and frames in `left`, and its replay holds the `left` input for them from those frames on; `leave.seats` is at most the seats' `count - 2`, so two peers always play on.

**Breaking (types only):** `Fuzz.Found` has `left`, and `Fuzz.Seats` has `left`. Code that builds one by hand adds the field: `left: []` on a `Found`, `left: idle` on seats.
