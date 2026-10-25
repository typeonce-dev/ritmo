import { Descriptor, Entity, Result, Schema, Snapshot } from "@typeonce/ritmo"
import * as Codecs from "../test/codecs.ts"
import * as Runtime from "@typeonce/ritmo/Runtime"
import * as Schedule from "@typeonce/ritmo/Schedule"
import * as System from "@typeonce/ritmo/System"
import { describe, expect, it } from "tstyche"

const Time = Descriptor.Resource<number>()("Time")
const Counter = Descriptor.Resource<number>()("Counter")
const Phase = Descriptor.Resource<"Running" | "Paused">()("Phase")
const Viewport = Descriptor.ConstructedResource(Codecs.safeSize)("Viewport")
const Camera = Descriptor.ConstructedResource(Codecs.safeVector)("Camera")
const Logger = Descriptor.Service<{ readonly log: (message: string) => void }>()("Logger")
const PrefixedLogger = Descriptor.Service<{ readonly log: (message: string) => void }>()("RuntimeTypes/Logger")

const Game = Schema.bind(Schema.fragment({
  resources: {
    DeltaTime: Time,
    Counter,
    Viewport,
    CurrentPhase: Phase,
    Camera
  }
}))
const schema = Game.schema

const ResourceSystem = System.System(
  "RuntimeTypes/Resource",
  {
    schema,
    resources: {
      time: System.readResource(Time)
    }
  },
  ({ resources }) =>
    { resources.time.get() }
)

const StateSystem = System.System(
  "RuntimeTypes/State",
  {
    schema,
    resources: {
      phase: System.readResource(Phase)
    }
  },
  ({ resources }) =>
    { resources.phase.get() }
)

const ServiceSystem = System.System(
  "RuntimeTypes/Service",
  {
    schema,
    services: {
      logger: System.service(Logger)
    }
  },
  ({ services }) =>
    {
      services.logger.log("ok")
    }
)

const PrefixedServiceSystem = System.System(
  "RuntimeTypes/PrefixedService",
  {
    schema,
    services: {
      logger: System.service(PrefixedLogger)
    }
  },
  ({ services }) =>
    {
      services.logger.log("ok")
    }
)

const resourceSchedule = Schedule.Schedule(ResourceSystem)

const stateSchedule = Schedule.Schedule(StateSystem)

const serviceSchedule = Schedule.Schedule(ServiceSystem)

const prefixedServiceSchedule = Schedule.Schedule(PrefixedServiceSystem)

