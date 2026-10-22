import { describe, expect, it } from "vitest"
import { Descriptor, Result, Schema } from "@typeonce/ritmo"
import type { EntityId } from "@typeonce/ritmo/Entity"
import * as Vector2 from "@typeonce/ritmo-math/Vector2"
import { readResourceValue } from "./utils/fixtures.ts"

const Position = Descriptor.Component<{ x: number; y: number }>()("Position")
const Velocity = Descriptor.Component<{ x: number; y: number }>()("Velocity")
const Count = Descriptor.Resource<number>()("Count")
const LastX = Descriptor.Resource<number>()("LastX")
const SafePosition = Descriptor.ConstructedComponent(Vector2)("SafePosition")
const SafeVelocity = Descriptor.ConstructedComponent({
  result: (raw: { x: number; y: number }) =>
    Number.isFinite(raw.x) && Number.isFinite(raw.y) ? Result.succeed(raw) : Result.fail("bad-velocity" as const)
})("SafeVelocity")

const Game = Schema.bind(Schema.fragment({
  components: {
    Position,
    Velocity,
    SafeVelocity
  },
  resources: {
    Count,
    LastX
  }
}))
const schema = Game.schema

const ConstructedGame = Schema.bind(Schema.fragment({
  components: {
    SafePosition
  }
}))
const constructedSchema = ConstructedGame.schema

const makeRuntime = () =>
  Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: {
      Count: 0,
      LastX: -1
    }
  }).success

