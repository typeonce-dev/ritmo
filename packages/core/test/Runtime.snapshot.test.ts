import { describe, expect, it } from "vitest"
import { Descriptor, Entity, Schema, Snapshot } from "@typeonce/ritmo"
import * as Codecs from "./codecs.ts"
import { worldOf } from "./saved.ts"

const Root = Schema.defineRoot("SnapshotTest")
const Position = Descriptor.ConstructedComponent(Codecs.safeVector)("Snapshot/Position")
const Name = Descriptor.ConstructedComponent(Codecs.string)("Snapshot/Name")
const Target = Descriptor.ConstructedComponent(Codecs.struct({ handle: Codecs.handle(Root, Name) }))("Snapshot/Target")
const Sprite = Descriptor.TransientComponent<{ readonly frame: number }>()("Snapshot/Sprite")
const Score = Descriptor.ConstructedResource(Codecs.number)("Snapshot/Score")
const Frame = Descriptor.TransientResource<number>()("Snapshot/Frame")
const { relation: ChildOf } = Descriptor.Hierarchy("Snapshot/ChildOf", "Snapshot/Children")

const Game = Schema.bind(Schema.fragment({
  components: { Position, Name, Target, Sprite },
  resources: { Score, Frame },
  relations: { ChildOf }
}), Root)
const Flow = Game.StateMachine("Snapshot/Flow", { Menu: {}, Playing: {} })

const makeRuntime = (score: number, frame = 0) => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: { Score: score, Frame: frame },
    machines: Game.Runtime.machines(Game.Runtime.machine(Flow, { _tag: "Menu" }))
  })
  if (!made.ok) throw new Error("invalid fixture")
  return made.value
}

const Named = Game.Query({ selection: { name: Game.Query.read(Name) } })

const readWorld = (runtime: ReturnType<typeof makeRuntime>) => {
  const Read = Game.Inspector("Snapshot/Read", {
    queries: { named: Named },
    resources: { score: Game.System.readResource(Score) },
    machines: { flow: Game.System.machine(Flow) }
  }, ({ queries, resources, machines }) => ({
    names: queries.named.each().map((match) => [match.entity.id, match.data.name.get()] as const),
    score: resources.score.get(),
    flow: machines.flow.get()
  }))
  return runtime.inspect(Read)
}

const populate = (runtime: ReturnType<typeof makeRuntime>) => {
  const Setup = Game.System("Snapshot/Setup", {
    nextMachines: { flow: Game.System.nextState(Flow) },
    resources: { score: Game.System.writeResource(Score) },
    commands: Game.System.commands(Game.System.spawns(Name, Position, Sprite, Target), Game.System.relates(ChildOf))
  }, ({ commands, nextMachines, resources }) => {
    const parentDraft = Game.Command.spawn([Name, "parent"], Game.Command.entryRaw(Position, { x: 1, y: 2 }))
    if (!parentDraft.ok) throw new Error("invalid fixture")
    const parent = commands.spawn(Game.Command.extend(parentDraft.value, [Sprite, { frame: 3 }]))
    const first = commands.spawn(Game.Command.relate(Game.Command.spawn([Name, "first"]), ChildOf, parent))
    commands.spawn(Game.Command.relate(Game.Command.spawn([Name, "second"]), ChildOf, parent))
    commands.spawn(Game.Command.spawn([Target, { handle: Game.Entity.handle(first, Name) }]))
    resources.score.set(42)
    nextMachines.flow.set({ _tag: "Playing" })
  })
  runtime.tick(Game.Schedule(Setup, Game.Schedule.applyStateTransitions()))
}

