/**
 * Branded axis-aligned bounding boxes built from validated vectors and sizes.
 *
 * The public shape is centered: each AABB is described by a center position and
 * a non-negative size. Geometry helpers derive edges and overlap relationships
 * without mutating the original value.
 *
 * In game code this is the natural helper for collision volumes, trigger
 * regions, camera bounds, and spatial authored data that should stay validated
 * and immutable after construction.
 *
 * @example
 * ```ts
 * // Build a collision volume from raw authored data.
 * const player = Aabb.result({
 *   position: { x: 0, y: 0 },
 *   size: { width: 16, height: 16 }
 * })
 * ```
 *
 * @module Aabb
 * @docGroup data-structures
 *
 * @categoryDescription AABB Types
 * Raw, branded, and error shapes for centered axis-aligned bounding boxes.
 *
 * @categoryDescription Construction
 * Non-throwing constructor boundaries for converting raw position and size input into branded AABBs.
 *
 * @categoryDescription Accessors
 * Pure readers that expose center, size, and derived edge positions.
 *
 * @categoryDescription Operations
 * Immutable geometry helpers for translation and overlap checks.
 */
import type * as Brand from "@typeonce/ritmo/Brand"
import * as internal from "./internal/aabb.ts"
import type * as Result from "@typeonce/ritmo/Result"
import type * as Scalar from "./Scalar.ts"
import type * as Size2 from "./Size2.ts"
import type * as Vector2 from "./Vector2.ts"

/**
 * Raw AABB input accepted by the public constructors.
 *
 * @category AABB Types
 */
export type Raw = {
  readonly position: Vector2.Raw
  readonly size: Size2.Raw
}

/**
 * Validated centered axis-aligned bounding box.
 *
 * @category AABB Types
 */
export type Aabb = Brand.Branded<{
  readonly position: Vector2.Vector2
  readonly size: Size2.Size2
}, "Aabb">

/**
 * Structured AABB-construction failure.
 *
 * @category AABB Types
 */
export type Error =
  | { readonly _tag: "Aabb/InvalidPosition"; readonly error: Vector2.Error; readonly input: Raw }
  | { readonly _tag: "Aabb/InvalidSize"; readonly error: Size2.Error; readonly input: Raw }

/**
 * Failure produced by `decode` when the input does not have the raw shape.
 *
 * @category AABB Types
 */
export type DecodeError = {
  readonly _tag: "Aabb/Malformed"
  readonly input: unknown
}

/**
 * Validates one raw AABB and returns an explicit result.
 *
 * @example
 * ```ts
 * const playerBox = Aabb.result({
 *   position: { x: 24, y: 24 },
 *   size: { width: 16, height: 16 }
 * })
 * ```
 *
 * @category Construction
 */
export const result: (raw: Raw) => Result.Result<Aabb, Error> = internal.result
/**
 * Validates untrusted input of any shape, for example a value read from a
 * save file. Descriptors built from this module use it when restoring
 * snapshots.
 *
 * @category Construction
 */
export const decode: (raw: unknown) => Result.Result<Aabb, Error | DecodeError> = internal.decode
/**
 * Validates one raw AABB and returns `null` on failure.
 *
 * @category Construction
 */
export const option: (raw: Raw) => Aabb | null = internal.option
/**
 * Checks whether one raw value already satisfies the AABB invariants.
 *
 * @category Construction
 */
export const is: (raw: Raw) => raw is Raw & Aabb = internal.is
/**
 * Reads the center position of one AABB.
 *
 * @category Accessors
 */
export const position: (aabb: Aabb) => Vector2.Vector2 = internal.position
/**
 * Reads the size of one AABB.
 *
 * @category Accessors
 */
export const size: (aabb: Aabb) => Size2.Size2 = internal.size
/**
 * Returns the left edge of one centered AABB.
 *
 * @category Accessors
 */
export const left: (aabb: Aabb) => Scalar.Finite = internal.left
/**
 * Returns the right edge of one centered AABB.
 *
 * @category Accessors
 */
export const right: (aabb: Aabb) => Scalar.Finite = internal.right
/**
 * Returns the top edge of one centered AABB.
 *
 * @category Accessors
 */
export const top: (aabb: Aabb) => Scalar.Finite = internal.top
/**
 * Returns the bottom edge of one centered AABB.
 *
 * @category Accessors
 */
export const bottom: (aabb: Aabb) => Scalar.Finite = internal.bottom
/**
 * Checks whether two AABBs overlap on both axes.
 *
 * @example
 * ```ts
 * const overlaps = Aabb.intersects(playerBox, wallBox)
 * ```
 *
 * @category Operations
 */
export const intersects: (first: Aabb, second: Aabb) => boolean = internal.intersects
/**
 * Checks whether two AABBs overlap on the horizontal axis.
 *
 * @category Operations
 */
export const overlapsHorizontally: (first: Aabb, second: Aabb) => boolean = internal.overlapsHorizontally
/**
 * Checks whether two AABBs overlap on the vertical axis.
 *
 * @category Operations
 */
export const overlapsVertically: (first: Aabb, second: Aabb) => boolean = internal.overlapsVertically
/**
 * Returns a translated copy of one AABB.
 *
 * @category Operations
 */
export const translate: (aabb: Aabb, delta: Vector2.Vector2) => Aabb = internal.translate
