/**
 * What entity states (`Descriptor.EntityState`) and state machines
 * (`Game.StateMachine`) share at runtime: the schema of a tagged state value,
 * and the one frozen value of each state without data.
 */
import type { Codec, SchemaIssues, StandardSchema } from "../Descriptor.ts"
import * as Result from "../Result.ts"
import { isStandardSchema, validate } from "./schema.ts"

/** Each state's definition, by state name: `{}`, or the schema of its data. */
type States = Readonly<Record<string, object>>

type StateValue = { readonly _tag: string }

/** The shared value of every state without data, by state name. */
export const emptyStates = (states: States): ReadonlyMap<string, StateValue> =>
  new Map(
    Object.entries(states)
      .filter(([, definition]) => !isStandardSchema(definition))
      .map(([state]) => [state, Object.freeze({ _tag: state })])
  )

const failure = (message: string, path: ReadonlyArray<PropertyKey>): Result.Result<never, SchemaIssues> =>
  Result.failure({ _tag: "SchemaIssues", issues: [{ message, path }] })

const isObject = (raw: unknown): raw is Readonly<Record<string, unknown>> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw)

/**
 * The schema of every value of `states`: `_tag` names a state, and the rest
 * is that state's data, decoded (and encoded) by the state's own schema. A
 * state without data decodes to its shared frozen value. Ritmo adds only the
 * `_tag`; the data's fields and their paths are the state schema's.
 */
export const stateCodec = (states: States): Codec<StateValue, StateValue> => {
  const names = Object.keys(states)
  const empty = emptyStates(states)
  const expected = names.map((name) => JSON.stringify(name)).join(" | ")
  const run = (raw: unknown, side: "decode" | "encode"): Result.Result<StateValue, SchemaIssues> => {
    if (!isObject(raw)) return failure("Expected an object", [])
    const tag = raw["_tag"]
    if (typeof tag !== "string" || !Object.hasOwn(states, tag)) return failure(`Expected ${expected}`, ["_tag"])
    const shared = empty.get(tag)
    if (shared !== undefined) return Result.success(side === "decode" ? shared : { _tag: tag })
    const definition = states[tag] as Codec<object, unknown>
    const schema: StandardSchema<unknown, unknown> | undefined = side === "decode" ? definition : definition["~encode"]
    const { _tag, ...data } = raw
    if (schema === undefined) return Result.success({ _tag: tag, ...data })
    const value = validate(schema, data)
    if (!value.ok) return value
    return Result.success({ _tag: tag, ...(value.value as object) })
  }
  const toStandard = (side: "decode" | "encode"): StandardSchema<StateValue, StateValue> => ({
    "~standard": {
      version: 1,
      vendor: "ritmo",
      validate: (raw) => {
        const value = run(raw, side)
        return value.ok ? { value: value.value } : { issues: value.error.issues }
      }
    }
  })
  return { ...toStandard("decode"), "~encode": toStandard("encode") }
}
