import { Descriptor, Schema } from "@typeonce/ritmo"
import type * as Command from "@typeonce/ritmo/Command"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ readonly x: number }>()("Req/Position")
const Velocity = Descriptor.Component<{ readonly x: number }>()("Req/Velocity")
const Body = Descriptor.Component<{}>()("Req/Body")
const Player = Descriptor.Component<{}>()("Req/Player")
const Noise = Descriptor.Component<number>()("Req/Noise")
const A = Descriptor.Component<{}>()("Req/A")
const B = Descriptor.Component<{}>()("Req/B")

const Core = Schema.fragment({ components: { Position, Velocity, Body, Noise, A, B } })
// Cross-fragment: Gameplay requires components registered by Core.
const Gameplay = Schema.fragment({
  components: { Player },
  requires: [
    Schema.requires(Player, Body, Velocity),
    Schema.requires(Body, Position),
    Schema.requires(A, B),
    Schema.requires(B, A)
  ]
})
const Game = Schema.bind(Core, Gameplay)

describe("Schema.requires", () => {
  it("carries one pair per required component", () => {
    expect(Schema.requires(Player, Body, Velocity)).type.toBe<
      Schema.ComponentRequirement<readonly ["Req/Player", "Req/Body"] | readonly ["Req/Player", "Req/Velocity"]>
    >()
    expect<Schema.Schema.Requires<typeof Gameplay>>().type.toBe<
      | readonly ["Req/Player", "Req/Body"]
      | readonly ["Req/Player", "Req/Velocity"]
      | readonly ["Req/Body", "Req/Position"]
      | readonly ["Req/A", "Req/B"]
      | readonly ["Req/B", "Req/A"]
    >()
  })

  it("needs at least one required component", () => {
    // @ts-expect-error Expected at least 2 arguments, but got 1
    Schema.requires(Player)
  })

  it("rejects a requirement naming a component no fragment registers", () => {
    const Lonely = Schema.fragment({ components: { Player }, requires: [Schema.requires(Player, Position)] })
    // @ts-expect-error Req/Position is named in Schema.requires(...) but no fragment registers it: add it to a fragment's components
    Schema.bind(Lonely)
  })

  it("rejects a saved component requiring a transient one", () => {
    const Trail = Descriptor.TransientComponent<number>()("Req/Trail")
    const Ghost = Descriptor.Component<{}>()("Req/Ghost")
    const Shade = Descriptor.TransientComponent<{}>()("Req/Shade")
    // @ts-expect-error Req/Ghost requires Req/Trail, which is transient and not saved: make Req/Ghost transient too
    Schema.bind(Schema.fragment({ components: { Ghost, Trail }, requires: [Schema.requires(Ghost, Trail)] }))
    const Shades = Schema.bind(Schema.fragment({ components: { Shade, Trail }, requires: [Schema.requires(Shade, Trail)] }))
    expect<Schema.Schema.Requires<typeof Shades.schema>>().type.toBe<readonly ["Req/Shade", "Req/Trail"]>()
  })

  it("expands spawns(...) to the transitive required set", () => {
    expect(Game.System.spawns(Player)).type.toBe<
      Command.Permission<"spawns", typeof Player | typeof Body | typeof Velocity | typeof Position>
    >()
    expect(Game.System.spawns(Noise)).type.toBe<Command.Permission<"spawns", typeof Noise>>()
    // a cycle terminates
    expect(Game.System.spawns(A)).type.toBe<Command.Permission<"spawns", typeof A | typeof B>>()
  })

  it("reports a missing import next to a requiring component as only that missing name", () => {
    // The expansion must not recurse on the unresolved name: an excessive-depth error
    // would be reported on the call's first line, which nothing here suppresses.
    Game.System.spawns(
      Player,
      // @ts-expect-error Cannot find name 'Missing'
      Missing
    )
  })
})

