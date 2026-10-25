---
"@typeonce/ritmo-netcode": minor
"@typeonce/ritmo": patch
---

**Effects under rollback: `session.events(Event)` hands host code the simulation's events as confirmed, predicted, and withdrawn streams.** A rolled-back tick runs again and publishes its events again, so a sound played from an event played once per run, and every game de-duplicated events by confirmed tick by hand. A session now owns that: each `session.events(descriptor)` call is one host reader, pulled after the session advanced.

```ts
const hits = session.events(Hit) // an event of the runtime's schema
for (const { tick } of hits.withdrawn()) particles.cancel(tick) // a rollback undid this tick's hits
for (const { tick, value } of hits.predicted()) particles.burst(tick, value.at) // may still be undone
for (const { value } of hits.confirmed()) sounds.play(value.kind) // exactly once per hit
const lost = hits.lost() // EventsLost when the reader fell more than Netcode.eventWindow ticks behind
```

- `confirmed()` hands out each event once, when its tick can no longer run again (a lockstep session confirms every tick it runs). `predicted()` hands out events of ticks that may still be rolled back, stamped with the tick. A tick a rollback runs again keeps what was handed out when its events are the same (plain data, compared by value); otherwise `withdrawn()` names it and its new events are predicted again. A resync withdraws every predicted tick.
- An event outside the runtime's schema does not compile. `Netcode.Session` takes the schema's events as a third type parameter (`never` by default): a session annotated as `Netcode.Session<Input, TickError>` reads none. Annotate it with the events to read, `Netcode.Session<Input, TickError, typeof Hit>`, or let `Netcode.rollback(...)` infer it.
- New exports: `EventStreams`, `EventRecord`, `Withdrawn`, `EventsLost`, `eventWindow`.
- Replaces acting on events once `status().confirmed` passed their tick: the `Checkpoint` docs and the netcode playbook now point to `session.events(...)`.
