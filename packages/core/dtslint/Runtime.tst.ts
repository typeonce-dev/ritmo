import { Decode, Descriptor, Entity, Result, Schema, Snapshot } from "@typeonce/ritmo"
import * as Size2 from "@typeonce/ritmo-math/Size2"
import * as Vector2 from "@typeonce/ritmo-math/Vector2"
import * as Runtime from "@typeonce/ritmo/Runtime"
import * as Schedule from "@typeonce/ritmo/Schedule"
import * as System from "@typeonce/ritmo/System"
import { describe, expect, it } from "tstyche"

const Time = Descriptor.Resource<number>()("Time")
const Counter = Descriptor.Resource<number>()("Counter")
const Phase = Descriptor.Resource<"Running" | "Paused">()("Phase")
const Viewport = Descriptor.ConstructedResource(Size2)("Viewport")
const Camera = Descriptor.ConstructedResource(Vector2)("Camera")
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
    }).success

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

    if (runtime._tag === "Success") {
      runtime.success.tick(resourceSchedule)
      runtime.success.tick(stateSchedule)
    }
  })

  it("make rejects Result-wrapped values for constructed resources", () => {
    Runtime.make({
      schema,
      services: Runtime.services(),
      resources: {
        DeltaTime: 1 / 60,
        Counter: 0,
        // @ts-expect-error Type 'Success<{ width: number; height: number; }>' is missing the following properties from type 'Raw'
        Viewport: Result.succeed({ width: 320, height: 180 })
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
    expect(plain._tag).type.toBe<"Success">()
    expect(plain.success.tick).type.not.toBe<never>()
    const maybe: { readonly Viewport?: { readonly width: number; readonly height: number } } = {}
    const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: maybe })
    expect(made._tag).type.toBe<"Success" | "Failure">()
    // @ts-expect-error Property 'success' does not exist on type
    made.success
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
    }).success
    Game.Runtime.make({
      services: Game.Runtime.services(),
      resources: {
        Counter: 0,
        // @ts-expect-error DeltaTim is not a resource key of this schema
        DeltaTim: 1 / 60
      }
    }).success
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
    }).success

    // @ts-expect-error __runtimeRequirementError__: "Missing service"; readonly __requirement__: "Logger"
    runtime.tick(serviceSchedule)
  })

  it("rejects schedules whose required resource initialization is missing from the runtime", () => {
    const runtime = Runtime.make({
      schema,
      services: Runtime.services()
    }).success

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
    }).success

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
    }).success

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
    }).success

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
    }).success

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
    }).success
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
  const Place = Descriptor.ConstructedComponent(Vector2)("SnapshotTypes/Place")
  const Sprite = Descriptor.TransientComponent<{ readonly frame: number }>()("SnapshotTypes/Sprite")
  const Frame = Descriptor.TransientResource<number>()("SnapshotTypes/Frame")
  const Score = Descriptor.Resource<number>()("SnapshotTypes/Score")

  it("exposes snapshot and restore only when every value can be validated on load", () => {
    const Valid = Schema.bind(Schema.fragment({ components: { Place, Sprite }, resources: { Frame } }), Root)
    const valid = Valid.Runtime.make({ services: Valid.Runtime.services(), resources: { Frame: 0 } }).success
    expect(valid.snapshot()).type.toBe<import("@typeonce/ritmo/Snapshot").WorldSnapshot>()
    expect(valid.restore(null)).type.toBe<Result.Result<void, import("@typeonce/ritmo/Snapshot").RestoreError>>()

    const Invalid = Schema.bind(Schema.fragment({ components: { Place, Label }, resources: { Score } }), Root)
    const invalid = Invalid.Runtime.make({ services: Invalid.Runtime.services(), resources: { Score: 0 } }).success
    expect(invalid.snapshot).type.toBe<{
      readonly "SnapshotTypes/Label needs a validator": "Use a Constructed* descriptor whose constructor accepts unknown input (validated on load) or a Transient* one (not saved)"
      readonly "SnapshotTypes/Score needs a validator": "Use a Constructed* descriptor whose constructor accepts unknown input (validated on load) or a Transient* one (not saved)"
    }>()
    // @ts-expect-error Type '{ readonly "SnapshotTypes/Label needs a validator": "Use a Constructed* descriptor whose constructor
    invalid.snapshot()
    // @ts-expect-error Type '{ readonly "SnapshotTypes/Label needs a validator": "Use a Constructed* descriptor whose constructor
    invalid.restore(null)
  })

  it("requires constructors that accept untrusted input", () => {
    const typedOnly = { result: (raw: { readonly n: number }) => Result.succeed(raw.n) }
    const Typed = Descriptor.ConstructedComponent(typedOnly)("SnapshotTypes/Typed")
    const Unknown = Descriptor.ConstructedComponent({
      result: (raw: unknown) => typeof raw === "number" ? Result.succeed(raw) : Result.fail("NaN" as const)
    })("SnapshotTypes/Unknown")
    const Decoded = Descriptor.ConstructedComponent({ ...typedOnly, decode: (raw: unknown) => Result.fail(raw) })("SnapshotTypes/Decoded")

    const Loadable = Schema.bind(Schema.fragment({ components: { Unknown, Decoded, Place } }), Root)
    const loadable = Loadable.Runtime.make({ services: Loadable.Runtime.services() }).success
    expect(loadable.snapshot()).type.toBe<import("@typeonce/ritmo/Snapshot").WorldSnapshot>()

    const Unloadable = Schema.bind(Schema.fragment({ components: { Typed } }), Root)
    const unloadable = Unloadable.Runtime.make({ services: Unloadable.Runtime.services() }).success
    // @ts-expect-error Type '{ readonly "SnapshotTypes/Typed needs a validator": "Use a Constructed* descriptor whose constructor
    unloadable.snapshot()
  })

  it("infers constructed values from Standard Schema validators and stored handles", () => {
    const Positive = Descriptor.ConstructedComponent(Descriptor.fromStandardSchema({
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value: unknown) => typeof value === "number" ? { value } : { issues: [{ message: "NaN" }] }
      }
    }))("SnapshotTypes/Positive")
    expect<Descriptor.Descriptor.Value<typeof Positive>>().type.toBe<number>()

    const decoded = Entity.decodeHandle(Root, null, Label)
    expect(decoded).type.toBe<Result.Result<Entity.Handle<typeof Root, typeof Label>, Entity.InvalidHandle>>()
  })
})

