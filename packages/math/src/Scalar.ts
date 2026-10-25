/**
 * One-dimensional helpers on plain numbers, for values a system moves toward
 * a target every step: a speed, a zoom, a meter.
 *
 * Every function is total over finite numbers and returns a plain `number`.
 * Clamping stays `Math.min(Math.max(value, min), max)`, which is exact on
 * every engine. Angles have their own module, `Angle`, because they wrap;
 * vectors use the matching `Vec2` helpers.
 *
 * @example
 * ```ts
 * // Accelerate toward the top speed by at most `acceleration * dt` per step.
 * const speed = Scalar.moveToward(current, topSpeed, acceleration * dt)
 * // Ease a zoom toward its target the same way at any step rate.
 * const zoom = Scalar.decayToward(view.zoom, target, 8, dt)
 * ```
 *
 * @module Scalar
 * @docGroup helpers
 *
 * @categoryDescription Operations
 * Moving one number toward another.
 */
import * as Ops from "@typeonce/ritmo/Ops"

/**
 * Moves `current` toward `target` by at most `maxDelta`, never overshooting:
 * `target` itself once the gap is `maxDelta` or less, and `current` unchanged
 * when `maxDelta` is 0 or less. For a constant rate (acceleration, a meter
 * filling); for an ease that slows near the target use {@link decayToward},
 * for vectors `Vec2.moveToward`, for angles `Angle.turnToward`.
 *
 * @category Operations
 */
export const moveToward = (current: number, target: number, maxDelta: number): number => {
  if (!(maxDelta > 0)) return current
  const gap = target - current
  if (Math.abs(gap) <= maxDelta) return target
  return gap > 0 ? current + maxDelta : current - maxDelta
}

/**
 * The number `amount` of the way from `start` (at 0) to `end` (at 1). The
 * amount is not clamped, so 1.5 goes past `end`. For a fixed blend between
 * two values; to approach a target over time use {@link moveToward} or
 * {@link decayToward}, for vectors `Vec2.lerp`.
 *
 * @category Operations
 */
export const lerp = (start: number, end: number, amount: number): number => start + (end - start) * amount

/**
 * Moves `current` toward `target` by the share `rate` closes per second,
 * over `dt` seconds: `target + (current - target) * exp(-rate * dt)`. The
 * same total time gives the same result at any step rate, which `lerp` by a
 * fixed amount per step does not. `current` unchanged when `rate * dt` is 0
 * or less, `target` itself when `rate` is `Infinity` (and `dt` positive).
 * It nears `target` without reaching it; when it must arrive, use
 * {@link moveToward}. For vectors use `Vec2.decayToward`.
 *
 * @category Operations
 */
export const decayToward = (current: number, target: number, rate: number, dt: number): number => {
  const k = rate * dt
  if (!(k > 0)) return current
  if (k === Infinity) return target
  return target + (current - target) * Ops.exp(-k)
}
