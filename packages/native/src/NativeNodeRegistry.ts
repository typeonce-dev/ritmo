/** Renderer registry that releases native nodes when their entity disappears. */
import { NodeRegistry } from "@typeonce/ritmo-render"
import type { Layer, Node } from "./NativeGfx.ts"
/** Detached nodes are attached to this layer, then destroyed on removal. */
export const make = (layer: Layer): NodeRegistry.NodeRegistry<Node> => NodeRegistry.make({
  attach: (node) => layer.addChild(node),
  detach: (node) => { layer.removeChild(node); node.destroy() }
})
