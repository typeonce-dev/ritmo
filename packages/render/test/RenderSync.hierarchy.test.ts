import { describe, expect, it } from "vitest"

import { Descriptor, Schema } from "@typeonce/ritmo"
import type * as Entity from "@typeonce/ritmo/Entity"
import { NodeRegistry, RenderSync } from "@typeonce/ritmo-render"

// A node that records where it is attached, like a scene graph would.
class FakeNode {
  readonly label: string
  parent: FakeNode | "root" | undefined = undefined
  x = 0
  destroyed = false
  constructor(label: string) {
    this.label = label
  }
}

const where = (node: FakeNode | undefined): string | undefined =>
  node === undefined ? undefined : node.parent === "root" ? "root" : node.parent?.label

const Position = Descriptor.Component<{ x: number }>()("Hierarchy/Position")
const Body = Descriptor.Component<{ label: string }>()("Hierarchy/Body")
const Heavy = Descriptor.Component<{}>()("Hierarchy/Heavy")
const { relation: Attached } = Descriptor.Hierarchy("Hierarchy/Attached", "Hierarchy/Attachments")
const Nodes = Descriptor.Service<NodeRegistry.NodeRegistry<FakeNode>>()("Hierarchy/Nodes")

const Game = Schema.bind(Schema.fragment({ components: { Position, Body, Heavy }, relations: { Attached } }))
type Id = Entity.EntityId<typeof Game.schema, typeof Game.schema>

// The edits a test makes in one frame; each spawned entity's x is its label's length.
interface Edit {
  spawn(label: string, parent?: Id, heavy?: boolean): Id
  /** An entity without a body: no node. */
  bare(): Id
  relate(child: Id, parent: Id): void
  unrelate(child: Id): void
  removeBody(entity: Id): void
  insertBody(entity: Id, label: string): void
  despawn(entity: Id): void
}

const setup = () => {
  const attaches: Array<string> = []
  const detaches: Array<string> = []
  const registry = NodeRegistry.make<FakeNode>({
    attach: (node, parent) => {
      node.parent = parent ?? "root"
      attaches.push(`${node.label}>${parent?.label ?? "root"}`)
    },
    detach: (node) => {
      node.parent = undefined
      node.destroyed = true
      detaches.push(node.label)
    }
  })
  const render = RenderSync.system(Game, {
    name: "Hierarchy/Render",
    renderable: Body,
    transform: Position,
    registry: Nodes,
    hierarchy: Attached,
    create: ({ renderable }) => new FakeNode(renderable.label),
    apply: (node, { transform }) => {
      node.x = transform.x
    }
  })

  // One system that runs the test's edits for this frame.
  let queued: (edit: Edit) => void = () => {}
  const editor = Game.System("Hierarchy/Edit", {
    queries: { bodies: Game.Query({ selection: { body: Game.Query.read(Body) } }) },
    commands: Game.System.commands(
      Game.System.spawns(Position, Body, Heavy),
      Game.System.inserts(Body),
      Game.System.removes(Body),
      Game.System.despawns(Body),
      Game.System.relates(Attached)
    )
  }, ({ queries, commands }) => {
    queued({
      spawn: (label, parent, heavy = false) => {
        const draft = heavy
          ? Game.Command.spawn([Position, { x: label.length }], [Body, { label }], [Heavy, {}])
          : Game.Command.spawn([Position, { x: label.length }], [Body, { label }])
        return commands.spawn(parent === undefined ? draft : Game.Command.relate(draft, Attached, parent))
      },
      relate: (child, parent) => commands.relate(child, Attached, parent),
      unrelate: (child) => commands.unrelate(child, Attached),
      bare: () => commands.spawn(Game.Command.spawn([Position, { x: 0 }])),
      removeBody: (entity) => {
        const match = queries.bodies.get(entity)
        if (match.ok) commands.remove(match.value.entity, Body)
      },
      insertBody: (entity, label) => commands.insert(entity, [Body, { label }]),
      despawn: (entity) => {
        const match = queries.bodies.get(entity)
        if (match.ok) commands.despawn(match.value.entity)
      }
    })
    queued = () => {}
  })

  const runtime = Game.Runtime.make({ services: Game.Runtime.services(Game.Runtime.service(Nodes, registry)) }).value
  const frame = (run: (edit: Edit) => void = () => {}) => {
    queued = run
    runtime.tick(Game.Schedule(editor, Game.Schedule.applyDeferred(), render))
  }
  return { registry, attaches, detaches, frame }
}

