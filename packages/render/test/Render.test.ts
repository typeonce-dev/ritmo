import { describe, expect, it } from "vitest"

import { Descriptor, Schema } from "@typeonce/ritmo"
import type * as Entity from "@typeonce/ritmo/Entity"
import { NodeRegistry, RenderSync, packageTag } from "@typeonce/ritmo-render"

class FakeNode {
  readonly label: string
  x = 0
  y = 0
  destroyed = false
  constructor(label: string) {
    this.label = label
  }
  destroy() {
    this.destroyed = true
  }
}

class FakeLayer {
  readonly children: Array<FakeNode> = []
}

// A registry over a plain layer, the way a host wires its own renderer.
const inLayer = (layer: FakeLayer) =>
  NodeRegistry.make<FakeNode>({
    attach: (node) => {
      layer.children.push(node)
    },
    detach: (node) => {
      layer.children.splice(layer.children.indexOf(node), 1)
      node.destroy()
    }
  })

const Position = Descriptor.Component<{ x: number; y: number }>()("RenderTest/Position")
const Sprite = Descriptor.Component<{ label: string }>()("RenderTest/Sprite")
const Nodes = Descriptor.Service<NodeRegistry.NodeRegistry<FakeNode>>()("RenderTest/Nodes")

const Game = Schema.bind(Schema.fragment({ components: { Position, Sprite } }))
type Id = Entity.EntityId<typeof Game.schema, typeof Game.schema>

