/**
 * Query execution: match caching, match objects, and entity lookup.
 *
 * Each query spec gets one compiled state per world. The state caches the
 * ordered list of matches and is recomputed only when a component or relation
 * it depends on changed membership. Match objects (entity view + cells) are
 * created once per entity and query and then reused, so steady-state iteration
 * allocates nothing.
 *
 * Lifecycle filters (`added`, `changed`) are evaluated per call against the
 * reading system's previous-run tick (`since`), starting from the smaller of
 * the world's change log and the cached base match set.
 *
 * Matches are always returned in ascending entity id order, which is spawn
 * order, so iteration is deterministic.
 */
import { nativeSymbol } from "./native.ts"
import type { Descriptor } from "../Descriptor.ts"
import * as DescriptorModule from "../Descriptor.ts"
import type * as Entity from "../Entity.ts"
import * as Query from "../Query.ts"
import type { QueryMatch } from "../Query.ts"
import type * as Relation from "../Relation.ts"
import * as Result from "../Result.ts"
import * as Cells from "./cells.ts"
import type { EntityRecord, World } from "./world.ts"

type AnyQuery = Query.Query.Any<any>
type AnyMatch = QueryMatch<any, any>

type SlotPlan =
  | { readonly slot: string; readonly mode: "read" | "optional"; readonly ordinal: number }
  | {
      readonly slot: string
      readonly mode: "write"
      readonly ordinal: number
      readonly constructor: DescriptorModule.ResultConstructor<unknown, unknown, unknown> | undefined
      readonly entityState: string | undefined
    }
  | {
      readonly slot: string
      readonly mode: "readRelation" | "optionalRelation" | "readRelated" | "optionalRelated"
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
  readonly proofSlots: ReadonlyArray<readonly [string, number]>
  readonly writeSlots: ReadonlyArray<readonly [string, number]>
  readonly componentDeps: ReadonlyArray<number>
  readonly relationDeps: ReadonlyArray<symbol>
  readonly componentSeen: Array<number>
  readonly relationSeen: Array<number>
  entitiesSeen: number
  matches: ReadonlyArray<AnyMatch> | undefined
  records: ReadonlyArray<EntityRecord>
}

const unique = <T>(values: ReadonlyArray<T>): ReadonlyArray<T> => [...new Set(values)]

/**
 * A live view over the proven component values of one record.
 */
const makeProof = (record: EntityRecord, slots: ReadonlyArray<readonly [string, number]>): object => {
  const proof = {}
  for (const [slot, ordinal] of slots) {
    Object.defineProperty(proof, slot, {
      enumerable: true,
      get: () => record.values[ordinal]
    })
  }
  return proof
}

/**
 * The `entity` part of a query match: an `EntityRef` for read-only queries and
 * an `EntityMut` for queries with write slots. Proofs are built on first access.
 */
class EntityView {
  readonly kind: "EntityRef" | "EntityMut"
  readonly id: Entity.EntityId<any, any>
  readonly __schemaRoot: undefined
  readonly #state: QueryState
  readonly #record: EntityRecord
  #proof: object | undefined
  #writable: object | undefined

  constructor(state: QueryState, record: EntityRecord) {
    this.kind = state.writeSlots.length > 0 ? "EntityMut" : "EntityRef"
    this.id = record.entityId
    this.__schemaRoot = undefined
    this.#state = state
    this.#record = record
    this.#proof = undefined
    this.#writable = undefined
  }

  get proof(): object {
    return this.#proof ??= makeProof(this.#record, this.#state.proofSlots)
  }

  get writable(): object {
    return this.#writable ??= makeProof(this.#record, this.#state.writeSlots)
  }
}

export type QueryEngine = ReturnType<typeof makeQueryEngine>

