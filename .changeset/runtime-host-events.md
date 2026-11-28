---
"@typeonce/ritmo": minor
---

**`runtime.events(Descriptor)`: the host reads what a tick published.** A host that ticks the runtime itself (no netcode session) had no way to read a tick's events for sounds, particles, or rumble: an inspector reads events, but they are not held for it, so a `FixedLoop` frame that ran several steps before the host inspected dropped them. Games copied the events into a resource, or pushed them into an array a system closed over. Now a reader holds every event a system publishes from the next tick on, however many ticks run before the host reads, and hands each out once:

```ts
const hits = runtime.events(Hit) // once, next to the runtime; an event of the schema
// In FixedLoop's render, after the frame's steps:
for (const { tick, value } of hits.take()) sounds.play(value.amount)
const lost = hits.lost() // EventsLost, or undefined
```

- Records are `Runtime.EventRecord` (`{ tick, value }`, read-only), the shape a netcode session's `session.events(...)` hands out too. `tick` counts the runtime's ticks from 1 and never goes back.
- Nothing is dropped silently: `lost()` reports `Runtime.EventsLost` with a `reason`: `"unread"` (not read for more than `Runtime.eventWindow` ticks, or one tick published more than `streamCapacity` events), `"restore"` (a restore dropped what was unread), or `"rewind"` (a rewind undid ticks the reader saw; the ticks run again are handed out again).
- Events the host sent with `runtime.send` are not handed back, and a failed tick's events are not handed out. `close()` lets a reader go. A runtime without readers does no extra work.
- Under a netcode session, read `session.events(...)`: a rollback would show up as a `"rewind"` on every rollback.
- `debug.declareHostReads(events)`: events the host reads count as read for `event-never-read`, so a game no longer needs a system that reads an event only to quiet the lint.
- The `ritmo` skill says the host reads a tick's events with this reader, never through a resource or a variable a system closes over.
