import { describe, expect, it } from "vitest"

import { Descriptor, Schema } from "@typeonce/ritmo"
import type * as Entity from "@typeonce/ritmo/Entity"
import type * as Schedule from "@typeonce/ritmo/Schedule"
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

/** One body a tick spawns: its label, at x, under the body spawned before it at index `parent`. */
interface Spawned {
  readonly label: string
  readonly x: number
  readonly parent?: number
}

/** What the simulation does in one tick. */
type Plan =
  | { readonly _tag: "Spawn"; readonly bodies: ReadonlyArray<Spawned> }
  // Gives every body labelled `from` the label `to`, and moves it to `x` when given.
  | { readonly _tag: "Relabel"; readonly from: string; readonly to: string; readonly x?: number }
  // Lowers the curtain the render system waits behind, or lifts it.
  | { readonly _tag: "Curtain"; readonly down: boolean }
  | { readonly _tag: "Idle" }

const Root = Schema.defineRoot("RecreateRender")
const Position = Descriptor.ConstructedComponent(Point)("RecreateRender/Position")
const Body = Descriptor.ConstructedComponent(Label)("RecreateRender/Body")
const Curtain = Descriptor.ConstructedComponent(Label)("RecreateRender/Curtain")
const { relation: Attached } = Descriptor.Hierarchy("RecreateRender/Attached", "RecreateRender/Attachments")
const Plans = Descriptor.Service<Schedule.Source<Plan>>()("RecreateRender/Plans")
const Nodes = Descriptor.Service<NodeRegistry.NodeRegistry<FakeNode>>()("RecreateRender/Nodes")
const Game = Schema.bind(Schema.fragment({ components: { Position, Body, Curtain }, relations: { Attached } }), Root)
type Id = Entity.EntityId<typeof Game.schema, typeof Root>

const Step = Game.System("RecreateRender/Step", {
  services: { plans: Game.System.consumeService(Plans) },
  queries: {
    bodies: Game.Query({ selection: { body: Game.Query.write(Body), position: Game.Query.write(Position) } }),
    curtains: Game.Query({ selection: { curtain: Game.Query.read(Curtain) } })
  },
  commands: Game.System.commands(Game.System.spawns(Position, Body, Curtain), Game.System.despawns(Curtain), Game.System.relates(Attached))
}, ({ services, queries, commands }) => {
  const plan = services.plans.snapshot()
  if (plan._tag === "Spawn") {
    const ids: Array<Id> = []
    for (const body of plan.bodies) {
      const draft = Game.Command.spawn([Body, { label: body.label }], [Position, { x: body.x }])
      ids.push(commands.spawn(body.parent === undefined ? draft : Game.Command.relate(draft, Attached, ids[body.parent]!)))
    }
  }
  if (plan._tag === "Relabel") {
    const { data } = queries.bodies
    for (const entity of queries.bodies.each()) {
      if (data.body.get(entity).label !== plan.from) continue
      data.body.set(entity, { label: plan.to })
      if (plan.x !== undefined) data.position.set(entity, { x: plan.x })
    }
  }
  if (plan._tag === "Curtain") {
    if (plan.down) commands.spawn(Game.Command.spawn([Curtain, { label: "curtain" }]))
    else for (const entity of queries.curtains.each()) commands.despawn(entity)
  }
})
const simulate = Game.Schedule(Step, Game.Schedule.applyDeferred())

// The render system waits while a curtain is down.
const open = Game.Condition.check("RecreateRender/Open", {
  queries: { curtains: Game.Query({ selection: { curtain: Game.Query.read(Curtain) } }) }
}, ({ queries }) => queries.curtains.each().length === 0)

/** How the render system is set up: with a transform (the default), without one, or with a transform and the hierarchy. */
type Variant = "transform" | "bare" | "tree"