export const makeQueryEngine = (world: World) => {
  const states = new WeakMap<AnyQuery, QueryState>()
  let nextOrdinal = 0
  const nativeSlotCache = new WeakMap<QueryState, { records: readonly EntityRecord[]; slots: Int32Array }>()

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
    const proofSlots: Array<readonly [string, number]> = []
    const writeSlots: Array<readonly [string, number]> = []

    for (const [slot, access] of Object.entries(query.selection)) {
      switch (access.mode) {
        case "read":
        case "write": {
          const ordinal = registeredOrdinal(access.descriptor)
          required.push(ordinal)
          proofSlots.push([slot, ordinal])
          if (access.mode === "write") {
            writeSlots.push([slot, ordinal])
            slots.push({
              slot,
              mode: "write",
              ordinal,
              constructor: DescriptorModule.constructorOf(access.descriptor),
              entityState: DescriptorModule.isEntityState(access.descriptor) ? access.descriptor.name : undefined
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
      proofSlots,
      writeSlots,
      componentDeps,
      relationDeps,
      componentSeen: componentDeps.map(() => -1),
      relationSeen: relationDeps.map(() => -1),
      entitiesSeen: -1,
      matches: undefined,
      records: []
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

  const matchesFilters = (state: QueryState, record: EntityRecord, since: number): boolean => {
    for (const filter of state.filters) {
      let matched = false
      for (const member of filter) {
        matched = member.kind === "added"
          ? world.addedSince(record, member.ordinal, since)
          : world.changedSince(record, member.ordinal, since)
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

  const makeCell = (plan: SlotPlan, record: EntityRecord): unknown => {
    switch (plan.mode) {
      case "read":
        return Cells.componentRead(record, plan.ordinal)
      case "write":
        return Cells.componentWrite(record, plan.ordinal, world, plan.constructor, plan.entityState)
      case "optional":
        return Cells.componentOptional(record, plan.ordinal)
      case "readRelation":
        return Cells.derivedRead(() => world.entityIdOf(world.relationTarget(plan.relation, record.id)!))
      case "optionalRelation":
        return Cells.derivedOptional(
          () => world.relationTarget(plan.relation, record.id) !== undefined,
          () => world.entityIdOf(world.relationTarget(plan.relation, record.id)!)
        )
      case "readRelated":
        return Cells.derivedRead(() => relatedIds(plan.relation, record.id))
      case "optionalRelated":
        return Cells.derivedOptional(
          () => world.relatedSourceIds(plan.relation, record.id).length > 0,
          () => relatedIds(plan.relation, record.id)
        )
    }
  }

  const makeEntityView = (state: QueryState, record: EntityRecord): object => new EntityView(state, record)

  const matchFor = (state: QueryState, record: EntityRecord): AnyMatch => {
    const cached = record.matches[state.ordinal]
    if (cached !== undefined) {
      return cached as AnyMatch
    }
    const data: Record<string, unknown> = {}
    for (const plan of state.slots) {
      data[plan.slot] = makeCell(plan, record)
    }
    const match = { entity: makeEntityView(state, record), data } as unknown as AnyMatch
    record.matches[state.ordinal] = match
    return match
  }

  const isStale = (state: QueryState): boolean => {
    if (state.matches === undefined) return true
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
    if (state.matches === undefined || state.required.length === 0) return undefined
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
   * Applies membership changes to the cached, id-ordered match set. New
   * arrays are built so arrays handed out earlier never change.
   */
  const refreshIncrementally = (state: QueryState, affected: ReadonlyArray<EntityRecord>): void => {
    const records = state.records.slice()
    const matches = state.matches!.slice()
    const visited = new Set<EntityRecord>()
    for (const record of affected) {
      if (visited.has(record)) continue
      visited.add(record)
      const index = indexOf(records, record.id)
      const present = records[index] === record
      const belongs = record.alive && matchesStructure(state, record)
      if (belongs && !present) {
        records.splice(index, 0, record)
        matches.splice(index, 0, matchFor(state, record))
      } else if (!belongs && present) {
        records.splice(index, 1)
        matches.splice(index, 1)
      }
    }
    state.records = records
    state.matches = matches
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
    state.matches = records.map((record) => matchFor(state, record))
    markSeen(state)
  }

  /**
   * Current matches of a query. `since` is the tick of the reading system's
   * previous run; `added`/`changed` filters match changes made after it.
   */
  const each = (query: AnyQuery, since: number): ReadonlyArray<AnyMatch> => {
    const state = stateOf(query)
    refresh(state)
    if (state.filters.length === 0) {
      return state.matches!
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
      const result: Array<AnyMatch> = []
      for (const record of state.records) {
        if (matchesFilters(state, record, since)) result.push(matchFor(state, record))
      }
      return result
    }

    const records: Array<EntityRecord> = []
    const seen = new Set<number>()
    for (const id of candidates) {
      if (seen.has(id)) continue
      seen.add(id)
      const record = world.records.get(id)
      if (record && matchesStructure(state, record) && matchesFilters(state, record, since)) {
        records.push(record)
      }
    }
    records.sort(byId)
    return records.map((record) => matchFor(state, record))
  }

  const get = (
    id: number,
    query: AnyQuery,
    since: number
  ): Result.Result<AnyMatch, Query.Query.LookupError> => {
    const record = world.records.get(id)
    if (!record) {
      return Result.failure(Query.missingEntityError(id))
    }
    const state = stateOf(query)
    if (!matchesStructure(state, record) || !matchesFilters(state, record, since)) {
      return Result.failure(Query.queryMismatchError(id))
    }
    return Result.success(matchFor(state, record))
  }

  const view = (query: AnyQuery) => {
    const native = world[nativeSymbol]
    if (!native?.available()) return undefined
    const state = stateOf(query)
    if (state.filters.length || state.slots.some((s) => s.mode !== "read" && s.mode !== "write")) return undefined
    refresh(state)
    const columns: Float64Array[] = [], marks: Int32Array[] = [], writes: number[] = [], layout: Array<{ slot: string; name: string; fields: readonly string[] | null; write: boolean }> = []
    for (const selected of state.slots) {
      if (!("ordinal" in selected)) return undefined
      const column = native.columns.components.get(selected.ordinal)
      if (!column) return undefined
      columns.push(...column.values)
      layout.push({ slot: selected.slot, name: column.name, fields: column.fields, write: selected.mode === "write" })
      if (selected.mode === "write") { marks.push(column.marks); writes.push(selected.ordinal) }
    }
    let cached = nativeSlotCache.get(state)
    if (!cached || cached.records !== state.records) {
      cached = { records: state.records, slots: Int32Array.from(state.records, (r) => native.columns.slots.get(r)!) }
      nativeSlotCache.set(state, cached)
    }
    return { count: state.records.length, slots: cached.slots, columns, marks, layout, tick: world.currentTick(),
      prepare: () => native.invalidate(writes),
      journal: (entry: import("./native.ts").NativeJournal) => native.journal(entry, writes) }
  }
  return { each, get, [nativeSymbol]: { view } }
}
