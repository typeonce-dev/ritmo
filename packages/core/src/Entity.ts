/**
 * Entity identities, proofs, and long-lived handles.
 *
 * This module defines the nominal entity reference types used across queries,
 * commands, relations, and lookup APIs.
 *
 * In practical game code, it separates short-lived "current runtime entity"
 * identity from durable references that may survive across frames inside
 * components, resources, or events. That distinction is essential for keeping
 * liveness uncertainty explicit instead of pretending a saved reference proves
 * the entity still exists.
 *
 * @example
 * ```ts
 * declare const playerId: Entity.EntityId<typeof Game.schema, typeof Root>
 * // ---cut---
 * // Turn a current frame entity id into a durable reference.
 * const handle = Game.Entity.handle(playerId)
 *
 * // Add an intent when later resolution should require one component proof.
 * const positioned = Game.Entity.handle(playerId, Position)
 * ```
 *
 * @module Entity
 * @docGroup runtime
 *
 * @groupDescription Namespaces
 * Entity-specific proof helpers that refine ids and handles through descriptor evidence.
 *
 * @groupDescription Interfaces
 * Public contracts for current-runtime ids and long-lived storage-safe handles.
 *
 * @groupDescription Type Aliases
 * Shared nominal entity identities, handle shapes, and proof helpers.
 *
 * @groupDescription Functions
 * Explicit helpers for constructing and refining entity ids and handles.
 */
import type { Brand } from "./internal/brand.ts"
import { makeHandle } from "./internal/entity.ts"
import type { Descriptor } from "./Descriptor.ts"
import type { StagedRelation } from "./Relation.ts"
import type { Schema } from "./Schema.ts"

/**
 * Entity identities, proofs, and long-lived handles.
 *
 * `EntityId` is the current-runtime identity used by commands, queries, and
 * lookup. `Handle` is the storage-safe long-lived reference type used when the
 * entity must survive across frames inside components, resources, or events.
 *
 * The important distinction is explicit:
 *
 * - `EntityId` is not proof that an entity has specific components
 * - `Handle` is not proof that the entity is still alive
 * - current-world access must come from queries or checked lookup APIs
 *
 * @example
 * ```ts
 * const PlayerQuery = Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Player] })
 *
 * const FollowPlayer = Game.System("Game/FollowPlayer", { queries: { players: PlayerQuery } }, ({ queries }) => {
 *   for (const entity of queries.players.each()) {
 *     const handle = Game.Entity.handle(entity, Player)
 *     // Later (another run, or after reading it back from a component):
 *     const resolved = queries.players.getHandle(handle)
 *     if (!resolved.ok) return
 *     console.log(queries.players.data.position.get(resolved.value))
 *   }
 * })
 * ```
 */
export type EntityTypeId = "~ritmo/Entity"

/**
 * Runtime value for the entity type id.
 */
const entityTypeId: EntityTypeId = "~ritmo/Entity"
const entityHandleTypeId = "~ritmo/EntityHandle" as const

/**
 * A structural proof describing which components are known to be present.
 *
 * The engine uses proof objects instead of pretending entity ids always know
 * their exact runtime component set.
 */
export type ComponentProof = Record<string, unknown>

/**
 * An opaque schema-bound entity identity.
 *
 * `EntityId` proves only that the id belongs to a runtime built from schema `S`.
 * It does not prove anything about the entity's current component set.
 *
 * It is a branded number: stable for the lifetime of the runtime (ids are
 * never reused), usable as a `Map` or `Set` key and as an external
 * integration key (a renderer's node map), and printed as itself. The brand
 * keeps it apart from a plain number and from a `Handle` at compile time; at
 * runtime it is the number.
 */
export type EntityId<S extends Schema.Any, Root = unknown> = Brand<
  typeof entityTypeId,
  number & {
    readonly __schema?: S
    readonly __root?: Root
  }
>

/**
 * A durable, long-lived entity reference intended for storage.
 *
 * Unlike `EntityId`, this is explicitly a cross-frame reference that must be
 * resolved back into current-world access through checked lookup APIs.
 *
 * Like an id, a handle is a branded number: it costs nothing to make in a hot
 * loop, compares with `===`, works as a `Set` or `Map` key, and saves as a
 * plain number in snapshots. The intent, when given, exists only at the
 * type level.
 */
export type Handle<
  Root,
  Intent extends Descriptor<"component", string, any> | undefined = undefined
> = Brand<
  typeof entityHandleTypeId,
  number & {
    readonly __root?: Root
    readonly __intent?: Intent
  }
>

/** Type-level helpers for entity handles. */
export namespace Handle {
  /** The game root a handle belongs to. */
  export type Root<T extends import("./Entity.ts").Handle<any, any>> = T extends import("./Entity.ts").Handle<infer R, any> ? R : never
  /** The component a handle was made for (`Game.Entity.handle(id, Player)`), or `undefined` for a plain handle. */
  export type Intent<T extends import("./Entity.ts").Handle<any, any>> =
    T extends import("./Entity.ts").Handle<any, infer I extends Descriptor<"component", string, any> | undefined> ? I : never
}

/**
 * A staged entity with an exact compile-time component proof.
 *
 * Drafts exist before the command queue is flushed. This is the place where the
 * API can safely carry exact structural information.
 */
