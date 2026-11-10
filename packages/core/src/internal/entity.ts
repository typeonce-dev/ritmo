import type * as Entity from "../Entity.ts"
import type { Descriptor } from "../Descriptor.ts"
import type { StagedRelation } from "../Relation.ts"
import type { Schema } from "../Schema.ts"

// The runtime's own entity constructors. Games make ids by spawning, handles
// with `Game.Entity.handle(...)`, and drafts with `Game.Command.spawn(...)`:
// none of these checks what it brands, so none is public.

/** Brands a runtime integer id as an entity id. Allocates nothing: the id is the number. */
export const makeEntityId = <S extends Schema.Any, Root = unknown>(value: number): Entity.EntityId<S, Root> =>
  value as Entity.EntityId<S, Root>

/** Brands a runtime integer id as a durable handle. */
export const makeHandle = <
  Root,
  Intent extends Descriptor<"component", string, any> | undefined = undefined
>(value: number): Entity.Handle<Root, Intent> =>
  value as Entity.Handle<Root, Intent>

/** Creates a typed entity draft from an id and a proof the caller has checked. */
export const makeDraft = <S extends Schema.Any, P extends Entity.ComponentProof, Root = unknown>(
  id: Entity.EntityId<S, Root>,
  proof: P,
  components: ReadonlyArray<Entity.StagedComponent> = [],
  relations: ReadonlyArray<StagedRelation<S, Root>> = []
): Entity.EntityDraft<S, P, Root> => ({
  kind: "EntityDraft",
  id,
  __schemaRoot: undefined,
  proof,
  components,
  relations
})
