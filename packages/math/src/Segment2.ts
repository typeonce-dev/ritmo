/**
 * Plain line segments stored by their ends, for hot-path collision against
 * walls that are not axis-aligned (a map traced from survey data, a slanted
 * fence, a polygon's edges).
 *
 * Like `Box2`, it is the plain form the collision helpers (`Collide2`) read
 * every frame, built once from whatever the game stores. A wall is
 * two-sided: a circle is kept off it on both sides and around both ends.
 *
 * @example
 * ```ts
 * declare const position: Vec2.Vec2, delta: Vec2.Vec2
 * declare const radius: number
 * // ---cut---
 * const fence = Segment2.between({ x: 0, y: 0 }, { x: 40, y: 30 })
 * const moved = Collide2.moveCircle(position, delta, radius, { segments: [fence] })
 * ```
 *
 * @module Segment2
 * @docGroup helpers
 *
 * @categoryDescription Segment Types
 * The structural segment shape.
 *
 * @categoryDescription Operations
 * Building segments and measuring them against points and circles.
 */
import type { Vec2 } from "./Vec2.ts"

/**
 * The segment from (`ax`, `ay`) to (`bx`, `by`). Both ends may be the same
 * point, which is then a round post.
 *
 * @category Segment Types
 */
export interface Segment2 {
  readonly ax: number
  readonly ay: number
  readonly bx: number
  readonly by: number
}

/**
 * The segment from `a` to `b`.
 *
 * @category Operations
 */
export const between = (a: Vec2, b: Vec2): Segment2 => ({ ax: a.x, ay: a.y, bx: b.x, by: b.y })

/**
 * The point of the segment nearest to `point`.
 *
 * @category Operations
 */
export const closestPoint = (segment: Segment2, point: Vec2): Vec2 => {
  const ex = segment.bx - segment.ax
  const ey = segment.by - segment.ay
  const lengthSquared = ex * ex + ey * ey
  if (lengthSquared < 1e-12) return { x: segment.ax, y: segment.ay }
  const along = Math.max(0, Math.min(1, ((point.x - segment.ax) * ex + (point.y - segment.ay) * ey) / lengthSquared))
  return { x: segment.ax + ex * along, y: segment.ay + ey * along }
}

/**
 * Whether a circle overlaps (or touches) the segment.
 *
 * @category Operations
 */
export const overlapsCircle = (segment: Segment2, center: Vec2, radius: number): boolean => {
  const nearest = closestPoint(segment, center)
  const dx = center.x - nearest.x
  const dy = center.y - nearest.y
  return dx * dx + dy * dy <= radius * radius
}
