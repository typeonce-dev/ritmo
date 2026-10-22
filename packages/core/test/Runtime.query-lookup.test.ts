import { describe, expect, it } from "vitest"
import { Descriptor, Entity, Schema } from "@typeonce/ritmo"
import * as Command from "@typeonce/ritmo/Command"
import type { EntityId } from "@typeonce/ritmo/Entity"
import * as Query from "@typeonce/ritmo/Query"
import * as Runtime from "@typeonce/ritmo/Runtime"
import * as Schedule from "@typeonce/ritmo/Schedule"
import * as System from "@typeonce/ritmo/System"
import { readResourceValue } from "./utils/fixtures.ts"

const Position = Descriptor.Component<{ x: number; y: number }>()("Position")
const Velocity = Descriptor.Component<{ x: number; y: number }>()("Velocity")
const Hidden = Descriptor.Component<{ hidden: true }>()("Hidden")
const Count = Descriptor.Resource<number>()("Count")
const LastX = Descriptor.Resource<number>()("LastX")
const LastError = Descriptor.Resource<string>()("LastError")
const HandleRoot = Schema.defineRoot("RuntimeQueryHandle")
const StoredHandle = Descriptor.Resource<Entity.Handle<typeof HandleRoot, typeof Position> | null>()("StoredHandle")
const FollowTarget = Descriptor.Event<{ target: Entity.Handle<typeof HandleRoot, typeof Position> }>()("FollowTarget")
const Followed = Descriptor.Component<{
  target: Entity.Handle<typeof HandleRoot, typeof Position> | null
}>()("Followed")

const HandleGame = Schema.bind(Schema.fragment({
  components: {
    Position,
    Velocity,
    Hidden,
    Followed
  },
  resources: {
    Count,
    LastX,
    LastError,
    StoredHandle
  },
  events: {
    FollowTarget
  }
}), HandleRoot)
const schema = HandleGame.schema

const makeRuntime = () =>
  Runtime.make({
    schema,
    services: Runtime.services(),
    resources: {
      Count: 0,
      LastX: -1,
      LastError: "",
      StoredHandle: null
    }
  }).success

