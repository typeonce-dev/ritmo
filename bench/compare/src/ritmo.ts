import { Descriptor, Schema } from "@typeonce/ritmo"
import type { Library } from "./cases.ts"

// Ritmo runs every case as a game would: declared systems in a schedule, one
// `runtime.tick(...)` per operation, commands landing at `applyDeferred()`.
const A = Descriptor.Component<number>()("Bench/A")
const B = Descriptor.Component<number>()("Bench/B")
const C = Descriptor.Component<number>()("Bench/C")
const D = Descriptor.Component<number>()("Bench/D")
const E = Descriptor.Component<number>()("Bench/E")
const Data = Descriptor.Component<number>()("Bench/Data")

// frag_iter's 26 shapes: one tag each, plus Data
const Tags = {
  TagA: Descriptor.Component<{}>()("Bench/TagA"),
  TagB: Descriptor.Component<{}>()("Bench/TagB"),
  TagC: Descriptor.Component<{}>()("Bench/TagC"),
  TagD: Descriptor.Component<{}>()("Bench/TagD"),
  TagE: Descriptor.Component<{}>()("Bench/TagE"),
  TagF: Descriptor.Component<{}>()("Bench/TagF"),
  TagG: Descriptor.Component<{}>()("Bench/TagG"),
  TagH: Descriptor.Component<{}>()("Bench/TagH"),
  TagI: Descriptor.Component<{}>()("Bench/TagI"),
  TagJ: Descriptor.Component<{}>()("Bench/TagJ"),
  TagK: Descriptor.Component<{}>()("Bench/TagK"),
  TagL: Descriptor.Component<{}>()("Bench/TagL"),
  TagM: Descriptor.Component<{}>()("Bench/TagM"),
  TagN: Descriptor.Component<{}>()("Bench/TagN"),
  TagO: Descriptor.Component<{}>()("Bench/TagO"),
  TagP: Descriptor.Component<{}>()("Bench/TagP"),
  TagQ: Descriptor.Component<{}>()("Bench/TagQ"),
  TagR: Descriptor.Component<{}>()("Bench/TagR"),
  TagS: Descriptor.Component<{}>()("Bench/TagS"),
  TagT: Descriptor.Component<{}>()("Bench/TagT"),
  TagU: Descriptor.Component<{}>()("Bench/TagU"),
  TagV: Descriptor.Component<{}>()("Bench/TagV"),
  TagW: Descriptor.Component<{}>()("Bench/TagW"),
  TagX: Descriptor.Component<{}>()("Bench/TagX"),
  TagY: Descriptor.Component<{}>()("Bench/TagY"),
  TagZ: Descriptor.Component<{}>()("Bench/TagZ"),
}

const Position = Descriptor.Component<{ readonly x: number; readonly y: number }>()("Bench/Position")
const Velocity = Descriptor.Component<{ readonly x: number; readonly y: number }>()("Bench/Velocity")

const Root = Schema.defineRoot("Bench")
const Game = Schema.bind(Schema.fragment({ components: { A, B, C, D, E, Data, Position, Velocity, ...Tags } }), Root)

const runtime = () => {
  const made = Game.Runtime.make({ services: Game.Runtime.services() })
  if (!made.ok) throw new Error("runtime")
  return made.value
}

const ok = (ticked: { readonly ok: boolean }) => {
  if (!ticked.ok) throw new Error("tick failed")
}

