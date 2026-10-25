import { Debug, Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"
import type * as Runtime from "@typeonce/ritmo/Runtime"
import type * as System from "@typeonce/ritmo/System"
import { describe, expect, it } from "tstyche"
import * as Codecs from "../test/codecs.ts"

const Position = Descriptor.Component<{ readonly x: number }>()("DebugTypes/Position")
const Other = Descriptor.Component<{ readonly y: number }>()("DebugTypes/Other")
const Score = Descriptor.Resource<number>()("DebugTypes/Score")
const Game = Schema.bind(Schema.fragment({ components: { Position }, resources: { Score } }))
const OtherGame = Schema.bind(Schema.fragment({ components: { Other } }))

describe("Runtime debug option", () => {
  it("adds the debug handle only when enabled", () => {
    const plain = Game.Runtime.make({ services: Game.Runtime.services() }).value
    expect(plain).type.not.toHaveProperty("debug")

    const debugged = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.standard } }).value
    expect(debugged).type.toHaveProperty("debug")
    expect(debugged.debug.describe()).type.toBe<Debug.Description>()
  })

  it("keeps the handle inside the Result of fallible runtimes", () => {
    const Viewport = Descriptor.ConstructedResource(Codecs.number)("DebugTypes/Viewport")
    const Fallible = Schema.bind(Schema.fragment({ resources: { Viewport } }))
    const made = Fallible.Runtime.make({ services: Fallible.Runtime.services(), resources: { Viewport: 1 }, debug: { hostClock: HostClock.standard } })
    if (made.ok) {
      expect(made.value.debug.frame()).type.toBe<number>()
    }
  })

  it("types the handle as optional when the option may be undefined (a dev build)", () => {
    const dev: boolean = Math.random() > 2
    const maybe = Game.Runtime.make({ services: Game.Runtime.services(), debug: dev ? { hostClock: HostClock.standard } : undefined }).value
    expect(maybe.debug).type.toBe<Debug.Handle<typeof Game.schema, typeof Game.schema> | undefined>()
    // @ts-expect-error 'maybe.debug' is possibly 'undefined'.
    maybe.debug.describe()
    const off = Game.Runtime.make({ services: Game.Runtime.services(), debug: undefined }).value
    expect(off).type.not.toHaveProperty("debug")
  })

  it("rejects the removed boolean form and a debug option without a host clock", () => {
    // @ts-expect-error Type 'boolean' is not assignable to type 'Option'.
    Game.Runtime.make({ services: Game.Runtime.services(), debug: true }).value
    // @ts-expect-error Property 'hostClock' is missing
    Game.Runtime.make({ services: Game.Runtime.services(), debug: {} }).value
  })

  it("filters dumps by the runtime's own components", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.standard } }).value
    expect(runtime.debug.dump).type.toBeCallableWith({ with: [Position] })
    expect(runtime.debug.dump).type.not.toBeCallableWith({ with: [Other] })
    expect(OtherGame.schema.components.Other).type.toBe<typeof Other>()
  })

  it("names only schedules of the runtime's schema", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.standard } }).value
    const own = Game.Schedule(Game.System("DebugTypes/Own", {}, () => {}))
    const foreign = OtherGame.Schedule(OtherGame.System("DebugTypes/Foreign", {}, () => {}))
    expect(runtime.debug.nameSchedules).type.toBeCallableWith({ own })
    expect(runtime.debug.nameSchedules).type.not.toBeCallableWith({ foreign })
  })
})

describe("Debug descriptions", () => {
  it("describe each system's declared command permissions by kind", () => {
    expect<Debug.SystemDescription["commands"]>().type.toBe<Debug.CommandPermissions>()
    expect<Debug.CommandPermissions["spawns"]>().type.toBe<ReadonlyArray<string>>()
    expect<Extract<Debug.Lint["code"], "command-permission-unused">>().type.toBe<"command-permission-unused">()
  })
})

describe("Ignored tick failures", () => {
  it("are trace and host events, and a session end checks them", () => {
    expect<Extract<Debug.TraceEvent, { readonly type: "failure.ignored" }>>().type.toBe<Debug.FailureIgnoredEvent>()
    expect<Extract<Debug.HostEvent, { readonly type: "failure.ignored" }>>().type.toBe<Debug.FailureIgnoredEvent>()
    expect<Debug.FailureIgnoredEvent["when"]>().type.toBe<"next-tick" | "session-end">()
    expect<Debug.Handle["checkIgnoredFailures"]>().type.toBe<() => void>()
  })
})

describe("Debug.serviceLints", () => {
  it("types the findings a service reports", () => {
    const Reporting = Descriptor.Service<Debug.ReportsLints>()("DebugTypes/Reporting")
    expect(Game.Runtime.service).type.toBeCallableWith(Reporting, { [Debug.serviceLints]: () => [{ severity: "info", message: "m", fix: "f" }] })
    expect(Game.Runtime.service).type.not.toBeCallableWith(Reporting, { [Debug.serviceLints]: () => [{ severity: "error", message: "m", fix: "f" }] })
  })
})


describe("debug.beginFrame", () => {
  it("returns a cursor typed with the schedule's failures, or why the frame did not begin", () => {
    const debugged = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.standard } }).value
    const Fail = Game.System("DebugTypes/Fail", {}, () => Result.failure("Broken" as const))
    const begun = debugged.debug.beginFrame(Game.Schedule(Fail))
    expect(begun).type.toBe<Result.Result<Debug.FrameCursor<System.SystemFailure<"DebugTypes/Fail", "Broken">>, Runtime.MissingRuntimeRequirements | Runtime.TickOrderViolation>>()
    if (begun.ok) {
      expect(begun.value.next()).type.toBe<Result.Result<Debug.StepOutcome, System.SystemFailure<"DebugTypes/Fail", "Broken">>>()
      expect(begun.value.remaining()).type.toBe<ReadonlyArray<Debug.StepDescription>>()
    }
  })

  it("rejects a schedule of another schema", () => {
    const debugged = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.standard } }).value
    const foreign = OtherGame.Schedule(OtherGame.System("DebugTypes/ForeignStep", {}, () => {}))
    expect(debugged.debug.beginFrame).type.not.toBeCallableWith(foreign)
    expect(debugged.debug.beginFrame).type.toBeCallableWith(Game.Schedule(Game.System("DebugTypes/OwnStep", {}, () => {})))
  })
})
