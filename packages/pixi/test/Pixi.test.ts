import { describe, expect, it } from "vitest"

import { Descriptor, Schema } from "@typeonce/ritmo"
import type * as Entity from "@typeonce/ritmo/Entity"
import { NodeRegistry, RenderSync } from "@typeonce/ritmo-render"
import * as Pixi from "@typeonce/ritmo-pixi"
import { PixiNodeRegistry, packageTag } from "@typeonce/ritmo-pixi"
import { Container } from "pixi.js"

describe("@typeonce/ritmo-pixi", () => {
  it("resolves through the workspace package entrypoint", () => {
    expect(packageTag).toBe("pixi")
    expect(Pixi).not.toHaveProperty("NodeRegistry")
    expect(Pixi).not.toHaveProperty("RenderSync")
  })

  it("make keeps one attached node per entity and destroys it on removal", () => {
    const layer = new Container()
    const registry = PixiNodeRegistry.make(layer)
    const first = registry.ensure(1, () => new Container({ label: "a" }))
    const decoration = first.addChild(new Container())

    expect(registry.ensure(1, () => new Container({ label: "b" }))).toBe(first)
    expect(layer.children).toEqual([first])
    expect(registry.remove(1)).toBe(true)
    expect(registry.remove(1)).toBe(false)
    expect(first.destroyed).toBe(true)
    expect(decoration.destroyed).toBe(true)
    expect(layer.children).toEqual([])
  })

  it("make detaches and destroys every node on clear", () => {
    const layer = new Container()
    const registry = PixiNodeRegistry.make(layer)
    const a = registry.ensure(1, () => new Container())
    const b = registry.ensure(2, () => new Container())

    expect(layer.children).toEqual([a, b])
    registry.clear()
    expect(layer.children).toEqual([])
    expect([a.destroyed, b.destroyed]).toEqual([true, true])
    expect(registry.size).toBe(0)
  })

  it("make adds a child's node under its parent's node and moves it back on reparent", () => {
    const layer = new Container()
    const registry = PixiNodeRegistry.make(layer)
    const tank = registry.ensure(1, () => new Container())
    const turret = registry.ensure(2, () => new Container(), 1)

    expect(turret.parent).toBe(tank)
    expect(layer.children).toEqual([tank])

    expect(registry.reparent(2, undefined)).toBe(true)
    expect(turret.parent).toBe(layer)
    expect(tank.children).toEqual([])

    registry.reparent(2, 1)
    expect(registry.remove(1)).toBe(true)
    expect(tank.destroyed).toBe(true)
    expect(turret.destroyed).toBe(false)
    expect(turret.parent).toBe(layer)
  })

  it("make destroys nested nodes once on clear", () => {
    const layer = new Container()
    const registry = PixiNodeRegistry.make(layer)
    const tank = registry.ensure(1, () => new Container())
    const turret = registry.ensure(2, () => new Container(), 1)

    registry.clear()
    expect([tank.destroyed, turret.destroyed]).toEqual([true, true])
    expect(layer.children).toEqual([])
  })

  it("RenderSync with a hierarchy nests real Pixi containers, so Pixi composes the transforms", () => {
    const Position = Descriptor.Component<{ x: number; y: number }>()("PixiTest/Position")
    const Body = Descriptor.Component<{}>()("PixiTest/Body")
    const { relation: Attached } = Descriptor.Hierarchy("PixiTest/Attached", "PixiTest/Attachments")
    const Nodes = Descriptor.Service<NodeRegistry.NodeRegistry<Container>>()("PixiTest/Nodes")
    const Game = Schema.bind(Schema.fragment({ components: { Position, Body }, relations: { Attached } }))
    type Id = Entity.EntityId<typeof Game.schema, typeof Game.schema>

    const render = RenderSync.system(Game, {
      name: "PixiTest/Render",
      renderable: Body,
      transform: Position,
      registry: Nodes,
      hierarchy: Attached,
      create: () => new Container(),
      apply: (node, { transform }) => node.position.set(transform.x, transform.y)
    })
    const ids: Array<Id> = []
    const Spawn = Game.System("PixiTest/Spawn", {
      commands: Game.System.commands(Game.System.spawns(Position, Body), Game.System.relates(Attached))
    }, ({ commands }) => {
      const tank = commands.spawn(Game.Command.spawn([Position, { x: 100, y: 50 }], [Body, {}]))
      const turret = commands.spawn(Game.Command.relate(Game.Command.spawn([Position, { x: 4, y: -2 }], [Body, {}]), Attached, tank))
      ids.push(tank, turret)
    })

    const layer = new Container()
    const registry = PixiNodeRegistry.make(layer)
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(Game.Runtime.service(Nodes, registry)) }).value
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), render))

    const tank = registry.get(ids[0]!)!
    const turret = registry.get(ids[1]!)!
    expect(layer.children).toEqual([tank])
    expect(turret.parent).toBe(tank)
    expect(turret.getGlobalPosition()).toMatchObject({ x: 104, y: 48 })
  })
})