export interface EntityDraft<S extends Schema.Any, out P extends ComponentProof, Root = unknown, out Relates = never> {
  /**
   * Runtime tag for debugging and pattern matching.
   */
  readonly kind: "EntityDraft"
  /**
   * The schema-bound entity identity associated with the draft.
   */
  readonly id: EntityId<S, Root>
  readonly __schemaRoot?: Root | undefined
  /**
   * Exact staged component proof.
   */
  readonly proof: P
  /**
   * Staged components in insertion order, keyed by their descriptors.
   *
   * `proof` is the typed view of the same data; the runtime applies these
   * entries so storage identity always comes from the descriptor itself.
   */
  readonly components: ReadonlyArray<StagedComponent>
  /**
   * Staged relationship edges attached to the entity before spawn.
   */
  readonly relations: ReadonlyArray<StagedRelation<S, Root>>
  /**
   * The relations `Game.Command.relate(...)` staged on this draft: spawning
   * it needs them in the system's `Game.System.relates(...)`. Type-level only.
   */
  readonly __relates?: (_: never) => Relates
}

/**
 * One staged component value paired with the descriptor that owns it.
 */
export type StagedComponent = readonly [Descriptor<"component", string, any>, unknown]

/**
 * One entity from a query: `queries.x.each()`, `single()`, or `get(id)`. It
 * carries its `id` and what the query proves about it, and goes to the query's
 * `data` (`data.position.get(entity)`) and to `commands`.
 *
 * It keeps naming its entity in later runs, since ids are never reused: `data`
 * reads that entity's current value, or throws once the entity no longer holds
 * the component, so a kept entity never reads another one. A runtime without
 * `debug` does not re-check the query: an entity that left through `without`
 * is still readable. A runtime made with `debug` checks every entity a slot is
 * given against the system's queries, and throws for one that matches none of
 * them. To follow an entity across runs, keep the `id` and resolve it with
 * `queries.x.get(id)` in each run, which is fallible.
 */
export interface EntityRef<S extends Schema.Any, Root = unknown, in Proves = never, in Lacks = never, in Relates = never> {
  /**
   * Runtime tag for debugging and pattern matching.
   */
  readonly kind: "EntityRef"
  /**
   * The component descriptors the query that produced this ref proves (its
   * required slots and `with`): what `commands.despawn`, `insert`, and
   * `remove` check. Type-level only. Contravariant on purpose: a ref proving
   * more is a subtype, so a union of refs (`cond ? a : b`) keeps only what both
   * prove.
   */
  readonly __proves?: (_: Proves) => void
  /**
   * The component descriptors the producing query proves absent (its
   * `without`): what `commands.remove` checks against `Schema.requires`.
   * Type-level only.
   */
  readonly __lacks?: (_: Lacks) => void
  /**
   * What a slot of a query's `data` asks of an entity: the components and
   * relations the query proves. Type-level only, and what makes an entity one:
   * an id or a hand-written object is not.
   */
  readonly __entity: (_: Proves | Relates) => void
  /**
   * The schema-bound entity identity.
   */
  readonly id: EntityId<S, Root>
  readonly __schemaRoot?: Root | undefined
}

/**
 * Anything that identifies one current-runtime entity: an id, or an entity
 * from a query.
 */
export type HandleTarget<S extends Schema.Any, Root = unknown> =
  | EntityId<S, Root>
  | { readonly id: EntityId<S, Root> }

/**
 * Converts a current entity into a durable handle for storage.
 *
 * The handle is storage-safe, not a proof of liveness: resolve it later with
 * `queries.x.getHandle(...)` (through a declared query), which fails explicitly when the entity is gone.
 *
 * Pass an `intent` component when later code assumes a role such as "player"
 * or "damage source". An intent does not prove the component is still present;
 * it forces resolution through a query that proves it.
 *
 * @example
 * ```ts
 * declare const playerId: Entity.EntityId<typeof Game.schema, typeof Root>
 * const Players = Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Player] })
 * declare const entity: Query.QueryEntity<typeof Game.schema, typeof Players>
 * // ---cut---
 * const any = Game.Entity.handle(entity)
 * const player = Game.Entity.handle(playerId, Player)
 * ```
 */
export const handle = <
  S extends Schema.Any,
  Root = unknown,
  const Intent extends Descriptor<"component", string, any> | undefined = undefined
>(
  target: HandleTarget<S, Root>,
  _intent?: Intent
): Handle<Root, Intent> =>
  makeHandle<Root, Intent>(typeof target === "number" ? target : target.id)

/**
 * Checks that untrusted data is a stored handle for schema root `Root`
 * (optionally with an intent component): a guard to build a handle schema
 * with the game's schema library, so components and resources that store
 * handles validate them like any other value on restore.
 *
 * A handle only names an entity; it never proves the entity exists. Resolving
 * it with `queries.x.getHandle(...)` (through a declared query) stays the
 * checked step, so any positive integer id passes. Object-shaped handles and
 * other non-numeric values are rejected. A handle is a number, so it needs no
 * `"~encode"`.
 *
 * @example
 * ```ts
 * // Zod
 * const Target = Descriptor.ConstructedComponent(z.object({ enemy: z.unknown().refine(Entity.isHandle(Root, Health)) }))("Game/Target")
 * ```
 *
 * ```ts
 * // Effect, through the playbook's `codec`
 * import { Schema } from "effect"
 *
 * const Target = Descriptor.ConstructedComponent(codec(Schema.Struct({ enemy: Schema.declare(Entity.isHandle(Root, Health)) })))("Game/Target")
 * ```
 */
export const isHandle = <
  Root,
  const Intent extends Descriptor<"component", string, any> | undefined = undefined
>(
  _root: Root,
  _intent?: Intent
): (raw: unknown) => raw is Handle<Root, Intent> =>
  (raw: unknown): raw is Handle<Root, Intent> => typeof raw === "number" && Number.isInteger(raw) && raw > 0
