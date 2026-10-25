// The demos' schemas are Effect's. Ritmo takes any Standard Schema; this helper
// (from the Ritmo skill's Effect playbook) turns an Effect schema into one Ritmo
// can both load with (decode) and save with (encode), as JSON-safe values.
import { Schema } from "effect"

/** An Effect schema as a Ritmo codec: decodes saved JSON, and encodes values back to it. */
export const codec = <S extends Schema.Top & { readonly DecodingServices: never; readonly EncodingServices: never }>(schema: S) => {
  const json = Schema.toCodecJson(schema)
  return {
    "~standard": Schema.toStandardSchemaV1(json)["~standard"],
    "~encode": Schema.toStandardSchemaV1(Schema.flip(json))
  }
}
