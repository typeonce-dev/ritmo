/**
 * Slot accessors behind a query's `data`, and cells behind resources and states.
 *
 * A query makes one accessor per selection slot and hands it the entity (its
 * record) on each access, so no object exists per entity. Every read goes to
 * live storage (the component's store pages).
 */
import * as Result from "../Result.ts"
import type { Construction } from "./schema.ts"
import { deepFreeze } from "./freeze.ts"
import { emptyStates } from "./states.ts"
import type { EntityRecord, Page, World } from "./world.ts"
import { ABSENT, beforeNumbersOf, numbersOf, PAGE_BITS, PAGE_MASK, PAGE_SIZE, PRESENT } from "./world.ts"

/**
 * Validation behavior shared by every writable store cell.
 */
abstract class WriteCellBase<T> {
  abstract get(): T
  abstract set(value: T): void

  /** Writes a validated candidate only on success. Backs `setRaw` / `updateRaw`. */
  writeResult<E>(result: Result.Result<T, E>): Result.Result<void, E> {
    if (!result.ok) {
      return Result.failure(result.error)
    }
    this.set(result.value)
    return Result.success(undefined)
  }

  update(f: (current: T) => T): void {
    this.set(f(this.get()))
  }
}

/**
 * Adds raw-validation helpers for values owned by constructed descriptors.
 */
const withConstructor = <T>(
  cell: WriteCellBase<T>,
  constructor: Construction
) => Object.assign(cell, {
  setRaw(raw: unknown): Result.Result<void, unknown> {
    return cell.writeResult(constructor.decode(raw) as Result.Result<T, unknown>)
  },
  updateRaw(f: (current: T) => unknown): Result.Result<void, unknown> {
    return cell.writeResult(constructor.decode(f(cell.get())) as Result.Result<T, unknown>)
  }
})

/** What the write slot of an entity state component needs: its name, and the shared value of each data-less state. */
export interface EntityStatePlan {
  readonly component: string
  readonly empty: ReadonlyMap<string, { readonly _tag: string }>
}

export const entityStatePlan = (component: string, states: Parameters<typeof emptyStates>[0]): EntityStatePlan => ({
  component,
  empty: emptyStates(states)
})

type EntityStateMismatch = { readonly _tag: "EntityStateMismatch"; readonly component: string; readonly expected: string; readonly actual: string }

// Every successful move returns the same value: a per-entity move in a hot loop allocates no result.
const moved: Result.Result<void, never> = Object.freeze(Result.success(undefined))

/**
 * Whether a query handed its `data` out in the running run, and the accessors
 * it made: the end of the run clears `live` and makes them forget their page
 * (`World.handOut`, `World.endRun`), so a kept one fails when it enters a page.
 */
export interface Stamp {
  live: boolean
  accessors?: ReadonlyArray<{ reset(): void }>
}

/** A slot used in a later run than the one that handed it out. */
const staleRun = (name: string): never => {
  throw new Error(
    `The data of ${name} was used after the run that handed it out: read queries.x.data again in each run, or keep plain values from queries.x.rows()`
  )
}

/**
 * A required slot is empty only when its entity outlived what the query proved:
 * it was despawned, or lost the component. Reading would hand out the internal
 * marker as a value, and writing would put the component back without the insert
 * path, so both fail loudly instead. `name` is the slot's component or relation;
 * a debug runtime's `data` throws it too for a despawned entity whose id is used
 * again.
 */
export const staleEntity = (name: string, record: EntityRecord): never => {
  throw new Error(
    `${name} was used for an entity ${record.alive ? "that lost it" : "that was despawned"}: `
    + "to follow an entity across runs, keep its id and resolve it again with queries.x.get(id), which is fallible"
  )
}

/** A slot access that failed its one hot-path check: the component is gone, or the slot is from another run. */
const invalid = (record: EntityRecord, ordinal: number, value: unknown): never =>
  value === ABSENT ? staleEntity(record.nameAt(ordinal), record) : staleRun(record.nameAt(ordinal))

// `typeof` first: an object or string value skips the comparison with the imported marker.
const isPresent = (value: unknown): boolean => typeof value === "symbol" && value === PRESENT

/**
 * A slot's number is about to be replaced by another kind of value. Saved as a
 * number, it moves to `before`, since a slot saved as a number still holds
 * one; `numbers` holds NaN for a slot without a number. Kept out of `write` so
 * the common writes stay small enough to inline.
 */
