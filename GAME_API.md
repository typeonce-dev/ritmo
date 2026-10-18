# Building a game with `ritmo`

The library now has a small, renderer-independent gameplay core. A game is a
closed schema, systems with declared capabilities, explicit schedules, and one
runtime. Browser timing and rendering stay outside the ECS.

## 1. Define the world

```ts
import { Descriptor, Result, Schema } from "@typeonce/ritmo"

const Position = Descriptor.Component<{ x: number; y: number }>()("Game/Position")
const Velocity = Descriptor.Component<{ x: number; y: number }>()("Game/Velocity")
const Health = Descriptor.Component<number>()("Game/Health")
const DeltaTime = Descriptor.Resource<number>()("Game/DeltaTime")
const Damage = Descriptor.Event<{ target: number; amount: number }>()("Game/Damage")

const Game = Schema.bind(Schema.fragment({
  components: { Position, Velocity, Health },
  resources: { DeltaTime },
  events: { Damage }
}))
```

The bound `Game` value is the authoring boundary. Queries, systems, schedules,
entity scopes, inspectors, and runtimes made from a different root do not fit.

### Components that always come together

When one component only makes sense with others, say so in the schema instead
of keeping a list of "parts" next to each draft:

```ts
const Player = Descriptor.Tag("Game/Player")
const EnemyKind = Descriptor.Component<"grunt" | "boss">()("Game/EnemyKind", { immutable: true })

const Game = Schema.bind(Schema.fragment({
  components: { Position, Velocity, Health, Player, EnemyKind },
  requires: [
    Schema.requires(Player, Position, Velocity, Health),
    Schema.requires(EnemyKind, Position, Health)
  ]
}))

const SpawnPlayer = Game.System("Game/SpawnPlayer", {
  // Also allows Position, Velocity, and Health.
  commands: Game.System.commands(Game.System.spawns(Player))
}, ({ commands }) => {
  commands.spawn(Game.Command.spawn([Player, {}], [Position, { x: 0, y: 0 }]))
  // error: Game/Player requires Game/Velocity: add the missing entries to the draft
})
```

The draft is checked where it is committed (`commands.spawn` / `spawnIn`), so a
draft can be built in steps with `Game.Command.extend`. `commands.insert` checks
what the target's query proves plus the entries inserted with it, and
`commands.remove(match.entity, ...components)` refuses to remove a required
component while the entity may keep its requirer: remove both in one call, or
match the entity with a query that has `without: [Requirer]`. Requirements may
name components of other fragments of the same `Schema.bind`.

Types cannot see everything (another system's command applied first in the
same `applyDeferred()`, erased types), so the runtime checks again when
commands are applied: a command that would break a requirement is skipped,
traced, and reported by the `requirement-violated` lint. `restore` rejects a
save whose entity misses a required component.

`immutable: true` marks data that says what an entity is. Queries can only
read it (`Game.Query.write(EnemyKind)` does not compile); change it by
replacing it with `commands.insert(match.entity, [EnemyKind, "boss"])`, which
`Game.Query.changed(EnemyKind)` sees after the next `applyDeferred()`.

## 2. Write systems with exact capabilities

```ts
const Moving = Game.Query({
  selection: {
    position: Game.Query.write(Position),
    velocity: Game.Query.read(Velocity)
  }
})

const Move = Game.System(
  "Game/Move",
  {
    queries: { moving: Moving },
    resources: { dt: Game.System.readResource(DeltaTime) }
  },
  ({ queries, resources }) => {
    const dt = resources.dt.get()
    for (const { data } of queries.moving.each()) {
      const position = data.position.get()
      const velocity = data.velocity.get()
      data.position.set({
        x: position.x + velocity.x * dt,
        y: position.y + velocity.y * dt
      })
    }
  }
)
```

The callback cannot access undeclared world data. A write query exposes writable
cells; a read query does not. Values returned by `get()` are deeply readonly;
changes go through `set`, `update`, or a validated write helper. Type helper
functions that take such values as `ReadonlyValue<T>` (from
`@typeonce/ritmo/Query`) so they accept `get()` results without casts.

