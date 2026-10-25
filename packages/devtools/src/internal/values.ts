/** Value checks used by sessions. */
import type * as Debug from "@typeonce/ritmo/Debug"

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

/** The declared ranges (`meta` with `range`) of one descriptor's fields. */
export type FieldRanges = ReadonlyArray<readonly [field: string, min: number, max: number]>

const rangesBy = (entries: ReadonlyArray<{ readonly name: string; readonly meta: Debug.ComponentDescription["meta"] }>): ReadonlyMap<string, FieldRanges> => {
  const ranges = new Map<string, FieldRanges>()
  for (const { name, meta } of entries) {
    const fields = Object.entries(meta).flatMap(([field, entry]) => entry.range === undefined ? [] : [[field, entry.range[0], entry.range[1]] as const])
    if (fields.length > 0) ranges.set(name, fields)
  }
  return ranges
}

/** Every declared field range, by component and by resource name; descriptors without one are left out. */
export const rangesOf = (description: Debug.Description): {
  readonly component: ReadonlyMap<string, FieldRanges>
  readonly resource: ReadonlyMap<string, FieldRanges>
} => ({ component: rangesBy(description.components), resource: rangesBy(description.resources) })