const DoubleA = Game.System("Bench/DoubleA", {
  queries: { all: Game.Query({ selection: { value: Game.Query.write(A) } }) }
}, ({ queries }) => {
  const { data } = queries.all
  for (const entity of queries.all.each()) data.value.set(entity, data.value.get(entity) * 2)
})
const DoubleB = Game.System("Bench/DoubleB", {
  queries: { all: Game.Query({ selection: { value: Game.Query.write(B) } }) }
}, ({ queries }) => {
  const { data } = queries.all
  for (const entity of queries.all.each()) data.value.set(entity, data.value.get(entity) * 2)
})
const DoubleC = Game.System("Bench/DoubleC", {
  queries: { all: Game.Query({ selection: { value: Game.Query.write(C) } }) }
}, ({ queries }) => {
  const { data } = queries.all
  for (const entity of queries.all.each()) data.value.set(entity, data.value.get(entity) * 2)
})
const DoubleD = Game.System("Bench/DoubleD", {
  queries: { all: Game.Query({ selection: { value: Game.Query.write(D) } }) }
}, ({ queries }) => {
  const { data } = queries.all
  for (const entity of queries.all.each()) data.value.set(entity, data.value.get(entity) * 2)
})
const DoubleE = Game.System("Bench/DoubleE", {
  queries: { all: Game.Query({ selection: { value: Game.Query.write(E) } }) }
}, ({ queries }) => {
  const { data } = queries.all
  for (const entity of queries.all.each()) data.value.set(entity, data.value.get(entity) * 2)
})
const DoubleData = Game.System("Bench/DoubleData", {
  queries: { all: Game.Query({ selection: { value: Game.Query.write(Data) } }) }
}, ({ queries }) => {
  const { data } = queries.all
  for (const entity of queries.all.each()) data.value.set(entity, data.value.get(entity) * 2)
})

const SwapAB = Game.System("Bench/SwapAB", {
  queries: { all: Game.Query({ selection: { left: Game.Query.write(A), right: Game.Query.write(B) } }) }
}, ({ queries }) => {
  const { data } = queries.all
  for (const entity of queries.all.each()) {
    const value = data.left.get(entity)
    data.left.set(entity, data.right.get(entity))
    data.right.set(entity, value)
  }
})
const SwapCD = Game.System("Bench/SwapCD", {
  queries: { all: Game.Query({ selection: { left: Game.Query.write(C), right: Game.Query.write(D) } }) }
}, ({ queries }) => {
  const { data } = queries.all
  for (const entity of queries.all.each()) {
    const value = data.left.get(entity)
    data.left.set(entity, data.right.get(entity))
    data.right.set(entity, value)
  }
})
const SwapCE = Game.System("Bench/SwapCE", {
  queries: { all: Game.Query({ selection: { left: Game.Query.write(C), right: Game.Query.write(E) } }) }
}, ({ queries }) => {
  const { data } = queries.all
  for (const entity of queries.all.each()) {
    const value = data.left.get(entity)
    data.left.set(entity, data.right.get(entity))
    data.right.set(entity, value)
  }
})

const SeedA = Game.System("Bench/SeedA", { commands: Game.System.commands(Game.System.spawns(A)) }, ({ commands }) => {
  for (let index = 0; index < 1000; index++) commands.spawn(Game.Command.spawn([A, 1]))
})