Work that only matters when something moved reads the change explicitly
instead of keeping a "last value" by hand:

```ts
const SyncHud = Game.System("Game/SyncHud", {
  resources: { score: Game.System.changedResource(Score) },
  services: { hud: Game.System.service(Hud) }
}, ({ resources, services }) => {
  if (!resources.score.changed()) return
  services.hud.score.textContent = `Score ${resources.score.get()}`
})

const Redraw = Game.Query({
  selection: { position: Game.Query.read(Position), sprite: Game.Query.read(Sprite) },
  filters: [Game.Query.anyOf(Game.Query.changed(Position), Game.Query.changed(Sprite))]
})
```

`changed()` is true when a committed write left a different value since this
system's previous run (and on its first run). `anyOf` matches an entity once
when any of its `added`/`changed` filters passes; filters listed side by side
must all pass.

## 3. Keep expected failures in the type

```ts
const SpendHealth = Game.System(
  "Game/SpendHealth",
  {
    queries: {
      target: Game.Query({
        selection: { health: Game.Query.write(Health) }
      })
    }
  },
  ({ queries }) => {
    const target = queries.target.single()
    if (!target.ok) {
      return Result.failure("TargetMissing" as const)
    }

    const health = target.value.data.health.get()
    if (health <= 0) {
      return Result.failure("AlreadyDead" as const)
    }

    target.value.data.health.set(health - 1)
  }
)

const gameplay = Game.Schedule(Move, SpendHealth)
const runtime = Game.Runtime.make({
  services: Game.Runtime.services(),
  resources: { DeltaTime: 1 / 60 }
}).value

const update = runtime.tick(gameplay)
if (!update.ok) {
  // update.error is the exact named-system failure union:
  // SystemFailure<"Game/SpendHealth", "TargetMissing" | "AlreadyDead">
  console.error(update.error.system, update.error.error)
}
```

Component, resource, event, queued-machine, and deferred-command writes
from the failing system are rolled back or discarded. Earlier successful
systems remain committed. External service effects, such as network or audio
calls, cannot be rolled back by the ECS.

Thrown exceptions remain defects and are rethrown after ECS writes from that
system are rolled back. `Result.failure` is for expected game outcomes.

## 4. Own scene entities as a group

Marker components are useful gameplay data, but they should not be required
only to delete a level. Entity scopes model ownership directly.

```ts
const Level = Game.EntityScope("Game/Level")

const LoadLevel = Game.System("Game/LoadLevel", {
  commands: Game.System.commands(Game.System.spawns(Position, Health))
}, ({ commands }) =>
  {
    commands.spawnIn(Level, Game.Command.spawn(
      Game.Command.entry(Position, { x: 10, y: 20 }),
      Game.Command.entry(Health, 3)
    ))
  }
)

const UnloadLevel = Game.System("Game/UnloadLevel", {
  commands: Game.System.commands(Game.System.despawnsScope(Level))
}, ({ commands }) =>
  { commands.despawnScope(Level) }
)
```

Persistent entities can still use `commands.spawn(...)`. Scope cleanup uses the
normal deferred-command boundary, so removal readers and renderer cleanup
systems see the same despawns as any other entity removal.

When the group lives exactly as long as a state, name the state change on the
scope instead of writing an unload system:

```ts
const Flow = Game.StateMachine("Game/Flow", ["Menu", "Playing", "GameOver"])
const Run = Game.EntityScope("Game/Run", { despawnOnExit: [Flow, "Playing"] })

// No despawn system, no despawnsScope permission, no marker between despawn and respawn.
const transitions = Game.Schedule.transitions(
  Game.Schedule.onEnter(Flow, "Playing", [SpawnRun])
)
```

