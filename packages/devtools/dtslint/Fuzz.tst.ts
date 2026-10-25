import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import type * as Result from "@typeonce/ritmo/Result"
import type * as Schedule from "@typeonce/ritmo/Schedule"
import type { Random } from "@typeonce/ritmo-math"
import { Fuzz, Invariant, Replay, Rendered } from "@typeonce/ritmo-devtools"
import { describe, expect, it } from "tstyche"
import * as Codecs from "../../core/test/codecs.ts"

const hostClock = HostClock.test()
const unwrap = <A>(result: Result.Result<A, unknown>): A => {
  if (!result.ok) throw new Error("fixture")
  return result.value
}

const Place = Descriptor.ConstructedComponent(Codecs.number)("FuzzTypes/Place")
const Limit = Descriptor.ConstructedResource(Codecs.number)("FuzzTypes/Limit")
const Pad = Descriptor.Service<Schedule.Source<{ readonly key: number }>>()("FuzzTypes/Pad")
const Rules = Descriptor.Service<{ readonly speed: number }>()("FuzzTypes/Rules")
const Page = Descriptor.Service<{ readonly toast: (message: string) => void }>()("FuzzTypes/Page")
const Game = Schema.bind(Schema.fragment({ components: { Place }, resources: { Limit } }))

const update = Game.Schedule(Game.System("FuzzTypes/Move", { services: { pad: Game.System.service(Pad), rules: Game.System.service(Rules) } }, () => {}))
const setup = Game.Schedule()
const make = (playback: Replay.Playback) => ({
  runtime: unwrap(Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(Pad, playback.source(Pad)), Game.Runtime.service(Rules, { speed: 1 })),
    resources: { Limit: 3 },
    debug: { hostClock }
  })),
  schedules: { setup, update },
  hostClock
})
const Pads = Fuzz.input(Pad, { generate: (random) => ({ key: random.integer(0, 3) }), neutral: { key: 0 } })
const UnderLimit = Invariant.fromInspector(Game.Inspector("under limit", { resources: { limit: Game.System.readResource(Limit) } }, ({ resources }) =>
  resources.limit.get() > 10 ? "over" : undefined))

describe("Fuzz.input", () => {
  it("infers the source's name and data", () => {
    expect(Pads).type.toBe<Fuzz.Input<"FuzzTypes/Pad", { readonly key: number }>>()
    expect<Parameters<typeof Pads.generate>>().type.toBe<[random: Random.Random, frame: number]>()
  })

  it("generates and rests at the type the source returns", () => {
    // @ts-expect-error Type 'string' is not assignable to type 'number'
    Fuzz.input(Pad, { generate: () => ({ key: "a" }), neutral: { key: 0 } })
    // @ts-expect-error Property 'key' is missing
    Fuzz.input(Pad, { generate: () => ({ key: 1 }), neutral: {} })
  })

  it("fuzzes only snapshot() sources", () => {
    // @ts-expect-error not assignable to parameter of type 'Descriptor<"service", "FuzzTypes/Rules", Source<unknown>>'
    Fuzz.input(Rules, { generate: () => ({ speed: 1 }), neutral: { speed: 0 } })
  })
})

describe("Fuzz.run", () => {
  it("returns the passed runs, or why it did not pass", () => {
    expect(Fuzz.run(make, { schedule: "update", setup: "setup", inputs: [Pads], invariants: [UnderLimit], frames: 10, seed: 1 }))
      .type.toBe<Result.Result<Rendered.Rendered<Fuzz.Passed>, Fuzz.FuzzError>>()
    expect<Fuzz.FuzzError["_tag"]>().type.toBe<"Found" | "Flaky" | "InvalidOptions" | "Unreplayable">()
    expect<Fuzz.Violation["_tag"]>().type.toBe<"InvariantViolated" | "SystemFailed" | "Defect">()
    expect<Fuzz.Found["replay"]>().type.toBe<Replay.ReplayFile>()
  })

  it("names only schedules make returns", () => {
    // @ts-expect-error Type '"missing"' is not assignable to type
    Fuzz.run(make, { schedule: "missing", inputs: [Pads], frames: 10, seed: 1 })
    // @ts-expect-error Type '"missing"' is not assignable to type
    Fuzz.run(make, { schedule: "update", setup: "missing", inputs: [Pads], frames: 10, seed: 1 })
  })

  it("needs at least one input", () => {
    // @ts-expect-error Source has 0 element(s) but target requires 1
    Fuzz.run(make, { schedule: "update", inputs: [], frames: 10, seed: 1 })
  })

  it("rejects an invariant that reads what the runtime does not provide", () => {
    const bare = (playback: Replay.Playback) => ({
      runtime: unwrap(Game.Runtime.make({
        services: Game.Runtime.services(Game.Runtime.service(Pad, playback.source(Pad)), Game.Runtime.service(Rules, { speed: 1 })),
        debug: { hostClock }
      })),
      schedules: { update },
      hostClock
    })
    // @ts-expect-error __fixInvariantRequirements__: { readonly __runtimeRequirementError__: "Missing resource"; readonly __requirement__: "FuzzTypes/Limit"
    Fuzz.run(bare, { schedule: "update", inputs: [Pads], invariants: [UnderLimit], frames: 10, seed: 1 })
  })

  it("rejects a schedule whose services could not be replayed, naming them", () => {
    const toasting = Game.Schedule(Game.System("FuzzTypes/Toast", { services: { page: Game.System.service(Page) } }, () => {}))
    const paged = (playback: Replay.Playback) => ({
      runtime: unwrap(Game.Runtime.make({
        services: Game.Runtime.services(Game.Runtime.service(Pad, playback.source(Pad)), Game.Runtime.service(Page, { toast: () => {} })),
        resources: { Limit: 3 },
        debug: { hostClock }
      })),
      schedules: { toasting },
      hostClock
    })
    // @ts-expect-error FuzzTypes/Page is neither a snapshot() source of plain data nor plain data
    Fuzz.run(paged, { schedule: "toasting", inputs: [Pads], frames: 10, seed: 1 })
  })
})

describe("Replay.session", () => {
  it("checks the invariants it stops at against the runtime", () => {
    const file = {} as Replay.ReplayFile
    expect(Replay.session).type.toBeCallableWith(make, file, { invariants: [UnderLimit] })
    expect(Replay.session).type.toBeCallableWith(make, file)
    const bare = (playback: Replay.Playback) => ({
      runtime: unwrap(Game.Runtime.make({
        services: Game.Runtime.services(Game.Runtime.service(Pad, playback.source(Pad)), Game.Runtime.service(Rules, { speed: 1 })),
        debug: { hostClock }
      })),
      schedules: { update },
      hostClock
    })
    // @ts-expect-error __fixInvariantRequirements__: { readonly __runtimeRequirementError__: "Missing resource"; readonly __requirement__: "FuzzTypes/Limit"
    Replay.session(bare, file, { invariants: [UnderLimit] })
  })
})
