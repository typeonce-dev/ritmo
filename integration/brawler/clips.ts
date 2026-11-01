/**
 * The game's own reading of the clips `ritmo-tools rig bake` writes
 * (`hero.rig.clips.json`): a Standard Schema of the fields this game uses,
 * hand-written so the integration needs no schema library (a real game
 * brings Effect, Zod, or Valibot). Fields the game does not use are not
 * read. Coordinates are the sidecar's: pixels from the clip's anchor, y
 * down, so the game adds the entity's position; a hit is a segment and how
 * far each side of it it reaches (a capsule).
 */
import * as Result from "@typeonce/ritmo/Result"
import type { StandardSchema } from "@typeonce/ritmo/Descriptor"

type Check<T> = (raw: unknown, path: string) => { readonly value: T } | { readonly issues: ReadonlyArray<StandardSchema.Issue> }

interface Codec<T> {
  readonly check: Check<T>
}

const fail = (path: string, expected: string) => ({ issues: [{ message: `${path || "the sidecar"}: expected ${expected}` }] })

const finite: Codec<number> = { check: (raw, path) => (typeof raw === "number" && Number.isFinite(raw) ? { value: raw } : fail(path, "a finite number")) }
const whole: Codec<number> = { check: (raw, path) => (Number.isSafeInteger(raw) && (raw as number) >= 0 ? { value: raw as number } : fail(path, "a whole number, 0 or more")) }
const boolean: Codec<boolean> = { check: (raw, path) => (typeof raw === "boolean" ? { value: raw } : fail(path, "true or false")) }
const string: Codec<string> = { check: (raw, path) => (typeof raw === "string" ? { value: raw } : fail(path, "a string")) }

const point: Codec<readonly [number, number]> = {
  check: (raw, path) =>
    Array.isArray(raw) && raw.length === 2 && raw.every((v) => typeof v === "number" && Number.isFinite(v)) ? { value: [raw[0] as number, raw[1] as number] } : fail(path, "a point [x, y]")
}

const nullable = <T>(inner: Codec<T>): Codec<T | null> => ({ check: (raw, path) => (raw === null ? { value: null } : inner.check(raw, path)) })

const array = <T>(item: Codec<T>): Codec<ReadonlyArray<T>> => ({
  check: (raw, path) => {
    if (!Array.isArray(raw)) return fail(path, "a list")
    const values: Array<T> = []
    for (const [i, entry] of raw.entries()) {
      const decoded = item.check(entry, `${path}[${i}]`)
      if ("issues" in decoded) return decoded
      values.push(decoded.value)
    }
    return { value: values }
  }
})

const record = <T>(item: Codec<T>): Codec<Readonly<Record<string, T>>> => ({
  check: (raw, path) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail(path, "an object")
    const values: Record<string, T> = {}
    for (const [key, entry] of Object.entries(raw)) {
      const decoded = item.check(entry, `${path}.${key}`)
      if ("issues" in decoded) return decoded
      values[key] = decoded.value
    }
    return { value: values }
  }
})

const struct = <const Fields extends Readonly<Record<string, Codec<unknown>>>>(fields: Fields): Codec<{ readonly [K in keyof Fields]: Fields[K] extends Codec<infer T> ? T : never }> => ({
  check: (raw, path) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail(path, "an object")
    const value: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(fields)) {
      const decoded = field.check((raw as Record<string, unknown>)[key], path === "" ? key : `${path}.${key}`)
      if ("issues" in decoded) return decoded
      value[key] = decoded.value
    }
    return { value: value as { readonly [K in keyof Fields]: Fields[K] extends Codec<infer T> ? T : never } }
  }
})

const phase = struct({ name: string, from: whole, to: whole, fast: boolean })
const frame = struct({ name: string, hit: nullable(struct({ from: point, to: point, radius: finite })) })
const clip = struct({ fps: finite, loop: boolean, phases: array(phase), frames: array(frame) })
const version: Codec<1> = { check: (raw, path) => (raw === 1 ? { value: 1 } : fail(path, "version 1 (this game reads version 1 of the sidecar)")) }
const sidecar = struct({ version, scale: finite, clips: record(clip) })

/** The clips as this game reads them: each clip's timing, phases, and the hit segment on each frame. */
export type Clips = typeof sidecar extends Codec<infer T> ? T : never
export type ClipData = Clips["clips"][string]

/** The sidecar's Standard Schema, for any code that validates with one. */
export const ClipsSchema: StandardSchema<Clips, Clips> = {
  "~standard": {
    version: 1,
    vendor: "brawler",
    validate: (raw: unknown) => sidecar.check(raw, "")
  }
}

/** Decodes a baked sidecar at the boundary: a typed failure naming the first field that is wrong, or the clips to trust from there on. */
export const decodeClips = (raw: unknown): Result.Result<Clips, ReadonlyArray<StandardSchema.Issue>> => {
  const decoded = sidecar.check(raw, "")
  return "issues" in decoded ? Result.failure(decoded.issues) : Result.success(decoded.value)
}
