/**
 * A canonical hash of plain data, for `runtime.checksum()`.
 *
 * The walk does not depend on how the data was built: object keys are
 * hashed in sorted order, so `{ x, y }` and `{ y, x }` hash the same, while
 * array, `Map`, and `Set` order counts. Every value is tagged with its type,
 * so `"1"` and `1` differ. `-0` hashes as `0`, as a save does: JSON writes
 * `-0` as `0`, so a world read back from a save or a replay file must hash
 * the same as the one that wrote it.
 *
 * The hash is two 32-bit lanes (cyrb53's mixing), printed as 16 hex digits:
 * a fingerprint for spotting worlds that differ, not a cryptographic hash.
 */
interface Lanes {
  a: number
  b: number
}

const feed = (lanes: Lanes, text: string): void => {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    lanes.a = Math.imul(lanes.a ^ code, 2654435761)
    lanes.b = Math.imul(lanes.b ^ code, 1597334677)
  }
}

const walk = (lanes: Lanes, value: unknown): void => {
  switch (typeof value) {
    case "undefined":
      return feed(lanes, "u")
    case "boolean":
      return feed(lanes, value ? "t" : "f")
    case "number":
      return feed(lanes, `d${String(value)};`)
    case "bigint":
      return feed(lanes, `b${String(value)};`)
    case "string":
      return feed(lanes, `s${value.length}:${value}`)
    case "object":
      if (value === null) return feed(lanes, "n")
      if (Array.isArray(value)) {
        feed(lanes, "[")
        for (const item of value) walk(lanes, item)
        return feed(lanes, "]")
      }
      if (value instanceof Map) {
        feed(lanes, "M")
        for (const [key, item] of value) {
          walk(lanes, key)
          walk(lanes, item)
        }
        return feed(lanes, "]")
      }
      if (value instanceof Set) {
        feed(lanes, "S")
        for (const item of value) walk(lanes, item)
        return feed(lanes, "]")
      }
      feed(lanes, "{")
      for (const key of Object.keys(value).sort()) {
        walk(lanes, key)
        walk(lanes, (value as Record<string, unknown>)[key])
      }
      return feed(lanes, "}")
    default:
      // Functions and symbols have no saved form; their presence still counts.
      return feed(lanes, typeof value)
  }
}

/** The hash of `value`, as 16 hex digits. */
export const checksum = (value: unknown): string => {
  const lanes: Lanes = { a: 0xdeadbeef, b: 0x41c6ce57 }
  walk(lanes, value)
  const a = Math.imul(lanes.a ^ (lanes.a >>> 16), 2246822507) ^ Math.imul(lanes.b ^ (lanes.b >>> 13), 3266489909)
  const b = Math.imul(lanes.b ^ (lanes.b >>> 16), 2246822507) ^ Math.imul(lanes.a ^ (lanes.a >>> 13), 3266489909)
  return (b >>> 0).toString(16).padStart(8, "0") + (a >>> 0).toString(16).padStart(8, "0")
}