describe("commands.spawn with requirements", () => {
  it("checks drafts at commands.spawn, not while they are built", () => {
    Game.System("Req/Spawn", { commands: Game.System.commands(Game.System.spawns(Player, Noise, A)) }, ({ commands }) => {
      // A partial draft is a legal value.
      const partial = Game.Command.spawn([Player, {}])
      commands.spawn(Game.Command.extend(partial, [Body, {}], [Velocity, { x: 0 }], [Position, { x: 0 }]))
      // @ts-expect-error Req/Player requires Req/Velocity: add the missing entries to the draft
      commands.spawn(Game.Command.spawn([Player, {}], [Body, {}], [Position, { x: 0 }]))
      // transitive: Body is present but its own requirement is not
      // @ts-expect-error Req/Body requires Req/Position
      commands.spawnIn(Game.EntityScope("Req/Level"), Game.Command.spawn([Player, {}], [Body, {}], [Velocity, { x: 0 }]))
      // a cycle means both or neither
      commands.spawn(Game.Command.spawn([A, {}], [B, {}]))
      // @ts-expect-error Req/A requires Req/B
      commands.spawn(Game.Command.spawn([A, {}]))
      // components without requirements spawn alone
      commands.spawn(Game.Command.spawn([Noise, 1]))
    })
  })

  it("treats a conditional required entry as missing", () => {
    Game.System("Req/SpawnMaybe", { commands: Game.System.commands(Game.System.spawns(Player, Noise)) }, ({ commands }) => {
      const maybe = Math.random() > 0.5
      // @ts-expect-error Req/Player requires Req/Velocity
      commands.spawn(Game.Command.spawn([Player, {}], [Body, {}], [Position, { x: 0 }], maybe ? [Velocity, { x: 0 }] : [Noise, 1]))
    })
  })

  it("checks a component the draft may hold, conditional or spread, against what it surely holds", () => {
    Game.System("Req/SpawnMaybeRequirer", { commands: Game.System.commands(Game.System.spawns(Player, Noise, A)) }, ({ commands }) => {
      const maybe = Math.random() > 0.5
      // A conditional requirer whose requirements are all there.
      commands.spawn(Game.Command.spawn([Body, {}], [Velocity, { x: 0 }], [Position, { x: 0 }], maybe ? [Player, {}] : [Noise, 1]))
      // A conditional requirer whose requirement is not.
      // @ts-expect-error Req/A requires Req/B
      commands.spawn(Game.Command.spawn([Noise, 1], maybe ? [A, {}] : [Noise, 2]))
      // Spread entries: each one may be there.
      const players: Array<readonly [typeof Player, {}]> = [[Player, {}]]
      // @ts-expect-error Req/Player requires Req/Body
      commands.spawn(Game.Command.spawn(...players))
      commands.spawn(Game.Command.spawn([Body, {}], [Velocity, { x: 0 }], [Position, { x: 0 }], ...players))
      const noises: Array<readonly [typeof Noise, number]> = [[Noise, 1]]
      commands.spawn(Game.Command.spawn(...noises))
    })
  })

  it("returns the id with what the draft holds", () => {
    Game.System("Req/SpawnId", { commands: Game.System.commands(Game.System.spawns(Player)) }, ({ commands }) => {
      const id = commands.spawn(Game.Command.spawn([Player, {}], [Body, {}], [Velocity, { x: 0 }], [Position, { x: 0 }]))
      expect(id).type.toBe<Command.SpawnedId<typeof Game.schema, typeof Game.schema, "Req/Player" | "Req/Body" | "Req/Velocity" | "Req/Position">>()
    })
  })
})

const Bodies = Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Body] })
const Players = Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Player, Body, Velocity] })
const MaybeBody = Game.Query({ selection: { position: Game.Query.read(Position), body: Game.Query.optional(Body) } })

describe("commands.insert with requirements", () => {
  it("checks inserts against the target's proof plus the inserted entries", () => {
    Game.System("Req/Insert", {
      queries: { bodies: Bodies, maybe: MaybeBody },
      commands: Game.System.commands(Game.System.inserts(Player, Velocity, Noise))
    }, ({ queries, commands }) => {
      for (const entity of queries.bodies.each()) {
        expect(commands.insert(entity, [Player, {}], [Velocity, { x: 0 }])).type.toBe<typeof entity.id>()
        // @ts-expect-error Req/Player requires Req/Velocity: insert it in the same call, or pass an entity from a query that proves it
        commands.insert(entity, [Player, {}])
        // a raw id proves nothing
        // @ts-expect-error Req/Player requires Req/Body
        commands.insert(entity.id, [Player, {}], [Velocity, { x: 0 }])
        // components without requirements still take raw ids
        commands.insert(entity.id, [Noise, 1])
      }
      for (const entity of queries.maybe.each()) {
        // optional(Body) does not prove Body
        // @ts-expect-error Req/Player requires Req/Body
        commands.insert(entity, [Player, {}], [Velocity, { x: 0 }])
      }
    })
  })

  it("counts spread entries as maybe inserted", () => {
    Game.System("Req/InsertSpread", {
      queries: { bodies: Bodies },
      commands: Game.System.commands(Game.System.inserts(Player, Velocity, Noise))
    }, ({ queries, commands }) => {
      const parts: Array<readonly [typeof Player, {}] | readonly [typeof Velocity, { readonly x: number }]> = [[Player, {}]]
      const noises: Array<readonly [typeof Noise, number]> = [[Noise, 1]]
      for (const entity of queries.bodies.each()) {
        // Velocity may be among the parts, or not.
        // @ts-expect-error Req/Player requires Req/Velocity
        commands.insert(entity, ...parts)
        commands.insert(entity, [Velocity, { x: 0 }], ...parts)
        commands.insert(entity.id, ...noises)
      }
    })
  })

  it("lets the id spawn returned prove its draft", () => {
    Game.System("Req/InsertSpawned", {
      commands: Game.System.commands(Game.System.spawns(Body), Game.System.inserts(Player, Velocity))
    }, ({ commands }) => {
      const body = commands.spawn(Game.Command.spawn([Body, {}], [Position, { x: 0 }]))
      commands.insert(body, [Player, {}], [Velocity, { x: 0 }])
    })
  })
})