`applyStateTransitions(...)` despawns every member right after it commits the
change: after the `onExit` schedules (which still see the members) and before
the `onEnter` schedules (whose spawns survive). `despawnOnEnter: [Flow, "Playing"]`
wipes on entering instead, for a restart that should keep the last round on
screen until the next one starts. A state or machine that does not belong to
the game fails to compile, and the `scope-trigger-never-applied` lint names a
trigger that can never fire. Keep `commands.despawnScope(...)` for wipes not
tied to a state change.

## 5. Read the world without making a diagnostic system

Inspectors are reusable read-only projections for tests, saves, debugging, UI
bridges, and host code.

```ts
const WorldSummary = Game.Inspector(
  "Game/WorldSummary",
  {
    queries: {
      actors: Game.Query({
        selection: {
          position: Game.Query.read(Position),
          health: Game.Query.read(Health)
        }
      })
    }
  },
  ({ queries }) => queries.actors.each().map(({ entity, data }) => ({
    id: entity.id,
    position: data.position.get(),
    health: data.health.get()
  }))
)

const summary = runtime.inspect(WorldSummary)
```

An inspector cannot declare write queries, write resources, commands, event
writers, or state-transition writers. Runtime provisioning is checked at the
call. Like a system, an inspector's `added`/`changed` filters and event
reads report what was published since its previous evaluation.

## Save and load

```ts
localStorage.setItem("save", JSON.stringify(runtime.snapshot()))

const loaded = runtime.restore(JSON.parse(localStorage.getItem("save") ?? "null"))
if (!loaded.ok) {
  // loaded.error: InvalidSnapshot | UnknownComponent | InvalidComponent | ...
  console.error(loaded.error)
}
```

