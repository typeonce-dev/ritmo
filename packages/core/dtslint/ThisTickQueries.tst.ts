import { Descriptor, Schema } from "@typeonce/ritmo"
import type { QuerySpec } from "@typeonce/ritmo/Query"
import type * as System from "@typeonce/ritmo/System"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ readonly x: number }>()("Tick/Position")
const Enemy = Descriptor.Component<{}>()("Tick/Enemy")
const Health = Descriptor.Component<number>()("Tick/Health")
const Stunned = Descriptor.Component<{ readonly seconds: number }>()("Tick/Stunned")
const Frozen = Descriptor.Component<{}>()("Tick/Frozen")
const Hit = Descriptor.Event<{ readonly amount: number }>()("Tick/Hit")
const Game = Schema.bind(Schema.fragment({ components: { Position, Enemy, Health, Stunned, Frozen }, events: { Hit } }))
const Flow = Game.StateMachine("Tick/Flow", ["Menu", "Playing"])

const Newest = Game.Query({ selection: { position: Game.Query.read(Position), health: Game.Query.read(Health) }, with: [Enemy] })

/** Reads this tick's enemies. */
const Aim = Game.System("Tick/Aim", { queries: { enemies: Game.System.thisTick(Newest) } }, ({ queries }) => {
  expect(queries.enemies.each()[0]!.data.health.get()).type.toBe<number>()
})
/** Spawns everything `Newest` requires. */
const SpawnWave = Game.System("Tick/SpawnWave", {
  commands: Game.System.commands(Game.System.spawns(Position, Enemy, Health))
}, ({ commands }) => {
  commands.spawn(Game.Command.spawn([Position, { x: 0 }], [Enemy, {}], [Health, 3]))
})
/** Spawns without `Health`: it can never produce a match. */
const SpawnScenery = Game.System("Tick/SpawnScenery", {
  commands: Game.System.commands(Game.System.spawns(Position, Enemy))
}, ({ commands }) => {
  commands.spawn(Game.Command.spawn([Position, { x: 0 }], [Enemy, {}]))
})
/** Inserts a component `Newest` reads only optionally (with an optional slot). */
const Stun = Game.System("Tick/Stun", { commands: Game.System.commands(Game.System.inserts(Stunned)) }, () => {})
const AimOptional = Game.System("Tick/AimOptional", {
  queries: { enemies: Game.System.thisTick(Game.Query({ selection: { health: Game.Query.read(Health), stunned: Game.Query.optional(Stunned) } })) }
}, () => {})
/** Removes a component `AimUnfrozen` excludes. */
const Thaw = Game.System("Tick/Thaw", { commands: Game.System.commands(Game.System.removes(Frozen)) }, () => {})
const AimUnfrozen = Game.System("Tick/AimUnfrozen", {
  queries: { enemies: Game.System.thisTick(Game.Query({ selection: { health: Game.Query.read(Health) }, without: [Frozen] })) }
}, () => {})
/** Despawns enemies: never counted. */
const Cull = Game.System("Tick/Cull", {
  queries: { enemies: Newest },
  commands: Game.System.commands(Game.System.despawns(Enemy))
}, ({ queries, commands }) => {
  for (const { entity } of queries.enemies.each()) commands.despawn(entity)
})
const Strike = Game.System("Tick/Strike", { events: { hit: Game.System.writeEvent(Hit) } }, () => {})
const Feel = Game.System("Tick/Feel", { events: { hit: Game.System.thisTick(Game.System.readEvent(Hit)) } }, () => {})

const runtime = Game.Runtime.make({
  services: Game.Runtime.services(),
  machines: Game.Runtime.machines(Game.Runtime.machine(Flow, "Menu"))
}).success
const deferred = Game.Schedule.applyDeferred()
const playing = [Game.Condition.inState(Flow, "Playing")] as const

