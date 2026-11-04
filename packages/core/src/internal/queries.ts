/**
 * Query execution: entity caching, slot accessors, and entity lookup.
 *
 * Each query spec gets one compiled state per world. The state caches the
 * ordered list of its entities' records and is recomputed only when a component
 * or relation it depends on changed membership. A query keeps one accessor per
 * slot and no object per entity, so iteration allocates nothing.
 *
 * Lifecycle filters (`added`, `changed`) are evaluated per call against the
 * reading system's previous-run tick (`since`), starting from the smaller of
 * the world's change log and the cached base entity set.
 *
 * Entities are always returned in ascending entity id order, which is spawn
 * order, so iteration is deterministic.
 */
import type { Descriptor } from "../Descriptor.ts"
import * as DescriptorModule from "../Descriptor.ts"
import type * as Entity from "../Entity.ts"
import * as Query from "../Query.ts"
import type * as Relation from "../Relation.ts"
import * as Result from "../Result.ts"
import * as Cells from "./cells.ts"
import type { Construction } from "./schema.ts"
import { constructionOf } from "./schema.ts"
import type { EntityRecord, World } from "./world.ts"

type AnyQuery = Query.Query.Any<any>

/**
 * What a rewind changed for one reader that did not rewind, per component
 * ordinal: the entities whose component it should see as added, and as
 * changed, on top of what their change ticks say. Only entities that hold
 * the component when the reader runs count.
 */
export interface Reverts {
  readonly added: Map<number, Set<number>>
  readonly changed: Map<number, Set<number>>
}

type SlotPlan =
  | { readonly slot: string; readonly mode: "read"; readonly ordinal: number }
  | { readonly slot: string; readonly mode: "optional"; readonly ordinal: number }
  | {
      readonly slot: string
      readonly mode: "write"
      readonly ordinal: number
      readonly constructor: Construction | undefined
      readonly entityState: Cells.EntityStatePlan | undefined
    }
  | {
      readonly slot: string
      readonly mode: "readRelation" | "readRelated" | "optionalRelation" | "optionalRelated"
      readonly relation: Relation.Relation.Any
    }

interface LifecycleFilterPlan {
  readonly kind: "added" | "changed"
  readonly ordinal: number
}

/** A query filter: one lifecycle filter, or `anyOf` several (passes when one does). */
type FilterPlan = ReadonlyArray<LifecycleFilterPlan>

interface QueryState {
  readonly ordinal: number
  readonly required: ReadonlyArray<number>
  readonly without: ReadonlyArray<number>
  readonly withRelations: ReadonlyArray<Relation.Relation.Any>
  readonly withoutRelations: ReadonlyArray<Relation.Relation.Any>
  readonly withRelated: ReadonlyArray<Relation.Relation.Any>
  readonly withoutRelated: ReadonlyArray<Relation.Relation.Any>
  readonly filters: ReadonlyArray<FilterPlan>
  readonly slots: ReadonlyArray<SlotPlan>
  readonly componentDeps: ReadonlyArray<number>
  readonly relationDeps: ReadonlyArray<symbol>
  readonly componentSeen: Array<number>
  readonly relationSeen: Array<number>
  entitiesSeen: number
  /** The run the query last handed its `data` out in, shared by every accessor it made. */
  readonly handout: Cells.Stamp
  records: ReadonlyArray<EntityRecord>
  /** Whether `records` was ever computed. */
  built: boolean
  data: Record<string, unknown> | undefined
  /** Whether `data` was made with entities to choose its accessors' classes from. */
  dataChosen: boolean
}

const unique = <T>(values: ReadonlyArray<T>): ReadonlyArray<T> => [...new Set(values)]


export type QueryEngine = ReturnType<typeof makeQueryEngine>