export const ritmo: Library = {
  packed_5: () => {
    const world = runtime()
    const Seed = Game.System("Bench/Seed", { commands: Game.System.commands(Game.System.spawns(A, B, C, D, E)) }, ({ commands }) => {
      for (let index = 0; index < 1000; index++) commands.spawn(Game.Command.spawn([A, 1], [B, 1], [C, 1], [D, 1], [E, 1]))
    })
    ok(world.tick(Game.Schedule(Seed, Game.Schedule.applyDeferred())))
    const schedule = Game.Schedule(DoubleA, DoubleB, DoubleC, DoubleD, DoubleE)
    return { run: () => ok(world.tick(schedule)) }
  },
  simple_iter: () => {
    const world = runtime()
    const Seed = Game.System("Bench/Seed", { commands: Game.System.commands(Game.System.spawns(A, B, C, D, E)) }, ({ commands }) => {
      for (let index = 0; index < 1000; index++) {
        commands.spawn(Game.Command.spawn([A, 1], [B, 1]))
        commands.spawn(Game.Command.spawn([A, 1], [B, 1], [C, 1]))
        commands.spawn(Game.Command.spawn([A, 1], [B, 1], [C, 1], [D, 1]))
        commands.spawn(Game.Command.spawn([A, 1], [B, 1], [C, 1], [E, 1]))
      }
    })
    ok(world.tick(Game.Schedule(Seed, Game.Schedule.applyDeferred())))
    const schedule = Game.Schedule(SwapAB, SwapCD, SwapCE)
    return { run: () => ok(world.tick(schedule)) }
  },
  frag_iter: () => {
    const world = runtime()
    const Seed = Game.System("Bench/Seed", { commands: Game.System.commands(Game.System.spawns(Data, ...Object.values(Tags))) }, ({ commands }) => {
      for (let index = 0; index < 100; index++) {
        commands.spawn(Game.Command.spawn([Tags.TagA, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagB, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagC, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagD, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagE, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagF, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagG, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagH, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagI, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagJ, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagK, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagL, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagM, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagN, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagO, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagP, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagQ, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagR, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagS, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagT, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagU, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagV, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagW, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagX, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagY, {}], [Data, 1]))
        commands.spawn(Game.Command.spawn([Tags.TagZ, {}], [Data, 1]))
      }
    })
    ok(world.tick(Game.Schedule(Seed, Game.Schedule.applyDeferred())))
    const schedule = Game.Schedule(DoubleData)
    return { run: () => ok(world.tick(schedule)) }
  },
  entity_cycle: () => {
    const world = runtime()
    ok(world.tick(Game.Schedule(SeedA, Game.Schedule.applyDeferred())))
    const Spawn = Game.System("Bench/SpawnB", {
      queries: { sources: Game.Query({ selection: { a: Game.Query.read(A) } }) },
      commands: Game.System.commands(Game.System.spawns(B))
    }, ({ queries, commands }) => {
      for (const _ of queries.sources.each()) commands.spawn(Game.Command.spawn([B, 1]))
    })
    const Despawn = Game.System("Bench/DespawnB", {
      queries: { spawned: Game.Query({ selection: { b: Game.Query.read(B) } }) },
      commands: Game.System.commands(Game.System.despawns(B))
    }, ({ queries, commands }) => {
      for (const entity of queries.spawned.each()) commands.despawn(entity)
    })
    const schedule = Game.Schedule(Spawn, Game.Schedule.applyDeferred(), Despawn, Game.Schedule.applyDeferred())
    return { run: () => ok(world.tick(schedule)) }
  },
  add_remove: () => {
    const world = runtime()
    ok(world.tick(Game.Schedule(SeedA, Game.Schedule.applyDeferred())))
    const Add = Game.System("Bench/AddB", {
      queries: { sources: Game.Query({ selection: { a: Game.Query.read(A) } }) },
      commands: Game.System.commands(Game.System.inserts(B))
    }, ({ queries, commands }) => {
      for (const entity of queries.sources.each()) commands.insert(entity, [B, 1])
    })
    const Remove = Game.System("Bench/RemoveB", {
      queries: { withB: Game.Query({ selection: { b: Game.Query.read(B) } }) },
      commands: Game.System.commands(Game.System.removes(B))
    }, ({ queries, commands }) => {
      for (const entity of queries.withB.each()) commands.remove(entity, B)
    })
    const schedule = Game.Schedule(Add, Game.Schedule.applyDeferred(), Remove, Game.Schedule.applyDeferred())
    return { run: () => ok(world.tick(schedule)) }
  },
  move: () => {
    const world = runtime()
    const Seed = Game.System("Bench/Seed", { commands: Game.System.commands(Game.System.spawns(Position, Velocity)) }, ({ commands }) => {
      for (let index = 0; index < 100_000; index++) commands.spawn(Game.Command.spawn([Position, { x: 0, y: 0 }], [Velocity, { x: 1, y: 2 }]))
    })
    ok(world.tick(Game.Schedule(Seed, Game.Schedule.applyDeferred())))
    const Move = Game.System("Bench/Move", {
      queries: { all: Game.Query({ selection: { position: Game.Query.write(Position), velocity: Game.Query.read(Velocity) } }) }
    }, ({ queries }) => {
      const { data } = queries.all
      for (const entity of queries.all.each()) {
        const position = data.position.get(entity)
        const velocity = data.velocity.get(entity)
        data.position.set(entity, { x: position.x + velocity.x, y: position.y + velocity.y })
      }
    })
    const schedule = Game.Schedule(Move)
    return { run: () => ok(world.tick(schedule)) }
  }
}