const replaceNumber = (page: Page, slot: number): void => {
  if (isPresent(page.before![slot])) {
    page.before![slot] = page.beforeNumbers![slot]
    page.savedObjects = true
  }
  page.numbers[slot] = NaN
}

/**
 * Writes a component value: the general path. Inside a transaction the first
 * write to a slot keeps its old value, and commit stamps what changed. A slot
 * without a value means the entity lost its component, and a stamp from another
 * run means the accessor outlived its run: the first is the more specific cause.
 * A number goes unboxed into the page's `numbers`, so writing one allocates nothing.
 */
const write = (world: World, page: Page, slot: number, value: unknown, record: EntityRecord, ordinal: number, stamp: Stamp): void => {
  const values = page.values
  const current = values[slot]
  if (current === ABSENT || !stamp.live) invalid(record, ordinal, current)
  const transaction = world.transactionState
  if (!transaction.active) return world.writeOutsideTransaction(page, slot, value)
  if (page.savedIn !== transaction.id) world.touchPage(page)
  // The slot's first write in the transaction keeps its old value for commit and rollback.
  const saved = page.saved
  const word = slot >>> 5
  const bit = 1 << (slot & 31)
  if ((saved[word]! & bit) === 0) {
    saved[word] = saved[word]! | bit
    if (isPresent(current)) {
      beforeNumbersOf(page)[slot] = page.numbers[slot]!
    } else {
      page.before![slot] = current
      page.savedObjects = true
    }
  }
  if (typeof value === "number") {
    if (isPresent(current)) {
      page.numbers[slot] = value
    } else {
      numbersOf(page)[slot] = value
      values[slot] = PRESENT
    }
  } else {
    if (isPresent(current)) replaceNumber(page, slot)
    values[slot] = value
  }
}

/**
 * A slot read off the hot path: the slot holds a marker (`PRESENT` for a number
 * in `numbers`, `ABSENT`) or a symbol value, or the number is NaN.
 */
const readMarked = (page: Page, slot: number, record: EntityRecord, ordinal: number, stamp: Stamp): unknown => {
  const value = page.values[slot]
  if (value === ABSENT || !stamp.live) return invalid(record, ordinal, value)
  return value === PRESENT ? page.numbers[slot] : value
}

const noNumbers = new Float64Array(PAGE_SIZE).fill(NaN)
const noSaved = new Uint32Array(PAGE_SIZE >>> 5)
const noValues: Array<unknown> = Array.from({ length: PAGE_SIZE }, () => ABSENT)

/**
 * The page of an entity, for an accessor entering it: the one place a slot kept
 * past its run fails, since the end of a run makes every accessor forget its
 * page. An entity from another runtime may name a page this one does not have.
 */
const pageOfEntity = (pages: Array<Page | undefined>, index: number, record: EntityRecord, ordinal: number, stamp: Stamp): Page => {
  if (!stamp.live) staleRun(record.nameAt(ordinal))
  const page = pages[index]
  if (page === undefined) {
    throw new Error(`An entity was used with the data of ${record.nameAt(ordinal)} of a runtime it does not belong to: an entity is valid in the runtime whose query produced it`)
  }
  return page
}

/*
 * Accessors come in two classes per access, picked by the values a query's
 * entities hold when it makes them: one over numbers, one over any other value.
 * Both read and write every value, so a slot that changes kind stays correct;
 * the split keeps each class's hot path seeing one kind.
 *
 * An entity comes in id order, so an accessor keeps the page it is on. A page's
 * arrays only change between runs, except that the first number on a page
 * creates its `numbers`: a read then misses into `readMarked`, and a write takes
 * `slowSet`, which forgets the page.
 */
class ReadAccessor {
  readonly pages: Array<Page | undefined>
  readonly ordinal: number
  readonly stamp: Stamp
  pageIndex = -1
  values: Array<unknown> = noValues

  constructor(world: World, ordinal: number, stamp: Stamp) {
    this.pages = world.pagesOf(ordinal)
    this.ordinal = ordinal
    this.stamp = stamp
  }

  reset(): void {
    this.pageIndex = -1
  }

  enter(index: number, record: EntityRecord): void {
    this.values = pageOfEntity(this.pages, index, record, this.ordinal, this.stamp).values
    this.pageIndex = index
  }

