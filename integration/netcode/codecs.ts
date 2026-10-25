/**
 * The few hand-written Standard Schemas this game saves with. A real game
 * brings a schema library (Effect, Zod, Valibot); these keep the integration
 * free of one.
 */
import type { StandardSchema } from "@typeonce/ritmo/Descriptor"

type Check<T> = (raw: unknown) => { readonly value: T } | { readonly issues: ReadonlyArray<StandardSchema.Issue> }

export interface Codec<T> extends StandardSchema<T, T> {
  readonly check: Check<T>
}

const make = <T>(check: Check<T>): Codec<T> => ({ check, "~standard": { version: 1, vendor: "netcode", validate: check } })

const fail = (message: string) => ({ issues: [{ message }] })

export const integer = make<number>((raw) => Number.isSafeInteger(raw) ? { value: raw as number } : fail("Expected an integer"))

export const guard = <T>(expected: string, test: (raw: unknown) => raw is T): Codec<T> =>
  make((raw) => test(raw) ? { value: raw } : fail(`Expected ${expected}`))

export const nullable = <T>(inner: Codec<T>): Codec<T | null> =>
  make<T | null>((raw) => raw === null ? { value: null } : inner.check(raw))

export const tuple = <A, B>(first: Codec<A>, second: Codec<B>): Codec<readonly [A, B]> =>
  make((raw) => {
    if (!Array.isArray(raw) || raw.length !== 2) return fail("Expected a pair")
    const a = first.check(raw[0])
    if ("issues" in a) return a
    const b = second.check(raw[1])
    if ("issues" in b) return b
    return { value: [a.value, b.value] as const }
  })

export const struct = <const Fields extends Readonly<Record<string, Codec<any>>>>(
  fields: Fields
): Codec<{ readonly [K in keyof Fields]: Fields[K] extends Codec<infer T> ? T : never }> =>
  make((raw) => {
    if (typeof raw !== "object" || raw === null) return fail("Expected an object")
    const value: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(fields)) {
      const decoded = field.check((raw as Record<string, unknown>)[key])
      if ("issues" in decoded) return decoded
      value[key] = decoded.value
    }
    return { value: value as { readonly [K in keyof Fields]: Fields[K] extends Codec<infer T> ? T : never } }
  })
