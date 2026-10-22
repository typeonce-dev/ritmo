/**
 * Ready-made validators for descriptor values.
 *
 * Every component and resource that a snapshot saves needs a validator that
 * accepts untrusted input (see the `Snapshot` module). These cover the common
 * shapes of game state so most descriptors need no hand-written validation:
 *
 * ```ts
 * const Position = Descriptor.ConstructedComponent(Decode.struct({ x: Decode.number, y: Decode.number }))("Game/Position")
 * const Health = Descriptor.ConstructedComponent(Decode.integer)("Game/Health")
 * const Target = Descriptor.ConstructedComponent(Decode.struct({ enemy: Decode.handle(Root, Health) }))("Game/Target")
 * const Player = Descriptor.Tag("Game/Player")
 * ```
 *
 * Each validator is a `Codec`: `result` checks already-typed input (used by
 * raw-aware APIs such as `Game.Runtime.make` and `Game.Command.entryRaw`) and
 * `decode` checks input of any shape (used when restoring snapshots). Both
 * return a `Result` whose error names the failing path. Anything more
 * elaborate fits through `Descriptor.fromStandardSchema(...)`.
 *
 * @module Decode
 * @docGroup core
 */
import type { Descriptor } from "./Descriptor.ts"
import * as Entity from "./Entity.ts"
import * as Result from "./Result.ts"

/**
 * Why a value did not decode: the path to the failing value (`$` is the
 * root), what was expected there, and what was found.
 */
export interface DecodeError {
  readonly _tag: "DecodeError"
  readonly path: string
  readonly expected: string
  readonly actual: unknown
}

/**
 * A validator usable as a descriptor constructor, for raw input and for
 * snapshot loading.
 */
export interface Codec<T> {
  readonly result: (raw: T) => Result.Result<T, DecodeError>
  readonly decode: (raw: unknown) => Result.Result<T, DecodeError>
}

/**
 * The value type a codec produces.
 */
export type Type<C extends Codec<any>> = C extends Codec<infer T> ? T : never

const invalid: unique symbol = Symbol("ritmo/Decode/invalid")
const internals: unique symbol = Symbol("ritmo/Decode/internals")

/**
 * The fast path (`parse`, no allocation on success beyond the value itself)
 * and the slow path that explains a failure. Decoding runs `parse`; only a
 * failed decode walks the value again with `explain` to build the error.
 */
interface Internals<T> {
  readonly parse: (raw: unknown) => T | typeof invalid
  readonly explain: (raw: unknown) => DecodeError
}

const error = (expected: string, actual: unknown): DecodeError => ({ _tag: "DecodeError", path: "$", expected, actual })

// A nested failure is re-rooted under the parent's path segment.
const within = (segment: string, nested: DecodeError): DecodeError => ({ ...nested, path: `$${segment}${nested.path.slice(1)}` })

const make = <T>(parse: Internals<T>["parse"], explain: Internals<T>["explain"]): Codec<T> => {
  const decode = (raw: unknown): Result.Result<T, DecodeError> => {
    const value = parse(raw)
    return value === invalid ? Result.fail(explain(raw)) : Result.succeed(value)
  }
  return { result: decode, decode, [internals]: { parse, explain } } as Codec<T>
}

// Codecs from elsewhere (hand-written or adapted) go through their `decode`.
const internalsOf = <T>(codec: Codec<T>): Internals<T> =>
  (codec as Codec<T> & { readonly [internals]?: Internals<T> })[internals] ?? {
    parse: (raw) => {
      const value = codec.decode(raw)
      return value._tag === "Success" ? value.success : invalid
    },
    explain: (raw) => {
      const value = codec.decode(raw)
      return value._tag === "Success" ? error("a valid value", raw) : value.failure
    }
  }

const primitive = <T>(expected: string, test: (raw: unknown) => raw is T): Codec<T> =>
  make((raw) => test(raw) ? raw : invalid, (raw) => error(expected, raw))

