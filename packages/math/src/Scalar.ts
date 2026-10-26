/**
 * One-dimensional helpers on plain numbers, for values a system moves toward
 * a target every step: a speed, a zoom, a meter, a wobble.
 *
 * Every function is total over finite numbers and returns a plain `number`.
 * Clamping stays `Math.min(Math.max(value, min), max)`, which is exact on
 * every engine. Angles have their own module, `Angle`, because they wrap;
 * vectors use the matching `Vec2` helpers.
 *
 * @example
 * ```ts
 * declare const current: number, topSpeed: number, acceleration: number, target: number, dt: number
 * declare const view: { readonly zoom: number }
 * // ---cut---
 * // Accelerate toward the top speed by at most `acceleration * dt` per step.
 * const speed = Scalar.moveToward(current, topSpeed, acceleration * dt)
 * // Ease a zoom toward its target the same way at any step rate.
 * const zoom = Scalar.decayToward(view.zoom, target, 8, dt)
 * ```
 *
 * @example
 * ```ts
 * declare let squash: Scalar.Spring
 * declare const dt: number
 * // ---cut---
 * // A landing squashes the body; it wobbles back to its rest size, 1.
 * squash = { value: squash.value, velocity: squash.velocity - 6 }
 * squash = Scalar.spring(squash, 1, { frequencyHz: 3, dampingRatio: 0.3 }, dt)
 * ```
 *
 * @module Scalar
 * @docGroup helpers
 *
 * @categoryDescription Spring Types
 * The state a spring carries between steps, and how it is tuned.
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

/**
 * A spring's state: its `value` and how fast it moves (`velocity`, in value
 * units per second). {@link spring} takes one and returns the next, so the
 * result passes straight back in on the next step.
 *
 * @category Spring Types
 */
export interface Spring {
  readonly value: number
  readonly velocity: number
}

/**
 * How a spring moves. `frequencyHz` is how many times per second it would
 * swing with no damping: higher is snappier. `dampingRatio` is how quickly
 * the swing dies out: below 1 it overshoots and wobbles (0.2 to 0.5 for a
 * bouncy feel), 1 settles fastest without swinging back and forth, above 1
 * settles more slowly, like moving through syrup.
 *
 * @category Spring Types
 */
export interface SpringSpec {
  readonly frequencyHz: number
  readonly dampingRatio: number
}

/**
 * Moves a damped spring toward `target` over `dt` seconds: a value with
 * momentum that can overshoot and wobble back, for squash and stretch, a
 * wobbling antenna, a pop when something appears. Kick it by adding to
 * `velocity`; tune it with {@link SpringSpec}.
 *
 * The motion is computed exactly, not stepped, so the same total time gives
 * the same result at any step rate (within rounding, while `target` and
 * `spec` stay the same) and no `dt` makes it blow up. `current` unchanged
 * when `dt` or `frequencyHz` is 0 or less; a negative `dampingRatio` counts
 * as 0 (it swings forever). An infinite `dt` settles at `target` with no
 * velocity, except with no damping, which never settles and keeps `current`.
 *
 * For an ease that never overshoots use {@link decayToward}, for a constant
 * rate {@link moveToward}. A vector springs one axis at a time with the same
 * spec (`x` and `y` each with their own velocity), which is exact. An angle
 * springs as an offset from its rest heading, wrapped with `Angle.wrap` when
 * drawn.
 *
 * @category Operations
 */
export const spring = (current: Spring, target: number, spec: SpringSpec, dt: number): Spring => {
  if (!(dt > 0) || !(spec.frequencyHz > 0)) return current
  const zeta = spec.dampingRatio > 0 ? spec.dampingRatio : 0
  const omega = 2 * Math.PI * spec.frequencyHz
  const settled = { value: target, velocity: 0 }
  if (omega * dt === Infinity) return zeta > 0 ? settled : current
  if (zeta === Infinity) return { value: current.value, velocity: 0 }
  const x = current.value - target
  const v = current.velocity
  // x(t) = E * (x C + (v + a x) S), v(t) = E * (v C - (a v + omega^2 x) S),
  // where E * C and E * S below already include the decay E = exp(-a t).
  const a = zeta * omega
  // zeta^2 - 1, factored so it stays exact near critical damping
  const gap = (zeta - 1) * (zeta + 1)
  let decayC: number
  let decayS: number
  if (gap === 0) {
    // Critical: C = 1, S = t
    decayC = Ops.exp(-a * dt)
    decayS = dt * decayC
  } else if (gap < 0) {
    // Underdamped: C = cos(b t), S = sin(b t) / b
    const b = omega * Math.sqrt(-gap)
    const decay = Ops.exp(-a * dt)
    decayC = decay * Ops.cos(b * dt)
    decayS = (decay * Ops.sin(b * dt)) / b
  } else {
    // Overdamped: C = cosh(b t), S = sinh(b t) / b, written as two decaying
    // exponentials so a long dt cannot become 0 * Infinity
    const b = omega * Math.sqrt(gap)
    // a - b, as omega^2 / (a + b) so heavy damping does not cancel
    const slow = Ops.exp(-((omega * omega) / (a + b)) * dt)
    decayC = (slow * (1 + Ops.exp(-2 * b * dt))) / 2
    decayS = (slow * -Ops.expm1(-2 * b * dt)) / (2 * b)
  }
  return {
    value: target + x * decayC + (v + a * x) * decayS,
    velocity: v * decayC - (a * v + omega * omega * x) * decayS
  }
}
