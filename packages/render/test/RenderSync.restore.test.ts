import { describe, expect, it } from "vitest"

import { Descriptor, Schema } from "@typeonce/ritmo"
import type * as Entity from "@typeonce/ritmo/Entity"
import { NodeRegistry, RenderSync } from "@typeonce/ritmo-render"

// A node that records what it was made for and where it is attached, like a scene graph would.
class FakeNode {
  readonly label: string
  parent: FakeNode | "root" | undefined = undefined
  x = 0
  destroyed = false
  constructor(label: string) {
    this.label = label
  }
}

type Check<T> = (raw: unknown) => { readonly value: T } | { readonly issues: ReadonlyArray<{ readonly message: string }> }
const schema = <T>(check: Check<T>): Descriptor.StandardSchema<T, T> => ({ "~standard": { version: 1, vendor: "test", validate: check } })
const isRecord = (raw: unknown): raw is Record<string, unknown> => typeof raw === "object" && raw !== null
const Point = schema<{ readonly x: number }>((raw) =>
  isRecord(raw) && typeof raw["x"] === "number" ? { value: { x: raw["x"] } } : { issues: [{ message: "Expected { x }" }] })
const Label = schema<{ readonly label: string }>((raw) =>
  isRecord(raw) && typeof raw["label"] === "string" ? { value: { label: raw["label"] } } : { issues: [{ message: "Expected { label }" }] })

const Root = Schema.defineRoot("RestoreRender")
const Position = Descriptor.ConstructedComponent(Point)("RestoreRender/Position")
const Body = Descriptor.ConstructedComponent(Label)("RestoreRender/Body")
const { relation: Attached } = Descriptor.Hierarchy("RestoreRender/Attached", "RestoreRender/Attachments")
const Nodes = Descriptor.Service<NodeRegistry.NodeRegistry<FakeNode>>()("RestoreRender/Nodes")
const Game = Schema.bind(Schema.fragment({ components: { Position, Body }, relations: { Attached } }), Root)
type Id = Entity.EntityId<typeof Game.schema, typeof Root>

/** What a test spawns: a body with its label, at its index, under the entity spawned at `parent`. */
interface Spawned {
  readonly label: string
  readonly parent?: number
}

const setup = () => {
  const registry = NodeRegistry.make<FakeNode>({
    attach: (node, parent) => {
      node.parent = parent ?? "root"
    },
    detach: (node) => {
      node.parent = undefined
      node.destroyed = true
    }
  })
  const render = Game.Schedule(RenderSync.system(Game, {
    name: "RestoreRender/Render",
    renderable: Body,
    transform: Position,
    registry: Nodes,
    hierarchy: Attached,
    create: ({ renderable }) => new FakeNode(renderable.label),
    apply: (node, { transform }) => {
      node.x = transform.x
    }
  }))
  const runtime = Game.Runtime.make({ services: Game.Runtime.services(Game.Runtime.service(Nodes, registry)) }).value
  /** Spawns `bodies` in one tick, each at x = its label's length, and returns their ids. */
  const spawn = (bodies: ReadonlyArray<Spawned>): ReadonlyArray<Id> => {
    const ids: Array<Id> = []
    const Spawn = Game.System("RestoreRender/Spawn", {
      commands: Game.System.commands(Game.System.spawns(Body, Position), Game.System.relates(Attached))
    }, ({ commands }) => {
      for (const body of bodies) {
        const draft = Game.Command.spawn([Body, { label: body.label }], [Position, { x: body.label.length }])
        ids.push(commands.spawn(body.parent === undefined ? draft : Game.Command.relate(draft, Attached, ids[body.parent]!)))
      }
    })
    expect(runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred())).ok).toBe(true)
    return ids
  }
  const draw = () => expect(runtime.tick(render).ok).toBe(true)
  /** The save of another runtime of the game that spawned `bodies`, as a file would hold it. */
  const saveOf = (bodies: ReadonlyArray<Spawned>): unknown => {
    const other = setup()
    other.spawn(bodies)
    const saved = other.runtime.snapshot()
    if (!saved.ok) throw new Error("fixture")
    return JSON.parse(JSON.stringify(saved.value))
  }
  /** Each node by its entity id: what it was made for, where it is attached, and its x. */
  const nodes = () => Object.fromEntries([...registry.entries()].map(([id, node]) => [
    id,
    { label: node.label, parent: node.parent === "root" ? "root" : node.parent?.label, x: node.x }
  ]))
  return { runtime, registry, spawn, draw, saveOf, nodes }
}

describe("RenderSync after a restore", () => {
  it("destroys the node of an entity the save does not hold", () => {
    const { runtime, registry, spawn, draw, saveOf, nodes } = setup()
    const [ship, rock] = spawn([{ label: "ship" }, { label: "rock" }])
    draw()
    const rockNode = registry.get(rock!)!
    expect(runtime.restore(saveOf([{ label: "ship" }])).ok).toBe(true)
    draw()
    expect(nodes()).toEqual({ [ship!]: { label: "ship", parent: "root", x: 4 } })
    expect(rockNode.destroyed).toBe(true)
  })

  it("gives an entity the save holds under its id a node made from the saved values", () => {
    const { runtime, registry, spawn, draw, saveOf, nodes } = setup()
    const [ship] = spawn([{ label: "ship" }])
    draw()
    const before = registry.get(ship!)!
    expect(runtime.restore(saveOf([{ label: "ship" }])).ok).toBe(true)
    draw()
    expect(nodes()).toEqual({ [ship!]: { label: "ship", parent: "root", x: 4 } })
    expect(registry.size).toBe(1)
    expect(before.destroyed).toBe(true)
  })

  it("makes a new node for an id that now holds another renderable", () => {
    const { runtime, registry, spawn, draw, saveOf, nodes } = setup()
    const [first, second] = spawn([{ label: "ship" }, { label: "rock" }])
    draw()
    const rockNode = registry.get(second!)!
    // The save's second entity is a tree: same id, another entity.
    expect(runtime.restore(saveOf([{ label: "ship" }, { label: "tree" }])).ok).toBe(true)
    draw()
    expect(nodes()).toEqual({
      [first!]: { label: "ship", parent: "root", x: 4 },
      [second!]: { label: "tree", parent: "root", x: 4 }
    })
    expect(rockNode.destroyed).toBe(true)
  })

  it("attaches each node under its parent's node as the save relates them", () => {
    const { runtime, spawn, draw, saveOf, nodes } = setup()
    // Live: a tank with a turret, and a lone crate. Saved: the crate's id is a
    // flag on a truck, and the turret's id is the truck.
    const [tank, turret, crate] = spawn([{ label: "tank" }, { label: "turret", parent: 0 }, { label: "crate" }])
    draw()
    expect(nodes()).toEqual({
      [tank!]: { label: "tank", parent: "root", x: 4 },
      [turret!]: { label: "turret", parent: "tank", x: 6 },
      [crate!]: { label: "crate", parent: "root", x: 5 }
    })
    expect(runtime.restore(saveOf([{ label: "base" }, { label: "truck" }, { label: "flag", parent: 1 }])).ok).toBe(true)
    draw()
    expect(nodes()).toEqual({
      [tank!]: { label: "base", parent: "root", x: 4 },
      [turret!]: { label: "truck", parent: "root", x: 5 },
      [crate!]: { label: "flag", parent: "truck", x: 4 }
    })
  })
})
