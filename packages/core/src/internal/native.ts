/** Versioned native-only seams. Deliberately absent from the public Game types. */
import type { EntityRecord } from "./world.ts"
export const nativeSymbol = Symbol.for("@typeonce/ritmo/native@0.8")
export type Layouts = Readonly<Record<string, readonly string[] | null>>
const registrations = new WeakMap<object, Layouts>()
/** Set only by the all-columnar test project; runtime packages never read environment globals. */
export const nativeTesting = { auto: false }
export const registerLayouts = (schema: { components: object }, layouts: Layouts): void => {
  const names = new Set(Object.values(schema.components).map((d: { name: string }) => d.name))
  const previous = registrations.get(schema) ?? {}
  for (const [name, fields] of Object.entries(layouts)) {
    if (!names.has(name)) throw new Error(`${name}: register a component from this Game's schema`)
    if (fields !== null && (!Array.isArray(fields) || fields.some((f) => typeof f !== "string") || new Set(fields).size !== fields.length)) throw new Error(`${name}: provide unique numeric field names or null for a scalar`)
    if (Object.prototype.hasOwnProperty.call(previous, name) && JSON.stringify(previous[name]) !== JSON.stringify(fields)) throw new Error(`${name}: native layout already registered with different fields; rebuild the bundle and binary together`)
  }
  registrations.set(schema, { ...previous, ...layouts })
}
export interface NativeJournal { commit(): void; rollback(): void; release(): void }
export interface Column { readonly name: string; readonly fields: readonly string[] | null; values: Float64Array[]; marks: Int32Array }
export class Columns {
  readonly components = new Map<number, Column>()
  readonly slots = new WeakMap<EntityRecord, number>()
  readonly records = new Map<EntityRecord, number>()
  readonly #free: number[] = []
  readonly #names: readonly string[]
  readonly #absent: symbol
  readonly #auto: boolean
  #count = 0
  #capacity = 64
  constructor(names: readonly string[], layouts: Layouts, absent: symbol, auto: boolean) {
    this.#names = names; this.#absent = absent; this.#auto = auto
    names.forEach((name, ordinal) => { if (Object.prototype.hasOwnProperty.call(layouts, name)) this.#add(ordinal, layouts[name]!) })
  }
  #add(ordinal: number, fields: readonly string[] | null): void {
    const column: Column = { name: this.#names[ordinal]!, fields, values: Array.from({ length: fields?.length ?? 1 }, () => new Float64Array(this.#capacity)), marks: new Int32Array(this.#capacity * 3).fill(-1) }
    this.components.set(ordinal, column)
    for (const [record, slot] of this.records) this.#bind(record, slot, ordinal, column)
  }
  #bind(record: EntityRecord, slot: number, ordinal: number, column: Column): void {
    const previous = record.values[ordinal]
    let present = false
    const write = (value: unknown): void => {
      if (value === this.#absent) { present = false; return }
      const valid = column.fields === null ? typeof value === "number" : value !== null && typeof value === "object" && Object.keys(value).length === column.fields.length && column.fields.every((f) => Object.prototype.hasOwnProperty.call(value, f) && typeof (value as Record<string, unknown>)[f] === "number")
      if (!valid) throw new Error(`${column.name}: native layout does not match its numeric fields; rebuild the native bundle`)
      if (column.fields === null) column.values[0]![slot] = value as number
      else column.fields.forEach((field, index) => { column.values[index]![slot] = (value as Record<string, number>)[field]! })
      present = true
    }
    Object.defineProperty(record.values, ordinal, { configurable: true, enumerable: true,
      get: () => {
        if (!present) return this.#absent
        if (column.fields === null) return column.values[0]![slot]
        return Object.freeze(Object.fromEntries(column.fields.map((f, i) => [f, column.values[i]![slot]!])))
      }, set: write })
    for (let i = 0; i < 3; i++) {
      column.marks[slot * 3 + i] = record.marks[ordinal * 3 + i] ?? -1
      Object.defineProperty(record.marks, ordinal * 3 + i, { configurable: true, enumerable: true, get: () => column.marks[slot * 3 + i], set: (value: number) => { column.marks[slot * 3 + i] = value } })
    }
    if (previous !== this.#absent) write(previous)
  }
  attach(record: EntityRecord, initial: ReadonlyArray<readonly [number, unknown]>): void {
    if (this.#auto) for (const [ordinal, value] of initial) {
      if (this.components.has(ordinal)) continue
      if (typeof value === "number") this.#add(ordinal, null)
      else if (value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every((v) => typeof v === "number")) this.#add(ordinal, Object.keys(value))
    }
    const slot = this.#free.pop() ?? this.#count++
    if (slot >= this.#capacity) {
      this.#capacity *= 2
      for (const column of this.components.values()) {
        column.values = column.values.map((old) => { const next = new Float64Array(this.#capacity); next.set(old); return next })
        const marks = new Int32Array(this.#capacity * 3).fill(-1); marks.set(column.marks); column.marks = marks
      }
    }
    this.slots.set(record, slot); this.records.set(record, slot)
    for (const [ordinal, column] of this.components) this.#bind(record, slot, ordinal, column)
  }
  release(record: EntityRecord): void { const slot = this.slots.get(record); if (slot !== undefined) this.#free.push(slot); this.slots.delete(record); this.records.delete(record) }
}
export const makeColumns = (schema: { components: object }, absent: symbol): Columns | undefined => {
  const layouts = registrations.get(schema)
  return layouts || nativeTesting.auto ? new Columns(Object.values(schema.components).map((d: { name: string }) => d.name), layouts ?? {}, absent, nativeTesting.auto) : undefined
}
