# Schemas with Zod

A Zod schema is a Standard Schema, so one whose value is plain data passes to Ritmo as it is:

```ts
import { z } from "zod"

const Position = Descriptor.ConstructedComponent(z.object({ x: z.number(), y: z.number() }))("Game/Position")
const Mode = Game.StateMachine("Game/Mode", { Exploring: {}, Talking: z.object({ speaker: z.string(), page: z.number().int() }) })
```

1. A value whose saved form differs from it (a `Date`, a `Map`, a class) is a `z.codec` from its saved form, passed through one helper in the game, so `runtime.snapshot()` saves it with Zod's own encode:

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

   A transforming schema passed without `codec(...)` does not compile (`give it a ~encode schema back to the saved form`), and one whose saved form is not plain data (`z.date()` alone) fails with `the saved form of this schema is not plain data`.

2. Ritmo's own types become schemas through their guards, with `z.unknown().refine(...)`, which narrows to the guard's type (`z.custom(guard)` types it as `unknown`):

   ```ts
   const Target = Descriptor.ConstructedComponent(z.object({
     enemy: z.unknown().refine(Entity.isHandle(Root, Health)),
     ready: z.unknown().refine(Clock.isDeadline(step)).nullable()
   }))("Game/Target")
   ```

   A random state alone needs no schema: `Descriptor.ConstructedResource(Random.codec)`.

3. Failures carry Zod's issues as Standard Schema issues (`{ _tag: "SchemaIssues", issues }`, each with its `path`). Read them; never retry with a cast.

**Done when** the game's check passes and a test saves and restores every value through `JSON.stringify` and `JSON.parse`.
