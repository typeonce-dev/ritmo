import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"

const Health = Descriptor.Component<number>()("EntityId/Health")
const Game = Schema.bind(Schema.fragment({ components: { Health } }))

describe("Game.Entity.id", () => {
  it("returns the id a handle names, and handles of one entity compare by ===", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services() }).value
    const seen: Array<boolean> = []
    runtime.tick(Game.Schedule(
      Game.System("EntityId/Spawn", { commands: Game.System.commands(Game.System.spawns(Health)) }, ({ commands }) => {
        commands.spawn(Game.Command.spawn([Health, 3]))
      }),
      Game.Schedule.applyDeferred(),
      Game.System("EntityId/Check", { queries: { healths: Game.Query({ selection: { health: Game.Query.read(Health) } }) } }, ({ queries }) => {
        for (const entity of queries.healths.each()) {
          const handle = Game.Entity.handle(entity, Health)
          seen.push(Game.Entity.id(handle) === entity.id, handle === Game.Entity.handle(entity.id, Health))
          seen.push(queries.healths.get(Game.Entity.id(handle)).ok)
        }
      })
    ))
    expect(seen).toEqual([true, true, true])
  })
})
