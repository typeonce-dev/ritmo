import { Descriptor, Schema } from "@typeonce/ritmo"
import type * as Query from "@typeonce/ritmo/Query"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ readonly x: number; readonly y: number }>()("AnyOfTypes/Position")
const Sprite = Descriptor.Component<string>()("AnyOfTypes/Sprite")
const Foreign = Descriptor.Component<number>()("AnyOfTypes/Foreign")

const Game = Schema.bind(Schema.fragment({ components: { Position, Sprite } }))

describe("Game.Query.anyOf", () => {
  it("combines added and changed filters", () => {
    expect(Game.Query.anyOf(Game.Query.changed(Position), Game.Query.added(Sprite)))
      .type.toBe<Query.AnyOfFilter<typeof Position | typeof Sprite>>()
    const Redraw = Game.Query({
      selection: { position: Game.Query.read(Position) },
      filters: [Game.Query.anyOf(Game.Query.changed(Position), Game.Query.changed(Sprite))]
    })
    Game.System("AnyOfTypes/Redraw", { queries: { redraw: Redraw } }, ({ queries }) => {
      const { data } = queries.redraw
      for (const entity of queries.redraw.each()) {
        expect(data.position.get(entity)).type.toBe<{ readonly x: number; readonly y: number }>()
      }
    })
  })

  it("needs at least two filters", () => {
    // @ts-expect-error Expected at least 2 arguments, but got 1
    Game.Query.anyOf(Game.Query.changed(Position))
  })

  it("does not nest", () => {
    const inner = Game.Query.anyOf(Game.Query.changed(Position), Game.Query.changed(Sprite))
    // @ts-expect-error Property 'descriptor' is missing in type 'AnyOfFilter<
    Game.Query.anyOf(inner, Game.Query.changed(Sprite))
  })

  it("rejects a component of another game", () => {
    // @ts-expect-error Argument of type 'Descriptor<"component", "AnyOfTypes/Foreign", number>' is not assignable to parameter
    Game.Query.anyOf(Game.Query.changed(Position), Game.Query.changed(Foreign))
  })

  it("is rejected by Condition.check like other change filters", () => {
    Game.Condition.check("anyOf", {
      queries: {
        // @ts-expect-error Type 'QuerySpec<
        moved: Game.Query({
          selection: { position: Game.Query.read(Position) },
          filters: [Game.Query.anyOf(Game.Query.changed(Position), Game.Query.changed(Sprite))]
        })
      }
    }, () => true)
  })
})
