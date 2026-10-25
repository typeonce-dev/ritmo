import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import { Format, Session } from "@typeonce/ritmo-devtools"
import { describe, expect, it } from "tstyche"

const hostClock = HostClock.test()

const Health = Descriptor.Component<number>()("WhyTypes/Health")
const Score = Descriptor.Resource<number>()("WhyTypes/Score")
const Game = Schema.bind(Schema.fragment({ components: { Health }, resources: { Score } }))
const update = Game.Schedule(Game.System("WhyTypes/Noop", {}, () => {}))
const session = Session.make(Game.Runtime.make({ services: Game.Runtime.services(), resources: { Score: 0 }, debug: { hostClock } }).value, { hostClock, schedules: { update } })

describe("Session why depth", () => {
  it("takes a depth next to limit, and returns lines carrying their depth", () => {
    expect(session.why).type.toBeCallableWith(1, Health, { depth: 3, limit: 2 })
    expect(session.whyResource).type.toBeCallableWith(Score, { depth: 2 })
    expect(session.why(1, Health, { depth: 2 }).data).type.toBe<ReadonlyArray<Format.Line>>()
    expect(session.why(1, Health).data[0]!.depth).type.toBe<number>()
    expect<Session.WhyOptions>().type.toBe<{ readonly limit?: number; readonly depth?: number }>()
  })

  it("rejects a depth that is not a number", () => {
    // @ts-expect-error Type 'string' is not assignable to type 'number'
    session.why(1, Health, { depth: "2" })
    session.why(1, Health, { depth: 2 })
    // @ts-expect-error Object literal may only specify known properties, and 'deep' does not exist in type 'WhyOptions'
    session.whyResource(Score, { deep: 2 })
  })

  it("lists read lines as their own journal kind", () => {
    expect<"read">().type.toBeAssignableTo<Format.LineKind>()
  })
})
