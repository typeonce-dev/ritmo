import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"

const Position = Descriptor.Component<{ readonly x: number }>()("Stale/Position")
const Marker = Descriptor.Component<{}>()("Stale/Marker")
const Root = Schema.defineRoot("Stale")
const Game = Schema.bind(Schema.fragment({ components: { Position, Marker } }), Root)

const Positions = Game.Query({ selection: { position: Game.Query.write(Position) } })

const spawn = Game.System("Stale/Spawn", { commands: Game.System.commands(Game.System.spawns(Position, Marker)) }, ({ commands }) => {
  commands.spawn(Game.Command.spawn([Position, { x: 1 }], [Marker, {}]))
})

describe("an entity kept past its run", () => {
  it("throws a named error when its entity was despawned, instead of reading the internal marker", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services() }).value
    runtime.tick(Game.Schedule(spawn, Game.Schedule.applyDeferred()))
    const outcomes: Array<string> = []
    const Keep = Game.System("Stale/KeepDespawned", {
      queries: { positions: Positions },
      commands: Game.System.commands(Game.System.despawns(Position)),
      local: () => ({ held: undefined as undefined | (() => unknown) })
    }, ({ queries, commands, local }) => {
      if (local.held !== undefined) {
        try {
          local.held()
          outcomes.push("read")
        } catch (error) {
          outcomes.push((error as Error).message)
        }
        return
      }
      const entity = queries.positions.each()[0]!
      local.held = () => queries.positions.data.position.get(entity)
      commands.despawn(entity)
    })
    runtime.tick(Game.Schedule(Keep, Game.Schedule.applyDeferred()))
    runtime.tick(Game.Schedule(Keep, Game.Schedule.applyDeferred()))
    expect(outcomes).toEqual([
      "Stale/Position was used for an entity that was despawned: to follow an entity across runs, keep its id and resolve it again with queries.x.get(id), which is fallible"
    ])
  })

  it("throws instead of writing a removed component back without the insert path", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services() }).value
    runtime.tick(Game.Schedule(spawn, Game.Schedule.applyDeferred()))
    const outcomes: Array<string> = []
    const Keep = Game.System("Stale/KeepRemoved", {
      queries: { positions: Positions },
      commands: Game.System.commands(Game.System.removes(Position)),
      local: () => ({ held: undefined as undefined | (() => void) })
    }, ({ queries, commands, local }) => {
      if (local.held !== undefined) {
        try {
          local.held()
          outcomes.push("wrote")
        } catch (error) {
          outcomes.push((error as Error).message.split(":")[0]!)
        }
        return
      }
      const entity = queries.positions.each()[0]!
      local.held = () => queries.positions.data.position.set(entity, { x: 5 })
      commands.remove(entity, Position)
    })
    runtime.tick(Game.Schedule(Keep, Game.Schedule.applyDeferred()))
    runtime.tick(Game.Schedule(Keep, Game.Schedule.applyDeferred()))
    expect(outcomes).toEqual(["Stale/Position was used for an entity that lost it"])
    const Count = Game.Inspector("Stale/Count", { queries: { positions: Game.Query({ selection: { position: Game.Query.read(Position) } }) } }, ({ queries }) => queries.positions.each().length)
    expect(runtime.inspect(Count)).toBe(0)
  })
})