  get(record: EntityRecord): unknown {
    const id = record.id
    const index = id >>> PAGE_BITS
    if (index !== this.pageIndex) this.enter(index, record)
    const value = this.values[id & PAGE_MASK]
    if (typeof value !== "symbol") return value
    return readMarked(this.pages[index]!, id & PAGE_MASK, record, this.ordinal, this.stamp)
  }
}

class NumberReadAccessor {
  readonly pages: Array<Page | undefined>
  readonly ordinal: number
  readonly stamp: Stamp
  pageIndex = -1
  numbers: Float64Array = noNumbers

  constructor(world: World, ordinal: number, stamp: Stamp) {
    this.pages = world.pagesOf(ordinal)
    this.ordinal = ordinal
    this.stamp = stamp
  }

  reset(): void {
    this.pageIndex = -1
  }

  enter(index: number, record: EntityRecord): void {
    this.numbers = pageOfEntity(this.pages, index, record, this.ordinal, this.stamp).numbers
    this.pageIndex = index
  }

  get(record: EntityRecord): unknown {
    const id = record.id
    const index = id >>> PAGE_BITS
    if (index !== this.pageIndex) this.enter(index, record)
    const value = this.numbers[id & PAGE_MASK]!
    if (value === value) return value
    return readMarked(this.pages[index]!, id & PAGE_MASK, record, this.ordinal, this.stamp)
  }
}

class WriteAccessor extends ReadAccessor {
  readonly world: World
  // The page the running transaction has registered, with the arrays a write uses: reads move their own.
  writeIndex = -1
  writeValues: Array<unknown> = noValues
  saved: Uint32Array = noSaved
  before: Array<unknown> = noValues

  constructor(world: World, ordinal: number, stamp: Stamp) {
    super(world, ordinal, stamp)
    this.world = world
  }

  override reset(): void {
    this.pageIndex = -1
    this.writeIndex = -1
  }

  enterWrite(index: number, record: EntityRecord): boolean {
    const page = pageOfEntity(this.pages, index, record, this.ordinal, this.stamp)
    const world = this.world
    const transaction = world.transactionState
    if (!transaction.active) return false
    if (page.savedIn !== transaction.id) world.touchPage(page)
    // Commit checks `before` per slot on this page from now on.
    page.savedObjects = true
    this.writeIndex = index
    this.writeValues = page.values
    this.saved = page.saved
    this.before = page.before!
    return true
  }

  set(record: EntityRecord, value: unknown): void {
    const id = record.id
    const index = id >>> PAGE_BITS
    if (index !== this.writeIndex && !this.enterWrite(index, record)) return this.slowSet(record, value)
    const slot = id & PAGE_MASK
    const values = this.writeValues
    const old = values[slot]
    // A marker (absent, or a number kept unboxed) or a number written: the general path.
    if (typeof old === "symbol" || typeof value === "number") return this.slowSet(record, value)
    const saved = this.saved
    const word = slot >>> 5
    const bit = 1 << (slot & 31)
    const bits = saved[word]!
    if ((bits & bit) === 0) {
      saved[word] = bits | bit
      this.before[slot] = old
    }
    values[slot] = value
  }

  /** Every other write: the general path, then forget the page, whose arrays may have changed. */
  slowSet(record: EntityRecord, value: unknown): void {
    const id = record.id
    write(this.world, this.pages[id >>> PAGE_BITS]!, id & PAGE_MASK, value, record, this.ordinal, this.stamp)
    this.reset()
  }

  update(record: EntityRecord, f: (current: unknown) => unknown): void {
    this.set(record, f(this.get(record)))
  }
}

class NumberWriteAccessor extends NumberReadAccessor {
  readonly world: World
  // The page the running transaction has registered, with the arrays a write uses: reads move their own.
  writeIndex = -1
  writeNumbers: Float64Array = noNumbers
  saved: Uint32Array = noSaved
  beforeNumbers: Float64Array = noNumbers

  constructor(world: World, ordinal: number, stamp: Stamp) {
    super(world, ordinal, stamp)
    this.world = world
  }

  override reset(): void {
    this.pageIndex = -1
    this.writeIndex = -1
  }

  /** Registers the page with the running transaction; false when none runs or the page holds no numbers yet. */
  enterWrite(index: number, record: EntityRecord): boolean {
    const page = pageOfEntity(this.pages, index, record, this.ordinal, this.stamp)
    const world = this.world
    const transaction = world.transactionState
    if (!transaction.active) return false
    if (page.savedIn !== transaction.id) world.touchPage(page)
    if (page.beforeNumbers === undefined) return false
    this.writeIndex = index
    this.writeNumbers = page.numbers
    this.saved = page.saved
    this.beforeNumbers = page.beforeNumbers
    return true
  }

