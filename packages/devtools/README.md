# `@typeonce/ritmo-devtools`

Debug sessions for `ritmo` runtimes: run schedules headless, keep a trace
history, and ask what happened as text. Built for coding agents: every
answer is text and data, and nothing draws in the page.

```sh
pnpm add -D @typeonce/ritmo-devtools
```

The main import (`Session`, `Fuzz`, `Invariant`, `Replay`, `Lint`, ...) and
`ritmo-devtools lint` need no peer dependency. Each optional peer is for one
feature: `playwright` and `vite` for runs in browser engines
(`PlaywrightEngine`, `ritmo-devtools verify`), `vite` for `ReplayVitePlugin`,
and `rolldown` and `oxlint` for `ritmo-devtools scan`.

The package reads the core `Debug` handle, which exists only on runtimes made
with `debug: { hostClock }`. Production runtimes carry no handle and pay
nothing; a debug runtime freezes every value it is handed, so leave `debug`
off in what ships and in long headless runs that use no devtools. The modules read no platform globals: give the runtime and the
session the same `HostClock` (`HostClock.test()` headless, so every timing is
0 and text output is identical across runs; `BrowserHostClock.make(window)`
in the browser).

A dev-only debug handle in a browser game:

```ts
const runtime = Game.Runtime.make({
  services,
  debug: import.meta.env.DEV ? { hostClock: BrowserHostClock.make(window) } : undefined
}).value
```

