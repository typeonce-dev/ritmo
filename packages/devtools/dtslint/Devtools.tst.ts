import { Clock, Decode, Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import { Invariant, Lint, Replay, Session } from "@typeonce/ritmo-devtools"
import { describe, expect, it } from "tstyche"

const hostClock = HostClock.test()

const Position = Descriptor.Component<{ readonly x: number }>()("DevtoolsTypes/Position")
const Other = Descriptor.Component<{ readonly y: number }>()("DevtoolsTypes/Other")
const Limit = Descriptor.Resource<number>()("DevtoolsTypes/Limit")
const Request = Descriptor.Event<string>()("DevtoolsTypes/Request")
const Foreign = Descriptor.Event<string>()("DevtoolsTypes/ForeignRequest")
const Game = Schema.bind(Schema.fragment({ components: { Position }, resources: { Limit }, events: { Request } }))
const OtherGame = Schema.bind(Schema.fragment({ components: { Other } }))
const update = Game.Schedule(Game.System("DevtoolsTypes/Noop", {}, () => {}))

describe("Session.make", () => {
  it("requires a runtime made with debug: { hostClock }", () => {
    const plain = Game.Runtime.make({ services: Game.Runtime.services() }).success
    expect(Session.make).type.not.toBeCallableWith(plain, { hostClock, schedules: { update } })
    const debugged = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock } }).success
    expect(Session.make).type.toBeCallableWith(debugged, { hostClock, schedules: { update } })
  })

  it("requires the host clock that times runs", () => {
    const debugged = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock } }).success
    // @ts-expect-error Property 'hostClock' is missing
    Session.make(debugged, { schedules: { update } })
  })

  it("rejects schedules of another schema", () => {
    const debugged = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock } }).success
    const foreign = OtherGame.Schedule(OtherGame.System("DevtoolsTypes/Foreign", {}, () => {}))
    expect(Session.make).type.not.toBeCallableWith(debugged, { hostClock, schedules: { foreign } })
  })

  it("describes but does not run describe-only schedules", () => {
    const render = Game.Schedule(Game.System("DevtoolsTypes/Render", {}, () => {}))
    const session = Session.make(Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock } }).success, { hostClock, schedules: { update }, describe: { render } })
    expect(session.run).type.toBeCallableWith("update")
    expect(session.run).type.not.toBeCallableWith("render")
    const foreign = OtherGame.Schedule(OtherGame.System("DevtoolsTypes/ForeignRender", {}, () => {}))
    expect(Session.make).type.not.toBeCallableWith(Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock } }).success, { hostClock, schedules: { update }, describe: { foreign } })
  })

  it("runs only named schedules and filters by the runtime's descriptors", () => {
    const session = Session.make(Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock } }).success, { hostClock, schedules: { update } })
    expect(session.run).type.toBeCallableWith("update")
    expect(session.run).type.not.toBeCallableWith("updat")
    expect(session.journal).type.toBeCallableWith({ component: Position })
    expect(session.journal).type.not.toBeCallableWith({ component: Other })
    expect(session.why).type.not.toBeCallableWith(1, Other)
  })
})

describe("Invariant.fromInspector", () => {
  const Positions = Game.Query({ selection: { position: Game.Query.read(Position) } })

  it("builds an invariant named after an inspector that returns a message or undefined", () => {
    const inspector = Game.Inspector("DevtoolsTypes/NonNegative", { queries: { positions: Positions } }, ({ queries }) =>
      queries.positions.each().some((match) => match.data.position.get().x < 0) ? "negative x" : undefined)
    const invariant = Invariant.fromInspector(inspector)
    expect(invariant).type.toBe<Invariant.Invariant<typeof inspector>>()
    expect(invariant.name).type.toBe<"DevtoolsTypes/NonNegative">()
  })

  it("rejects inspectors that do not return string | undefined", () => {
    const counts = Game.Inspector("DevtoolsTypes/Count", { queries: { positions: Positions } }, ({ queries }) => queries.positions.each().length)
    expect(Invariant.fromInspector).type.not.toBeCallableWith(counts)
    const message = Game.Inspector("DevtoolsTypes/Message", {}, () => "always" as string | undefined)
    expect(Invariant.fromInspector).type.toBeCallableWith(message)
  })

  it("is checked against the runtime's provisions by Session.make", () => {
    const UnderLimit = Invariant.fromInspector(Game.Inspector("DevtoolsTypes/UnderLimit", {
      queries: { positions: Positions },
      resources: { limit: Game.System.readResource(Limit) }
    }, ({ queries, resources }) =>
      queries.positions.each().some((match) => match.data.position.get().x > resources.limit.get()) ? "over limit" : undefined))

    const provided = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Limit: 10 }, debug: { hostClock } }).success
    Session.make(provided, { hostClock, schedules: { update }, invariants: [UnderLimit] })

    const missing = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock } }).success
    // @ts-expect-error __fixInvariantRequirements__: { readonly __runtimeRequirementError__: "Missing resource"; readonly __requirement__: "DevtoolsTypes/Limit"
    Session.make(missing, { hostClock, schedules: { update }, invariants: [UnderLimit] })
  })

  it("rejects invariants of another game", () => {
    const Foreign = Invariant.fromInspector(OtherGame.Inspector("DevtoolsTypes/Foreign", {}, () => undefined))
    const debugged = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock } }).success
    expect(Session.make).type.not.toBeCallableWith(debugged, { hostClock, schedules: { update }, invariants: [Foreign] })
    expect(Session.make).type.toBeCallableWith(debugged, { hostClock, schedules: { update }, invariants: [Invariant.fromInspector(Game.Inspector("DevtoolsTypes/Own", {}, () => undefined))] })
  })
})

