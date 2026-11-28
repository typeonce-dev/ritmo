---
"@typeonce/ritmo-devtools": minor
---

**`hostReads` in a lint target and a session.** Events the host reads with `runtime.events(...)` or a netcode session's `session.events(...)` are listed there and count as read, so `event-never-read` no longer reports an event only the host reads (the lint target does not run the host code that makes the readers). Until now a game added a system that read the event and was never run, only to quiet the lint; delete it and list the event instead:

```ts
export const lintTarget = () => ({ runtime, schedules: { update }, hostReads: [Hit] })
```
