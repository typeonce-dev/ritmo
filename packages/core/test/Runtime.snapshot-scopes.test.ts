import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Codecs from "./codecs.ts"
import { worldOf } from "./saved.ts"

const Name = Descriptor.ConstructedComponent(Codecs.string)("SnapshotScopes/Name")
const { relation: ChildOf } = Descriptor.Hierarchy("SnapshotScopes/ChildOf", "SnapshotScopes/Children")
const Root = Schema.defineRoot("SnapshotScopes")
const Game = Schema.bind(Schema.fragment({ components: { Name }, relations: { ChildOf } }), Root)
const Level = Game.EntityScope("SnapshotScopes/Level")
const Menu = Game.EntityScope("SnapshotScopes/Menu")

const makeRuntime = () => Game.Runtime.make({ services: Game.Runtime.services() }).value
type Runtime = ReturnType<typeof makeRuntime>

const Names = Game.Inspector("SnapshotScopes/Names", {
  queries: { named: Game.Query({ selection: { name: Game.Query.read(Name) } }) }
}, ({ queries }) => queries.named.each().map((entity) => queries.named.data.name.get(entity)).sort())

const despawn = (runtime: Runtime, scope: typeof Level | typeof Menu) =>
  runtime.tick(Game.Schedule(Game.System("SnapshotScopes/Despawn", { commands: Game.System.commands(Game.System.despawnsScope(Level), Game.System.despawnsScope(Menu)) }, ({ commands }) => {
    commands.despawnScope(scope)
  }), Game.Schedule.applyDeferred()))

const roundTrip = (runtime: Runtime): Runtime => {
  const restored = makeRuntime()
  const result = restored.restore(JSON.parse(JSON.stringify(worldOf(runtime.snapshot()))))
  if (!result.ok) throw new Error(JSON.stringify(result.error))
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
    expect(worldOf(restored.snapshot()).scopes).toEqual(worldOf(runtime.snapshot()).scopes)
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
    const saved = worldOf(runtime.snapshot())
    const id = saved.entities[0]!.id
    const target = makeRuntime()
    expect(target.restore({ ...saved, scopes: { [Level.name]: [id + 100] } })).toEqual({
      ok: false,
      error: { _tag: "InvalidScope", name: Level.name, entityId: id + 100 }
    })
    expect(target.restore({ ...saved, scopes: { [Level.name]: [id], [Menu.name]: [id] } })).toEqual({
      ok: false,
      error: { _tag: "InvalidScope", name: Menu.name, entityId: id }
    })
  })

  it("rejects a scope name this game does not define", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(Game.System("SnapshotScopes/SpawnUnknown", { commands: Game.System.commands(Game.System.spawns(Name)) }, ({ commands }) => {
      commands.spawnIn(Level, Game.Command.spawn([Name, "wall"]))
    }), Game.Schedule.applyDeferred()))
    const saved = worldOf(runtime.snapshot())
    const id = saved.entities[0]!.id
    const target = makeRuntime()
    expect(target.restore({ ...saved, scopes: { "SnapshotScopes/Levl": [id] } })).toEqual({
      ok: false,
      error: { _tag: "UnknownScope", name: "SnapshotScopes/Levl" }
    })
    // Nothing changed: the target still restores the real save.
    expect(target.restore(saved)).toEqual({ ok: true, value: undefined })
    expect(target.inspect(Names)).toEqual(["wall"])
  })

  it("rejects version 1 snapshots, which have no scopes, instead of restoring them without", () => {
    const runtime = makeRuntime()
    const { scopes: _scopes, ...rest } = worldOf(runtime.snapshot())
    expect(makeRuntime().restore({ ...rest, version: 1 })).toEqual({
      ok: false,
      error: { _tag: "UnsupportedVersion", version: 1 }
    })
  })
})
