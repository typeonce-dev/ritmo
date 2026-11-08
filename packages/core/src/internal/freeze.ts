/**
 * The world owns every value written to it: components, resources, events,
 * and machine values. A runtime made with `debug` freezes each value as it
 * enters, so code that mutates a value after handing it over throws a
 * `TypeError` where it mutates, instead of changing the world with no write
 * (no change record, and a checkpoint that rewinds to the mutated value).
 *
 * The walk stops at frozen objects, so writing `{ ...value, x }` freezes one
 * object. Typed arrays cannot be frozen and are skipped; `Map` and `Set`
 * contents are walked, but their own `set`/`add`/`delete` still work.
 *
 * It runs on every write of a debug runtime, so it walks the way world values
 * are built (plain objects and arrays): arrays by index, objects by their
 * enumerable keys and own symbols, and primitives without a call. Reading
 * every own key (`Reflect.ownKeys`) made a debug frame about twice as slow as
 * one without `debug`.
 */
export const deepFreeze = (value: unknown): void => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return
  if (ArrayBuffer.isView(value)) return
  Object.freeze(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const entry: unknown = value[index]
      if (typeof entry === "object" && entry !== null) deepFreeze(entry)
    }
    return
  }
  if (value instanceof Map) {
    for (const [key, entry] of value) {
      deepFreeze(key)
      deepFreeze(entry)
    }
    return
  }
  if (value instanceof Set) {
    for (const entry of value) deepFreeze(entry)
    return
  }
  const record = value as Record<PropertyKey, unknown>
  for (const key in record) {
    const entry = record[key]
    if (typeof entry === "object" && entry !== null) deepFreeze(entry)
  }
  const symbols = Object.getOwnPropertySymbols(record)
  for (let index = 0; index < symbols.length; index++) deepFreeze(record[symbols[index]!])
}
