import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import * as Runtime from "@typeonce/ritmo/Runtime"
import type { Debug } from "@typeonce/ritmo"

const Name = Descriptor.Component<string>()("Dropped/Name")
const Gate = Descriptor.Resource<boolean>()("Dropped/Gate")
const { relation: Targeting } = Descriptor.Relation("Dropped/Targeting", "Dropped/TargetedBy")
const { relation: ChildOf } = Descriptor.Hierarchy("Dropped/ChildOf", "Dropped/Children")

const Game = Schema.bind(Schema.fragment({
  components: { Name },
  resources: { Gate },
  relations: { Targeting, ChildOf }
}))

const open = Game.Condition.check("Dropped/Open", { resources: { gate: Game.System.readResource(Gate) } }, ({ resources }) => resources.gate.get())

/** One reader's view of what it read, run by run. */
const makeReader = (name: string, gating: { readonly when?: true; readonly pauseWhen?: true } = {}) => {
  const runs: Array<ReadonlyArray<string>> = []
  let lagged = false
  const system = Game.System(name, {
    droppedRelations: { lost: Game.System.readDroppedRelations(Targeting) },
    ...(gating.when ? { when: [open] } : {}),
    ...(gating.pauseWhen ? { pauseWhen: [open] } : {})
  }, ({ droppedRelations }) => {
    lagged ||= droppedRelations.lost.lagged()
    runs.push(droppedRelations.lost.all().map((dropped) => `${dropped.relation.name} ${dropped.source}->${dropped.target}`))
  })
  return { system, runs, lagged: () => lagged }
}

const Named = Game.Query({ selection: { name: Game.Query.read(Name) } })

// Spawned in this order, so with ids 1 to 5.
const ids = { target: 1, archer: 2, mage: 3, parent: 4, child: 5 } as const
type Named = keyof typeof ids

const setup = () => {
  let despawn: ReadonlyArray<Named> = []
  let unrelate: ReadonlyArray<Named> = []
  const Spawn = Game.System("Dropped/Spawn", {
    commands: Game.System.commands(Game.System.spawns(Name), Game.System.relates(Targeting, ChildOf))
  }, ({ commands }) => {
    const target = commands.spawn(Game.Command.spawn([Name, "target"]))
    commands.spawn(Game.Command.relate(Game.Command.spawn([Name, "archer"]), Targeting, target))
    commands.spawn(Game.Command.relate(Game.Command.spawn([Name, "mage"]), Targeting, target))
    const parent = commands.spawn(Game.Command.spawn([Name, "parent"]))
    commands.spawn(Game.Command.relate(Game.Command.spawn([Name, "child"]), ChildOf, parent))
  })
  const Act = Game.System("Dropped/Act", {
    queries: { named: Named },
    commands: Game.System.commands(Game.System.despawns(Name), Game.System.relates(Targeting))
  }, ({ queries, commands }) => {
    for (const match of queries.named.each()) {
      const name = match.data.name.get() as Named
      if (unrelate.includes(name)) commands.unrelate(match.entity.id, Targeting)
      if (despawn.includes(name)) commands.despawn(match.entity)
    }
    despawn = []
    unrelate = []
  })
  return {
    Spawn,
    Act,
    despawn: (...next: ReadonlyArray<Named>) => { despawn = next },
    unrelate: (...next: ReadonlyArray<Named>) => { unrelate = next }
  }
}

const Kill = (name: string) => Game.System(`Dropped/Kill/${name}`, {
  queries: { named: Named },
  commands: Game.System.commands(Game.System.despawns(Name))
}, ({ queries, commands }) => {
  for (const match of queries.named.each()) if (match.data.name.get() === name) commands.despawn(match.entity)
})

const dropped = [`Dropped/Targeting ${ids.archer}->${ids.target}`, `Dropped/Targeting ${ids.mage}->${ids.target}`]

const makeRuntime = (gate = true) => Game.Runtime.make({
  services: Game.Runtime.services(),
  resources: { Gate: gate },
  checkpoints: 4
}).value