describe("Runtime", () => {
  it("accepts initialization keyed by schema property names", () => {
    const runtime = Runtime.make({
      schema,
      services: Runtime.services(),
      resources: {
        DeltaTime: 1 / 60,
        Counter: 0,
        CurrentPhase: "Running"
      }
    }).value

    expect(runtime).type.toBeAssignableTo<Runtime.Runtime<
      typeof schema,
      {},
      {
        readonly DeltaTime: number
        readonly Counter: number
        readonly CurrentPhase: "Running" | "Paused"
      }
    >>()
  })

  it("make accepts raw values for constructed resources and returns a Result", () => {
    const runtime = Runtime.make({
      schema,
      services: Runtime.services(),
      resources: {
        DeltaTime: 1 / 60,
        Counter: 0,
        Viewport: {
          width: 320,
          height: 180
        },
        CurrentPhase: "Running",
        Camera: {
          x: 10,
          y: 20
        }
      }
    })

    if (runtime.ok) {
      runtime.value.tick(resourceSchedule)
      runtime.value.tick(stateSchedule)
    }
  })

  it("make rejects Result-wrapped values for constructed resources", () => {
    Runtime.make({
      schema,
      services: Runtime.services(),
      resources: {
        DeltaTime: 1 / 60,
        Counter: 0,
        // @ts-expect-error Type 'Success<{ width: number; height: number; }>' is missing the following properties from type '{ readonly width: number; readonly height: number; }': width, height
        Viewport: Result.success({ width: 320, height: 180 })
      }
    })
  })

  it("rejects descriptor-name keys that are not schema keys", () => {
    Runtime.make({
      schema,
      services: Runtime.services(),
      resources: {
        // @ts-expect-error Object literal may only specify known properties, and 'Time' does not exist in type 'Partial<{ readonly
        Time: 1 / 60
      }
    })
  })

  it("returns a Success when nothing provided can fail, and a Result to check otherwise", () => {
    const plain = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Counter: 0 } })
    expect(plain.ok).type.toBe<true>()
    expect(plain.value.tick).type.not.toBe<never>()
    const maybe: { readonly Viewport?: { readonly width: number; readonly height: number } } = {}
    const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: maybe })
    expect(made.ok).type.toBe<boolean>()
    // @ts-expect-error Property 'value' does not exist on type
    made.value
  })

  it("rejects an unknown resource key next to known ones, naming it", () => {
    Runtime.make({
      schema,
      services: Runtime.services(),
      resources: {
        DeltaTime: 1 / 60,
        // @ts-expect-error Countr is not a resource key of this schema
        Countr: 0
      }
    }).value
    Game.Runtime.make({
      services: Game.Runtime.services(),
      resources: {
        Counter: 0,
        // @ts-expect-error DeltaTim is not a resource key of this schema
        DeltaTim: 1 / 60
      }
    }).value
    // A value typed as the resources record is accepted as it is.
    const resources: Runtime.RuntimeResources<typeof schema> = { DeltaTime: 1 / 60 }
    expect(Game.Runtime.make({ services: Game.Runtime.services(), resources })).type.not.toRaiseError()
  })

  it("rejects descriptor-name state keys that are not schema keys", () => {
    Runtime.make({
      schema,
      services: Runtime.services(),
      resources: {
        // @ts-expect-error Object literal may only specify known properties, and 'Phase' does not exist in type 'Partial<{ readonly
        Phase: "Running"
      }
    })
  })

  it("rejects schedules whose required service is missing from the runtime", () => {
    const runtime = Runtime.make({
      schema,
      services: Runtime.services(),
      resources: {
        DeltaTime: 1 / 60,
        Counter: 0,
        CurrentPhase: "Running"
      }
    }).value

    // @ts-expect-error __runtimeRequirementError__: "Missing service"; readonly __requirement__: "Logger"
    runtime.tick(serviceSchedule)
  })

  it("rejects schedules whose required resource initialization is missing from the runtime", () => {
    const runtime = Runtime.make({
      schema,
      services: Runtime.services()
    }).value

    // @ts-expect-error __runtimeRequirementError__: "Missing resource"; readonly __requirement__: "Time"
    runtime.tick(resourceSchedule)
  })

  it("rejects schedules whose required state initialization is missing from the runtime", () => {
    const runtime = Runtime.make({
      schema,
      services: Runtime.services(),
      resources: {
        DeltaTime: 1 / 60,
        Counter: 0
      }
    }).value

    // @ts-expect-error __runtimeRequirementError__: "Missing resource"; readonly __requirement__: "Phase"
    runtime.tick(stateSchedule)
  })

  it("propagates runtime requirement checks through app.update", () => {
    const runtime = Runtime.make({
      schema,
      services: Runtime.services(),
      resources: {
        DeltaTime: 1 / 60,
        Counter: 0,
        CurrentPhase: "Running"
      }
    }).value

    // @ts-expect-error __runtimeRequirementError__: "Missing service"; readonly __requirement__: "Logger"
    runtime.tick(serviceSchedule)
  })

  it("accepts schedules whose requirements are fully satisfied", () => {
    const runtime = Runtime.make({
      schema,
      services: Runtime.services(
        Runtime.service(Logger, {
          log(message) {
            expect(message).type.toBe<string>()
          }
        })
      ),
      resources: {
        DeltaTime: 1 / 60,
        Counter: 0,
        CurrentPhase: "Running"
      }
    }).value

    runtime.tick(resourceSchedule, stateSchedule, serviceSchedule)
  })

  it("accepts descriptor-based provisioning for prefixed service names", () => {
    const runtime = Runtime.make({
      schema,
      services: Runtime.services(
        Runtime.service(PrefixedLogger, {
          log(message) {
            expect(message).type.toBe<string>()
          }
        })
      ),
      resources: {
        DeltaTime: 1 / 60,
        Counter: 0,
        CurrentPhase: "Running"
      }
    }).value

    runtime.tick(prefixedServiceSchedule)
  })

  it("rejects raw service objects so descriptor names cannot drift", () => {
    Runtime.make({
      schema,
      // @ts-expect-error Property '[runtimeServicesTypeId]' is missing in type '{ Logger: { log(_message: string): void; }; }' but
      services: {
        Logger: {
          log(_message: string) {}
        }
      }
    }).value
  })

  it("rejects non-service descriptors in Runtime.services", () => {
    Runtime.service(
      // @ts-expect-error Type '"resource"' is not assignable to type '"service"'.
      Time,
      1 / 60
    )
  })

  it("rejects the old tuple entry syntax", () => {
    Runtime.services(
      // @ts-expect-error Type '(Descriptor<"service", "Logger", { readonly log: (message: string) => void; }> | { log(_message
      [Logger, {
        log(_message: string) {}
      }]
    )
  })
})

