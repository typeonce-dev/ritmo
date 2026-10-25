/**
 * Angles in radians, for headings a system stores as one number: a turret's
 * aim, a body's facing.
 *
 * Angles wrap: 350° and -10° are the same heading, so comparing or turning
 * them needs the wrap first. `wrap` brings any angle into [-π, π), and the
 * difference between two headings is `wrap(to - from)`, the short way round.
 * Both helpers are exact (`%` and `+ -` only), so they replay the same on
 * every engine. For the angle of a vector use `Vec2.angle`, for the unit
 * vector of an angle `Vec2.fromAngle`.
 *
 * @example
 * ```ts
 * // Turn a turret toward its target at a capped rate.
 * const wanted = Vec2.angle(Vec2.subtract(target, turret.position))
 * const aim = Angle.turnToward(turret.aim, wanted, turnRate * dt)
 * ```
 *
 * @module Angle
 * @docGroup helpers
 *
 * @categoryDescription Operations
 * Wrapping and turning angles.
 */

const TAU = 2 * Math.PI

/**
 * `angle` brought into [-π, π) by whole turns: π and -π both give -π. Use it
 * to keep a stored heading bounded, and for the signed short-way difference
 * between two headings, `wrap(to - from)`. Exact on every engine.
 *
 * @category Operations
 */
export const wrap = (angle: number): number => {
  // `%` is exact, and so is adding or removing one turn from a value within
  // one turn of it, so the result is the exact remainder.
  let wrapped = angle % TAU
  if (wrapped >= Math.PI) wrapped -= TAU
  else if (wrapped < -Math.PI) wrapped += TAU
  return wrapped === 0 ? 0 : wrapped
}

/**
 * `angle` turned toward `target` the short way by at most `maxStep` radians,
 * never overshooting: `wrap(target)` once it is within `maxStep`, and
 * `wrap(angle)` when `maxStep` is 0 or less. Headings exactly half a turn
 * apart turn the negative way. For a capped turn rate (a turret, a homing
 * shot); for plain numbers use `Scalar.moveToward`, for points
 * `Vec2.moveToward`.
 *
 * @category Operations
 */
export const turnToward = (angle: number, target: number, maxStep: number): number => {
  const from = wrap(angle)
  if (!(maxStep > 0)) return from
  const gap = wrap(target - from)
  if (Math.abs(gap) <= maxStep) return wrap(target)
  return wrap(gap > 0 ? from + maxStep : from - maxStep)
}