describe("Runtime query and lookup", () => {
  it("each returns zero matches when nothing satisfies the query", () => {
    const observe = System.System(
      "RuntimeQuery/ObserveEmpty",
      {
        schema,
        queries: {
          positions: Query.Query({
            selection: {
              position: Query.read(Position)
            }
          })
        },
        resources: {
          count: System.writeResource(Count)
        }
      },
      ({ queries, resources }) =>
        {
          resources.count.set(queries.positions.each().length)
        }
    )

    const runtime = makeRuntime()
    runtime.tick(Schedule.Schedule(observe))

    expect(readResourceValue(runtime, schema, Count)).toBe(0)
  })

  it("single returns NoEntities when no entity matches", () => {
    const observe = System.System(
      "RuntimeQuery/SingleNoEntities",
      {
        schema,
        queries: {
          positions: Query.Query({
            selection: {
              position: Query.read(Position)
            }
          })
        },
        resources: {
          lastError: System.writeResource(LastError)
        }
      },
      ({ queries, resources }) =>
        {
          const result = queries.positions.single()
          resources.lastError.set(result._tag === "Success" ? "" : result.failure._tag)
        }
    )

    const runtime = makeRuntime()
    runtime.tick(Schedule.Schedule(observe))

    expect(readResourceValue(runtime, schema, LastError)).toBe("NoEntities")
  })

  it("single returns MultipleEntities when multiple entities match", () => {
    const spawn = System.System(
      "RuntimeQuery/SpawnMultiple",
      {
        schema,
        commands: Command.commands(Command.spawns(Position))
      },
      ({ commands }) =>
        {
          commands.spawn(HandleGame.Command.spawn([Position, { x: 1, y: 1 }] as const))
          commands.spawn(HandleGame.Command.spawn([Position, { x: 2, y: 2 }] as const))
        }
    )

    const observe = System.System(
      "RuntimeQuery/ObserveMultiple",
      {
        schema,
        queries: {
          positions: Query.Query({
            selection: {
              position: Query.read(Position)
            }
          })
        },
        resources: {
          lastError: System.writeResource(LastError)
        }
      },
      ({ queries, resources }) =>
        {
          const result = queries.positions.single()
          resources.lastError.set(result._tag === "Success" ? "" : result.failure._tag)
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Schedule.Schedule(spawn, Schedule.applyDeferred()),
      Schedule.Schedule(observe)
    )

    expect(readResourceValue(runtime, schema, LastError)).toBe("MultipleEntities")
  })

  it("singleOptional returns undefined when no entity matches", () => {
    const observe = System.System(
      "RuntimeQuery/SingleOptionalNoEntities",
      {
        schema,
        queries: {
          positions: Query.Query({
            selection: {
              position: Query.read(Position)
            }
          })
        },
        resources: {
          lastX: System.writeResource(LastX),
          lastError: System.writeResource(LastError)
        }
      },
      ({ queries, resources }) =>
        {
          const result = queries.positions.singleOptional()
          resources.lastError.set(result._tag === "Success" ? "" : result.failure._tag)
          resources.lastX.set(result._tag === "Success" && result.success ? result.success.data.position.get().x : -1)
        }
    )

    const runtime = makeRuntime()
    runtime.tick(Schedule.Schedule(observe))

    expect(readResourceValue(runtime, schema, LastError)).toBe("")
    expect(readResourceValue(runtime, schema, LastX)).toBe(-1)
  })

  it("singleOptional returns the match when exactly one entity matches", () => {
    const spawn = System.System(
      "RuntimeQuery/SpawnOneForSingleOptional",
      {
        schema,
        commands: Command.commands(Command.spawns(Position))
      },
      ({ commands }) =>
        {
          commands.spawn(HandleGame.Command.spawn([Position, { x: 7, y: 3 }] as const))
        }
    )

    const observe = System.System(
      "RuntimeQuery/SingleOptionalOneEntity",
      {
        schema,
        queries: {
          positions: Query.Query({
            selection: {
              position: Query.write(Position)
            }
          })
        },
        resources: {
          lastX: System.writeResource(LastX),
          lastError: System.writeResource(LastError)
        }
      },
      ({ queries, resources }) =>
        {
          const result = queries.positions.singleOptional()
          resources.lastError.set(result._tag === "Success" ? "" : result.failure._tag)
          if (result._tag === "Failure" || !result.success) {
            resources.lastX.set(-1)
            return
          }

          result.success.data.position.update((position) => ({
            ...position,
            x: position.x + 1
          }))
          resources.lastX.set(result.success.data.position.get().x)
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Schedule.Schedule(spawn, Schedule.applyDeferred()),
      Schedule.Schedule(observe)
    )

    expect(readResourceValue(runtime, schema, LastError)).toBe("")
    expect(readResourceValue(runtime, schema, LastX)).toBe(8)
  })

  it("singleOptional returns MultipleEntities when multiple entities match", () => {
    const spawn = System.System(
      "RuntimeQuery/SpawnMultipleForSingleOptional",
      {
        schema,
        commands: Command.commands(Command.spawns(Position))
      },
      ({ commands }) =>
        {
          commands.spawn(HandleGame.Command.spawn([Position, { x: 1, y: 1 }] as const))
          commands.spawn(HandleGame.Command.spawn([Position, { x: 2, y: 2 }] as const))
        }
    )

    const observe = System.System(
      "RuntimeQuery/SingleOptionalMultipleEntities",
      {
        schema,
        queries: {
          positions: Query.Query({
            selection: {
              position: Query.read(Position)
            }
          })
        },
        resources: {
          lastError: System.writeResource(LastError)
        }
      },
      ({ queries, resources }) =>
        {
          const result = queries.positions.singleOptional()
          resources.lastError.set(result._tag === "Success" ? "" : result.failure._tag)
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Schedule.Schedule(spawn, Schedule.applyDeferred()),
      Schedule.Schedule(observe)
    )

    expect(readResourceValue(runtime, schema, LastError)).toBe("MultipleEntities")
  })

  it("query get returns MissingEntity and QueryMismatch for the expected cases", () => {
    let existingId: EntityId<typeof schema> | undefined

    const spawn = System.System(
      "RuntimeQuery/SpawnOneForLookup",
      {
        schema,
        commands: Command.commands(Command.spawns(Position))
      },
      ({ commands }) =>
        {
          existingId = commands.spawn(HandleGame.Command.spawn(
            [Position, { x: 1, y: 1 }] as const
          ))
        }
    )

    const observe = System.System(
      "RuntimeQuery/ObserveLookupFailures",
      {
        schema,
        queries: {
          positions: Query.Query({
            selection: {
              position: Query.read(Position)
            }
          }),
          velocities: Query.Query({
            selection: {
              velocity: Query.read(Velocity)
            }
          })
        },
        resources: {
          lastError: System.writeResource(LastError)
        }
      },
      ({ queries, resources }) =>
        {
          if (!existingId) {
            resources.lastError.set("MissingSetup")
            return
          }
          const missing = queries.positions.get(Entity.makeEntityId<typeof schema>(9999))
          const mismatch = queries.velocities.get(existingId)
          resources.lastError.set(`${missing._tag === "Success" ? "ok" : missing.failure._tag}/${mismatch._tag === "Success" ? "ok" : mismatch.failure._tag}`)
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Schedule.Schedule(spawn, Schedule.applyDeferred()),
      Schedule.Schedule(observe)
    )

    expect(readResourceValue(runtime, schema, LastError)).toBe("MissingEntity/QueryMismatch")
  })

  it("with and without filters refine matching entities", () => {
    const spawn = System.System(
      "RuntimeQuery/SpawnFiltered",
      {
        schema,
        commands: Command.commands(Command.spawns(Position, Hidden))
      },
      ({ commands }) =>
        {
          commands.spawn(HandleGame.Command.spawn(
            [Position, { x: 1, y: 1 }] as const
          ))
          commands.spawn(HandleGame.Command.spawn(
            [Position, { x: 2, y: 2 }] as const,
            [Hidden, { hidden: true }] as const
          ))
        }
    )

    const observe = System.System(
      "RuntimeQuery/ObserveFilters",
      {
        schema,
        queries: {
          visible: Query.Query({
            selection: {
              position: Query.read(Position)
            },
            with: [Position] as const,
            without: [Hidden] as const
          })
        },
        resources: {
          count: System.writeResource(Count)
        }
      },
      ({ queries, resources }) =>
        {
          resources.count.set(queries.visible.each().length)
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Schedule.Schedule(spawn, Schedule.applyDeferred()),
      Schedule.Schedule(observe)
    )

    expect(readResourceValue(runtime, schema, Count)).toBe(1)
  })

  it("optional component slots do not affect matching and stay explicit in results", () => {
    const spawn = System.System(
      "RuntimeQuery/SpawnOptional",
      {
        schema,
        commands: Command.commands(Command.spawns(Position, Velocity))
      },
      ({ commands }) =>
        {
          commands.spawn(HandleGame.Command.spawn(
            [Position, { x: 1, y: 1 }] as const
          ))
          commands.spawn(HandleGame.Command.spawn(
            [Position, { x: 2, y: 2 }] as const,
            [Velocity, { x: 4, y: 0 }] as const
          ))
        }
    )

    const observe = System.System(
      "RuntimeQuery/ObserveOptional",
      {
        schema,
        queries: {
          moving: Query.Query({
            selection: {
              position: Query.read(Position),
              velocity: Query.optional(Velocity)
            }
          })
        },
        resources: {
          count: System.writeResource(Count),
          lastX: System.writeResource(LastX)
        }
      },
      ({ queries, resources }) =>
        {
          let totalX = 0
          for (const match of queries.moving.each()) {
            if (match.data.velocity.present) {
              totalX += match.data.velocity.get().x
            }
          }

          resources.count.set(queries.moving.each().length)
          resources.lastX.set(totalX)
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Schedule.Schedule(spawn, Schedule.applyDeferred()),
      Schedule.Schedule(observe)
    )

    expect(readResourceValue(runtime, schema, Count)).toBe(2)
    expect(readResourceValue(runtime, schema, LastX)).toBe(4)
  })

  it("query get does not fail when only optional components are missing", () => {
    let existingId: EntityId<typeof schema> | undefined

    const spawn = System.System(
      "RuntimeQuery/SpawnLookupOptional",
      {
        schema,
        commands: Command.commands(Command.spawns(Position))
      },
      ({ commands }) =>
        {
          existingId = commands.spawn(HandleGame.Command.spawn(
            [Position, { x: 3, y: 7 }] as const
          ))
        }
    )

    const observe = System.System(
      "RuntimeQuery/ObserveLookupOptional",
      {
        schema,
        queries: {
          positioned: Query.Query({
            selection: {
              position: Query.read(Position),
              velocity: Query.optional(Velocity)
            }
          })
        },
        resources: {
          lastX: System.writeResource(LastX),
          lastError: System.writeResource(LastError)
        }
      },
      ({ queries, resources }) =>
        {
          if (!existingId) {
            resources.lastError.set("MissingSetup")
            return
          }

          const result = queries.positioned.get(existingId)

          if (result._tag === "Failure") {
            resources.lastError.set(result.failure._tag)
            return
          }

          resources.lastError.set(result.success.data.velocity.present ? "Present" : "Missing")
          resources.lastX.set(result.success.data.position.get().x)
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Schedule.Schedule(spawn, Schedule.applyDeferred()),
      Schedule.Schedule(observe)
    )

    expect(readResourceValue(runtime, schema, LastError)).toBe("Missing")
    expect(readResourceValue(runtime, schema, LastX)).toBe(3)
  })

  it("writable query cells update component values", () => {
    const spawn = System.System(
      "RuntimeQuery/SpawnWritable",
      {
        schema,
        commands: Command.commands(Command.spawns(Position))
      },
      ({ commands }) =>
        {
          commands.spawn(HandleGame.Command.spawn(
            [Position, { x: 1, y: 1 }] as const
          ))
        }
    )

    const write = System.System(
      "RuntimeQuery/WriteThroughCell",
      {
        schema,
        queries: {
          positions: Query.Query({
            selection: {
              position: Query.write(Position)
            }
          })
        }
      },
      ({ queries }) =>
        {
          const result = queries.positions.single()
          if (result._tag === "Success") {
            result.success.data.position.update((position) => ({
              ...position,
              x: 9
            }))
          }
        }
    )

    const read = System.System(
      "RuntimeQuery/ReadWrittenCell",
      {
        schema,
        queries: {
          positions: Query.Query({
            selection: {
              position: Query.read(Position)
            }
          })
        },
        resources: {
          lastX: System.writeResource(LastX)
        }
      },
      ({ queries, resources }) =>
        {
          const result = queries.positions.single()
          resources.lastX.set(result._tag === "Success" ? result.success.data.position.get().x : -1)
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Schedule.Schedule(spawn, Schedule.applyDeferred()),
      Schedule.Schedule(write, read)
    )

    expect(readResourceValue(runtime, schema, LastX)).toBe(9)
  })

  it("getHandle resolves durable handles explicitly and reports stale handles safely", () => {
    const Game = HandleGame
    let currentHandle: Entity.Handle<typeof HandleRoot, typeof Position> | null = null

    const spawn = Game.System(
      "RuntimeQuery/SpawnHandle",
      { commands: Game.System.commands(Game.System.spawns(Position)) },
      ({ commands }) =>
        {
          const target = commands.spawn(Game.Command.spawn([Position, { x: 5, y: 9 }] as const))
          currentHandle = Game.Entity.handle(target, Position)
        }
    )

    const observe = Game.System(
      "RuntimeQuery/ObserveHandle",
      {
        queries: {
          positions: Game.Query({
            selection: {
              position: Game.Query.read(Position)
            }
          })
        },
        resources: {
          lastX: Game.System.writeResource(LastX),
          lastError: Game.System.writeResource(LastError)
        }
      },
      ({ queries, resources }) =>
        {
          if (!currentHandle) {
            resources.lastError.set("MissingSetup")
            return
          }

          const result = queries.positions.getHandle(currentHandle)

          if (result._tag === "Failure") {
            resources.lastError.set(result.failure._tag)
            return
          }

          resources.lastX.set(result.success.data.position.get().x)
          resources.lastError.set("")
        }
    )

    const destroy = Game.System(
      "RuntimeQuery/DestroyHandleTarget",
      {
        queries: {
          positions: Game.Query({
            selection: {
              position: Game.Query.read(Position)
            }
          })
        },
        commands: Game.System.commands(Game.System.despawns(Position))
      },
      ({ queries, commands }) =>
        {
          if (!currentHandle) {
            return
          }
          const result = queries.positions.getHandle(currentHandle)
          if (result._tag === "Success") {
            commands.despawn(result.success.entity)
          }
        }
    )

    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(),
      resources: {
        Count: 0,
        LastX: -1,
        LastError: "",
        StoredHandle: null
      }
    }).success

    runtime.tick(
      Game.Schedule(spawn, Game.Schedule.applyDeferred()),
      Game.Schedule(observe)
    )

    expect(readResourceValue(runtime, schema, LastX)).toBe(5)
    expect(readResourceValue(runtime, schema, LastError)).toBe("")

    runtime.tick(
      Game.Schedule(destroy, Game.Schedule.applyDeferred()),
      Game.Schedule(observe)
    )

    expect(readResourceValue(runtime, schema, LastError)).toBe("MissingEntity")
  })

  it("resolves handles stored in resources and events with the same explicit failure semantics", () => {
    const Game = HandleGame
    let spawnedTarget: Entity.EntityId<typeof schema, typeof HandleRoot> | undefined

    const spawn = Game.System(
      "RuntimeQuery/SpawnStoredHandle",
      {
        resources: {
          storedHandle: Game.System.writeResource(StoredHandle)
        },
        events: {
          followTarget: Game.System.writeEvent(FollowTarget)
        },
        commands: Game.System.commands(Game.System.spawns(Position))
      },
      ({ resources, events, commands }) =>
        {
          spawnedTarget = commands.spawn(Game.Command.spawn([Position, { x: 12, y: 8 }] as const))
          const handle = Game.Entity.handle(spawnedTarget, Position)
          resources.storedHandle.set(handle)
          events.followTarget.emit({ target: handle })
        }
    )

    const observe = Game.System(
      "RuntimeQuery/ObserveStoredHandle",
      {
        queries: {
          positions: Game.Query({
            selection: {
              position: Game.Query.read(Position)
            }
          })
        },
        resources: {
          storedHandle: Game.System.readResource(StoredHandle),
          lastX: Game.System.writeResource(LastX),
          lastError: Game.System.writeResource(LastError)
        },
        events: {
          followTarget: Game.System.readEvent(FollowTarget)
        }
      },
      ({ queries, resources, events }) =>
        {
          const resourceHandle = resources.storedHandle.get()
          const eventHandle = events.followTarget.all().at(0)?.target

          if (!resourceHandle || !eventHandle) {
            resources.lastError.set("MissingSetup")
            return
          }

          const resourceResult = queries.positions.getHandle(resourceHandle)
          const eventResult = queries.positions.getHandle(eventHandle)

          if (resourceResult._tag === "Failure" || eventResult._tag === "Failure") {
            resources.lastError.set(`${resourceResult._tag === "Success" ? "ok" : resourceResult.failure._tag}/${eventResult._tag === "Success" ? "ok" : eventResult.failure._tag}`)
            return
          }

          resources.lastX.set(resourceResult.success.data.position.get().x + eventResult.success.data.position.get().x)
          resources.lastError.set("")
        }
    )

    const destroy = Game.System(
      "RuntimeQuery/DestroyStoredHandleTarget",
      {
        queries: {
          positions: Game.Query({
            selection: {
              position: Game.Query.read(Position)
            }
          })
        },
        commands: Game.System.commands(Game.System.despawns(Position))
      },
      ({ queries, commands }) =>
        {
          if (spawnedTarget) {
            const target = queries.positions.get(spawnedTarget)
            if (target._tag === "Success") {
              commands.despawn(target.success.entity)
            }
          }
        }
    )

    const emitStored = Game.System(
      "RuntimeQuery/EmitStoredHandleAgain",
      {
        resources: {
          storedHandle: Game.System.readResource(StoredHandle)
        },
        events: {
          followTarget: Game.System.writeEvent(FollowTarget)
        }
      },
      ({ resources, events }) =>
        {
          const handle = resources.storedHandle.get()
          if (handle) {
            events.followTarget.emit({ target: handle })
          }
        }
    )

    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(),
      resources: {
        Count: 0,
        LastX: -1,
        LastError: "",
        StoredHandle: null
      }
    }).success

    runtime.tick(
      Game.Schedule(spawn, Game.Schedule.applyDeferred(), observe)
    )

    expect(readResourceValue(runtime, schema, LastX)).toBe(24)
    expect(readResourceValue(runtime, schema, LastError)).toBe("")

    runtime.tick(
      Game.Schedule(destroy, Game.Schedule.applyDeferred()),
      Game.Schedule(emitStored, observe)
    )

    expect(readResourceValue(runtime, schema, LastError)).toBe("MissingEntity/MissingEntity")
  })
})

describe("optional slots", () => {
  it("read their value, or undefined when the entity does not hold the component", () => {
    const Hp = Descriptor.Component<number>()("Optional/Hp")
    const Name = Descriptor.Component<string>()("Optional/Name")
    const Local = Schema.bind(Schema.fragment({ components: { Hp, Name } }))
    const spawn = Local.System("Optional/Spawn", { commands: Local.System.commands(Local.System.spawns(Hp, Name)) }, ({ commands }) => {
      commands.spawn(Local.Command.spawn([Name, "full"], [Hp, 3]))
      commands.spawn(Local.Command.spawn([Name, "empty"]))
    })
    const Read = Local.Inspector("Optional/Read", {
      queries: { named: Local.Query({ selection: { name: Local.Query.read(Name), hp: Local.Query.optional(Hp) } }) }
    }, ({ queries }) => queries.named.each().map(({ data }) => [data.name.get(), data.hp.value()] as const).sort())
    const runtime = Local.Runtime.make({ services: Local.Runtime.services() }).success
    runtime.tick(Local.Schedule(spawn, Local.Schedule.applyDeferred()))
    expect(runtime.inspect(Read)).toEqual([["empty", undefined], ["full", 3]])
  })
})

