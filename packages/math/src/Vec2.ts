/**
 * Plain two-dimensional vector arithmetic for hot paths.
 *
 * Values are immutable `{ x, y }` records and every helper returns a new
 * one, so a component's value (validated once by the game's schema when it
 * entered the world) passes straight in. Lengths and angles go through
 * `Ops`, so the results replay the same on every engine.
 *
 * @example
 * ```ts
 * declare const position: Vec2.Vec2, target: Vec2.Vec2, current: Vec2.Vec2
 * declare const speed: number, maxSpeed: number
 * // ---cut---
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
 * `a` turned by `angle` radians (counter-clockwise for a y-up frame). For a
 * quarter turn use {@link perpendicular}, which is exact.
 *
 * @category Operations
 */
export const rotate = (a: Vec2, angle: number): Vec2 => {
  const cos = Ops.cos(angle)
  const sin = Ops.sin(angle)
  return { x: a.x * cos - a.y * sin, y: a.x * sin + a.y * cos }
}

/**
 * `a` turned a quarter turn counter-clockwise (for a y-up frame):
 * `{ x: -a.y, y: a.x }`. Exact. For the normal of a wall or a direction, a
 * sideways push, and the signed side of a point: `dot(perpendicular(forward),
 * offset)` is positive on the left of `forward`, negative on its right.
 *
 * @category Operations
 */
export const perpendicular = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x })

/**
 * Dot product. With {@link perpendicular} it is also the 2D cross product:
 * `dot(perpendicular(a), b)`.
 *
 * @category Operations
 */
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y

/**
 * The unit vector at `angle` radians from the x axis (counter-clockwise for a
 * y-up frame), through `Ops.cos` and `Ops.sin`. Multiply by a length with
 * {@link scale}. The inverse of {@link angle}.
 *
 * @category Operations
 */
export const fromAngle = (angle: number): Vec2 => ({ x: Ops.cos(angle), y: Ops.sin(angle) })

/**
 * The angle of `a` from the x axis in radians, in (-π, π], through
 * `Ops.atan2` (so no `y, x` argument order to get wrong). The zero vector
 * gives 0, and so does `-0` in either coordinate where `Ops.atan2` would give
 * `-0` or flip to -π. To keep it in `Angle`'s range [-π, π), use
 * `Angle.wrap`; to turn toward it, `Angle.turnToward`.
 *
 * @category Operations
 */
export const angle = (a: Vec2): number => Ops.atan2(a.y + 0, a.x + 0)

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

/**
 * Moves `current` toward `target` by the share `rate` closes per second, over
 * `dt` seconds, with one shared factor `exp(-rate * dt)` so the point moves
 * along the straight line: the same total time gives the same result at any
 * step rate. `current` unchanged when `rate * dt` is 0 or less, `target`
 * itself when `rate` is `Infinity` (and `dt` positive). It nears `target`
 * without reaching it; when it must arrive, use {@link moveToward}. For
 * plain numbers use `Scalar.decayToward`.
 *
 * @category Operations
 */
export const decayToward = (current: Vec2, target: Vec2, rate: number, dt: number): Vec2 => {
  const k = rate * dt
  if (!(k > 0)) return current
  if (k === Infinity) return target
  const factor = Ops.exp(-k)
  return { x: target.x + (current.x - target.x) * factor, y: target.y + (current.y - target.y) * factor }
}
