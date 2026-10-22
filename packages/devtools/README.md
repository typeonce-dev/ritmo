# `@typeonce/ritmo-devtools`

`Determinism.check` compares the same scripted simulation twice, including
transient components that snapshots omit:

```ts
const result = Determinism.check(({ hostClock }) => makeSimulation(hostClock), {
  schedule: "update", frames: 1800, hostClock: HostClock.test()
})
if (!result.ok) throw new Error(JSON.stringify(result))
```

The factory returns `{ runtime, schedules }`, with a fresh debug runtime on
every call. A difference reports its frame, value path, and the first system
or schedule marker found by a diagnostic rerun. This checks the supplied
inputs on the current JavaScript engine.

Debug sessions for `ritmo` runtimes: run schedules headless, keep a trace
history, and ask what happened as text. Built for coding agents first; the
same data will back human-facing tools.

```sh
pnpm add -D @typeonce/ritmo-devtools
```

The package reads the core `Debug` handle, which exists only on runtimes made
with `debug: { hostClock }`. Production runtimes carry no handle and pay
nothing. The modules read no platform globals: give the runtime and the
session the same `HostClock` (`HostClock.test()` headless, so every timing is
0 and text output is identical across runs; `BrowserHostClock.make(window)`
in the browser).

A dev-only debug handle in a browser game:

```ts
const runtime = Game.Runtime.make({
  services,
  debug: import.meta.env.DEV ? { hostClock: BrowserHostClock.make(window) } : undefined
}).success
if (runtime.debug !== undefined) Monitor.attach({ debug: runtime.debug }, { schedules, host: window })
```

## The debugging loop

1. **Get a headless runtime.** Keep the game's simulation (schema, systems,
   and the schedules ticked at the fixed step) in modules that import no
   renderer or page API. Build those schedules on a runtime made with
   `debug: { hostClock: HostClock.test() }`, and feed input from
   `Keyboard.scripted(bindings, timeline)` (from `@typeonce/ritmo-browser`)
   instead of the page. Put that in a script that makes the runtime, the
   `Session`, and the run (see the cheat sheet below), and run it with Node.
2. **Read the lints, then orient.** `session.describe()` starts with lints
   (events nobody reads, next states no marker applies, relations whose
   failures nobody reads, ...); a warning there is often the whole answer. Then it lists every schedule step, each
   system's declared reads and writes, and who reads and writes each
   component, resource, and event. `run()` also prints the lint warning count.
   Info-level `read-before-write` lints list systems that run before the
   schedule's first writer of what they read, so they see the previous run's
   value. That is often intended (input before movement), but it is a
   one-frame lag worth checking when a reaction looks late.
3. **Reproduce.** Script the input with `Keyboard.scripted(bindings, timeline)`
   (or replay a recorded browser session), add an invariant that encodes the
   bug (`Invariant.fromInspector(Game.Inspector(...))`, returning a message
   when violated), and `session.run("update", { frames: 600 })`. The run stops at the
   first frame the invariant fails, a system fails, or a system throws.
4. **Explain.** `session.why(entity, Component)` and
   `session.whyResource(Resource)` show the latest changes and which system
   made them; `why` also names the systems whose declared `spawns` could
   have spawned the entity. `session.journal({ frames: [from, to], entity })`
   shows everything that touched an entity around the failure.
   `session.report()` lists warnings the trace collected and the current
   entity counts per component. `run()` prints the warnings it raised.
5. **Fix and keep it.** Rerun the same script, then turn it into a test next
   to the game so the bug stays fixed.

```sh
node --import tsx debug.ts
```

## Cheat sheet

```ts
import { Keyboard } from "@typeonce/ritmo-browser"
import { Invariant, Session } from "@typeonce/ritmo-devtools"

const keyboard = Keyboard.scripted(bindings, [
  { frame: 0, press: ["left"] },          // frame = index of the input snapshot
  { frame: 30, release: ["left"] },
  { frame: 32, press: ["jump"], release: ["jump"] } // a tap within one frame
])
const hostClock = HostClock.test()           // every timing 0: identical text on every run
const runtime = Game.Runtime.make({ services, resources, machines, debug: { hostClock } }).success
// An invariant is a typed, read-only Inspector that returns a violation
// message, or undefined while it holds. It declares its reads like a system:
// Session.make rejects at compile time one that reads a resource, service,
// or machine the runtime does not provide.
const HealthNeverNegative = Invariant.fromInspector(Game.Inspector("health >= 0", {
  queries: { player: Game.Query({ selection: { health: Game.Query.read(Health) }, with: [Player] }) }
}, ({ queries }) => {
  const health = queries.player.each().map((match) => match.data.health.get())
  return health.some((value) => value < 0) ? `health ${health.join(", ")}` : undefined
}))

const session = Session.make(runtime, {
  hostClock,                              // times run(); the runtime's clock
  schedules: { setup, update },           // names used by run() and in traces
  describe: { render },                   // described and linted, never run (needs a renderer)
  invariants: [HealthNeverNegative],      // checked after every frame of every run
  history: 600                            // frames kept for journal/why
})

session.run("setup")
const run = session.run("update", { frames: 300, until: (frame) => frame === 120 })
run.data.ok                               // true when completed or `until` returned true
run.data.stop                             // { reason: "completed" | "until" | "failure" | "defect"
                                          //   | "invariant" | "missingRequirements" | "tickOrder", frame, ... }

session.describe()                        // schema, schedules, access, lints
session.dump({ with: [Player], limit: 5 })// entities, resources, machines, pending commands
session.why(12, Position)                 // latest changes to e12 Position
session.whyResource(Score)                // latest changes to a resource
session.journal({ frames: [180, 185], entity: 12, kinds: ["write", "effect"] })
session.journal({ system: "Game/Move", last: 10, verbose: true })
session.system("Game/Move")               // declared access, stats, recent lines
session.streams()                         // event/transition/relation-failure retention
session.report()                          // per-system timing and warnings
```