describe("RenderSync hierarchy", () => {
  it("attaches a child created with its parent under the parent's node, once", () => {
    const { registry, attaches, frame } = setup()
    const ids: Array<Id> = []
    frame((edit) => {
      const tank = edit.spawn("tank")
      ids.push(tank, edit.spawn("turret", tank))
    })
    const [tank, turret] = ids as [Id, Id]

    expect(where(registry.get(tank))).toBe("root")
    expect(where(registry.get(turret))).toBe("tank")
    // apply gets the child's own (local) transform.
    expect(registry.get(turret)?.x).toBe(6)
    expect(attaches).toEqual(["tank>root", "turret>tank"])
    expect([...registry.parents]).toEqual([[turret, tank]])
  })

  it("moves a child met before its parent under the parent's node in the same run", () => {
    const { registry, attaches, frame } = setup()
    const ids: Array<Id> = []
    frame((edit) => {
      ids.push(edit.bare(), edit.bare())
    })
    const [turret, tank] = ids as [Id, Id]
    // The turret gets its body first, so it is synced before the tank.
    frame((edit) => {
      edit.insertBody(turret, "turret")
      edit.insertBody(tank, "tank")
      edit.relate(turret, tank)
    })

    expect(where(registry.get(turret))).toBe("tank")
    expect(attaches).toEqual(["turret>root", "tank>root", "turret>tank"])
  })

  it("moves a child's node when its parent changes or is removed", () => {
    const { registry, attaches, frame } = setup()
    const ids: Array<Id> = []
    frame((edit) => {
      const a = edit.spawn("a")
      ids.push(a, edit.spawn("b"), edit.spawn("child", a))
    })
    const [, b, child] = ids as [Id, Id, Id]
    expect(where(registry.get(child))).toBe("a")

    frame((edit) => edit.relate(child, b))
    expect(where(registry.get(child))).toBe("b")

    frame((edit) => edit.unrelate(child))
    expect(where(registry.get(child))).toBe("root")
    expect(registry.parents.size).toBe(0)

    // Nothing changed: no move.
    frame()
    expect(attaches).toEqual(["a>root", "b>root", "child>a", "child>b", "child>root"])
  })

  it("hands a child's node to the root while its parent has no node, and back when it gets one", () => {
    const { registry, detaches, frame } = setup()
    const ids: Array<Id> = []
    frame((edit) => {
      const tank = edit.spawn("tank")
      ids.push(tank, edit.spawn("turret", tank))
    })
    const [tank, turret] = ids as [Id, Id]
    const turretNode = registry.get(turret)

    frame((edit) => edit.removeBody(tank))
    expect(registry.get(tank)).toBeUndefined()
    expect(detaches).toEqual(["tank"])
    expect(registry.get(turret)).toBe(turretNode)
    expect(turretNode?.destroyed).toBe(false)
    expect(where(turretNode)).toBe("root")

    frame((edit) => edit.insertBody(tank, "tank2"))
    expect(where(turretNode)).toBe("tank2")
  })

  it("destroys a despawned parent's children with it", () => {
    const { registry, detaches, frame } = setup()
    const ids: Array<Id> = []
    frame((edit) => {
      const tank = edit.spawn("tank")
      const turret = edit.spawn("turret", tank)
      ids.push(tank, turret, edit.spawn("gun", turret))
    })
    frame((edit) => edit.despawn(ids[0]!))

    expect(registry.size).toBe(0)
    expect(registry.parents.size).toBe(0)
    expect([...detaches].sort()).toEqual(["gun", "tank", "turret"])
  })

  it("never moves a node under one that is still inside it", () => {
    const { registry, frame } = setup()
    const ids: Array<Id> = []
    frame((edit) => {
      const a = edit.spawn("a")
      ids.push(a, edit.spawn("b", a))
    })
    const [a, b] = ids as [Id, Id]
    // Swap: b becomes the parent of a.
    frame((edit) => {
      edit.unrelate(b)
      edit.relate(a, b)
    })

    expect(where(registry.get(b))).toBe("root")
    expect(where(registry.get(a))).toBe("b")
  })

  it("moves parents before their children when several nodes move in one run", () => {
    const { registry, frame } = setup()
    const ids: Array<Id> = []
    frame((edit) => {
      const x = edit.spawn("x")
      ids.push(x, edit.spawn("p", x), edit.spawn("q"))
    })
    const [x, p, q] = ids as [Id, Id, Id]
    // From x > p to q > p > x: x is synced first, but p must move out of x before x moves under p.
    frame((edit) => {
      edit.relate(p, q)
      edit.relate(x, p)
    })

    expect(where(registry.get(q))).toBe("root")
    expect(where(registry.get(p))).toBe("q")
    expect(where(registry.get(x))).toBe("p")
  })
})

describe("NodeRegistry tree", () => {
  const make = () => {
    const log: Array<string> = []
    const registry = NodeRegistry.make<FakeNode>({
      attach: (node, parent) => {
        node.parent = parent ?? "root"
        log.push(`attach ${node.label}>${parent?.label ?? "root"}`)
      },
      detach: (node) => {
        node.destroyed = true
        log.push(`detach ${node.label}`)
      }
    })
    return { registry, log }
  }

  it("attaches under a parent only when it has a node", () => {
    const { registry, log } = make()
    registry.ensure(1, () => new FakeNode("orphan"), 9)
    registry.ensure(2, () => new FakeNode("parent"))
    registry.ensure(3, () => new FakeNode("child"), 2)
    expect(log).toEqual(["attach orphan>root", "attach parent>root", "attach child>parent"])
    expect([...registry.parents]).toEqual([[3, 2]])
  })

  it("refuses a move that would put a node inside itself", () => {
    const { registry } = make()
    registry.ensure(1, () => new FakeNode("a"))
    registry.ensure(2, () => new FakeNode("b"), 1)
    expect(registry.reparent(1, 2)).toBe(false)
    expect(registry.reparent(1, 1)).toBe(false)
    expect(registry.reparent(5, 1)).toBe(false)
    expect([...registry.parents]).toEqual([[2, 1]])
  })

  it("moves a removed node's children to the root, and clears children before parents", () => {
    const { registry, log } = make()
    registry.ensure(1, () => new FakeNode("a"))
    registry.ensure(2, () => new FakeNode("b"), 1)
    registry.ensure(3, () => new FakeNode("c"), 2)
    registry.remove(2)
    expect(log.slice(3)).toEqual(["attach c>root", "detach b"])
    registry.reparent(3, 1)
    log.length = 0
    registry.clear()
    expect(log).toEqual(["detach c", "detach a"])
    expect(registry.parents.size).toBe(0)
  })
})