describe("@typeonce/ritmo-render", () => {
  it("resolves through the workspace package entrypoint", () => {
    expect(packageTag).toBe("render")
  })

  it("keeps one attached node per entity and destroys it on removal", () => {
    const layer = new FakeLayer()
    const registry = inLayer(layer)
    const first = registry.ensure(1, () => new FakeNode("a"))

    expect(registry.ensure(1, () => new FakeNode("b"))).toBe(first)
    expect(layer.children).toEqual([first])
    expect(registry.remove(1)).toBe(true)
    expect(registry.remove(1)).toBe(false)
    expect(first.destroyed).toBe(true)
    expect(layer.children).toEqual([])
  })

  it("calls attach once per created node and detach for every node on clear", () => {
    const attached: Array<string> = []
    const detached: Array<string> = []
    const registry = NodeRegistry.make<FakeNode>({
      attach: (node) => attached.push(node.label),
      detach: (node) => detached.push(node.label)
    })
    registry.ensure(1, () => new FakeNode("a"))
    registry.ensure(2, () => new FakeNode("b"))
    registry.ensure(1, () => new FakeNode("c"))

    expect(attached).toEqual(["a", "b"])
    expect(registry.size).toBe(2)
    expect(registry.get(2)?.label).toBe("b")
    expect([...registry.entries()].map(([key, node]) => [key, node.label])).toEqual([[1, "a"], [2, "b"]])
    registry.clear()
    expect(detached).toEqual(["a", "b"])
    expect(registry.size).toBe(0)
    expect(registry.get(1)).toBeUndefined()
  })

  it("mirrors spawns, moves, and despawns into registry nodes", () => {
    const layer = new FakeLayer()
    const registry = inLayer(layer)
    const render = RenderSync.system(Game, {
      name: "RenderTest/Render",
      renderable: Sprite,
      transform: Position,
      registry: Nodes,
      create: ({ renderable }) => new FakeNode(renderable.label),
      apply: (node, { transform }) => {
        node.x = transform.x
        node.y = transform.y
      }
    })

    const ids: Array<Id> = []
    const Spawn = Game.System("RenderTest/Spawn", { commands: Game.System.commands(Game.System.spawns(Position, Sprite)) }, ({ commands }) => {
      ids.push(commands.spawn(Game.Command.spawn([Position, { x: 1, y: 2 }], [Sprite, { label: "hero" }])))
      commands.spawn(Game.Command.spawn([Position, { x: 0, y: 0 }]))
    })
    const Move = Game.System("RenderTest/Move", {
      queries: { moving: Game.Query({ selection: { position: Game.Query.write(Position) }, with: [Sprite] }) }
    }, ({ queries }) => {
      for (const { data } of queries.moving.each()) {
        data.position.update((position) => ({ x: position.x + 10, y: position.y }))
      }
    })
    const Despawn = Game.System("RenderTest/Despawn", {
      queries: { sprites: Game.Query({ selection: { sprite: Game.Query.read(Sprite) } }) },
      commands: Game.System.commands(Game.System.despawns(Sprite))
    }, ({ queries, commands }) => {
      const hero = queries.sprites.get(ids[0]!)
      if (hero._tag === "Success") commands.despawn(hero.success.entity)
    })

    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(Nodes, registry))
    }).success
    const sync = Game.Schedule(render)

    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), sync))
    expect(layer.children.map((node) => [node.label, node.x, node.y])).toEqual([["hero", 1, 2]])

    runtime.tick(Game.Schedule(Move, sync))
    expect(layer.children.map((node) => [node.label, node.x, node.y])).toEqual([["hero", 11, 2]])

    const hero = layer.children[0]!
    runtime.tick(Game.Schedule(Despawn, Game.Schedule.applyDeferred(), sync))
    expect(layer.children).toEqual([])
    expect(hero.destroyed).toBe(true)
    expect(registry.size).toBe(0)
  })

  it("passes selected data, resources, and services to the callbacks", () => {
    const Zoom = Descriptor.Resource<number>()("RenderTest/Zoom")
    const Prefix = Descriptor.Service<string>()("RenderTest/Prefix")
    const Zoomed = Schema.bind(Schema.fragment({ components: { Position, Sprite }, resources: { Zoom } }))
    const layer = new FakeLayer()
    const render = RenderSync.system(Zoomed, {
      name: "RenderTest/Zoomed",
      renderable: Position,
      transform: Position,
      registry: Nodes,
      select: { sprite: Zoomed.Query.optional(Sprite) },
      resources: { zoom: Zoom },
      services: { prefix: Prefix },
      create: ({ data, services }) => new FakeNode(`${services.prefix}${data.sprite.present ? data.sprite.get().label : "none"}`),
      apply: (node, { transform, resources }) => {
        node.x = transform.x * resources.zoom.get()
      }
    })
    const Spawn = Zoomed.System("RenderTest/SpawnZoomed", { commands: Zoomed.System.commands(Zoomed.System.spawns(Position, Sprite)) }, ({ commands }) => {
      commands.spawn(Zoomed.Command.spawn([Position, { x: 3, y: 0 }], [Sprite, { label: "hero" }]))
      commands.spawn(Zoomed.Command.spawn([Position, { x: 1, y: 0 }]))
    })

    const runtime = Zoomed.Runtime.make({
      services: Zoomed.Runtime.services(
        Zoomed.Runtime.service(Nodes, inLayer(layer)),
        Zoomed.Runtime.service(Prefix, "#")
      ),
      resources: { Zoom: 2 }
    }).success
    runtime.tick(Zoomed.Schedule(Spawn, Zoomed.Schedule.applyDeferred(), render))
    expect(layer.children.map((node) => [node.label, node.x])).toEqual([["#hero", 6], ["#none", 2]])
  })

  it("re-applies nodes when a redrawOn component changes, once per entity", () => {
    const Frame = Descriptor.Component<number>()("RenderTest/Frame")
    const Animated = Schema.bind(Schema.fragment({ components: { Position, Sprite, Frame } }))
    const layer = new FakeLayer()
    const applied: Array<string> = []
    const render = RenderSync.system(Animated, {
      name: "RenderTest/Animated",
      renderable: Sprite,
      transform: Position,
      registry: Nodes,
      select: { frame: Animated.Query.read(Frame) },
      redrawOn: [Frame],
      create: ({ renderable }) => new FakeNode(renderable.label),
      apply: (node, { transform, data }) => {
        node.x = transform.x
        node.y = data.frame.get()
        applied.push(`${node.label}:${node.x}:${node.y}`)
      }
    })
    const Spawn = Animated.System("RenderTest/SpawnAnimated", { commands: Animated.System.commands(Animated.System.spawns(Position, Sprite, Frame)) }, ({ commands }) => {
      commands.spawn(Animated.Command.spawn([Position, { x: 0, y: 0 }], [Sprite, { label: "hero" }], [Frame, 0]))
    })
    const step = (moves: boolean) => Animated.System(`RenderTest/Step${moves}`, {
      queries: { heroes: Animated.Query({ selection: { position: Animated.Query.write(Position), frame: Animated.Query.write(Frame) } }) }
    }, ({ queries }) => {
      for (const { data } of queries.heroes.each()) {
        data.frame.update((frame) => frame + 1)
        if (moves) data.position.update((position) => ({ x: position.x + 1, y: position.y }))
      }
    })

    const runtime = Animated.Runtime.make({
      services: Animated.Runtime.services(Animated.Runtime.service(Nodes, inLayer(layer)))
    }).success
    runtime.tick(Animated.Schedule(Spawn, Animated.Schedule.applyDeferred(), render))
    runtime.tick(Animated.Schedule(step(false), render))
    runtime.tick(Animated.Schedule(step(true), render))
    // Each node is applied once per run, including the run that creates it.
    expect(applied).toEqual(["hero:0:0", "hero:0:1", "hero:1:2"])
  })

  it("replaces the node of an entity that lost and regained its renderable in one run", () => {
    const layer = new FakeLayer()
    const render = RenderSync.system(Game, {
      name: "RenderTest/Readd",
      renderable: Sprite,
      transform: Position,
      registry: Nodes,
      create: ({ renderable }) => new FakeNode(renderable.label),
      apply: () => {}
    })
    const ids: Array<Id> = []
    const Spawn = Game.System("RenderTest/SpawnReadd", { commands: Game.System.commands(Game.System.spawns(Position, Sprite)) }, ({ commands }) => {
      ids.push(commands.spawn(Game.Command.spawn([Position, { x: 0, y: 0 }], [Sprite, { label: "old" }])))
    })
    const Swap = Game.System("RenderTest/Swap", {
      queries: { sprites: Game.Query({ selection: { sprite: Game.Query.read(Sprite) } }) },
      commands: Game.System.commands(Game.System.removes(Sprite))
    }, ({ queries, commands }) => {
      for (const match of queries.sprites.each()) commands.remove(match.entity, Sprite)
    })
    const Readd = Game.System("RenderTest/ReaddSprite", { commands: Game.System.commands(Game.System.inserts(Sprite)) }, ({ commands }) => {
      commands.insert(ids[0]!, [Sprite, { label: "new" }])
    })
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(Nodes, inLayer(layer)))
    }).success
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), render))
    const old = layer.children[0]!
    runtime.tick(Game.Schedule(Swap, Game.Schedule.applyDeferred(), Readd, Game.Schedule.applyDeferred(), render))
    expect(old.destroyed).toBe(true)
    expect(layer.children.map((node) => node.label)).toEqual(["new"])
  })

  it("creates, updates, and destroys nothing while its run conditions fail, and catches up after", () => {
    const Mode = Game.StateMachine("RenderTest/Mode", ["Visible", "Hidden"] as const)
    const layer = new FakeLayer()
    const render = RenderSync.system(Game, {
      name: "RenderTest/Gated",
      renderable: Sprite,
      transform: Position,
      registry: Nodes,
      when: [Game.Condition.inState(Mode, "Visible")],
      create: ({ renderable }) => new FakeNode(renderable.label),
      apply: (node, { transform }) => {
        node.x = transform.x
      }
    })
    const Spawn = Game.System("RenderTest/SpawnGated", { commands: Game.System.commands(Game.System.spawns(Position, Sprite)) }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Position, { x: 4, y: 0 }], [Sprite, { label: "late" }]))
    })
    const Show = Game.System("RenderTest/Show", { nextMachines: { mode: Game.System.nextState(Mode) } }, ({ nextMachines }) => {
      nextMachines.mode.set("Visible")
    })
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(Nodes, inLayer(layer))),
      machines: Game.Runtime.machines(Game.Runtime.machine(Mode, "Hidden"))
    }).success
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), render))
    expect(layer.children).toEqual([])
    runtime.tick(Game.Schedule(Show, Game.Schedule.applyStateTransitions(), render))
    expect(layer.children.map((node) => [node.label, node.x])).toEqual([["late", 4]])
  })

  it("without a transform, applies on creation and redrawOn changes only", () => {
    const layer = new FakeLayer()
    const applied: Array<string> = []
    const render = RenderSync.system(Game, {
      name: "RenderTest/NoTransform",
      renderable: Sprite,
      registry: Nodes,
      redrawOn: [Sprite],
      create: ({ renderable }) => new FakeNode(renderable.label),
      apply: (_node, { renderable }) => {
        applied.push(renderable.label)
      }
    })
    const ids: Array<Id> = []
    const Spawn = Game.System("RenderTest/SpawnNoTransform", { commands: Game.System.commands(Game.System.spawns(Position, Sprite)) }, ({ commands }) => {
      ids.push(commands.spawn(Game.Command.spawn([Position, { x: 0, y: 0 }], [Sprite, { label: "a" }])))
    })
    const Move = Game.System("RenderTest/MoveNoTransform", { queries: { all: Game.Query({ selection: { position: Game.Query.write(Position) } }) } }, ({ queries }) => {
      for (const { data } of queries.all.each()) data.position.update((position) => ({ x: position.x + 1, y: position.y }))
    })
    const Relabel = Game.System("RenderTest/Relabel", { queries: { all: Game.Query({ selection: { sprite: Game.Query.write(Sprite) } }) } }, ({ queries }) => {
      for (const { data } of queries.all.each()) data.sprite.set({ label: "b" })
    })
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(Game.Runtime.service(Nodes, inLayer(layer))) }).success
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), render))
    runtime.tick(Game.Schedule(Move, render))
    runtime.tick(Game.Schedule(Relabel, render))
    expect(applied).toEqual(["a", "b"])
  })

  it("interpolates nodes between the previous and current positions at the clock's alpha", () => {
    const Previous = Descriptor.Component<{ x: number; y: number }>()("RenderTest/Previous")
    const Clock = Descriptor.Service<{ alpha: number }>()("RenderTest/Clock")
    const Moving = Schema.bind(Schema.fragment({ components: { Position, Previous, Sprite } }))
    const layer = new FakeLayer()
    const clock = { alpha: 0.25 }
    const sync = RenderSync.system(Moving, {
      name: "RenderTest/SyncMoving",
      renderable: Sprite,
      registry: Nodes,
      create: ({ renderable }) => new FakeNode(renderable.label),
      apply: () => {}
    })
    const interpolate = RenderSync.interpolate(Moving, {
      name: "RenderTest/Interpolate",
      registry: Nodes,
      previous: Previous,
      current: Position,
      clock: Clock,
      place: (node, { x, y }) => {
        node.x = x
        node.y = y
      }
    })
    const Spawn = Moving.System("RenderTest/SpawnMoving", { commands: Moving.System.commands(Moving.System.spawns(Position, Previous, Sprite)) }, ({ commands }) => {
      commands.spawn(Moving.Command.spawn([Position, { x: 10, y: 20 }], [Previous, { x: 0, y: 0 }], [Sprite, { label: "moving" }]))
      // No node: has both positions but no renderable.
      commands.spawn(Moving.Command.spawn([Position, { x: 1, y: 1 }], [Previous, { x: 0, y: 0 }]))
    })
    const runtime = Moving.Runtime.make({
      services: Moving.Runtime.services(Moving.Runtime.service(Nodes, inLayer(layer)), Moving.Runtime.service(Clock, clock))
    }).success
    runtime.tick(Moving.Schedule(Spawn, Moving.Schedule.applyDeferred(), sync, interpolate))
    expect(layer.children.map((node) => [node.x, node.y])).toEqual([[2.5, 5]])
    clock.alpha = 0.5
    runtime.tick(Moving.Schedule(interpolate))
    expect(layer.children.map((node) => [node.x, node.y])).toEqual([[5, 10]])
  })

  it("interpolates with blend, placing nodes at what blend returns", () => {
    const Spatial = Descriptor.Component<{ x: number; y: number; z: number }>()("RenderTest/Spatial")
    const PreviousSpatial = Descriptor.Component<{ x: number; y: number; z: number }>()("RenderTest/PreviousSpatial")
    const Clock = Descriptor.Service<{ alpha: number }>()("RenderTest/Clock")
    const Space = Schema.bind(Schema.fragment({ components: { Spatial, PreviousSpatial, Sprite } }))
    const layer = new FakeLayer()
    const placed: Array<[number, number, number]> = []
    const sync = RenderSync.system(Space, {
      name: "RenderTest/SyncSpatial",
      renderable: Sprite,
      registry: Nodes,
      create: ({ renderable }) => new FakeNode(renderable.label),
      apply: () => {}
    })
    const interpolate = RenderSync.interpolate(Space, {
      name: "RenderTest/Interpolate3D",
      registry: Nodes,
      previous: PreviousSpatial,
      current: Spatial,
      clock: Clock,
      blend: (from, to, alpha) => ({
        x: from.x + (to.x - from.x) * alpha,
        y: from.y + (to.y - from.y) * alpha,
        z: from.z + (to.z - from.z) * alpha
      }),
      place: (_node, { x, y, z }) => {
        placed.push([x, y, z])
      }
    })
    const Spawn = Space.System("RenderTest/SpawnSpatial", { commands: Space.System.commands(Space.System.spawns(Spatial, PreviousSpatial, Sprite)) }, ({ commands }) => {
      commands.spawn(Space.Command.spawn([Spatial, { x: 10, y: 20, z: 40 }], [PreviousSpatial, { x: 0, y: 0, z: 0 }], [Sprite, { label: "spatial" }]))
    })
    const runtime = Space.Runtime.make({
      services: Space.Runtime.services(Space.Runtime.service(Nodes, inLayer(layer)), Space.Runtime.service(Clock, { alpha: 0.25 }))
    }).success
    runtime.tick(Space.Schedule(Spawn, Space.Schedule.applyDeferred(), sync, interpolate))
    expect(placed).toEqual([[2.5, 5, 10]])
  })
})
