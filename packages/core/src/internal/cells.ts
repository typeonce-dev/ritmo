/**
 * Cell implementations behind query slots, resources, and states.
 *
 * Cells are small prototype-based objects instead of per-call closures so a
 * query can create one set of cells per matched entity and reuse them for as
 * long as the entity keeps matching. Every read goes to live storage (the
 * component's store pages), so a reused cell never observes a stale value.
 */
import * as Result from "../Result.ts"
import type { Construction } from "./schema.ts"
import { deepFreeze } from "./freeze.ts"
import { emptyStates } from "./states.ts"
import type { EntityRecord, Page, World } from "./world.ts"
import { ABSENT, beforeNumbersOf, holdsNumber, numbersOf, PAGE_BITS, PAGE_MASK, PAGE_SIZE, PRESENT } from "./world.ts"

/**
 * Validation behavior shared by every writable cell.
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

/** What the write cell of an entity state component needs: its name, and the shared value of each data-less state. */
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
 * A required slot is empty only when its match outlived the run that produced
 * it: the entity was despawned, or lost the component. Reading would hand out
 * the internal marker as a value, and writing would put the component back
 * without the insert path, so both fail loudly instead.
 */
const staleMatch = (record: EntityRecord, ordinal: number): Error =>
  new Error(
    `${record.nameAt(ordinal)} was used through a query match after ${record.alive ? "its entity lost it" : "its entity was despawned"}: `
    + "a match is valid during the system run that produced it; keep the entity id or a handle and resolve it again with queries.x.get(id) or queries.x.getHandle(handle)"
  )


/**
 * Whether a query handed its matches out in the running run: their cells
 * read and write only while it is `live` (`World.handOut` sets it, the end
 * of the run clears it).
 */
export interface Stamp {
  live: boolean
  /** The column accessors handed out with it: the end of the run makes them forget their page, so a kept one fails in `enter`. */
  columns?: ReadonlyArray<{ reset(): void }>
}

/** A cell used in a later run than the one its match was handed out in. */
const staleRun = (name: string): never => {
  throw new Error(
    `${name} was used through a query match from an earlier run: a match is valid during the system run that produced it; `
    + "keep the entity id or a handle and resolve it again with queries.x.get(id) or queries.x.getHandle(handle)"
  )
}

/** Kept out of `get` so the hot read stays small enough to inline. */
const staleRead = (record: EntityRecord, ordinal: number): never => {
  throw staleMatch(record, ordinal)
}

/** A cell read that failed its one hot-path check: the component is gone, or the match is from another run. */
const invalid = (record: EntityRecord, ordinal: number, value: unknown): never =>
  value === ABSENT ? staleRead(record, ordinal) : staleRun(record.nameAt(ordinal))

/**
 * Writes a component value through a cell. Inside a transaction the first
 * write to a slot keeps its old value, and commit stamps what changed. A slot without a
 * value means the match outlived its entity's component, and a stamp from
 * another run means it outlived its run: the first is the more specific cause.
 * A number goes unboxed into the page's `numbers`, so writing one allocates nothing.
 */
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
 * {@link write} for a cell made over a number: a number written over a
 * number stays in `numbers`, and every other write takes the general path.
 */
const writeNumber = (world: World, page: Page, slot: number, value: unknown, record: EntityRecord, ordinal: number, stamp: Stamp): void => {
  if (page.values[slot] !== PRESENT || typeof value !== "number" || !stamp.live) return write(world, page, slot, value, record, ordinal, stamp)
  const transaction = world.transactionState
  if (!transaction.active) return world.writeOutsideTransaction(page, slot, value)
  if (page.savedIn !== transaction.id) world.touchPage(page)
  const numbers = page.numbers
  const saved = page.saved
  const word = slot >>> 5
  const bit = 1 << (slot & 31)
  if ((saved[word]! & bit) === 0) {
    saved[word] = saved[word]! | bit
    page.beforeNumbers![slot] = numbers[slot]!
  }
  numbers[slot] = value
}

/**
 * A cell read off the hot path: the slot holds a marker (`PRESENT` for a
 * number in `numbers`, `ABSENT`) or a symbol value, or the match is from
 * another run. The hot path is one `typeof` check: both markers are symbols.
 */
const readMarked = (page: Page, slot: number, record: EntityRecord, ordinal: number, stamp: Stamp): unknown => {
  const value = page.values[slot]
  if (value === ABSENT || !stamp.live) return invalid(record, ordinal, value)
  return value === PRESENT ? page.numbers[slot] : value
}