describe("Runtime snapshots", () => {
  const Root = Schema.defineRoot("SnapshotTypes")
  const Label = Descriptor.Component<string>()("SnapshotTypes/Label")
  const Place = Descriptor.ConstructedComponent(Codecs.safeVector)("SnapshotTypes/Place")
  const Sprite = Descriptor.TransientComponent<{ readonly frame: number }>()("SnapshotTypes/Sprite")
  const Frame = Descriptor.TransientResource<number>()("SnapshotTypes/Frame")
  const Score = Descriptor.Resource<number>()("SnapshotTypes/Score")

  it("exposes snapshot, checksum, and restore only when every value can be validated on load", () => {
    const Valid = Schema.bind(Schema.fragment({ components: { Place, Sprite }, resources: { Frame } }), Root)
    const valid = Valid.Runtime.make({ services: Valid.Runtime.services(), resources: { Frame: 0 } }).value
    expect(valid.snapshot()).type.toBe<Result.Result<import("@typeonce/ritmo/Snapshot").WorldSnapshot, import("@typeonce/ritmo/Snapshot").SnapshotError>>()
    expect(valid.restore(null)).type.toBe<Result.Result<void, import("@typeonce/ritmo/Snapshot").RestoreError>>()
    expect(valid.checksum()).type.toBe<Result.Result<string, import("@typeonce/ritmo/Snapshot").SnapshotError>>()

    const Invalid = Schema.bind(Schema.fragment({ components: { Place, Label }, resources: { Score } }), Root)
    const invalid = Invalid.Runtime.make({ services: Invalid.Runtime.services(), resources: { Score: 0 } }).value
    expect(invalid.snapshot).type.toBe<{
      readonly "SnapshotTypes/Label needs a schema": "Use a Constructed* descriptor given a Standard Schema (validated on load) or a Transient* one (not saved)"
      readonly "SnapshotTypes/Score needs a schema": "Use a Constructed* descriptor given a Standard Schema (validated on load) or a Transient* one (not saved)"
    }>()
    // @ts-expect-error Type '{ readonly "SnapshotTypes/Label needs a schema": "Use a Constructed* descriptor given a Standard Schema
    invalid.snapshot()
    // @ts-expect-error Type '{ readonly "SnapshotTypes/Label needs a schema": "Use a Constructed* descriptor given a Standard Schema
    invalid.restore(null)
    // @ts-expect-error Type '{ readonly "SnapshotTypes/Label needs a schema": "Use a Constructed* descriptor given a Standard Schema
    invalid.checksum()
  })

  it("saves components with a schema and guards stored handles", () => {
    const Marker = Descriptor.Tag("SnapshotTypes/Marker")
    const Loadable = Schema.bind(Schema.fragment({ components: { Marker, Place } }), Root)
    const loadable = Loadable.Runtime.make({ services: Loadable.Runtime.services() }).value
    expect(loadable.snapshot()).type.toBe<Result.Result<import("@typeonce/ritmo/Snapshot").WorldSnapshot, import("@typeonce/ritmo/Snapshot").SnapshotError>>()

    const isLabelHandle = Entity.isHandle(Root, Label)
    expect(isLabelHandle).type.toBe<(raw: unknown) => raw is Entity.Handle<typeof Root, typeof Label>>()
  })
})

