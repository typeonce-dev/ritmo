# `@typeonce/oxlint-plugin-ritmo`

[Oxlint](https://oxc.rs/docs/guide/usage/linter) rules for Ritmo games.

Ritmo's types reject wrong calls, and its devtools lints reject wrong runs. These rules catch the source patterns neither can see:

- simulation code that reads the wall clock, `Math.random`, engine-dependent math, or the page;
- timers counted in floats;
- data that cannot be saved;
- casts that claim a brand's check without running it;
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
    "ritmo/handle-runtime-result": "error",
    "ritmo/prefix-descriptor-and-system-names": "error",
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
        "ritmo/no-float-timers": "error",
        "ritmo/no-brand-cast": "error"
      }
    }
  ]
}
```

Rules are named `ritmo/<rule>`. `ritmo/use-ops-for-math` fixes itself with `oxlint --fix`.

A deliberate exception, such as a host-time module inside a simulation folder, takes a disable comment with the reason:

```ts
// oxlint-disable-next-line ritmo/use-clock-for-time -- host time for the frame budget, never read by systems
const started = performance.now()
```

| Rule | Where | Catches | Use instead |
|---|---|---|---|
| [`use-clock-for-time`](#ritmouse-clock-for-time) | simulation | `Date.now()`, `performance.now()`, `new Date()`, timers | `Clock` |
| [`use-random-for-randomness`](#ritmouse-random-for-randomness) | simulation | `Math.random()`, `crypto` randomness | `Random.draw(resources.rng)` |
| [`use-ops-for-math`](#ritmouse-ops-for-math) | simulation | `Math.sin`, `Math.hypot`, `a ** b`, `const { sin } = Math`, ... | `Ops` |
| [`keep-simulation-headless`](#ritmokeep-simulation-headless) | simulation | page globals, host I/O, renderer imports | input and data from the host, drawing in a render schedule |
| [`no-infinity-in-simulation-data`](#ritmono-infinity-in-simulation-data) | simulation | `Infinity` / `NaN` in object literals | `null` |
| [`no-float-timers`](#ritmono-float-timers) | simulation | `timer -= dt`, `cooldown - time.dt` | `Clock.deadline` / `Clock.reached` |
| [`no-brand-cast`](#ritmono-brand-cast) | simulation | `raw as UserId`, `1 as Random.State` | the schema or constructor that brands it |
| [`handle-runtime-result`](#ritmohandle-runtime-result) | everywhere | a dropped or unchecked `runtime.tick(...)` / `restore(...)` / `rewind(...)` / `snapshot()` / `checksum()` result | check `.ok` |
| [`prefix-descriptor-and-system-names`](#ritmoprefix-descriptor-and-system-names) | everywhere | `"Position"`, `Game.System("Move", ...)` | `"Game/Position"` |
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

The spec lets engines approximate `Math.sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `exp`, `expm1`, `log`, `log2`, `log10`, `log1p`, `cbrt`, `pow`, `hypot`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, and `a ** b`, and they do: Chrome, Safari, macOS, and Linux disagree in the last bit, and a simulation grows that bit into a different run. [`Ops`](https://github.com/typeonce-dev/ritmo/blob/main/packages/core/README.md) from `@typeonce/ritmo` has each of them as a port that returns the same bits everywhere.

```ts
const turn = Math.atan2(Math.sin(b - a), Math.cos(b - a))     // reported
const beauty = base * repeat ** n                              // reported

// instead
import { Ops } from "@typeonce/ritmo"
import { Angle } from "@typeonce/ritmo-math"
const turn = Angle.wrap(b - a)       // the signed turn from a to b, exact
const beauty = base * Ops.pow(repeat, n)
```

Before porting a formula to `Ops`, look for the helper that names it: `Angle.wrap` and `Angle.turnToward` in [`@typeonce/ritmo-math`](https://github.com/typeonce-dev/ritmo/blob/main/packages/math/README.md) need no transcendental call at all.

`Math.sqrt`, `abs`, `min`, `max`, `floor`, `ceil`, `round`, `trunc`, `sign`, `+ - * /`, and `x ** 2` are exact everywhere and are not reported (`Math.PI`, `Math["floor"]`, and `const { abs, PI } = Math` neither).

`oxlint --fix` does the whole change in one run: it rewrites `Math.sin(x)` to `Ops.sin(x)`, `a ** b` to `Ops.pow(a, b)`, and `x **= y` to `x = Ops.pow(x, y)`, and adds `import { Ops } from "@typeonce/ritmo"` once, after the last import (`const { Ops } = require("@typeonce/ritmo")` in a CommonJS file). It uses `Ops` where the file already imports it, under any name (`import { Ops as M }`, `import * as Ops from "@typeonce/ritmo/Ops"`). It leaves the report unfixed where a rewrite could change the code: `body.speed **= y` (the rewrite would evaluate `body` twice), and a file or function where the name `Ops` already means something else (a type-only import included).

The global Math handed on as a value hides the calls made through it from the rule, so it is reported too (without a fix): an alias (`const M = Math`), a destructured function or rest element (`const { sin } = Math`), an argument (`apply(Math, "sin", x)`), a computed key (`Math[name]`), and `globalThis.Math` used the same ways. Call `Ops.sin` directly, and read exact members by name. A local named `Math` is not the global and is not reported.

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

A timer that must stop while the world clock keeps running (gameplay frozen in hit-stop, a menu over the level) is measured against a second clock that holds, instead of against the world clock:

```ts
const GameplayTime = Clock.resource("Game/GameplayTime", step)
const gameplayClock = Clock.system(Game, { name: "Game/GameplayClock", resource: GameplayTime, hold: [inHitStop] })

// A deadline on GameplayTime waits while inHitStop passes, and saves and rolls back like any deadline
data.enemy.set({ attackAt: Clock.deadline(gameplay, windup) })
```

Time scaled by a fraction (a 0.3x slow motion) has no whole step to end on, so a float is right there: keep it and disable the line with the reason (`// oxlint-disable-next-line ritmo/no-float-timers -- scaled by slow motion`). A value counted up by `dt` is reported too, since it drifts the same way: `Clock.elapsed(time)` is the exact seconds of a clock.

Catches a stored value (a local or a field) plus or minus a tick's seconds on their own: `dt`, `deltaTime`, or `deltaSeconds`, as a local, a field (`time.dt`), or a resource read (`resources.deltaTime.get()`), in `x -= dt`, `x += dt`, and `x - dt` / `x + dt` anywhere (`Math.max(0, x - dt)`, an object literal). A rate scaled by `dt` (`position.x += velocity.x * dt`) is integration and is not reported, nor is a count of whole steps (`cooldown - 1`), nor a `delta` that is not time (a pointer's).

### `ritmo/no-brand-cast`

A branded type (`UserId`, `Random.State`, `Clock.Deadline<60>`) stands for a check the value passed. A cast claims the brand without running the check, so an invalid value travels as a valid one: a save holding it fails to load, or the simulation computes with it.

```ts
const UserId = z.string().uuid().brand("UserId")
type UserId = z.infer<typeof UserId>
const id = raw as UserId                                       // reported
const rng = Random.resource("Game/Rng", 1 as Random.State)     // reported

// instead
const id = UserId.parse(raw)                                   // Effect: Schema.decodeUnknownSync(UserId)(raw)
const rng = Random.resource("Game/Rng", Random.seed(1))
```

Oxlint has no type information, so the rule reads the brand from the code: a cast (`x as T` or `<T>x`) to
- a brand helper: `Brand.Branded<...>`, Effect's `Brand.Brand<...>`, Zod's `z.BRAND<...>` / `z.$brand<...>`, or a `Brand<...>` / `Branded<...>` of any library;
- an object type with a brand key: `T & { readonly __brand: "UserId" }` (also `_brand`, `__type`), or a key declared as `declare const brand: unique symbol`;
- a type alias or interface in the same file that is one of these, or the type of a schema in the same file built with `.brand(...)` / `Schema.brand(...)` (`z.infer<typeof UserId>`, `typeof Gold.Type`, `Schema.Schema.Type<typeof Gold>`);
- a branded Ritmo export imported from `@typeonce/ritmo` (or a subpath such as `@typeonce/ritmo/Clock`): `Clock.Deadline`, `Clock.Step`, `Clock.Duration`, `Clock.ClockResource`, `Entity.Handle`, `Entity.EntityId`, `Random.State`, `Checkpoint.Checkpoint`, `Checkpoint.Rewindable`.

Make the value through its check: decode at the boundary with the game's schema, or with Ritmo's constructor or guard (`Random.seed` / `Random.result`, `Clock.deadline` / `Clock.isDeadline`, `Game.Entity.handle` / `Entity.isHandle`). `as const`, `satisfies`, and casts to types without a brand are not reported, nor are brands imported from another file of the game (the rule cannot see them).

## Rules for every file

### `ritmo/handle-runtime-result`

`runtime.tick(...)` returns a `Result`: a system that fails stops the tick, and the failure comes back here. `runtime.restore(...)` returns one too: an invalid save leaves the previous world in place. So does `runtime.rewind(...)`: a checkpoint the runtime let go of changes nothing, and the ticks meant to run again run on top of the present. `runtime.snapshot()` and `runtime.checksum()` return one because a schema's `encode` may reject a value. Dropping any of them hides the failure, and so does passing one on where any value is accepted: a save function that takes `unknown` stores the `{ ok, value }` wrapper, not the world.

```ts
runtime.tick(update)                                             // reported
runtime.restore(save)                                            // reported
runtime.rewind(checkpoint)                                       // reported
persist(runtime.snapshot())                                      // reported
log(`hash ${runtime.checksum()}`)                                // reported

// instead
const ran = runtime.tick(update)
if (!ran.ok) console.error(ran.error)                            // names the system and why
const restored = runtime.restore(save)
if (!restored.ok) showLoadError(restored.error)
const rewound = runtime.rewind(checkpoint)
if (!rewound.ok) resync(rewound.error)                           // Released or OtherRuntime
const saved = runtime.snapshot()
if (saved.ok) persist(saved.value)
void runtime.tick(render)                                        // ignored on purpose
```

Catches these calls on a receiver named like a runtime (`runtime`, `game.runtime`, `worldRuntime`) used as a statement, or passed on unchecked: as a call argument, inside a template string, an object or array literal, a spread, or an operand, also through `??`, `? :`, and `as`. A variable, a field, a `return`, `.ok`, and `void` keep the `Result` for the code to check. A `tick`, `tryTick`, `restore`, or `rewind` result passed to a function is left to that function (a test's `expectOk(runtime.tick(update))`), unless it only prints or encodes (`JSON.stringify`, `String`, `console.*`). A `snapshot()` or `checksum()` result is data on its way somewhere, so passing it to any function unchecked is reported; a helper that takes that `Result` itself gets it once it is named: `const checksum = runtime.checksum(); helper(checksum)`. Game wrappers with other names (`town.restore(...)`) are not reported. Option: `{ "runtimePattern": "^(runtime|world)$" }` (a case-insensitive regular expression for the receiver's name; default `runtime$`).

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

## Built-in rules that pair well

Some of oxlint's own rules catch Ritmo mistakes too. They are optional; turn on the ones the game wants.

| Rule | Catches in a Ritmo game |
|---|---|
| `typescript/no-unnecessary-condition` | a `Result` checked as a boolean instead of with `.ok` (`if (!runtime.restore(save))` never fires), an object compared to `undefined` |
| `typescript/switch-exhaustiveness-check` | a switch over a closed set (a role, a kind, a state's `_tag`) that misses a member added later |
| `typescript/no-floating-promises`, `typescript/no-misused-promises` | host code that never awaits an asset load or a replay upload, or passes an async callback where a plain one is called |
| `typescript/restrict-template-expressions`, `typescript/no-base-to-string` | `[object Object]` in HUD or log text |
| the default `correctness` category (with `no-unused-vars`) | dead code and likely bugs; oxlint runs it unless the config turns it off |

The `typescript/*` rules above read types: install `oxlint-tsgolint` and turn them on with `"options": { "typeAware": true }` in `.oxlintrc.json` (or `oxlint --type-aware`).

```jsonc
{
  "options": { "typeAware": true },
  "rules": {
    "typescript/no-unnecessary-condition": "error",
    "typescript/switch-exhaustiveness-check": "error",
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/restrict-template-expressions": "error",
    "typescript/no-base-to-string": "error"
  }
}
```

Source: https://github.com/typeonce-dev/ritmo