  set(record: EntityRecord, value: unknown): void {
    const id = record.id
    const index = id >>> PAGE_BITS
    if (index !== this.writeIndex && !this.enterWrite(index, record)) return this.slowSet(record, value)
    const slot = id & PAGE_MASK
    const numbers = this.writeNumbers
    const old = numbers[slot]!
    if (old !== old || typeof value !== "number") return this.slowSet(record, value)
    const saved = this.saved
    const word = slot >>> 5
    const bit = 1 << (slot & 31)
    const bits = saved[word]!
    if ((bits & bit) === 0) {
      saved[word] = bits | bit
      this.beforeNumbers[slot] = old
    }
    numbers[slot] = value
  }

  /** Every write that is not a number over a number: the general path, then forget the page, whose arrays may have changed. */
  slowSet(record: EntityRecord, value: unknown): void {
    const id = record.id
    write(this.world, this.pages[id >>> PAGE_BITS]!, id & PAGE_MASK, value, record, this.ordinal, this.stamp)
    this.reset()
  }

  update(record: EntityRecord, f: (current: unknown) => unknown): void {
    this.set(record, f(this.get(record)))
  }
}

/** The accessors of a runtime made with `debug`: each freezes what it writes (`deepFreeze`). */
class FreezingWriteAccessor extends WriteAccessor {
  override set(record: EntityRecord, value: unknown): void {
    deepFreeze(value)
    super.set(record, value)
  }
}

class FreezingNumberWriteAccessor extends NumberWriteAccessor {
  override set(record: EntityRecord, value: unknown): void {
    deepFreeze(value)
    super.set(record, value)
  }
}

type AnyWriteAccessor = WriteAccessor | NumberWriteAccessor

/** The read accessor of a required slot. */
export const readAccessor = (world: World, ordinal: number, stamp: Stamp, numeric: boolean): { reset(): void } =>
  new (numeric ? NumberReadAccessor : ReadAccessor)(world, ordinal, stamp)

const plainWrite = (world: World, ordinal: number, stamp: Stamp, numeric: boolean): AnyWriteAccessor =>
  new (world.freezesValues
    ? (numeric ? FreezingNumberWriteAccessor : FreezingWriteAccessor)
    : (numeric ? NumberWriteAccessor : WriteAccessor))(world, ordinal, stamp)

/** Adds `setRaw` and `updateRaw` for a component owned by a constructed descriptor. */
const withRawWrites = <A extends AnyWriteAccessor>(accessor: A, constructor: Construction) => Object.assign(accessor, {
  setRaw(record: EntityRecord, raw: unknown): Result.Result<void, unknown> {
    const decoded = constructor.decode(raw)
    if (!decoded.ok) return Result.failure(decoded.error)
    accessor.set(record, decoded.value)
    return moved
  },
  updateRaw(record: EntityRecord, f: (current: unknown) => unknown): Result.Result<void, unknown> {
    const decoded = constructor.decode(f(accessor.get(record)))
    if (!decoded.ok) return Result.failure(decoded.error)
    accessor.set(record, decoded.value)
    return moved
  }
})

/**
 * The write accessor of an entity state component: `setRaw` for validated
 * resets, and the compare-and-set moves `transition` (enter a state with all of
 * its fields) and `update` (change the current state's fields). Its `update`
 * replaces the unscoped one, and there is no `updateRaw`: either could write
 * any state.
 */
class EntityStateAccessor {
  readonly accessor: WriteAccessor
  readonly decoder: Construction
  readonly plan: EntityStatePlan

  constructor(accessor: WriteAccessor, decoder: Construction, plan: EntityStatePlan) {
    this.accessor = accessor
    this.decoder = decoder
    this.plan = plan
  }

  reset(): void {
    this.accessor.reset()
  }

  get(record: EntityRecord): unknown {
    return this.accessor.get(record)
  }

  set(record: EntityRecord, value: unknown): void {
    this.accessor.set(record, value)
  }

  setRaw(record: EntityRecord, raw: unknown): Result.Result<void, unknown> {
    const value = this.decoder.decode(raw)
    if (!value.ok) return value
    this.set(record, value.value)
    return moved
  }

