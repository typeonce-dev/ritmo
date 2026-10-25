/**
 * Relationship definitions, traversal helpers, and mutation failures.
 *
 * Relations model directed entity links plus the explicit error surfaces used
 * when those links cannot be created or traversed.
 *
 * Use this module when plain components are not enough to express structure:
 * parent/child scene trees, targeting links, ownership chains, attachments, or
 * any other graph edge that should stay first-class and queryable in the ECS.
 *
 * @example
 * ```ts
 * // Relations are defined with Descriptor.Hierarchy and Descriptor.Relation.
 * const { relation: ChildOf } = Descriptor.Hierarchy("Game/ChildOf", "Game/Children")
 * const { relation: Targeting } = Descriptor.Relation("Game/Targeting", "Game/TargetedBy")
 * ```
 *
 * @module Relation
 * @docGroup core
 *
 * @groupDescription Namespaces
 * Grouped relation helper types for edges, pairs, and traversal proofs.
 *
 * @groupDescription Interfaces
 * Public relation contracts and traversal view shapes.
 *
 * @groupDescription Type Aliases
 * Shared relation descriptor, edge, and traversal helper types.
 *
 * @groupDescription Functions
 * Public constructors for relation descriptors and relation-aware traversal helpers.
 */
import type { EntityId } from "./Entity.ts"
import type { Schema } from "./Schema.ts"

/**
 * String-literal type id used to brand paired relationship definitions.
 */
export type RelationTypeId = "~ritmo/Relation"

const relationTypeId: RelationTypeId = "~ritmo/Relation"

/** `hierarchy` for `Descriptor.Hierarchy` (parent/children, ordered, despawned together), `relation` for `Descriptor.Relation`. */
export type RelationKind = "hierarchy" | "relation"

/** The nominal brand tying a relation to its reverse side. */
export type PairBrand<Name extends string, RelatedName extends string, Kind extends RelationKind> = {
  readonly relation: Name
  readonly related: RelatedName
  readonly kind: Kind
}

/** The reverse side of a relation (`Game/Children` for `Game/ChildOf`): the sources pointing at an entity. */
export interface RelatedDefinition<
  out RelatedName extends string = string,
  out RelationName extends string = string,
  out Kind extends RelationKind = RelationKind,
  Pair = unknown
> {
  readonly kind: "related"
  readonly relatedName: RelatedName
  readonly relationName: RelationName
  readonly key: symbol
  readonly relationKind: Kind
  readonly [relationTypeId]: {
    readonly _Pair: (_: never) => Pair
  }
}

/** A relation descriptor: each entity has at most one target in it. Made by `Descriptor.Hierarchy` or `Descriptor.Relation`. */
export interface RelationDefinition<
  out Name extends string = string,
  out RelatedName extends string = string,
  out Kind extends RelationKind = RelationKind,
  Pair = unknown
> {
  readonly kind: "relation"
  readonly name: Name
  readonly relatedName: RelatedName
  readonly key: symbol
  readonly relationKind: Kind
  readonly linkedDespawn: boolean
  readonly allowSelf: boolean
  readonly ordered: boolean
  readonly related: RelatedDefinition<RelatedName, Name, Kind, Pair>
  readonly [relationTypeId]: {
    readonly _Pair: (_: never) => Pair
  }
}

/** Type-level helpers for relations, and the failures relation lookups and commands report. */
export namespace Relation {
  /** Any relation (`Descriptor.Hierarchy` or `Descriptor.Relation`); a bound for generic code. */
  export type Any = RelationDefinition<string, string, RelationKind, any>
  /** Any related side of a relation (`Children`, `TargetedBy`): read, never written. */
  export type AnyRelated = RelatedDefinition<string, string, RelationKind, any>
  /** Any relation made with `Descriptor.Hierarchy`: ordered children that despawn with their parent. */
  export type Hierarchy = RelationDefinition<string, string, "hierarchy", any>
  /** The relation command a {@link MutationFailure} comes from. */
  export type MutationOperation = "relate" | "reorderChildren"

  /** The entity a lookup or command named is not alive. */
  export interface MissingEntityError {
    readonly _tag: "MissingEntity"
    readonly entityId: number
  }

  /** The entity is alive but has no target in `relation`. */
  export interface MissingRelationError {
    readonly _tag: "MissingRelation"
    readonly entityId: number
    readonly relation: string
  }

  /** `relate` named a target that is not alive. */
  export interface MissingTargetEntityError {
    readonly _tag: "MissingTargetEntity"
    readonly entityId: number
    readonly targetId: number
    readonly relation: string
  }

  /** `relate` pointed an entity at itself in a relation that does not allow it. */
  export interface SelfRelationNotAllowedError {
    readonly _tag: "SelfRelationNotAllowed"
    readonly entityId: number
    readonly relation: string
  }

  /** `relate` would make an entity its own ancestor in a hierarchy. */
  export interface HierarchyCycleError {
    readonly _tag: "HierarchyCycle"
    readonly entityId: number
    readonly targetId: number
    readonly relation: string
  }

  /** `reorderChildren` listed a child that is not alive. */
  export interface MissingChildEntityError {
    readonly _tag: "MissingChildEntity"
    readonly entityId: number
    readonly childId: number
    readonly relation: string
  }

  /** `reorderChildren` listed the same child twice. */
  export interface DuplicateChildError {
    readonly _tag: "DuplicateChild"
    readonly entityId: number
    readonly childId: number
    readonly relation: string
  }

  /** `reorderChildren` listed an entity that is not a child of this parent. */
  export interface ChildNotRelatedToParentError {
    readonly _tag: "ChildNotRelatedToParent"
    readonly entityId: number
    readonly childId: number
    readonly relation: string
  }

