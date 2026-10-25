import { Descriptor } from "@typeonce/ritmo"
import type * as Debug from "@typeonce/ritmo/Debug"
import type * as DescriptorTypes from "@typeonce/ritmo/Descriptor"
import { describe, expect, it } from "tstyche"
import { z } from "zod"
import * as Codecs from "../test/codecs.ts"

const HealthSchema = Codecs.struct({ hp: Codecs.number, name: Codecs.string })
type Health = { readonly hp: number; readonly name: string; readonly armor?: number }

describe("descriptor meta", () => {
  it("keeps the descriptor type of every constructor", () => {
    expect(Descriptor.ConstructedComponent(HealthSchema)("MetaTypes/Health", {
      meta: { hp: { unit: "points", range: [0, 100], hint: "Hit points left." }, name: { hint: "Shown above the bar." } }
    })).type.toBe<DescriptorTypes.ConstructedDescriptor<"component", "MetaTypes/Health", { readonly hp: number; readonly name: string }, { readonly hp: number; readonly name: string }, DescriptorTypes.SchemaIssues>>()
    expect(Descriptor.Component<Health>()("MetaTypes/Plain", { meta: { armor: { range: [0, 10] } } })).type.toBe<
      DescriptorTypes.Descriptor<"component", "MetaTypes/Plain", Health>
    >()
    expect(Descriptor.Component<Health>()("MetaTypes/Fixed", { immutable: true, meta: { hp: { unit: "points" } } })).type.toBe<
      DescriptorTypes.Descriptor<"component", "MetaTypes/Fixed", Health> & DescriptorTypes.Immutable
    >()
    expect(Descriptor.TransientComponent<Health>()("MetaTypes/Cache", { meta: { hp: { unit: "points" } } })).type.toBe<
      DescriptorTypes.TransientDescriptor<"component", "MetaTypes/Cache", Health>
    >()
    expect(Descriptor.Resource<Health>()("MetaTypes/Boss", { meta: { hp: { range: [0, 500] } } })).type.toBe<
      DescriptorTypes.Descriptor<"resource", "MetaTypes/Boss", Health>
    >()
    expect(Descriptor.ConstructedResource(z.object({ speed: z.number() }))("MetaTypes/Tuning", { meta: { speed: { unit: "px/s", range: [0, 400] } } })).type.toBe<
      DescriptorTypes.ConstructedDescriptor<"resource", "MetaTypes/Tuning", { speed: number }, { speed: number }, DescriptorTypes.SchemaIssues>
    >()
    expect(Descriptor.TransientResource<Health>()("MetaTypes/Frame", { meta: { name: { hint: "Who." } } })).type.toBe<
      DescriptorTypes.TransientDescriptor<"resource", "MetaTypes/Frame", Health>
    >()
  })

  it("infers the fields meta can describe", () => {
    expect<DescriptorTypes.MetaField<Health>>().type.toBe<"hp" | "name" | "armor">()
    expect<DescriptorTypes.MetaField<number>>().type.toBe<never>()
    expect<DescriptorTypes.MetaField<ReadonlyArray<number>>>().type.toBe<never>()
    expect<Debug.ComponentDescription["meta"]>().type.toBe<Readonly<Record<string, DescriptorTypes.FieldMeta>>>()
    expect<Debug.ResourceDescription["meta"]>().type.toBe<Readonly<Record<string, DescriptorTypes.FieldMeta>>>()
  })

  it("rejects a key that is not a field of the value", () => {
    // @ts-expect-error not a field of this value: meta keys are the value's top-level fields
    Descriptor.ConstructedComponent(HealthSchema)("MetaTypes/Typo", { meta: { hpp: { unit: "points" } } })
    // @ts-expect-error not a field of this value: meta keys are the value's top-level fields
    Descriptor.Resource<Health>()("MetaTypes/TypoResource", { meta: { mana: { unit: "points" } } })
    // @ts-expect-error this value has no fields: meta describes the top-level fields of an object value
    Descriptor.Resource<number>()("MetaTypes/Gold", { meta: { toFixed: { unit: "coins" } } })
  })

  it("allows range only on number fields", () => {
    // @ts-expect-error `range` is only for number fields: describe this field with `unit` or `hint`
    Descriptor.ConstructedComponent(HealthSchema)("MetaTypes/NameRange", { meta: { name: { range: [0, 1] } } })
    // @ts-expect-error `range` is only for number fields
    Descriptor.TransientComponent<Health>()("MetaTypes/NameRangeTransient", { meta: { name: { range: [0, 1] } } })
  })

  it("rejects keys a field's meta does not have", () => {
    // @ts-expect-error a field's meta has only `unit`, `range`, and `hint`
    Descriptor.Component<Health>()("MetaTypes/Units", { meta: { hp: { unit: "points", units: "points" } } })
    // @ts-expect-error `unit` and `hint` are strings
    Descriptor.Component<Health>()("MetaTypes/UnitNumber", { meta: { hp: { unit: 1 } } })
  })

  it("rejects options a resource does not have", () => {
    // @ts-expect-error Object literal may only specify known properties
    Descriptor.Resource<Health>()("MetaTypes/ImmutableResource", { immutable: true })
  })
})
