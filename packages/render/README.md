# `@typeonce/ritmo-render`

Renderer-agnostic entity-to-node mirroring for ritmo: a render-node registry keyed by entity (`NodeRegistry`), a system that creates, updates, and destroys renderer nodes from ECS entities (`RenderSync.system`), and a system that draws fixed-step movement smoothly between steps (`RenderSync.interpolate`).

```sh
pnpm add @typeonce/ritmo-render @typeonce/ritmo
```

The package imports no renderer. You say what attaching and releasing a node means, and what a node looks like; it owns the bookkeeping (one node per entity, created, re-applied, and destroyed in step with the world). For example with Three.js:

```ts
import { Descriptor } from "@typeonce/ritmo"
import { NodeRegistry, RenderSync } from "@typeonce/ritmo-render"

const Meshes = Descriptor.Service<NodeRegistry.NodeRegistry<Mesh>>()("Game/Meshes")

const Render = RenderSync.system(Game, {
  name: "Game/Render",
  renderable: Renderable,
  transform: Position,
  registry: Meshes,
  create: ({ renderable }) => new Mesh(geometry, materials[renderable.material]),
  apply: (mesh, { transform }) => mesh.position.set(transform.x, 0, transform.y)
})

const runtime = Game.Runtime.make({
  services: Game.Runtime.services(
    Game.Runtime.service(Meshes, NodeRegistry.make<Mesh>({
      attach: (mesh) => scene.add(mesh),
      detach: (mesh) => scene.remove(mesh)
    }))
  )
}).success
```

For Pixi, [`@typeonce/ritmo-pixi`](https://github.com/typeonce-dev/ritmo/blob/main/packages/pixi/README.md) provides `PixiNodeRegistry.make(container)`, an implementation of the same registry contract. The host provides it with `Game.Runtime.service`; render systems keep depending on the generic service descriptor.

Released together with [`@typeonce/ritmo`](https://github.com/typeonce-dev/ritmo/blob/main/packages/core/README.md), always with the same version.

Source: https://github.com/typeonce-dev/ritmo
