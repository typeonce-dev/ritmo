import { Clock, Descriptor, FixedLoop, HostClock, Result, Schema } from "@typeonce/ritmo"
import { BrowserVisibility, InputCapture } from "@typeonce/ritmo-browser"
import type { SystemFailure } from "@typeonce/ritmo/System"
import { MemoryNetworkLink, MemoryVisibility, Netcode, NetworkLink, Visibility, WebRtcNetworkLink, WebSocketNetworkLink } from "@typeonce/ritmo-netcode"
import { describe, expect, it } from "tstyche"

interface Input {
  readonly dx: number
}
const InputSchema: Descriptor.StandardSchema<Input, Input> = { "~standard": { version: 1, vendor: "types", validate: (value) => ({ value: value as Input }) } }
const Whole: Descriptor.StandardSchema<number, number> = { "~standard": { version: 1, vendor: "types", validate: (value) => ({ value: value as number }) } }
const Transforming: Descriptor.StandardSchema<string, Date> = { "~standard": { version: 1, vendor: "types", validate: (value) => ({ value: new Date(value as string) }) } }

const step = Clock.hz(60)
const Seats = Descriptor.Service<Netcode.Source<Input>>()("NetTypes/Seats")
const Inputs = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof Seats>>()("NetTypes/Inputs")
const Score = Descriptor.ConstructedResource(Whole)("NetTypes/Score")
const Sound = Descriptor.Service<{ readonly play: () => void }>()("NetTypes/Sound")
const Hit = Descriptor.Event<{ readonly seat: number; readonly at: { readonly x: number } }>()("NetTypes/Hit")
const Elsewhere = Descriptor.Event<{ readonly seat: number }>()("NetTypes/Elsewhere")

const Game = Schema.bind(Schema.fragment({ resources: { Inputs, Score }, events: { Hit } }))
const Capture = InputCapture.system(Game, { name: "NetTypes/Capture", source: Seats, resource: Inputs })
const Fail = Game.System("NetTypes/Fail", {}, () => Result.failure("Overflow" as const))
const Remember = Game.System("NetTypes/Remember", { local: () => ({ runs: 0 }) }, ({ local }) => {
  local.runs++
})
const Noisy = Game.System("NetTypes/Noisy", { services: { sound: Game.System.service(Sound) } }, ({ services }) => services.sound.play())
const simulate = Game.Schedule(Capture, Fail)

const seats = Netcode.seats(InputSchema, { count: 2, idle: { dx: 0 } })
declare const theSeats: Netcode.Seats<Input>
const made = Game.Runtime.make({
  services: Game.Runtime.services(Game.Runtime.service(Seats, theSeats.source), Game.Runtime.service(Sound, { play: () => {} })),
  resources: { Inputs: [], Score: 0 }
})
if (!made.ok) throw new Error("the resources are valid")
const runtime = made.value
const hostClock = HostClock.test()
declare const link: NetworkLink.NetworkLink
const options = { seats: theSeats, seat: 0, links: [link], hostClock, step }

describe("Netcode.seats", () => {
  it("infers the input type from the schema", () => {
    expect(seats).type.toBe<Result.Result<Netcode.Seats<Input>, Netcode.InvalidOptions>>()
    expect(theSeats.source).type.toBeAssignableTo<InputCapture.Source<ReadonlyArray<Input>>>()
  })

  it("rejects an idle input of another type", () => {
    // @ts-expect-error Type 'string' is not assignable to type 'number'
    Netcode.seats(InputSchema, { count: 2, idle: { dx: "left" } })
  })

  it("rejects a schema that transforms without an encode, like a constructed descriptor", () => {
    // @ts-expect-error give it a ~encode schema back to the saved form
    Netcode.seats(Transforming, { count: 2, idle: new Date(0) })
  })
})

