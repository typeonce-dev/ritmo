/**
 * Cell implementations behind query slots, resources, and states.
 *
 * Cells are small prototype-based objects instead of per-call closures so a
 * query can create one set of cells per matched entity and reuse them for as
 * long as the entity keeps matching. Every read goes to live storage, so a
 * reused cell never observes a stale value.
 */
import type { ResultConstructor } from "../Descriptor.ts"
import * as Result from "../Result.ts"
import type { EntityRecord, World } from "./world.ts"
import { ABSENT } from "./world.ts"

/**
 * Validation behavior shared by every writable cell.
 */
abstract class WriteCellBase<T> {
  abstract get(): T
  abstract set(value: T): void

  /** Writes a validated candidate only on success. Backs `setRaw` / `updateRaw`. */
  writeResult<E>(result: Result.Result<T, E>): Result.Result<void, E> {
    if (result._tag === "Failure") {
      return Result.fail(result.failure)
    }
    this.set(result.success)
    return Result.succeed(undefined)
  }

  update(f: (current: T) => T): void {
    this.set(f(this.get()))
  }

}

/**
 * Adds raw-validation helpers for values owned by constructed descriptors.
 */
const withConstructor = <T, Raw, Error>(
  cell: WriteCellBase<T>,
  constructor: ResultConstructor<T, Raw, Error>
) => Object.assign(cell, {
  setRaw(raw: Raw): Result.Result<void, Error> {
    return cell.writeResult(constructor.result(raw))
  },
  updateRaw(f: (current: T) => Raw): Result.Result<void, Error> {
    return cell.writeResult(constructor.result(f(cell.get())))
  }
})

/**
 * Adds `transition` to the write cell of an entity state component: a compare-and-set
 * that writes `to` only while the current state is still `from`.
 */
const withTransition = (cell: WriteCellBase<unknown>, component: string) => Object.assign(cell, {
  transition(from: unknown, to: unknown): Result.Result<void, { readonly _tag: "EntityStateMismatch"; readonly component: string; readonly expected: unknown; readonly actual: unknown }> {
    const actual = cell.get()
    if (actual !== from) {
      return Result.fail({ _tag: "EntityStateMismatch", component, expected: from, actual })
    }
    cell.set(to)
    return Result.succeed(undefined)
  }
})

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


/** Kept out of `get` so the hot read stays small enough to inline. */
const staleRead = (record: EntityRecord, ordinal: number): never => {
  throw staleMatch(record, ordinal)
}

class ComponentReadCell {
  // The record's values array, held directly: one load per read instead of
  // two pays for the stale check. Records never replace their array.
  readonly values: Array<unknown>
  readonly ordinal: number
  readonly record: EntityRecord

  constructor(record: EntityRecord, ordinal: number) {
    this.values = record.values
    this.ordinal = ordinal
    this.record = record
  }

  get(): unknown {
    const value = this.values[this.ordinal]
    return value === ABSENT ? staleRead(this.record, this.ordinal) : value
  }
}

class ComponentWriteCell extends WriteCellBase<unknown> {
  readonly values: Array<unknown>
  readonly ordinal: number
  readonly record: EntityRecord
  readonly world: World

  constructor(record: EntityRecord, ordinal: number, world: World) {
    super()
    this.values = record.values
    this.ordinal = ordinal
    this.record = record
    this.world = world
  }

  get(): unknown {
    const value = this.values[this.ordinal]
    return value === ABSENT ? staleRead(this.record, this.ordinal) : value
  }

  set(value: unknown): void {
    if (!this.world.setComponentValue(this.record, this.ordinal, value)) staleRead(this.record, this.ordinal)
  }
}

class OptionalComponentCell {
  readonly record: EntityRecord
  readonly ordinal: number

  constructor(record: EntityRecord, ordinal: number) {
    this.record = record
    this.ordinal = ordinal
  }

  get present(): boolean {
    const values = this.record.values
    return this.ordinal < values.length && values[this.ordinal] !== ABSENT
  }

  get(): unknown {
    return this.record.values[this.ordinal]
  }

  value(): unknown {
    const value = this.record.values[this.ordinal]
    return value === ABSENT ? undefined : value
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

export const componentRead = (record: EntityRecord, ordinal: number): { get(): unknown } =>
  new ComponentReadCell(record, ordinal)

export const componentWrite = (
  record: EntityRecord,
  ordinal: number,
  world: World,
  constructor: ResultConstructor<unknown, unknown, unknown> | undefined,
  entityState: string | undefined
): WriteCellBase<unknown> => {
  const cell = new ComponentWriteCell(record, ordinal, world)
  const constructed = constructor === undefined ? cell : withConstructor(cell, constructor)
  return entityState === undefined ? constructed : withTransition(constructed, entityState)
}

export const componentOptional = (record: EntityRecord, ordinal: number): { readonly present: boolean; get(): unknown; value(): unknown } =>
  new OptionalComponentCell(record, ordinal)

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
  constructor: ResultConstructor<unknown, unknown, unknown> | undefined
): WriteCellBase<unknown> => {
  const cell = new StoreWriteCell(store, key, write)
  return constructor === undefined ? cell : withConstructor(cell, constructor)
}

/**
 * A read cell over a derived value, used for relation slots.
 */
export const derivedRead = <T>(read: () => T): { get(): T } => ({ get: read })

/**
 * A maybe-present cell over a derived value, used for optional relation slots.
 */
export const derivedOptional = <T>(
  isPresent: () => boolean,
  read: () => T
): { readonly present: boolean; get(): T; value(): T | undefined } => ({
  get present() {
    return isPresent()
  },
  get: read,
  value: () => (isPresent() ? read() : undefined)
})
