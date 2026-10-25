/**
 * Pixi container implementation of the renderer-independent node registry.
 *
 * Import the registry contract and render systems from `@typeonce/ritmo-render`.
 * Construct this adapter in the host and provide it as a normal runtime service.
 * A node is added to the container, or under its parent entity's node when
 * `RenderSync.system` is given a `hierarchy`, so Pixi composes the
 * transforms. Removing a node detaches it and destroys it with its children
 * (child entities' nodes are moved back to the container first).
 *
 * @module PixiNodeRegistry
 * @docGroup pixi
 *
 * @example
 * ```ts
 * const sprites = PixiNodeRegistry.make(actorLayer)
 * sprites.ensure(match.entity.id, () => new Sprite(texture))
 * sprites.remove(despawnedId)
 * sprites.clear()
 * ```
 */
// oxlint-disable-next-line ritmo/keep-simulation-headless -- this package is the Pixi adapter for the render registry, render code by definition
import * as NodeRegistry from "@typeonce/ritmo-render/NodeRegistry"

/**
 * The container surface the registry needs; Pixi's `Container` satisfies it.
 * `addChild` must take the child out of the container it is in, as Pixi's
 * does.
 */
export interface ContainerLike<Child> {
  addChild(child: Child): unknown
  removeChild(child: Child): unknown
}

/**
 * The node surface the registry needs beside `ContainerLike`; every Pixi
 * display object satisfies it. `destroy` must also take the node out of its
 * parent node, as Pixi's does.
 */
export interface Destroyable {
  destroy(options?: unknown): void
}

/**
 * The container `make` accepts: one whose children are containers too, or a
 * message naming the fix.
 */
export type HoldsChildren<Node> =
  [Node] extends [ContainerLike<Node>]
    ? ContainerLike<Node>
    : "each node must be a container (addChild and removeChild), so it can hold its child entities' nodes"

/**
 * Creates a registry whose nodes are children of one container, or of their
 * parent entity's node, and are destroyed (with their children) when
 * removed. Nodes are containers themselves (`ContainerLike`) so that they can
 * hold child entities' nodes; with a `hierarchy`, make the parents' nodes
 * Pixi `Container`s, since Pixi warns when a leaf (a `Sprite`, a `Graphics`)
 * holds children.
 */
export const make = <Node extends Destroyable>(container: HoldsChildren<Node>): NodeRegistry.NodeRegistry<Node> => {
  // `HoldsChildren` proved that the container and every node hold nodes.
  const root = container as ContainerLike<Node>
  return NodeRegistry.make<Node>({
    attach: (node, parent) => {
      ((parent ?? root) as ContainerLike<Node>).addChild(node)
    },
    detach: (node) => {
      root.removeChild(node)
      node.destroy({ children: true })
    }
  })
}