Every call returns a `Rendered` value: `console.log` prints its text,
`.data` holds the structured result, `JSON.stringify` serializes the data.

## Reading the output

```
f185 update  Game/ApplyVelocity  write e12 Game/Position {x:130,y:418} -> {x:130,y:421.2}
f185 update  Game/LandPlayer     queued insert
f185 update  Game/LandPlayer     applyDeferred: insert e12 Game/Grounded={}
f186 update  -                   transition Game/Flow Playing -> Paused applied
```

- `f185`: frame number, counting every `tick`/`tryTick` call from 1, setup
  included. Keyboard timeline frames count input snapshots from 0 instead, so
  with one setup frame, timeline frame `n` is read in session frame `n + 2`.
  `e12`: entity 12. `&e12`: a stored handle to entity 12.
- The schedule path shows nesting, for example `update > onEnter(Game/Flow=Paused)`.
- `write`: a component written through a system's write query. `resource`,
  `emit`, `next state`: resource writes, event emits, and queued machine
  values. Failed systems show `(rolled back)`.
- `queued ...` then `applyDeferred: ...`: a command queued by a system, then
  its structural effect when a marker applied it. The system named on the
  effect line is the one that queued it.
- `skipped: <condition> is false`: a run condition held the system back;
  `discarded N Event` means messages published meanwhile are lost to it.
- `missed ...`: the system could not see entries dropped before it ran.
- Lines that change nothing are hidden by default; pass `verbose: true` to
  see them, marked `(unchanged)`.
- Large objects print only their changed paths:
  `~ up.held: false -> true, left.held: false -> true`.

## Live monitor (browser)

`Monitor.attach(runtime, { schedules, host: window })` adds a panel to a running game for
people who want to see how it works without reading its code. Toggle it
with the backslash key or the corner button. It observes the runtime only while it is
open, so a closed monitor costs nothing.

```ts
const monitor = Monitor.attach(runtime, {
  schedules: { fixedUpdate: step, frame },           // the schedule objects you tick
  host: window,                                      // its document, timers, events, and clock
  pick: (event) => entityUnderPointer(event),        // optional: "Pick on screen"
  locate: (entity) => clientPositionOf(entity)       // optional: ring on the selected entity
})
```

- **Overview:** time per schedule tick, the busiest systems, entity counts
  per component as sparklines (a line that only rises is a leak), state
  machines, and alerts (failed systems, NaN or infinite writes, messages
  discarded by skipped systems).
- **Systems:** every schedule as its systems in order, grouped by run
  conditions. Each system shows what it writes, emits, spawns (learned
  while running), and reads. A dot shows whether it is working, idle, or
  skipped. Hover a name to light up its writers (orange) and readers (blue).
  Click a system for rates, skip reasons, spawn kinds, and its last error.
- **Entity:** pick an entity on screen, by id, or by component, and follow
  its components live along with the changes systems make to it.

Timings include tracing overhead, so compare systems with each other rather
than with a run where the monitor is closed. `Monitor.Collector` is the same
data without DOM, for a custom UI.

## Report warnings

