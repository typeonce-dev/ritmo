/**
 * Branded two-dimensional vectors with explicit validation.
 *
 * Raw `{ x, y }` input is validated once at the constructor boundary. All
 * other helpers work on branded vectors only and remain pure and immutable.
 *
 * This is the common math value that game code threads through position,
 * velocity, input direction, camera motion, and collision helpers. Use it when
 * vectors should stay explicitly validated and reusable across ECS and helper
 * modules. For per-frame arithmetic on numbers already known to be sane, use
 * `Vec2` (a `Vector2` is a `Vec2`, so it passes without conversion).
 *
 * @example
 * ```ts
 * // Validate one raw velocity before storing or reusing it elsewhere.
 * const velocity = Vector2.result({ x: 3, y: 4 })
 * if (!velocity.ok) return
 *
 * // Derive a movement direction from the branded vector.
 * const direction = Vector2.normalizeOrZero(velocity.value)
 * ```
 *
 * @module Vector2
 * @docGroup data-structures
 *
 * @categoryDescription Vector Types
 * Raw, branded, and error shapes used to describe validated two-dimensional vectors.
 *
 * @categoryDescription Construction
 * Non-throwing constructor boundaries that validate raw input and produce branded vectors.
 *
 * @categoryDescription Accessors
 * Pure readers and views that expose branded vector components without mutation.
 *
 * @categoryDescription Operations
 * Immutable vector math and normalization helpers on already-validated values.
 */
import type * as Brand from "@typeonce/ritmo/Brand"
import type { StandardSchema } from "@typeonce/ritmo/Descriptor"
import * as internal from "./internal/vector2.ts"
import type * as Result from "@typeonce/ritmo/Result"
import type * as Scalar from "./Scalar.ts"

/**
 * Raw vector input accepted by the public constructors.
 *
 * @category Vector Types
 */
export type Raw = {
  readonly x: number
  readonly y: number
}

/**
 * Validated two-dimensional vector.
 *
 * @category Vector Types
 */
export type Vector2 = Brand.Branded<{
  readonly x: Scalar.Finite
  readonly y: Scalar.Finite
}, "Vector2">

/**
 * Structured vector-construction failure.
 *
 * @category Vector Types
 */
export type Error = {
  readonly tag: "Vector2/Invalid"
  readonly x: Scalar.Error | null
  readonly y: Scalar.Error | null
  readonly input: Raw
}

/**
 * Explicit failure produced when a zero-length vector cannot be normalized.
 *
 * @category Vector Types
 */
export type NormalizeError = {
  readonly tag: "Vector2/ZeroLength"
}

/**
 * Validates one raw vector and returns an explicit result.
 *
 * @example
 * ```ts
 * const position = Vector2.result({ x: 16, y: 24 })
 * ```
 *
 * @category Construction
 */
export const result: (raw: Raw) => Result.Result<Vector2, Error> = internal.result
/**
 * The codec of `Vector2` (a Standard Schema, see `Descriptor.Codec`): give it to
 * `Descriptor.ConstructedComponent(...)` so raw input and saves are validated.
 * Its saved form is the raw shape, so it needs no `"~encode"`. To put a `Vector2`
 * inside your own object schema, use {@link is} with your library's guard
 * schema, one that narrows to the guard's type (`Schema.declare(is)`,
 * `z.unknown().refine(is)`, `v.pipe(v.unknown(), v.guard(is))`).
 *
 * @example
 * ```ts
 * const Position = Descriptor.ConstructedComponent(Vector2.codec)("Game/Position")
 * ```
 *
 * @category Construction
 */
export const codec: StandardSchema<Raw, Vector2> = internal.codec
/**
 * Validates one raw vector and returns `null` on failure.
 *
 * @category Construction
 */
export const option: (raw: Raw) => Vector2 | null = internal.option
/**
 * Whether any value is a valid `Vector2`: a guard, also for building a
 * `Vector2` field in your own schema (`Schema.declare(Vector2.is)`).
 *
 * @category Construction
 */
export const is: (raw: unknown) => raw is Vector2 = internal.is
/**
 * Converts one branded vector back to a fresh raw object.
 *
 * @category Accessors
 */
export const toRaw: (vector: Vector2) => Raw = internal.toRaw
/**
 * Exposes the branded components of one vector.
 *
 * @category Accessors
 */
export const components: (vector: Vector2) => { readonly x: Scalar.Finite; readonly y: Scalar.Finite } = internal.components
/**
 * Reads the `x` component of one branded vector.
 *
 * @category Accessors
 */
export const x: (vector: Vector2) => Scalar.Finite = internal.x
/**
 * Reads the `y` component of one branded vector.
 *
 * @category Accessors
 */
export const y: (vector: Vector2) => Scalar.Finite = internal.y
/**
 * Returns the canonical zero vector.
 *
 * @category Construction
 */
export const zero: () => Vector2 = internal.zero
/**
 * Returns the sum of two branded vectors.
 *
 * Keeps the brands without re-validating: finite while the result stays
 * within `±Number.MAX_VALUE` (see `Scalar.Finite`).
 *
 * @category Operations
 */
export const add: (left: Vector2, right: Vector2) => Vector2 = internal.add
/**
 * Returns the component-wise difference between two branded vectors.
 *
 * Keeps the brands without re-validating: finite while the result stays
 * within `±Number.MAX_VALUE` (see `Scalar.Finite`).
 *
 * @category Operations
 */
export const subtract: (left: Vector2, right: Vector2) => Vector2 = internal.subtract
/**
 * Scales one vector by one validated finite scalar.
 *
 * Keeps the brands without re-validating: finite while the result stays
 * within `±Number.MAX_VALUE` (see `Scalar.Finite`).
 *
 * @category Operations
 */
export const scale: (vector: Vector2, scalar: Scalar.Finite) => Vector2 = internal.scale
/**
 * Returns the squared length of one vector.
 *
 * Keeps the brands without re-validating: finite while the result stays
 * within `±Number.MAX_VALUE` (see `Scalar.Finite`).
 *
 * @category Operations
 */
export const lengthSquared: (vector: Vector2) => Scalar.NonNegative = internal.lengthSquared
/**
 * Returns the length of one vector.
 *
 * @category Operations
 */
export const length: (vector: Vector2) => Scalar.NonNegative = internal.length
/**
 * Returns the normalized vector when its length is non-zero.
 *
 * @example
 * ```ts
 * const direction = Vector2.normalize(Vector2.zero())
 * if (!direction.ok) {
 *   return
 * }
 * ```
 *
 * @category Operations
 */
export const normalize: (vector: Vector2) => Result.Result<Vector2, NormalizeError> = internal.normalize
/**
 * Returns the normalized vector or the canonical zero vector when the input
 * length is zero.
 *
 * @category Operations
 */
export const normalizeOrZero: (vector: Vector2) => Vector2 = internal.normalizeOrZero
