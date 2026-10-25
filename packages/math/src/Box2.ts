/**
 * Plain axis-aligned boxes stored by their edges, for hot-path collision.
 *
 * `Box2` is the edge form the collision helpers (`Collide2`, `FlowField`)
 * read every frame, built once from whatever the game stores (a center and a
 * size, a tile's corner).
 *
 * @example
 * ```ts
 * const wall = Box2.around(x, y, width / 2, height / 2)
 * if (Box2.overlapsCircle(wall, position, radius)) push(position)
 * ```
 *
 * @module Box2
 * @docGroup helpers
 *
 * @categoryDescription Box Types
 * The structural box shape.
 *
 * @categoryDescription Operations
 * Building boxes, testing them against circles, and the closest point.
 */
import type { Vec2 } from "./Vec2.ts"

/**
 * An axis-aligned box from (`minX`, `minY`) to (`maxX`, `maxY`), with
 * `minX <= maxX` and `minY <= maxY`.
 *
 * @category Box Types
 */
export interface Box2 {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/**
 * The box centered on (`x`, `y`) reaching `halfWidth` and `halfHeight` from
 * it (both non-negative).
 *
 * @category Operations
 */
export const around = (x: number, y: number, halfWidth: number, halfHeight: number): Box2 => ({
  minX: x - halfWidth,
  minY: y - halfHeight,
  maxX: x + halfWidth,
  maxY: y + halfHeight
})

/**
 * Whether a circle overlaps (or touches) the box. For two circles use
 * `Collide2.overlapsCircleCircle`, for a wall at any angle
 * `Segment2.overlapsCircle`.
 *
 * @category Operations
 */
export const overlapsCircle = (box: Box2, center: Vec2, radius: number): boolean => {
  const dx = center.x - Math.max(box.minX, Math.min(center.x, box.maxX))
  const dy = center.y - Math.max(box.minY, Math.min(center.y, box.maxY))
  return dx * dx + dy * dy <= radius * radius
}

/**
 * The point of `box` closest to `point`: `point` clamped to the box's edges.
 * A point inside the box comes back unchanged, so this keeps a body inside an
 * arena, or gives the direction from an obstacle to a body outside it
 * (`Vec2.subtract(body, closestPoint(box, body))`). To push a circle out of
 * walls it overlaps, use `Collide2.pushOut`.
 *
 * @category Operations
 */
export const closestPoint = (box: Box2, point: Vec2): Vec2 => ({
  x: Math.max(box.minX, Math.min(point.x, box.maxX)),
  y: Math.max(box.minY, Math.min(point.y, box.maxY))
})
