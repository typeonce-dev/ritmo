/**
 * The codec helpers the skill's playbooks give games for schema libraries
 * whose values can transform (`references/zod.md`, `references/effect.md`),
 * copied as games write them, for the tests and type tests that prove them.
 */
import type { StandardSchema } from "@typeonce/ritmo/Descriptor"
import { Schema as S } from "effect"
import type { z } from "zod"

/** A Zod schema as a Ritmo codec: decodes saved JSON, and encodes values back to it with Zod's own encode. */
export const zodCodec = <Z extends z.ZodType>(schema: Z) => {
  const encode: StandardSchema<z.output<Z>, z.input<Z>> = {
    "~standard": {
      version: 1,
      vendor: "zod",
      validate: (value) => {
        // Ritmo encodes only values this schema decoded.
        const encoded = schema.safeEncode(value as z.output<Z>)
        return encoded.success ? { value: encoded.data } : { issues: encoded.error.issues }
      }
    }
  }
  return { "~standard": schema["~standard"], "~encode": encode }
}

/** An Effect schema as a Ritmo codec: decodes saved JSON, and encodes values back to it. */
export const effectCodec = <T extends S.Top & { readonly DecodingServices: never; readonly EncodingServices: never }>(schema: T) => {
  const json = S.toCodecJson(schema)
  return {
    "~standard": S.toStandardSchemaV1(json)["~standard"],
    "~encode": S.toStandardSchemaV1(S.flip(json))
  }
}