describe("Decode", () => {
  it("infers descriptor values from codecs", () => {
    const Stats = Descriptor.ConstructedComponent(Decode.struct({ level: Decode.integer, tags: Decode.array(Decode.string) }))("DecodeTypes/Stats")
    expect<Descriptor.Descriptor.Value<typeof Stats>>().type.toBe<{ readonly level: number; readonly tags: ReadonlyArray<string> }>()
    const Team = Descriptor.ConstructedComponent(Decode.literal("red", "blue"))("DecodeTypes/Team")
    expect<Descriptor.Descriptor.Value<typeof Team>>().type.toBe<"red" | "blue">()
    const Player = Descriptor.Tag("DecodeTypes/Player")
    expect<Descriptor.Descriptor.Value<typeof Player>>().type.toBe<{}>()

    const Root = Schema.defineRoot("DecodeTypes")
    const Game = Schema.bind(Schema.fragment({ components: { Stats, Team, Player } }), Root)
    const runtime = Game.Runtime.make({ services: Game.Runtime.services() }).success
    expect(runtime.snapshot()).type.toBe<import("@typeonce/ritmo/Snapshot").WorldSnapshot>()
  })
})

describe("Runtime.services and Runtime.machines", () => {
  const Flow = Game.StateMachine("RuntimeTypes/Flow", ["Menu", "Playing"] as const)
  const silent = { log: (_: string) => {} }

  it("collects one provision per service and machine", () => {
    expect(Runtime.services(Runtime.service(Logger, silent), Runtime.service(PrefixedLogger, silent))).type.toBe<
      Runtime.RuntimeServices<{ readonly Logger: { readonly log: (message: string) => void }; readonly "RuntimeTypes/Logger": { readonly log: (message: string) => void } }>
    >()
    expect(Runtime.machines(Runtime.machine(Flow, "Menu"))).type.toBe<Runtime.RuntimeMachines<{ readonly "RuntimeTypes/Flow": "Menu" | "Playing" }>>()
  })

  it("rejects a service or machine provided twice", () => {
    // @ts-expect-error Logger is provided twice: keep one Game.Runtime.service(...) for it
    Runtime.services(Runtime.service(Logger, silent), Runtime.service(Logger, silent))
    // @ts-expect-error RuntimeTypes/Flow is provided twice: keep one Game.Runtime.machine(...) for it
    Runtime.machines(Runtime.machine(Flow, "Menu"), Runtime.machine(Flow, "Playing"))
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
