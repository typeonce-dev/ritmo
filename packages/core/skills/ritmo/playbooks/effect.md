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

1. Components, resources, and states take `codec(...)`:

   ```ts
   const Position = Descriptor.ConstructedComponent(codec(Schema.Struct({ x: Schema.Finite, y: Schema.Finite })))("Game/Position")
   const Stock = Descriptor.ConstructedResource(codec(Schema.ReadonlyMap(Schema.String, Schema.Int)))("Game/Stock")
   const Mode = Game.StateMachine("Game/Mode", {
     Exploring: {},
     Talking: codec(Schema.Struct({ speaker: Schema.String, page: Schema.Int, rival: Schema.OptionFromNullOr(Schema.String) }))
   })
   ```

   `Schema.toCodecJson` gives every Effect type (`Option`, `ReadonlyMap`, `Date`, classes) a JSON form, so `runtime.snapshot()` saves them and `runtime.restore(...)` brings them back. A schema that needs services cannot be used: Ritmo validates synchronously.

2. Ritmo's own types become schemas through their guards, with `Schema.declare`:

   ```ts
   const Target = Descriptor.ConstructedComponent(codec(Schema.Struct({
     enemy: Schema.declare(Entity.isHandle(Root, Health)),
     aim: Schema.declare(Vector2.is)
   })))("Game/Target")
   ```

   A ritmo-math value alone needs no helper: `Descriptor.ConstructedComponent(Vector2.codec)`.

3. Saving to text is host code. The snapshot is plain data; turn it into a string with the same library:

   ```ts
   const SaveText = Schema.fromJsonString(Schema.Unknown)
   const saved = runtime.snapshot()
   if (saved.ok) storage.setItem("save", Schema.encodeSync(SaveText)(saved.value))
   const loaded = runtime.restore(Schema.decodeUnknownSync(SaveText)(storage.getItem("save")))
   ```

   `restore` validates the whole save, so the text needs no schema of its own.

4. Failures carry Effect's issues as Standard Schema issues (`{ _tag: "SchemaIssues", issues }`, each with its `path`). Read them; never retry with a cast.

**Done when** the game's check passes and a test saves and restores every value through `JSON.stringify` and `JSON.parse`.
