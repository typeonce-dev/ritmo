---
"@typeonce/ritmo-render": minor
"@typeonce/ritmo-pixi": minor
---

**Child entities' nodes attach under their parent's node.** `RenderSync.system(Game, { ..., hierarchy: Attached })` takes a `Descriptor.Hierarchy` of the game: a child's node is added under its parent's node instead of the root, so the renderer composes the transforms and `apply` sets the child's local transform. A child moves when its parent changes, is removed, or gains or loses its node, in the same run; parents move before their children. Despawning a parent despawns its children, so their nodes go with it. A parent that only loses its renderable hands its children's nodes back to the root.

```ts
const { relation: Attached } = Descriptor.Hierarchy("Game/Attached", "Game/Attachments")
const Render = RenderSync.system(Game, { name: "Game/Render", renderable: Body, transform: Position, registry: Sprites, hierarchy: Attached, create, apply })
```

- A `Descriptor.Relation` as `hierarchy` does not compile (`hierarchy must be a Descriptor.Hierarchy relation`), and neither does a relation missing from the schema (`hierarchy must be a relation of the game's schema`).
- `NodeRegistry` keeps the node tree: `ensure(entity, create, parent?)` creates a node under a parent's node, `reparent(entity, parent)` moves one (and refuses a loop), and `parents` maps each nested node's entity to its parent's. `remove` moves a removed node's children back to the root before detaching it, and `clear` detaches children before their parents.
- `PixiNodeRegistry.make(container)` adds a node with `(parent ?? container).addChild(node)`. Its nodes must be able to hold children (`addChild` and `removeChild`, as every Pixi display object has); otherwise it does not compile (`each node must be a container`).
- **Breaking: `RegistryOptions.attach` receives the parent node**, `(node, parent: Node | undefined)`, `undefined` meaning the root, and is also called to move an attached node, so it must take the node out of its current parent. A one-parameter `attach` still compiles but puts every node on the root, so a game passing `hierarchy` sees children unattached. Update a custom registry:

  ```diff
   NodeRegistry.make<Mesh>({
  -  attach: (mesh) => scene.add(mesh),
  -  detach: (mesh) => scene.remove(mesh)
  +  attach: (mesh, parent) => (parent ?? scene).add(mesh),
  +  detach: (mesh) => mesh.removeFromParent()
   })
  ```

- **Breaking: a hand-written `NodeRegistry<Node>` object needs `reparent` and `parents`**, and `ensure` takes an optional `parent`. Build registries with `NodeRegistry.make` instead of implementing the interface.
- **Breaking: `PixiNodeRegistry.make`'s nodes must have `addChild` and `removeChild`.** Pixi display objects already do; a test double adds the two methods.
