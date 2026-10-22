/**
 * One small program that touches every core concept: descriptors, a closed
 * schema, systems, commands, handles, events, failures, change detection,
 * machines, and schedules. It is typechecked with the repository and run by
 * `packages/core/test/Concepts.test.ts`.
 */
import { Decode, Descriptor, Result, Schema } from "@typeonce/ritmo"
import type { Query } from "@typeonce/ritmo/Query"

// 1. Descriptors name the data a world can hold. Constructed descriptors carry
//    a validator, so values loaded from a save are checked; transient ones are
//    never saved. `Decode` covers common shapes; any Standard Schema validator
//    works through `Descriptor.fromStandardSchema(...)`.
const Root = Schema.defineRoot("Concepts")
const vector = Decode.struct({ x: Decode.number, y: Decode.number })
const Position = Descriptor.ConstructedComponent(vector)("Concepts/Position")
const Velocity = Descriptor.ConstructedComponent(vector)("Concepts/Velocity")
const Health = Descriptor.ConstructedComponent(Decode.number)("Concepts/Health")
const Target = Descriptor.ConstructedComponent(Decode.struct({ enemy: Decode.handle(Root, Health) }))("Concepts/Target")
const DeltaTime = Descriptor.TransientResource<number>()("Concepts/DeltaTime")
const Score = Descriptor.ConstructedResource(Decode.number)("Concepts/Score")
const Hit = Descriptor.Event<{ readonly amount: number }>()("Concepts/Hit")
const Log = Descriptor.Service<{ readonly write: (line: string) => void }>()("Concepts/Log")
const { relation: ChildOf } = Descriptor.Hierarchy("Concepts/ChildOf", "Concepts/Children")

// 2. A schema closes the world; binding it gives the typed `Game` API.
export const Game = Schema.bind(Schema.fragment({
  components: { Position, Velocity, Health, Target },
  resources: { DeltaTime, Score },
  events: { Hit },
  relations: { ChildOf }
}), Root)

// 3. State machines model modes whose transitions matter.
const Flow = Game.StateMachine("Concepts/Flow", ["Playing", "Won"])

// 4. Systems declare everything they touch; the callback sees nothing else.
const Moving = Game.Query({
  selection: { position: Game.Query.write(Position), velocity: Game.Query.read(Velocity) }
})

const positionOf = (data: Query.Cells<typeof Moving>) => data.position.get()

const Move = Game.System("Concepts/Move", {
  queries: { moving: Moving },
  resources: { dt: Game.System.readResource(DeltaTime) }
}, ({ queries, resources }) => {
  const dt = resources.dt.get()
  for (const { data } of queries.moving.each()) {
    const velocity = data.velocity.get()
    const position = positionOf(data)
    data.position.set({ x: position.x + velocity.x * dt, y: position.y + velocity.y * dt })
  }
})

// 5. Structural changes are commands, applied at `applyDeferred()`.
const Spawn = Game.System("Concepts/Spawn", {
  commands: Game.System.commands(Game.System.spawns(Health, Position, Velocity, Target), Game.System.relates(ChildOf))
}, ({ commands }) => {
  const enemy = commands.spawn(Game.Command.spawn([Health, 3], [Position, { x: 10, y: 0 }]))
  commands.spawn(Game.Command.spawn(
    [Position, { x: 0, y: 0 }],
    [Velocity, { x: 1, y: 0 }],
    [Target, { enemy: Game.Entity.handle(enemy, Health) }]
  ))
  commands.spawn(Game.Command.relate(Game.Command.spawn([Health, 1]), ChildOf, enemy))
})

// 6. Handles are storage-safe; resolving one is explicit and can fail.
const Attack = Game.System("Concepts/Attack", {
  queries: {
    attackers: Game.Query({ selection: { target: Game.Query.read(Target) } }),
    enemies: Game.Query({ selection: { health: Game.Query.read(Health) } })
  },
  events: { hit: Game.System.writeEvent(Hit) }
}, ({ queries, events }) => {
  for (const { data } of queries.attackers.each()) {
    const enemy = queries.enemies.getHandle(data.target.get().enemy)
    if (enemy._tag === "Success") {
      events.hit.emit({ amount: 1 })
    }
  }
})

