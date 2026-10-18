/**
 * World storage behind the runtime.
 *
 * Layout:
 *
 * - every live entity is one `EntityRecord` holding its component values in a
 *   dense array indexed by component ordinal (`ABSENT` marks a missing slot)
 * - every component ordinal keeps the set of records that currently have it,
 *   so a query only visits entities that carry its rarest required component
 * - every component ordinal and relation keeps a membership version, bumped on
 *   structural change, so queries know when their cached match set is stale
 * - every component slot records the change tick it was added and last
 *   changed at; `added`/`changed` filters compare those ticks with the tick
 *   of the reading system's previous run
 *
 * Ordinals are assigned per world from the schema, in schema order. Component
 * identity is the descriptor key, which is derived from `(kind, name)`; a bound
 * schema guarantees those names are unique.
 */
import { makeColumns, nativeSymbol, type NativeJournal } from "./native.ts"
import type { Descriptor } from "../Descriptor.ts"
import * as Entity from "../Entity.ts"
import * as Relation from "../Relation.ts"
import * as Result from "../Result.ts"
import type { Schema } from "../Schema.ts"

/**
 * Marks a component slot that the entity does not currently have.
 */
export const ABSENT: unique symbol = Symbol("ritmo/absent")

export interface EntityRecord {
  readonly id: number
  /**
   * The public id value handed out for this entity, created once.
   */
  readonly entityId: Entity.EntityId<any, any>
  /**
   * Component values by ordinal. Slots past the end are absent.
   */
  readonly values: Array<unknown>
  /**
   * Per component ordinal, `MARK_STRIDE` numbers: the tick the component was
   * added, the tick it last changed, and the transaction that last journaled
   * it.
   */
  readonly marks: Array<number>
  /**
   * Cached query matches by query ordinal, reused while the entity matches.
   */
  readonly matches: Array<unknown>
  /** The name of the component at an ordinal, for error messages (shared by the world's records). */
  readonly nameAt: (ordinal: number) => string
  alive: boolean
}

const ADDED = 0
const CHANGED = 1
const JOURNALED = 2
const MARK_STRIDE = 3
const NO_MARK = -1

/**
 * An append-only list of entity ids with the change tick each entry was
 * recorded at. Ticks are non-decreasing, so readers binary-search their start.
 */
interface TickLog {
  readonly ids: Array<number>
  readonly ticks: Array<number>
  /** Newest tick of any dropped entry. */
  droppedThrough: number
}

const makeLog = (): TickLog => ({ ids: [], ticks: [], droppedThrough: 0 })

const appendLog = (log: TickLog, id: number, tick: number): void => {
  log.ids.push(id)
  log.ticks.push(tick)
}

/**
 * Index of the first entry recorded after `since`.
 */
const firstAfter = (log: TickLog, since: number): number => {
  let low = 0
  let high = log.ticks.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (log.ticks[middle]! > since) high = middle
    else low = middle + 1
  }
  return low
}

const dropFront = (log: TickLog, count: number): void => {
  if (count > 0) {
    log.droppedThrough = Math.max(log.droppedThrough, log.ticks[count - 1]!)
    log.ids.splice(0, count)
    log.ticks.splice(0, count)
  }
}

/**
 * Drops entries recorded at or before `boundary`.
 */
const trimLog = (log: TickLog, boundary: number): void => {
  dropFront(log, firstAfter(log, boundary))
}

/**
 * A registered lifecycle reader's position: the tick of its previous
 * completed run, the same cursor its `added`/`changed` filters use.
 */
export interface LifecycleCursor {
  readonly lastRun: number
}

/**
 * Drops entries at or before `windowBoundary` that every registered reader
 * has read, then drops the oldest entries past `capacity`.
 */
const trimHeldLog = (
  log: TickLog,
  windowBoundary: number,
  readers: ReadonlySet<LifecycleCursor> | undefined,
  capacity: number
): void => {
  let boundary = windowBoundary
  if (readers !== undefined) {
    for (const reader of readers) boundary = Math.min(boundary, reader.lastRun)
  }
  trimLog(log, boundary)
  if (log.ids.length > capacity) dropFront(log, log.ids.length - capacity)
}

