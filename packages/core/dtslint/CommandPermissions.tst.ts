import { Descriptor, Schema } from "@typeonce/ritmo"
import type * as Command from "@typeonce/ritmo/Command"
import type * as Entity from "@typeonce/ritmo/Entity"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ readonly x: number }>()("Perms/Position")
const Enemy = Descriptor.Component<{}>()("Perms/Enemy")
const Noise = Descriptor.Component<number>()("Perms/Noise")
const Turned = Descriptor.Component<{ readonly seconds: number }>()("Perms/Turned")
const { relation: ChildOf } = Descriptor.Hierarchy("Perms/ChildOf", "Perms/Children")
const Game = Schema.bind(Schema.fragment({ components: { Position, Enemy, Noise, Turned }, relations: { ChildOf } }))
const Level = Game.EntityScope("Perms/Level")
const Menu = Game.EntityScope("Perms/Menu")
type Id = Entity.EntityId<typeof Game.schema, typeof Game.schema>
const id = 1 as Id

const Enemies = Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Enemy] })
const Positions = Game.Query({ selection: { position: Game.Query.read(Position) } })

describe("declared commands", () => {
  it("infers the permissions a system declares", () => {
    expect(Game.System.commands(Game.System.spawns(Position, Enemy), Game.System.despawns(Enemy))).type.toBe<
      Command.CommandAccess<typeof Position | typeof Enemy, never, never, typeof Enemy>
    >()
  })

  it("has no commands without a declaration, and names the fix", () => {
    Game.System("Perms/Undeclared", {}, ({ commands }) => {
      // @ts-expect-error commands are not declared for this system: add commands: Game.System.commands(...) to its spec
      commands.spawn(Game.Command.spawn([Position, { x: 0 }]))
    })
  })

  it("spawns drafts whose components are all declared, however they were built", () => {
    Game.System("Perms/Spawn", {
      commands: Game.System.commands(Game.System.spawns(Position, Enemy))
    }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Position, { x: 0 }], [Enemy, {}]))
      commands.spawnIn(Level, Game.Command.extend(Game.Command.spawn([Position, { x: 0 }]), [Enemy, {}]))
      // @ts-expect-error Perms/Noise is not declared in this system's commands: add it to Game.System.spawns(...)
      commands.spawn(Game.Command.spawn([Position, { x: 0 }], [Noise, 1]))
      // @ts-expect-error Perms/Noise is not declared in this system's commands: add it to Game.System.spawns(...)
      commands.spawn(Game.Command.extend(Game.Command.spawn([Position, { x: 0 }]), [Noise, 1]))
      // @ts-expect-error Perms/Noise is not declared in this system's commands: add it to Game.System.spawns(...)
      commands.spawnIn(Level, Game.Command.spawn([Noise, 1]))
    })
  })

  it("keeps a draft's components precise when built from a widened array or a conditional entry", () => {
    Game.System("Perms/Dynamic", {
      commands: Game.System.commands(Game.System.spawns(Position, Enemy))
    }, ({ commands }) => {
      const allowed: Array<readonly [typeof Position, { readonly x: number }] | readonly [typeof Enemy, {}]> = []
      commands.spawn(Game.Command.spawn(...allowed))
      const mixed: Array<readonly [typeof Position, { readonly x: number }] | readonly [typeof Noise, number]> = []
      // @ts-expect-error Perms/Noise is not declared in this system's commands: add it to Game.System.spawns(...)
      commands.spawn(Game.Command.spawn(...mixed))
      const loud = Math.random() > 0.5
      // @ts-expect-error Perms/Noise is not declared in this system's commands: add it to Game.System.spawns(...)
      commands.spawn(Game.Command.spawn([Position, { x: 0 }], loud ? [Noise, 1] : [Enemy, {}]))
      commands.spawn(Game.Command.spawn([Position, { x: 0 }], loud ? [Enemy, {}] : [Position, { x: 1 }]))
    })
  })

  it("names the missing permission for a method not declared", () => {
    Game.System("Perms/OnlySpawns", { commands: Game.System.commands(Game.System.spawns(Position)) }, ({ commands }) => {
      // @ts-expect-error insert is not declared in this system's commands: add Game.System.inserts(...) to Game.System.commands(...)
      commands.insert(id, [Position, { x: 1 }])
      // @ts-expect-error despawn is not declared in this system's commands: add Game.System.despawns(...)
      commands.despawn(id)
      // @ts-expect-error relate is not declared in this system's commands: add Game.System.relates(...)
      commands.relate(id, ChildOf, id)
    })
  })

  it("inserts and removes only the declared components", () => {
    Game.System("Perms/InsertRemove", {
      queries: { positions: Positions },
      commands: Game.System.commands(Game.System.inserts(Turned), Game.System.removes(Turned))
    }, ({ queries, commands }) => {
      commands.insert(id, [Turned, { seconds: 1 }])
      // @ts-expect-error Perms/Noise is not declared in this system's commands: add it to Game.System.inserts(...)
      commands.insert(id, [Turned, { seconds: 1 }], [Noise, 2])
      for (const match of queries.positions.each()) {
        commands.insert(match.entity, [Turned, { seconds: 1 }])
        commands.remove(match.entity, Turned)
        // @ts-expect-error Perms/Position is not declared in this system's commands: add it to Game.System.removes(...)
        commands.remove(match.entity, Position)
      }
    })
  })

  it("removes only from a query match or a spawned id, never a raw id", () => {
    Game.System("Perms/RemoveTarget", {
      queries: { positions: Positions },
      commands: Game.System.commands(Game.System.spawns(Turned), Game.System.removes(Turned))
    }, ({ queries, commands }) => {
      const spawned = commands.spawn(Game.Command.spawn([Turned, { seconds: 1 }]))
      commands.remove(spawned, Turned)
      for (const match of queries.positions.each()) {
        commands.remove(match.entity, Turned)
        // @ts-expect-error remove needs an entity from a query (pass match.entity) or the id spawn returned in this run, not a raw id
        commands.remove(match.entity.id, Turned)
      }
      // @ts-expect-error remove needs an entity from a query (pass match.entity)
      commands.remove(id, Turned)
    })
  })

  it("despawns only entities a query proves are of a declared kind, never raw ids", () => {
    Game.System("Perms/Despawn", {
      queries: { enemies: Enemies, positions: Positions },
      commands: Game.System.commands(Game.System.despawns(Enemy))
    }, ({ queries, commands }) => {
      for (const match of queries.enemies.each()) commands.despawn(match.entity)
      for (const match of queries.positions.each()) {
        // @ts-expect-error despawn needs an entity from a query proving Perms/Enemy (declared in despawns)
        commands.despawn(match.entity)
        // @ts-expect-error not a raw id: pass match.entity
        commands.despawn(match.entity.id)
      }
    })
  })

  it("keeps an inline query's proof exact: an omitted with proves nothing more", () => {
    Game.System("Perms/DespawnInline", {
      queries: { positions: Game.Query({ selection: { position: Game.Query.read(Position) } }) },
      commands: Game.System.commands(Game.System.despawns(Enemy))
    }, ({ queries, commands }) => {
      for (const match of queries.positions.each()) {
        // @ts-expect-error despawn needs an entity from a query proving Perms/Enemy (declared in despawns)
        commands.despawn(match.entity)
      }
    })
    const inline = Game.Query({ selection: { position: Game.Query.read(Position) } })
    expect(inline.with).type.toBe<[]>()
  })

  it("despawns an entity this run spawned, by the components its draft always holds", () => {
    Game.System("Perms/DespawnSpawned", {
      commands: Game.System.commands(Game.System.spawns(Position, Enemy, Noise), Game.System.despawns(Enemy))
    }, ({ commands }) => {
      const enemy = commands.spawn(Game.Command.spawn([Position, { x: 0 }], [Enemy, {}]))
      expect(enemy).type.toBeAssignableTo<Id>()
      commands.despawn(enemy)
      const plain = commands.spawn(Game.Command.spawn([Position, { x: 0 }]))
      // @ts-expect-error despawn needs an entity spawned with Perms/Enemy (declared in despawns)
      commands.despawn(plain)
      const loud = Math.random() > 0.5
      const maybe = commands.spawn(Game.Command.spawn([Position, { x: 0 }], loud ? [Enemy, {}] : [Noise, 1]))
      // @ts-expect-error despawn needs an entity spawned with Perms/Enemy (declared in despawns)
      commands.despawn(maybe)
      const stored: Id = enemy
      // @ts-expect-error not a raw id: pass match.entity
      commands.despawn(stored)
    })
  })

  it("despawns only the declared scope, and relates only the declared relations", () => {
    Game.System("Perms/Scope", {
      commands: Game.System.commands(Game.System.despawnsScope(Level), Game.System.relates(ChildOf))
    }, ({ commands }) => {
      commands.despawnScope(Level)
      commands.relate(id, ChildOf, id)
      commands.reorderChildren(id, ChildOf, [id])
      // @ts-expect-error Argument of type 'EntityScope<"Perms/Menu"
      commands.despawnScope(Menu)
    })
  })

  it("needs relates for the relations a spawned draft stages", () => {
    Game.System("Perms/SpawnChildUndeclared", {
      commands: Game.System.commands(Game.System.spawns(Position))
    }, ({ commands }) => {
      const child = Game.Command.relate(Game.Command.spawn([Position, { x: 0 }]), ChildOf, id)
      expect(child).type.toBe<Entity.EntityDraft<typeof Game.schema, { readonly "Perms/Position": { readonly x: number } }, typeof Game.schema, typeof ChildOf>>()
      // @ts-expect-error Perms/ChildOf is related by this draft but not declared in this system's commands: add it to Game.System.relates(...)
      commands.spawn(child)
      // @ts-expect-error Perms/ChildOf is related by this draft
      commands.spawnIn(Level, child)
      // A draft that stages no relation needs no relates.
      commands.spawn(Game.Command.spawn([Position, { x: 0 }]))
    })
    Game.System("Perms/SpawnChild", {
      commands: Game.System.commands(Game.System.spawns(Position, Noise), Game.System.relates(ChildOf))
    }, ({ commands }) => {
      const child = Game.Command.relate(Game.Command.spawn([Position, { x: 0 }]), ChildOf, id)
      commands.spawn(child)
      commands.spawnIn(Level, Game.Command.extend(child, [Noise, 1]))
    })
  })

  it("needs at least one component or relation in a permission", () => {
    // @ts-expect-error Expected at least 1 arguments, but got 0
    Game.System.spawns()
    // @ts-expect-error Expected at least 1 arguments, but got 0
    Game.System.inserts()
    // @ts-expect-error Expected at least 1 arguments, but got 0
    Game.System.relates()
    const Parts = [Position, Noise] as const
    expect(Game.System.removes(...Parts)).type.toBe<Command.Permission<"removes", typeof Position | typeof Noise>>()
  })

  it("accepts only the game's own components in permissions", () => {
    const Foreign = Descriptor.Component<number>()("Perms/Foreign")
    expect(Game.System.spawns).type.not.toBeCallableWith(Foreign)
    expect(Game.System.spawns).type.toBeCallableWith(Position)
  })
})