describe("Runtime snapshots", () => {
  it("rejects object-shaped handles without changing the world", () => {
    const source = makeRuntime(0)
    populate(source)
    const saved = worldOf(source.snapshot())
    const invalid = {
      ...saved,
      entities: saved.entities.map((entity) => entity.components[Target.name] === undefined ? entity : {
        ...entity,
        components: { ...entity.components, [Target.name]: { handle: { kind: "EntityHandle", value: 2 } } }
      })
    }
    const target = makeRuntime(0)
    const before = worldOf(target.snapshot())
    const restored = target.restore(JSON.parse(JSON.stringify(invalid)))
    expect(restored.ok).toBe(false)
    if (!restored.ok) expect(restored.error._tag).toBe("InvalidComponent")
    expect(worldOf(target.snapshot())).toEqual(before)
    expect(saved.entities.find((entity) => Target.name in entity.components)?.components[Target.name]).toEqual({ handle: 2 })
  })
  it("round-trips entities, relations, resources, and machines through JSON", () => {
    const source = makeRuntime(0)
    populate(source)
    const json = JSON.stringify(worldOf(source.snapshot()))

    const target = makeRuntime(7)
    const restored = target.restore(JSON.parse(json))

    expect(restored.ok).toBe(true)
    expect(readWorld(target)).toEqual(readWorld(source))

    let children: Array<string> = []
    let resolved = ""
    // Inspected before the tick: inspecting while a schedule runs throws.
    const parent = readWorld(target).names.find(([, name]) => name === "parent")![0]
    const Check = Game.System("Snapshot/Check", {
      queries: {
        targets: Game.Query({ selection: { target: Game.Query.read(Target) } }),
        named: Named
      }
    }, ({ queries }) => {
      const matches = queries.named.children(Entity.makeEntityId(parent), ChildOf)
      children = matches.ok ? matches.value.map((match) => match.data.name.get()) : []
      const handle = queries.targets.each()[0]!.data.target.get().handle
      const match = queries.named.getHandle(handle)
      resolved = match.ok ? match.value.data.name.get() : "missing"
    })
    target.tick(Game.Schedule(Check))

    expect(children).toEqual(["first", "second"])
    expect(resolved).toBe("first")
  })

  it("keeps allocating ids after the restored ones", () => {
    const source = makeRuntime(0)
    populate(source)
    const target = makeRuntime(0)
    target.restore(JSON.parse(JSON.stringify(worldOf(source.snapshot()))))

    const Spawn = Game.System("Snapshot/SpawnMore", {
      commands: Game.System.commands(Game.System.spawns(Name))
    }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Name, "later"]))
    })
    target.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))

    const ids = readWorld(target).names.map(([id]) => id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("allocates the same ids after a restore, whatever the world held before", () => {
    const source = makeRuntime(0)
    populate(source)
    const save = JSON.parse(JSON.stringify(worldOf(source.snapshot())))
    const Spawn = Game.System("Snapshot/SpawnNext", {
      commands: Game.System.commands(Game.System.spawns(Name))
    }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Name, "next"]))
    })
    const spawnNext = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
    // One runtime is fresh; the other allocated many more ids than the save before restoring it.
    const fresh = makeRuntime(0)
    const busy = makeRuntime(0)
    for (let index = 0; index < 10; index++) busy.tick(spawnNext)
    for (const runtime of [fresh, busy]) {
      expect(runtime.restore(save).ok).toBe(true)
      runtime.tick(spawnNext)
    }
    expect(readWorld(busy)).toEqual(readWorld(fresh))
    expect(worldOf(busy.snapshot()).nextEntity).toBe(save.nextEntity + 1)
  })

  it("rejects invalid data and leaves the world unchanged", () => {
    const runtime = makeRuntime(5)
    populate(runtime)
    const before = readWorld(runtime)
    const good = worldOf(runtime.snapshot())
    const firstId = good.entities[0]!.id

    const cases: ReadonlyArray<readonly [unknown, Snapshot.RestoreError["_tag"]]> = [
      [null, "InvalidSnapshot"],
      [{ ...good, version: 1 }, "UnsupportedVersion"],
      [{ ...good, version: 2 }, "UnsupportedVersion"],
      [{ ...good, version: 4 }, "UnsupportedVersion"],
      [{ ...good, scopes: { "Snapshot/Level": [0] } }, "InvalidSnapshot"],
      [{ ...good, entities: [{ id: firstId, components: { Missing: 1 } }] }, "UnknownComponent"],
      [{ ...good, entities: [{ id: firstId, components: { "Snapshot/Position": { x: Number.NaN, y: 0 } } }] }, "InvalidComponent"],
      [{ ...good, entities: [{ id: firstId, components: { "Snapshot/Name": 12 } }] }, "InvalidComponent"],
      [{ ...good, entities: [{ id: firstId, components: { "Snapshot/Position": null } }] }, "InvalidComponent"],
      [{ ...good, entities: [{ id: firstId, components: { "Snapshot/Target": { handle: { kind: "EntityHandle", value: -1 } } } }] }, "InvalidComponent"],
      [{ ...good, entities: [{ id: firstId, components: { "Snapshot/Sprite": { frame: 1 } } }] }, "UnknownComponent"],
      [{ ...good, resources: { "Snapshot/Score": "high" } }, "InvalidResource"],
      [{ ...good, resources: { "Snapshot/Frame": 1 } }, "UnknownResource"],
      [{ ...good, resources: { "Snapshot/Other": 1 } }, "UnknownResource"],
      [{ ...good, machines: { "Snapshot/Flow": "Paused" } }, "InvalidMachineState"],
      [{ ...good, relations: { "Snapshot/ChildOf": [[firstId, [firstId]]] } }, "InvalidRelation"],
      [{ ...good, entities: [...good.entities, good.entities[0]] }, "DuplicateEntity"]
    ]
    for (const [data, tag] of cases) {
      const result = runtime.restore(data)
      expect(result.ok ? undefined : result.error._tag).toBe(tag)
    }
    expect(readWorld(runtime)).toEqual(before)
  })

  it("reports a restore to change detection as despawns and spawns", () => {
    const runtime = makeRuntime(0)
    populate(runtime)
    const seen: Array<{ added: number; despawned: number }> = []
    const Observe = Game.System("Snapshot/Observe", {
      queries: { added: Game.Query({ selection: { name: Game.Query.read(Name) }, filters: [Game.Query.added(Name)] }) },
      despawned: { entities: Game.System.readDespawned() }
    }, ({ queries, despawned }) => {
      seen.push({ added: queries.added.each().length, despawned: despawned.entities.all().length })
    })
    runtime.tick(Game.Schedule(Observe))
    runtime.restore(worldOf(runtime.snapshot()))
    runtime.tick(Game.Schedule(Observe))

    expect(seen).toEqual([{ added: 3, despawned: 0 }, { added: 3, despawned: 4 }])
  })

  it("skips transient components and resources", () => {
    const source = makeRuntime(0, 9)
    populate(source)
    const saved = worldOf(source.snapshot())
    expect(saved.resources).toEqual({ "Snapshot/Score": 42 })
    expect(saved.entities.some((entity) => "Snapshot/Sprite" in entity.components)).toBe(false)

    const target = makeRuntime(0, 5)
    expect(target.restore(JSON.parse(JSON.stringify(saved))).ok).toBe(true)
    const Read = Game.Inspector("Snapshot/ReadTransient", {
      queries: { sprites: Game.Query({ selection: { sprite: Game.Query.read(Sprite) } }) },
      resources: { frame: Game.System.readResource(Frame), score: Game.System.readResource(Score) }
    }, ({ queries, resources }) => ({
      sprites: queries.sprites.each().length,
      frame: resources.frame.get(),
      score: resources.score.get()
    }))
    expect(target.inspect(Read)).toEqual({ sprites: 0, frame: 5, score: 42 })
  })

  it("decodes stored handles and rejects malformed ones", () => {
    const isHandle = Entity.isHandle(Root)
    expect(isHandle(JSON.parse(JSON.stringify(Entity.makeHandle(4))))).toBe(true)
    for (const raw of [null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "4", { kind: "EntityHandle", value: 7 }, { kind: "EntityId", value: 4 }, { kind: "EntityHandle", value: 1.5 }, { value: 4 }]) {
      expect(isHandle(raw)).toBe(false)
    }
  })
})
