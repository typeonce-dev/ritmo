import { describe, expect, it } from "vitest"

import { Descriptor, Schema } from "@typeonce/ritmo"
import type * as Entity from "@typeonce/ritmo/Entity"
import { NodeRegistry, RenderSync } from "@typeonce/ritmo-render"

class FakeNode {
  x = 0
  destroyed = false
  destroy() {
    this.destroyed = true
  }
}

const Position = Descriptor.Component<{ x: number }>()("Membership/Position")
const Sprite = Descriptor.Component<{ label: string }>()("Membership/Sprite")
const Visible = Descriptor.Component<{}>()("Membership/Visible")
const Nodes = Descriptor.Service<NodeRegistry.NodeRegistry<FakeNode>>()("Membership/Nodes")
const Game = Schema.bind(Schema.fragment({ components: { Position, Sprite, Visible } }))
type Id = Entity.EntityId<typeof Game.schema, typeof Game.schema>
const stepAccess = {
  commands: Game.System.commands(Game.System.spawns(Position, Sprite, Visible), Game.System.inserts(Position, Visible), Game.System.removes(Position, Visible), Game.System.despawns(Sprite)),
  queries: { sprites: Game.Query({ selection: { sprite: Game.Query.read(Sprite) } }) }
}
const Step = Game.System("Membership/Step", stepAccess, () => {})

/** A render sync over Sprite + Position (+ a required `Visible` select slot when asked), and its registry. */
const setup = (withSelect = false) => {
  const registry = NodeRegistry.make<FakeNode>({ attach: () => {}, detach: (node) => node.destroy() })
  const options = {
    name: "Membership/Render",
    renderable: Sprite,
    transform: Position,
    registry: Nodes,
    create: () => new FakeNode(),
    apply: (node: FakeNode, { transform }: { readonly transform: { readonly x: number } }) => {
      node.x = transform.x
    }
  }
  const render = withSelect
    ? RenderSync.system(Game, { ...options, select: { visible: Game.Query.read(Visible) } })
    : RenderSync.system(Game, options)
  const runtime = Game.Runtime.make({ services: Game.Runtime.services(Game.Runtime.service(Nodes, registry)) }).success
  const ids: Array<Id> = []
  const step = (run: (context: Parameters<typeof Step.run>[0]) => void) =>
    runtime.tick(Game.Schedule(Game.System("Membership/Step", stepAccess, run), Game.Schedule.applyDeferred(), render))
  return { registry, ids, step }
}

describe("RenderSync keeps one node per entity its query matches", () => {
  it("creates the node when the transform arrives after the renderable", () => {
    const { registry, ids, step } = setup()
    step(({ commands }) => {
      ids.push(commands.spawn(Game.Command.spawn([Sprite, { label: "hero" }])))
    })
    expect(registry.size).toBe(0)
    step(({ commands }) => {
      commands.insert(ids[0]!, [Position, { x: 4 }])
    })
    expect(registry.size).toBe(1)
    expect(registry.get(ids[0]!)?.x).toBe(4)
  })

  it("destroys the node when the transform is removed, and makes it again when it returns", () => {
    const { registry, ids, step } = setup()
    step(({ commands }) => {
      ids.push(commands.spawn(Game.Command.spawn([Sprite, { label: "hero" }], [Position, { x: 1 }])))
    })
    const first = registry.get(ids[0]!)!
    step(({ commands, queries }) => {
      const found = queries.sprites.get(ids[0]!)
      if (found._tag === "Failure") throw new Error("sprite must still be alive")
      commands.remove(found.success.entity, Position)
    })
    expect(registry.size).toBe(0)
    expect(first.destroyed).toBe(true)
    step(({ commands }) => {
      commands.insert(ids[0]!, [Position, { x: 9 }])
    })
    expect(registry.get(ids[0]!)?.x).toBe(9)
  })

  it("follows a required select slot like the renderable and the transform", () => {
    const { registry, ids, step } = setup(true)
    step(({ commands }) => {
      ids.push(commands.spawn(Game.Command.spawn([Sprite, { label: "hero" }], [Position, { x: 1 }])))
    })
    expect(registry.size).toBe(0)
    step(({ commands }) => {
      commands.insert(ids[0]!, [Visible, {}])
    })
    expect(registry.size).toBe(1)
    step(({ commands, queries }) => {
      const found = queries.sprites.get(ids[0]!)
      if (found._tag === "Failure") throw new Error("sprite must still be alive")
      commands.remove(found.success.entity, Visible)
    })
    expect(registry.size).toBe(0)
  })

  it("still destroys the nodes of despawned entities", () => {
    const { registry, ids, step } = setup()
    step(({ commands }) => {
      ids.push(commands.spawn(Game.Command.spawn([Sprite, { label: "hero" }], [Position, { x: 1 }])))
    })
    step(({ commands, queries }) => {
      const found = queries.sprites.get(ids[0]!)
      if (found._tag === "Failure") throw new Error("sprite must still be alive")
      commands.despawn(found.success.entity)
    })
    expect(registry.size).toBe(0)
  })
})
