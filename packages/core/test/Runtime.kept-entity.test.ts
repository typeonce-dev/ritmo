import { describe, expect, it } from "vitest"
import type { QueryEntity } from "@typeonce/ritmo/Query"
import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"

const Position = Descriptor.Component<{ readonly x: number }>()("Kept/Position")
const Dead = Descriptor.Tag("Kept/Dead")
const Enemy = Descriptor.Tag("Kept/Enemy")
const Game = Schema.bind(Schema.fragment({ components: { Position, Dead, Enemy } }))

const make = (debug: boolean) => {
  const made = Game.Runtime.make({ services: Game.Runtime.services(), ...(debug ? { debug: { hostClock: HostClock.test() } } : {}) })
  if (!made.ok) throw new Error("runtime")
  return made.value
}

const spawn = Game.Schedule(
  Game.System("Kept/Spawn", { commands: Game.System.commands(Game.System.spawns(Position, Enemy)) }, ({ commands }) => {
    commands.spawn(Game.Command.spawn([Position, { x: 1 }], [Enemy, {}]))
    commands.spawn(Game.Command.spawn([Position, { x: 2 }], [Enemy, {}]))
  }),
  Game.Schedule.applyDeferred()
)

const Living = Game.Query({ selection: { position: Game.Query.read(Position) }, without: [Dead] })
const Enemies = Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Enemy] })

/** Keeps the first living entity in `local` and reads it on every later run. */
const homing = (outcomes: Array<string>) => Game.System("Kept/Homing", {
  queries: { living: Living },
  local: () => ({ target: undefined as QueryEntity<typeof Game.schema, typeof Living> | undefined })
}, ({ queries, local }) => {
  if (local.target === undefined) {
    local.target = queries.living.each()[0]
    return
  }
  try {
    outcomes.push(String(queries.living.data.position.get(local.target).x))
  } catch (error) {
    outcomes.push((error as Error).message)
  }
})

const kill = Game.Schedule(
  Game.System("Kept/Kill", {
    queries: { all: Game.Query({ selection: { position: Game.Query.read(Position) } }) },
    commands: Game.System.commands(Game.System.inserts(Dead))
  }, ({ queries, commands }) => {
    commands.insert(queries.all.each()[0]!, [Dead, {}])
  }),
  Game.Schedule.applyDeferred()
)

const stale = "Kept/Homing used Kept/Position of entity 1, which matches none of its queries: an entity kept from an earlier run is not checked against its query again. "
  + "Keep entity.id and resolve it with queries.x.get(id) in each run, which is fallible"

describe("an entity kept past its run, on a debug runtime", () => {
  it("throws once it has left the query through without", () => {
    const runtime = make(true)
    const outcomes: Array<string> = []
    const system = Game.Schedule(homing(outcomes))
    runtime.tick(spawn)
    runtime.tick(system)
    runtime.tick(system)
    runtime.tick(kill)
    runtime.tick(system)

    expect(outcomes).toEqual(["1", stale])
  })

  it("is read without a check on a runtime without debug", () => {
    const runtime = make(false)
    const outcomes: Array<string> = []
    const system = Game.Schedule(homing(outcomes))
    runtime.tick(spawn)
    runtime.tick(system)
    runtime.tick(kill)
    runtime.tick(system)

    expect(outcomes).toEqual(["1"])
  })

  it("throws once it has left through with", () => {
    const runtime = make(true)
    const outcomes: Array<string> = []
    const Track = Game.System("Kept/Track", {
      queries: { enemies: Enemies },
      local: () => ({ target: undefined as QueryEntity<typeof Game.schema, typeof Enemies> | undefined })
    }, ({ queries, local }) => {
      if (local.target === undefined) {
        local.target = queries.enemies.each()[0]
        return
      }
      try {
        outcomes.push(String(queries.enemies.data.position.get(local.target).x))
      } catch (error) {
        outcomes.push((error as Error).message.split(":")[0]!)
      }
    })
    const Calm = Game.System("Kept/Calm", {
      queries: { enemies: Enemies },
      commands: Game.System.commands(Game.System.removes(Enemy))
    }, ({ queries, commands }) => {
      commands.remove(queries.enemies.each()[0]!, Enemy)
    })
    runtime.tick(spawn)
    runtime.tick(Game.Schedule(Track))
    runtime.tick(Game.Schedule(Calm, Game.Schedule.applyDeferred()))
    runtime.tick(Game.Schedule(Track))

    expect(outcomes).toEqual(["Kept/Track used Kept/Position of entity 1, which matches none of its queries"])
  })

  it("keeps the more specific error of a despawned entity", () => {
    const runtime = make(true)
    const outcomes: Array<string> = []
    const system = Game.Schedule(homing(outcomes))
    runtime.tick(spawn)
    runtime.tick(system)
    runtime.tick(Game.Schedule(
      Game.System("Kept/Despawn", {
        queries: { all: Game.Query({ selection: { position: Game.Query.read(Position) } }) },
        commands: Game.System.commands(Game.System.despawns(Position))
      }, ({ queries, commands }) => {
        commands.despawn(queries.all.each()[0]!)
      }),
      Game.Schedule.applyDeferred()
    ))
    runtime.tick(system)

    expect(outcomes.map((outcome) => outcome.split(":")[0])).toEqual(["Kept/Position was used for an entity that was despawned"])
  })

  it("reads an entity from another of the system's queries, in the same run", () => {
    const runtime = make(true)
    runtime.tick(spawn)
    runtime.tick(kill)
    const Cross = Game.Inspector("Kept/Cross", { queries: { living: Living, enemies: Enemies } }, ({ queries }) =>
      queries.enemies.each().map((entity) => queries.living.data.position.get(entity).x))

    expect(runtime.inspect(Cross)).toEqual([1, 2])
  })
})
