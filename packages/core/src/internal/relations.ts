/**
 * Builds relation pairs for `Descriptor.Hierarchy` and `Descriptor.Relation`,
 * the one public way to define a relation.
 */
import type { EntityId } from "../Entity.ts"
import type { PairBrand, RelatedDefinition, Relation as RelationTypes, RelationDefinition, RelationKind } from "../Relation.ts"
import type { Schema } from "../Schema.ts"

const relationTypeId = "~ritmo/Relation"

export const makePair = <
  const Name extends string,
  const RelatedName extends string,
  const Kind extends RelationKind
>(
  kind: Kind,
  name: Name,
  relatedName: RelatedName
): {
  readonly relation: RelationDefinition<Name, RelatedName, Kind, PairBrand<Name, RelatedName, Kind>>
  readonly related: RelatedDefinition<RelatedName, Name, Kind, PairBrand<Name, RelatedName, Kind>>
} => {
  type Pair = PairBrand<Name, RelatedName, Kind>
  const related = {
    kind: "related",
    relatedName,
    relationName: name,
    key: Symbol.for(`ritmo/related/${name}`),
    relationKind: kind,
    [relationTypeId]: {
      _Pair: (_: never) => undefined as unknown as Pair
    }
  } as RelatedDefinition<RelatedName, Name, Kind, Pair>

  const relation = {
    kind: "relation",
    name,
    relatedName,
    key: Symbol.for(`ritmo/relation/${name}`),
    relationKind: kind,
    linkedDespawn: kind === "hierarchy",
    allowSelf: false,
    ordered: kind === "hierarchy",
    related,
    [relationTypeId]: {
      _Pair: (_: never) => undefined as unknown as Pair
    }
  } as RelationDefinition<Name, RelatedName, Kind, Pair>

  return {
    relation,
    related
  }
}

// The failures the runtime reports for relation lookups and commands; games
// read them (`Relation.Relation.MutationError`), never build them.

export const missingEntityError = (entityId: number): RelationTypes.MissingEntityError => ({
  _tag: "MissingEntity",
  entityId
})

export const missingRelationError = (
  entityId: number,
  relation: string
): RelationTypes.MissingRelationError => ({
  _tag: "MissingRelation",
  entityId,
  relation
})

export const missingTargetEntityError = (
  entityId: number,
  targetId: number,
  relation: string
): RelationTypes.MissingTargetEntityError => ({
  _tag: "MissingTargetEntity",
  entityId,
  targetId,
  relation
})

export const selfRelationNotAllowedError = (
  entityId: number,
  relation: string
): RelationTypes.SelfRelationNotAllowedError => ({
  _tag: "SelfRelationNotAllowed",
  entityId,
  relation
})

export const hierarchyCycleError = (
  entityId: number,
  targetId: number,
  relation: string
): RelationTypes.HierarchyCycleError => ({
  _tag: "HierarchyCycle",
  entityId,
  targetId,
  relation
})

export const missingChildEntityError = (
  entityId: number,
  childId: number,
  relation: string
): RelationTypes.MissingChildEntityError => ({
  _tag: "MissingChildEntity",
  entityId,
  childId,
  relation
})

export const duplicateChildError = (
  entityId: number,
  childId: number,
  relation: string
): RelationTypes.DuplicateChildError => ({
  _tag: "DuplicateChild",
  entityId,
  childId,
  relation
})

export const childNotRelatedToParentError = (
  entityId: number,
  childId: number,
  relation: string
): RelationTypes.ChildNotRelatedToParentError => ({
  _tag: "ChildNotRelatedToParent",
  entityId,
  childId,
  relation
})

export const childSetMismatchError = (
  entityId: number,
  relation: string
): RelationTypes.ChildSetMismatchError => ({
  _tag: "ChildSetMismatch",
  entityId,
  relation
})

export const mutationFailure = <
  R extends RelationTypes.Any,
  S extends Schema.Any,
  Root,
  Operation extends RelationTypes.MutationOperation
>(
  relation: R,
  operation: Operation,
  source: EntityId<S, Root>,
  target: EntityId<S, Root>,
  error: RelationTypes.MutationError
): RelationTypes.MutationFailure<R, S, Root, Operation> => ({
  relation,
  operation,
  source,
  target,
  error
})