/*
 * Cells come in two classes per access, picked by the slot's value when the
 * cell is made: one over a number, one over any other value. Both read and
 * write every value, so a slot that changes kind stays correct; the split
 * keeps each class's hot path seeing one kind, so V8 reads numbers unboxed.
 */

/** The entity's page of a component and its slot there: where its cells read. */
const pageOf = (world: World, record: EntityRecord, ordinal: number): Page => world.pageFor(ordinal, record.id)

class ComponentReadCell {
  readonly page: Page
  readonly slot: number
  readonly ordinal: number
  readonly record: EntityRecord
  readonly stamp: Stamp

  constructor(world: World, record: EntityRecord, ordinal: number, stamp: Stamp) {
    this.page = pageOf(world, record, ordinal)
    this.slot = record.id & PAGE_MASK
    this.ordinal = ordinal
    this.record = record
    this.stamp = stamp
  }

  get(): unknown {
    const value = this.page.values[this.slot]
    // One check on the hot path; `readMarked` reads numbers and names misuse.
    if (typeof value !== "symbol" && this.stamp.live) return value
    return readMarked(this.page, this.slot, this.record, this.ordinal, this.stamp)
  }
}

class NumberReadCell extends ComponentReadCell {
  override get(): unknown {
    if (this.page.values[this.slot] === PRESENT && this.stamp.live) return this.page.numbers[this.slot]
    return readMarked(this.page, this.slot, this.record, this.ordinal, this.stamp)
  }
}

class ComponentWriteCell extends WriteCellBase<unknown> {
  readonly page: Page
  readonly slot: number
  readonly ordinal: number
  readonly record: EntityRecord
  readonly world: World
  readonly stamp: Stamp

  constructor(world: World, record: EntityRecord, ordinal: number, stamp: Stamp) {
    super()
    this.page = pageOf(world, record, ordinal)
    this.slot = record.id & PAGE_MASK
    this.ordinal = ordinal
    this.record = record
    this.world = world
    this.stamp = stamp
  }

  get(): unknown {
    const value = this.page.values[this.slot]
    // One check on the hot path; `readMarked` reads numbers and names misuse.
    if (typeof value !== "symbol" && this.stamp.live) return value
    return readMarked(this.page, this.slot, this.record, this.ordinal, this.stamp)
  }

  set(value: unknown): void {
    write(this.world, this.page, this.slot, value, this.record, this.ordinal, this.stamp)
  }
}

class NumberWriteCell extends ComponentWriteCell {
  override get(): unknown {
    if (this.page.values[this.slot] === PRESENT && this.stamp.live) return this.page.numbers[this.slot]
    return readMarked(this.page, this.slot, this.record, this.ordinal, this.stamp)
  }

  override set(value: unknown): void {
    writeNumber(this.world, this.page, this.slot, value, this.record, this.ordinal, this.stamp)
  }
}

/** The cells of a runtime made with `debug`: each freezes what it writes (`deepFreeze`). */
class FreezingComponentWriteCell extends ComponentWriteCell {
  override set(value: unknown): void {
    deepFreeze(value)
    super.set(value)
  }
}

class FreezingNumberWriteCell extends NumberWriteCell {
  override set(value: unknown): void {
    deepFreeze(value)
    super.set(value)
  }
}

/**
 * The write cell of an entity state component: `setRaw` for validated resets,
 * and the compare-and-set moves `transition` (enter a state with all of its
 * fields) and `update` (change the current state's fields). Its `update`
 * replaces the unscoped one, and there is no `updateRaw`: either could write
 * any state.
 */
class EntityStateWriteCell {
  readonly page: Page
  readonly slot: number
  readonly ordinal: number
  readonly record: EntityRecord
  readonly world: World
  readonly decoder: Construction
  readonly plan: EntityStatePlan
  readonly stamp: Stamp

  constructor(world: World, record: EntityRecord, ordinal: number, stamp: Stamp, decoder: Construction, plan: EntityStatePlan) {
    this.stamp = stamp
    this.page = pageOf(world, record, ordinal)
    this.slot = record.id & PAGE_MASK
    this.ordinal = ordinal
    this.record = record
    this.world = world
    this.decoder = decoder
    this.plan = plan
  }

  get(): unknown {
    const value = this.page.values[this.slot]
    // One branch on the hot path; `invalid` names the misuse.
    if (value === ABSENT || !this.stamp.live) return invalid(this.record, this.ordinal, value)
    return value
  }

  set(value: unknown): void {
    write(this.world, this.page, this.slot, value, this.record, this.ordinal, this.stamp)
  }

