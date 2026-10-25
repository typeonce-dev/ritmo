# Schemas with Effect

Effect schemas are not Standard Schemas on their own. Write one helper in the game and pass every schema through it, plain or not, so there is one way to give Ritmo a schema:

```ts
import { Schema } from "effect"

/** An Effect schema as a Ritmo codec: decodes saved JSON, and encodes values back to it. */
export const codec = <S extends Schema.Top & { readonly DecodingServices: never; readonly EncodingServices: never }>(schema: S) => {
  const json = Schema.toCodecJson(schema)
  return {
    "~standard": Schema.toStandardSchemaV1(json)["~standard"],
    "~encode": Schema.toStandardSchemaV1(Schema.flip(json))
  }
}
```

- Components, resources, and states with data take `codec(...)`: `Descriptor.ConstructedResource(codec(Schema.ReadonlyMap(Schema.String, Schema.Int)))("Game/Stock")`. `Schema.toCodecJson` gives every Effect type (`Option`, `ReadonlyMap`, `Date`, classes) a JSON form, so snapshots save them. A schema that needs services cannot be used: Ritmo validates synchronously.
- Ritmo's own types enter through their guards with `Schema.declare` (see `Entity.isHandle` and `Clock.isDeadline`).
- Saving to text is host code, with the same library. `restore` validates the whole save, so the text needs no schema of its own:

  ```ts
  const SaveText = Schema.fromJsonString(Schema.Unknown)
  const saved = runtime.snapshot()
  if (saved.ok) storage.setItem("save", Schema.encodeSync(SaveText)(saved.value))
  const loaded = runtime.restore(Schema.decodeUnknownSync(SaveText)(storage.getItem("save")))
  ```

**Check:** a test saves and restores every value through `JSON.stringify` and `JSON.parse`.