describe("Lint.run", () => {
  it("returns a report and takes host events of the runtime's schema only", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Limit: 1 }, debug: { hostClock } }).success
    expect(Lint.run({ runtime, schedules: { update }, hostEvents: [Request] }).data).type.toBe<Lint.Report>()
    expect(Lint.run).type.not.toBeCallableWith({ runtime, schedules: { update }, hostEvents: [Foreign] })
    expect(runtime.debug.declareHostEvents).type.not.toBeCallableWith([Foreign])
    expect(runtime.debug.declareHostEvents).type.toBeCallableWith([Request])
  })

  it("requires a runtime made with debug: { hostClock }", () => {
    const plain = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Limit: 1 } }).success
    expect(Lint.run).type.not.toBeCallableWith({ runtime: plain, schedules: { update } })
  })
})

describe("Replay.recorder", () => {
  const Place = Descriptor.ConstructedComponent(Decode.struct({ x: Decode.number }))("DevtoolsTypes/Place")
  const Keys = Descriptor.Service<Replay.Source<{ readonly left: boolean }>>()("DevtoolsTypes/Keys")
  const Rules = Descriptor.Service<{ readonly speed: number; readonly names: ReadonlyArray<string> }>()("DevtoolsTypes/Rules")
  const Page = Descriptor.Service<{ readonly toast: (message: string) => void }>()("DevtoolsTypes/Page")
  const Mapped = Descriptor.Service<Replay.Source<Map<string, number>>>()("DevtoolsTypes/Mapped")
  const Saved = Schema.bind(Schema.fragment({ components: { Place } }))
  const runtime = Saved.Runtime.make({
    services: Saved.Runtime.services(
      Saved.Runtime.service(Keys, { snapshot: () => ({ left: false }) }),
      Saved.Runtime.service(Rules, { speed: 1, names: [] }),
      Saved.Runtime.service(Page, { toast: () => {} }),
      Saved.Runtime.service(Mapped, { snapshot: () => new Map() })
    ),
    debug: { hostClock }
  }).success
  const base = { name: "update", keep: 10, step: Clock.hz(1), sink: Replay.memorySink(), hostClock }

  it("accepts plain-data sources and plain constants", () => {
    const update = Saved.Schedule(Saved.System("DevtoolsTypes/Plain", {
      services: { keys: Saved.System.service(Keys), rules: Saved.System.service(Rules) }
    }, () => {}))
    expect(Replay.recorder(runtime, { ...base, schedule: update })).type.toBe<Replay.Recorder>()
  })

  it("rejects a service that is neither a plain source nor plain data, naming it", () => {
    const update = Saved.Schedule(Saved.System("DevtoolsTypes/Page", { services: { page: Saved.System.service(Page) } }, () => {}))
    // @ts-expect-error DevtoolsTypes/Page is neither a snapshot() source of plain data nor plain data
    Replay.recorder(runtime, { ...base, schedule: update })
  })

  it("rejects a source whose snapshot is not plain data", () => {
    const update = Saved.Schedule(Saved.System("DevtoolsTypes/Mapped", { services: { mapped: Saved.System.service(Mapped) } }, () => {}))
    // @ts-expect-error DevtoolsTypes/Mapped: its snapshot() returns data that is not plain
    Replay.recorder(runtime, { ...base, schedule: update })
  })

  it("requires a runtime whose world can be saved", () => {
    const Loose = Descriptor.Component<{ readonly x: number }>()("DevtoolsTypes/Loose")
    const Unsaved = Schema.bind(Schema.fragment({ components: { Loose } }))
    const unsaved = Unsaved.Runtime.make({ services: Unsaved.Runtime.services(), debug: { hostClock } }).success
    const update = Unsaved.Schedule(Unsaved.System("DevtoolsTypes/Unsaved", {}, () => {}))
    expect(Replay.recorder).type.not.toBeCallableWith(unsaved, { ...base, schedule: update })
  })

  it("tells plain data from the rest", () => {
    expect<Replay.IsPlain<{ readonly a: ReadonlyArray<{ readonly b: string | null }> }>>().type.toBe<true>()
    expect<Replay.IsPlain<{ readonly f: () => void }>>().type.toBe<false>()
    expect<Replay.IsPlain<Map<string, number>>>().type.toBe<false>()
    expect<Replay.IsPlain<Set<number>>>().type.toBe<false>()
    interface Upgrade { readonly cost: number; readonly next: Upgrade | null }
    expect<Replay.IsPlain<{ readonly upgrade: Upgrade }>>().type.toBe<true>()
    interface Broken { readonly next: Broken | null; readonly run: () => void }
    expect<Replay.IsPlain<Broken>>().type.toBe<false>()
  })
})

describe("Session stops", () => {
  it("include a failed tick result nobody read", () => {
    expect<Extract<Session.Stop, { readonly reason: "ignored-failure" }>["skipped"]>().type.toBe<ReadonlyArray<string>>()
  })
})
