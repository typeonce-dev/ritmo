import { Descriptor, Result, Schema } from "@typeonce/ritmo"
import { NodeRegistry, RenderSync, packageTag } from "@typeonce/ritmo-render"
import { describe, expect, it } from "tstyche"

interface Node {
  destroy(): void
  x: number
}

const Position = Descriptor.Component<{ x: number }>()("RenderTypes/Position")
const Sprite = Descriptor.Component<{ label: string }>()("RenderTypes/Sprite")
const Health = Descriptor.Component<number>()("RenderTypes/Health")
const Nodes = Descriptor.Service<NodeRegistry.NodeRegistry<Node>>()("RenderTypes/Nodes")
const Game = Schema.bind(Schema.fragment({ components: { Position, Sprite } }))

describe("@typeonce/ritmo-render", () => {
  it("exposes the package entrypoint type through the workspace", () => {
    expect(packageTag).type.toBe<"render">()
  })

  it("types node callbacks from the descriptors and the registry service", () => {
    const render = RenderSync.system(Game, {
      name: "RenderTypes/Render",
      renderable: Sprite,
      transform: Position,
      registry: Nodes,
      create: ({ renderable }) => {
        expect(renderable).type.toBe<{ readonly label: string }>()
        return { destroy() {}, x: 0 }
      },
      apply: (node, { transform }) => {
        expect(node).type.toBe<Node>()
        node.x = transform.x
      }
    })

    const withRegistry = Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(Nodes, NodeRegistry.make<Node>({ attach() {}, detach() {} })))
    }).success
    expect(withRegistry.tick(Game.Schedule(render))).type.toBe<Result.Result<void, never>>()

    const withoutRegistry = Game.Runtime.make({ services: Game.Runtime.services() }).success
    // @ts-expect-error __runtimeRequirementError__: "Missing service"; readonly __requirement__: "RenderTypes/Nodes"
    withoutRegistry.tick(Game.Schedule(render))
  })

  it("types extra selections and services, and requires the extra services", () => {
    const Scale = Descriptor.Service<{ readonly factor: number }>()("RenderTypes/Scale")
    const render = RenderSync.system(Game, {
      name: "RenderTypes/Extra",
      renderable: Sprite,
      transform: Position,
      registry: Nodes,
      select: { sprite: Game.Query.optional(Sprite) },
      services: { scale: Scale },
      create: ({ data, services }) => {
        expect(services.scale.factor).type.toBe<number>()
        if (data.sprite.present) expect(data.sprite.get()).type.toBe<{ readonly label: string }>()
        return { destroy() {}, x: 0 }
      },
      apply: (node, { transform, services }) => {
        node.x = transform.x * services.scale.factor
      }
    })

    const withoutScale = Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(Nodes, NodeRegistry.make<Node>({ attach() {}, detach() {} })))
    }).success
    // @ts-expect-error __runtimeRequirementError__: "Missing service"; readonly __requirement__: "RenderTypes/Scale"
    withoutScale.tick(Game.Schedule(render))
  })

  it("types resources as read cells and only accepts schema resources", () => {
    const Zoom = Descriptor.Resource<number>()("RenderTypes/Zoom")
    const Other = Descriptor.Resource<number>()("RenderTypes/Other")
    const Zoomed = Schema.bind(Schema.fragment({ components: { Position, Sprite }, resources: { Zoom } }))
    RenderSync.system(Zoomed, {
      name: "RenderTypes/Zoom",
      renderable: Sprite,
      transform: Position,
      registry: Nodes,
      resources: { zoom: Zoom },
      create: ({ resources }) => {
        expect(resources.zoom.get()).type.toBe<number>()
        return { destroy() {}, x: 0 }
      },
      apply: (node, { transform, resources }) => {
        node.x = transform.x * resources.zoom.get()
      }
    })

    RenderSync.system(Zoomed, {
      name: "RenderTypes/Unknown",
      renderable: Sprite,
      transform: Position,
      registry: Nodes,
      // @ts-expect-error Type '"RenderTypes/Other"' is not assignable to type '"RenderTypes/Zoom"'.
      resources: { other: Other },
      create: () => ({ destroy() {}, x: 0 }),
      apply: () => {}
    })
  })

  it("only accepts read-only extra slots", () => {
    RenderSync.system(Game, {
      name: "RenderTypes/WriteSlot",
      renderable: Sprite,
      transform: Position,
      registry: Nodes,
      // @ts-expect-error Type '"write"' is not assignable to type '"optional"'.
      select: { position: Game.Query.write(Position) },
      create: () => ({ destroy() {}, x: 0 }),
      apply: () => {}
    })
  })

  it("only accepts schema components in redrawOn", () => {
    RenderSync.system(Game, {
      name: "RenderTypes/Redraw",
      renderable: Sprite,
      transform: Position,
      registry: Nodes,
      redrawOn: [Sprite],
      create: () => ({ destroy() {}, x: 0 }),
      apply: () => {}
    })
    RenderSync.system(Game, {
      name: "RenderTypes/RedrawInvalid",
      renderable: Sprite,
      transform: Position,
      registry: Nodes,
      // @ts-expect-error Type '"RenderTypes/Health"' is not assignable to type '"RenderTypes/Position"'.
      redrawOn: [Health],
      create: () => ({ destroy() {}, x: 0 }),
      apply: () => {}
    })
  })

  it("only accepts components registered in the bound schema", () => {
    RenderSync.system(Game, {
      name: "RenderTypes/Invalid",
      // @ts-expect-error Type '"RenderTypes/Health"' is not assignable to type '"RenderTypes/Position"'.
      renderable: Health,
      transform: Position,
      registry: Nodes,
      create: () => ({ destroy() {}, x: 0 }),
      apply: () => {}
    })
  })

  it("makes the transform optional: callbacks then see `transform: undefined`", () => {
    const render = RenderSync.system(Game, {
      name: "RenderTypes/NoTransform",
      renderable: Sprite,
      registry: Nodes,
      create: ({ transform }) => {
        expect(transform).type.toBe<undefined>()
        return { destroy() {}, x: 0 }
      },
      apply: () => {}
    })
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(Nodes, NodeRegistry.make<Node>({ attach() {}, detach() {} })))
    }).success
    expect(runtime.tick(Game.Schedule(render))._tag).type.toBe<"Success" | "Failure">()
  })

  it("types interpolate: planar components, a clock with alpha, and required services", () => {
    const Planar = Descriptor.Component<{ x: number; y: number }>()("RenderTypes/Planar")
    const Previous = Descriptor.Component<{ x: number; y: number }>()("RenderTypes/Previous")
    const Clock = Descriptor.Service<{ readonly alpha: number }>()("RenderTypes/Clock")
    const NoAlpha = Descriptor.Service<{ readonly now: number }>()("RenderTypes/NoAlpha")
    const Planet = Schema.bind(Schema.fragment({ components: { Planar, Previous, Position, Health } }))

    const interpolate = RenderSync.interpolate(Planet, {
      name: "RenderTypes/Interpolate",
      registry: Nodes,
      previous: Previous,
      current: Planar,
      clock: Clock,
      place: (node, position) => {
        expect(node).type.toBe<Node>()
        expect(position).type.toBe<RenderSync.Planar>()
      }
    })

    const withoutClock = Planet.Runtime.make({
      services: Planet.Runtime.services(Planet.Runtime.service(Nodes, NodeRegistry.make<Node>({ attach() {}, detach() {} })))
    }).success
    // @ts-expect-error __runtimeRequirementError__: "Missing service"; readonly __requirement__: "RenderTypes/Clock"
    withoutClock.tick(Planet.Schedule(interpolate))

    // Not a 2D position: the default blend does not apply.
    // @ts-expect-error Property 'blend' is missing
    RenderSync.interpolate(Planet, {
      name: "RenderTypes/NotPlanar",
      registry: Nodes,
      previous: Health,
      current: Planar,
      clock: Clock,
      place: () => {}
    })

    RenderSync.interpolate(Planet, {
      name: "RenderTypes/NoAlpha",
      registry: Nodes,
      previous: Previous,
      current: Planar,
      // @ts-expect-error Type 'Descriptor<"service", "RenderTypes/NoAlpha", { readonly now: number; }>' is not assignable to type '"The
      clock: NoAlpha,
      place: () => {}
    })
  })

  it("types interpolate with blend: any values, and place receives what blend returns", () => {
    const Spatial = Descriptor.Component<{ x: number; y: number; z: number }>()("RenderTypes/Spatial")
    const PreviousSpatial = Descriptor.Component<{ x: number; y: number; z: number }>()("RenderTypes/PreviousSpatial")
    const Labeled = Descriptor.Component<{ x: number; y: number; label: string }>()("RenderTypes/Labeled")
    const Clock = Descriptor.Service<{ readonly alpha: number }>()("RenderTypes/Clock")
    const Space = Schema.bind(Schema.fragment({ components: { Spatial, PreviousSpatial, Labeled, Health } }))

    RenderSync.interpolate(Space, {
      name: "RenderTypes/Interpolate3D",
      registry: Nodes,
      previous: PreviousSpatial,
      current: Spatial,
      clock: Clock,
      blend: (from, to, alpha) => {
        expect(from).type.toBe<{ x: number; y: number; z: number }>()
        expect(alpha).type.toBe<number>()
        return { x: from.x + (to.x - from.x) * alpha, y: from.y + (to.y - from.y) * alpha, z: from.z + (to.z - from.z) * alpha }
      },
      place: (_node, position) => {
        expect(position).type.toBe<{ x: number; y: number; z: number }>()
      }
    })

    RenderSync.interpolate(Space, {
      name: "RenderTypes/InterpolateHealth",
      registry: Nodes,
      previous: Health,
      current: Health,
      clock: Clock,
      blend: (from, to, alpha) => from + (to - from) * alpha,
      place: (_node, health) => {
        expect(health).type.toBe<number>()
      }
    })

    // Non-numeric extra fields are not blended, so the default still applies.
    RenderSync.interpolate(Space, {
      name: "RenderTypes/InterpolateLabeled",
      registry: Nodes,
      previous: Labeled,
      current: Labeled,
      clock: Clock,
      place: (_node, position) => {
        expect(position).type.toBe<RenderSync.Planar>()
      }
    })

    // The default blend would drop z.
    // @ts-expect-error Property 'blend' is missing
    RenderSync.interpolate(Space, {
      name: "RenderTypes/DroppedZ",
      registry: Nodes,
      previous: PreviousSpatial,
      current: Spatial,
      clock: Clock,
      place: () => {}
    })
  })
})
