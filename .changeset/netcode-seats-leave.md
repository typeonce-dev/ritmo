---
"@typeonce/ritmo-netcode": minor
---

**A match plays on when a seat leaves.** Until now one player closing a tab, losing the connection, or reloading ended the session of every peer with `Disconnected`. Now the peers still playing agree on the seat's last input and go on, with no save and no restart, and a session ends only when it is the last one in the match or out of it.

- A seat is out once it sent nothing for `timeoutMS`, once the link that carried it closed (one link per peer), or once the game tells a session its transport saw the seat go: `session.drop(seat)`, for a relay that sees a socket close long before the timeout. One peer that knows is enough: it tells the others.
- Every peer reads the same input for that seat from the same tick: `Netcode.seats(codec, { count, idle, left })` takes the input of a seat that left (`idle` when omitted). Give one no player can send and a system can tell a seat without a driver from one that presses nothing: park its car, remove it, hand it to a bot.
- `session.status().left[seat]` is `undefined`, or `{ reason, lastInput, tick }`, for a HUD.
- No confirmed tick runs again when a seat leaves, so `session.events(...)` readers lose and repeat nothing.
- The host is the lowest seat still playing: when seat 0 leaves, the next seat answers `resync()` and makes the saves. Under `hidden`, it is that seat that is never played around.
- A seat that left gets its seat back with a save: when its session reaches the others again, or when a new session says hello for it (a reloaded page). A reload within `timeoutMS` no longer ends a match of two.
- The network fuzzer makes seats leave: `Fuzz.run`'s `network.leave` in `@typeonce/ritmo-devtools`.

**Breaking: every page of a match must run this version.** The session protocol changed: a peer on 0.25 or older ends with `ProtocolMismatch`, as after any protocol change.

**Breaking: `Disconnected` no longer means "a seat left".** It ends a session that is the last one in the match, or out of it, and its new `who` says which: `"others"` (everyone else left; `seat` is the last other seat, `reason` why it left) or `"self"` (this session is out; `seat` is its own). `seat` is always a number: a session whose every link closed ends with `who: "self"`, its own seat, and `"closed"`, where `seat` was `undefined`. `reason` is the new `Netcode.LeftReason`, which adds `"dropped"`. This replaces 0.23's `"restarted"` fix ("a seat whose page reloads ends the match"): `"restarted"` with another seat's number no longer reaches `onFailure`, since the new page is given the seat; it now comes with `who: "self"`, when another page took this session's place.

```diff
 const describe = (failure: Netcode.Disconnected): string => {
-  switch (failure.reason) {
-    case "closed": return "the connection closed"
-    case "timeout": return `seat ${failure.seat} went silent`
-    case "restarted": return `seat ${failure.seat} reloaded: start a new match`
-  }
+  if (failure.who === "others") return "everyone else left"
+  return failure.reason === "restarted" ? "this game is open in another tab" : "you were disconnected"
 }
```

A game of more than two seats that must end when anyone leaves now says so itself: end the match in the simulation when a system reads the `left` input.

A match still starts only once every seat said hello, and nothing times out before that: a seat that never arrives is the lobby's to handle.

**Breaking (types only):** `Netcode.Seats` has `left`, `Netcode.Status` has `left`, and `Netcode.Session` has `drop`. Code that builds one by hand (a test double) adds the field: `left: idle` on seats, `left: [undefined, undefined]` on a status, `drop: () => {}` on a session.
