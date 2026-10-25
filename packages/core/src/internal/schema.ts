/**
 * Running the Standard Schemas a game brings: synchronous validation that
 * returns a `Result`, and the internal schemas of Ritmo's own descriptors
 * (tags, clocks, states). Nothing here is exported from the package.
 */
import type { Codec, SchemaIssues, StandardSchema } from "../Descriptor.ts"
import * as Result from "../Result.ts"

const asyncIssues: SchemaIssues = {
  _tag: "SchemaIssues",
  issues: [{ message: "Asynchronous validation is not supported: Ritmo validates synchronously, so use a schema without async checks" }]
}

/** Runs one Standard Schema synchronously; a schema that answers with a promise fails. */
export const validate = <Output>(schema: StandardSchema<unknown, Output>, raw: unknown): Result.Result<Output, SchemaIssues> => {
  const outcome = schema["~standard"].validate(raw)
  if (outcome instanceof Promise) {
    // Avoid an unhandled rejection from the discarded promise.
    outcome.catch(() => {})
    return Result.failure(asyncIssues)
  }
  return outcome.issues === undefined
    ? Result.success(outcome.value)
    : Result.failure({ _tag: "SchemaIssues", issues: outcome.issues })
}

/**
 * What a constructed descriptor carries: `decode` turns raw (saved-form)
 * input into a value, and `encode`, when the schema has a `"~encode"`, turns
 * a value back into its saved form.
 */
export interface Construction {
  readonly codec: Codec<unknown, unknown>
  readonly decode: (raw: unknown) => Result.Result<unknown, SchemaIssues>
  readonly encode: ((value: unknown) => Result.Result<unknown, SchemaIssues>) | undefined
}

/** The key under which a constructed descriptor carries its {@link Construction}. */
export const constructionKey: unique symbol = Symbol("ritmo/DescriptorConstruction")

/** The construction a descriptor carries, or `undefined` for one without a schema. */
export const constructionOf = (descriptor: object): Construction | undefined =>
  (descriptor as { readonly [constructionKey]?: Construction })[constructionKey]

export const construction = (codec: Codec<unknown, unknown>): Construction => {
  const encoder = codec["~encode"]
  return {
    codec,
    decode: (raw) => validate(codec, raw),
    encode: encoder === undefined ? undefined : (value) => validate(encoder, value)
  }
}

/** A Standard Schema from a plain check, for Ritmo's own descriptors. */
export const standard = <Value>(check: (raw: unknown) => Result.Result<Value, string>): StandardSchema<Value, Value> => ({
  "~standard": {
    version: 1,
    vendor: "ritmo",
    validate: (raw) => {
      const checked = check(raw)
      return checked.ok ? { value: checked.value } : { issues: [{ message: checked.error }] }
    }
  }
})

/** Whether a value is a Standard Schema (a state with data) rather than `{}` (a state without). */
export const isStandardSchema = (value: unknown): value is StandardSchema<unknown, unknown> =>
  typeof value === "object" && value !== null && "~standard" in value
