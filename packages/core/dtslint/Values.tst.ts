import { Decode, Descriptor, Result, Schema } from "@typeonce/ritmo"
import type { Handle } from "@typeonce/ritmo/Entity"
import { describe, expect, it } from "tstyche"

describe("Result", () => {
  it("keeps value and error types through narrowing, match, and all", () => {
    const parsed = Result.succeed(1) as Result.Result<number, "NaN">
    if (parsed._tag === "Success") expect(parsed.success).type.toBe<number>()
    else expect(parsed.failure).type.toBe<"NaN">()
    expect(Result.match(parsed, { onSuccess: (value) => value > 0, onFailure: (error) => error })).type.toBe<boolean | "NaN">()

    const name = Result.succeed("a") as Result.Result<string, "Empty">
    expect(Result.all([parsed, name])).type.toBe<Result.Result<readonly [number, string], "NaN" | "Empty">>()
    expect(Result.all({ parsed, name })).type.toBe<Result.Result<{ readonly parsed: number; readonly name: string }, "NaN" | "Empty">>()
  })
})

describe("Decode", () => {
  const Root = Schema.defineRoot("Values")
  const Health = Descriptor.Component<number>()("Values/Health")

  it("infers the decoded type of each codec", () => {
    expect(Decode.literal("idle", "run")).type.toBe<Decode.Codec<"idle" | "run">>()
    expect(Decode.nullable(Decode.number)).type.toBe<Decode.Codec<number | null>>()
    expect(Decode.array(Decode.string)).type.toBe<Decode.Codec<ReadonlyArray<string>>>()
    expect(Decode.struct({ level: Decode.integer, tags: Decode.array(Decode.string) })).type.toBe<
      Decode.Codec<{ readonly level: number; readonly tags: ReadonlyArray<string> }>
    >()
    expect(Decode.handle(Root, Health)).type.toBe<Decode.Codec<Handle<typeof Root, typeof Health>>>()
  })

  it("makes constructed descriptors whose values and raw input follow the codec", () => {
    const Stats = Descriptor.ConstructedComponent(Decode.struct({ level: Decode.integer }))("Values/Stats")
    expect<Descriptor.Descriptor.Value<typeof Stats>>().type.toBe<{ readonly level: number }>()
    expect<Descriptor.Descriptor.Raw<typeof Stats>>().type.toBe<{ readonly level: number }>()
  })

  it("rejects codecs that cannot be built", () => {
    // @ts-expect-error Expected at least 1 arguments, but got 0
    Decode.literal()
    // @ts-expect-error Type 'number' is not assignable to type 'Codec<any>'
    Decode.struct({ level: 1 })
  })
})

describe("Descriptor values", () => {
  it("infers the descriptor of a typed value", () => {
    const Health = Descriptor.Component<number>()("Values/TypedHealth")
    expect(Health).type.toBe<Descriptor.Descriptor<"component", "Values/TypedHealth", number>>()
    expect(Descriptor.Resource<unknown>()("Values/Blob")).type.toBe<Descriptor.Descriptor<"resource", "Values/Blob", unknown>>()
  })

  it("rejects any and never as a value", () => {
    // @ts-expect-error a component value cannot be `any`
    Descriptor.Component<any>()("Values/Anything")
    // @ts-expect-error a component value cannot be `never`
    Descriptor.Component<never>()("Values/Gone")
    // @ts-expect-error a component value cannot be `any`
    Descriptor.TransientComponent<any>()("Values/AnyTrail")
    // @ts-expect-error a resource value cannot be `any`
    Descriptor.Resource<any>()("Values/AnyScore")
    // @ts-expect-error a resource value cannot be `never`
    Descriptor.TransientResource<never>()("Values/NoTime")
    // @ts-expect-error an event value cannot be `any`
    Descriptor.Event<any>()("Values/AnyHit")
    // @ts-expect-error a service value cannot be `any`
    Descriptor.Service<any>()("Values/AnyLogger")
  })
})
