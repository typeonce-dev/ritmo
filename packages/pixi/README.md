# `@typeonce/ritmo-pixi`

Pixi's implementation of the renderer-independent `NodeRegistry` contract. `PixiNodeRegistry.make` attaches nodes to one Pixi container, or under their parent entity's node when `RenderSync.system` is given a `hierarchy`, and detaches and destroys them with their children on removal (child entities' nodes are moved back to the container first).

Import the generic `NodeRegistry` contract and `RenderSync` systems from [`@typeonce/ritmo-render`](https://github.com/typeonce-dev/ritmo/blob/main/packages/render/README.md). The Pixi package exports only its adapter; systems depend on the generic registry service, and the host chooses its implementation.

```sh
pnpm add @typeonce/ritmo-pixi @typeonce/ritmo-render @typeonce/ritmo
```

```ts
import { Descriptor } from "@typeonce/ritmo"
import { NodeRegistry, RenderSync } from "@typeonce/ritmo-render"
import { PixiNodeRegistry } from "@typeonce/ritmo-pixi"

const Sprites = Descriptor.Service<NodeRegistry.NodeRegistry<Sprite>>()("Game/Sprites")
// actorLayer is a Pixi Container<Sprite>.
const sprites = PixiNodeRegistry.make(actorLayer)
const services = Game.Runtime.services(Game.Runtime.service(Sprites, sprites))
// Pass Sprites as the registry descriptor to RenderSync.system(Game, ...).
```

With a `hierarchy`, each child's node is added with `(parent ?? container).addChild(node)`, so Pixi composes the child's local position with its parent's. Pixi warns when a leaf (a `Sprite`, a `Graphics`) holds children, so make the parents' nodes `Container`s that hold their sprites. A registry over nodes that cannot hold children does not compile.

Bring your own `pixi.js` application; the package does not import it.

Released together with [`@typeonce/ritmo`](https://github.com/typeonce-dev/ritmo/blob/main/packages/core/README.md), always with the same version.

Source: https://github.com/typeonce-dev/ritmo
