/**
 * Plain two-dimensional vector arithmetic for hot paths.
 *
 * `Vector2` validates values at a boundary (authored data, saves, components);
 * `Vec2` is the arithmetic that runs every frame on numbers already known to
 * be sane. Values are immutable `{ x, y }` records and every helper returns a
 * new one. A branded `Vector2` is a `Vec2`, so validated values flow into
 * these helpers without conversion.
 *
 * @example
 * ```ts
 * // Steer toward a target at a capped speed.
 * const wanted = Vec2.scale(Vec2.normalizeOr(Vec2.subtract(target, position), Vec2.zero), speed)
 * const velocity = Vec2.clampLength(Vec2.add(current, wanted), maxSpeed)
 * ```
 *
 * @module Vec2
 * @docGroup helpers
 *
 * @categoryDescription Vector Types
 * The structural vector shape these helpers read and return.
 *
 * @categoryDescription Operations
 * Immutable arithmetic, measurement, and steering helpers.
 */

import * as Ops from "@typeonce/ritmo/Ops"

/**
 * A two-dimensional vector in world units.
 *
 * @category Vector Types
 */
export interface Vec2 {
  readonly x: number
  readonly y: number
}

/**
 * The zero vector (frozen, safe to share).
 *
 * @category Operations
 */
export const zero: Vec2 = Object.freeze({ x: 0, y: 0 })

/**
 * Component-wise sum.
 *
 * @category Operations
 */
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })

/**
 * Component-wise difference `a - b`.
 *
 * @category Operations
 */
export const subtract = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })

/**
 * `a` multiplied by `factor`.
 *
 * @category Operations
 */
export const scale = (a: Vec2, factor: number): Vec2 => ({ x: a.x * factor, y: a.y * factor })

/**
 * `a` turned by `angle` radians (counter-clockwise for a y-up frame).
 *
 * @category Operations
 */
export const rotate = (a: Vec2, angle: number): Vec2 => {
  const cos = Ops.cos(angle)
  const sin = Ops.sin(angle)
  return { x: a.x * cos - a.y * sin, y: a.x * sin + a.y * cos }
}

/**
 * Dot product.
 *
 * @category Operations
 */
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y

/**
 * Length of `a`.
 *
 * @category Operations
 */
export const length = (a: Vec2): number => Ops.hypot(a.x, a.y)

/**
 * Squared length of `a`, for comparisons without a square root.
 *
 * @category Operations
 */
export const lengthSquared = (a: Vec2): number => a.x * a.x + a.y * a.y

/**
 * Distance between two points.
 *
 * @category Operations
 */
export const distance = (a: Vec2, b: Vec2): number => Ops.hypot(a.x - b.x, a.y - b.y)

/**
 * Squared distance between two points, for comparisons without a square root.
 *
 * @category Operations
 */
export const distanceSquared = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/**
 * The unit vector along `a`, or `fallback` when `a` is (almost) zero. The
 * caller names the fallback, so a zero input never silently becomes a
 * direction.
 *
 * @category Operations
 */
export const normalizeOr = (a: Vec2, fallback: Vec2): Vec2 => {
  const len = Ops.hypot(a.x, a.y)
  return len < 1e-9 ? fallback : { x: a.x / len, y: a.y / len }
}

/**
 * Linear interpolation from `a` (at 0) to `b` (at 1); `t` is not clamped.
 *
 * @category Operations
 */
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

/**
 * Moves `current` toward `target` by at most `maxDelta`, never overshooting.
 *
 * @category Operations
 */
export const moveToward = (current: Vec2, target: Vec2, maxDelta: number): Vec2 => {
  const dx = target.x - current.x
  const dy = target.y - current.y
  const len = Ops.hypot(dx, dy)
  if (len <= maxDelta || len < 1e-9) return target
  return { x: current.x + (dx / len) * maxDelta, y: current.y + (dy / len) * maxDelta }
}

/**
 * `a` with its length capped at `max`, keeping its direction.
 *
 * @category Operations
 */
export const clampLength = (a: Vec2, max: number): Vec2 => {
  const len = Ops.hypot(a.x, a.y)
  return len <= max ? a : { x: (a.x / len) * max, y: (a.y / len) * max }
}