  setRaw(raw: unknown): Result.Result<void, unknown> {
    const value = this.decoder.decode(raw)
    if (!value.ok) return value
    this.set(value.value)
    return moved
  }

  transition(move: { readonly from: string; readonly to: string; readonly data?: object }): Result.Result<void, EntityStateMismatch> {
    const actual = (this.get() as { readonly _tag: string })._tag
    if (actual !== move.from) return this.mismatch(move.from, actual)
    this.set(move.data === undefined ? this.plan.empty.get(move.to) ?? { _tag: move.to } : { _tag: move.to, ...move.data })
    return moved
  }

  update(change: { readonly state: string; readonly data: (current: object) => object }): Result.Result<void, EntityStateMismatch> {
    const current = this.get() as { readonly _tag: string }
    if (current._tag !== change.state) return this.mismatch(change.state, current._tag)
    this.set({ _tag: change.state, ...change.data(current) })
    return moved
  }

  private mismatch(expected: string, actual: string): Result.Result<void, EntityStateMismatch> {
    return Result.failure({ _tag: "EntityStateMismatch", component: this.plan.component, expected, actual })
  }
}

class FreezingEntityStateWriteCell extends EntityStateWriteCell {
  override set(value: unknown): void {
    deepFreeze(value)
    super.set(value)
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

/*
 * Column accessors: one per query slot, handed the row (the entity's record)
 * on each access. No object per entity: a query holds its rows, and a row is
 * an entity's one record. A dead or changed row fails the same checks a cell
 * does. Rows come in id order, so an accessor keeps the page it is on; a new
 * hand-out forgets it (`reset`), since a page's arrays only change between runs.
 */
const staleColumn = (name: string): never => {
  throw new Error(
    `The column of ${name} was used after the run that handed it out: read the query's columns again in each run with queries.x.columns()`
  )
}

/** The page of a row, for an accessor entering it. A row from another runtime may name a page this one does not have. */
const pageOfRow = (pages: Array<Page | undefined>, index: number, row: EntityRecord, ordinal: number, stamp: Stamp): Page => {
  if (!stamp.live) staleColumn(row.nameAt(ordinal))
  const page = pages[index]
  if (page === undefined) {
    throw new Error(`A row was used with the column of ${row.nameAt(ordinal)} of a runtime it does not belong to: a row is valid in the runtime whose query produced it`)
  }
  return page
}
const noNumbers = new Float64Array(PAGE_SIZE).fill(NaN)
const noSaved = new Uint32Array(PAGE_SIZE >>> 5)
const noValues: Array<unknown> = Array.from({ length: PAGE_SIZE }, () => ABSENT)

class ColumnRead {
  readonly pages: Array<Page | undefined>
  readonly ordinal: number
  readonly stamp: Stamp
  pageIndex = -1
  values: Array<unknown> = noValues

  constructor(pages: Array<Page | undefined>, ordinal: number, stamp: Stamp) {
    this.pages = pages
    this.ordinal = ordinal
    this.stamp = stamp
  }

  reset(): void {
    this.pageIndex = -1
  }

  enter(index: number, row: EntityRecord): void {
    this.values = pageOfRow(this.pages, index, row, this.ordinal, this.stamp).values
    this.pageIndex = index
  }

  get(row: EntityRecord): unknown {
    const id = row.id
    const index = id >>> PAGE_BITS
    if (index !== this.pageIndex) this.enter(index, row)
    const value = this.values[id & PAGE_MASK]
    if (typeof value !== "symbol") return value
    return readMarked(this.pages[index]!, id & PAGE_MASK, row, this.ordinal, this.stamp)
  }
}

class NumberColumnRead {
  readonly pages: Array<Page | undefined>
  readonly ordinal: number
  readonly stamp: Stamp
  pageIndex = -1
  numbers: Float64Array = noNumbers

  constructor(pages: Array<Page | undefined>, ordinal: number, stamp: Stamp) {
    this.pages = pages
    this.ordinal = ordinal
    this.stamp = stamp
  }

  reset(): void {
    this.pageIndex = -1
  }

  enter(index: number, row: EntityRecord): void {
    this.numbers = pageOfRow(this.pages, index, row, this.ordinal, this.stamp).numbers
    this.pageIndex = index
  }

  get(row: EntityRecord): unknown {
    const id = row.id
    const index = id >>> PAGE_BITS
    if (index !== this.pageIndex) this.enter(index, row)
    const value = this.numbers[id & PAGE_MASK]!
    if (value === value) return value
    return readMarked(this.pages[index]!, id & PAGE_MASK, row, this.ordinal, this.stamp)
  }
}

class ColumnWrite extends ColumnRead {
  readonly world: World
  // The page the running transaction has registered, with the arrays a first write saves into.
  writeIndex = -1
  saved: Uint32Array = noSaved
  before: Array<unknown> = noValues

  constructor(world: World, pages: Array<Page | undefined>, ordinal: number, stamp: Stamp) {
    super(pages, ordinal, stamp)
    this.world = world
  }

  override reset(): void {
    this.pageIndex = -1
    this.writeIndex = -1
  }

  enterWrite(index: number, row: EntityRecord): boolean {
    const page = pageOfRow(this.pages, index, row, this.ordinal, this.stamp)
    const world = this.world
    const transaction = world.transactionState
    if (!transaction.active) return false
    if (page.savedIn !== transaction.id) world.touchPage(page)
    // Commit checks `before` per slot on this page from now on.
    page.savedObjects = true
    this.writeIndex = index
    this.pageIndex = index
    this.values = page.values
    this.saved = page.saved
    this.before = page.before!
    return true
  }

  set(row: EntityRecord, value: unknown): void {
    const id = row.id
    const index = id >>> PAGE_BITS
    if (index !== this.writeIndex && !this.enterWrite(index, row)) return this.slowSet(row, value)
    const slot = id & PAGE_MASK
    const values = this.values
    const old = values[slot]
    // A marker (absent, or a number kept unboxed) or a number written: the general path.
    if (typeof old === "symbol" || typeof value === "number") return this.slowSet(row, value)
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

  slowSet(row: EntityRecord, value: unknown): void {
    const id = row.id
    write(this.world, this.pages[id >>> PAGE_BITS]!, id & PAGE_MASK, value, row, this.ordinal, this.stamp)
    this.reset()
  }

  update(row: EntityRecord, f: (current: unknown) => unknown): void {
    this.set(row, f(this.get(row)))
  }
}

class NumberColumnWrite {
  readonly pages: Array<Page | undefined>
  readonly ordinal: number
  readonly stamp: Stamp
  readonly world: World
  pageIndex = -1
  numbers: Float64Array = noNumbers
  // The page the running transaction has registered, with the arrays a first write saves into.
  writeIndex = -1
  saved: Uint32Array = noSaved
  beforeNumbers: Float64Array = noNumbers

  constructor(world: World, pages: Array<Page | undefined>, ordinal: number, stamp: Stamp) {
    this.pages = pages
    this.ordinal = ordinal
    this.stamp = stamp
    this.world = world
  }

  reset(): void {
    this.pageIndex = -1
    this.writeIndex = -1
  }

  enter(index: number, row: EntityRecord): void {
    this.numbers = pageOfRow(this.pages, index, row, this.ordinal, this.stamp).numbers
    this.pageIndex = index
  }

  /** Registers the page with the running transaction; false when no transaction runs or the page holds no numbers yet. */
  enterWrite(index: number, row: EntityRecord): boolean {
    const page = pageOfRow(this.pages, index, row, this.ordinal, this.stamp)
    const world = this.world
    const transaction = world.transactionState
    if (!transaction.active) return false
    if (page.savedIn !== transaction.id) world.touchPage(page)
    if (page.beforeNumbers === undefined) return false
    this.writeIndex = index
    this.pageIndex = index
    this.numbers = page.numbers
    this.saved = page.saved
    this.beforeNumbers = page.beforeNumbers
    return true
  }

  get(row: EntityRecord): unknown {
    const id = row.id
    const index = id >>> PAGE_BITS
    if (index !== this.pageIndex) this.enter(index, row)
    const value = this.numbers[id & PAGE_MASK]!
    if (value === value) return value
    return readMarked(this.pages[index]!, id & PAGE_MASK, row, this.ordinal, this.stamp)
  }

  set(row: EntityRecord, value: unknown): void {
    const id = row.id
    const index = id >>> PAGE_BITS
    if (index !== this.writeIndex && !this.enterWrite(index, row)) return this.slowSet(row, value)
    const slot = id & PAGE_MASK
    const numbers = this.numbers
    const old = numbers[slot]!
    if (old !== old || typeof value !== "number") return this.slowSet(row, value)
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

  /** Every write that is not a number over a number: the general path, then forget the page (its arrays may have changed). */
  slowSet(row: EntityRecord, value: unknown): void {
    const id = row.id
    write(this.world, this.pages[id >>> PAGE_BITS]!, id & PAGE_MASK, value, row, this.ordinal, this.stamp)
    this.reset()
  }

  update(row: EntityRecord, f: (current: unknown) => unknown): void {
    this.set(row, f(this.get(row)))
  }
}

/** The column accessors of a runtime made with `debug`: each freezes what it writes (`deepFreeze`). */
class FreezingColumnWrite extends ColumnWrite {
  override set(row: EntityRecord, value: unknown): void {
    deepFreeze(value)
    super.set(row, value)
  }
}

class FreezingNumberColumnWrite extends NumberColumnWrite {
  override set(row: EntityRecord, value: unknown): void {
    deepFreeze(value)
    super.set(row, value)
  }
}

/** A slot's column accessor; `numeric` picks the class that sees numbers (both read and write every value). */
export const columnRead = (world: World, ordinal: number, stamp: Stamp, numeric: boolean): { reset(): void } =>
  new (numeric ? NumberColumnRead : ColumnRead)(world.pagesOf(ordinal), ordinal, stamp)

export const columnWrite = (world: World, ordinal: number, stamp: Stamp, numeric: boolean): { reset(): void } =>
  new (world.freezesValues
    ? (numeric ? FreezingNumberColumnWrite : FreezingColumnWrite)
    : (numeric ? NumberColumnWrite : ColumnWrite))(world, world.pagesOf(ordinal), ordinal, stamp)

export const componentRead = (world: World, record: EntityRecord, ordinal: number, stamp: Stamp): { get(): unknown } =>
  holdsNumber(pageOf(world, record, ordinal), record.id & PAGE_MASK)
    ? new NumberReadCell(world, record, ordinal, stamp)
    : new ComponentReadCell(world, record, ordinal, stamp)

export const componentWrite = (
  world: World,
  record: EntityRecord,
  ordinal: number,
  stamp: Stamp,
  constructor: Construction | undefined,
  entityState: EntityStatePlan | undefined
): object => {
  const freezes = world.freezesValues
  if (entityState !== undefined && constructor !== undefined) {
    return freezes
      ? new FreezingEntityStateWriteCell(world, record, ordinal, stamp, constructor, entityState)
      : new EntityStateWriteCell(world, record, ordinal, stamp, constructor, entityState)
  }
  const cell = holdsNumber(pageOf(world, record, ordinal), record.id & PAGE_MASK)
    ? new (freezes ? FreezingNumberWriteCell : NumberWriteCell)(world, record, ordinal, stamp)
    : new (freezes ? FreezingComponentWriteCell : ComponentWriteCell)(world, record, ordinal, stamp)
  return constructor === undefined ? cell : withConstructor(cell, constructor)
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

/**
 * A read cell over a derived value, used for relation slots.
 */
export const derivedRead = <T>(world: World, stamp: Stamp, name: string, read: () => T): { get(): T } => {
  return {
    get: () => {
      if (!stamp.live) staleRun(name)
      return read()
    }
  }
}

/*
 * An optional slot is an accessor on a match's `data`: the slot's cell while
 * it is filled, and `undefined` otherwise. Presence is read on every access,
 * so a match reused across runs follows the entity gaining or losing the
 * component, and reading the slot of a match from an earlier run fails like
 * reading its cell. The cell is kept under a hidden key, and one getter per
 * query slot serves every match, so all of a query's matches share one shape.
 */

/** What an optional relation slot keeps under its hidden key: the cell, and whether it is filled. */
export interface HeldCell {
  readonly cell: unknown
  readonly held: () => boolean
}

/** The getter of an optional component slot whose cell (from {@link componentRead}) is kept under `key`. */
export const optionalComponentGetter = (stamp: Stamp, key: symbol): (this: object) => unknown =>
  function (this: object) {
    const cell = (this as Record<symbol, ComponentReadCell>)[key]!
    if (!stamp.live) staleRun(cell.record.nameAt(cell.ordinal))
    return cell.page.values[cell.slot] === ABSENT ? undefined : cell
  }

/** The getter of an optional relation slot whose {@link HeldCell} is kept under `key`. */
export const optionalHeldGetter = (stamp: Stamp, key: symbol, name: string): (this: object) => unknown =>
  function (this: object) {
    if (!stamp.live) staleRun(name)
    const held = (this as Record<symbol, HeldCell>)[key]!
    return held.held() ? held.cell : undefined
  }

/** Puts an optional slot on `data`: `hidden` under `key`, read through `getter`. */
export const defineOptional = (data: object, slot: string, key: symbol, hidden: unknown, getter: (this: object) => unknown): void => {
  Object.defineProperty(data, key, { value: hidden })
  Object.defineProperty(data, slot, { enumerable: true, get: getter })
}