/** A finite number (JSON cannot carry `NaN` or `Infinity`). */
export const number: Codec<number> = primitive("finite number", (raw): raw is number => typeof raw === "number" && Number.isFinite(raw))

/** A safe integer. */
export const integer: Codec<number> = primitive("integer", (raw): raw is number => Number.isSafeInteger(raw))

export const string: Codec<string> = primitive("string", (raw): raw is string => typeof raw === "string")

export const boolean: Codec<boolean> = primitive("boolean", (raw): raw is boolean => typeof raw === "boolean")

/**
 * One of the given literal values.
 *
 * @example
 * ```ts
 * const Team = Descriptor.ConstructedComponent(Decode.literal("red", "blue"))("Game/Team")
 * ```
 */
export const literal = <const Values extends readonly [string | number | boolean | null, ...Array<string | number | boolean | null>]>(
  ...values: Values
): Codec<Values[number]> =>
  primitive(
    values.map((value) => JSON.stringify(value)).join(" | "),
    (raw): raw is Values[number] => values.includes(raw as Values[number])
  )

/**
 * The value or `null`.
 */
export const nullable = <T>(codec: Codec<T>): Codec<T | null> => {
  const inner = internalsOf(codec)
  return make<T | null>((raw) => raw === null ? null : inner.parse(raw), inner.explain)
}

/**
 * An array whose items all decode.
 */
export const array = <T>(item: Codec<T>): Codec<ReadonlyArray<T>> => {
  const inner = internalsOf(item)
  return make<ReadonlyArray<T>>(
    (raw) => {
      if (!Array.isArray(raw)) return invalid
      const values: Array<T> = new Array(raw.length)
      for (let index = 0; index < raw.length; index++) {
        const value = inner.parse(raw[index])
        if (value === invalid) return invalid
        values[index] = value
      }
      return values
    },
    (raw) => {
      if (!Array.isArray(raw)) return error("array", raw)
      const index = raw.findIndex((value) => inner.parse(value) === invalid)
      return within(`[${index}]`, inner.explain(raw[index]))
    }
  )
}

/**
 * An object with exactly the given fields (others are dropped).
 *
 * @example
 * ```ts
 * const Velocity = Descriptor.ConstructedComponent(Decode.struct({ x: Decode.number, y: Decode.number }))("Game/Velocity")
 * ```
 */
export const struct = <const Fields extends Readonly<Record<string, Codec<any>>>>(
  fields: Fields
): Codec<{ [K in keyof Fields]: Type<Fields[K]> }> => {
  const keys = Object.keys(fields)
  const inner = keys.map((key) => internalsOf(fields[key]!))
  const isObject = (raw: unknown): raw is Record<string, unknown> =>
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
  return make(
    (raw) => {
      if (!isObject(raw)) return invalid
      const value: Record<string, unknown> = {}
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index]!
        const field = inner[index]!.parse(raw[key])
        if (field === invalid) return invalid
        value[key] = field
      }
      return value as { [K in keyof Fields]: Type<Fields[K]> }
    },
    (raw) => {
      if (!isObject(raw)) return error("object", raw)
      const index = keys.findIndex((key, position) => inner[position]!.parse(raw[key]) === invalid)
      return within(`.${keys[index]!}`, inner[index]!.explain(raw[keys[index]!]))
    }
  )
}

/**
 * A stored entity handle for schema root `Root`, optionally with an intent
 * component. Decoding never proves the entity exists; resolve it with
 * `queries.x.getHandle(...)` (through a declared query) as usual.
 */
export const handle = <
  Root,
  const Intent extends Descriptor<"component", string, any> | undefined = undefined
>(
  root: Root,
  intent?: Intent
): Codec<Entity.Handle<Root, Intent>> =>
  make(
    (raw) => {
      const decoded = Entity.decodeHandle(root, raw, intent)
      return decoded._tag === "Success" ? decoded.success : invalid
    },
    (raw) => error("entity handle", raw)
  )
