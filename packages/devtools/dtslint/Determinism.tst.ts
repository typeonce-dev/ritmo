import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import { Determinism } from "@typeonce/ritmo-devtools"
import { describe, expect, it } from "tstyche"

const Count = Descriptor.Resource<number>()("DetTypes/Count")
const Game = Schema.bind(Schema.fragment({ resources: { Count } }))
const make = ({ hostClock }: Determinism.Context) => ({
  runtime: Game.Runtime.make({ services: Game.Runtime.services(), resources: { Count: 0 }, debug: { hostClock } }).success,
  schedules: { update: Game.Schedule() }
})

describe("Determinism.check", () => {
  it("infers schedule names and the result", () => {
    expect(Determinism.check(make, { schedule: "update", frames: 10, hostClock: HostClock.test() })).type.toBe<Determinism.CheckResult>()
    // @ts-expect-error Type '"missing"' is not assignable to type '"update"'
    Determinism.check(make, { schedule: "missing", frames: 10, hostClock: HostClock.test() })
  })
  it("requires a debug runtime and injected host clock", () => {
    // @ts-expect-error Property 'debug' is missing
    Determinism.check(() => ({ runtime: Game.Runtime.make({ services: Game.Runtime.services() }).success, schedules: { update: Game.Schedule() } }), { schedule: "update", frames: 10, hostClock: HostClock.test() })
    // @ts-expect-error Property 'hostClock' is missing
    Determinism.check(make, { schedule: "update", frames: 10 })
  })
})
