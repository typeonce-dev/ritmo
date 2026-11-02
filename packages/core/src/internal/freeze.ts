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
 */
export const deepFreeze = (value: unknown): void => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return
  if (ArrayBuffer.isView(value)) return
  Object.freeze(value)
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
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key])
  }
}
