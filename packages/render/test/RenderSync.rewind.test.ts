import { describe, expect, it } from "vitest"

import { Descriptor, Schema } from "@typeonce/ritmo"
import type * as Schedule from "@typeonce/ritmo/Schedule"
import { NodeRegistry, RenderSync } from "@typeonce/ritmo-render"

class FakeNode {
  x = 0
  destroyed = false
  destroy() {
    this.destroyed = true
  }
}

/** What the simulation does in one tick: spawn a sprite at `x`, move every sprite to `x`, or despawn the sprite with the lowest id. */
type Plan =
  | { readonly _tag: "Spawn"; readonly x: number }
  | { readonly _tag: "Move"; readonly x: number }
  | { readonly _tag: "Despawn" }
  | { readonly _tag: "Idle" }

const Position = Descriptor.Component<{ x: number }>()("Rewind/Position")
const Sprite = Descriptor.Component<{ label: string }>()("Rewind/Sprite")
const Plans = Descriptor.Service<Schedule.Source<Plan>>()("Rewind/Plans")
const Nodes = Descriptor.Service<NodeRegistry.NodeRegistry<FakeNode>>()("Rewind/Nodes")
const Root = Schema.defineRoot("Rewind")
const Game = Schema.bind(Schema.fragment({ components: { Position, Sprite } }), Root)

const Step = Game.System("Rewind/Step", {
  services: { plans: Game.System.consumeService(Plans) },
  queries: { sprites: Game.Query({ selection: { position: Game.Query.write(Position), sprite: Game.Query.read(Sprite) } }) },
  commands: Game.System.commands(Game.System.spawns(Position, Sprite), Game.System.despawns(Sprite))
}, ({ services, queries, commands }) => {
  const plan = services.plans.snapshot()
  if (plan._tag === "Spawn") commands.spawn(Game.Command.spawn([Sprite, { label: "shot" }], [Position, { x: plan.x }]))
  const { data } = queries.sprites
  if (plan._tag === "Move") for (const entity of queries.sprites.each()) data.position.set(entity, { x: plan.x })
  if (plan._tag === "Despawn") {
    const first = queries.sprites.each()[0]
    if (first !== undefined) commands.despawn(first)
  }
})
const simulate = Game.Schedule(Step, Game.Schedule.applyDeferred())

const setup = () => {
  const registry = NodeRegistry.make<FakeNode>({ attach: () => {}, detach: (node) => node.destroy() })
  const render = Game.Schedule(RenderSync.system(Game, {
    name: "Rewind/Render",
    renderable: Sprite,
    transform: Position,
    registry: Nodes,
    create: () => new FakeNode(),
    apply: (node, { transform }) => {
      node.x = transform.x
    }
  }))
  const plans = { next: { _tag: "Idle" } as Plan, snapshot: (): Plan => plans.next }
  const runtime = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(Plans, plans), Game.Runtime.service(Nodes, registry))
  }).value
  /** Runs one tick of the simulation with `plan`, then draws when asked. */
  const tick = (plan: Plan, draw = true) => {
    plans.next = plan
    expect(runtime.tick(simulate).ok).toBe(true)
    if (draw) expect(runtime.tick(render).ok).toBe(true)
  }
  const nodes = () => [...registry.entries()]
  return { runtime, registry, tick, nodes }
}

describe("RenderSync after a rewind", () => {
  it("keeps the node of an entity whose value the ticks after the rewind changed again", () => {
    const { runtime, registry, tick, nodes } = setup()
    tick({ _tag: "Spawn", x: 1 })
    const [[id, node]] = nodes() as [[number, FakeNode]]
    const checkpoint = runtime.checkpoint(simulate)
    tick({ _tag: "Move", x: 3 })
    expect(node.x).toBe(3)
    expect(runtime.rewind(checkpoint).ok).toBe(true)
    tick({ _tag: "Move", x: 4 })
    expect(registry.get(id)).toBe(node)
    expect(node).toMatchObject({ x: 4, destroyed: false })
  })

  it("puts back the value of before when the ticks after the rewind leave it alone", () => {
    const { runtime, tick, nodes } = setup()
    tick({ _tag: "Spawn", x: 1 })
    const [[, node]] = nodes() as [[number, FakeNode]]
    const checkpoint = runtime.checkpoint(simulate)
    tick({ _tag: "Move", x: 3 })
    expect(runtime.rewind(checkpoint).ok).toBe(true)
    tick({ _tag: "Idle" })
    expect(node).toMatchObject({ x: 1, destroyed: false })
  })

  it("keeps the node of an entity the rewind took away and the ticks after it spawned again under the same id", () => {
    const { runtime, registry, tick, nodes } = setup()
    const checkpoint = runtime.checkpoint(simulate)
    tick({ _tag: "Spawn", x: 2 })
    const [[id, node]] = nodes() as [[number, FakeNode]]
    expect(runtime.rewind(checkpoint).ok).toBe(true)
    tick({ _tag: "Spawn", x: 5 })
    expect(registry.size).toBe(1)
    expect(registry.get(id)).toBe(node)
    expect(node).toMatchObject({ x: 5, destroyed: false })
  })

  it("destroys the node of an entity the rewind took away for good", () => {
    const { runtime, registry, tick, nodes } = setup()
    const checkpoint = runtime.checkpoint(simulate)
    tick({ _tag: "Spawn", x: 2 })
    const [[, node]] = nodes() as [[number, FakeNode]]
    expect(runtime.rewind(checkpoint).ok).toBe(true)
    tick({ _tag: "Idle" })
    expect(registry.size).toBe(0)
    expect(node.destroyed).toBe(true)
  })

  it("makes a node again for an entity the rewind brought back", () => {
    const { runtime, registry, tick, nodes } = setup()
    tick({ _tag: "Spawn", x: 1 })
    const [[id, node]] = nodes() as [[number, FakeNode]]
    const checkpoint = runtime.checkpoint(simulate)
    tick({ _tag: "Despawn" })
    expect(node.destroyed).toBe(true)
    expect(runtime.rewind(checkpoint).ok).toBe(true)
    tick({ _tag: "Idle" })
    expect(registry.get(id)).toMatchObject({ x: 1, destroyed: false })
  })

  it("sees nothing at all when it did not draw the ticks that were rewound", () => {
    const { runtime, registry, tick, nodes } = setup()
    tick({ _tag: "Spawn", x: 1 })
    const [[id, node]] = nodes() as [[number, FakeNode]]
    const checkpoint = runtime.checkpoint(simulate)
    tick({ _tag: "Despawn" }, false)
    tick({ _tag: "Spawn", x: 7 }, false)
    expect(runtime.rewind(checkpoint).ok).toBe(true)
    tick({ _tag: "Idle" })
    expect(registry.size).toBe(1)
    expect(registry.get(id)).toBe(node)
    expect(node).toMatchObject({ x: 1, destroyed: false })
  })
})
