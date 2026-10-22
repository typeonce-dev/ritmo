/**
 * Branded two-dimensional vectors with explicit validation.
 *
 * Raw `{ x, y }` input is validated once at the constructor boundary. All
 * other helpers work on branded vectors only and remain pure and immutable.
 *
 * This is the common math value that game code threads through position,
 * velocity, input direction, camera motion, and collision helpers. Use it when
 * vectors should stay explicitly validated and reusable across ECS and helper
 * modules.
 *
 * @example
 * ```ts
 * // Validate one raw velocity before storing or reusing it elsewhere.
 * const velocity = Vector2.result({ x: 3, y: 4 })
 * if (velocity._tag === "Failure") return
 *
 * // Derive a movement direction from the branded vector.
 * const direction = Vector2.normalizeOrZero(velocity.success)
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
 * Failure produced by `decode` when the input does not have the raw shape.
 *
 * @category Vector Types
 */
export type DecodeError = {
  readonly tag: "Vector2/Malformed"
  readonly input: unknown
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
 * Validates untrusted input of any shape, for example a value read from a
 * save file. Descriptors built from this module use it when restoring
 * snapshots.
 *
 * @category Construction
 */
export const decode: (raw: unknown) => Result.Result<Vector2, Error | DecodeError> = internal.decode
/**
 * Validates one raw vector and returns `null` on failure.
 *
 * @category Construction
 */
export const option: (raw: Raw) => Vector2 | null = internal.option
/**
 * Checks whether one raw vector already satisfies the vector invariants.
 *
 * @category Construction
 */
export const is: (raw: Raw) => raw is Raw & Vector2 = internal.is
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
 * if (direction._tag === "Failure") {
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