describe("Game.System.readDroppedRelations", () => {
  it("delivers each edge a target's despawn drops once to every reader", () => {
    const world = setup()
    const first = makeReader("Dropped/First")
    const second = makeReader("Dropped/Second")
    const runtime = makeRuntime()
    const update = Game.Schedule(world.Act, Game.Schedule.applyDeferred(), first.system, second.system)
    runtime.tick(Game.Schedule(world.Spawn, Game.Schedule.applyDeferred()))
    runtime.tick(update)
    world.despawn("target")
    runtime.tick(update)
    runtime.tick(update)

    const expected = [[], dropped, []]
    expect(first.runs).toEqual(expected)
    expect(second.runs).toEqual(expected)
  })

  it("records nothing for an unrelate, a source's own despawn, or a hierarchy", () => {
    const world = setup()
    const reader = makeReader("Dropped/Reader")
    const children: Array<number> = []
    const ReadChildren = Game.System("Dropped/ReadChildren", {
      droppedRelations: { childOf: Game.System.readDroppedRelations(ChildOf) }
    }, ({ droppedRelations }) => {
      children.push(droppedRelations.childOf.all().length)
    })
    const runtime = makeRuntime()
    const update = Game.Schedule(world.Act, Game.Schedule.applyDeferred(), reader.system, ReadChildren)
    runtime.tick(Game.Schedule(world.Spawn, Game.Schedule.applyDeferred()))
    world.unrelate("archer")
    world.despawn("mage", "parent")
    runtime.tick(update)
    world.despawn("target")
    runtime.tick(update)
    expect(reader.runs).toEqual([[], []])
    expect(children).toEqual([0, 0])
  })

  it("drops records published while a reader is skipped by when, and keeps them under pauseWhen", () => {
    const world = setup()
    const gated = makeReader("Dropped/Gated", { when: true })
    const paused = makeReader("Dropped/Paused", { pauseWhen: true })
    const runtime = makeRuntime()
    const SetGate = (value: boolean) => Game.System(`Dropped/SetGate/${value}`, { resources: { gate: Game.System.writeResource(Gate) } }, ({ resources }) => {
      resources.gate.set(value)
    })
    const update = Game.Schedule(world.Act, Game.Schedule.applyDeferred(), gated.system, paused.system)
    runtime.tick(Game.Schedule(world.Spawn, Game.Schedule.applyDeferred()))
    runtime.tick(update)
    runtime.tick(Game.Schedule(SetGate(false)))
    world.despawn("target")
    runtime.tick(update)
    runtime.tick(Game.Schedule(SetGate(true)))
    runtime.tick(update)

    expect(gated.runs).toEqual([[], []])
    expect(paused.runs).toEqual([[], dropped])
  })

  it("reports lagged when more edges were dropped than the stream holds", () => {
    const sources = Runtime.streamCapacity + 10
    const reader = makeReader("Dropped/Behind")
    const Spawn = Game.System("Dropped/SpawnMany", {
      commands: Game.System.commands(Game.System.spawns(Name), Game.System.relates(Targeting))
    }, ({ commands }) => {
      for (let index = 0; index < sources; index++) {
        const target = commands.spawn(Game.Command.spawn([Name, "target"]))
        commands.spawn(Game.Command.relate(Game.Command.spawn([Name, "source"]), Targeting, target))
      }
    })
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), reader.system))
    runtime.tick(Game.Schedule(Kill("target"), Game.Schedule.applyDeferred()))
    runtime.tick(Game.Schedule())
    runtime.tick(Game.Schedule())
    runtime.tick(Game.Schedule(reader.system))
    expect(reader.lagged()).toBe(true)
    expect(reader.runs[1]!.length).toBe(Runtime.streamCapacity)
  })

  it("delivers the records again, once per reader, after a checkpoint rewind and re-run", () => {
    const world = setup()
    const first = makeReader("Dropped/First")
    const second = makeReader("Dropped/Second")
    const runtime = makeRuntime()
    const update = Game.Schedule(world.Act, Game.Schedule.applyDeferred(), first.system, second.system)
    runtime.tick(Game.Schedule(world.Spawn, Game.Schedule.applyDeferred()))
    runtime.tick(update)
    const checkpoint = runtime.checkpoint(update)
    world.despawn("target")
    runtime.tick(update)
    expect(runtime.rewind(checkpoint).ok).toBe(true)
    world.despawn("target")
    runtime.tick(update)
    runtime.tick(update)

    expect(first.runs).toEqual([[], dropped, dropped, []])
    expect(second.runs).toEqual([[], dropped, dropped, []])
  })

  it("traces each dropped edge as an effect of the despawn", () => {
    const world = setup()
    const reader = makeReader("Dropped/Reader")
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(),
      resources: { Gate: true },
      debug: { hostClock: HostClock.test() }
    }).value
    const effects: Array<Debug.Effect> = []
    runtime.debug.observe((event) => {
      if (event.type === "deferred") for (const command of event.commands) effects.push(...command.effects)
    })
    const update = Game.Schedule(world.Act, Game.Schedule.applyDeferred(), reader.system)
    runtime.debug.nameSchedules({ update })
    runtime.tick(Game.Schedule(world.Spawn, Game.Schedule.applyDeferred()))
    world.despawn("target")
    effects.length = 0
    runtime.tick(update)
    expect(effects).toEqual([
      { kind: "despawn", entity: ids.target },
      { kind: "relationDropped", entity: ids.archer, relation: "Dropped/Targeting", target: ids.target },
      { kind: "relationDropped", entity: ids.mage, relation: "Dropped/Targeting", target: ids.target }
    ])
    expect(runtime.debug.describe().systems.find((system) => system.name === "Dropped/Reader")?.droppedRelations).toEqual(["Dropped/Targeting"])
    expect(runtime.debug.streams().filter((stream) => stream.kind === "droppedRelation").map((stream) => stream.stream)).toEqual(["Dropped/Targeting"])
  })
})
