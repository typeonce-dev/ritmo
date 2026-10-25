import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import { Determinism } from "@typeonce/ritmo-devtools"
import { describe, expect, it } from "tstyche"

const Count = Descriptor.Resource<number>()("DetTypes/Count")
const Game = Schema.bind(Schema.fragment({ resources: { Count } }))
const make = ({ hostClock }: Determinism.Context) => ({
  runtime: Game.Runtime.make({ services: Game.Runtime.services(), resources: { Count: 0 }, debug: { hostClock } }).value,
  schedules: { update: Game.Schedule() }
})

const Counted = Game.Inspector("DetTypes/Labels", { resources: { count: Game.System.readResource(Count) } }, ({ resources }) =>
  new Map([[1, `count ${resources.count.get()}`]]))

describe("Determinism.check", () => {
  it("takes the session's labels inspector", () => {
    expect(Determinism.check(make, { schedule: "update", frames: 10, hostClock: HostClock.test(), labels: Counted })).type.toBe<Determinism.CheckResult>()
    const Text = Game.Inspector("DetTypes/Text", {}, () => "player")
    // @ts-expect-error labels must return a ReadonlyMap<number, string> from entity id to label
    Determinism.check(make, { schedule: "update", frames: 10, hostClock: HostClock.test(), labels: Text })
    const bare = ({ hostClock }: Determinism.Context) => ({
      runtime: Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock } }).value,
      schedules: { update: Game.Schedule() }
    })
    // @ts-expect-error __fixLabelsRequirements__: { readonly __runtimeRequirementError__: "Missing resource"; readonly __requirement__: "DetTypes/Count"
    Determinism.check(bare, { schedule: "update", frames: 10, hostClock: HostClock.test(), labels: Counted })
  })

  it("infers schedule names and the result", () => {
    expect(Determinism.check(make, { schedule: "update", frames: 10, hostClock: HostClock.test() })).type.toBe<Determinism.CheckResult>()
    // @ts-expect-error Type '"missing"' is not assignable to type '"update"'
    Determinism.check(make, { schedule: "missing", frames: 10, hostClock: HostClock.test() })
  })
  it("requires a debug runtime and injected host clock", () => {
    // @ts-expect-error Property 'debug' is missing
    Determinism.check(() => ({ runtime: Game.Runtime.make({ services: Game.Runtime.services() }).value, schedules: { update: Game.Schedule() } }), { schedule: "update", frames: 10, hostClock: HostClock.test() })
    // @ts-expect-error Property 'hostClock' is missing
    Determinism.check(make, { schedule: "update", frames: 10 })
  })
})
