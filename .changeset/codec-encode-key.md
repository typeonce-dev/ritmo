---
"@typeonce/ritmo": minor
"@typeonce/ritmo-netcode": patch
"@typeonce/ritmo-math": patch
"@typeonce/ritmo-devtools": patch
---

**Zod schemas work with Ritmo: the schema back to the saved form is under `"~encode"`, not `encode`.** Zod (from 4.1) gives every schema an `encode()` method, which Ritmo read as its encode schema: `Descriptor.ConstructedComponent(z.object(...))` did not compile, and with a cast `runtime.snapshot()` threw `Cannot read properties of undefined (reading 'validate')`. The key now starts with `~`, like Standard Schema's own `~standard`, so no library's methods collide with it. A Zod, Valibot, or ArkType schema of plain data passes as it is; Ritmo's tests now save and load a schema of each, and of Effect, through JSON.

- **Breaking: a codec carries its encode schema as `"~encode"`.** The Effect helper from the skill's `playbooks/effect.md` (or a hand-written codec) renames the key:

  ```diff
   return {
     "~standard": Schema.toStandardSchemaV1(json)["~standard"],
  -  encode: Schema.toStandardSchemaV1(Schema.flip(json))
  +  "~encode": Schema.toStandardSchemaV1(Schema.flip(json))
   }
  ```

  A transforming schema without it fails with `give it a ~encode schema back to the saved form`.
- **Values that transform** (a `Date`, a `Map`) save through a `"~encode"` from any library. Zod's comes from the new `playbooks/zod.md` helper, built on Zod's own `safeEncode`: `Descriptor.ConstructedComponent(codec(z.codec(z.iso.datetime(), z.date(), { decode, encode })))`. With Valibot, ArkType, or any other Standard Schema library, write the reverse schema by hand:

  ```ts
  const Born = Descriptor.ConstructedComponent({
    "~standard": v.pipe(v.string(), v.isoTimestamp(), v.transform((text) => new Date(text)))["~standard"],
    "~encode": v.pipe(v.date(), v.transform((date) => date.toISOString()))
  })("Game/Born")
  ```
- **Handles and ritmo-math values inside a game's schema** are built from their guards with a schema that narrows to the guard's type: `z.unknown().refine(Entity.isHandle(Root))` in Zod, `v.pipe(v.unknown(), v.guard(...))` in Valibot, `type("unknown").narrow(...)` in ArkType, `Schema.declare(...)` in Effect. The docs said `z.custom(guard)`, which types the value as `unknown`.
