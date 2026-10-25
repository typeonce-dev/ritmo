---
"@typeonce/ritmo-netcode": minor
"@typeonce/ritmo-browser": minor
---

**Hidden tabs announce themselves instead of timing out.** A browser stops a hidden tab's frames, so its peer went silent and the match ended with `Disconnected { reason: "timeout" }`. Sessions take an optional `hidden` option: the session hears the moment its page hides, tells the others, and they apply the declared policy and show it in the new `status().hidden` (one boolean per seat):

```ts
import { BrowserVisibility } from "@typeonce/ritmo-browser"

const session = Netcode.rollback(runtime, {
  ...options,
  hidden: { visibility: BrowserVisibility.make(document), afterMS: 30_000, then: "resync-on-return" }
})
// HUD: session.status().hidden[seat] → "waiting for Ada"
```

- `"stall"`: the others wait for the hidden seat; it goes on from where it stopped when it returns.
- `"resync-on-return"`: the others play on with idle input for it; on return, seat 0 sends a save and it restores it (its `advance` is `Waiting` meanwhile). While seat 0 itself is hidden, the others wait.
- A hidden seat that never returns still ends the session with `Disconnected`, at most `afterMS + timeoutMS` after it hid.

New in netcode: `Visibility` (the contract), `MemoryVisibility` (a page a test hides and shows), `Netcode.HiddenPolicy`, `Netcode.HiddenOptions`. New in browser: `BrowserVisibility.make(document)` over the Page Visibility API.

**Breaking:** the session protocol is now version 2, so peers on an older version end with `ProtocolMismatch`. Fix: update every peer to the same release.
