import { Clock, Descriptor, HostClock, type Random, Schema } from "@typeonce/ritmo"
import type * as Result from "@typeonce/ritmo/Result"
import type * as Schedule from "@typeonce/ritmo/Schedule"
import type * as System from "@typeonce/ritmo/System"
import { Fuzz, Invariant, Replay, Rendered } from "@typeonce/ritmo-devtools"
import type { Netcode } from "@typeonce/ritmo-netcode"
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
interface MarkedSource extends System.Consumes<"snapshot"> {
  readonly snapshot: () => { readonly key: number }
}
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

  it("fuzzes a source that marks snapshot() as draining, as every browser input source does", () => {
    const Marked = Descriptor.Service<MarkedSource>()("FuzzTypes/Marked")
    expect(Fuzz.input(Marked, { generate: () => ({ key: 1 }), neutral: { key: 0 } })).type.toBe<Fuzz.Input<"FuzzTypes/Marked", { readonly key: number }>>()
    expect(Game.Runtime.service).type.toBeCallableWith(Marked, ({} as Replay.Playback).source(Marked))
  })

  it("rejects a source declared as the whole device, naming the fix", () => {
    const Device = Descriptor.Service<{ readonly snapshot: () => { readonly key: number }; readonly rebind: (key: string) => void }>()("FuzzTypes/Device")
    // @ts-expect-error FuzzTypes/Device has more than snapshot(), so a replay cannot provide it
    Fuzz.input(Device, { generate: () => ({ key: 1 }), neutral: { key: 0 } })
    // @ts-expect-error FuzzTypes/Device has more than snapshot(), so a replay cannot provide it
    ;({} as Replay.Playback).source(Device)
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
    expect<Fuzz.Violation["_tag"]>().type.toBe<"InvariantViolated" | "SystemFailed" | "Defect" | "SessionFailed">()
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

describe("Fuzz.seats and run's network", () => {
  type Move = { readonly dx: number }
  const MoveCodec = Codecs.struct({ dx: Codecs.number })
  const Seats = Descriptor.Service<Netcode.Source<Move>>()("FuzzTypes/Seats")
  const Moves = Fuzz.seats(Seats, { codec: MoveCodec, count: 2, generate: (random, _frame, seat) => ({ dx: random.integer(-1, 2) * seat }), idle: { dx: 0 } })
  const Remember = Game.System("FuzzTypes/Remember", { local: () => ({ runs: 0 }), services: { seats: Game.System.consumeService(Seats) } }, ({ local }) => {
    local.runs++
  })
  const Read = Game.System("FuzzTypes/Read", { services: { seats: Game.System.consumeService(Seats) } }, () => {})
  const networked = (playback: Replay.Playback) => ({
    runtime: unwrap(Game.Runtime.make({ services: Game.Runtime.services(Game.Runtime.service(Seats, playback.source(Seats))), resources: { Limit: 3 }, debug: { hostClock } })),
    schedules: { update: Game.Schedule(Read), remember: Game.Schedule(Remember) },
    hostClock
  })
  const network = { seed: 1, latencyMS: 40, loss: 0.1, step: Clock.hz(60) }

  it("infers every seat's input from the codec", () => {
    expect(Moves).type.toBe<Fuzz.Seats<"FuzzTypes/Seats", { readonly dx: number }>>()
    expect(Moves).type.toBeAssignableTo<Fuzz.Input<"FuzzTypes/Seats", ReadonlyArray<Move>>>()
    expect<Parameters<Parameters<typeof Fuzz.seats>[1]["generate"]>>().type.toBe<[random: Random.Random, frame: number, seat: number]>()
  })

  it("rejects a codec of another input, and a seats service that is not a Netcode.Source", () => {
    // @ts-expect-error Type 'string' is not assignable to type 'number'
    Fuzz.seats(Seats, { codec: MoveCodec, count: 2, generate: () => ({ dx: "left" }), idle: { dx: 0 } })
    // @ts-expect-error not assignable to parameter of type 'Descriptor<"service", "FuzzTypes/Pad", Source<{ readonly dx: number; }>>'
    Fuzz.seats(Pad, { codec: MoveCodec, count: 2, generate: () => ({ dx: 0 }), idle: { dx: 0 } })
  })

  it("fuzzes over a network with the same run", () => {
    expect(Fuzz.run(networked, { schedule: "update", inputs: [Moves], frames: 10, seed: 1, network }))
      .type.toBe<Result.Result<Rendered.Rendered<Fuzz.Passed>, Fuzz.FuzzError>>()
    expect(Fuzz.run(networked, { schedule: "update", inputs: [Moves], frames: 10, seed: 1 }))
      .type.toBe<Result.Result<Rendered.Rendered<Fuzz.Passed>, Fuzz.FuzzError>>()
    const violation = {} as Fuzz.Violation
    if (violation._tag === "SessionFailed") expect(violation.error).type.toBe<Netcode.SessionError<unknown>>()
  })

  it("over a network, takes only a Fuzz.seats input", () => {
    // @ts-expect-error is missing the following properties from type 'Seats<string, unknown>': codec
    Fuzz.run(make, { schedule: "update", inputs: [Pads], frames: 10, seed: 1, network })
  })

  it("over a network, rejects a schedule that cannot be rewound, as Netcode.rollback does", () => {
    expect(Fuzz.run).type.toBeCallableWith(networked, { schedule: "remember", inputs: [Moves], frames: 10, seed: 1 })
    // @ts-expect-error FuzzTypes/Remember keeps local state, which a rewind cannot put back
    Fuzz.run(networked, { schedule: "remember", inputs: [Moves], frames: 10, seed: 1, network })
  })

  it("rejects network options of the wrong shape", () => {
    // @ts-expect-error Property 'step' is missing
    Fuzz.run(networked, { schedule: "update", inputs: [Moves], frames: 10, seed: 1, network: { seed: 1, latencyMS: 40 } })
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
