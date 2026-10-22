import { Descriptor, Result, Schema } from "@typeonce/ritmo"
import { NodeRegistry, RenderSync } from "@typeonce/ritmo-render"
import * as Pixi from "@typeonce/ritmo-pixi"
import { PixiNodeRegistry, packageTag } from "@typeonce/ritmo-pixi"
import { Container, Graphics } from "pixi.js"
import { describe, expect, it } from "tstyche"

interface Node {
  destroy(): void
  x: number
}

describe("@typeonce/ritmo-pixi", () => {
  it("exposes the package entrypoint type through the workspace", () => {
    expect(packageTag).type.toBe<"pixi">()
    expect<keyof typeof Pixi>().type.toBe<"PixiNodeRegistry" | "packageTag">()
  })

  it("infers the generic registry contract from the container's children", () => {
    const layer = { addChild(_child: Node) {}, removeChild(_child: Node) {} }
    expect(PixiNodeRegistry.make(layer)).type.toBe<NodeRegistry.NodeRegistry<Node>>()
    expect(PixiNodeRegistry.make).type.not.toBeCallableWith({ addChild(_child: { x: number }) {}, removeChild(_child: { x: number }) {} })
    expect(PixiNodeRegistry.make(new Container<Graphics>())).type.toBe<NodeRegistry.NodeRegistry<Graphics>>()
  })

  it("provides the generic render service without casts or adapter-specific system types", () => {
    const Position = Descriptor.Component<{ x: number }>()("PixiTypes/Position")
    const Sprite = Descriptor.Component<{ label: string }>()("PixiTypes/Sprite")
    const Nodes = Descriptor.Service<NodeRegistry.NodeRegistry<Node>>()("PixiTypes/Nodes")
    const Game = Schema.bind(Schema.fragment({ components: { Position, Sprite } }))
    const render = RenderSync.system(Game, {
      name: "PixiTypes/Render",
      renderable: Sprite,
      transform: Position,
      registry: Nodes,
      create: () => ({ destroy() {}, x: 0 }),
      apply: (node, { transform }) => { node.x = transform.x }
    })
    const layer = { addChild(_child: Node) {}, removeChild(_child: Node) {} }
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(Nodes, PixiNodeRegistry.make(layer)))
    }).success
    expect(runtime.tick(Game.Schedule(render))).type.toBe<Result.Result<void, never>>()

    const missing = Game.Runtime.make({ services: Game.Runtime.services() }).success
    // @ts-expect-error __runtimeRequirementError__: "Missing service"; readonly __requirement__: "PixiTypes/Nodes"
    missing.tick(Game.Schedule(render))
  })
})
