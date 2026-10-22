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
import type { Descriptor } from "./Descriptor.ts"
import type { StagedRelation } from "./Relation.ts"
import type { Schema } from "./Schema.ts"
import * as Result from "./Result.ts"

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
 * const handle = Game.Entity.handle(playerId, Player)
 * // `players` is a query the system declares: queries: { players: PlayerQuery }
 * const resolved = queries.players.getHandle(handle)
 * if (resolved._tag === "Failure") return
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

export namespace Handle {
  export type Root<T extends import("./Entity.ts").Handle<any, any>> = T extends import("./Entity.ts").Handle<infer R, any> ? R : never
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
 * A read capability for an entity together with a proof of readable components.
 *
 * Query execution is the main source of `EntityRef` values.
 */
export interface EntityRef<S extends Schema.Any, out P extends ComponentProof, Root = unknown, in Proves = never, in Lacks = never> {
  /**
   * Runtime tag for debugging and pattern matching.
   */
  readonly kind: "EntityRef"
  /**
   * The component descriptors the query that produced this ref proves (its
   * required slots and `with`): what `commands.despawn`, `insert`, and
   * `remove` check. Type-level only. Contravariant on purpose: a ref proving
   * more is a subtype, so a union of refs (`cond ? a.entity : b.entity`)
   * keeps only what both prove.
   */
  readonly __proves?: (_: Proves) => void
  /**
   * The component descriptors the producing query proves absent (its
   * `without`): what `commands.remove` checks against `Schema.requires`.
   * Type-level only.
   */
  readonly __lacks?: (_: Lacks) => void
  /**
   * The schema-bound entity identity.
   */
  readonly id: EntityId<S, Root>
  readonly __schemaRoot?: Root | undefined
  /**
   * The readable component proof attached to this access value.
   */
  readonly proof: P
}

/**
 * A read/write capability for an entity.
 *
 * `P` tracks readable components and `W` tracks the writable subset. This keeps
 * mutation capabilities explicit in query results.
 */
export interface EntityMut<
  S extends Schema.Any,
  out P extends ComponentProof,
  out W extends ComponentProof,
  Root = unknown,
  in Proves = never,
  in Lacks = never
> {
  /**
   * Runtime tag for debugging and pattern matching.
   */
  readonly kind: "EntityMut"
  /** The component descriptors the producing query proves; see `EntityRef`. */
  readonly __proves?: (_: Proves) => void
  /** The component descriptors the producing query proves absent; see `EntityRef`. */
  readonly __lacks?: (_: Lacks) => void
  /**
   * The schema-bound entity identity.
   */
  readonly id: EntityId<S, Root>
  readonly __schemaRoot?: Root | undefined
  /**
   * The readable component proof attached to this access value.
   */
  readonly proof: P
  /**
   * The writable subset of the proof.
   */
  readonly writable: W
}

/**
 * Brands a runtime integer id as an entity id.
 *
 * This is a low-level constructor used by the runtime and command system. It
 * allocates nothing: the id is the number.
 */
export const makeEntityId = <S extends Schema.Any, Root = unknown>(value: number): EntityId<S, Root> =>
  value as EntityId<S, Root>

/**
 * Creates a durable handle from a runtime entity id.
 *
 * This is a low-level constructor used by the bound `Game.Entity` helpers and
 * by runtime lookup resolution.
 */
export const makeHandle = <
  Root,
  Intent extends Descriptor<"component", string, any> | undefined = undefined
>(value: number): Handle<Root, Intent> =>
  value as Handle<Root, Intent>

/**
 * Anything that identifies one current-runtime entity: an id, or a query
 * match's `entity` view.
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
 * const any = Game.Entity.handle(match.entity)
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
 * Why a stored handle could not be decoded.
 */
export interface InvalidHandle {
  readonly _tag: "InvalidHandle"
  readonly value: unknown
}

/**
 * Decodes a handle from untrusted data, such as a component value inside a
 * snapshot. Use it in the constructor of a component or resource that stores
 * handles, so restoring validates them like any other value.
 *
 * A handle only names an entity; it never proves the entity exists. Resolving
 * it with `queries.x.getHandle(...)` (through a declared query) stays the checked step, so any positive
 * integer id decodes. Object-shaped handles and other non-numeric values
 * are rejected.
 *
 * @example
 * ```ts
 * const Target = Descriptor.ConstructedComponent({
 *   result: (raw: unknown) => {
 *     const enemy = Entity.decodeHandle(Root, isRecord(raw) ? raw["enemy"] : undefined, Health)
 *     return enemy._tag === "Success" ? Result.succeed({ enemy: enemy.success }) : enemy
 *   }
 * })("Game/Target")
 * ```
 */
export const decodeHandle = <
  Root,
  const Intent extends Descriptor<"component", string, any> | undefined = undefined
>(
  _root: Root,
  raw: unknown,
  _intent?: Intent
): Result.Result<Handle<Root, Intent>, InvalidHandle> => {
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0
    ? Result.succeed(makeHandle<Root, Intent>(raw))
    : Result.fail({ _tag: "InvalidHandle", value: raw })
}

/**
 * Creates a typed entity draft from an id and a proof.
 */
export const draft = <S extends Schema.Any, P extends ComponentProof, Root = unknown>(
  id: EntityId<S, Root>,
  proof: P,
  components: ReadonlyArray<StagedComponent> = [],
  relations: ReadonlyArray<StagedRelation<S, Root>> = []
): EntityDraft<S, P, Root> => ({
  kind: "EntityDraft",
  id,
  __schemaRoot: undefined as unknown as Root,
  proof,
  components,
  relations
})

/**
 * Creates a read-only entity proof value.
 */
export const ref = <S extends Schema.Any, P extends ComponentProof, Root = unknown>(
  id: EntityId<S, Root>,
  proof: P
): EntityRef<S, P, Root> => ({
  kind: "EntityRef",
  id,
  __schemaRoot: undefined as unknown as Root,
  proof
})

/**
 * Creates a mutable entity proof value.
 */
export const mut = <S extends Schema.Any, P extends ComponentProof, W extends ComponentProof, Root = unknown>(
  id: EntityId<S, Root>,
  proof: P,
  writable: W
): EntityMut<S, P, W, Root> => ({
  kind: "EntityMut",
  id,
  __schemaRoot: undefined as unknown as Root,
  proof,
  writable
})
