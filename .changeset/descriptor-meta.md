---
"@typeonce/ritmo": minor
"@typeonce/ritmo-devtools": minor
---

**Descriptor metadata: a field's unit, range, and hint next to its schema.** Every component and resource constructor (`Component`, `ConstructedComponent`, `TransientComponent`, `Resource`, `ConstructedResource`, `TransientResource`) takes an optional `meta` option keyed by the value's top-level fields. Each field gets `unit?: string`, `range?: readonly [min, max]` (number fields only), and `hint?: string` (one sentence an agent reads).

```ts
const Health = Descriptor.ConstructedComponent(z.object({ hp: z.number() }))("Game/Health", {
  meta: { hp: { unit: "points", range: [0, 100], hint: "Hit points left; 0 despawns the entity." } }
})
const Tuning = Descriptor.Resource<{ speed: number }>()("Game/Tuning", { meta: { speed: { unit: "px/s", range: [0, 400] } } })
```

- A key that is not a field of the value does not compile (`not a field of this value`, with the value's fields under `fields`); `range` on a non-number field does not compile (`` `range` is only for number fields``); a key other than `unit`, `range`, or `hint` does not compile. A malformed option from an unchecked caller throws, naming the descriptor.
- Metadata never replaces validation: the schema still decides what is valid, and snapshots do not save it. It is checked once at the constructor, frozen, and listed by `runtime.debug.describe()` as `meta` on every `ComponentDescription` and `ResourceDescription` (`{}` when none).
- Resource constructors now take an options argument (`ResourceOptions`); `ComponentOptions` gains `meta`. New types: `FieldMeta`, `MetaField`, `CheckedMeta`, `CheckedOptions`, `MetaInput`.
- Devtools: `session.report()` raises an `out-of-range` warning for every write (system writes, resources, spawns, inserts) of a number outside its declared range: `e1 Game/Health.hp written as 120, declared range [0, 100] by Game/Heal at frame 42`. The scan runs only in debug sessions; production runtimes never read the metadata.
- Devtools: `session.describe()` lists each field's metadata under its component or resource; `Format.fieldMeta(field, meta)` prints one field's line. The monitor's Entity tab shows units next to values and each field's unit, range, and hint in the value's tooltip.
