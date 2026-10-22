/**
 * Validated scalar brands and pure scalar helpers.
 *
 * This module is the numeric foundation for the branded geometry helpers.
 * Plain `number` values enter through explicit constructors such as
 * {@link Finite} and {@link NonNegative}. Once validated, downstream helpers
 * operate only on branded values.
 *
 * In game code this is useful whenever "just a number" is too weak: viewport
 * sizes, speeds, distances, durations, and geometry values often need explicit
 * non-negative or finite guarantees before they should be stored in the world.
 *
 * @example
 * ```ts
 * // Validate raw numbers before geometry or gameplay code relies on them.
 * const speed = Scalar.Finite.result(12)
 * const limit = Scalar.Finite.result(8)
 * if (speed._tag === "Failure" || limit._tag === "Failure") return
 *
 * // Operate on the branded values after the boundary has been crossed.
 * const clamped = Scalar.clamp(speed.success, limit.success, speed.success)
 * ```
 *
 * @module Scalar
 * @docGroup data-structures
 *
 * @categoryDescription Scalar Types
 * Branded numeric shapes and shared scalar validation errors.
 *
 * @categoryDescription Constructors
 * Non-throwing validation boundaries for finite and constrained scalar values.
 *
 * @categoryDescription Operations
 * Pure scalar combinators that preserve branding after validation.
 */
import type * as Brand from "@typeonce/ritmo/Brand"
import * as internal from "./internal/scalar.ts"
import type * as Result from "@typeonce/ritmo/Result"

/**
 * Finite number brand.
 *
 * Values of this type are guaranteed not to be `NaN`, `Infinity`, or
 * `-Infinity` when they come from a validator (`result`, `decode`). The
 * arithmetic helpers here and in `Vector2` keep the brand without
 * re-validating, so their results are finite only while they stay within
 * `±Number.MAX_VALUE`: game-sized values never come close, but validate
 * again with `result` when inputs may be that large.
 *
 * @category Scalar Types
 */
export type Finite = Brand.Branded<number, "Scalar/Finite">
/**
 * Finite number brand constrained to `>= 0`.
 *
 * @category Scalar Types
 */
export type NonNegative = Brand.Branded<number, "Scalar/NonNegative">
/**
 * Finite number brand constrained to `> 0`.
 *
 * @category Scalar Types
 */
export type Positive = Brand.Branded<number, "Scalar/Positive">

/**
 * Structured scalar validation failures.
 *
 * @category Scalar Types
 */
export type Error =
  | { readonly tag: "Scalar/NotFinite"; readonly value: number }
  | { readonly tag: "Scalar/Negative"; readonly value: number }
  | { readonly tag: "Scalar/NonPositive"; readonly value: number }

/**
 * Structured interpolation failure.
 *
 * @category Scalar Types
 */
export type InterpolationError = {
  readonly tag: "Scalar/ZeroRange"
  readonly start: number
  readonly end: number
}

/**
 * Constructor for {@link Finite}.
 *
 * @category Constructors
 */
export const Finite = internal.Finite
/**
 * Constructor for {@link NonNegative}.
 *
 * @category Constructors
 */
export const NonNegative = internal.NonNegative
/**
 * Constructor for {@link Positive}.
 *
 * @category Constructors
 */
export const Positive = internal.Positive

/**
 * Clamps one finite value between two finite bounds.
 *
 * The result stays branded because valid branded scalar input cannot produce an
 * invalid scalar output.
 *
 * @category Operations
 */
export const clamp: (value: Finite, min: Finite, max: Finite) => Finite = internal.clamp
/**
 * Interpolates between two finite values by one finite amount.
 *
 * The amount is not clamped. This stays a pure interpolation primitive rather
 * than mixing interpolation with policy. The result keeps the `Finite` brand
 * without re-validating (see `Finite`).
 *
 * @category Operations
 */
export const lerp: (start: Finite, end: Finite, amount: Finite) => Finite = internal.lerp
/**
 * Moves one finite value toward a target by at most one non-negative delta.
 *
 * Use this for explicit interpolation-style updates where overshooting the
 * target should be impossible.
 *
 * @category Operations
 */
export const approach: (current: Finite, target: Finite, maxDelta: NonNegative) => Finite = internal.approach
/**
 * Returns the interpolation amount of one value within a finite input range.
 *
 * Fails explicitly when the input range has zero size.
 *
 * @category Operations
 */
export const inverseLerp: (
  start: Finite,
  end: Finite,
  value: Finite
) => Result.Result<Finite, InterpolationError> = internal.inverseLerp
/**
 * Remaps one finite value from one input range to one output range.
 *
 * Fails explicitly when the input range has zero size.
 *
 * @category Operations
 */
export const remap: (
  value: Finite,
  inputStart: Finite,
  inputEnd: Finite,
  outputStart: Finite,
  outputEnd: Finite
) => Result.Result<Finite, InterpolationError> = internal.remap

/**
 * Common result shape returned by the scalar constructors.
 *
 * @category Scalar Types
 */
export type FiniteResult = Result.Result<Finite, Error>