// 7. Expected failures are typed and roll the system back.
const ApplyHits = Game.System("Concepts/ApplyHits", {
  events: { hit: Game.System.readEvent(Hit) },
  resources: { score: Game.System.writeResource(Score) },
  nextMachines: { flow: Game.System.nextState(Flow) }
}, ({ events, resources, nextMachines }) => {
  const total = events.hit.all().reduce((sum, hit) => sum + hit.amount, 0)
  if (total > 100) {
    return Result.fail("ImpossibleDamage" as const)
  }
  resources.score.update((score) => score + total)
  if (resources.score.get() >= 3) {
    nextMachines.flow.set("Won")
  }
})

// 8. Change detection is per system: each run sees changes since its last run.
const Report = Game.System("Concepts/Report", {
  queries: { moved: Game.Query({ selection: { position: Game.Query.read(Position) }, filters: [Game.Query.changed(Position)] }) },
  machines: { flow: Game.System.machine(Flow) },
  services: { log: Game.System.service(Log) }
}, ({ queries, machines, services }) => {
  services.log.write(`${machines.flow.get()}: ${queries.moved.each().length} moved`)
})

// 9. Schedules order systems and make every visibility boundary explicit.
export const setup = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
export const update = Game.Schedule(
  Move,
  Attack,
  ApplyHits,
  Game.Schedule.applyStateTransitions(),
  Report
)

const ReadMoving = Game.Query({
  selection: { position: Game.Query.read(Position), velocity: Game.Query.read(Velocity) }
})
const movementAccess = { queries: { moving: ReadMoving } }
const InspectPosition = Game.Inspector("Concepts/InspectPosition", {
  ...movementAccess,
  machines: { flow: Game.System.machine(Flow) }
}, ({ queries, machines }) => ({
  position: queries.moving.each().map(({ data }) => data.position.get()),
  flow: machines.flow.get()
}))

export const runLookups = () => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(),
    machines: Game.Runtime.machines(Game.Runtime.machine(Flow, "Playing"))
  }).success
  made.tick(setup)
  let found = false
  let only = false
  const Lookup = Game.System("Concepts/Lookup", movementAccess, ({ queries }) => {
    const [first] = queries.moving.each()
    if (first === undefined) return
    found = queries.moving.get(first.entity.id)._tag === "Success"
    const result = queries.moving.singleOptional()
    only = result._tag === "Success" && result.success !== undefined
  })
  made.tick(Game.Schedule(Lookup))
  return { found, only, ...made.inspect(InspectPosition) }
}

// 10. The runtime owns the world; the host drives it.
export const runConcepts = (frames: number): { readonly log: ReadonlyArray<string>; readonly failure: string | undefined } => {
  const log: Array<string> = []
  // Constructed resources are validated here, so making the runtime can fail.
  const made = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(Log, { write: (line) => log.push(line) })),
    resources: { DeltaTime: 1, Score: 0 },
    machines: Game.Runtime.machines(Game.Runtime.machine(Flow, "Playing"))
  })
  if (made._tag === "Failure") {
    return { log, failure: "InvalidResources" }
  }
  const runtime = made.success

  const ready = runtime.tick(setup)
  if (ready._tag === "Failure") {
    return { log, failure: "setup failed" }
  }
  for (let frame = 0; frame < frames; frame++) {
    const result = runtime.tick(update)
    if (result._tag === "Failure") {
      return { log, failure: `${result.failure.system}: ${result.failure.error}` }
    }
  }

  const saved = JSON.stringify(runtime.snapshot())
  const restored = runtime.restore(JSON.parse(saved))
  return { log, failure: restored._tag === "Success" ? undefined : restored.failure._tag }
}
