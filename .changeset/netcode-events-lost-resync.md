---
"@typeonce/ritmo-netcode": minor
---

`EventsLost` has a `reason`: `"unread"` (the reader fell behind, as before) or `"resync"`. A peer one or two ticks ahead of seat 0 can confirm ticks that seat 0's next save makes idle; when the resync runs them again with other events, `lost()` now reports those ticks with `reason: "resync"`, where before the events it had handed out as confirmed stayed in the host's sound or score with no report. The new run's events are still not handed out a second time, and a tick that runs again with the same events (compared by value) reports nothing. `lost()` returns one report per call, a `"resync"` one first.

Code that builds an `EventsLost` (a test double) adds the field:

```diff
-const lost: Netcode.EventsLost = { _tag: "EventsLost", from: 10, to: 12 }
+const lost: Netcode.EventsLost = { _tag: "EventsLost", from: 10, to: 12, reason: "unread" }
```
