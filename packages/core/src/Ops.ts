/**
 * Math functions that return the same bits on every JavaScript engine and
 * CPU, so a simulation replays exactly on any device.
 *
 * The spec lets engines approximate `Math.sin`, `cos`, `tan`, `asin`, `acos`,
 * `atan`, `atan2`, `exp`, `expm1`, `log`, `log2`, `log10`, `log1p`, `sinh`,
 * `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `cbrt`, `pow`, `hypot`, and
 * `a ** b`, and they do: Chrome, Safari, macOS, and Linux disagree in the
 * last bit, and a simulation grows that bit into a different run. Use these
 * in simulation code instead; each is a pure-JavaScript port of fdlibm (musl
 * libm) built only from operations every engine rounds exactly.
 *
 * The list is closed: these 22 functions and `**` are every operation the
 * spec lets engines approximate, so nothing else needs a replacement. Keep
 * using `Math.abs`, `sign`, `min`, `max`, `floor`, `ceil`, `round`, `trunc`,
 * `sqrt`, `imul`, `fround`, `clz32`, the constants (`Math.PI`, `Math.E`, ...),
 * `+ - * /`, and `x ** 2`: they are already exact everywhere. Use `Random` for randomness and `Clock` for time.
 * Code that only draws (rendering, effects) can use `Math` freely. The
 * `ritmo/use-ops-for-math` rule (`@typeonce/oxlint-plugin-ritmo`) points
 * simulation code here, and `oxlint --fix` rewrites the calls and adds the
 * import.
 *
 * @example
 * ```ts
 * // Inside a system: aim, then move along the heading.
 * const heading = Ops.atan2(target.y - position.y, target.x - position.x)
 * const step = { x: Ops.cos(heading) * speed * dt, y: Ops.sin(heading) * speed * dt }
 * const damping = Ops.exp(-friction * dt)
 * ```
 *
 * @module Ops
 * @docGroup helpers
 *
 * @categoryDescription Trigonometry
 * Sine, cosine, tangent, and their inverses, in radians.
 *
 * @categoryDescription Exponentials
 * Exponentials, logarithms, powers, and roots.
 *
 * @categoryDescription Hyperbolic
 * Hyperbolic functions and their inverses.
 *
 * @categoryDescription Lengths
 * Euclidean length without overflow.
 */

import * as fdlibm from "./internal/fdlibm.ts"

/**
 * Sine of `x` radians. Same bits on every engine (within 1 ulp of the exact
 * value); use instead of `Math.sin` in simulation code.
 *
 * @category Trigonometry
 */
export const sin: (x: number) => number = fdlibm.sin

/**
 * Cosine of `x` radians. Same bits on every engine (within 1 ulp of the
 * exact value); use instead of `Math.cos` in simulation code.
 *
 * @category Trigonometry
 */
export const cos: (x: number) => number = fdlibm.cos

/**
 * Tangent of `x` radians. Same bits on every engine (within 1 ulp of the
 * exact value); use instead of `Math.tan` in simulation code.
 *
 * @category Trigonometry
 */
export const tan: (x: number) => number = fdlibm.tan

/**
 * Arcsine of `x` in radians, in [-π/2, π/2]; NaN outside [-1, 1]. Same bits
 * on every engine; use instead of `Math.asin` in simulation code.
 *
 * @category Trigonometry
 */
export const asin: (x: number) => number = fdlibm.asin

/**
 * Arccosine of `x` in radians, in [0, π]; NaN outside [-1, 1]. Same bits on
 * every engine; use instead of `Math.acos` in simulation code.
 *
 * @category Trigonometry
 */
export const acos: (x: number) => number = fdlibm.acos

/**
 * Arctangent of `x` in radians, in (-π/2, π/2). Same bits on every engine;
 * use instead of `Math.atan` in simulation code. For the angle of a vector,
 * use `atan2`.
 *
 * @category Trigonometry
 */
export const atan: (x: number) => number = fdlibm.atan

/**
 * The angle of the vector (x, y) in radians, in [-π, π] (note the argument
 * order: `y` first, like `Math.atan2`). Same bits on every engine; use
 * instead of `Math.atan2` in simulation code.
 *
 * @category Trigonometry
 */
export const atan2: (y: number, x: number) => number = fdlibm.atan2