export const makeQueryEngine = (world: World) => {
  const states = new WeakMap<AnyQuery, QueryState>()
  let nextOrdinal = 0

  /**
   * The ordinal of a selected component, checking that the descriptor the
   * query names behaves like the one the schema registers under that name:
   * identity is (kind, name), so a look-alike built elsewhere must not add
   * or drop behaviour (entity-state transitions, a constructor, immutability,
   * transience) the schema does not declare.
   */
  const registeredOrdinal = (descriptor: Descriptor.Any): number => {
    const ordinal = world.ordinalOf(descriptor as never)
    const registered = world.descriptorAt(ordinal) as Descriptor.Any
    if (registered === descriptor) return ordinal
    const traits = (candidate: Descriptor.Any) => [
      DescriptorModule.isEntityState(candidate as never) ? "an entity state" : undefined,
      DescriptorModule.hasConstructor(candidate) ? "constructed" : undefined,
      DescriptorModule.isImmutable(candidate) ? "immutable" : undefined,
      DescriptorModule.isTransient(candidate) ? "transient" : undefined
    ].filter((trait) => trait !== undefined).join(", ") || "plain"
    const expected = traits(registered)
    const actual = traits(descriptor)
    if (expected !== actual) {
      throw new Error(`${descriptor.name} is ${expected} in this schema, but this query names a descriptor that is ${actual}: use the descriptor the schema registers`)
    }
    return ordinal
  }

  const compile = (query: AnyQuery): QueryState => {
    const required: Array<number> = query.with.map((descriptor) => world.ordinalOf(descriptor))
    const withRelations: Array<Relation.Relation.Any> = [...query.withRelations]
    const withRelated: Array<Relation.Relation.Any> = [...query.withRelated]
    const slots: Array<SlotPlan> = []
    const handout: Cells.Stamp = { live: false }

    for (const [slot, access] of Object.entries(query.selection)) {
      switch (access.mode) {
        case "read":
        case "write": {
          const ordinal = registeredOrdinal(access.descriptor)
          required.push(ordinal)
          if (access.mode === "write") {
            slots.push({
              slot,
              mode: "write",
              ordinal,
              constructor: constructionOf(access.descriptor),
              entityState: DescriptorModule.isEntityState(access.descriptor) ? Cells.entityStatePlan(access.descriptor.name, access.descriptor.states) : undefined
            })
          } else {
            slots.push({ slot, mode: "read", ordinal })
          }
          break
        }
        case "optional":
          slots.push({ slot, mode: "optional", ordinal: registeredOrdinal(access.descriptor) })
          break
        case "readRelation":
          withRelations.push(access.descriptor)
          slots.push({ slot, mode: access.mode, relation: access.descriptor })
          break
        case "readRelated":
          withRelated.push(access.descriptor)
          slots.push({ slot, mode: access.mode, relation: access.descriptor })
          break
        case "optionalRelation":
        case "optionalRelated":
          slots.push({ slot, mode: access.mode, relation: access.descriptor })
          break
      }
    }

    const without = query.without.map((descriptor) => world.ordinalOf(descriptor))
    const componentDeps = unique([...required, ...without])
    const relationDeps = unique([
      ...withRelations,
      ...query.withoutRelations,
      ...withRelated,
      ...query.withoutRelated
    ].map((relation) => relation.key))

    return {
      ordinal: nextOrdinal++,
      required: unique(required),
      without: unique(without),
      withRelations: unique(withRelations),
      withoutRelations: query.withoutRelations,
      withRelated: unique(withRelated),
      withoutRelated: query.withoutRelated,
      filters: query.filters.map((filter) =>
        (filter.kind === "anyOf" ? filter.filters : [filter]).map((member) => {
          const ordinal = world.ordinalOf(member.descriptor)
          world.trackChanges(ordinal)
          return { kind: member.kind, ordinal }
        })
      ),
      slots,
      componentDeps,
      relationDeps,
      componentSeen: componentDeps.map(() => -1),
      relationSeen: relationDeps.map(() => -1),
      entitiesSeen: -1,
      handout,
      records: [],
      built: false,
      data: undefined,
      dataChosen: false
    }
  }

  const stateOf = (query: AnyQuery): QueryState => {
    let state = states.get(query)
    if (!state) {
      state = compile(query)
      states.set(query, state)
    }
    return state
  }

  /**
   * Structural match: components and relations, without lifecycle filters.
   */
  const matchesStructure = (state: QueryState, record: EntityRecord): boolean => {
    for (const ordinal of state.required) {
      if (!world.has(record, ordinal)) return false
    }
    for (const ordinal of state.without) {
      if (world.has(record, ordinal)) return false
    }
    for (const relation of state.withRelations) {
      if (world.relationTarget(relation, record.id) === undefined) return false
    }
    for (const relation of state.withoutRelations) {
      if (world.relationTarget(relation, record.id) !== undefined) return false
    }
    for (const relation of state.withRelated) {
      if (world.relatedSourceIds(relation, record.id).length === 0) return false
    }
    for (const relation of state.withoutRelated) {
      if (world.relatedSourceIds(relation, record.id).length > 0) return false
    }
    return true
  }

  const reverted = (reverts: Reverts, member: LifecycleFilterPlan, record: EntityRecord): boolean =>
    (member.kind === "added" ? reverts.added : reverts.changed).get(member.ordinal)?.has(record.id) === true
      && world.has(record, member.ordinal)

  const matchesFilters = (state: QueryState, record: EntityRecord, since: number, reverts: Reverts | undefined): boolean => {
    for (const filter of state.filters) {
      let matched = false
      for (const member of filter) {
        matched = member.kind === "added"
          ? world.addedSince(record, member.ordinal, since)
          : world.changedSince(record, member.ordinal, since)
        if (!matched && reverts !== undefined) matched = reverted(reverts, member, record)
        if (matched) break
      }
      if (!matched) return false
    }
    return true
  }

  /**
   * Ids that may pass one filter (may repeat), or `undefined` when a change
   * log no longer covers `since`. An `anyOf` is the union of its members' logs.
   */
  const filterCandidates = (filter: FilterPlan, since: number): ReadonlyArray<number> | undefined => {
    if (filter.length === 1) return world.changedCandidates(filter[0]!.ordinal, since)
    const union: Array<number> = []
    for (const member of filter) {
      const logged = world.changedCandidates(member.ordinal, since)
      if (logged === undefined) return undefined
      for (const id of logged) union.push(id)
    }
    return union
  }

  const relatedIds = (relation: Relation.Relation.Any, id: number): ReadonlyArray<Entity.EntityId<any, any>> =>
    world.relatedSourceIds(relation, id).map(world.entityIdOf)

  /** The ids related to `id` through a relation, or `undefined` when there are none. */
  const relatedOrNone = (relation: Relation.Relation.Any, id: number): ReadonlyArray<Entity.EntityId<any, any>> | undefined => {
    const ids = relatedIds(relation, id)
    return ids.length === 0 ? undefined : ids
  }

  /** The accessor of a slot. `numeric` picks the class that sees numbers. */
  const makeAccessor = (plan: SlotPlan, stamp: Cells.Stamp, numeric: boolean): unknown => {
    switch (plan.mode) {
      case "read":
        return Cells.readAccessor(world, plan.ordinal, stamp, numeric)
      case "write":
        return Cells.writeAccessor(world, plan.ordinal, stamp, numeric, plan.constructor, plan.entityState)
      case "optional":
        return Cells.optionalAccessor(world, plan.ordinal, stamp)
      case "readRelation":
      case "optionalRelation": {
        const target = (id: number) => {
          const found = world.relationTarget(plan.relation, id)
          return found === undefined ? undefined : world.entityIdOf(found)
        }
        return Cells.relationAccessor(stamp, plan.relation.name, plan.mode === "readRelation", target)
      }
      case "readRelated":
      case "optionalRelated":
        return Cells.relationAccessor(stamp, plan.relation.relatedName, plan.mode === "readRelated", (id) => relatedOrNone(plan.relation, id))
    }
  }

  const isStale = (state: QueryState): boolean => {
    if (!state.built) return true
    if (state.required.length === 0 && state.entitiesSeen !== world.entitiesVersion()) return true
    const componentDeps = state.componentDeps
    for (let index = 0; index < componentDeps.length; index++) {
      if (state.componentSeen[index] !== world.componentVersion(componentDeps[index]!)) return true
    }
    const relationDeps = state.relationDeps
    for (let index = 0; index < relationDeps.length; index++) {
      if (state.relationSeen[index] !== world.relationVersion(relationDeps[index]!)) return true
    }
    return false
  }

  const byId = (left: EntityRecord, right: EntityRecord): number => left.id - right.id

  const markSeen = (state: QueryState): void => {
    state.entitiesSeen = world.entitiesVersion()
    state.componentDeps.forEach((ordinal, index) => {
      state.componentSeen[index] = world.componentVersion(ordinal)
    })
    state.relationDeps.forEach((key, index) => {
      state.relationSeen[index] = world.relationVersion(key)
    })
  }

  const indexOf = (records: ReadonlyArray<EntityRecord>, id: number): number => {
    let low = 0
    let high = records.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (records[middle]!.id < id) low = middle + 1
      else high = middle
    }
    return low
  }

  /**
   * Records whose membership in one of the query's components changed since
   * the cache was built, or `undefined` when an incremental update is not
   * possible or not worth it.
   */
  const affectedRecords = (state: QueryState): ReadonlyArray<EntityRecord> | undefined => {
    if (!state.built || state.required.length === 0) return undefined
    for (let index = 0; index < state.relationDeps.length; index++) {
      if (state.relationSeen[index] !== world.relationVersion(state.relationDeps[index]!)) return undefined
    }
    const affected: Array<EntityRecord> = []
    const limit = state.records.length / 2
    for (let index = 0; index < state.componentDeps.length; index++) {
      const changes = world.membershipChangesSince(state.componentDeps[index]!, state.componentSeen[index]!)
      if (changes === undefined) return undefined
      for (const record of changes) affected.push(record)
      if (affected.length > limit) return undefined
    }
    return affected
  }

  /**
   * Applies membership changes to the cached, id-ordered entity set. A new
   * array is built so arrays handed out earlier never change.
   */
  const refreshIncrementally = (state: QueryState, affected: ReadonlyArray<EntityRecord>): void => {
    const records = state.records.slice()
    const visited = new Set<EntityRecord>()
    for (const record of affected) {
      if (visited.has(record)) continue
      visited.add(record)
      const index = indexOf(records, record.id)
      const present = records[index] === record
      const belongs = record.alive && matchesStructure(state, record)
      if (belongs && !present) {
        records.splice(index, 0, record)
      } else if (!belongs && present) {
        records.splice(index, 1)
      }
    }
    state.records = records
  }

  const refresh = (state: QueryState): void => {
    if (!isStale(state)) return

    const affected = affectedRecords(state)
    if (affected !== undefined) {
      refreshIncrementally(state, affected)
      markSeen(state)
      return
    }

    let candidates: Iterable<EntityRecord> = world.records.values()
    let candidateCount = Infinity
    for (const ordinal of state.required) {
      const members = world.membersOf(ordinal)
      if (members.size < candidateCount) {
        candidates = members
        candidateCount = members.size
      }
    }

    const records: Array<EntityRecord> = []
    let sorted = true
    let previous = -1
    for (const record of candidates) {
      if (!matchesStructure(state, record)) continue
      if (record.id < previous) sorted = false
      previous = record.id
      records.push(record)
    }
    if (!sorted) records.sort(byId)

    state.records = records
    state.built = true
    markSeen(state)
  }

  /**
   * The records a query's filters pass. `since` is the tick of the reading
   * system's previous run; `added`/`changed` filters match changes made after it.
   */
  const filteredRecords = (state: QueryState, since: number, reverts: Reverts | undefined): ReadonlyArray<EntityRecord> => {
    // A reader with changes from a rewind scans: change logs do not hold them.
    if (reverts !== undefined) {
      const result: Array<EntityRecord> = []
      for (const record of state.records) {
        if (matchesFilters(state, record, since, reverts)) result.push(record)
      }
      return result
    }

    // Every added component is also logged as changed, so the changed log
    // bounds the candidates for either filter.
    let candidates: ReadonlyArray<number> | undefined
    for (const filter of state.filters) {
      const logged = filterCandidates(filter, since)
      if (logged === undefined) continue
      if (logged.length === 0) return []
      if (candidates === undefined || logged.length < candidates.length) candidates = logged
    }

    // When changes cover a large share of the matches, an in-order scan of the
    // cached set is cheaper than deduplicating and sorting the candidates.
    if (candidates === undefined || candidates.length * 4 >= state.records.length) {
      const result: Array<EntityRecord> = []
      for (const record of state.records) {
        if (matchesFilters(state, record, since, undefined)) result.push(record)
      }
      return result
    }

    const records: Array<EntityRecord> = []
    const seen = new Set<number>()
    for (const id of candidates) {
      if (seen.has(id)) continue
      seen.add(id)
      const record = world.records.get(id)
      if (record && matchesStructure(state, record) && matchesFilters(state, record, since, undefined)) {
        records.push(record)
      }
    }
    records.sort(byId)
    return records
  }

  const entityOf = (
    id: number,
    state: QueryState,
    since: number,
    reverts: Reverts | undefined
  ): Result.Result<EntityRecord, Query.Query.LookupError> => {
    const record = world.records.get(id)
    if (!record) {
      return Result.failure(Query.missingEntityError(id))
    }
    if (!matchesStructure(state, record) || !matchesFilters(state, record, since, reverts)) {
      return Result.failure(Query.queryMismatchError(id))
    }
    return Result.success(record)
  }

  /** The entities of a query: their records, in id order. */
  const each = (query: AnyQuery, since: number, reverts: Reverts | undefined): ReadonlyArray<EntityRecord> => {
    const state = stateOf(query)
    refresh(state)
    return state.filters.length === 0 ? state.records : filteredRecords(state, since, reverts)
  }

  const get = (id: number, query: AnyQuery, since: number, reverts: Reverts | undefined): Result.Result<EntityRecord, Query.Query.LookupError> =>
    entityOf(id, stateOf(query), since, reverts)

  /**
   * The query's `data` for the running run: one accessor per slot, made once.
   * An empty query cannot tell which class its slots want, so it chooses again
   * once it has entities.
   */
  const data = (query: AnyQuery): Record<string, unknown> => {
    const state = stateOf(query)
    world.handOut(state.handout)
    if (state.data !== undefined && state.dataChosen) return state.data
    refresh(state)
    const first = state.records[0]
    if (state.data !== undefined && first === undefined) return state.data
    state.dataChosen = first !== undefined
    const made: Record<string, unknown> = {}
    const accessors: Array<{ reset(): void }> = []
    for (const plan of state.slots) {
      const numeric = (plan.mode === "read" || plan.mode === "write") && first !== undefined && typeof world.valueAt(first, plan.ordinal) === "number"
      const accessor = makeAccessor(plan, state.handout, numeric)
      made[plan.slot] = accessor
      if (plan.mode === "read" || plan.mode === "write") accessors.push(accessor as { reset(): void })
    }
    state.data = made
    state.handout.accessors = accessors
    return made
  }

  return { each, get, data }
}
