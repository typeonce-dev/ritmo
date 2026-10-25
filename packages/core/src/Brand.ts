/**
 * Brand types for validated values.
 *
 * Brands let the library distinguish validated carried values from raw user
 * input without changing their runtime representation. Ritmo brands its own
 * validated values with them (`Random.State`), so they move through the ECS
 * without losing the fact that they were checked once already.
 *
 * This module holds types only. Game code does not brand values by hand: it
 * brands through its schema library (`Schema.brand`, `z.brand`) and
 * validates through descriptors, which own their schema
 * (`Descriptor.ConstructedComponent(schema)`); raw input goes through it with
 * `Game.Command.entryRaw(...)` or `setRaw(...)`. Use `Branded` in a game
 * schema only to interoperate with a Ritmo brand, and never make one with a
 * cast (`ritmo/no-brand-cast` reports it).
 *
 * @module Brand
 * @docGroup helpers
 *
 * @categoryDescription Brand Types
 * The nominal markers used by branded public values.
 */
import type * as internal from "./internal/brand.ts"

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