  transition(record: EntityRecord, move: { readonly from: string; readonly to: string; readonly data?: object }): Result.Result<void, EntityStateMismatch> {
    const actual = (this.get(record) as { readonly _tag: string })._tag
    if (actual !== move.from) return this.mismatch(move.from, actual)
    this.set(record, move.data === undefined ? this.plan.empty.get(move.to) ?? { _tag: move.to } : { _tag: move.to, ...move.data })
    return moved
  }

  update(record: EntityRecord, change: { readonly state: string; readonly data: (current: object) => object }): Result.Result<void, EntityStateMismatch> {
    const current = this.get(record) as { readonly _tag: string }
    if (current._tag !== change.state) return this.mismatch(change.state, current._tag)
    this.set(record, { _tag: change.state, ...change.data(current) })
    return moved
  }

  private mismatch(expected: string, actual: string): Result.Result<void, EntityStateMismatch> {
    return Result.failure({ _tag: "EntityStateMismatch", component: this.plan.component, expected, actual })
  }
}

/** The write accessor of a required slot: plain, constructed, or entity state. */
export const writeAccessor = (
  world: World,
  ordinal: number,
  stamp: Stamp,
  numeric: boolean,
  constructor: Construction | undefined,
  entityState: EntityStatePlan | undefined
): { reset(): void } => {
  if (entityState !== undefined && constructor !== undefined) {
    return new EntityStateAccessor(plainWrite(world, ordinal, stamp, false) as WriteAccessor, constructor, entityState)
  }
  const accessor = plainWrite(world, ordinal, stamp, numeric)
  return constructor === undefined ? accessor : withRawWrites(accessor, constructor)
}

/** The accessor of an optional slot: `undefined` when the entity lacks the component. */
export const optionalAccessor = (world: World, ordinal: number, stamp: Stamp): { get(record: EntityRecord): unknown; has(record: EntityRecord): boolean } => {
  const pages = world.pagesOf(ordinal)
  const slotOf = (record: EntityRecord): unknown => {
    if (!stamp.live) staleRun(record.nameAt(ordinal))
    const page = pages[record.id >>> PAGE_BITS]
    return page === undefined ? ABSENT : page.values[record.id & PAGE_MASK]
  }
  return {
    get: (record) => {
      const value = slotOf(record)
      if (value === ABSENT) return undefined
      return value === PRESENT ? pages[record.id >>> PAGE_BITS]!.numbers[record.id & PAGE_MASK] : value
    },
    has: (record) => slotOf(record) !== ABSENT
  }
}

/**
 * The accessor of a relation slot: reads through `read`, which gives `undefined`
 * when the entity lacks the relation. A required slot throws then: its entity
 * outlived what the query proved.
 */
export const relationAccessor = <T>(stamp: Stamp, name: string, required: boolean, read: (id: number) => T | undefined): { get(record: EntityRecord): T | undefined; has(record: EntityRecord): boolean } => {
  const held = (record: EntityRecord): T | undefined => {
    if (!stamp.live) staleRun(name)
    return read(record.id)
  }
  return {
    get: (record) => {
      const value = held(record)
      if (value === undefined && required) staleEntity(name, record)
      return value
    },
    has: (record) => held(record) !== undefined
  }
}

class StoreReadCell {
  readonly store: Map<symbol, unknown>
  readonly key: symbol

  constructor(store: Map<symbol, unknown>, key: symbol) {
    this.store = store
    this.key = key
  }

  get(): unknown {
    return this.store.get(this.key)
  }
}

class StoreWriteCell extends WriteCellBase<unknown> {
  readonly store: Map<symbol, unknown>
  readonly key: symbol
  readonly write: (key: symbol, value: unknown) => void

  constructor(store: Map<symbol, unknown>, key: symbol, write: (key: symbol, value: unknown) => void) {
    super()
    this.store = store
    this.key = key
    this.write = write
  }

  get(): unknown {
    return this.store.get(this.key)
  }

  set(value: unknown): void {
    this.write(this.key, value)
  }
}

export const storeRead = (store: Map<symbol, unknown>, key: symbol): { get(): unknown } =>
  new StoreReadCell(store, key)

/**
 * A writable cell over resource or state storage. Writes go through `write`
 * so the runtime can journal them for rollback.
 */
export const storeWrite = (
  store: Map<symbol, unknown>,
  key: symbol,
  write: (key: symbol, value: unknown) => void,
  constructor: Construction | undefined
): WriteCellBase<unknown> => {
  const cell = new StoreWriteCell(store, key, write)
  return constructor === undefined ? cell : withConstructor(cell, constructor)
}
