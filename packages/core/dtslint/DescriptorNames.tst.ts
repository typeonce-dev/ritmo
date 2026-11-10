import { Clock, Descriptor, Schema } from "@typeonce/ritmo"
import * as Codecs from "../test/codecs.ts"
import { describe, expect, it } from "tstyche"

// A helper typed `(name: string) => ...` gives every descriptor it makes one
// type; a generic helper keeps each name.
type Rejected = { readonly __fixName__: Descriptor.NameFix }
declare const wide: string

const Root = Schema.defineRoot("Names")
const Game = Schema.bind(Schema.fragment({ resources: {} }), Root)
const Flow = Game.StateMachine("Names/Flow", { Menu: {}, Playing: {} })

describe("a descriptor name typed string", () => {
  it("makes no descriptor from any constructor", () => {
    expect(Descriptor.Component<number>()(wide)).type.toBe<Rejected>()
    expect(Descriptor.ConstructedComponent(Codecs.safeVector)(wide)).type.toBe<Rejected>()
    expect(Descriptor.TransientComponent<number>()(wide)).type.toBe<Rejected>()
    expect(Descriptor.Tag(wide)).type.toBe<Rejected>()
    expect(Descriptor.EntityState(wide, { Idle: {} })).type.toBe<Rejected>()
    expect(Descriptor.Resource<number>()(wide)).type.toBe<Rejected>()
    expect(Descriptor.ConstructedResource(Codecs.safeVector)(wide)).type.toBe<Rejected>()
    expect(Descriptor.TransientResource<number>()(wide)).type.toBe<Rejected>()
    expect(Descriptor.Event<number>()(wide)).type.toBe<Rejected>()
    expect(Descriptor.Service<number>()(wide)).type.toBe<Rejected>()
    expect(Descriptor.Hierarchy(wide, "Names/Children")).type.toBe<Rejected>()
    expect(Descriptor.Relation("Names/Targets", wide)).type.toBe<Rejected>()
    expect(Game.StateMachine(wide, { A: {} })).type.toBe<Rejected>()
    expect(Game.StateMachine(wide, { A: {} }, { within: [Flow, "Playing"] })).type.toBe<Rejected>()
    expect(Game.EntityScope(wide)).type.toBe<Rejected>()
    expect(Clock.resource(wide, Clock.hz(60))).type.toBe<Rejected>()
  })

  it("names the fix where the value is used", () => {
    const mk = (name: string) => Descriptor.Component<number>()(name)
    const One = mk("Names/One")
    const Two = Descriptor.Component<number>()("Names/Two")
    // @ts-expect-error a descriptor's name is a literal type: pass the name as a literal or `as const`, or make the helper generic over it
    Schema.fragment({ components: { One } })
    Schema.fragment({ components: { Two } })
    const Score = Descriptor.Resource<number>()(wide)
    // @ts-expect-error a descriptor's name is a literal type
    Schema.fragment({ resources: { Score } })
  })
})

describe("a descriptor name from a generic helper", () => {
  const component = <const Name extends string>(name: Name) => Descriptor.Component<number>()(name)
  const resource = <const Name extends string>(name: Name) => Descriptor.ConstructedResource(Codecs.safeVector)(name)

  it("keeps each literal name, so two descriptors differ", () => {
    const One = component("Names/One")
    const Two = component("Names/Two")
    expect(One).type.toBe<Descriptor.Descriptor<"component", "Names/One", number>>()
    expect(One).type.not.toBe(Two)
    expect(resource("Names/Size").name).type.toBe<"Names/Size">()
    const Local = Schema.bind(Schema.fragment({ components: { One, Two } }), Schema.defineRoot("NamesLocal"))
    expect(Local.Query({ selection: { one: Local.Query.read(One) } })).type.not.toBe(Local.Query({ selection: { one: Local.Query.read(Two) } }))
  })

  it("accepts a name passed `as const`", () => {
    const name = "Names/Const" as const
    expect(Descriptor.Tag(name).name).type.toBe<"Names/Const">()
  })
})
