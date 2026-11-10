---
"@typeonce/ritmo-netcode": minor
---

**A seat whose page reloads ends the match instead of deadlocking it.** A new session for a seat already in the match restored seat 0's stored save and waited for inputs seat 0 had pruned, while seat 0 ignored the new session's inputs: both stayed `Stalled` with no timeout. Now every peer ends with `Disconnected` and the new reason `"restarted"`, naming the seat, and so does the new session (at once when seat 0's save reaches it, or after `timeoutMS` of hearing a match that runs without it). There is no way back into the match: `onFailure` shows that the match ended and offers a new one. Sessions are told apart by their `hostClock` reading when made, carried in hellos, pings, and saves.

**`status().waiting`** names what a stalled session waits for: `{ seat, tick, forMS }` (the seat whose input for `tick` this peer cannot run past, and for how long by `hostClock`), or `undefined` while it runs, waits for a save, or is halted. A HUD draws "waiting for seat 1"; a headless test says why a match stopped.

Code that matches every `Disconnected` reason, or builds a `Status` (a test double), adds the new member:

```diff
 switch (failure.reason) {
   case "closed": return "the connection closed"
   case "timeout": return `seat ${failure.seat} went quiet`
+  case "restarted": return `seat ${failure.seat} reloaded: start a new match`
 }
-const status: Netcode.Status = { ...fields, delayChanges: 0 }
+const status: Netcode.Status = { ...fields, delayChanges: 0, waiting: undefined }
```

Session bugs over a jittery, lossy link are fixed:

- Inputs of a newer epoch that overtook their save were taken into the old timelines, with the acknowledgements they carry: a peer could prune its own inputs for ticks the save then ran again and stall for good, or desync after the resync. Inputs (and their acknowledgements and pacing) now apply only in the epoch they were sent in; the sender sends them again.
- A hidden tab announced its hide once, so under loss the others could miss it and end with `Disconnected` after `timeoutMS`. The announcement now carries the inputs the others still need, goes out five times, and every peer that heard it passes it on with its pings while the seat is hidden (with two seats, it is lost only when all five copies are). Its inputs count in a later epoch too, from that save's floor on; one of a newer epoch waits for its save, but the seat counts as hidden at once, so a seat that hides right after a save is not timed out by a peer whose save was lost.
- A message overtaken by a later one lowered the acknowledgements a peer held, so a seat that hid could announce fewer inputs than the others had already run with: a desync with a long input delay (rollback), and after a resync (lockstep). Acknowledgements now only grow.
- A seat back from a hide under `"resync-on-return"` sent checksums of the ticks it ran on guesses while it waited for its save, and the others ended `Desynced`. A seat played around sends no checksums.

The session protocol is version 3: a peer on an earlier version ends with `ProtocolMismatch`. Give every peer the same release.
