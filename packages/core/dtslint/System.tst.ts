import { Descriptor, Result, Schema } from "@typeonce/ritmo"
import * as Codecs from "../test/codecs.ts"
import type { EntityMut } from "@typeonce/ritmo/Entity"
import * as Query from "@typeonce/ritmo/Query"
import * as System from "@typeonce/ritmo/System"
import type { Query as QueryTypes } from "@typeonce/ritmo/Query"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ x: number; y: number }>()("Position")
const Velocity = Descriptor.Component<{ x: number; y: number }>()("Velocity")
const Time = Descriptor.Resource<number>()("Time")
const TickEvent = Descriptor.Event<{ dt: number }>()("TickEvent")
const Phase = Descriptor.Resource<"Running" | "Paused">()("Phase")
const Logger = Descriptor.Service<{ log: (message: string) => void }>()("Logger")
const SafePosition = Descriptor.ConstructedComponent(Codecs.safeVector)("SafePosition")
const Viewport = Descriptor.ConstructedResource(Codecs.safeSize)("Viewport")
const Camera = Descriptor.ConstructedResource(Codecs.safeVector)("Camera")

const Game = Schema.bind(Schema.fragment({
  components: {
    Position,
    Velocity,
    SafePosition
  },
  resources: {
    Time,
    Viewport,
    Phase,
    Camera
  },
  events: {
    TickEvent
  }
}))
const schema = Game.schema

describe("System", () => {
  it("derives context from the explicit spec", () => {
    const query = Query.Query({
      selection: {
        position: Query.write(SafePosition),
        velocity: Query.read(Velocity)
      }
    })

    const system = System.System(
      "Move",
      {
        schema,
        queries: {
          moving: query
        },
        resources: {
          time: System.readResource(Time),
          viewport: System.writeResource(Viewport),
          phase: System.writeResource(Phase),
          camera: System.writeResource(Camera)
        },
        events: {
          tick: System.writeEvent(TickEvent)
        },
        services: {
          logger: System.service(Logger)
        }
      },
      ({ queries, resources, events, services }) =>
        {
          expect(queries.moving.each()).type.toBe<ReadonlyArray<{
            readonly entity: EntityMut<typeof schema, {
              readonly position: Query.ReadonlyValue<Codecs.SafeVector>
              readonly velocity: Query.ReadonlyValue<{ x: number; y: number }>
            }, {
              readonly position: Query.ReadonlyValue<Codecs.SafeVector>
            }, unknown, typeof SafePosition | typeof Velocity>
            readonly data: QueryTypes.Cells<typeof query>
          }>>()

          expect(resources.time.get()).type.toBe<number>()
          expect(resources.phase.get()).type.toBe<"Running" | "Paused">()
          expect(resources.viewport.setRaw({ width: 320, height: 180 })).type.toBe<Result.Result<void, Descriptor.SchemaIssues>>()
          expect(resources.viewport.updateRaw((viewport) => ({
            width: viewport.width,
            height: viewport.height
          }))).type.toBe<Result.Result<void, Descriptor.SchemaIssues>>()
          expect(services.logger).type.toBe<{ log: (message: string) => void }>()
          expect(events.tick.emit).type.toBe<(value: { readonly dt: number }) => void>()
          // Plain write cells take valid values only; validation belongs to constructed descriptors.
          expect(resources.phase).type.not.toHaveProperty("setResult")
          expect(resources.phase).type.not.toHaveProperty("updateResult")
          expect(resources.phase).type.not.toHaveProperty("setRaw")
          expect(resources.camera.setRaw({ x: 0, y: 0 })).type.toBe<Result.Result<void, Descriptor.SchemaIssues>>()
          expect(resources.camera.updateRaw((camera) => ({
            x: camera.x + 1,
            y: camera.y + 1
          }))).type.toBe<Result.Result<void, Descriptor.SchemaIssues>>()

          // @ts-expect-error Property 'missing' does not exist on type 'ResourceContext<SystemSpec<SchemaDefinition<{ readonly Position
          resources.missing
          // @ts-expect-error Property 'setRaw' does not exist on type 'ResourceReadView<number>'.
          resources.time.setRaw(1)
        }
    )

    expect(system).type.toBeAssignableTo<System.SystemDefinition<any>>()
  })

  it("carries only the failure type, not a success value", () => {
    type Failing = System.SystemDefinition<any, "Rejected">
    expect<System.FailureOf<Failing>>().type.toBe<System.SystemFailure<string, "Rejected">>()
    // @ts-expect-error requires between 1 and 5 type arguments
    type _WithSuccess = System.SystemDefinition<any, void, never, unknown, string, never>
  })

  it("accepts reusable plain object access fragments without a wrapper", () => {
    const query = Query.Query({
      selection: {
        position: Query.write(SafePosition),
        velocity: Query.read(Velocity)
      }
    })

    const movementAccess = {
      queries: {
        moving: query
      },
      resources: {
        time: System.readResource(Time),
        viewport: System.writeResource(Viewport)
      },
      services: {
        logger: System.service(Logger)
      }
    } satisfies System.SystemAccessSpec

    System.System(
      "MoveA",
      {
        schema,
        ...movementAccess
      },
      ({ queries, resources, services }) =>
        {
          expect(queries.moving.each()).type.toBe<ReadonlyArray<{
            readonly entity: EntityMut<typeof schema, {
              readonly position: Query.ReadonlyValue<Codecs.SafeVector>
              readonly velocity: Query.ReadonlyValue<{ x: number; y: number }>
            }, {
              readonly position: Query.ReadonlyValue<Codecs.SafeVector>
            }, unknown, typeof SafePosition | typeof Velocity>
            readonly data: QueryTypes.Cells<typeof query>
          }>>()

          expect(resources.time.get()).type.toBe<number>()
          expect(resources.viewport.setRaw({ width: 320, height: 180 })).type.toBe<Result.Result<void, Descriptor.SchemaIssues>>()
          expect(services.logger).type.toBe<{ log: (message: string) => void }>()

          // @ts-expect-error Property 'missing' does not exist on type 'ResourceContext<SystemSpec<SchemaDefinition<{ readonly Position
          resources.missing
        }
    )

    System.System(
      "MoveB",
      {
        schema,
        ...movementAccess
      },
      ({ resources, services }) =>
        {
          expect(resources.time.get()).type.toBe<number>()
          expect(services.logger.log).type.toBe<(message: string) => void>()

          // @ts-expect-error Property 'missing' does not exist on type 'ServiceContext<SystemSpec<SchemaDefinition<{ readonly Position
          services.missing
        }
    )
  })

  it("rejects unknown access categories at the constructor boundary", () => {
    Game.System("InvalidAccess", {
      // @ts-expect-error Object literal may only specify known properties, but 'resoruces' does not exist in type
      resoruces: {
        time: Game.System.readResource(Time)
      }
    }, () => {})
  })
})

