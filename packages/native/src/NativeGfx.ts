/** Native retained 2D scene contracts. Games create the drawing; SDL presents it. */
export interface Texture { readonly id: number; readonly width: number; readonly height: number; destroy(): void }
export interface Frame { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface Node {
  x: number; y: number; width: number; height: number
  scaleX: number; scaleY: number; rotation: number
  anchorX: number; anchorY: number; tint: number; alpha: number; visible: boolean
  text: string
  frame: Frame | undefined
  destroy(): void
}
export interface Layer {
  x: number; y: number
  /** Creates a detached rectangle; attach with addChild or NativeNodeRegistry. */
  rect(width: number, height: number, color: number): Node
  /** Creates a detached sprite; textures live until explicitly destroyed. */
  sprite(texture: Texture): Node
  /** Creates detached debug text, using SDL's built-in font. */
  text(value: string, color?: number): Node
  addChild(node: Node): void
  removeChild(node: Node): void
  destroy(): void
}
export interface Gfx {
  readonly width: number; readonly height: number
  readonly safeArea: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
  background: number
  /** Layers draw in creation order, children in attachment order. */
  layer(name: string): Layer
  /** Loads a PNG relative to the packaged assets directory. */
  texture(path: string): Texture
}