describe("Codecs", () => {
  it("infers descriptor values from codecs", () => {
    const Stats = Descriptor.ConstructedComponent(Codecs.struct({ level: Codecs.integer, tags: Codecs.array(Codecs.string) }))("DecodeTypes/Stats")
    expect<Descriptor.Descriptor.Value<typeof Stats>>().type.toBe<{ readonly level: number; readonly tags: ReadonlyArray<string> }>()
    const Team = Descriptor.ConstructedComponent(Codecs.literal("red", "blue"))("DecodeTypes/Team")
    expect<Descriptor.Descriptor.Value<typeof Team>>().type.toBe<"red" | "blue">()
    const Player = Descriptor.Tag("DecodeTypes/Player")
    expect<Descriptor.Descriptor.Value<typeof Player>>().type.toBe<{}>()

    const Root = Schema.defineRoot("DecodeTypes")
    const Game = Schema.bind(Schema.fragment({ components: { Stats, Team, Player } }), Root)
    const runtime = Game.Runtime.make({ services: Game.Runtime.services() }).value
    expect(runtime.snapshot()).type.toBe<Result.Result<import("@typeonce/ritmo/Snapshot").WorldSnapshot, import("@typeonce/ritmo/Snapshot").SnapshotError>>()
  })
})

describe("Runtime.services and Runtime.machines", () => {
  const Flow = Game.StateMachine("RuntimeTypes/Flow", { Menu: {}, Playing: {} })
  const silent = { log: (_: string) => {} }

  it("collects one provision per service and machine", () => {
    expect(Runtime.services(Runtime.service(Logger, silent), Runtime.service(PrefixedLogger, silent))).type.toBe<
      Runtime.RuntimeServices<{ readonly Logger: { readonly log: (message: string) => void }; readonly "RuntimeTypes/Logger": { readonly log: (message: string) => void } }>
    >()
    expect(Runtime.machines(Runtime.machine(Flow, { _tag: "Menu" }))).type.toBe<Runtime.RuntimeMachines<{ readonly "RuntimeTypes/Flow": { readonly _tag: "Menu" } | { readonly _tag: "Playing" } }>>()
  })

  it("rejects a service or machine provided twice", () => {
    // @ts-expect-error Logger is provided twice: keep one Game.Runtime.service(...) for it
    Runtime.services(Runtime.service(Logger, silent), Runtime.service(Logger, silent))
    // @ts-expect-error RuntimeTypes/Flow is provided twice: keep one Game.Runtime.machine(...) for it
    Runtime.machines(Runtime.machine(Flow, { _tag: "Menu" }), Runtime.machine(Flow, { _tag: "Playing" }))
  })
})

describe("Snapshot.migrations", () => {
  it("carries the last game version", () => {
    expect(Snapshot.migrations(Snapshot.migration(1, (save) => save), Snapshot.migration(2, (save) => save))).type.toBe<Snapshot.Migrations<2>>()
    expect(Snapshot.migration(1, (save) => save)).type.toBe<Snapshot.Migration<1>>()
  })

  it("rejects steps out of order", () => {
    // @ts-expect-error migration 3 is listed where migration 2 belongs: number migrations 1, 2, 3, ... in order
    Snapshot.migrations(Snapshot.migration(1, (save) => save), Snapshot.migration(3, (save) => save))
    // @ts-expect-error migration 2 is listed where migration 1 belongs
    Snapshot.migrations(Snapshot.migration(2, (save) => save))
  })
})
