---
"@typeonce/ritmo-netcode": minor
---

**`session.leave()`: a seat leaves the match on purpose.** A page that quit a match (back to the lobby, on a socket the lobby keeps) had no way to end its session: the others stalled behind its seat until `timeoutMS`, or until the room called `drop` on their side, and the session stayed subscribed to its `hidden` visibility. Now:

```ts
loop.stop()
session.leave()
```

- The session tells the other peers at once (its last inputs, then that it leaves, a few times against loss) and ends: every later `advance` fails with `Disconnected` (`who: "self"`, `reason: "left"`), a `FixedLoop` driven by `update` stops, and it unsubscribes from the visibility. It closes no link. A second call does nothing.
- The others count the seat out about one round trip later, as after a `drop`, with the new `LeftReason` `"left"` in `status().left`, and play on; when the host leaves, the next seat hosts. A peer that missed the message hears it from the others. The last other seat in the match ends with `Disconnected` (`who: "others"`, `reason: "left"`).
- Before the match starts it ends the session too, and seat 0 forgets its hello: the match waits for a new session of that seat.

**Breaking: every page of a match must run this version.** The session protocol changed (version 7): a peer on an older release ends with `ProtocolMismatch`. `LeftReason` (and `Disconnected["reason"]`) gained `"left"`: a `switch` over it that must be exhaustive gets a case for it, for example `case "left": return "left the race"`.

