# Schemas with Zod

A Zod schema of plain data passes to Ritmo as it is. A value whose saved form differs (a `Date`, a `Map`, a class) is a `z.codec` from its saved form, passed through one helper in the game, so `runtime.snapshot()` saves it with Zod's own encode:

```ts
import type { StandardSchema } from "@typeonce/ritmo/Descriptor"
import type { z } from "zod"

/** A Zod schema as a Ritmo codec: decodes saved JSON, and encodes values back to it with Zod's own encode. */
export const codec = <Z extends z.ZodType>(schema: Z) => {
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

const Born = Descriptor.ConstructedComponent(codec(z.codec(z.iso.datetime(), z.date(), {
  decode: (text) => new Date(text),
  encode: (date) => date.toISOString()
})))("Game/Born")
```

Ritmo's own types enter through their guards with `z.unknown().refine(guard)`, which narrows to the guard's type (see `Entity.isHandle` and `Clock.isDeadline`); `z.custom(guard)` types the value as `unknown`.

**Check:** a test saves and restores every value through `JSON.stringify` and `JSON.parse`.