| Code | Meaning |
|---|---|
| `pending-commands` | A system queued commands and the frame ended before a marker applied them. Usually a missing `applyDeferred()`. |
| `pending-next-state` | A system queued a next state and the frame ended before an `applyStateTransitions()` marker applied it. |
| `missed-read` | A system lost stream, removed, or despawned entries at capacity. |
| `discarded-messages` | A skipped system discarded messages published while it was skipped. |
| `transition-failed` | An exit or transition schedule failed (queued again), or an enter schedule failed. |
| `system-failed` | A system returned an expected failure or threw. |
| `ignored-failure` | A `tick` / `tryTick` result failed and nobody read its `_tag` before the next tick (or the session's `report()`): the failure went unnoticed and later systems did not run. `run` stops on it with `reason: "ignored-failure"`. |
| `non-finite-value` | A system wrote NaN or an infinity into a component, resource, event, or spawned entity. The message names the entity and path; `why()` shows the history. |
| `population-growing` | A component's count rose through every quarter of a run of 60+ frames: its lowest count in each quarter was higher than in the quarter before. Bursts that are cleaned up do not trigger it; entities that are never despawned do. `run()` returns the counts in `growing`. |

The report also starts with the static lints from `describe()`.

## Lint from the command line

`ritmo-devtools lint <entry>` is the pass/fail check for a game's `check`
script. `<entry>` exports `lintTarget` (see the `Lint` module): it prints
every lint of the schedules with its fix and exits with 1 on a warning.

```sh
ritmo-devtools lint src/simulation.ts
```

It also checks that the oxlint simulation rules from
`@typeonce/oxlint-plugin-ritmo` cover the simulation. Every module that
importing `<entry>` loads, inside the directory of the `.oxlintrc.json` in the
working directory and outside `node_modules`, must have
`ritmo/keep-simulation-headless` on there (overrides apply in order, the last
match wins; `ignorePatterns` matches are uncovered). Modules imported inside
`lintTarget` or later (render schedules passed to `describe`) are host code
and are not checked, nor are type-only imports. A missing config, one with
`extends`, or one that never turns the rule on prints why the check was
skipped and does not fail. The check needs Node 22.15 or later.

| Code | Meaning |
|---|---|
| `uncovered-simulation-module` | The simulation loads this file, but no simulation override in `.oxlintrc.json` covers it, so oxlint never checks it for platform, time, randomness, or math calls. Add it to the override's `files`, or stop importing values from it. Exits with 1. |

The trace shows what systems wrote, not what they read. When a system writes
a wrong value from correct inputs, the journal narrows the bug to that
system (it runs, in order, and writes this value) and the rest is its code.

## Replays

A replay is the last seconds of a play session as a file: a debug artifact
to open headless, explain, and turn into a test, then delete.

```ts
// In the game's dev build: record the simulation schedule.
const recorder = Replay.recorder(runtime, {
  schedule: simulate, name: "simulate",
  keep: 30, step: STEP,                      // seconds kept, the fixed step (Clock.hz)
  sink: ReplayViteSink.make({ fetch: (url, init) => fetch(url, init) }),
  hostClock: BrowserHostClock.make(window),  // for savedAt
  saveOn: { failure: true, invariants: [DeadAreGone] } // saves by itself
})
Monitor.attach(runtime, { schedules, host: window, replay: recorder }) // adds "Save replay"

// vite.config.ts: writes posted replays to .replays/<time>.json and logs them.
plugins: [ReplayVitePlugin.plugin()]
```

- The recorded schedule's services must be `snapshot()` sources of plain
  data (input) or plain data (rules); anything else is a compile error that
  names the service. Time and randomness live in the world, so the file holds
  everything the simulation read: periodic snapshots, each tick's source
  values (as changes), and every `runtime.send`.
- Sinks deliver files: `Replay.memorySink()` (tests), `ReplayNodeSink`
  (files, for headless runs), `ReplayViteSink` + `ReplayVitePlugin` (dev
  server). The generic modules call no platform API; wall time comes from
  `hostClock`.

```ts
// In Node: make(playback) builds the game with the recorded input.
const make = (playback: Replay.Playback) => {
  const hostClock = HostClock.test()       // replay text is identical on every run
  const runtime = makeRuntime({ input: playback.source(Input), debug: { hostClock } })
  return { runtime, schedules: { simulate }, hostClock }
}
const file = Replay.parse(JSON.parse(readFileSync(".replays/....json", "utf8")))
const replay = file._tag === "Success" ? Replay.session(make, file.success) : file
replay.success.play()                       // run the ticks; reports checkpoint divergence
replay.success.session.why(12, Position)    // a normal Session over the replayed frames
Replay.verify(make, file.success)           // replays twice: nondeterminism shows up
Replay.extract(make, file.success, { from: 1400, to: 1412 }) // a small replay for a test
```

A replay recorded with another schema fails with "replay recorded with an
older schema".

## Recording a browser session

```ts
const recorder = Keyboard.recording(Keyboard.actions(window, bindings))
// ...provide `recorder` as the keyboard service, play, reproduce the bug...
copy(JSON.stringify(recorder.timeline()))

// In Node:
const timeline = Keyboard.parseTimeline(bindings, JSON.parse(saved))
if (timeline._tag === "Success") {
  const keyboard = Keyboard.scripted(bindings, timeline.success)
}
```

A recorded timeline replays to the same input snapshots. A browser session
reproduces headless when everything else nondeterministic, such as time
steps, random numbers, and viewport size, also comes in through services
or resources that the simulation sets to the same values.
