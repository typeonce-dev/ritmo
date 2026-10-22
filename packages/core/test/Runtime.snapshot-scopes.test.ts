import { describe, expect, it } from "vitest"
import { Decode, Descriptor, Schema } from "@typeonce/ritmo"

const Name = Descriptor.ConstructedComponent(Decode.string)("SnapshotScopes/Name")
const { relation: ChildOf } = Descriptor.Hierarchy("SnapshotScopes/ChildOf", "SnapshotScopes/Children")
const Game = Schema.bind(Schema.fragment({ components: { Name }, relations: { ChildOf } }))
const Level = Game.EntityScope("SnapshotScopes/Level")
const Menu = Game.EntityScope("SnapshotScopes/Menu")

const makeRuntime = () => Game.Runtime.make({ services: Game.Runtime.services() }).success
type Runtime = ReturnType<typeof makeRuntime>

const Names = Game.Inspector("SnapshotScopes/Names", {
  queries: { named: Game.Query({ selection: { name: Game.Query.read(Name) } }) }
}, ({ queries }) => queries.named.each().map((match) => match.data.name.get()).sort())

const despawn = (runtime: Runtime, scope: typeof Level | typeof Menu) =>
  runtime.tick(Game.Schedule(Game.System("SnapshotScopes/Despawn", { commands: Game.System.commands(Game.System.despawnsScope(Level), Game.System.despawnsScope(Menu)) }, ({ commands }) => {
    commands.despawnScope(scope)
  }), Game.Schedule.applyDeferred()))

const roundTrip = (runtime: Runtime): Runtime => {
  const restored = makeRuntime()
  const result = restored.restore(JSON.parse(JSON.stringify(runtime.snapshot())))
  if (result._tag === "Failure") throw new Error(JSON.stringify(result.failure))
  return restored
}

describe("snapshots keep entity scopes", () => {
  it("despawns a restored scope's entities", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(Game.System("SnapshotScopes/Spawn", { commands: Game.System.commands(Game.System.spawns(Name)) }, ({ commands }) => {
      commands.spawnIn(Level, Game.Command.spawn([Name, "wall"]))
    }), Game.Schedule.applyDeferred()))
    expect(runtime.inspect(Names)).toEqual(["wall"])

    const restored = roundTrip(runtime)
    expect(restored.inspect(Names)).toEqual(["wall"])
    despawn(restored, Level)
    expect(restored.inspect(Names)).toEqual([])
  })

  it("keeps several scopes apart, and unscoped entities and scoped children as they were", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(Game.System("SnapshotScopes/SpawnMany", { commands: Game.System.commands(Game.System.spawns(Name), Game.System.relates(ChildOf)) }, ({ commands }) => {
      const level = commands.spawnIn(Level, Game.Command.spawn([Name, "level"]))
      // A child of a scoped entity, in another scope: despawned with its parent (hierarchy) or its own scope.
      commands.spawnIn(Menu, Game.Command.relate(Game.Command.spawn([Name, "level child in menu"]), ChildOf, level))
      commands.spawnIn(Menu, Game.Command.spawn([Name, "button"]))
      commands.spawn(Game.Command.spawn([Name, "free"]))
    }), Game.Schedule.applyDeferred()))

    const restored = roundTrip(runtime)
    expect(restored.snapshot().scopes).toEqual(runtime.snapshot().scopes)
    despawn(restored, Menu)
    expect(restored.inspect(Names)).toEqual(["free", "level"])
    despawn(restored, Level)
    expect(restored.inspect(Names)).toEqual(["free"])
  })

  it("rejects scope members that are not saved entities, or are in two scopes", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(Game.System("SnapshotScopes/SpawnOne", { commands: Game.System.commands(Game.System.spawns(Name)) }, ({ commands }) => {
      commands.spawnIn(Level, Game.Command.spawn([Name, "wall"]))
    }), Game.Schedule.applyDeferred()))
    const saved = runtime.snapshot()
    const id = saved.entities[0]!.id
    const target = makeRuntime()
    expect(target.restore({ ...saved, scopes: { [Level.name]: [id + 100] } })).toEqual({
      _tag: "Failure",
      failure: { _tag: "InvalidScope", name: Level.name, entityId: id + 100 }
    })
    expect(target.restore({ ...saved, scopes: { [Level.name]: [id], [Menu.name]: [id] } })).toEqual({
      _tag: "Failure",
      failure: { _tag: "InvalidScope", name: Menu.name, entityId: id }
    })
  })

  it("rejects a scope name this game does not define", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(Game.System("SnapshotScopes/SpawnUnknown", { commands: Game.System.commands(Game.System.spawns(Name)) }, ({ commands }) => {
      commands.spawnIn(Level, Game.Command.spawn([Name, "wall"]))
    }), Game.Schedule.applyDeferred()))
    const saved = runtime.snapshot()
    const id = saved.entities[0]!.id
    const target = makeRuntime()
    expect(target.restore({ ...saved, scopes: { "SnapshotScopes/Levl": [id] } })).toEqual({
      _tag: "Failure",
      failure: { _tag: "UnknownScope", name: "SnapshotScopes/Levl" }
    })
    // Nothing changed: the target still restores the real save.
    expect(target.restore(saved)).toEqual({ _tag: "Success", success: undefined })
    expect(target.inspect(Names)).toEqual(["wall"])
  })

  it("rejects version 1 snapshots, which have no scopes, instead of restoring them without", () => {
    const runtime = makeRuntime()
    const { scopes: _scopes, ...rest } = runtime.snapshot()
    expect(makeRuntime().restore({ ...rest, version: 1 })).toEqual({
      _tag: "Failure",
      failure: { _tag: "UnsupportedVersion", version: 1 }
    })
  })
})