A snapshot is plain data keyed by descriptor, relation, and machine names.
`restore` takes `unknown`, validates it against the schema (every component
and resource value runs through its descriptor's constructor), and leaves the
world untouched on failure.

Both methods only exist when every component and resource is either
transient (never saved) or constructed with a validator that accepts
untrusted input: a `result(raw: unknown)`, or a `decode(raw: unknown)` next to
a typed `result` (every validated value module in `@typeonce/ritmo-math` exports one). Otherwise calling
them fails to compile, and the error lists each descriptor to fix:

```ts
const Position = Descriptor.ConstructedComponent(Vector2)("Position")
const Stats = Descriptor.ConstructedComponent(Decode.struct({ level: Decode.integer, name: Decode.string }))("Stats")
const Target = Descriptor.ConstructedComponent(Decode.struct({ enemy: Decode.handle(Root, Health) }))("Target")
const Player = Descriptor.Tag("Player")
const Label = Descriptor.ConstructedComponent(Descriptor.fromStandardSchema(type("string")))("Label")
const Sprite = Descriptor.TransientComponent<{ frame: number }>()("Sprite") // rebuilt after load
```

Restored entities come back without transient components, and transient
resources keep their current values. Entity ids are kept, so stored handles still resolve. A restore reads
as despawns and spawns to change detection, so renderer sync rebuilds itself.

## Debug a run

A runtime made with `debug: { hostClock }` carries a read-only `debug` handle:
`describe()` for schedules and declared access, `dump()` for the current
world, `observe(listener)` for a trace of every system run, applied command,
and transition, and `streams()` for event retention. Runtimes made without it
have no handle. The host clock times traces: `HostClock.test()` (every timing
0) in tests and headless scripts, `BrowserHostClock.make(window)` in the
browser, `HostClock.standard` in Node tools that want real timings.

`@typeonce/ritmo-devtools` wraps the handle in a session that runs schedules headless
and answers questions as text:

```ts
const hostClock = HostClock.test()
const runtime = Game.Runtime.make({ services, resources, debug: { hostClock } }).value
const session = Session.make(runtime, { hostClock, schedules: { setup, update }, invariants: [HealthNeverNegative] })

session.run("setup")
console.log(session.run("update", { frames: 300 }))  // stops at the first violated invariant
console.log(session.why(12, Health))                 // latest changes and the systems that made them
console.log(session.journal({ frames: [180, 185], entity: 12 }))
```

Runs also warn about what types cannot rule out: NaN or infinite numbers
written anywhere, and component counts that keep growing (entities never
despawned). `describe()` notes systems that read a value before the schedule
writes it.

Keep the simulation schedules free of renderer services so they run in Node,
and feed input through `Keyboard.scripted(...)`. See
[`packages/devtools/README.md`](./packages/devtools/README.md).

## 6. Drive fixed updates from any renderer

`FixedLoop` in `@typeonce/ritmo` supplies timing policy without owning the
ECS, the renderer, or the platform. Frames come from a `TickSource` the host
passes in; `@typeonce/ritmo-browser` provides one over `requestAnimationFrame`.

```ts
import { Clock, FixedLoop } from "@typeonce/ritmo"
import { BrowserTickSource } from "@typeonce/ritmo-browser"

const source = BrowserTickSource.make(window)
const loop = FixedLoop.start({
  source,
  step: Clock.hz(60),
  maxFrameSeconds: 0.1,
  maxStepsPerFrame: 5,
  update: (stepSeconds) => {
    // A capture system can copy this host value into DeltaTime first.
    frameTime.deltaSeconds = stepSeconds
    return runtime.tick(gameplay)
  },
  render: ({ alpha, droppedSeconds }) => {
    renderer.render({ alpha })
    if (droppedSeconds > 0) {
      metrics.recordDroppedTime(droppedSeconds)
    }
  },
  onFailure: (failure) => {
    if (failure.kind === "UpdateFailure") {
      showGameError(failure.error)
    }
  }
})

if (!loop.ok) {
  throw new Error(`Invalid timing option: ${loop.error.field}`)
}

// Later:
loop.value.stop()
```

Pixi, Three, Canvas, native shells, tests, and server simulations can provide
another `TickSource`, usually by wrapping their own ticker with
`FixedLoop.source(...)`. The gameplay schedules do not change.

Keyboard input is exposed the same way: bind named actions once, and let
`InputCapture` copy one snapshot per update into a resource that gameplay
systems read like any other world data.

```ts
import { InputCapture, Keyboard } from "@typeonce/ritmo-browser"

const bindings = { left: ["ArrowLeft", "a"], right: ["ArrowRight", "d"], jump: [" ", "ArrowUp", "w"] } as const

const KeyboardInput = Descriptor.Service<Keyboard.Actions<typeof bindings>>()("Game/Keyboard")
const Input = Descriptor.TransientResource<Keyboard.Snapshot<typeof bindings>>()("Game/Input")

const CaptureInput = InputCapture.system(Game, { name: "Game/CaptureInput", source: KeyboardInput, resource: Input })

const Jump = Game.System("Game/Jump", { resources: { input: Game.System.readResource(Input) } }, ({ resources }) => {
  const input = resources.input.get()
  input.jump.pressed // true once per capture, even for taps shorter than a frame
  input.left.held
})

const keyboard = Keyboard.actions(window, bindings)
const runtime = Game.Runtime.make({
  services: Game.Runtime.services(Game.Runtime.service(KeyboardInput, keyboard)),
  resources: { Input: Keyboard.idle(bindings) }
}).value
const update = Game.Schedule(CaptureInput, Jump)

keyboard.dispose() // on teardown
```

The source can be any service with `snapshot()`, so a game that merges
keyboard, pointer, and gamepad input captures its own adapter the same way.
The resource's value type must match the snapshot type exactly.

## Recipes: simulation time and seeded random

Time is world data. Advance it from a fixed-step system so headless tests
and snapshot replay use the same clock as gameplay. The host supplies the
fixed step size; it does not capture elapsed time from a wall clock.

```ts
const Time = Descriptor.ConstructedResource(Decode.struct({
  step: Decode.integer, elapsed: Decode.number, dt: Decode.number
}))("Recipes/Time")

const AdvanceTime = Game.System("Recipes/AdvanceTime", {
  resources: { time: Game.System.writeResource(Time) }
}, ({ resources }) => {
  resources.time.update((time) => ({
    ...time, step: time.step + 1, elapsed: time.elapsed + time.dt
  }))
})
// Initialize Time with { step: 0, elapsed: 0, dt: 1 / 60 }.
// Place AdvanceTime before the systems that read it.
```

A seeded generator needs only a number resource and a pure `next` function.
Saving the resource saves the generator's position. A failed system rolls
back the updated seed with its other resource writes.

```ts
const Random = Descriptor.ConstructedResource(Decode.integer)("Recipes/Random")
const next = (seed: number): { readonly seed: number; readonly value: number } => {
  const state = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return { seed: state, value: state / 4294967296 }
}

const Roll = Game.System("Recipes/Roll", {
  resources: { random: Game.System.writeResource(Random) }
}, ({ resources }) => {
  const rolled = next(resources.random.get())
  resources.random.set(rolled.seed)
  // Use rolled.value for this system's random decision.
})
```

Include both resources in the bound schema. The complete, typechecked
example is [examples/recipes.ts](./examples/recipes.ts); its test restores a
snapshot and verifies that the next step produces the same time and seed.

## 7. Mirror entities into a renderer

`@typeonce/ritmo-render` owns the node bookkeeping for any renderer (Pixi,
Three.js, the DOM); what a node looks like, and how it joins and leaves the
scene, stays yours.

```ts
import { NodeRegistry, RenderSync } from "@typeonce/ritmo-render"

const RenderNodes = Descriptor.Service<NodeRegistry.NodeRegistry<Mesh>>()("Game/RenderNodes")

const render = RenderSync.system(Game, {
  name: "Game/Render",
  renderable: Renderable,
  transform: Position,
  registry: RenderNodes,
  create: ({ renderable }) => makeNode(renderable),
  apply: (node, { transform }) => node.position.set(transform.x, 0, transform.y)
})

const runtime = Game.Runtime.make({
  services: Game.Runtime.services(
    Game.Runtime.service(RenderNodes, NodeRegistry.make<Mesh>({
      attach: (node) => scene.add(node),
      detach: (node) => scene.remove(node)
    }))
  )
}).value

const update = Game.Schedule(Gameplay, Game.Schedule.applyDeferred(), render)
```

For Pixi, import `PixiNodeRegistry` from `@typeonce/ritmo-pixi` and provide
`PixiNodeRegistry.make(actorLayer)` as the same registry service. Nodes are
attached to the container and destroyed with their children when removed.
Keep `NodeRegistry` and `RenderSync` imports in `@typeonce/ritmo-render`.

The registry service is a normal requirement: ticking the render system on a
runtime that does not provide it is a compile error. `select`, `resources`,
and `services` pass extra read-only data to the callbacks, and `redrawOn`
lists components whose changes re-run `apply` (animation frames, tints,
interpolation).

With a fixed-step loop, draw movement between steps: copy `Position` into a
`PrevPosition` component at the start of each step, leave out `transform`
above, and add `RenderSync.interpolate(Game, { name, registry: RenderNodes,
previous: PrevPosition, current: Position, clock: RenderClock, place })`,
where `RenderClock` is a service holding `FixedLoop`'s render `alpha`.

## What remains adapter code

The core deliberately does not choose an asset loader, renderer, audio engine,
physics engine, networking stack, or save format. Those integrations should be
small packages built from services, systems, lifecycle readers, and inspectors.
The next renderer package should be based on at least two real games so its API
captures a repeated pattern instead of one demo's object model.

## Run natively

Add `@typeonce/ritmo-native`, a `native.ts` exporting `NativeHost.main`, and a
`ritmo-native.config.ts`. The host is injected into the entry. Reuse the same
simulation schema and schedules, existing structural input modules, and
`FixedLoop` through `NativeTickSource`. Native drawing is a separate game-owned
layer over `host.gfx`; `NativeNodeRegistry` keeps its nodes aligned with entities.
`ritmo-native check` compares headless frame output against interpreted Node.
See [native package setup](packages/native/README.md).
