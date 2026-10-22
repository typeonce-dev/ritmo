import { describe, expect, it } from "vitest"
import { Debug, Decode, Descriptor, HostClock, Schema } from "@typeonce/ritmo"

const Position = Descriptor.ConstructedComponent(Decode.struct({ x: Decode.number }))("Requires/Position")
const Velocity = Descriptor.ConstructedComponent(Decode.struct({ x: Decode.number }))("Requires/Velocity")
const Player = Descriptor.Tag("Requires/Player")
const Trail = Descriptor.TransientComponent<number>()("Requires/Trail")
// A transient requirer may require a transient component: a restore drops both.
const Ghost = Descriptor.TransientComponent<{}>()("Requires/Ghost")

const Game = Schema.bind(Schema.fragment({
  components: { Position, Velocity, Player, Trail, Ghost },
  requires: [Schema.requires(Player, Position, Velocity), Schema.requires(Ghost, Trail)]
}))

const makeRuntime = () => Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.test() } }).success

const Movers = Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Velocity], without: [Player] })

const SpawnMover = Game.System("Requires/SpawnMover", {
  commands: Game.System.commands(Game.System.spawns(Position, Velocity))
}, ({ commands }) => {
  commands.spawn(Game.Command.spawn([Position, { x: 1 }], [Velocity, { x: 0 }]))
})

/** Turns every mover into a player: complete, because the query proves Position and Velocity. */
const Promote = Game.System("Requires/Promote", {
  queries: { movers: Movers },
  commands: Game.System.commands(Game.System.inserts(Player))
}, ({ queries, commands }) => {
  for (const match of queries.movers.each()) commands.insert(match.entity, [Player, {}])
})

/** Stops every mover: fine for its proof (`without: [Player]`), stale once Promote's insert is applied first. */
const Stop = Game.System("Requires/Stop", {
  queries: { movers: Movers },
  commands: Game.System.commands(Game.System.removes(Velocity))
}, ({ queries, commands }) => {
  for (const match of queries.movers.each()) commands.remove(match.entity, Velocity)
})

const kinds = (runtime: ReturnType<typeof makeRuntime>) =>
  runtime.debug.dump().entities.map((entity) => Object.keys(entity.components).sort())

