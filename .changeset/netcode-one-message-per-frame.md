---
"@typeonce/ritmo-netcode": minor
---

**A session sends one message per link per frame, and lighter ones.** Until now a session handed its links a message for each thing it said (inputs, checksums, pings, pongs), every step, so a frame that ran several steps sent several of each, and a relay that bills per message (a Cloudflare Durable Object) paid for all of them. Now everything one frame says goes out as one message per link, a bundle: driven by `session.update` from a `FixedLoop`, one per host frame however many steps it ran; each `advance` called directly is a frame of its own.

- A bundle names the protocol, the sender, and its epoch once. It still carries every input a peer has not acknowledged (a lost message costs nothing the next one does not repeat), but writes each distinct input once and which of them each tick had: a held input is two numbers however many ticks it was held. Acknowledgements are written as how far behind the sender's tick they are.
- A message that must survive loss (a seat reported gone, a change of who plays) goes out with the next five frames' bundles instead of five times in one frame. A page that hides still sends its announcement five times at once: no frame follows.
- `status().sent` counts the messages handed to the links and their bytes in UTF-8.

Over 120 ms with 60 ms of jitter and 5% loss, on pages at 60 Hz that sometimes run two or three steps in a frame: 2 peers went from 139 messages and 62 KiB a second to 97 and 16 to 23 KiB; 8 peers from 728 and 290 KiB to 387 and 73 to 103 KiB (the lower figure for input held 20 frames, the higher for input that changes nearly every frame).

**Breaking: every page of a match must run this version.** The session protocol changed (version 6): a peer on 0.26 or older ends with `ProtocolMismatch`.

**Breaking: the function `session.update(...)` returns takes the loop's two arguments.** Passed to `FixedLoop.start` as it is, nothing changes. Called from the game's own `update`, pass them through, so the session knows the frame's last step:

```diff
 const tick = session.update({ input: readInput, onHalted })
 FixedLoop.start({
   ...loop,
-  update: () => tick(),
+  update: (seconds, at) => tick(seconds, at),
 })
```

A link that batched the session's messages itself (an outbox flushed once per task) can send each as it is now.
