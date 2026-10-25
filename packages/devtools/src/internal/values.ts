/** Value checks used by sessions. */

/**
 * The path of the first NaN or infinite number inside a value (`""` for the
 * value itself), or `undefined`. Walks arrays and object properties; stops at
 * `depth` levels and at objects already visited.
 */
export const nonFinitePath = (value: unknown, depth = 6, seen: Set<object> = new Set()): string | undefined => {
  if (typeof value === "number") return Number.isFinite(value) ? undefined : ""
  if (typeof value !== "object" || value === null || depth === 0 || seen.has(value)) return undefined
  seen.add(value)
  for (const [key, entry] of Array.isArray(value) ? value.entries() : Object.entries(value)) {
    const path = nonFinitePath(entry, depth - 1, seen)
    if (path !== undefined) return `${typeof key === "number" ? `[${key}]` : `.${key}`}${path}`
  }
  return undefined
}
