import { Debug, Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ readonly x: number }>()("DebugTypes/Position")
const Other = Descriptor.Component<{ readonly y: number }>()("DebugTypes/Other")
const Score = Descriptor.Resource<number>()("DebugTypes/Score")
const Game = Schema.bind(Schema.fragment({ components: { Position }, resources: { Score } }))
const OtherGame = Schema.bind(Schema.fragment({ components: { Other } }))

describe("Runtime debug option", () => {
  it("adds the debug handle only when enabled", () => {
    const plain = Game.Runtime.make({ services: Game.Runtime.services() }).success
    expect(plain).type.not.toHaveProperty("debug")

    const debugged = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.standard } }).success
    expect(debugged).type.toHaveProperty("debug")
    expect(debugged.debug.describe()).type.toBe<Debug.Description>()
  })

  it("keeps the handle inside the Result of fallible runtimes", () => {
    const Viewport = Descriptor.ConstructedResource({ result: (raw: number) => ({ _tag: "Success", success: raw }) })("DebugTypes/Viewport")
    const Fallible = Schema.bind(Schema.fragment({ resources: { Viewport } }))
    const made = Fallible.Runtime.make({ services: Fallible.Runtime.services(), resources: { Viewport: 1 }, debug: { hostClock: HostClock.standard } })
    if (made._tag === "Success") {
      expect(made.success.debug.frame()).type.toBe<number>()
    }
  })

  it("types the handle as optional when the option may be undefined (a dev build)", () => {
    const dev: boolean = Math.random() > 2
    const maybe = Game.Runtime.make({ services: Game.Runtime.services(), debug: dev ? { hostClock: HostClock.standard } : undefined }).success
    expect(maybe.debug).type.toBe<Debug.Handle<typeof Game.schema, typeof Game.schema> | undefined>()
    // @ts-expect-error 'maybe.debug' is possibly 'undefined'.
    maybe.debug.describe()
    const off = Game.Runtime.make({ services: Game.Runtime.services(), debug: undefined }).success
    expect(off).type.not.toHaveProperty("debug")
  })

  it("rejects the removed boolean form and a debug option without a host clock", () => {
    // @ts-expect-error Type 'boolean' is not assignable to type 'Option'.
    Game.Runtime.make({ services: Game.Runtime.services(), debug: true }).success
    // @ts-expect-error Property 'hostClock' is missing
    Game.Runtime.make({ services: Game.Runtime.services(), debug: {} }).success
  })

  it("filters dumps by the runtime's own components", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.standard } }).success
    expect(runtime.debug.dump).type.toBeCallableWith({ with: [Position] })
    expect(runtime.debug.dump).type.not.toBeCallableWith({ with: [Other] })
    expect(OtherGame.schema.components.Other).type.toBe<typeof Other>()
  })

  it("names only schedules of the runtime's schema", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.standard } }).success
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
