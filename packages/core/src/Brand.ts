/**
 * Small branding helpers for constructor-first validated values.
 *
 * Brands let the library distinguish validated carried values from raw user
 * input without changing their runtime representation. Constructors built with
 * this module are always explicit and non-throwing.
 *
 * This module is for packages that author validated value types, like
 * `@typeonce/ritmo-math`: `Vector2`, `Size2`, `Scalar`, and `Aabb` all build
 * on it so validated values can move through the ECS without losing the fact
 * that they were checked once already.
 *
 * Game code does not brand values. It validates through descriptors: a
 * descriptor owns its validator (`Descriptor.ConstructedComponent(Vector2)`,
 * a `Decode` validator, or `Descriptor.fromStandardSchema(...)`), and raw
 * input goes through it with `Game.Command.entryRaw(...)` or `setRaw(...)`.
 *
 * @example
 * ```ts
 * // Create a domain-specific constructor that only accepts valid ports.
 * const Port = Brand.refine((raw: number) =>
 *   raw > 0
 *     ? Result.succeed(raw as Brand.Branded<number, "Port">)
 *     : Result.fail({ _tag: "InvalidPort", value: raw })
 * )
 * ```
 *
 * @module Brand
 * @docGroup helpers
 *
 * @categoryDescription Brand Types
 * The nominal markers and constructor contracts used by branded public values.
 *
 * @categoryDescription Constructors
 * Helpers that build explicit non-throwing validators from raw input checks.
 */
import * as internal from "./internal/brand.ts"

/**
 * Public marker used to distinguish one validated domain from another.
 *
 * @category Brand Types
 */
export type Brand<Key> = internal.PublicBrand<Key>
/**
 * One value tagged with a stable public {@link Brand}.
 *
 * @category Brand Types
 */
export type Branded<Value, Key> = internal.Branded<Value, Key>

/**
 * Minimal constructor contract shared by branded helper modules.
 *
 * The constructor boundary is the only place raw input is accepted. After one
 * value has been validated, downstream helpers operate on the branded carried
 * type instead of revalidating plain structural data.
 *
 * @category Brand Types
 */
export interface Constructor<Value, Raw, Error> {
  /**
   * Validates one raw value and returns an explicit success/failure result.
   */
  readonly result: (raw: Raw) => import("./Result.ts").Result<Value, Error>
  /**
   * Validates one raw value and returns `null` on failure.
   *
   * This is useful at internal boundaries where only presence matters and no
   * structured error is needed.
   */
  readonly option: (raw: Raw) => Value | null
  /**
   * Checks whether one raw value already satisfies the branded invariants.
   */
  readonly is: (raw: Raw) => raw is Raw & Value
}

/**
 * Builds one explicit non-throwing constructor from a validation function.
 *
 * @category Constructors
 */
export const refine: <Value, Raw, Error>(
  validate: (raw: Raw) => import("./Result.ts").Result<Value, Error>
) => Constructor<Value, Raw, Error> = internal.refine

/**
 * Combines two constructors that validate the same carried value.
 *
 * The returned constructor succeeds only when both validations succeed.
 *
 * @category Constructors
 */
export const all: <Value, Raw, ErrorA, ErrorB>(
  left: Constructor<Value, Raw, ErrorA>,
  right: Constructor<Value, Raw, ErrorB>
) => Constructor<Value, Raw, readonly [ErrorA, ErrorB]> = internal.all