describe("Netcode.rollback", () => {
  it("returns a session of the seats' input and the schedule's failure", () => {
    expect(Netcode.rollback(runtime, { ...options, simulate })).type.toBe<Result.Result<Netcode.Session<Input, SystemFailure<"NetTypes/Fail", "Overflow">, typeof Hit>, Netcode.InvalidOptions>>()
  })

  it("narrows what advance did, and why it failed", () => {
    const session = Netcode.rollback(runtime, { ...options, simulate })
    if (!session.ok) return
    const advanced = session.value.advance({ dx: 1 })
    if (advanced.ok && advanced.value._tag === "Ran") expect(advanced.value.input).type.toBe<number | undefined>()
    if (!advanced.ok && advanced.error._tag === "TickFailed") expect(advanced.error.error.error).type.toBe<"Overflow">()
    expect(session.value.advance).type.not.toBeCallableWith({ dx: "left" })
  })

  it("rejects a schedule that cannot be rewound", () => {
    // @ts-expect-error NetTypes/Remember keeps local state, which a rewind cannot put back
    Netcode.rollback(runtime, { ...options, simulate: Game.Schedule(Capture, Remember) })
    // @ts-expect-error NetTypes/Sound is neither a snapshot() source, plain data, nor Checkpoint.rewindable
    Netcode.rollback(runtime, { ...options, simulate: Game.Schedule(Capture, Noisy) })
  })

  it("rejects a schedule whose requirements the runtime does not provide", () => {
    const Missing = Descriptor.Service<{ readonly speed: number }>()("NetTypes/Missing")
    const Needs = Game.System("NetTypes/Needs", { services: { missing: Game.System.service(Missing) } }, () => {})
    // @ts-expect-error Missing service
    Netcode.rollback(runtime, { ...options, simulate: Game.Schedule(Capture, Needs) })
  })

  it("rejects a runtime that cannot save", () => {
    const Loose = Descriptor.Resource<number>()("NetTypes/Loose")
    const Unsaved = Schema.bind(Schema.fragment({ resources: { Inputs, Loose } }))
    const unsaved = Unsaved.Runtime.make({ services: Unsaved.Runtime.services(Unsaved.Runtime.service(Seats, theSeats.source)), resources: { Inputs: [], Loose: 0 } }).value
    const capture = InputCapture.system(Unsaved, { name: "NetTypes/UnsavedCapture", source: Seats, resource: Inputs })
    // @ts-expect-error NetTypes/Loose needs a schema
    Netcode.rollback(unsaved, { ...options, simulate: Unsaved.Schedule(capture) })
  })
})

describe("session.events", () => {
  const session = Netcode.rollback(runtime, { ...options, simulate })
  if (!session.ok) throw new Error("the options are valid")

  it("reads an event of the runtime's schema, with its value type and the tick", () => {
    const hits = session.value.events(Hit)
    expect(hits).type.toBe<Netcode.EventStreams<{ readonly seat: number; readonly at: { readonly x: number } }>>()
    expect(hits.confirmed()).type.toBe<ReadonlyArray<Netcode.EventRecord<{ readonly seat: number; readonly at: { readonly x: number } }>>>()
    expect(hits.predicted()).type.toBe<ReadonlyArray<Netcode.EventRecord<{ readonly seat: number; readonly at: { readonly x: number } }>>>()
    expect(hits.withdrawn()).type.toBe<ReadonlyArray<Netcode.Withdrawn>>()
    expect(hits.lost()).type.toBe<Netcode.EventsLost | undefined>()
    for (const { tick, value } of hits.confirmed()) {
      expect(tick).type.toBe<number>()
      // @ts-expect-error Cannot assign to 'seat' because it is a read-only property
      value.seat = 1
    }
  })

  it("rejects an event outside the runtime's schema", () => {
    expect(session.value.events).type.toBeCallableWith(Hit)
    // @ts-expect-error Argument of type 'Descriptor<"event", "NetTypes/Elsewhere"
    session.value.events(Elsewhere)
  })

  it("reads nothing through a session typed without its events", () => {
    const untyped: Netcode.Session<Input, unknown> = session.value
    expect(untyped.events).type.not.toBeCallableWith(Hit)
  })
})

describe("Netcode.lockstep", () => {
  it("runs a schedule with local state: nothing is run again", () => {
    expect(Netcode.lockstep(runtime, { ...options, simulate: Game.Schedule(Capture, Remember) })).type.toBe<Result.Result<Netcode.Session<Input, never, typeof Hit>, Netcode.InvalidOptions>>()
  })

  it("takes no rollback options", () => {
    // @ts-expect-error 'maxRollback' does not exist
    Netcode.lockstep(runtime, { ...options, simulate, maxRollback: 4 })
  })
})

describe("NetworkLink", () => {
  it("is three methods any transport implements", () => {
    expect<NetworkLink.NetworkLink>().type.toBe<{
      readonly send: (message: string) => void
      readonly receive: () => ReadonlyArray<string>
      readonly status: () => NetworkLink.Status
    }>()
    expect(MemoryNetworkLink.make({ peers: 2, hostClock, seed: 1, latencyMS: 0 })).type.toBe<Result.Result<ReadonlyArray<MemoryNetworkLink.MemoryNetworkLink>, MemoryNetworkLink.InvalidOptions>>()
  })
})