describe("commands.remove with requirements", () => {
  it("rejects removing a component the target may still need", () => {
    Game.System("Req/Remove", {
      queries: {
        players: Players,
        moving: Game.Query({ selection: { velocity: Game.Query.read(Velocity) } }),
        notPlayers: Game.Query({ selection: { velocity: Game.Query.read(Velocity) }, without: [Player] })
      },
      commands: Game.System.commands(Game.System.removes(Velocity, Noise, Player))
    }, ({ queries, commands }) => {
      for (const match of queries.players.each()) {
        // @ts-expect-error Req/Velocity is required by Req/Player: remove Req/Player in the same call, or match the entity with a query that has without: [Req/Player]
        commands.remove(match, Velocity)
        commands.remove(match, Noise)
        commands.remove(match, Player)
        expect(commands.remove(match, Player, Velocity)).type.toBe<typeof match.id>()
      }
      // The query proves Velocity but not Player: the entity may still hold Player.
      for (const entity of queries.moving.each()) {
        // @ts-expect-error Req/Velocity is required by Req/Player
        commands.remove(entity, Velocity)
      }
      // without: [Player] proves Player is absent.
      for (const entity of queries.notPlayers.each()) {
        commands.remove(entity, Velocity)
      }
    })
  })

  it("removes from the id spawn returned, as from a match", () => {
    Game.System("Req/RemoveSpawned", {
      commands: Game.System.commands(Game.System.spawns(Noise, Velocity), Game.System.removes(Noise, Velocity))
    }, ({ commands }) => {
      const spawned = commands.spawn(Game.Command.spawn([Noise, 1], [Velocity, { x: 0 }]))
      commands.remove(spawned, Noise)
      // the entity may gain Player before this applies: only a query's without proves it absent
      // @ts-expect-error Req/Velocity is required by Req/Player
      commands.remove(spawned, Velocity)
    })
  })
})

declare const either: boolean

describe("command targets chosen from several queries", () => {
  it("checks every possible target, not just one of them", () => {
    Game.System("Req/UnionTargets", {
      queries: {
        bodies: Bodies,
        players: Players,
        moving: Game.Query({ selection: { velocity: Game.Query.read(Velocity) } }),
        notPlayers: Game.Query({ selection: { velocity: Game.Query.read(Velocity) }, without: [Player] }),
        alsoNotPlayers: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Velocity], without: [Player] }),
        noisy: Game.Query({ selection: { noise: Game.Query.read(Noise) } }),
        alsoNoisy: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Noise] })
      },
      commands: Game.System.commands(Game.System.inserts(Player, Velocity), Game.System.removes(Velocity), Game.System.despawns(Noise))
    }, ({ queries, commands }) => {
      const body = queries.bodies.each()[0]!
      const player = queries.players.each()[0]!
      const moving = queries.moving.each()[0]!
      const notPlayer = queries.notPlayers.each()[0]!
      const alsoNotPlayer = queries.alsoNotPlayers.each()[0]!
      const noisy = queries.noisy.each()[0]!
      const alsoNoisy = queries.alsoNoisy.each()[0]!

      // insert: only what every target proves counts.
      commands.insert(either ? body : player, [Player, {}], [Velocity, { x: 0 }])
      // @ts-expect-error Req/Player requires Req/Body
      commands.insert(either ? body : moving, [Player, {}], [Velocity, { x: 0 }])
      // players proves Velocity, bodies does not: a weaker proof is not absorbed by a stronger one.
      // @ts-expect-error Req/Player requires Req/Velocity
      commands.insert(either ? body : player, [Player, {}])

      // despawn: every target must prove a despawns component, and none may be a raw id.
      commands.despawn(either ? noisy : alsoNoisy)
      // @ts-expect-error despawn needs an entity from a query proving Req/Noise (declared in despawns)
      commands.despawn(either ? noisy : moving)
      // @ts-expect-error not a raw id: pass the entity from each()
      commands.despawn(either ? noisy : noisy.id)

      // remove: only what every target's query excludes counts as absent, and none may be a raw id.
      commands.remove(either ? notPlayer : alsoNotPlayer, Velocity)
      // @ts-expect-error Req/Velocity is required by Req/Player
      commands.remove(either ? notPlayer : moving, Velocity)
      // @ts-expect-error remove needs an entity from a query (pass the entity from each()) or the id spawn returned in this run, not a raw id
      commands.remove(either ? notPlayer : notPlayer.id, Velocity)
    })
  })
})
