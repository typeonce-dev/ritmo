import * as Core from "@typeonce/ritmo"
import { Descriptor, Schema } from "@typeonce/ritmo"
import { describe, expect, it } from "tstyche"

const Root = Schema.defineRoot("OneWay")
const Game = Schema.bind(Schema.fragment({ components: { Position: Descriptor.Component<{ x: number }>()("OneWay/Position") } }), Root)

// Each job has one API. These tests keep the removed second ways removed.
describe("one way to do each thing", () => {
  it("signals expected failure with Result.failure, not an effect type", () => {
    expect(Core).type.not.toHaveProperty("Fx")
    expect(Core).type.toHaveProperty("Result")
  })

  it("composes plugins as functions of Game, not feature objects", () => {
    expect(Schema).type.not.toHaveProperty("Feature")
    expect(Schema).type.toHaveProperty("bind")
  })

  it("binds every fragment in one call, with no separate merge", () => {
    expect(Schema).type.not.toHaveProperty("merge")
  })

  it("validates through descriptors, not a separate Definition module", () => {
    expect(Core).type.not.toHaveProperty("Definition")
    expect(Game.Command).type.toHaveProperty("entryRaw")
  })

  it("names per-entity states EntityState, apart from game-wide state machines", () => {
    expect(Descriptor).type.not.toHaveProperty("State")
    expect(Descriptor).type.toHaveProperty("EntityState")
    expect(Game).type.toHaveProperty("StateMachine")
  })
})
