import { Descriptor, Schema } from "@typeonce/ritmo"
import type { ResourceChangedView } from "@typeonce/ritmo/System"
import { describe, expect, it } from "tstyche"

const Score = Descriptor.Resource<number>()("ChangedTypes/Score")
const Hud = Descriptor.Resource<{ readonly text: string }>()("ChangedTypes/Hud")
const OtherScore = Descriptor.Resource<number>()("ChangedTypes/OtherScore")

const Game = Schema.bind(Schema.fragment({ resources: { Score, Hud } }))
const Other = Schema.bind(Schema.fragment({ resources: { OtherScore } }))

describe("Game.System.changedResource", () => {
  it("gives a read view with changed()", () => {
    Game.System("ChangedTypes/Sync", {
      resources: { score: Game.System.changedResource(Score), hud: Game.System.changedResource(Hud) }
    }, ({ resources }) => {
      expect(resources.score).type.toBe<ResourceChangedView<number>>()
      expect(resources.score.changed()).type.toBe<boolean>()
      expect(resources.hud.get()).type.toBe<{ readonly text: string }>()
      // @ts-expect-error Property 'set' does not exist on type 'ResourceChangedView<number>'.
      resources.score.set(1)
    })
  })

  it("rejects a resource of another game", () => {
    // @ts-expect-error Argument of type 'Descriptor<"resource", "ChangedTypes/OtherScore", number>' is not assignable to parameter
    Game.System.changedResource(OtherScore)
    expect(Other.System.changedResource(OtherScore)).type.not.toBe<never>()
  })

  it("joins the thisTick order check", () => {
    const Count = Game.System("ChangedTypes/Count", { resources: { score: Game.System.writeResource(Score) } }, ({ resources }) => {
      resources.score.update((score) => score + 1)
    })
    const Show = Game.System("ChangedTypes/Show", {
      resources: { score: Game.System.thisTick(Game.System.changedResource(Score)) }
    }, ({ resources }) => {
      expect(resources.score.changed()).type.toBe<boolean>()
    })
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Score: 0, Hud: { text: "" } } }).success
    runtime.tick(Game.Schedule(Count, Show))
    // @ts-expect-error ChangedTypes/Show needs ChangedTypes/Score from this tick, but its writer ChangedTypes/Count runs after it
    runtime.tick(Game.Schedule(Show, Count))
  })

  it("can sit next to a write of the same resource", () => {
    Game.System("ChangedTypes/Both", {
      resources: { score: Game.System.writeResource(Score), seen: Game.System.changedResource(Score) }
    }, ({ resources }) => {
      expect(resources.seen.changed()).type.toBe<boolean>()
      resources.score.set(1)
    })
  })

  it("is rejected by Condition.check, which owns no cursor", () => {
    // @ts-expect-error changedResource consumes a per-reader cursor
    Game.Condition.check("changed", { resources: { score: Game.System.changedResource(Score) } }, () => true)
  })
})
