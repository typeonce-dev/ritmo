import type { StandardSchema } from "@typeonce/ritmo/Descriptor"
import type * as Result from "@typeonce/ritmo/Result"

/**
 * The codec of one math type, from its decode: a Standard Schema whose saved
 * form is the raw shape. The value is already plain data, so it needs no
 * `"~encode"`.
 */
export const codecOf = <Raw, Value>(
  decode: (raw: unknown) => Result.Result<Value, unknown>,
  expected: string
): StandardSchema<Raw, Value> => ({
  "~standard": {
    version: 1,
    vendor: "ritmo-math",
    validate: (raw) => {
      const value = decode(raw)
      return value.ok ? { value: value.value } : { issues: [{ message: `Expected ${expected}` }] }
    }
  }
})