describe("redundant resource and event slots", () => {
  const Score = Descriptor.Resource<number>()("Slots/Score")
  const Ping = Descriptor.Event<number>()("Slots/Ping")
  const Slots = Schema.bind(Schema.fragment({ resources: { Score }, events: { Ping } }))

  it("rejects a read next to another slot of the same resource, and a repeated slot", () => {
    Slots.System("Slots/ReadAndWrite", {
      resources: {
        // @ts-expect-error read repeats a resource another slot of this system declares
        read: Slots.System.readResource(Score),
        write: Slots.System.writeResource(Score)
      }
    }, () => {})
    Slots.System("Slots/EmitTwice", {
      events: {
        // @ts-expect-error first repeats an event another slot of this system declares
        first: Slots.System.writeEvent(Ping),
        // @ts-expect-error second repeats an event another slot of this system declares
        second: Slots.System.writeEvent(Ping)
      }
    }, () => {})
  })

  it("accepts a changed view next to a write, and reading the events a system emits", () => {
    expect(Slots.System("Slots/WriteAndChanged", {
      resources: { write: Slots.System.writeResource(Score), changed: Slots.System.changedResource(Score) }
    }, () => {}).name).type.toBe<"Slots/WriteAndChanged">()
    expect(Slots.System("Slots/Chain", {
      events: { read: Slots.System.readEvent(Ping), write: Slots.System.writeEvent(Ping) }
    }, () => {}).name).type.toBe<"Slots/Chain">()
  })
})

describe("Game.System.consumeService", () => {
  it("gives the same typed access as service", () => {
    const Bound = Schema.bind(Schema.fragment({}))
    expect(Bound.System.consumeService(Logger)).type.toBe<System.ServiceRead<typeof Logger, true>>()
    expect(Bound.System.service(Logger)).type.toBe<System.ServiceRead<typeof Logger, false>>()
    Bound.System("Consume/Drain", { services: { logger: Bound.System.consumeService(Logger) } }, ({ services }) => {
      expect(services.logger.log).type.toBe<(message: string) => void>()
    })
    // @ts-expect-error Argument of type 'ConstructedDescriptor<"resource", "Viewport"
    Bound.System.consumeService(Viewport)
  })

  it("is the only access that calls the methods a Consumes mark names", () => {
    interface Queue extends System.Consumes<"take"> {
      take(): ReadonlyArray<string>
      size(): number
    }
    const Messages = Descriptor.Service<Queue>()("Messages")
    const Bound = Schema.bind(Schema.fragment({}))
    Bound.System("Consume/Take", { services: { queue: Bound.System.consumeService(Messages) } }, ({ services }) => {
      expect(services.queue.take()).type.toBe<ReadonlyArray<string>>()
    })
    Bound.System("Consume/Peek", { services: { queue: Bound.System.service(Messages) } }, ({ services }) => {
      expect(services.queue.size()).type.toBe<number>()
      // @ts-expect-error take() drains Messages: declare it with Game.System.consumeService, or read the resource its capture writes
      services.queue.take()
    })
  })
})

