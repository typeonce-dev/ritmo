import { describe, expect, it } from "vitest"

import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Runtime from "@typeonce/ritmo/Runtime"
import { NodeRegistry, RenderSync } from "@typeonce/ritmo-render"

const Position = Descriptor.Component<{ x: number }>()("Lagged/Position")
const Sprite = Descriptor.Component<{}>()("Lagged/Sprite")
const Nodes = Descriptor.Service<NodeRegistry.NodeRegistry<{ readonly id: number }>>()("Lagged/Nodes")
const Root = Schema.defineRoot("Lagged")
const Game = Schema.bind(Schema.fragment({ components: { Position, Sprite } }), Root)

describe("RenderSync after its removal stream dropped entries", () => {
  it("destroys every node whose entity no longer matches", () => {
    const registry = NodeRegistry.make<{ readonly id: number }>({ attach: () => {}, detach: () => {} })
    const render = RenderSync.system(Game, {
      name: "Lagged/Render",
      renderable: Sprite,
      transform: Position,
      registry: Nodes,
      create: ({ entity }) => ({ id: entity }),
      apply: () => {}
    })
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(Game.Runtime.service(Nodes, registry)) }).value
    // More entities than a stream keeps, plus one that stays.
    const count = Runtime.streamCapacity + 10
    const Spawn = Game.System("Lagged/Spawn", { commands: Game.System.commands(Game.System.spawns(Sprite, Position)) }, ({ commands }) => {
      for (let index = 0; index <= count; index++) commands.spawn(Game.Command.spawn([Sprite, {}], [Position, { x: index }]))
    })
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), render))
    expect(registry.size).toBe(count + 1)

    // The render system does not run while every entity but the last despawns.
    const Clear = Game.System("Lagged/Clear", {
      queries: { sprites: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Sprite] }) },
      commands: Game.System.commands(Game.System.despawns(Sprite))
    }, ({ queries, commands }) => {
      const { data } = queries.sprites
      for (const entity of queries.sprites.each()) if (data.position.get(entity).x < count) commands.despawn(entity)
    })
    runtime.tick(Game.Schedule(Clear, Game.Schedule.applyDeferred()))
    runtime.tick(Game.Schedule())
    runtime.tick(Game.Schedule())

    runtime.tick(Game.Schedule(render))
    expect(registry.size).toBe(1)
  })
})