/**
 * e raised to `x`. Same bits on every engine (within 1 ulp of the exact
 * value); use instead of `Math.exp` in simulation code, for example for
 * frame-rate independent damping `exp(-rate * dt)`.
 *
 * @category Exponentials
 */
export const exp: (x: number) => number = fdlibm.exp

/**
 * Hyperbolic tangent of `x`, in [-1, 1]. Same bits on every engine (within 2
 * ulp of the exact value, like the native one); use instead of `Math.tanh` in
 * simulation code.
 *
 * @category Hyperbolic
 */
export const tanh: (x: number) => number = fdlibm.tanh

/**
 * e raised to `x`, minus 1, accurate for `x` near 0 (where `exp(x) - 1` loses
 * digits). Same bits on every engine; use instead of `Math.expm1` in
 * simulation code.
 *
 * @category Exponentials
 */
export const expm1: (x: number) => number = fdlibm.expm1

/**
 * Natural logarithm of `x`: -Infinity at 0, NaN below 0. Same bits on every
 * engine (within 1 ulp of the exact value); use instead of `Math.log` in
 * simulation code.
 *
 * @category Exponentials
 */
export const log: (x: number) => number = fdlibm.log

/**
 * Base-2 logarithm of `x`: -Infinity at 0, NaN below 0, exact for powers of
 * two. Same bits on every engine; use instead of `Math.log2` in simulation
 * code.
 *
 * @category Exponentials
 */
export const log2: (x: number) => number = fdlibm.log2

/**
 * Base-10 logarithm of `x`: -Infinity at 0, NaN below 0. Same bits on every
 * engine; use instead of `Math.log10` in simulation code.
 *
 * @category Exponentials
 */
export const log10: (x: number) => number = fdlibm.log10

/**
 * Natural logarithm of `1 + x`, accurate for `x` near 0 (where `log(1 + x)`
 * loses digits). Same bits on every engine; use instead of `Math.log1p` in
 * simulation code.
 *
 * @category Exponentials
 */
export const log1p: (x: number) => number = fdlibm.log1p

/**
 * Cube root of `x`, negative for negative `x`. Same bits on every engine;
 * use instead of `Math.cbrt` and `x ** (1 / 3)` in simulation code.
 *
 * @category Exponentials
 */
export const cbrt: (x: number) => number = fdlibm.cbrt

/**
 * `base` raised to `exponent`, with the results of `base ** exponent` for
 * every special case (NaN, zeros, infinities, negative bases). Same bits on
 * every engine (within 1 ulp of the exact value); use instead of `Math.pow`
 * and `**` in simulation code. `x * x` and `x ** 2` are already exact.
 *
 * @category Exponentials
 */
export const pow: (base: number, exponent: number) => number = fdlibm.pow

/**
 * Hyperbolic sine of `x`. Same bits on every engine (within 1 ulp of the
 * exact value); use instead of `Math.sinh` in simulation code.
 *
 * @category Hyperbolic
 */
export const sinh: (x: number) => number = fdlibm.sinh

/**
 * Hyperbolic cosine of `x`, at least 1. Same bits on every engine (within 1
 * ulp of the exact value); use instead of `Math.cosh` in simulation code.
 *
 * @category Hyperbolic
 */
export const cosh: (x: number) => number = fdlibm.cosh

/**
 * Inverse hyperbolic sine of `x`. Same bits on every engine; use instead of
 * `Math.asinh` in simulation code.
 *
 * @category Hyperbolic
 */
export const asinh: (x: number) => number = fdlibm.asinh

/**
 * Inverse hyperbolic cosine of `x`: NaN below 1. Same bits on every engine;
 * use instead of `Math.acosh` in simulation code.
 *
 * @category Hyperbolic
 */
export const acosh: (x: number) => number = fdlibm.acosh

/**
 * Inverse hyperbolic tangent of `x`: ±Infinity at ±1, NaN beyond. Same bits
 * on every engine; use instead of `Math.atanh` in simulation code.
 *
 * @category Hyperbolic
 */
export const atanh: (x: number) => number = fdlibm.atanh

/**
 * The length of the vector (x, y), `sqrt(x² + y²)` without overflow or
 * underflow. Same bits on every engine (within 1 ulp of the exact value);
 * use instead of `Math.hypot` in simulation code. Takes exactly two numbers;
 * for vectors use `Vec2.length` and `Vec2.distance`.
 *
 * @category Lengths
 */
export const hypot: (x: number, y: number) => number = fdlibm.hypot