type ComponentDescriptor = Descriptor<"component", string, any>

const noSources: ReadonlyArray<number> = Object.freeze([])

export type World = ReturnType<typeof makeWorld>

/**
 * Structural-change callbacks used by the debug tracer. Installed only while
 * a trace listener is registered; component writes made through system
 * transactions are reported from the journal instead.
 */
export interface WorldHooks {
  spawned(id: number, components: Readonly<Record<string, unknown>>): void
  despawned(id: number): void
  inserted(id: number, ordinal: number, value: unknown): void
  overwritten(id: number, ordinal: number, before: unknown, after: unknown): void
  removed(id: number, ordinal: number): void
  related(sourceId: number, relation: Relation.Relation.Any, targetId: number): void
  unrelated(sourceId: number, relation: Relation.Relation.Any): void
}

/**
 * `lifecycleCapacity` caps each removed/despawned log, like
 * `Runtime.streamCapacity` caps event streams.
 */
export const makeWorld = <S extends Schema.Any>(schema: S, lifecycleCapacity: number) => {
  const columns = makeColumns(schema, ABSENT)
  const nativeJournals: NativeJournal[] = []
  let nextEntity = 1
  const records = new Map<number, EntityRecord>()

  const ordinals = new Map<symbol, number>()
  const descriptors: Array<ComponentDescriptor> = []
  const members: Array<Set<EntityRecord>> = []
  const componentVersions: Array<number> = []
  /**
   * Bumped on every spawn and despawn, for queries without required components.
   */
  let entitiesVersion = 0

  const relationTargets = new Map<symbol, Map<number, number>>()
  const relatedSources = new Map<symbol, Map<number, Array<number>>>()
  const relationVersions = new Map<symbol, number>()
  const relationDefinitions = Object.values(schema.relations) as ReadonlyArray<Relation.Relation.Any>

  /**
   * The world change tick. It advances for every system run and every command
   * flush; all writes in that span are stamped with it.
   */
  let tick = 0
  /**
   * Logs of changed components per ordinal. They back sparse `changed`
   * iteration and keep entries from the current and previous frame only (see
   * `advanceFrame`); older changes are found by scanning slot ticks instead.
   * `retainedAfter` is the tick up to which entries may already have been
   * dropped.
   */
  const changedLogs: Array<TickLog | undefined> = []
  /**
   * Per ordinal, the records whose membership changed, with the component
   * version after the change. Queries replay it to update their cached match
   * set incrementally. `membershipFrom[ordinal]` is the version after which
   * the log is complete.
   */
  const membershipRecords: Array<Array<EntityRecord>> = []
  const membershipVersions: Array<Array<number>> = []
  const membershipFrom: Array<number> = []
  const frameVersions: Array<number> = []
  /**
   * Per ordinal, the tick from which the changed log is complete, or
   * `undefined` while no query filters on the component (writes then skip the
   * log entirely).
   */
  const changedLogFrom: Array<number | undefined> = []
  /**
   * Logs of removed components per ordinal, and of despawned entities. They
   * back removed/despawned reads, which have no slot to scan, so an entry is
   * kept for the current and previous frame and beyond that until every
   * registered reader has read it (up to `lifecycleCapacity` entries per log).
   * Schedules ticked at a lower rate than the ones that despawn (rendering
   * after several fixed updates) therefore see every removal.
   */
  const removedLogs: Array<TickLog | undefined> = []
  const despawnedLog = makeLog()
  const removedReaders: Array<Set<LifecycleCursor> | undefined> = []
  const despawnedReaders = new Set<LifecycleCursor>()
  let retainedAfter = 0
  let frameStart = 0

  /**
   * Journal of in-place component writes made by the running system. Each
   * record/ordinal pair is journaled once per transaction with its original
   * value, so commit can record lifecycle changes and rollback can restore.
   */
  let transaction = 0
  let inTransaction = false
  const journalRecords: Array<EntityRecord> = []
  const journalOrdinals: Array<number> = []
  const journalValues: Array<unknown> = []
  /**
   * Journal of a phase: several system transactions undone together (a
   * transition's exit schedules). Each committed write keeps its value and
   * change tick from before it, so rollback restores both, newest first.
   */
  let inPhase = false
  const phaseRecords: Array<EntityRecord> = []
  const phaseOrdinals: Array<number> = []
  const phaseValues: Array<unknown> = []
  const phaseChanged: Array<number> = []

  /**
   * Entity ownership used by scene and level lifetime scopes.
   */
  const scopeByEntity = new Map<number, symbol>()
  const scopeMembers = new Map<symbol, Set<number>>()

  let hooks: WorldHooks | undefined
  /** Suppresses per-component and relation hooks inside spawns and despawns. */
  let hookDepth = 0

  const nameAt = (ordinal: number): string => descriptors[ordinal]?.name ?? `component #${ordinal}`

  const ordinalOf = (descriptor: ComponentDescriptor): number => {
    const known = ordinals.get(descriptor.key)
    if (known !== undefined) {
      return known
    }
    const ordinal = descriptors.length
    ordinals.set(descriptor.key, ordinal)
    descriptors.push(descriptor)
    members.push(new Set())
    componentVersions.push(0)
    membershipRecords.push([])
    membershipVersions.push([])
    membershipFrom.push(0)
    frameVersions.push(0)
    return ordinal
  }

  for (const descriptor of Object.values(schema.components) as ReadonlyArray<ComponentDescriptor>) {
    ordinalOf(descriptor)
  }

  const has = (record: EntityRecord, ordinal: number): boolean =>
    ordinal < record.values.length && record.values[ordinal] !== ABSENT

  /**
   * Records a membership change of `record` for one component.
   */
  const bumpMembership = (record: EntityRecord, ordinal: number): void => {
    const version = componentVersions[ordinal]! + 1
    componentVersions[ordinal] = version
    membershipRecords[ordinal]!.push(record)
    membershipVersions[ordinal]!.push(version)
  }

  const logFor = (logs: Array<TickLog | undefined>, ordinal: number): TickLog => {
    let log = logs[ordinal]
    if (log === undefined) {
      log = makeLog()
      logs[ordinal] = log
    }
    return log
  }

  /**
   * Stamps a component slot as changed at the current tick, logging it once
   * per tick.
   */
  const markChanged = (record: EntityRecord, ordinal: number): void => {
    const slot = ordinal * MARK_STRIDE + CHANGED
    if (record.marks[slot] === tick) {
      return
    }
    record.marks[slot] = tick
    if (changedLogFrom[ordinal] !== undefined) {
      appendLog(logFor(changedLogs, ordinal), record.id, tick)
    }
  }

  const ensureSlots = (record: EntityRecord, ordinal: number): void => {
    const values = record.values
    while (values.length <= ordinal) {
      values.push(ABSENT)
      for (let index = 0; index < MARK_STRIDE; index++) {
        record.marks.push(NO_MARK)
      }
    }
  }

  const bumpRelation = (key: symbol): void => {
    relationVersions.set(key, (relationVersions.get(key) ?? 0) + 1)
  }

  const entityIdOf = (id: number): Entity.EntityId<any, any> => Entity.makeEntityId(id)

  const allocateEntity = (): Entity.EntityId<any, any> => {
    const id = Entity.makeEntityId(nextEntity)
    nextEntity += 1
    return id
  }

  /**
   * Creates the record for a reserved id and writes its initial components.
   */
  const spawnEntity = (
    entityId: Entity.EntityId<any, any>,
    components: ReadonlyArray<Entity.StagedComponent>
  ): void => {
    let record = records.get(entityId)
    if (!record) {
      const values: Array<unknown> = new Array(descriptors.length)
      values.fill(ABSENT)
      const marks: Array<number> = new Array(descriptors.length * MARK_STRIDE)
      marks.fill(NO_MARK)
      record = {
        id: entityId,
        entityId,
        values,
        marks,
        matches: [],
        nameAt,
        alive: true
      }
      columns?.attach(record, components.map(([descriptor, value]) => [ordinalOf(descriptor), value] as const))
      records.set(record.id, record)
      entitiesVersion += 1
    }
    if (hooks !== undefined) {
      hookDepth += 1
      const written: Record<string, unknown> = {}
      for (let index = 0; index < components.length; index++) {
        const component = components[index]!
        writeRecord(record, ordinalOf(component[0]), component[1])
        written[component[0].name] = component[1]
      }
      hookDepth -= 1
      hooks.spawned(record.id, written)
      return
    }
    for (let index = 0; index < components.length; index++) {
      const component = components[index]!
      writeRecord(record, ordinalOf(component[0]), component[1])
    }
  }

  /**
   * Writes an existing component value in place and records the change.
   */
  /**
   * Writes a component the entity holds. Returns `false`, writing nothing,
   * when it does not (despawned records hold nothing): only a stale query
   * cell gets here, and it reports the misuse.
   */
  const setComponentValue = (record: EntityRecord, ordinal: number, value: unknown): boolean => {
    if (record.values[ordinal] === ABSENT) {
      return false
    }
    if (!inTransaction) {
      record.values[ordinal] = value
      markChanged(record, ordinal)
      return true
    }
    const slot = ordinal * MARK_STRIDE + JOURNALED
    if (record.marks[slot] !== transaction) {
      record.marks[slot] = transaction
      journalRecords.push(record)
      journalOrdinals.push(ordinal)
      journalValues.push(record.values[ordinal])
    }
    record.values[ordinal] = value
    return true
  }

  const clearJournal = (): void => {
    journalRecords.length = 0
    journalOrdinals.length = 0
    journalValues.length = 0
  }

  /**
   * Starts journaling in-place component writes for one system run.
   */
  const beginTransaction = (): void => {
    transaction += 1
    inTransaction = true
  }

  /**
   * Keeps the journaled writes and records them as lifecycle changes.
   */
  const commitTransaction = (): void => {
    for (const journal of nativeJournals) { journal.commit(); journal.release() }
    nativeJournals.length = 0
    inTransaction = false
    for (let index = 0; index < journalRecords.length; index++) {
      const record = journalRecords[index]!
      if (inPhase) {
        const ordinal = journalOrdinals[index]!
        phaseRecords.push(record)
        phaseOrdinals.push(ordinal)
        phaseValues.push(journalValues[index])
        phaseChanged.push(record.marks[ordinal * MARK_STRIDE + CHANGED]!)
      }
      if (record.alive) {
        markChanged(record, journalOrdinals[index]!)
      }
    }
    clearJournal()
  }

  /**
   * Restores every journaled slot to its value before the transaction.
   */
  const rollbackTransaction = (): void => {
    for (const journal of nativeJournals.reverse()) { journal.rollback(); journal.release() }
    nativeJournals.length = 0
    inTransaction = false
    for (let index = 0; index < journalRecords.length; index++) {
      journalRecords[index]!.values[journalOrdinals[index]!] = journalValues[index]
    }
    clearJournal()
  }

  const clearPhase = (): void => {
    inPhase = false
    phaseRecords.length = 0
    phaseOrdinals.length = 0
    phaseValues.length = 0
    phaseChanged.length = 0
  }

  /** Starts a phase: the transactions committed until it ends can be undone together. */
  const beginPhase = (): void => {
    inPhase = true
  }

  /** Restores every write committed in the phase, with its change tick. */
  const rollbackPhase = (): void => {
    for (let index = phaseRecords.length - 1; index >= 0; index--) {
      const record = phaseRecords[index]!
      const ordinal = phaseOrdinals[index]!
      record.values[ordinal] = phaseValues[index]
      record.marks[ordinal * MARK_STRIDE + CHANGED] = phaseChanged[index]!
    }
    clearPhase()
  }

  const clearEntityScope = (id: number): void => {
    const scopeKey = scopeByEntity.get(id)
    if (scopeKey === undefined) {
      return
    }
    scopeByEntity.delete(id)
    const members = scopeMembers.get(scopeKey)
    members?.delete(id)
    if (members?.size === 0) {
      scopeMembers.delete(scopeKey)
    }
  }

  const assignEntityScope = (id: number, scopeKey: symbol): void => {
    if (!records.has(id)) {
      return
    }
    clearEntityScope(id)
    let members = scopeMembers.get(scopeKey)
    if (!members) {
      members = new Set()
      scopeMembers.set(scopeKey, members)
    }
    members.add(id)
    scopeByEntity.set(id, scopeKey)
  }

  const destroyEntityScope = (scopeKey: symbol): void => {
    for (const id of [...(scopeMembers.get(scopeKey) ?? [])]) {
      destroyEntity(id)
    }
  }

  const writeRecord = (record: EntityRecord, ordinal: number, value: unknown): void => {
    if (!has(record, ordinal)) {
      ensureSlots(record, ordinal)
      members[ordinal]!.add(record)
      bumpMembership(record, ordinal)
      record.marks[ordinal * MARK_STRIDE + ADDED] = tick
      if (hooks !== undefined && hookDepth === 0) hooks.inserted(record.id, ordinal, value)
    } else if (hooks !== undefined && hookDepth === 0) {
      hooks.overwritten(record.id, ordinal, record.values[ordinal], value)
    }
    record.values[ordinal] = value
    markChanged(record, ordinal)
  }

  const writeComponent = (id: number, descriptor: ComponentDescriptor, value: unknown): void => {
    const record = records.get(id)
    if (record) {
      writeRecord(record, ordinalOf(descriptor), value)
    }
  }

  const removeComponent = (id: number, descriptor: ComponentDescriptor): void => {
    const record = records.get(id)
    if (!record) {
      return
    }
    const ordinal = ordinalOf(descriptor)
    if (!has(record, ordinal)) {
      return
    }
    record.values[ordinal] = ABSENT
    members[ordinal]!.delete(record)
    bumpMembership(record, ordinal)
    appendLog(logFor(removedLogs, ordinal), id, tick)
    if (hooks !== undefined) hooks.removed(id, ordinal)
  }

  const relatedSourceIds = (relation: Relation.Relation.Any, targetId: number): ReadonlyArray<number> =>
    relatedSources.get(relation.key)?.get(targetId) ?? noSources

  const relationTarget = (relation: Relation.Relation.Any, sourceId: number): number | undefined =>
    relationTargets.get(relation.key)?.get(sourceId)

  const addRelatedSource = (relation: Relation.Relation.Any, targetId: number, sourceId: number): void => {
    let store = relatedSources.get(relation.key)
    if (!store) {
      store = new Map()
      relatedSources.set(relation.key, store)
    }
    const entries = store.get(targetId)
    if (!entries) {
      store.set(targetId, [sourceId])
      return
    }
    if (!entries.includes(sourceId)) {
      entries.push(sourceId)
    }
  }

  const removeRelatedSource = (relation: Relation.Relation.Any, targetId: number, sourceId: number): void => {
    const store = relatedSources.get(relation.key)
    const entries = store?.get(targetId)
    if (!store || !entries) {
      return
    }
    const next = entries.filter((entry) => entry !== sourceId)
    if (next.length === 0) {
      store.delete(targetId)
      return
    }
    store.set(targetId, next)
  }

  const unrelate = (sourceId: number, relation: Relation.Relation.Any): void => {
    const targets = relationTargets.get(relation.key)
    const previousTarget = targets?.get(sourceId)
    if (previousTarget === undefined) {
      return
    }
    targets!.delete(sourceId)
    removeRelatedSource(relation, previousTarget, sourceId)
    bumpRelation(relation.key)
    if (hooks !== undefined && hookDepth === 0) hooks.unrelated(sourceId, relation)
  }

  const wouldCreateHierarchyCycle = (relation: Relation.Relation.Any, sourceId: number, targetId: number): boolean => {
    let current: number | undefined = targetId
    while (current !== undefined) {
      if (current === sourceId) {
        return true
      }
      current = relationTarget(relation, current)
    }
    return false
  }

  const tryRelate = (
    sourceId: number,
    relation: Relation.Relation.Any,
    targetId: number
  ): Result.Result<void, Relation.Relation.MutationError> => {
    if (!records.has(sourceId)) {
      return Result.failure(Relation.missingEntityError(sourceId))
    }
    if (!records.has(targetId)) {
      return Result.failure(Relation.missingTargetEntityError(sourceId, targetId, relation.name))
    }
    if (!relation.allowSelf && sourceId === targetId) {
      return Result.failure(Relation.selfRelationNotAllowedError(sourceId, relation.name))
    }
    if (relation.relationKind === "hierarchy" && wouldCreateHierarchyCycle(relation, sourceId, targetId)) {
      return Result.failure(Relation.hierarchyCycleError(sourceId, targetId, relation.name))
    }

    let targets = relationTargets.get(relation.key)
    if (!targets) {
      targets = new Map()
      relationTargets.set(relation.key, targets)
    }
    const previousTarget = targets.get(sourceId)
    if (previousTarget !== undefined && previousTarget !== targetId) {
      removeRelatedSource(relation, previousTarget, sourceId)
    }
    targets.set(sourceId, targetId)
    addRelatedSource(relation, targetId, sourceId)
    bumpRelation(relation.key)
    if (hooks !== undefined) hooks.related(sourceId, relation, targetId)
    return Result.success(undefined)
  }

  const reorderChildren = (
    parentId: number,
    relation: Relation.Relation.Any,
    childIds: ReadonlyArray<number>
  ): Result.Result<void, Relation.Relation.MutationError> => {
    if (!records.has(parentId)) {
      return Result.failure(Relation.missingEntityError(parentId))
    }

    const currentChildren = relatedSourceIds(relation, parentId)
    const seenChildren = new Set<number>()

    for (const childId of childIds) {
      if (!records.has(childId)) {
        return Result.failure(Relation.missingChildEntityError(parentId, childId, relation.name))
      }
      if (seenChildren.has(childId)) {
        return Result.failure(Relation.duplicateChildError(parentId, childId, relation.name))
      }
      seenChildren.add(childId)
      if (relationTarget(relation, childId) !== parentId) {
        return Result.failure(Relation.childNotRelatedToParentError(parentId, childId, relation.name))
      }
    }

    if (currentChildren.length !== childIds.length) {
      return Result.failure(Relation.childSetMismatchError(parentId, relation.name))
    }
    for (const childId of currentChildren) {
      if (!seenChildren.has(childId)) {
        return Result.failure(Relation.childSetMismatchError(parentId, relation.name))
      }
    }

    if (childIds.length > 0) {
      relatedSources.get(relation.key)!.set(parentId, [...childIds])
      bumpRelation(relation.key)
    }
    return Result.success(undefined)
  }

  const destroyEntity = (id: number): void => {
    const record = records.get(id)
    if (!record) {
      return
    }
    if (hooks !== undefined) {
      hooks.despawned(id)
      hookDepth += 1
    }
    for (const relation of relationDefinitions) {
      const current = relatedSourceIds(relation, id)
      const sources = current.length === 0 ? noSources : [...current]
      if (relation.linkedDespawn) {
        for (const sourceId of sources) {
          destroyEntity(sourceId)
        }
      } else {
        for (const sourceId of sources) {
          unrelate(sourceId, relation)
        }
      }
      unrelate(id, relation)
    }
    const values = record.values
    for (let ordinal = 0; ordinal < values.length; ordinal++) {
      if (values[ordinal] === ABSENT) {
        continue
      }
      values[ordinal] = ABSENT
      members[ordinal]!.delete(record)
      bumpMembership(record, ordinal)
      appendLog(logFor(removedLogs, ordinal), id, tick)
    }
    clearEntityScope(id)
    appendLog(despawnedLog, id, tick)
    record.alive = false
    records.delete(id)
    columns?.release(record)
    entitiesVersion += 1
    if (hooks !== undefined) hookDepth -= 1
  }

  /**
   * Advances the change tick and returns it.
   */
  const advanceTick = (): number => {
    tick += 1
    return tick
  }

  /**
   * Starts a new frame (one `runtime.tick(...)` call): log entries older than
   * the previous frame are dropped. Returns that boundary tick (entries at or
   * before it are gone), or `0` when nothing was dropped yet.
   */
  const advanceFrame = (): number => {
    for (let ordinal = 0; ordinal < descriptors.length; ordinal++) {
      // Keep membership changes from the current and previous frame.
      const boundary = frameVersions[ordinal]!
      const versions = membershipVersions[ordinal]!
      let count = 0
      while (count < versions.length && versions[count]! <= boundary) count++
      if (count > 0) {
        versions.splice(0, count)
        membershipRecords[ordinal]!.splice(0, count)
        membershipFrom[ordinal] = boundary
      }
      frameVersions[ordinal] = componentVersions[ordinal]!
    }
    if (frameStart > 0) {
      for (const log of changedLogs) if (log) trimLog(log, frameStart)
      removedLogs.forEach((log, ordinal) => {
        if (log) trimHeldLog(log, frameStart, removedReaders[ordinal], lifecycleCapacity)
      })
      trimHeldLog(despawnedLog, frameStart, despawnedReaders, lifecycleCapacity)
      retainedAfter = frameStart
    }
    frameStart = tick
    return retainedAfter
  }

  const entriesSince = (log: TickLog | undefined, since: number): ReadonlyArray<number> => {
    if (log === undefined) return noSources
    const start = firstAfter(log, since)
    return start === log.ids.length ? noSources : log.ids.slice(start)
  }

  /**
   * Plain export of every live entity: id and component values by
   * descriptor name, in spawn order, leaving out `skip`ped descriptors.
   */
  const exportEntities = (
    skip: (descriptor: ComponentDescriptor) => boolean
  ): Array<{ readonly id: number; readonly components: Record<string, unknown> }> =>
    [...records.values()]
      .sort((left, right) => left.id - right.id)
      .map((record) => {
        const components: Record<string, unknown> = {}
        record.values.forEach((value, ordinal) => {
          const descriptor = descriptors[ordinal]!
          if (value !== ABSENT && !skip(descriptor)) components[descriptor.name] = value
        })
        return { id: record.id, components }
      })

  /**
   * Relation edges grouped by target, preserving the stored source order.
   */
  const exportRelations = (): Record<string, Array<readonly [number, ReadonlyArray<number>]>> => {
    const exported: Record<string, Array<readonly [number, ReadonlyArray<number>]>> = {}
    for (const relation of relationDefinitions) {
      exported[relation.name] = [...(relatedSources.get(relation.key)?.entries() ?? [])]
        .map(([target, sources]) => [target, [...sources]] as const)
    }
    return exported
  }

  /**
   * Scope membership by scope storage key, members in id order. Every
   * member is a live entity: despawns leave their scope.
   */
  const exportScopes = (): Array<readonly [symbol, ReadonlyArray<number>]> =>
    [...scopeMembers].map(([key, members]) => [key, [...members].sort((left, right) => left - right)] as const)

  /**
   * Despawns every live entity (recorded like normal despawns).
   */
  const despawnAll = (): void => {
    for (const id of [...records.keys()]) {
      destroyEntity(id)
    }
  }

  const nextEntityValue = (): number => nextEntity

  /**
   * Visits the component writes journaled by the running system transaction,
   * with the value before the transaction and the current one.
   */
  const forEachJournaled = (visit: (id: number, ordinal: number, before: unknown, after: unknown) => void): void => {
    for (let index = 0; index < journalRecords.length; index++) {
      const record = journalRecords[index]!
      const ordinal = journalOrdinals[index]!
      visit(record.id, ordinal, journalValues[index], record.values[ordinal])
    }
  }

  const setNextEntity = (value: number): void => {
    nextEntity = Math.max(nextEntity, value)
  }

  return {
    [nativeSymbol]: columns === undefined ? undefined : {
      columns,
      available: () => !inPhase && hooks === undefined,
      invalidate: (ordinals: readonly number[]) => { for (const ordinal of ordinals) changedLogFrom[ordinal] = undefined },
      journal: (entry: NativeJournal, ordinals: readonly number[]) => {
        if (!inTransaction || inPhase) throw new Error("Native kernels require an active system transaction outside an exit phase")
        for (const ordinal of ordinals) changedLogFrom[ordinal] = undefined
        nativeJournals.push(entry)
      }
    },
    records,
    relationDefinitions,
    ordinalOf,
    nameAt,
    has,
    entityIdOf,
    allocateEntity,
    spawnEntity,
    setComponentValue,
    writeComponent,
    removeComponent,
    destroyEntity,
    assignEntityScope,
    destroyEntityScope,
    beginTransaction,
    commitTransaction,
    rollbackTransaction,
    beginPhase,
    commitPhase: clearPhase,
    rollbackPhase,
    tryRelate,
    unrelate,
    reorderChildren,
    relationTarget,
    relatedSourceIds,
    advanceTick,
    advanceFrame,
    exportEntities,
    exportRelations,
    exportScopes,
    despawnAll,
    nextEntityValue,
    setNextEntity,
    forEachJournaled,
    setHooks: (next: WorldHooks | undefined): void => {
      hooks = next
      hookDepth = 0
    },
    /** Tick at or before which changed-log entries may have been dropped. */
    retainedAfter: (): number => retainedAfter,
    descriptorAt: (ordinal: number): ComponentDescriptor => descriptors[ordinal]!,
    membersOf: (ordinal: number): ReadonlySet<EntityRecord> => members[ordinal]!,
    /**
     * Records whose membership of `ordinal` changed after `version`, or
     * `undefined` when the log no longer covers that range. May repeat.
     */
    membershipChangesSince: (ordinal: number, version: number): ReadonlyArray<EntityRecord> | undefined => {
      if (version < membershipFrom[ordinal]!) return undefined
      const versions = membershipVersions[ordinal]!
      let low = 0
      let high = versions.length
      while (low < high) {
        const middle = (low + high) >>> 1
        if (versions[middle]! > version) high = middle
        else low = middle + 1
      }
      return membershipRecords[ordinal]!.slice(low)
    },
    componentVersion: (ordinal: number): number => componentVersions[ordinal]!,
    relationVersion: (key: symbol): number => relationVersions.get(key) ?? 0,
    entitiesVersion: (): number => entitiesVersion,
    currentTick: (): number => tick,
    /**
     * Whether the component was added after `since`.
     */
    addedSince: (record: EntityRecord, ordinal: number, since: number): boolean =>
      has(record, ordinal) && record.marks[ordinal * MARK_STRIDE + ADDED]! > since,
    /**
     * Whether the component was added or changed after `since`.
     */
    changedSince: (record: EntityRecord, ordinal: number, since: number): boolean =>
      has(record, ordinal) && record.marks[ordinal * MARK_STRIDE + CHANGED]! > since,
    /**
     * Candidate ids for a `changed`/`added` filter on `ordinal` after `since`,
     * or `undefined` when the log no longer covers that range. Ids may repeat.
     */
    changedCandidates: (ordinal: number, since: number): ReadonlyArray<number> | undefined => {
      const from = changedLogFrom[ordinal]
      return from === undefined || since < from || since < retainedAfter
        ? undefined
        : entriesSince(changedLogs[ordinal], since)
    },
    /**
     * Starts logging changes of one component, for sparse `added`/`changed`
     * queries. Changes before this point are found by scanning instead.
     */
    trackChanges: (ordinal: number): void => {
      if (changedLogFrom[ordinal] === undefined) {
        changedLogFrom[ordinal] = tick
      }
    },
    removedSince: (ordinal: number, since: number): ReadonlyArray<number> => entriesSince(removedLogs[ordinal], since),
    despawnedSince: (since: number): ReadonlyArray<number> => entriesSince(despawnedLog, since),
    /** Makes `reader` hold removal records of `ordinal` until it has read them. */
    registerRemovedReader: (ordinal: number, reader: LifecycleCursor): void => {
      let readers = removedReaders[ordinal]
      if (readers === undefined) {
        readers = new Set()
        removedReaders[ordinal] = readers
      }
      readers.add(reader)
    },
    /** Makes `reader` hold despawn records until it has read them. */
    registerDespawnedReader: (reader: LifecycleCursor): void => {
      despawnedReaders.add(reader)
    },
    /**
     * Whether removal records of `ordinal` after `since` (and after
     * `registeredAt`, when the reader started) were dropped before being read.
     */
    removedLagged: (ordinal: number, since: number, registeredAt: number): boolean => {
      const log = removedLogs[ordinal]
      return log !== undefined && log.droppedThrough > Math.max(since, registeredAt)
    },
    /** Like `removedLagged`, for despawn records. */
    despawnedLagged: (since: number, registeredAt: number): boolean =>
      despawnedLog.droppedThrough > Math.max(since, registeredAt)
  }
}