const setup = (variant: Variant = "transform") => {
  const log: Array<string> = []
  const registry = NodeRegistry.make<FakeNode>({
    attach: (node, parent) => {
      node.parent = parent ?? "root"
      log.push(`attach ${node.label}>${parent?.label ?? "root"}`)
    },
    detach: (node) => {
      node.parent = undefined
      node.destroyed = true
      log.push(`detach ${node.label}`)
    }
  })
  const create = ({ renderable }: { readonly renderable: { readonly label: string } }) => {
    log.push(`create ${renderable.label}`)
    return new FakeNode(renderable.label)
  }
  const system = variant === "bare"
    ? RenderSync.system(Game, {
      name: "RecreateRender/RenderBare",
      renderable: Body,
      registry: Nodes,
      select: { position: Game.Query.read(Position) },
      when: [open],
      create,
      apply: (node, { data }) => {
        node.x = data.position.get().x
        log.push(`apply ${node.label}@${node.x}`)
      }
    })
    : variant === "tree"
    ? RenderSync.system(Game, {
      name: "RecreateRender/RenderTree",
      renderable: Body,
      transform: Position,
      registry: Nodes,
      hierarchy: Attached,
      when: [open],
      create,
      apply: (node, { transform }) => {
        node.x = transform.x
        log.push(`apply ${node.label}@${node.x}`)
      }
    })
    : RenderSync.system(Game, {
      name: "RecreateRender/Render",
      renderable: Body,
      transform: Position,
      registry: Nodes,
      when: [open],
      create,
      apply: (node, { transform }) => {
        node.x = transform.x
        log.push(`apply ${node.label}@${node.x}`)
      }
    })
  const render = Game.Schedule(system)
  const plans = { next: { _tag: "Idle" } as Plan, snapshot: (): Plan => plans.next }
  const runtime = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(Plans, plans), Game.Runtime.service(Nodes, registry))
  }).value
  /** Runs one tick of the simulation with `plan`, then draws; returns what the draw did. */
  const tick = (plan: Plan): ReadonlyArray<string> => {
    plans.next = plan
    expect(runtime.tick(simulate).ok).toBe(true)
    log.length = 0
    expect(runtime.tick(render).ok).toBe(true)
    return [...log]
  }
  /** Each node by entity id: what it was made for, where it is attached, and its x. */
  const nodes = () => [...registry.entries()].sort(([left], [right]) => left - right).map(([id, node]) => ({
    id,
    label: node.label,
    parent: node.parent === "root" ? "root" : node.parent?.label,
    x: node.x
  }))
  /** The save of another runtime of the game after `plan`, as a file would hold it. */
  const saveOf = (plan: Plan): unknown => {
    const other = setup(variant)
    other.tick(plan)
    const saved = other.runtime.snapshot()
    if (!saved.ok) throw new Error("fixture")
    return JSON.parse(JSON.stringify(saved.value))
  }
  return { runtime, registry, tick, nodes, saveOf }
}

const spawn = (...bodies: ReadonlyArray<Spawned>): Plan => ({ _tag: "Spawn", bodies })

