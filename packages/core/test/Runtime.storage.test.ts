import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"
import type * as Entity from "@typeonce/ritmo/Entity"

const Position = Descriptor.Component<{ x: number }>()("Storage/Position")
const Tag = Descriptor.Component<{}>()("Storage/Tag")
const Log = Descriptor.Resource<ReadonlyArray<string>>()("Storage/Log")
const { relation: ChildOf } = Descriptor.Hierarchy("Storage/ChildOf", "Storage/Children")

const Game = Schema.bind(Schema.fragment({
  components: { Position, Tag },
  resources: { Log },
  relations: { ChildOf }
}))

type Id = Entity.EntityId<typeof Game.schema, typeof Game.schema>

const makeRuntime = () => Game.Runtime.make({
  services: Game.Runtime.services(),
  resources: { Log: [] }
}).success

const Positions = Game.Query({ selection: { position: Game.Query.write(Position) } })
const Tagged = Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Tag] })

const ReadLog = (sink: { value: ReadonlyArray<string> }) => Game.System("Storage/ReadLog", {
  resources: { log: Game.System.readResource(Log) }
}, ({ resources }) => {
  sink.value = resources.log.get()
})

describe("Runtime storage", () => {
  it("keeps queued commands pending across schedule runs until applyDeferred()", () => {
    const ids: Array<Id> = []
    const Spawn = Game.System("Storage/Spawn", {
      commands: Game.System.commands(Game.System.spawns(Position))
    }, ({ commands }) => {
      ids.push(commands.spawn(Game.Command.spawn([Position, { x: 1 }])))
    })
    const counts: Array<number> = []
    const Count = Game.System("Storage/Count", { queries: { positions: Positions } }, ({ queries }) => {
      counts.push(queries.positions.each().length)
    })

    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(Spawn))
    runtime.tick(Game.Schedule(Count))
    runtime.tick(Game.Schedule(Game.Schedule.applyDeferred(), Count))

    expect(counts).toEqual([0, 1])
  })

  it("returns matches in spawn order even when components are added out of order", () => {
    const ids: Array<Id> = []
    const Spawn = Game.System("Storage/SpawnMany", {
      commands: Game.System.commands(Game.System.spawns(Position))
    }, ({ commands }) => {
      for (let index = 0; index < 5; index++) {
        ids.push(commands.spawn(Game.Command.spawn([Position, { x: index }])))
      }
    })
    const TagReversed = Game.System("Storage/TagReversed", {
      commands: Game.System.commands(Game.System.inserts(Tag))
    }, ({ commands }) => {
      for (const id of [...ids].reverse()) {
        commands.insert(id, [Tag, {}])
      }
    })
    let seen: Array<number> = []
    const Observe = Game.System("Storage/ObserveOrder", { queries: { tagged: Tagged } }, ({ queries }) => {
      seen = queries.tagged.each().map((match) => match.data.position.get().x)
    })

    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), TagReversed, Game.Schedule.applyDeferred(), Observe))

    expect(seen).toEqual([0, 1, 2, 3, 4])
  })

  it("reuses matches across runs while cells and proofs read live values", () => {
    const Spawn = Game.System("Storage/SpawnOne", {
      commands: Game.System.commands(Game.System.spawns(Position))
    }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Position, { x: 0 }]))
    })
    const matches: Array<unknown> = []
    const values: Array<number> = []
    const Step = Game.System("Storage/Step", { queries: { positions: Positions } }, ({ queries }) => {
      for (const match of queries.positions.each()) {
        matches.push(match)
        values.push(match.entity.proof.position.x)
        match.data.position.update((position) => ({ x: position.x + 1 }))
      }
    })

    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
    const step = Game.Schedule(Step)
    runtime.tick(step)
    runtime.tick(step)
    runtime.tick(step)

    expect(values).toEqual([0, 1, 2])
    expect(matches[0]).toBe(matches[2])
  })

  it("ignores commands addressed to entities despawned earlier in the same flush", () => {
    let target: Id | undefined
    const Spawn = Game.System("Storage/SpawnTarget", {
      commands: Game.System.commands(Game.System.spawns(Position))
    }, ({ commands }) => {
      target = commands.spawn(Game.Command.spawn([Position, { x: 1 }]))
    })
    const DespawnThenInsert = Game.System("Storage/DespawnThenInsert", {
      queries: { positions: Positions },
      commands: Game.System.commands(Game.System.despawns(Position), Game.System.inserts(Tag))
    }, ({ queries, commands }) => {
      const match = queries.positions.get(target!)
      if (match._tag === "Success") commands.despawn(match.success.entity)
      commands.insert(target!, [Tag, {}])
    })
    let found = true
    const Lookup = Game.System("Storage/LookupTarget", {
      queries: { tagged: Game.Query({ selection: { tag: Game.Query.read(Tag) } }) }
    }, ({ queries }) => {
      found = queries.tagged.get(target!)._tag === "Success"
    })

    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(
      Spawn,
      Game.Schedule.applyDeferred(),
      DespawnThenInsert,
      Game.Schedule.applyDeferred(),
      Lookup
    ))

    expect(found).toBe(false)
  })

  it("keeps staged relations when components are inserted after relate()", () => {
    let parent: Id | undefined
    const SpawnParent = Game.System("Storage/SpawnParent", {
      commands: Game.System.commands(Game.System.spawns(Position))
    }, ({ commands }) => {
      parent = commands.spawn(Game.Command.spawn([Position, { x: 0 }]))
    })
    const SpawnChild = Game.System("Storage/SpawnChild", {
      commands: Game.System.commands(Game.System.spawns(Tag), Game.System.relates(ChildOf))
    }, ({ commands }) => {
      const draft = Game.Command.extend(Game.Command.relate(Game.Command.spawn(), ChildOf, parent!), [Tag, {}])
      commands.spawn(draft)
    })
    let children = -1
    const Count = Game.System("Storage/CountChildren", {}, ({ lookup }) => {
      const result = lookup.relatedSources(parent!, ChildOf)
      children = result._tag === "Success" ? result.success.length : -1
    })

    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(
      SpawnParent,
      Game.Schedule.applyDeferred(),
      SpawnChild,
      Game.Schedule.applyDeferred(),
      Count
    ))

    expect(children).toBe(1)
  })

  it("runs distinct systems that share a display name", () => {
    const append = (entry: string) => Game.System("Storage/Same", {
      resources: { log: Game.System.writeResource(Log) }
    }, ({ resources }) => {
      resources.log.update((log) => [...log, entry])
    })
    const sink = { value: [] as ReadonlyArray<string> }

    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(append("first"), append("second"), ReadLog(sink)))

    expect(sink.value).toEqual(["first", "second"])
  })

  it("rejects the same system value twice in one schedule", () => {
    const Once = Game.System("Storage/Once", {}, () => {})
    expect(() => Game.Schedule(Once, Once)).toThrow("Duplicate system step in schedule: Storage/Once")
  })

  it("guards duplicate descriptor names when types are erased", () => {
    const Other = Descriptor.Component<{ x: number }>()("Storage/Position")
    const bindErased = Schema.bind as (...fragments: ReadonlyArray<Schema.Schema.Any>) => unknown
    expect(() => bindErased(
      Schema.fragment({ components: { Position } }),
      Schema.fragment({ components: { Other } })
    )).toThrow("Duplicate descriptor name: Storage/Position")
  })
})