  /** `reorderChildren` did not list exactly the parent's current children. */
  export interface ChildSetMismatchError {
    readonly _tag: "ChildSetMismatch"
    readonly entityId: number
    readonly relation: string
  }

  /** Why `lookup.related` / `relatedSources` found nothing: the entity is gone, or has no such relation. */
  export type LookupError = MissingEntityError | MissingRelationError
  /** Why a `relate` or `reorderChildren` command was not applied. */
  export type MutationError =
    | MissingEntityError
    | MissingTargetEntityError
    | SelfRelationNotAllowedError
    | HierarchyCycleError
    | MissingChildEntityError
    | DuplicateChildError
    | ChildNotRelatedToParentError
    | ChildSetMismatchError

  /** A relation command that failed when applied, as `Game.System.readRelationFailures` reads it. */
  export interface MutationFailure<
    R extends Any = Any,
    S extends Schema.Any = Schema.Any,
    Root = unknown,
    Operation extends MutationOperation = MutationOperation
  > {
    readonly relation: R
    readonly operation: Operation
    readonly source: EntityId<S, Root>
    readonly target: EntityId<S, Root>
    readonly error: MutationError
  }

  /**
   * An edge the runtime dropped because its target despawned, as
   * `Game.System.readDroppedRelations` reads it. `target` is gone; `source`
   * was alive when the edge was dropped, but a later command in the same
   * `applyDeferred()` may have despawned it too (check with a lookup before
   * using it). A `Descriptor.Hierarchy` records none: its children despawn
   * with the parent.
   */
  export interface Dropped<
    R extends Any = Any,
    S extends Schema.Any = Schema.Any,
    Root = unknown
  > {
    readonly relation: R
    readonly source: EntityId<S, Root>
    readonly target: EntityId<S, Root>
  }
}

/** The query slot {@link read} returns; carried by `Game.Query.readRelation`. */
export interface RelationReadAccess<
  R extends Relation.Any,
  S extends Schema.Any,
  Root = unknown
> {
  readonly mode: "readRelation"
  readonly descriptor: R
  readonly __schema?: S | undefined
  readonly __schemaRoot?: Root | undefined
}

/** The query slot {@link optional} returns; carried by `Game.Query.optionalRelation`. */
export interface OptionalRelationReadAccess<
  R extends Relation.Any,
  S extends Schema.Any,
  Root = unknown
> {
  readonly mode: "optionalRelation"
  readonly descriptor: R
  readonly __schema?: S | undefined
  readonly __schemaRoot?: Root | undefined
}

/** The query slot {@link readRelated} returns; carried by `Game.Query.readRelated`. */
export interface RelatedReadAccess<
  R extends Relation.Any,
  S extends Schema.Any,
  Root = unknown
> {
  readonly mode: "readRelated"
  readonly descriptor: R
  readonly __schema?: S | undefined
  readonly __schemaRoot?: Root | undefined
}

/** The query slot {@link optionalRelated} returns; carried by `Game.Query.optionalRelated`. */
export interface OptionalRelatedReadAccess<
  R extends Relation.Any,
  S extends Schema.Any,
  Root = unknown
> {
  readonly mode: "optionalRelated"
  readonly descriptor: R
  readonly __schema?: S | undefined
  readonly __schemaRoot?: Root | undefined
}

/** Any relation query slot, as a query `selection` accepts it. */
export type SelectionAccess<S extends Schema.Any, Root = unknown> =
  | RelationReadAccess<Relation.Any, S, Root>
  | OptionalRelationReadAccess<Relation.Any, S, Root>
  | RelatedReadAccess<Relation.Any, S, Root>
  | OptionalRelatedReadAccess<Relation.Any, S, Root>

/**
 * A query slot with the entity's target in `relation` (`ChildOf` gives the
 * parent id); the query matches only entities that have one. Use
 * `Game.Query.readRelation`; {@link optional} also matches entities without.
 */
export const read = <R extends Relation.Any, S extends Schema.Any, Root = unknown>(
  descriptor: R
): RelationReadAccess<R, S, Root> => ({
  mode: "readRelation",
  descriptor
})

/** Like {@link read}, as an optional cell: entities without a target still match. */
export const optional = <R extends Relation.Any, S extends Schema.Any, Root = unknown>(
  descriptor: R
): OptionalRelationReadAccess<R, S, Root> => ({
  mode: "optionalRelation",
  descriptor
})

/**
 * A query slot with the ids of the entities related to this one through
 * `relation` (its sources: `ChildOf` gives the children); the query matches
 * only entities that have at least one. Use `Game.Query.readRelated`;
 * {@link optionalRelated} also matches entities with none.
 */
export const readRelated = <R extends Relation.Any, S extends Schema.Any, Root = unknown>(
  descriptor: R
): RelatedReadAccess<R, S, Root> => ({
  mode: "readRelated",
  descriptor
})

/** Like {@link readRelated}, as an optional cell: entities with no sources still match. */
export const optionalRelated = <R extends Relation.Any, S extends Schema.Any, Root = unknown>(
  descriptor: R
): OptionalRelatedReadAccess<R, S, Root> => ({
  mode: "optionalRelated",
  descriptor
})

/**
 * One relation edge staged on a spawn draft with `Game.Command.relate(...)`,
 * attached when the spawn applies at `applyDeferred()`.
 */
export interface StagedRelation<
  S extends Schema.Any,
  Root = unknown
> {
  readonly relation: Relation.Any
  readonly target: EntityId<S, Root>
}