describe("Runtime commands", () => {
  it("insertMany applies entries in order with last-write-wins semantics", () => {
    const spawn = Game.System(
      "RuntimeCommands/SpawnInsertMany",
      { commands: Game.System.commands(Game.System.spawns(Position), Game.System.inserts(Position, Velocity)) },
      ({ commands }) =>
        {
          const id = commands.spawn(Game.Command.spawn(
            [Position, { x: 0, y: 0 }] as const
          ))
          commands.insert(
            id,
            [Position, { x: 1, y: 1 }] as const,
            [Position, { x: 2, y: 2 }] as const,
            [Velocity, { x: 9, y: 9 }] as const
          )
        }
    )

    const observe = Game.System(
      "RuntimeCommands/ObserveLastWriteWins",
      {
        queries: {
          moving: Game.Query({
            selection: {
              position: Game.Query.read(Position),
              velocity: Game.Query.read(Velocity)
            }
          })
        },
        resources: {
          count: Game.System.writeResource(Count),
          lastX: Game.System.writeResource(LastX)
        }
      },
      ({ queries, resources }) =>
        {
          const result = queries.moving.single()
          resources.count.set(result._tag === "Success" ? 1 : 0)
          resources.lastX.set(result._tag === "Success" ? result.success.data.position.get().x : -1)
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Game.Schedule(spawn, Game.Schedule.applyDeferred()),
      Game.Schedule(observe)
    )

    expect(readResourceValue(runtime, schema, Count)).toBe(1)
    expect(readResourceValue(runtime, schema, LastX)).toBe(2)
  })

  it("remove causes later queries to stop matching", () => {
    const spawn = Game.System(
      "RuntimeCommands/SpawnForRemove",
      { commands: Game.System.commands(Game.System.spawns(Position, Velocity), Game.System.removes(Velocity)) },
      ({ commands }) =>
        {
          const id = commands.spawn(Game.Command.spawn(
            [Position, { x: 1, y: 1 }] as const,
            [Velocity, { x: 1, y: 1 }] as const
          ))
          commands.remove(id, Velocity)
        }
    )

    const observe = Game.System(
      "RuntimeCommands/ObserveRemove",
      {
        queries: {
          moving: Game.Query({
            selection: {
              position: Game.Query.read(Position),
              velocity: Game.Query.read(Velocity)
            }
          })
        },
        resources: {
          count: Game.System.writeResource(Count)
        }
      },
      ({ queries, resources }) =>
        {
          resources.count.set(queries.moving.each().length)
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Game.Schedule(spawn, Game.Schedule.applyDeferred()),
      Game.Schedule(observe)
    )

    expect(readResourceValue(runtime, schema, Count)).toBe(0)
  })

  it("despawn removes the entity and exact lookup reports MissingEntity", () => {
    let storedId: EntityId<typeof schema, typeof schema> | undefined

    const spawn = Game.System(
      "RuntimeCommands/SpawnAndStoreId",
      { commands: Game.System.commands(Game.System.spawns(Position)) },
      ({ commands }) =>
        {
          storedId = commands.spawn(Game.Command.spawn(
            [Position, { x: 1, y: 2 }] as const
          ))
        }
    )

    const despawn = Game.System(
      "RuntimeCommands/DespawnStoredId",
      {
        queries: { positions: Game.Query({ selection: { position: Game.Query.read(Position) } }) },
        commands: Game.System.commands(Game.System.despawns(Position))
      },
      ({ queries, commands }) =>
        {
          if (!storedId) return
          const match = queries.positions.get(storedId)
          if (match._tag === "Success") commands.despawn(match.success.entity)
        }
    )

    const lookup = Game.System(
      "RuntimeCommands/LookupDespawned",
      {
        queries: {
          positions: Game.Query({
            selection: {
              position: Game.Query.read(Position)
            }
          })
        },
        resources: {
          count: Game.System.writeResource(Count)
        }
      },
      ({ queries, resources }) =>
        {
          const id = storedId
          if (!id) {
            resources.count.set(-1)
            return
          }
          const result = queries.positions.get(id)
          resources.count.set(result._tag === "Success" ? 0 : result.failure._tag === "MissingEntity" ? 1 : -1)
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Game.Schedule(spawn, Game.Schedule.applyDeferred(), despawn, Game.Schedule.applyDeferred()),
      Game.Schedule(lookup)
    )

    expect(readResourceValue(runtime, schema, Count)).toBe(1)
  })

  it("despawn of an id spawned in the same run cancels the spawn at applyDeferred", () => {
    const spawnAndCancel = Game.System(
      "RuntimeCommands/SpawnAndCancel",
      { commands: Game.System.commands(Game.System.spawns(Position, Velocity), Game.System.despawns(Velocity)) },
      ({ commands }) => {
        commands.spawn(Game.Command.spawn([Position, { x: 0, y: 0 }] as const))
        const moving = commands.spawn(Game.Command.spawn([Position, { x: 1, y: 1 }] as const, [Velocity, { x: 1, y: 0 }] as const))
        commands.despawn(moving)
      }
    )
    const count = Game.System(
      "RuntimeCommands/CountAfterCancel",
      {
        queries: { positions: Game.Query({ selection: { position: Game.Query.read(Position) } }) },
        resources: { count: Game.System.writeResource(Count) }
      },
      ({ queries, resources }) => {
        resources.count.set(queries.positions.each().length)
      }
    )

    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(spawnAndCancel, Game.Schedule.applyDeferred(), count))

    expect(readResourceValue(runtime, schema, Count)).toBe(1)
  })

  it("entryRaw and insertRaw validate constructed component input explicitly", () => {
    const invalidEntry = ConstructedGame.Command.entryRaw(SafePosition, { x: Number.NaN, y: 0 })
    expect(invalidEntry._tag).toBe("Failure")

    const spawned = ConstructedGame.Command.spawn(
      ConstructedGame.Command.entryRaw(SafePosition, { x: 1, y: 2 })
    )

    expect(spawned._tag).toBe("Success")
    if (spawned._tag === "Failure") {
      return
    }

    const inserted = ConstructedGame.Command.extend(
      spawned.success, ConstructedGame.Command.entryRaw(SafePosition, { x: 3, y: 4 }))

    expect(inserted._tag).toBe("Success")
  })

  it("insert on an existing entity becomes visible after explicit applyDeferred in the same schedule", () => {
    let storedId: EntityId<typeof schema, typeof schema> | undefined

    const spawn = Game.System(
      "RuntimeCommands/SpawnStoreForInsert",
      { commands: Game.System.commands(Game.System.spawns(Position)) },
      ({ commands }) =>
        {
          const id = commands.spawn(Game.Command.spawn(
            [Position, { x: 0, y: 0 }] as const
          ))
          storedId = id
        }
    )

    const insertVelocity = Game.System(
      "RuntimeCommands/InsertVelocity",
      { commands: Game.System.commands(Game.System.inserts(Velocity)) },
      ({ commands }) =>
        {
          const id = storedId
          if (id) {
            commands.insert(id, [Velocity, { x: 4, y: 5 }])
          }
        }
    )

    const observe = Game.System(
      "RuntimeCommands/ObserveInsertedVelocity",
      {
        queries: {
          moving: Game.Query({
            selection: {
              position: Game.Query.read(Position),
              velocity: Game.Query.read(Velocity)
            }
          })
        },
        resources: {
          count: Game.System.writeResource(Count)
        }
      },
      ({ queries, resources }) =>
        {
          resources.count.set(queries.moving.each().length)
        }
    )

    const runtime = makeRuntime()
    const spawnSchedule = Game.Schedule(spawn, Game.Schedule.applyDeferred())
    const observeSchedule = Game.Schedule(insertVelocity, Game.Schedule.applyDeferred(), observe)

    runtime.tick(spawnSchedule, observeSchedule)

    expect(readResourceValue(runtime, schema, Count)).toBe(1)
  })

  it("spawn with raw entries returns tuple-shaped failures and applies successful drafts", () => {
    const spawn = Game.System(
      "RuntimeCommands/SpawnWithResult",
      {
        commands: Game.System.commands(Game.System.spawns(Position, SafeVelocity)),
        resources: {
          count: Game.System.writeResource(Count),
          lastX: Game.System.writeResource(LastX)
        }
      },
      ({ commands, resources }) =>
        {
          const invalidDraft = Game.Command.spawn(
            Game.Command.entry(Position, { x: 1, y: 2 }),
            Game.Command.entryRaw(SafeVelocity, { x: Number.NaN, y: 0 })
          )

          expect(invalidDraft).toEqual(Result.fail([null, "bad-velocity"]))

          const validDraft = Game.Command.spawn(
            Game.Command.entry(Position, { x: 4, y: 5 }),
            Game.Command.entryRaw(SafeVelocity, { x: 6, y: 7 })
          )

          if (validDraft._tag === "Failure") {
            resources.count.set(-1)
            return
          }

          commands.spawn(validDraft.success)
          resources.count.set(1)
          resources.lastX.set(4)
        }
    )

    const observe = Game.System(
      "RuntimeCommands/ObserveSpawnWithResult",
      {
        queries: {
          moving: Game.Query({
            selection: {
              position: Game.Query.read(Position),
              velocity: Game.Query.read(SafeVelocity)
            }
          })
        },
        resources: {
          count: Game.System.writeResource(Count),
          lastX: Game.System.writeResource(LastX)
        }
      },
      ({ queries, resources }) =>
        {
          const result = queries.moving.single()
          resources.count.set(result._tag === "Success" ? 1 : 0)
          resources.lastX.set(result._tag === "Success" ? result.success.data.position.get().x : -1)
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Game.Schedule(spawn, Game.Schedule.applyDeferred()),
      Game.Schedule(observe)
    )

    expect(readResourceValue(runtime, schema, Count)).toBe(1)
    expect(readResourceValue(runtime, schema, LastX)).toBe(4)
  })

  it("spawn accepts plain and raw entries together", () => {
    const spawn = Game.System(
      "RuntimeCommands/SpawnWithMixed",
      {
        commands: Game.System.commands(Game.System.spawns(Position, SafeVelocity)),
        resources: {
          count: Game.System.writeResource(Count),
          lastX: Game.System.writeResource(LastX)
        }
      },
      ({ commands, resources }) =>
        {
          const invalidDraft = Game.Command.spawn(
            Game.Command.entry(Position, { x: 1, y: 2 }),
            Game.Command.entryRaw(SafeVelocity, { x: Number.NaN, y: 0 })
          )

          expect(invalidDraft).toEqual(Result.fail([null, "bad-velocity"]))

          const validDraft = Game.Command.spawn(
            Game.Command.entry(Position, { x: 4, y: 5 }),
            Game.Command.entryRaw(SafeVelocity, { x: 6, y: 7 })
          )

          if (validDraft._tag === "Failure") {
            resources.count.set(-1)
            return
          }

          commands.spawn(validDraft.success)
          resources.count.set(1)
          resources.lastX.set(4)
        }
    )

    const observe = Game.System(
      "RuntimeCommands/ObserveSpawnWithMixed",
      {
        queries: {
          moving: Game.Query({
            selection: {
              position: Game.Query.read(Position),
              velocity: Game.Query.read(SafeVelocity)
            }
          })
        },
        resources: {
          count: Game.System.writeResource(Count),
          lastX: Game.System.writeResource(LastX)
        }
      },
      ({ queries, resources }) =>
        {
          const result = queries.moving.single()
          resources.count.set(result._tag === "Success" ? 1 : 0)
          resources.lastX.set(result._tag === "Success" ? result.success.data.position.get().x : -1)
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Game.Schedule(spawn, Game.Schedule.applyDeferred()),
      Game.Schedule(observe)
    )

    expect(readResourceValue(runtime, schema, Count)).toBe(1)
    expect(readResourceValue(runtime, schema, LastX)).toBe(4)
  })
})
