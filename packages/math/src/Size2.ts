/**
 * Branded two-dimensional sizes with explicit validation.
 *
 * Sizes model non-negative width/height pairs and are commonly used for
 * colliders, viewports, and AABB dimensions.
 *
 * Reach for this module when authored or host-provided dimensions should be
 * validated once and then carried through gameplay code, runtime bootstrap, or
 * geometry helpers without repeating non-negative checks everywhere.
 *
 * @example
 * ```ts
 * // Validate raw viewport dimensions before storing or reusing them.
 * const viewport = Size2.result({ width: 800, height: 600 })
 * if (viewport._tag === "Failure") return
 *
 * // Read the branded size later without rechecking width/height validity.
 * const width = Size2.width(viewport.success)
 * ```
 *
 * @module Size2
 * @docGroup data-structures
 *
 * @categoryDescription Size Types
 * Raw, branded, and error shapes for validated two-dimensional sizes.
 *
 * @categoryDescription Construction
 * Non-throwing constructor boundaries that validate raw width and height input.
 *
 * @categoryDescription Accessors
 * Pure readers and raw views over already-validated size values.
 */
import type * as Brand from "@typeonce/ritmo/Brand"
import * as internal from "./internal/size2.ts"
import type * as Result from "@typeonce/ritmo/Result"
import type * as Scalar from "./Scalar.ts"

/**
 * Raw size input accepted by the public constructors.
 *
 * @category Size Types
 */
export type Raw = {
  readonly width: number
  readonly height: number
}

/**
 * Validated non-negative width/height pair.
 *
 * @category Size Types
 */
export type Size2 = Brand.Branded<{
  readonly width: Scalar.NonNegative
  readonly height: Scalar.NonNegative
}, "Size2">

/**
 * Structured size-construction failure.
 *
 * @category Size Types
 */
export type Error = {
  readonly tag: "Size2/Invalid"
  readonly width: Scalar.Error | null
  readonly height: Scalar.Error | null
  readonly input: Raw
}

/**
 * Failure produced by `decode` when the input does not have the raw shape.
 *
 * @category Size Types
 */
export type DecodeError = {
  readonly tag: "Size2/Malformed"
  readonly input: unknown
}

/**
 * Validates one raw size and returns an explicit result.
 *
 * @category Construction
 */
export const result: (raw: Raw) => Result.Result<Size2, Error> = internal.result
/**
 * Validates untrusted input of any shape, for example a value read from a
 * save file. Descriptors built from this module use it when restoring
 * snapshots.
 *
 * @category Construction
 */
export const decode: (raw: unknown) => Result.Result<Size2, Error | DecodeError> = internal.decode
/**
 * Validates one raw size and returns `null` on failure.
 *
 * @category Construction
 */
export const option: (raw: Raw) => Size2 | null = internal.option
/**
 * Checks whether one raw size already satisfies the size invariants.
 *
 * @category Construction
 */
export const is: (raw: Raw) => raw is Raw & Size2 = internal.is
/**
 * Converts one branded size back to a fresh raw object.
 *
 * @category Accessors
 */
export const toRaw: (size: Size2) => Raw = internal.toRaw
/**
 * Reads the width component of one branded size.
 *
 * @category Accessors
 */
export const width: (size: Size2) => Scalar.NonNegative = internal.width
/**
 * Reads the height component of one branded size.
 *
 * @category Accessors
 */
export const height: (size: Size2) => Scalar.NonNegative = internal.height
