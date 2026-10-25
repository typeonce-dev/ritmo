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
 * if (!viewport.ok) return
 *
 * // Read the branded size later without rechecking width/height validity.
 * const width = Size2.width(viewport.value)
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
import type { StandardSchema } from "@typeonce/ritmo/Descriptor"
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
 * Validates one raw size and returns an explicit result.
 *
 * @category Construction
 */
export const result: (raw: Raw) => Result.Result<Size2, Error> = internal.result
/**
 * The codec of `Size2` (a Standard Schema, see `Descriptor.Codec`): give it to
 * `Descriptor.ConstructedComponent(...)` so raw input and saves are validated.
 * Its saved form is the raw shape, so it needs no `"~encode"`. To put a `Size2`
 * inside your own object schema, use {@link is} with your library's guard
 * schema, one that narrows to the guard's type (`Schema.declare(is)`,
 * `z.unknown().refine(is)`, `v.pipe(v.unknown(), v.guard(is))`).
 *
 * @example
 * ```ts
 * const Position = Descriptor.ConstructedComponent(Size2.codec)("Game/Position")
 * ```
 *
 * @category Construction
 */
export const codec: StandardSchema<Raw, Size2> = internal.codec
/**
 * Validates one raw size and returns `null` on failure.
 *
 * @category Construction
 */
export const option: (raw: Raw) => Size2 | null = internal.option
/**
 * Whether any value is a valid `Size2`: a guard, also for building a
 * `Size2` field in your own schema (`Schema.declare(Size2.is)`).
 *
 * @category Construction
 */
export const is: (raw: unknown) => raw is Size2 = internal.is
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
