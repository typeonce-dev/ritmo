/**
 * Descriptor metadata: checking the `meta` option of a component or resource
 * constructor once, and carrying it, frozen, on the descriptor. Nothing here
 * is exported from the package.
 */
import type { FieldMeta } from "../Descriptor.ts"

/** The key under which a descriptor carries its normalized metadata. */
export const metaKey: unique symbol = Symbol("ritmo/DescriptorMeta")

/** Every field's metadata, by field name: frozen, with no empty entries. */
export type NormalizedMeta = Readonly<Record<string, FieldMeta>>

const empty: NormalizedMeta = Object.freeze({})

/** The metadata a descriptor carries, `{}` when it declares none. */
export const metaOf = (descriptor: object): NormalizedMeta =>
  (descriptor as { readonly [metaKey]?: NormalizedMeta })[metaKey] ?? empty

const show = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

const normalizeField = (name: string, field: string, input: unknown): FieldMeta => {
  const at = `${name}: meta.${field}`
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${at} must be an object with unit, range, or hint, got ${show(input)}`)
  }
  const normalized: { unit?: string; range?: readonly [number, number]; hint?: string } = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    switch (key) {
      case "unit":
      case "hint":
        if (typeof value !== "string" || value.length === 0) throw new Error(`${at}.${key} must be a non-empty string, got ${show(value)}`)
        normalized[key] = value
        break
      case "range": {
        const valid = Array.isArray(value) && value.length === 2 &&
          typeof value[0] === "number" && typeof value[1] === "number" &&
          Number.isFinite(value[0]) && Number.isFinite(value[1]) && value[0] <= value[1]
        if (!valid) throw new Error(`${at}.range must be [min, max] with finite numbers and min <= max, got ${show(value)}`)
        normalized.range = Object.freeze([value[0], value[1]] as const)
        break
      }
      default:
        throw new Error(`${at} has an unknown key ${show(key)}: a field's meta has only unit, range, and hint`)
    }
  }
  return Object.freeze(normalized)
}

/**
 * Checks one constructor's `meta` option and returns it normalized, or
 * `undefined` when it declares nothing. A malformed option (from a caller
 * the types did not check) is a defect and throws, naming the descriptor.
 */
export const normalizeMeta = (name: string, input: unknown): NormalizedMeta | undefined => {
  if (input === undefined) return undefined
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${name}: meta must be an object keyed by the value's fields, got ${show(input)}`)
  }
  const fields = Object.entries(input).filter(([, value]) => value !== undefined)
  if (fields.length === 0) return undefined
  return Object.freeze(Object.fromEntries(fields.map(([field, value]) => [field, normalizeField(name, field, value)])))
}

/** `descriptor` carrying `meta` (normalized), or `descriptor` itself when there is none. */
export const withMeta = <D extends { readonly name: string }>(descriptor: D, input: unknown): D => {
  const meta = normalizeMeta(descriptor.name, input)
  return meta === undefined ? descriptor : { ...descriptor, [metaKey]: meta }
}