describe("Schema.requires at runtime", () => {
  it("skips a remove whose proof went stale in the same flush, and reports it", () => {
    const runtime = makeRuntime()
    const effects: Array<Debug.Effect> = []
    runtime.debug.observe((event) => {
      if (event.type === "deferred") for (const command of event.commands) effects.push(...command.effects)
    })
    const update = Game.Schedule(Promote, Stop, Game.Schedule.applyDeferred())
    runtime.debug.nameSchedules({ update })
    runtime.tick(Game.Schedule(SpawnMover, Game.Schedule.applyDeferred()))
    runtime.tick(update)

    expect(kinds(runtime)).toEqual([["Requires/Player", "Requires/Position", "Requires/Velocity"]])
    expect(effects).toContainEqual({ kind: "requirementViolated", entity: 1, command: "remove", component: "Requires/Player", missing: "Requires/Velocity" })
    const lints = runtime.debug.describe().lints.filter((lint) => lint.code === "requirement-violated")
    expect(lints.map((lint) => [lint.subject, lint.message])).toEqual([[
      "Requires/Stop",
      "Requires/Stop queued a remove that would have left Requires/Player without Requires/Velocity (last on entity 1), so it was skipped once"
    ]])
  })

  it("applies a remove that takes the requirer with it", () => {
    const runtime = makeRuntime()
    const Demote = Game.System("Requires/Demote", {
      queries: { players: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Player] }) },
      commands: Game.System.commands(Game.System.removes(Player, Velocity))
    }, ({ queries, commands }) => {
      for (const match of queries.players.each()) commands.remove(match.entity, Player, Velocity)
    })
    runtime.tick(Game.Schedule(SpawnMover, Game.Schedule.applyDeferred(), Promote, Game.Schedule.applyDeferred()))
    runtime.tick(Game.Schedule(Demote, Game.Schedule.applyDeferred()))
    expect(kinds(runtime)).toEqual([["Requires/Position"]])
  })

  it("skips an erased spawn or insert missing a requirement", () => {
    const runtime = makeRuntime()
    const Erased = Game.System("Requires/Erased", {
      queries: { all: Game.Query({ selection: { position: Game.Query.read(Position) } }) },
      commands: Game.System.commands(Game.System.spawns(Player), Game.System.inserts(Player))
    }, ({ queries, commands }) => {
      const spawn = commands.spawn as (draft: unknown) => unknown
      spawn(Game.Command.spawn([Player, {}], [Position, { x: 2 }]))
      const insert = commands.insert as (entity: unknown, ...entries: ReadonlyArray<unknown>) => unknown
      for (const match of queries.all.each()) insert(match.entity.id, [Player, {}])
    })
    const Place = Game.System("Requires/Place", {
      commands: Game.System.commands(Game.System.spawns(Position))
    }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Position, { x: 1 }]))
    })
    runtime.tick(Game.Schedule(Place, Game.Schedule.applyDeferred()))
    runtime.tick(Game.Schedule(Erased, Game.Schedule.applyDeferred()))
    expect(kinds(runtime)).toEqual([["Requires/Position"]])
    runtime.debug.nameSchedules({ erased: Game.Schedule(Erased) })
    expect(runtime.debug.describe().lints.filter((lint) => lint.code === "requirement-violated").map((lint) => lint.message)).toEqual([
      "Requires/Erased queued a spawn that would have left Requires/Player without Requires/Velocity (last on entity 2), so it was skipped once",
      "Requires/Erased queued an insert that would have left Requires/Player without Requires/Velocity (last on entity 1), so it was skipped once"
    ])
  })

  it("lists requirements and immutability per component in describe()", () => {
    const runtime = makeRuntime()
    const player = runtime.debug.describe().components.find((component) => component.name === "Requires/Player")
    expect(player).toEqual({ name: "Requires/Player", storage: "constructed", immutable: false, requires: ["Requires/Position", "Requires/Velocity"] })
  })

  it("restores entities that keep their requirements, and rejects one that does not", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(SpawnMover, Game.Schedule.applyDeferred(), Promote, Game.Schedule.applyDeferred()))
    const saved = JSON.parse(JSON.stringify(runtime.snapshot()))
    expect(runtime.restore(saved)).toEqual({ _tag: "Success", success: undefined })

    delete saved.entities[0].components["Requires/Velocity"]
    expect(runtime.restore(saved)).toEqual({
      _tag: "Failure",
      failure: { _tag: "MissingRequiredComponent", entityId: 1, name: "Requires/Velocity", requiredBy: "Requires/Player" }
    })
  })

  it("restores without a transient requirer and what it requires", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(Game.System("Requires/SpawnGhost", {
      commands: Game.System.commands(Game.System.spawns(Ghost))
    }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Ghost, {}], [Trail, 0]))
    }), Game.Schedule.applyDeferred()))
    const saved = JSON.parse(JSON.stringify(runtime.snapshot()))
    expect(runtime.restore(saved)).toEqual({ _tag: "Success", success: undefined })
  })

  it("rejects a saved component requiring a transient one when bound from erased fragments", () => {
    const Saved = Descriptor.Tag("Requires/Saved")
    const fragment: Schema.Schema.Any = Schema.fragment({ components: { Saved, Trail } })
    const requirement: Schema.Schema.Any = Schema.fragment({ requires: [Schema.requires(Saved, Trail)] })
    expect(() => Schema.bind(fragment, requirement)).toThrow(
      "Requires/Saved requires Requires/Trail, which is transient and not saved: make Requires/Saved transient too, or give Requires/Trail a constructor"
    )
  })
})
