# Schemas: validating, saving, and branding values

Ritmo has no validators of its own. Every value it checks or saves is a [Standard Schema](https://standardschema.dev) from the game's schema library, and the game uses that one library for all of them. With Zod or Effect, use the helper in [`zod.md`](zod.md) or [`effect.md`](effect.md); the `Descriptor` module's `Codec` JSDoc says when a schema needs a `"~encode"` and how to write one by hand with any other library.

Ritmo's own types come with a guard to build a schema from (`Entity.isHandle`, `Clock.isDeadline`, `Random.is`; a random state alone takes `Random.codec`). Wrap the guard with the schema that narrows to its type:

| Library | Guard | Brand |
|---|---|---|
| Effect | `Schema.declare(guard)` | `Schema.String.pipe(Schema.brand("ItemId"))` |
| Zod | `z.unknown().refine(guard)` (not `z.custom`, which types it `unknown`) | `z.string().brand<"ItemId">()` |
| Valibot | `v.pipe(v.unknown(), v.guard(guard))` (not `v.custom`) | `v.pipe(v.string(), v.brand("ItemId"))` |
| ArkType | `type("unknown").narrow(guard)` | `type("string").brand("ItemId")` |

Brand a value that must not be mixed up with another of the same shape (an item id and a player id, a price and a weight), and use the library's inferred type everywhere (`z.infer<typeof ItemId>`, `typeof ItemId.Type`). Decode it once where it enters (a descriptor's schema for raw input and restores, a decode for authored data and host input), then pass the branded value along.
