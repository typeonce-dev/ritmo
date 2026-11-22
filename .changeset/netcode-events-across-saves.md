---
"@typeonce/ritmo-netcode": minor
---

**`session.events` confirms the ticks a save makes final.** A save (the match's start, `resync()`, a page seated again after it loaded again, a hidden page back under `"resync-on-return"`) is the host's world as it ran, guesses of other seats' input included. Until now every peer, the host too, withdrew the ticks it had run before the save but not confirmed yet, and never confirmed them: their events were gone without a word. Under rollback that is up to `maxRollback` ticks on every page at each save: a page that reloads mid-match lets the others run on guesses of its seat until it is back, so a lap, a checkpoint, or a sound of that stretch never reached any page. The page the save seated was not affected: it confirms every tick from the save on, as before.

- The host confirms every tick it ran before its save.
- The save carries the inputs each of its last ticks ran with on the host. Every other peer confirms the ticks it ran with the same inputs, from a tick both confirmed; what `predicted()` handed out of them stands.
- The ticks before the save that a peer ran otherwise, confirmed otherwise (it had an input the host's world never got), or did not run at all, are reported by `lost()` with the new reason `"save"`, and what was predicted of them is withdrawn. A page the save seats for its first match (one that loaded again) is told nothing of the ticks before it: the save's world holds them.
- Fixed: a peer ahead of the host can confirm the save's own tick and the `inputDelay` ticks after it; `lost()` reported one tick fewer when a resync ran them again with other events.

The sync message carries the inputs (protocol version 6, with this release's other session changes): every page of a match runs this release.

**Breaking (types only):** `EventsLost["reason"]` is `"unread" | "resync" | "save"`. A `switch` over it adds a case; ticks reported `"save"` are ones whose events this peer cannot tell, like `"resync"`:

```ts
const lost = hits.lost()
if (lost !== undefined && lost.reason !== "unread") {
  // "resync" or "save": the match ran ticks lost.from to lost.to otherwise than this page acted on
}
```
