---
"@typeonce/ritmo-netcode": minor
---

**`session.events(...)` hands out the runtime's `EventRecord`.** The record shape and the window moved to core, where `runtime.events(...)` uses them too, so a host reads both readers' events with one type. `Netcode.EventsLost` is `Runtime.EventsLost` with the session's reasons (`"unread" | "resync" | "save"`), unchanged in shape. The netcode docs say to read events only through the session: the runtime's own reader would report every rollback as a `"rewind"`.

**Breaking (names only):** `Netcode.EventRecord` and `Netcode.eventWindow` are gone; use the core ones (same shape, same value, 1024).

```diff
+import * as Runtime from "@typeonce/ritmo/Runtime"
-const heard: Array<Netcode.EventRecord<Hit>> = []
+const heard: Array<Runtime.EventRecord<Hit>> = []
-const kept = Netcode.eventWindow
+const kept = Runtime.eventWindow
```