In the browser, record a replay (see [Replays](#replays)) and debug it
headless with a `Session`.

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
   when violated), and `session.run("update", { frames: 600 })`. Give the
   session `labels` for the entities the bug is about, so every line says
   `player e12` instead of `e12`. The run stops at the
   first frame the invariant fails, a system fails, or a system throws.
4. **Explain.** `session.why(entity, Component)` and
   `session.whyResource(Resource)` show the latest changes and which system
   made them; `why` also names the systems whose declared `spawns` could
   have spawned the entity. When the writer only passed on a wrong input,
   raise `depth` to follow what it declared it reads, one system further
   back per step. `session.journal({ frames: [from, to], entity })`
   shows everything that touched an entity around the failure.
   `session.report()` lists warnings the trace collected and the current
   entity counts per component. `run()` prints the warnings it raised.
   When the wrong value appears within one frame, between two systems,
   step that frame: run up to the frame before it, then
   `const frame = session.step("update")`, `frame.until(ApplyDamage)` stops
   before that system, `session.dump(...)` / `why` / `journal` show the
   world and the partial frame, `frame.next()` runs one step (a system or
   a marker), and `frame.finish()` runs the rest and reports the frame as
   `run` does, invariants included. `frame.check()` asks the invariants
   mid-frame, where one may legitimately fail until a later marker applies.
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
const runtime = Game.Runtime.make({ services, resources, machines, debug: { hostClock } }).value
// An invariant is a typed, read-only Inspector that returns a violation
// message, or undefined while it holds. It declares its reads like a system:
// Session.make rejects at compile time one that reads a resource, service,
// or machine the runtime does not provide.
const HealthNeverNegative = Invariant.fromInspector(Game.Inspector("health >= 0", {
  queries: { player: Game.Query({ selection: { health: Game.Query.read(Health) }, with: [Player] }) }
}, ({ queries }) => {
  const health = queries.player.each().map((entity) => queries.player.data.health.get(entity))
  return health.some((value) => value < 0) ? `health ${health.join(", ")}` : undefined
}))
// Labels name entities in every line: `player e12` instead of `e12`. An
// inspector returning entity id -> label; any other return does not compile.
const Labels = Game.Inspector("labels", {
  queries: { players: Game.Query({ selection: { player: Game.Query.read(Player) } }) }
}, ({ queries }) => new Map(queries.players.each().map((entity) => [entity.id, "player"] as const)))

const session = Session.make(runtime, {
  hostClock,                              // times run(); the runtime's clock
  schedules: { setup, update },           // names used by run() and in traces
  describe: { render },                   // described and linted, never run (needs a renderer)
  invariants: [HealthNeverNegative],      // checked after every frame of every run
  labels: Labels,                         // evaluated after every frame; despawned entities keep theirs
  history: 600                            // frames kept for journal/why
})

session.run("setup")
const run = session.run("update", { frames: 300, until: (frame) => frame === 120 })
run.data.ok                               // true when completed or `until` returned true
run.data.stop                             // Session.Stop: { reason: "completed" | "until" | "failure" | "defect"
                                          //   | "invariant" | "invariant-threw" | "labels-threw" | "ignored-failure"
                                          //   | "missingRequirements" | "tickOrder", frame, ... }

const frame = session.step("update")      // one frame, a step at a time; refuses run/tick until finished
frame.until(ApplyDamage)                  // runs the steps before the system value; Result: reached, or
                                          //   { reason: "failure" | "defect" | "frameEnded" | "notAhead" | ... }
session.dump({ entities: [12] })          // the world between two systems (journal and why show the partial frame)
frame.next()                              // exactly one step: a system or a marker
frame.check()                             // invariants now (may fail mid-frame); Result
frame.finish()                            // the rest of the frame, reported like run(name): labels, invariants

session.describe()                        // schema, schedules, access, lints
session.dump({ with: [Player], limit: 5 })// entities, resources, machines, pending commands
session.why(12, Position)                 // latest changes to e12 Position
session.why(12, Health, { depth: 3 })     // and, under each, the declared reads behind it, two levels back
session.whyResource(Score)                // latest changes to a resource
session.journal({ frames: [180, 185], entity: 12, kinds: ["write", "effect"] })
session.journal({ system: "Game/Move", last: 10, verbose: true })
session.system("Game/Move")               // declared access, stats, recent lines
session.streams()                         // event/transition/relation-failure/dropped-relation retention
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
  `e12`: entity 12; `player e12` when the session's `labels` name it (the
  label it had at the end of that line's frame). `&e12`: a stored handle to
  entity 12. Write entities as `e${id}` in invariant messages and the run
  summary labels them too.
- The schedule path shows nesting, for example `update > onEnter(Game/Flow=Paused)`.
- `write`: a component a system's write query changed to a different value
  (writing back an equal value is not recorded). `resource`,
  `emit`, `next state`: resource writes, event emits, and queued machine
  values. Failed systems show `(rolled back)`.
- `queued ...` then `applyDeferred: ...`: a command queued by a system, then
  its structural effect when a marker applied it. The system named on the
  effect line is the one that queued it. A despawn also lists each edge it
  dropped: `Game/Targeting from e7 to e12 dropped: e12 despawned` (what
  `Game.System.readDroppedRelations` delivers).
- `skipped: <condition> is false`: a run condition held the system back;
  `discarded N Event` means messages published meanwhile are lost to it.
- `missed ...`: the system could not see entries dropped before it ran.
- `rewind to tick 141, undoing f12-f14`: `runtime.rewind` put the world back
  to a checkpoint (a rollback peer does this when late input arrives), so
  what frames 12 to 14 changed is gone and the ticks after it run in their
  place. `why`, `journal`, and every other filter show it between the lines
  it separates, so a value whose `before` is not the previous line's `after`
  has the rewind above it. `report()` counts the rewinds.
- Lines that change nothing are hidden by default; pass `verbose: true` to
  see them, marked `(unchanged)`.
- Large objects print only their changed paths:
  `~ up.held: false -> true, left.held: false -> true`.

`why` and `whyResource` with `depth` above 1 indent, under each change,
what the writing system declared it reads, with the latest traced fact that
could have produced it; each `depth` step goes one system further back:

```
e12 Game/Health is now 40; last 1 changes (oldest first):
could have spawned it: Game/SpawnEnemy
indented: what each writing system declared it reads, and the latest fact that could have produced it (declared: possible causes, not observed reads)
f181 update  Game/ApplyDamage  write e12 Game/Health 70 -> 40
  read Game/Damage [{amount:30}] (declared), emitted by Game/Hitscan at f181
    read Game/Position of 14 matching entities now (declared; the trace does not say which it read)
    read resource Game/Aim {target:12} (declared), written by Game/AimAtNewest at f180
  read e12 Game/Armor 5 (declared), spawned by Game/SpawnEnemy at f3
```

- The trace records writes, not reads, so every indented line is a
  possible cause, marked `(declared)`, not a read that was observed.
- An event read lists what was published to it since the system's previous
  run, and by whom (`runtime.send` for the host). A component in the query
  that wrote the value is read on the same entity: its latest change before
  the run. A resource or machine: its latest change or transition.
- A query over other entities says only how many match now: the trace does
  not say which one the system used. Use `journal` to narrow it down.
- A system already in the chain prints `(cycle: not followed)`; `limit`
  caps the reads under each line (`…+N more declared reads`). In `.data`,
  these lines have `kind: "read"` and `depth` 1 or more.

## Report warnings

| Code | Meaning |
|---|---|
| `pending-commands` | A system queued commands and the frame ended before a marker applied them. Usually a missing `applyDeferred()`. |
| `pending-next-state` | A system queued a next state and the frame ended before an `applyStateTransitions()` marker applied it. |
| `missed-read` | A system lost stream, removed, or despawned entries at capacity. |
| `discarded-messages` | A skipped system discarded messages published while it was skipped. |
| `transition-failed` | An exit or transition schedule failed (queued again), or an enter schedule failed. |
| `system-failed` | A system returned an expected failure or threw. |
| `ignored-failure` | A `tick` / `tryTick` result failed and nobody read its `ok` before the next tick (or the session's `report()`): the failure went unnoticed and later systems did not run. `run` stops on it with `reason: "ignored-failure"`. |
| `non-finite-value` | A system wrote NaN or an infinity into a component, resource, event, or spawned entity. The message names the entity and path; `why()` shows the history. |
| `out-of-range` | A system wrote a number outside the `range` its descriptor declares for that field (`meta: { hp: { range: [0, 100] } }`), in a write, a resource, or a spawned or inserted component. One count per write; the message names the entity, field, value, range, system, and first frame. The range is advisory: the schema decides what is valid. |
| `population-growing` | A component's count rose through every quarter of a run of 60+ frames: its lowest count in each quarter was higher than in the quarter before. Bursts that are cleaned up do not trigger it; entities that are never despawned do. `run()` returns the counts in `growing`. |

The report also starts with the static lints from `describe()`.

## Lint from the command line

`ritmo-devtools lint <entry>` is the pass/fail check for a game's `check`
script. `<entry>` exports `lintTarget` (see the `Lint` module): it prints
every lint of the schedules with its fix and exits with 1 on a warning.

```sh
ritmo-devtools lint src/lint.ts
```

Keep the entry beside the simulation, not inside it, when `describe` needs
host schedules: it is the one module that imports both, so the simulation
never imports render or audio code. Load the host schedules inside
`lintTarget`:

```ts
// src/lint.ts
import { makeRuntime, setup, update } from "./simulation/index.ts"

export const lintTarget = async () => {
  const { render } = await import("./render/index.ts")
  return { runtime: makeRuntime({ debug: { hostClock: HostClock.test() } }), schedules: { setup, update }, describe: { render } }
}
```

A debug script that needs the same runtime and host schedules (a
`scripts/debug.ts` that builds a `Session`) imports `lintTarget` and calls
it, instead of repeating the wiring: `const { runtime, schedules } = await
lintTarget()`.

When nothing needs describing, the simulation's own entry module can export
`lintTarget` instead.

It also checks that the oxlint simulation rules from
`@typeonce/oxlint-plugin-ritmo` cover the simulation. Every module that
importing `<entry>` loads, inside the directory of the `.oxlintrc.json` in the
working directory and outside `node_modules`, must have
`ritmo/keep-simulation-headless` on there (overrides apply in order, the last
match wins; `ignorePatterns` matches are uncovered). The entry itself, and
modules imported inside `lintTarget` or later (render schedules passed to
`describe`), are host code and are not checked, nor are type-only imports. A missing config, one with
`extends`, or one that never turns the rule on prints why the check was
skipped and does not fail. The check needs Node 22.15 or later.

Last, it checks the install from the working directory: that every Ritmo
package is one version, and that the project links each skill
`@typeonce/ritmo` ships.

| Code | Meaning |
|---|---|
| `uncovered-simulation-module` | The simulation loads this file, but no simulation override in `.oxlintrc.json` covers it, so oxlint never checks it for platform, time, randomness, or math calls. Add it to the override's `files`, or stop importing values from it. Exits with 1. |
| `mismatched-versions` | The Ritmo packages installed for the game are not all one version. From the working directory, every `@typeonce` package it resolves and every copy those resolve in turn (an npm or yarn copy nested under another package, pnpm's store folders) is listed with its version: `@typeonce/ritmo-browser 0.22.0 is installed with @typeonce/ritmo 0.23.0 (and a second @typeonce/ritmo 0.22.0 under @typeonce/ritmo-browser)`. Each package depends on core at its own minor, so the older one gets its own hidden copy of core, and the game gets type errors between the two that name neither. Install the same version of every `@typeonce` package. Exits with 1. |
| `skill-not-linked` | For each skill `@typeonce/ritmo` ships (every folder in its installed `skills`: `ritmo`, `ritmo-prototype`, `ritmo-onboarding`, `ritmo-polish`, `ritmo-pixel-art`, `ritmo-fx`, `ritmo-sounds`, `ritmo-music`): neither `.agents/skills/<skill>` nor `.claude/skills/<skill>` links it from `node_modules/@typeonce/ritmo/skills/<skill>`, so the game's agent does not read it for this Ritmo version. Link it (`SETUP.md` step 2). A note: the exit code is unchanged. |
| `skill-copied` | The folder holds a copy of the skill (or links somewhere else), which goes stale on the next upgrade. Replace it with the link. A note: the exit code is unchanged. |

The trace shows what systems wrote, not what they read. When a system writes
a wrong value from correct inputs, the journal narrows the bug to that
system (it runs, in order, and writes this value) and the rest is its code.

## Determinism

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
or schedule marker found by a diagnostic rerun; inside an entity, it names
the entity (`entity`) and, given `labels` (the session's labels inspector),
its `label`. This checks the supplied inputs on the current JavaScript
engine; [Verify across engines](#verify-across-engines) plays a replay in
Node and real browsers.

## Desyncs

Peers of a networked game (`@typeonce/ritmo-netcode`) compare checksums of
confirmed ticks. When they differ, a session made with `keepSnapshots: true`
fails with `Desynced` carrying its save of that tick, and the other peer's
carries its own. `Desync.compare` lists what differs, entities by id and
values by path, in a stable order:

```ts
console.log(Desync.compare(mine.snapshot, theirs.snapshot, { labels: runtime.inspect(Labels) }))
// 2 differences (mine -> theirs):
//   player e12 Game/Position.x: 40 -> 41
//   resource Game/Rng: 1730 -> 2210
```

The first difference is where to look: rerun the match headless and ask a
`Session` `why` that value changed.

A `Netcode.syncTest` made with `keepSnapshots: true` fails with
`RewindDiffers` carrying the world before and after a rewind:
`Desync.compare(error.snapshots.expected, error.snapshots.actual)` names
what the rewind did not put back.

## Replays

A replay is the last seconds of a play session as a file: a debug artifact
to open headless, explain, and turn into a test, then delete.

```ts
// In the game's dev build: record the simulation schedule.
import { HostClock } from "@typeonce/ritmo"
import { Replay } from "@typeonce/ritmo-devtools"
import * as ReplayViteSink from "@typeonce/ritmo-devtools/ReplayViteSink"

const recorder = Replay.recorder(runtime, {
  schedule: simulate, name: "simulate",
  keep: 30, step: STEP,                      // seconds kept, the fixed step (Clock.hz)
  sink: ReplayViteSink.make({ fetch: (url, init) => fetch(url, init) }),
  hostClock: HostClock.standard,             // wall time, for savedAt and the file's name
  saveOn: { failure: true, invariants: [DeadAreGone] } // saves by itself
})
recorder.save("player stuck")              // on demand, e.g. from a dev-only key
```

```ts
// vite.config.ts: writes posted replays to .replays/<time>.json and logs them.
import * as ReplayVitePlugin from "@typeonce/ritmo-devtools/ReplayVitePlugin"
import { defineConfig } from "vite"

export default defineConfig({ plugins: [ReplayVitePlugin.plugin()] })
```

- The recorded schedule's services must be `snapshot()` sources of plain
  data (input) or plain data (rules); anything else is a compile error that
  names the service. Time and randomness live in the world, so the file holds
  everything the simulation read: periodic snapshots, each tick's source
  values (as changes), and every `runtime.send`. On a rollback peer a
  `runtime.rewind` undoes recorded ticks; the recorder forgets them, so the
  file holds each tick as it last ran and replays like the session played.
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
const replay = file.ok ? Replay.session(make, file.value) : file
replay.value.play()                       // run the ticks; compares checkpoints from tick 0 (below)
replay.value.session.why(12, Position)    // a normal Session over the replayed frames
Replay.session(make, file.value, { labels: Labels }) // names entities, as in Session.make
await Verify.acrossEngines(make, file.value) // replays twice here and against the recording
Replay.extract(make, file.value, { from: 1400, to: 1412 }) // a small replay for a test
```

`Replay.session(make, file, { invariants })` checks invariants after every
replayed tick, so `play()` stops where one breaks, as a `Session` run does.

A replay is for reproducing and inspecting a bug. Whether `play()` also
checks determinism depends on where the file starts (`play().data.checkpoints`):

- `{ _tag: "Compared", diverged }`: the file starts at tick 0, the world
  when the recorder started, so the replay starts where the recorded run
  did. Each checkpoint hash in `diverged` differs (`DIVERGED at tick 16`):
  the simulation is not deterministic, the code changed since recording, or
  the recorder started after a schedule left an event in flight. Empty
  prints `checkpoints match`.
- `{ _tag: "NotCompared", reason }`: the window rolled past tick 0 (a run
  longer than `keep`, or a `Replay.extract`), so it starts from a save. A
  save does not hold events in flight or what each `added()` / `changed()`
  reader had already seen, so an ordinary game replays to other checksums
  from it, and none are compared: `starts from a save at tick 14: checksums
  are not compared (...)`. The replay still plays; stepping, `why`, and
  invariants work as in any session.

Determinism is verified by `Determinism.check`, by `ritmo-devtools verify`
and `Verify.acrossEngines` (Node twice, and browser engines, compared run
against run), and by a replay recorded from tick 0.

`playback.source(descriptor)` takes any `snapshot()`-only source service:
`Schedule.Source<T>`, `Netcode.Source<T>`, or browser input declared as
`InputCapture.SourceOf<...>` (a device, a `Controls` merge, or a pool; see
[the browser README](https://github.com/typeonce-dev/ritmo/blob/main/packages/browser/README.md)).
A service declared as the whole device, with `rebind` and `dispose`, is a
compile error naming that fix: a replay can only stand in for its
`snapshot()`, so the page keeps the device to rebind it.

A replay recorded with another schema fails with "replay recorded with an
older schema".

## Verify across engines

`Verify.acrossEngines` is the one replay check. With no engines it plays
the replay twice in this process and against the recording, the check a
test runs; `ritmo-devtools verify` plays the same replay in Node and in real
browser engines and reports the first tick whose world differs, with every
value that differs there. Run it before
trusting a lockstep or rollback match across browsers, and in CI on a
committed replay of the game:

```sh
ritmo-devtools verify src/replay-target.ts replays/boss-fight.json --engines node,chromium,webkit,firefox
# NOT verified: 1800 ticks of simulate
# node: agrees with a second node run and the recording over 1800 ticks
# chromium: agrees with node over 1800 ticks
# tick 1412: webkit differs from node in e41 Game/Position.x (40.000000000000014 -> 40)
#   1 difference (node -> webkit):
#     e41 Game/Position.x: 40.000000000000014 -> 40
# firefox: not installed (the firefox browser is not downloaded): npx playwright install firefox
```

`<entry>` exports `replayTarget`, the `make(playback)` factory
`Replay.session` takes (above). It must load in a browser too: keep Node
built-ins out of it.

```ts
// src/replay-target.ts
export const replayTarget = (playback: Replay.Playback) => {
  const hostClock = HostClock.test()
  return { runtime: makeRuntime({ input: playback.source(Input), debug: { hostClock } }), schedules: { simulate }, hostClock }
}
```

- Node always runs, as the reference: twice (a difference is
  nondeterminism here) and against the recording's checkpoints when the
  replay starts at tick 0 (a difference is a code change since recording,
  or the recording engine). A replay from a later save says the recording
  was not compared, and why (`recording: "notCompared"` in the result).
  `--engines node`, the default, needs no other dependency.
- Browser engines run headless through Playwright, with the entry served by
  a bare Vite dev server (the game's `vite.config` is not read). Install
  them where the check runs: `npm install --save-dev playwright vite` and
  `npx playwright install chromium webkit firefox`. An engine that is not
  installed is printed with its install command and fails the check.
- Exit codes: 0 every engine agrees, 1 one differs or did not run, 2 usage
  error (arguments, a file that is not a replay, an entry without
  `replayTarget`). `--json` prints the result as JSON.

The same check from code, for a game's own test (leave out `engines` to
check this process alone):

```ts
import { Verify } from "@typeonce/ritmo-devtools"
import * as PlaywrightEngine from "@typeonce/ritmo-devtools/PlaywrightEngine"

const browsers = PlaywrightEngine.make({ entry: "src/replay-target.ts", browsers: ["chromium", "webkit", "firefox"] })
const verified = await Verify.acrossEngines(replayTarget, file, { engines: browsers.engines })
await browsers.close()
if (!verified.ok && verified.error._tag === "NotVerified") {
  for (const outcome of verified.error.outcomes) if (outcome._tag === "Diverged") console.log(outcome.tick, outcome.differences)
}
```

The error side is `ReplayInvalid` (the replay does not open here) or
`NotVerified`, one outcome per engine: `Agreed`, `Diverged` (`tick`,
`against`, `differences`), `EngineMissing` (`install`), or `EngineFailed`.
For another host (a webview, a console), run `Verify.trace` and
`Verify.snapshotAt` there and wrap them as a `Verify.Engine`.

## Scan dependencies

oxlint skips `node_modules`, so a dependency the simulation calls can still
use `Math.sin`, `Date.now`, or `Math.random`. `ritmo-devtools scan <entry>`
resolves every file the simulation entry imports, `node_modules` included,
and runs `ritmo/use-ops-for-math`, `ritmo/use-clock-for-time`, and
`ritmo/use-random-for-randomness` over them, grouped by package:

```sh
ritmo-devtools scan src/simulation/index.ts
# fake-physics (2 findings)
#   node_modules/fake-physics/index.js:4:17  ritmo/use-ops-for-math  Math.sin
#   node_modules/fake-physics/index.js:6:32  ritmo/use-random-for-randomness  Math.random
#
# scanned 4 files in 2 packages imported by src/simulation/index.ts: 2 findings in 1 package
```

- A finding is a hint, not a verdict: code the simulation never calls is
  fine. For a dependency it calls, vendor it into the game's source and run
  `oxlint --fix`, or replace it. A clean scan does not prove the run is
  deterministic: confirm with `ritmo-devtools verify` or `Netcode.syncTest`.
- It uses the game's `oxlint` and `@typeonce/oxlint-plugin-ritmo`, and
  `rolldown` to resolve imports the way a build does (Vite 8 includes it;
  otherwise `npm install --save-dev rolldown`). A missing tool is printed
  with its install command.
- Exit codes: 0 whenever the scan ran, with or without findings, 2 usage
  error (arguments, an unreadable entry, an import that does not resolve, a
  missing tool). `--json` prints
  `{ entry, files, packages: [{ name, files, findings: [{ file, line, column, rule, snippet }] }] }`.

## Fuzzing

`Fuzz.run` finds a bug before anyone plays into it: seeded random input,
run headless against the game's invariants, until an invariant breaks, a
system fails, or something throws. It then shrinks the failing input to the
few frames that still fail the same way, and returns them as a replay file.

```ts
import { Fuzz, Replay } from "@typeonce/ritmo-devtools"
import * as ReplayNodeSink from "@typeonce/ritmo-devtools/ReplayNodeSink"

// One fuzzed snapshot() source: a value of its type for each frame, and the idle value.
const Pads = Fuzz.input(PadInput, {
  generate: (random, frame) => ({ key: random.integer(0, 5), aim: random.range(-1, 1) }),
  neutral: { key: 0, aim: 0 }
})
// `make` is the replay factory (above): it builds the game on playback.source(PadInput).
const found = Fuzz.run(make, {
  schedule: "update", setup: "setup",       // setup is ticked once first, every input neutral
  inputs: [Pads], invariants: [HealthNeverNegative],
  frames: 3000, runs: 10, seed: 7           // run i draws from seed 7 + i
})
if (!found.ok && found.error._tag === "Found") {
  ReplayNodeSink.make({ directory: ".replays" }).save(found.error.replay)
  console.log(found.error.violation)       // InvariantViolated | SystemFailed | Defect
  console.log(found.error.shrink)          // { attempts, steps, fromFrames: 1412, toFrames: 4 }
}
```

- A browser game fuzzes through the same descriptor its page and replays
  read: `Fuzz.input(ControlsInput, { generate: (random) =>
  Actions.random(random, devices), neutral: Actions.idle(devices) })` draws
  merged input a real merge could report (button states, vectors of length
  at most 1); `Players.random(random, frame, { devices, seats })` does it
  for a local multiplayer pool.
- `random` is a seeded `Random` from `@typeonce/ritmo`; the same seed
  draws the same input, so a found bug's `seed` with `runs: 1` finds it
  again. Every source `make` asks `playback.source` for must be a fuzzed
  input; give plain-data services (rules, config) directly.
- Shrinking drops ranges of frames, then moves each remaining value to
  `neutral` (whole, then one field at a time), re-running the simulation for
  every candidate. `shrinkAttempts` (500) bounds it.
- After `setup`, each run loads its own save of the world before the first
  fuzzed frame, because that save is where its replay starts: what setup
  left in flight (an event no system has read yet) is in neither, and
  transient components setup added are gone from both.
- The error side is `Found` (with the shrunk `replay`, `seed`, `frame`, and
  `reproduces`: whether `Replay.session` replays it to the same violation),
  `Flaky` (the same input did not fail again: run `Determinism.check`),
  `InvalidOptions`, or `Unreplayable` (the world after setup cannot be saved).

The shrunk replay is the regression test:

```ts
const file = Replay.parse(JSON.parse(readFileSync(".replays/....json", "utf8")))
const opened = file.ok ? Replay.session(make, file.value, { invariants: [HealthNeverNegative] }) : file
expect(opened.ok && opened.value.play().data.run.stop.reason).toBe("completed") // fails until the fix
```

### Over a network

The same `Fuzz.run` fuzzes a rollback game over a faulty network. Give it one
`Fuzz.seats` input (every seat's input per frame) and `network`: each seat
plays on its own peer, a fresh `make(playback)`, joined by a seeded
`MemoryNetworkLink` and driven by a `Netcode.rollback` session from
[`@typeonce/ritmo-netcode`](https://github.com/typeonce-dev/ritmo/blob/main/packages/netcode/README.md).

```ts
// The seats service the simulation captures; make provides it with playback.source(Seats).
const Players = Fuzz.seats(Seats, {
  codec: PlayerInput, count: 2, idle: { dx: 0, fire: false },   // as given to Netcode.seats
  generate: (random, frame, seat) => ({ dx: random.integer(-1, 2), fire: random.next() < 0.2 })
})
const found = Fuzz.run(make, {
  schedule: "simulate", setup: "setup", inputs: [Players], invariants: [HealthNeverNegative],
  frames: 600, seed: 7,
  network: { seed: 3, latencyMS: 60, jitterMS: 40, loss: 0.1, step }   // faults repeat for the same seed
})
if (!found.ok && found.error._tag === "Found" && found.error.violation._tag === "SessionFailed") {
  console.log(found.error.violation.seat, found.error.violation.error) // Desynced, with this peer's save of the tick
}
```

- A session failure (`Desynced`, `TickFailed`, `CheckpointLost`, or the
  session ending) is a `SessionFailed` violation; invariants are checked on
  every peer after each frame. `settle` idle frames (120) follow the fuzzed
  ones so late input and checksums arrive; checksums are compared every 10
  ticks unless `checksumEvery` says otherwise.
- Shrinking keeps the network seed and shrinks the input timeline, one seat
  at a time. The `replay` plays the shrunk timeline on one runtime (step it
  to see each tick); `reproduces` is `false` for a desync, which needs two
  peers: find it again with the same `seed`, `runs: 1`, and `network`.
- A `simulate` that cannot be rewound, or a runtime that cannot save, does
  not compile, as for `Netcode.rollback`. Run `Netcode.syncTest` first: it
  finds state a rewind cannot put back on one peer, faster.

## Recording a browser session

```ts
const recorder = Keyboard.recording(Keyboard.actions(window, bindings))
// ...provide `recorder` as the keyboard service, play, reproduce the bug...
copy(JSON.stringify(recorder.timeline()))

// In Node:
const timeline = Keyboard.parseTimeline(bindings, JSON.parse(saved))
if (timeline.ok) {
  const keyboard = Keyboard.scripted(bindings, timeline.value)
}
```

A recorded timeline replays to the same input snapshots. A browser session
reproduces headless when everything else nondeterministic, such as time
steps, random numbers, and viewport size, also comes in through services
or resources that the simulation sets to the same values.
