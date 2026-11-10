---
"@typeonce/ritmo": minor
---

`runtime.rewind` is traced: `debug.observe` and `debug.observeHost` deliver a `Debug.RewindEvent` (`{ type: "rewind", frame, tick, toTick, ok }`, ticks being change ticks), so tools can tell a rollback's ticks run again from new ones. `observeHost`'s `tick.start` carries the change tick it starts at (`tick`): a rewind undid the ticks that started at or after its `toTick`.

**Breaking for host listeners that narrow by elimination.** `Debug.HostEvent` gained a member with no `schedules`, so a listener that rules out `send` and `failure.ignored` and then reads `event.schedules` no longer compiles. Handle the rewind first:

```diff
 runtime.debug.observeHost((event) => {
   if (event.type === "send" || event.type === "failure.ignored") return
+  if (event.type === "rewind") return
   if (!event.schedules.includes(simulate)) return
```

A `switch` over `Debug.TraceEvent` that checks it is exhaustive needs a `case "rewind"`.