describe("WebSocketNetworkLink and WebRtcNetworkLink", () => {
  it("take the platform's own socket and channel", () => {
    expect(WebSocketNetworkLink.make).type.toBeCallableWith(new WebSocket("wss://relay.example.com"))
    expect(WebRtcNetworkLink.make).type.toBeCallableWith(new RTCPeerConnection().createDataChannel("ritmo"))
    expect(WebSocketNetworkLink.make(new WebSocket("wss://relay.example.com"))).type.toBe<NetworkLink.NetworkLink>()
  })

  it("reject what is not a socket", () => {
    expect(WebSocketNetworkLink.make).type.not.toBeCallableWith({ send: (_: string) => {} })
    expect(WebRtcNetworkLink.make).type.not.toBeCallableWith(new WebSocket("wss://relay.example.com"))
  })
})

describe("session.update", () => {
  it("is a FixedLoop update, inline, whose loop fails only when the session ended", () => {
    const session = Netcode.rollback(runtime, { ...options, simulate })
    if (!session.ok) return
    FixedLoop.start({
      source: FixedLoop.source(() => ({ stop() {} })), step, maxFrameSeconds: 0.25, maxStepsPerFrame: 5,
      rate: session.value.rate,
      update: session.value.update({
        input: () => ({ dx: 0 }),
        onHalted: (error) => {
          expect(error).type.toBe<Netcode.Halted<SystemFailure<"NetTypes/Fail", "Overflow">>>()
        }
      }),
      render: () => {},
      onFailure: (failure) => {
        expect(failure).type.toBe<FixedLoop.Failure<Netcode.Ended>>()
      }
    })
    expect(session.value.update).type.not.toBeCallableWith({ input: () => ({ dx: "left" }), onHalted: () => {} })
  })

  it("narrows a halt from an end", () => {
    const error = {} as Netcode.SessionError<"Overflow">
    if (Netcode.isHalted(error)) expect(error).type.toBe<Netcode.Halted<"Overflow">>()
    else expect(error).type.toBe<Netcode.Ended>()
  })
})

describe("hidden", () => {
  const visibility = MemoryVisibility.make()

  it("takes a visibility, a bound, and a policy, in both sessions", () => {
    expect(Netcode.rollback(runtime, { ...options, simulate, hidden: { visibility, afterMS: 10_000, then: "resync-on-return" } })).type.toBe<Result.Result<Netcode.Session<Input, SystemFailure<"NetTypes/Fail", "Overflow">, typeof Hit>, Netcode.InvalidOptions>>()
    expect(Netcode.lockstep(runtime, { ...options, simulate, hidden: { visibility, afterMS: 10_000, then: "stall" } })).type.toBe<Result.Result<Netcode.Session<Input, SystemFailure<"NetTypes/Fail", "Overflow">, typeof Hit>, Netcode.InvalidOptions>>()
    expect<Netcode.HiddenPolicy>().type.toBe<"stall" | "resync-on-return">()
  })

  it("rejects a policy it does not know", () => {
    // @ts-expect-error Type '"drop"' is not assignable to type 'HiddenPolicy'
    Netcode.rollback(runtime, { ...options, simulate, hidden: { visibility, afterMS: 10_000, then: "drop" } })
  })

  it("rejects hidden without a visibility", () => {
    // @ts-expect-error Property 'visibility' is missing
    Netcode.rollback(runtime, { ...options, simulate, hidden: { afterMS: 10_000, then: "stall" } })
  })

  it("reports each seat's page in status", () => {
    const session = Netcode.rollback(runtime, { ...options, simulate })
    if (!session.ok) return
    expect(session.value.status().hidden).type.toBe<ReadonlyArray<boolean>>()
  })
})

describe("Visibility", () => {
  it("is two methods any platform implements, and the browser's document is one", () => {
    expect<Visibility.Visibility>().type.toBe<{
      readonly hidden: () => boolean
      readonly subscribe: (listener: (hidden: boolean) => void) => () => void
    }>()
    expect(BrowserVisibility.make(document)).type.toBeAssignableTo<Visibility.Visibility>()
    expect(MemoryVisibility.make()).type.toBe<MemoryVisibility.MemoryVisibility>()
    expect(MemoryVisibility.make()).type.toBeAssignableTo<Visibility.Visibility>()
  })
})
