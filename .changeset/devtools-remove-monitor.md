---
"@typeonce/ritmo-devtools": minor
---

**Breaking: the live browser monitor is removed.** `Monitor` (`Monitor.attach`, `Monitor.Collector`, `recentSystem`, `recentSchedule`, and their types) is gone, with no replacement export: debugging is headless and text-first, and the package no longer needs the `DOM` lib. Record the browser session as a replay and debug it with a `Session`:

```diff
- Monitor.attach(runtime, { schedules, host: window, replay: recorder })
+ const recorder = Replay.recorder(runtime, { schedule: simulate, name: "simulate", keep: 30, step: STEP, sink: ReplayViteSink.make({ fetch: (url, init) => fetch(url, init) }), hostClock: BrowserHostClock.make(window), saveOn: { failure: true } })
+ // In Node: Replay.session(make, file.value) or Session.make(runtime, { hostClock: HostClock.test(), schedules }), then why / journal / report.
```

To find an entity without clicking it, give the session a `labels` inspector and filter `session.dump({ with: [Player] })`.
