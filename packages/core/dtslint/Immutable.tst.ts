import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Codecs from "../test/codecs.ts"
import type * as DescriptorTypes from "@typeonce/ritmo/Descriptor"
import type * as Query from "@typeonce/ritmo/Query"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ readonly x: number; readonly y: number }>()("ImmutableTypes/Position")
const Kind = Descriptor.Component<"wall" | "pickup">()("ImmutableTypes/Kind", { immutable: true })
const Team = Descriptor.ConstructedComponent(Codecs.literal("red", "blue"))("ImmutableTypes/Team", { immutable: true })
const Cache = Descriptor.TransientComponent<number>()("ImmutableTypes/Cache", { immutable: true })

const Game = Schema.bind(Schema.fragment({ components: { Position, Kind, Team, Cache } }))

describe("immutable components", () => {
  it("brands only components declared immutable", () => {
    expect(Kind).type.toBe<DescriptorTypes.Descriptor<"component", "ImmutableTypes/Kind", "wall" | "pickup"> & DescriptorTypes.Immutable>()
    expect(Cache).type.toBe<DescriptorTypes.TransientDescriptor<"component", "ImmutableTypes/Cache", number> & DescriptorTypes.Immutable>()
    expect(Position).type.toBe<DescriptorTypes.Descriptor<"component", "ImmutableTypes/Position", { readonly x: number; readonly y: number }>>()
  })

  it("accepts only immutable: true", () => {
    // @ts-expect-error Type 'false' is not assignable to type 'true'
    Descriptor.Component<string>()("ImmutableTypes/Bad", { immutable: false })
  })

  it("reads an immutable component", () => {
    expect(Game.Query.read(Kind)).type.toBe<Query.ReadAccess<typeof Kind>>()
    expect(Game.Query.optional(Team)).type.toBe<Query.OptionalReadAccess<typeof Team>>()
    expect(Game.Query.write(Position)).type.toBe<Query.WriteAccess<typeof Position>>()
  })

  it("rejects a write slot, naming commands.insert", () => {
    // @ts-expect-error ImmutableTypes/Kind is immutable: replace it with commands.insert(entity, [ImmutableTypes/Kind, value])
    Game.Query.write(Kind)
    // @ts-expect-error ImmutableTypes/Team is immutable: replace it with commands.insert
    Game.Query.write(Team)
    // @ts-expect-error ImmutableTypes/Cache is immutable: replace it with commands.insert
    Game.Query.write(Cache)
  })

  it("is replaced with an insert", () => {
    Game.System("ImmutableTypes/Upgrade", {
      queries: { kinds: Game.Query({ selection: { kind: Game.Query.read(Kind) } }) },
      commands: Game.System.commands(Game.System.inserts(Kind))
    }, ({ queries, commands }) => {
      for (const entity of queries.kinds.each()) {
        commands.insert(entity, [Kind, "pickup"])
      }
    })
  })
})
