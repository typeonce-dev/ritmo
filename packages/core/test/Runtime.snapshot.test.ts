import { describe, expect, it } from "vitest"
import { Decode, Descriptor, Entity, Result, Schema, Snapshot } from "@typeonce/ritmo"
import * as Vector2 from "@typeonce/ritmo-math/Vector2"
import { worldOf } from "./world-of.ts"

const Root = Schema.defineRoot("SnapshotTest")
const Position = Descriptor.ConstructedComponent(Vector2)("Snapshot/Position")
const Name = Descriptor.ConstructedComponent(Decode.string)("Snapshot/Name")
const Target = Descriptor.ConstructedComponent(Decode.struct({ handle: Decode.handle(Root, Name) }))("Snapshot/Target")
const Sprite = Descriptor.TransientComponent<{ readonly frame: number }>()("Snapshot/Sprite")
const Score = Descriptor.ConstructedResource(Decode.number)("Snapshot/Score")
const Frame = Descriptor.TransientResource<number>()("Snapshot/Frame")
const { relation: ChildOf } = Descriptor.Hierarchy("Snapshot/ChildOf", "Snapshot/Children")

const Game = Schema.bind(Schema.fragment({
  components: { Position, Name, Target, Sprite },
  resources: { Score, Frame },
  relations: { ChildOf }
}), Root)
const Flow = Game.StateMachine("Snapshot/Flow", ["Menu", "Playing"])

const makeRuntime = (score: number, frame = 0) => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: { Score: score, Frame: frame },
    machines: Game.Runtime.machines(Game.Runtime.machine(Flow, "Menu"))
  })
  if (made._tag === "Failure") throw new Error("invalid fixture")
  return made.success
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
    if (parentDraft._tag === "Failure") throw new Error("invalid fixture")
    const parent = commands.spawn(Game.Command.extend(parentDraft.success, [Sprite, { frame: 3 }]))
    const first = commands.spawn(Game.Command.relate(Game.Command.spawn([Name, "first"]), ChildOf, parent))
    commands.spawn(Game.Command.relate(Game.Command.spawn([Name, "second"]), ChildOf, parent))
    commands.spawn(Game.Command.spawn([Target, { handle: Game.Entity.handle(first, Name) }]))
    resources.score.set(42)
    nextMachines.flow.set("Playing")
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
    expect(restored._tag).toBe("Failure")
    if (restored._tag === "Failure") expect(restored.failure._tag).toBe("InvalidComponent")
    expect(worldOf(target.snapshot())).toEqual(before)
    expect(saved.entities.find((entity) => Target.name in entity.components)?.components[Target.name]).toEqual({ handle: 2 })
  })
  it("round-trips entities, relations, resources, and machines through JSON", () => {
    const source = makeRuntime(0)
    populate(source)
    const json = JSON.stringify(worldOf(source.snapshot()))

    const target = makeRuntime(7)
    const restored = target.restore(JSON.parse(json))

    expect(restored._tag).toBe("Success")
    expect(readWorld(target)).toEqual(readWorld(source))

    let children: Array<string> = []
    let resolved = ""
    const Check = Game.System("Snapshot/Check", {
      queries: {
        targets: Game.Query({ selection: { target: Game.Query.read(Target) } }),
        named: Named
      }
    }, ({ queries }) => {
      const parent = readWorld(target).names.find(([, name]) => name === "parent")![0]
      const matches = queries.named.children(Entity.makeEntityId(parent), ChildOf)
      children = matches._tag === "Success" ? matches.success.map((match) => match.data.name.get()) : []
      const handle = queries.targets.each()[0]!.data.target.get().handle
      const match = queries.named.getHandle(handle)
      resolved = match._tag === "Success" ? match.success.data.name.get() : "missing"
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

  it("rejects invalid data and leaves the world unchanged", () => {
    const runtime = makeRuntime(5)
    populate(runtime)
    const before = readWorld(runtime)
    const good = worldOf(runtime.snapshot())
    const firstId = good.entities[0]!.id

    const cases: ReadonlyArray<readonly [unknown, Snapshot.RestoreError["_tag"]]> = [
      [null, "InvalidSnapshot"],
      [{ ...good, version: 1 }, "UnsupportedVersion"],
      [{ ...good, version: 3 }, "UnsupportedVersion"],
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
      expect(result._tag === "Success" ? undefined : result.failure._tag).toBe(tag)
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
    expect(target.restore(JSON.parse(JSON.stringify(saved)))._tag).toBe("Success")
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

  it("validates through Standard Schema validators", () => {
    const positive = Descriptor.fromStandardSchema({
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value: unknown) =>
          typeof value === "number" && value > 0 ? { value } : { issues: [{ message: "must be positive" }] }
      }
    })
    expect(positive.result(2)).toEqual(Result.succeed(2))
    expect(positive.result(-1)).toEqual(Result.fail({ _tag: "StandardSchemaIssues", issues: [{ message: "must be positive" }] }))

    const async = Descriptor.fromStandardSchema({
      "~standard": { version: 1, vendor: "test", validate: async (value: unknown) => ({ value }) }
    })
    const outcome = async.result(1)
    expect(outcome._tag === "Failure" && outcome.failure._tag).toBe("StandardSchemaIssues")
  })

  it("decodes stored handles and rejects malformed ones", () => {
    const valid = Entity.decodeHandle(Root, JSON.parse(JSON.stringify(Entity.makeHandle(4))))
    expect(valid._tag === "Success" && valid.success).toBe(4)
    for (const raw of [null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "4", { kind: "EntityHandle", value: 7 }, { kind: "EntityId", value: 4 }, { kind: "EntityHandle", value: 1.5 }, { value: 4 }]) {
      expect(Entity.decodeHandle(Root, raw)._tag).toBe("Failure")
    }
  })
})