describe("Game.System.thisTick on queries", () => {
  it("marks a query and keeps its handle", () => {
    expect(Game.System.thisTick(Newest)).type.toBe<typeof Newest & System.ThisTick>()
    expect(Game.System.thisTick(Newest)).type.toBeAssignableTo<QuerySpec<any, any, any, any, any, any, any, any, any>>()
  })

  it("compiles when a command writer runs earlier with an applyDeferred() in between", () => {
    runtime.tick(Game.Schedule(SpawnWave, deferred, Aim))
    runtime.tick(Game.Schedule(SpawnWave, deferred), Game.Schedule(Aim))
    runtime.tick(Game.Schedule(SpawnWave), Game.Schedule(deferred, Aim))
  })

  it("rejects a command writer that runs after the reader", () => {
    // @ts-expect-error Tick/SpawnWave queues commands that Tick/Aim needs this tick (queries.enemies), but it runs after Tick/Aim: move Tick/SpawnWave before the applyDeferred() that precedes Tick/Aim
    runtime.tick(Game.Schedule(Aim, deferred, SpawnWave))
  })

  it("rejects a command writer before the reader with no applyDeferred() in between", () => {
    // @ts-expect-error Tick/Aim needs this tick's commands for queries.enemies, but Tick/SpawnWave queues them with no applyDeferred() in between: add Game.Schedule.applyDeferred() after Tick/SpawnWave
    runtime.tick(Game.Schedule(SpawnWave, Aim))
    // @ts-expect-error Tick/Aim needs this tick's commands for queries.enemies, but Tick/SpawnWave queues them with no applyDeferred() in between
    runtime.tick(Game.Schedule(SpawnWave), Game.Schedule(Aim))
    // A marker before the writer does not help.
    // @ts-expect-error Tick/Aim needs this tick's commands for queries.enemies, but Tick/SpawnWave queues them with no applyDeferred() in between
    runtime.tick(Game.Schedule(deferred, SpawnWave, Aim))
  })

  it("accepts a query read with no command writer in the tick call", () => {
    runtime.tick(Game.Schedule(Aim))
  })

  it("ignores spawns that cannot produce a match, and despawns", () => {
    runtime.tick(Game.Schedule(Aim, SpawnScenery))
    runtime.tick(Game.Schedule(SpawnScenery, Aim))
    runtime.tick(Game.Schedule(Aim, Cull))
    runtime.tick(Game.Schedule(Cull, Aim))
  })

  it("ignores inserts and removes of components an inline query does not name", () => {
    const Inline = Game.System("Tick/Inline", {
      queries: { seen: Game.System.thisTick(Game.Query({ selection: { health: Game.Query.read(Health) } })) }
    }, () => {})
    runtime.tick(Game.Schedule(Inline, Stun, Thaw))
    runtime.tick(Game.Schedule(Stun, Thaw, Inline))
  })

  it("counts inserts of an optional component and removes of a without component", () => {
    // @ts-expect-error Tick/Stun queues commands that Tick/AimOptional needs this tick (queries.enemies), but it runs after Tick/AimOptional
    runtime.tick(Game.Schedule(AimOptional, Stun))
    runtime.tick(Game.Schedule(Stun, deferred, AimOptional))
    // @ts-expect-error Tick/AimUnfrozen needs this tick's commands for queries.enemies, but Tick/Thaw queues them with no applyDeferred() in between
    runtime.tick(Game.Schedule(Thaw, AimUnfrozen))
    runtime.tick(Game.Schedule(Thaw, deferred, AimUnfrozen))
  })

  it("counts inserts of a component named only inside Query.anyOf", () => {
    const Redraw = Game.System("Tick/RedrawAnyOf", {
      queries: { changed: Game.System.thisTick(Game.Query({
        selection: { health: Game.Query.read(Health) },
        filters: [Game.Query.anyOf(Game.Query.added(Stunned), Game.Query.changed(Position))]
      })) }
    }, () => {})
    // @ts-expect-error Tick/RedrawAnyOf needs this tick's commands for queries.changed, but Tick/Stun queues them with no applyDeferred() in between
    runtime.tick(Game.Schedule(Stun, Redraw))
    // @ts-expect-error Tick/Stun queues commands that Tick/RedrawAnyOf needs this tick (queries.changed), but it runs after Tick/RedrawAnyOf
    runtime.tick(Game.Schedule(Redraw, Stun))
    runtime.tick(Game.Schedule(Stun, deferred, Redraw))
  })

  it("flattens nested schedules, and finds the marker at any level", () => {
    const spawning = Game.Schedule(SpawnWave)
    const flushed = Game.Schedule(SpawnWave, deferred)
    runtime.tick(Game.Schedule(flushed, Game.Schedule(Aim)))
    runtime.tick(Game.Schedule(spawning, Game.Schedule(deferred, Game.Schedule(Aim))))
    // @ts-expect-error Tick/Aim needs this tick's commands for queries.enemies, but Tick/SpawnWave queues them with no applyDeferred() in between
    runtime.tick(Game.Schedule(spawning, Game.Schedule(Game.Schedule(Aim))))
    // @ts-expect-error Tick/SpawnWave queues commands that Tick/Aim needs this tick (queries.enemies), but it runs after Tick/Aim
    runtime.tick(Game.Schedule(Game.Schedule(Aim), deferred, spawning))
  })

  it("counts gated groups by position", () => {
    runtime.tick(Game.Schedule(Game.Schedule.when(playing, SpawnWave), deferred, Game.Schedule.pauseWhen(playing, Aim)))
    // @ts-expect-error Tick/Aim needs this tick's commands for queries.enemies, but Tick/SpawnWave queues them with no applyDeferred() in between
    runtime.tick(Game.Schedule(Game.Schedule.when(playing, SpawnWave), Game.Schedule.when(playing, Aim)))
  })

  it("counts transition bundles at their marker, with the markers inside them", () => {
    // The marker flushes before its bundle runs.
    const spawnOnEnter = Game.Schedule.transitions(Game.Schedule.onEnter(Flow, "Playing", [SpawnWave]))
    // @ts-expect-error Tick/Aim needs this tick's commands for queries.enemies, but Tick/SpawnWave queues them with no applyDeferred() in between
    runtime.tick(Game.Schedule(Game.Schedule.applyStateTransitions(spawnOnEnter), Aim))
    runtime.tick(Game.Schedule(Game.Schedule.applyStateTransitions(spawnOnEnter), deferred, Aim))
    // @ts-expect-error Tick/SpawnWave queues commands that Tick/Aim needs this tick (queries.enemies), but it runs after Tick/Aim
    runtime.tick(Game.Schedule(Aim, Game.Schedule.applyStateTransitions(spawnOnEnter)))
    // A writer before the marker is flushed by it, for a reader inside the bundle.
    const aimOnEnter = Game.Schedule.transitions(Game.Schedule.onEnter(Flow, "Playing", [Aim]))
    runtime.tick(Game.Schedule(SpawnWave, Game.Schedule.applyStateTransitions(aimOnEnter)))
    // A marker inside the bundle counts.
    const startRun = Game.Schedule(SpawnWave, deferred, Aim)
    runtime.tick(Game.Schedule(Game.Schedule.applyStateTransitions(Game.Schedule.transitions(Game.Schedule.onEnter(Flow, "Playing", [startRun])))))
    const unflushedRun = Game.Schedule(SpawnWave, Aim)
    // @ts-expect-error Tick/Aim needs this tick's commands for queries.enemies, but Tick/SpawnWave queues them with no applyDeferred() in between
    runtime.tick(Game.Schedule(Game.Schedule.applyStateTransitions(Game.Schedule.transitions(Game.Schedule.onEnter(Flow, "Playing", [unflushedRun])))))
  })

  it("counts event writers inside transition bundles at their marker", () => {
    const strikeOnEnter = Game.Schedule.transitions(Game.Schedule.onEnter(Flow, "Playing", [Strike]))
    runtime.tick(Game.Schedule(Game.Schedule.applyStateTransitions(strikeOnEnter), Feel))
    // @ts-expect-error Tick/Feel needs Tick/Hit from this tick, but its writer Tick/Strike runs after it
    runtime.tick(Game.Schedule(Feel, Game.Schedule.applyStateTransitions(strikeOnEnter)))
  })

  it("does not count a command writer ticked in a separate call", () => {
    runtime.tick(Game.Schedule(SpawnWave))
    runtime.tick(Game.Schedule(Aim))
  })

  it("rejects a tick whose order is not statically known", () => {
    const widened: Array<typeof SpawnWave | typeof Aim> = [SpawnWave, Aim]
    // @ts-expect-error the order of this tick is not statically known
    runtime.tick(Game.Schedule(...widened))
  })
})

describe("Game.System.thisTick on events with runtime.send", () => {
  it("counts a sent event as written: a reader with no writer system compiles", () => {
    runtime.send(Hit, { amount: 1 })
    runtime.tick(Game.Schedule(Feel))
  })
})
