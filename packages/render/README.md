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
      attach: (mesh, parent) => (parent ?? scene).add(mesh),
      detach: (mesh) => mesh.removeFromParent()
    }))
  )
}).value
```

`attach` receives the node to add and the node to add it under (`undefined` for the root). It is also called to move an attached node to another parent, so it must take the node out of the parent it is in, as Three.js's `add` and Pixi's `addChild` do. Declare both parameters: a one-parameter `attach` still compiles but puts every node on the root.

## Hierarchies

A part that moves with its entity (a turret on a tank, a name over a head) is a child entity in a `Descriptor.Hierarchy`. Pass the hierarchy to `RenderSync.system` and each child's node is attached under its parent's node, so the renderer composes the transforms:

```ts
const { relation: Attached } = Descriptor.Hierarchy("Game/Attached", "Game/Attachments")

const Render = RenderSync.system(Game, {
  name: "Game/Render",
  renderable: Renderable,
  transform: Position, // a child's Position is relative to its parent
  registry: Meshes,
  hierarchy: Attached,
  create: ({ renderable }) => new Mesh(geometry, materials[renderable.material]),
  apply: (mesh, { transform }) => mesh.position.set(transform.x, 0, transform.y)
})
```

- `apply` receives the child's own components: its transform is local to the parent's node. Ritmo does no world-transform math.
- A child whose parent has no node in the registry sits at the root, and moves under the parent's node when the parent gets one. Only the direct parent counts.
- A child's node moves when its parent changes (`commands.relate`) or is removed (`commands.unrelate`), in the same run.
- Despawning a parent despawns its children, so their nodes are destroyed with it. A parent that only loses its renderable hands its children's nodes back to the root.
- A plain `Descriptor.Relation` does not compile as `hierarchy`.
- Each run checks every renderable entity that has a parent, so the cost grows with the number of children. A game without `hierarchy` pays nothing.

The registry keeps the tree: `ensure(entity, create, parent)` creates a node under a parent's node, `reparent(entity, parent)` moves one, and `parents` maps each nested node's entity to its parent's. Removing a parent's node first moves the nodes under it back to the root, so an entity's node is destroyed only when that entity's is removed.

For Pixi, [`@typeonce/ritmo-pixi`](https://github.com/typeonce-dev/ritmo/blob/main/packages/pixi/README.md) provides `PixiNodeRegistry.make(container)`, an implementation of the same registry contract. The host provides it with `Game.Runtime.service`; render systems keep depending on the generic service descriptor.

Released together with [`@typeonce/ritmo`](https://github.com/typeonce-dev/ritmo/blob/main/packages/core/README.md), always with the same version.

Source: https://github.com/typeonce-dev/ritmo