describe("RenderSync makes a node again when its renderable changes", () => {
  it("after a rewind, gives another kind spawned under a drawn id a node of its own", () => {
    const { runtime, tick, nodes } = setup()
    const checkpoint = runtime.checkpoint(simulate)
    tick(spawn({ label: "bullet", x: 2 }))
    const [bullet] = nodes()
    expect(runtime.rewind(checkpoint).ok).toBe(true)
    expect(tick(spawn({ label: "enemy", x: 5 }))).toEqual(["detach bullet", "create enemy", "attach enemy>root", "apply enemy@5"])
    expect(nodes()).toEqual([{ id: bullet!.id, label: "enemy", parent: "root", x: 5 }])
  })

  it("after a rewind, without a transform, gives another kind spawned under a drawn id a node of its own", () => {
    const { runtime, tick, nodes } = setup("bare")
    const checkpoint = runtime.checkpoint(simulate)
    tick(spawn({ label: "bullet", x: 2 }))
    expect(runtime.rewind(checkpoint).ok).toBe(true)
    // Without a transform the re-spawned id is not synced at all unless its renderable differs.
    expect(tick(spawn({ label: "enemy", x: 5 }))).toEqual(["detach bullet", "create enemy", "attach enemy>root", "apply enemy@5"])
    expect(nodes()).toMatchObject([{ label: "enemy", x: 5 }])
  })

  it("after a rewind, keeps the node when the same kind is spawned again under the drawn id", () => {
    const { runtime, registry, tick, nodes } = setup("bare")
    const checkpoint = runtime.checkpoint(simulate)
    tick(spawn({ label: "bullet", x: 2 }))
    const [first] = nodes()
    const node = registry.get(first!.id)
    expect(runtime.rewind(checkpoint).ok).toBe(true)
    expect(tick(spawn({ label: "bullet", x: 2 }))).toEqual([])
    expect(registry.get(first!.id)).toBe(node)
  })

  it("makes the node again when a system writes another value, and applies it once", () => {
    const { tick, nodes } = setup()
    tick(spawn({ label: "egg", x: 1 }))
    expect(tick({ _tag: "Relabel", from: "egg", to: "chick" })).toEqual(["detach egg", "create chick", "attach chick>root", "apply chick@1"])
    // A move in the same tick is applied to the new node, once.
    expect(tick({ _tag: "Relabel", from: "chick", to: "hen", x: 4 })).toEqual(["detach chick", "create hen", "attach hen>root", "apply hen@4"])
    expect(nodes()).toMatchObject([{ label: "hen", x: 4 }])
  })

  it("keeps the node when a system writes the value it was made from again", () => {
    const { registry, tick, nodes } = setup()
    tick(spawn({ label: "egg", x: 1 }))
    const node = registry.get(nodes()[0]!.id)
    expect(tick({ _tag: "Relabel", from: "egg", to: "egg" })).toEqual([])
    expect(tick({ _tag: "Relabel", from: "egg", to: "egg", x: 3 })).toEqual(["apply egg@3"])
    expect(registry.get(nodes()[0]!.id)).toBe(node)
  })

  it("compares with the value the node was made from, not the one before the latest write", () => {
    const { registry, tick, nodes } = setup()
    tick(spawn({ label: "egg", x: 1 }))
    const node = registry.get(nodes()[0]!.id)
    // Two writes between draws that end where they started: nothing to make again.
    tick({ _tag: "Curtain", down: true })
    tick({ _tag: "Relabel", from: "egg", to: "chick" })
    tick({ _tag: "Relabel", from: "chick", to: "egg" })
    expect(tick({ _tag: "Curtain", down: false })).toEqual([])
    expect(registry.get(nodes()[0]!.id)).toBe(node)
  })

  it("makes nothing again while its run conditions fail, and catches up after", () => {
    const { tick, nodes } = setup()
    tick(spawn({ label: "egg", x: 1 }))
    expect(tick({ _tag: "Curtain", down: true })).toEqual([])
    expect(tick({ _tag: "Relabel", from: "egg", to: "chick" })).toEqual([])
    expect(nodes()).toMatchObject([{ label: "egg" }])
    expect(tick({ _tag: "Curtain", down: false })).toEqual(["detach egg", "create chick", "attach chick>root", "apply chick@1"])
  })

  it("attaches a remade parent's children under its new node", () => {
    const { registry, tick, nodes } = setup("tree")
    tick(spawn({ label: "tank", x: 10 }, { label: "turret", x: 2, parent: 0 }))
    const [, turret] = nodes()
    const turretNode = registry.get(turret!.id)
    expect(tick({ _tag: "Relabel", from: "tank", to: "wreck" })).toEqual([
      "attach turret>root",
      "detach tank",
      "create wreck",
      "attach wreck>root",
      "apply wreck@10",
      "attach turret>wreck"
    ])
    expect(registry.get(turret!.id)).toBe(turretNode)
    expect(nodes()).toMatchObject([{ label: "wreck", parent: "root" }, { label: "turret", parent: "wreck", x: 2 }])
    expect([...registry.parents]).toEqual([[turret!.id, nodes()[0]!.id]])
  })

  it("attaches a remade child under its parent's node", () => {
    const { tick, nodes } = setup("tree")
    tick(spawn({ label: "tank", x: 10 }, { label: "turret", x: 2, parent: 0 }))
    expect(tick({ _tag: "Relabel", from: "turret", to: "cannon" })).toEqual(["detach turret", "create cannon", "attach cannon>tank", "apply cannon@2"])
    expect(nodes()).toMatchObject([{ label: "tank", parent: "root" }, { label: "cannon", parent: "tank" }])
  })

  it("makes a remade parent and child once each, the child under the parent", () => {
    const { tick, nodes } = setup("tree")
    tick(spawn({ label: "tank", x: 10 }, { label: "turret", x: 2, parent: 0 }))
    tick({ _tag: "Curtain", down: true })
    tick({ _tag: "Relabel", from: "tank", to: "wreck" })
    tick({ _tag: "Relabel", from: "turret", to: "scrap" })
    const drawn = tick({ _tag: "Curtain", down: false })
    expect(drawn.filter((line) => line.startsWith("create"))).toEqual(["create wreck", "create scrap"])
    expect(drawn.filter((line) => line.startsWith("apply"))).toEqual(["apply wreck@10", "apply scrap@2"])
    expect(nodes()).toMatchObject([{ label: "wreck", parent: "root" }, { label: "scrap", parent: "wreck" }])
  })

  it("after a load, destroys and makes the node of an id now holding another renderable once", () => {
    const { runtime, tick, nodes, saveOf } = setup("tree")
    tick(spawn({ label: "ship", x: 4 }, { label: "rock", x: 1 }))
    const save = saveOf(spawn({ label: "ship", x: 4 }, { label: "tree", x: 7 }))
    expect(runtime.restore(save).ok).toBe(true)
    // A load gives every entity a new node: no id is destroyed or made twice.
    const drawn = tick({ _tag: "Idle" })
    expect([...drawn].sort()).toEqual([
      "apply ship@4",
      "apply tree@7",
      "attach ship>root",
      "attach tree>root",
      "create ship",
      "create tree",
      "detach rock",
      "detach ship"
    ])
    expect(nodes()).toMatchObject([{ label: "ship", x: 4 }, { label: "tree", x: 7 }])
  })
})
