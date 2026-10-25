# `@typeonce/oxlint-plugin-ritmo`

[Oxlint](https://oxc.rs/docs/guide/usage/linter) rules for Ritmo games.

Ritmo's types reject wrong calls, and its devtools lints reject wrong runs. These rules catch the source patterns neither can see:

- simulation code that reads the wall clock, `Math.random`, engine-dependent math, or the page;
- timers counted in floats;
- data that cannot be saved;
- state values that keep a previous state's fields;
- runtime results that are dropped.

Every report says what goes wrong and which Ritmo API to use instead.

```sh
pnpm add -D @typeonce/oxlint-plugin-ritmo oxlint
```

Released together with [`@typeonce/ritmo`](https://github.com/typeonce-dev/ritmo/blob/main/packages/core/README.md), always with the same version. Requires oxlint 1.86 or newer.

## Setup

Register the plugin and turn the rules on in `.oxlintrc.json`. The simulation rules go in an `overrides` entry that lists the game's simulation files: the code its fixed-step schedules run, which must replay exactly and run headless. Host, render, UI, tool, and unrelated files are not listed, so they keep using the platform freely. A file the override does not list gets no simulation checks, so list folders rather than single files, and run `ritmo-devtools lint` from `@typeonce/ritmo-devtools`: it reports every module the simulation loads that the override misses.

```jsonc
{
  "jsPlugins": ["@typeonce/oxlint-plugin-ritmo"],
  "rules": {
    "ritmo/handle-tick-result": "error",
    "ritmo/prefix-descriptor-and-system-names": "error",
    "ritmo/use-cell-value": "error",
    "ritmo/no-state-spread": "error"
  },
  "overrides": [
    {
      // The game's simulation: systems, schema, and the pure rules they call.
      "files": ["src/sim/**", "src/rules/**", "src/schema.ts"],
      "rules": {
        "ritmo/use-clock-for-time": "error",
        "ritmo/use-random-for-randomness": "error",
        "ritmo/use-ops-for-math": "error",
        "ritmo/keep-simulation-headless": "error",
        "ritmo/no-infinity-in-simulation-data": "error",
        "ritmo/no-float-timers": "error"
      }
    }
  ]
}
```

Rules are named `ritmo/<rule>`. `ritmo/use-ops-for-math` and `ritmo/use-cell-value` fix themselves with `oxlint --fix` (`use-ops-for-math` once `Ops` is imported in the file).

A deliberate exception, such as a host-time module inside a simulation folder, takes a disable comment with the reason:

```ts
// oxlint-disable-next-line ritmo/use-clock-for-time -- host time for the frame budget, never read by systems
const started = performance.now()
```

| Rule | Where | Catches | Use instead |
|---|---|---|---|
| [`use-clock-for-time`](#ritmouse-clock-for-time) | simulation | `Date.now()`, `performance.now()`, `new Date()`, timers | `Clock` |
| [`use-random-for-randomness`](#ritmouse-random-for-randomness) | simulation | `Math.random()`, `crypto` randomness | `Random.draw(resources.rng)` |
| [`use-ops-for-math`](#ritmouse-ops-for-math) | simulation | `Math.sin`, `Math.hypot`, `a ** b`, ... | `Ops` |
| [`keep-simulation-headless`](#ritmokeep-simulation-headless) | simulation | page globals, host I/O, renderer imports | input and data from the host, drawing in a render schedule |
| [`no-infinity-in-simulation-data`](#ritmono-infinity-in-simulation-data) | simulation | `Infinity` / `NaN` in object literals | `null` |
| [`no-float-timers`](#ritmono-float-timers) | simulation | `timer -= dt`, `cooldown - time.dt` | `Clock.deadline` / `Clock.reached` |
| [`handle-tick-result`](#ritmohandle-tick-result) | everywhere | a dropped `runtime.tick(...)` / `restore(...)` / `rewind(...)` result | check `.ok` |
| [`prefix-descriptor-and-system-names`](#ritmoprefix-descriptor-and-system-names) | everywhere | `"Position"`, `Game.System("Move", ...)` | `"Game/Position"` |
| [`use-cell-value`](#ritmouse-cell-value) | everywhere | `cell.present ? cell.get() : undefined` | `cell.value()` |
| [`no-state-spread`](#ritmono-state-spread) | everywhere | `{ ...ground, _tag: "air", vy }` | `cell.transition({ from, to, data })`, `nextMachines.x.set({ _tag, ...fields })`, or the new state's fields written out |

## Simulation rules

### `ritmo/use-clock-for-time`

The wall clock differs on every run, so a simulation that reads it cannot replay, and a timer fires between ticks at a moment no replay can reproduce.

```ts
if (Date.now() - started > 3000) open()        // reported
setTimeout(() => spawnWave(), 500)              // reported

// instead
const time = resources.time.get()
if (Clock.elapsed(time) > 3) open()                                     // seconds since the start
const due = Clock.deadline(time, Clock.duration(step, 0.5))             // store it, Clock.reached(time, due) each tick
if (Clock.every(time, waveEvery)) spawnWave()                           // repeats
```

Catches `Date.now()`, `performance.now()`, `new Date()` with no arguments (`new Date(timestamp)` only formats a value it was given), and `setTimeout`, `setInterval`, `requestAnimationFrame`, `requestIdleCallback`, and `queueMicrotask`. When a rule needs today's date (a daily reward), read it in host code and pass it in with `runtime.send(...)` or a resource, so the replay records it.

### `ritmo/use-random-for-randomness`

`Math.random()` and `crypto` cannot be seeded or saved, so the run cannot replay. The world's `Random` resource is seeded, saved with the world, and rolled back with a failed system.

```ts
const crit = Math.random() < 0.1                                       // reported

// instead: declare rng: Game.System.writeResource(Rng) in the system
const random = Random.draw(resources.rng)
const crit = random.next() < 0.1
const kind = random.pick(kinds)
```

Catches `Math.random()`, `crypto.getRandomValues()`, and `crypto.randomUUID()`. For an id, the world already has one: use the entity's id (`match.entity`, kept as `Game.Entity.handle(...)`) or a counter in a resource. An id that must be unique across devices or runs (an account item, a save slot) is made in host code, where `crypto.randomUUID()` is fine, and passed in with `runtime.send(...)`.

### `ritmo/use-ops-for-math`

The spec lets engines approximate `Math.sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `exp`, `expm1`, `log`, `log2`, `log10`, `log1p`, `cbrt`, `pow`, `hypot`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, and `a ** b`, and they do: Chrome, Safari, macOS, and Linux disagree in the last bit, and a simulation grows that bit into a different run. [`Ops`](https://github.com/typeonce-dev/ritmo/blob/main/packages/math/README.md#determinism-across-devices) from `@typeonce/ritmo-math` has each of them as a port that returns the same bits everywhere.

```ts
const turn = Math.atan2(Math.sin(b - a), Math.cos(b - a))     // reported
const beauty = base * repeat ** n                              // reported

// instead
import { Ops } from "@typeonce/ritmo-math"
const turn = Ops.atan2(Ops.sin(b - a), Ops.cos(b - a))
const beauty = base * Ops.pow(repeat, n)
```

`Math.sqrt`, `abs`, `min`, `max`, `floor`, `ceil`, `round`, `trunc`, `sign`, `+ - * /`, and `x ** 2` are exact everywhere and are not reported. With `Ops` imported in the file, `oxlint --fix` rewrites the calls.

### `ritmo/keep-simulation-headless`

The simulation runs in tests, bots, replays, and on servers, where there is no page and no renderer. The host gives it what it needs and draws what it holds.

| Reported | Setup instead |
|---|---|
| Page globals: `window`, `document`, `navigator`, `matchMedia`, ... | Capture input in the host with `Keyboard`, `Gamepad`, `Pointer`, or `Touch` (merged with `Controls`) from `@typeonce/ritmo-browser` and `InputCapture` into a resource that systems read. Pass page state (size, settings) in with `runtime.send(...)` or a resource. |
| Host I/O: `localStorage`, `fetch`, `location`, ... | Do the I/O in host code and pass the result in with `runtime.send(...)` or a resource. Save and load the world in the host with `runtime.snapshot()` and `runtime.restore(...)`. |
| Connections to other peers: `WebSocket`, `RTCPeerConnection`, `RTCDataChannel` | For online play, run the simulation under a [`@typeonce/ritmo-netcode`](https://github.com/typeonce-dev/ritmo/blob/main/packages/netcode/README.md) session: host code opens the connection and wraps it in a link, and remote input reaches the simulation through `Netcode.seats`, never `runtime.send(...)`. |
| Renderer and UI imports, types included: `pixi.js`, `three`, `@typeonce/ritmo-render`, `react`, `preact`, ... | Draw from a render schedule in render code: mirror entities into nodes with `RenderSync` and a `NodeRegistry` from `@typeonce/ritmo-render`, and declare renderer services (a node registry) and their types there; renderer nodes stay in the registry, never in components. The schema and simulation systems name no renderer type, so another renderer can replace this one. |

Locals and fields with these names (`term.window`, a `location` parameter) are not globals and are not reported.

Options: `{ "packages": ["@my-game/canvas"] }` adds the game's own renderer or UI packages (a name, or a prefix ending in `/`).

### `ritmo/no-infinity-in-simulation-data`

`JSON.stringify` turns `Infinity` and `NaN` into `null`, and a number schema rejects `null`, so a world holding them saves but no longer loads (devtools also warns `non-finite-value`).

```ts
dash: { remaining: 0, since: Infinity }                          // reported
{ remaining: Infinity, duration: Infinity, permanent: true }     // reported

// instead
dash: { remaining: 0, since: null }                              // since: number | null, with a nullable number schema
{ timer: null }                                                  // timer: { remaining: number; duration: number } | null
```

Catches `Infinity`, `-Infinity`, `NaN`, and `Number.POSITIVE_INFINITY` / `NEGATIVE_INFINITY` / `NaN` as a property value in any object literal in simulation files, including values built in helpers before they are spawned. Search seeds in locals (`let best = Infinity`) are not reported.

### `ritmo/no-float-timers`

A timer counted down by `dt` adds a rounded float every tick, so it ends a step early or late, and the float it saves means nothing once the fixed step changes. A deadline is the step the timer ends on: written once, exact, and valid after a restore or a rollback, since the clock it is measured against is saved and rewound with it.

```ts
cooldown.remaining -= dt                                               // reported
data.buff.set({ ...buff, left: buff.left - time.dt })                  // reported

// instead: ready: Clock.Deadline<60> | null, its schema narrowing with Clock.isDeadline(step)
const cooldown = Clock.duration(step, 0.5)
const time = resources.time.get()
const { ready } = data.weapon.get()
if (ready === null || Clock.reached(time, ready)) {
  fire()
  data.weapon.set({ ready: Clock.deadline(time, cooldown) })
}
const bar = ready === null ? 0 : Clock.remaining(time, ready) / Clock.steps(cooldown)   // a readout
```

Catches a stored value (a local or a field) plus or minus a tick's seconds on their own: `dt`, `deltaTime`, or `deltaSeconds`, as a local, a field (`time.dt`), or a resource read (`resources.deltaTime.get()`), in `x -= dt`, `x += dt`, and `x - dt` / `x + dt` anywhere (`Math.max(0, x - dt)`, an object literal). A rate scaled by `dt` (`position.x += velocity.x * dt`) is integration and is not reported, nor is a count of whole steps (`cooldown - 1`), nor a `delta` that is not time (a pointer's).

## Rules for every file

### `ritmo/handle-tick-result`

`runtime.tick(...)` returns a `Result`: a system that fails stops the tick, and the failure comes back here. `runtime.restore(...)` returns one too: an invalid save leaves the previous world in place. So does `runtime.rewind(...)`: a checkpoint the runtime let go of changes nothing, and the ticks meant to run again run on top of the present. Dropping any of them hides the failure.

```ts
runtime.tick(update)                                             // reported
runtime.restore(save)                                            // reported
runtime.rewind(checkpoint)                                       // reported

// instead
const ran = runtime.tick(update)
if (!ran.ok) console.error(ran.error)                            // names the system and why
const restored = runtime.restore(save)
if (!restored.ok) showLoadError(restored.error)
const rewound = runtime.rewind(checkpoint)
if (!rewound.ok) resync(rewound.error)                           // Released or OtherRuntime
void runtime.tick(render)                                        // ignored on purpose
```

Catches `tick(...)`, `tryTick(...)`, `restore(...)`, and `rewind(...)` used as a statement on a receiver named like a runtime (`runtime`, `game.runtime`, `worldRuntime`). Game wrappers with other names (`town.restore(...)`) are not reported. Option: `{ "runtimePattern": "^(runtime|world)$" }` (a case-insensitive regular expression for the receiver's name; default `runtime$`).

### `ritmo/prefix-descriptor-and-system-names`

Ritmo registers names given to descriptors, systems, state machines, scopes, and plugin systems, and they must be unique across everything bound with `Schema.bind`; a clash throws there. A `Game/` prefix keeps a game's names apart from its packages' and fragments'.

```ts
const Position = Descriptor.Component<Vec2>()("Position")       // reported
const Move = Game.System("Move", ...)                             // reported

// instead
const Position = Descriptor.Component<Vec2>()("Town/Position")
const Move = Game.System("Town/Move", ...)
```

Checks the names given to `Descriptor.*`, `*.System`, `*.StateMachine`, `*.EntityScope`, `Clock.resource`, and the `name` of `Clock.system`, `InputCapture.system`, and `RenderSync.system` / `interpolate`.

### `ritmo/use-cell-value`

An optional query cell has one way to read its value or `undefined`: `cell.value()`.

```ts
const dash = target.data.dash.present ? target.data.dash.get() : undefined   // reported, fixed to:
const dash = target.data.dash.value()
```

Check `cell.present` alone to branch without reading.

### `ritmo/no-state-spread`

A tagged value, such as the value of a `Descriptor.EntityState` component or of a `Game.StateMachine`, changes state with the new state's own fields. Setting `_tag` over a spread of the previous state keeps every field of that state at runtime, while the new state's type hides them: they come back when the value is saved, compared, or spread again.

```ts
const popped = { ...ground, _tag: "air", vy: 2 }   // reported: `platform` survives in the air

// instead
data.contact.transition({ from: "ground", to: "air", data: { vy: 2, coyote: 0 } })
nextMachines.mode.set({ _tag: "Exploring" })       // a machine's move, not { ...talking, _tag: "Exploring" }
const popped = { _tag: "air", vy: 2, coyote: 0 }   // in a pure function
```

Spreading the previous value to change fields of the same state (`{ ...air, vy: air.vy - 1 }`) is not reported, nor is a `_tag` written before the spread (`{ _tag: to, ...data }`).

Source: https://github.com/typeonce-dev/ritmo
