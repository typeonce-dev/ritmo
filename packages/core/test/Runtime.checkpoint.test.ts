import { describe, expect, it } from "vitest"
import { Checkpoint, Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import type { Source } from "@typeonce/ritmo/Schedule"
import * as Codecs from "./codecs.ts"

const expectOk = (result: { readonly ok: boolean; readonly error?: unknown }): void => {
  expect(result.ok ? undefined : result.error).toBeUndefined()
}

// One small game that touches everything a checkpoint has to put back.
const Root = Schema.defineRoot("CheckpointTest")
const Pos = Descriptor.Component<{ readonly x: number }>()("Checkpoint/Pos")
const Health = Descriptor.Component<number>()("Checkpoint/Health")
const Shield = Descriptor.Tag("Checkpoint/Shield")
const Owner = Descriptor.Component<{ readonly id: number }>()("Checkpoint/Owner")
const Sprite = Descriptor.TransientComponent<{ readonly frame: number }>()("Checkpoint/Sprite")
const Counter = Descriptor.Resource<number>()("Checkpoint/Counter")
const Seed = Descriptor.Resource<number>()("Checkpoint/Seed")
const Log = Descriptor.Resource<ReadonlyArray<string>>()("Checkpoint/Log")
const Input = Descriptor.TransientResource<number>()("Checkpoint/Input")
const Hit = Descriptor.Event<{ readonly id: number; readonly left: number }>()("Checkpoint/Hit")
const InputSource = Descriptor.Service<Source<number>>()("Checkpoint/InputSource")
const { relation: ChildOf } = Descriptor.Hierarchy("Checkpoint/ChildOf", "Checkpoint/Children")

const Game = Schema.bind(Schema.fragment({
  components: { Pos, Health, Shield, Owner, Sprite },
  resources: { Counter, Seed, Log, Input },
  events: { Hit },
  relations: { ChildOf }
}), Root)
const Phase = Game.StateMachine("Checkpoint/Phase", { Calm: Codecs.struct({ waves: Codecs.integer }), Rush: {} })
const Wave = Game.EntityScope("Checkpoint/Wave", { despawnOnExit: [Phase, "Rush"] })

const note = (log: { update(f: (log: ReadonlyArray<string>) => ReadonlyArray<string>): void }, line: string) =>
  log.update((lines) => [...lines, line])

const Capture = Game.System("Checkpoint/Capture", {
  resources: { input: Game.System.writeResource(Input) },
  services: { source: Game.System.consumeService(InputSource) }
}, ({ resources, services }) => {
  resources.input.set(services.source.snapshot())
})

// Spawns from the input and a seed kept in a resource; the third spawn of every
// five goes into the wave scope, and every spawn after the first is a child of it.
const Spawner = Game.System("Checkpoint/Spawner", {
  resources: { input: Game.System.readResource(Input), counter: Game.System.writeResource(Counter), seed: Game.System.writeResource(Seed) },
  queries: { roots: Game.Query({ selection: { pos: Game.Query.read(Pos) }, without: [Owner] }) },
  commands: Game.System.commands(Game.System.spawns(Pos, Health, Owner, Sprite), Game.System.relates(ChildOf))
}, ({ resources, queries, commands }) => {
  const input = resources.input.get()
  const seed = (resources.seed.get() * 1103515245 + 12345 + input) % 2147483648
  resources.seed.set(seed)
  if (input % 3 === 0) return
  const count = resources.counter.get() + 1
  resources.counter.set(count)
  const root = queries.roots.each()[0]
  const draft = Game.Command.spawn([Pos, { x: seed % 100 }], [Health, 1 + (seed % 4)], [Sprite, { frame: count }])
  const owned = root === undefined ? draft : Game.Command.extend(draft, [Owner, { id: root.entity.id }])
  const spawned = count % 5 === 3 ? commands.spawnIn(Wave, owned) : commands.spawn(owned)
  if (root !== undefined) commands.relate(spawned, ChildOf, root.entity.id)
})

const Mover = Game.System("Checkpoint/Mover", {
  resources: { input: Game.System.readResource(Input) },
  queries: { moving: Game.Query({ selection: { pos: Game.Query.write(Pos) }, with: [Owner] }) }
}, ({ resources, queries }) => {
  const input = resources.input.get()
  for (const { data } of queries.moving.each()) {
    if (input % 2 === 0) data.pos.update((pos) => ({ x: pos.x + 1 }))
  }
})

const Damager = Game.System("Checkpoint/Damager", {
  resources: { input: Game.System.readResource(Input) },
  queries: { hurt: Game.Query({ selection: { health: Game.Query.write(Health), shield: Game.Query.optional(Shield) }, with: [Owner] }) },
  events: { hit: Game.System.writeEvent(Hit) },
  commands: Game.System.commands(Game.System.despawns(Health), Game.System.inserts(Shield), Game.System.removes(Shield))
}, ({ resources, queries, events, commands }) => {
  const input = resources.input.get()
  for (const { entity, data } of queries.hurt.each()) {
    if ((entity.id + input) % 4 === 0) {
      if (data.shield !== undefined) commands.remove(entity, Shield)
      else commands.insert(entity, Game.Command.entry(Shield, {}))
      continue
    }
    if (data.shield !== undefined) continue
    const left = data.health.get() - 1
    data.health.set(left)
    events.hit.emit({ id: entity.id, left })
    if (left <= 0) commands.despawn(entity)
  }
})

const Flip = Game.System("Checkpoint/Flip", {
  resources: { counter: Game.System.readResource(Counter) },
  machines: { phase: Game.System.updateMachine(Phase) },
  nextMachines: { phase: Game.System.nextState(Phase) }
}, ({ resources, machines, nextMachines }) => {
  const count = resources.counter.get()
  if (count % 7 === 0) nextMachines.phase.set(machines.phase.is("Calm") ? { _tag: "Rush" } : { _tag: "Calm", waves: count })
  else if (machines.phase.is("Calm")) machines.phase.update({ state: "Calm", data: (calm) => ({ waves: calm.waves + 1 }) })
})

// Reads everything a reader can: what it sees goes into the log, so a reader
// whose position did not rewind exactly writes a different log.
const Watcher = Game.System("Checkpoint/Watcher", {
  queries: {
    added: Game.Query({ selection: { pos: Game.Query.read(Pos) }, filters: [Game.Query.added(Pos)] }),
    changed: Game.Query({ selection: { health: Game.Query.read(Health) }, filters: [Game.Query.changed(Health)] })
  },
  resources: { log: Game.System.writeResource(Log), counter: Game.System.changedResource(Counter) },
  events: { hit: Game.System.readEvent(Hit) },
  removed: { shield: Game.System.readRemoved(Shield) },
  despawned: { all: Game.System.readDespawned() },
  transitionEvents: { phase: Game.System.readTransitionEvent(Phase) }
}, ({ queries, resources, events, removed, despawned, transitionEvents }) => {
  const parts = [
    `added ${queries.added.each().map(({ entity }) => entity.id).join(",")}`,
    `changed ${queries.changed.each().map(({ entity, data }) => `${entity.id}=${data.health.get()}`).join(",")}`,
    `hits ${events.hit.all().map((hit) => `${hit.id}:${hit.left}`).join(",")}`,
    `unshielded ${removed.shield.all().join(",")}`,
    `despawned ${despawned.all.all().join(",")}`,
    `phase ${transitionEvents.phase.all().map((move) => `${move.from}>${move.to}`).join(",")}`,
    `counter ${resources.counter.changed()}`
  ]
  note(resources.log, parts.join(" | "))
})

const OnRush = Game.System("Checkpoint/OnRush", {
  resources: { log: Game.System.writeResource(Log) },
  commands: Game.System.commands(Game.System.spawns(Pos))
}, ({ resources, commands }) => {
  const id = commands.spawn(Game.Command.spawn([Pos, { x: -1 }]))
  note(resources.log, `rush spawns ${id}`)
})

const transitions = Game.Schedule.transitions(Game.Schedule.onEnter(Phase, "Rush", [OnRush]))
const simulate = Game.Schedule(
  Capture, Spawner, Mover, Damager, Flip, Game.Schedule.applyStateTransitions(transitions), Watcher
)

// A host-side reader: a mirror of every positioned entity, kept from changes
// alone, the way render sync keeps nodes.
const Mirror = Descriptor.Service<{ readonly nodes: Map<number, number>; created: number; destroyed: number }>()("Checkpoint/Mirror")
const Draw = Game.System("Checkpoint/Draw", {
  queries: { shown: Game.Query({ selection: { pos: Game.Query.read(Pos) }, filters: [Game.Query.anyOf(Game.Query.added(Pos), Game.Query.changed(Pos))] }) },
  removed: { pos: Game.System.readRemoved(Pos) },
  services: { mirror: Game.System.service(Mirror) }
}, ({ queries, removed, services }) => {
  const mirror = services.mirror
  for (const id of removed.pos.all()) {
    if (mirror.nodes.delete(id)) mirror.destroyed += 1
  }
  for (const { entity, data } of queries.shown.each()) {
    if (!mirror.nodes.has(entity.id)) mirror.created += 1
    mirror.nodes.set(entity.id, data.pos.get().x)
  }
})
const render = Game.Schedule(Draw)

const ReadWorld = Game.Inspector("Checkpoint/ReadWorld", {
  queries: {
    all: Game.Query({ selection: { pos: Game.Query.optional(Pos), health: Game.Query.optional(Health), shield: Game.Query.optional(Shield), children: Game.Query.optionalRelated(ChildOf) } })
  }
}, ({ queries }) => queries.all.each().map(({ entity, data }) => ({
  id: entity.id,
  pos: data.pos?.get(),
  health: data.health?.get(),
  shield: data.shield !== undefined,
  children: data.children?.get()
})))

const makeGame = () => {
  const source = { value: 0, snapshot: () => source.value }
  const mirror = { nodes: new Map<number, number>(), created: 0, destroyed: 0 }
  const runtime = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(InputSource, source), Game.Runtime.service(Mirror, mirror)),
    resources: { Counter: 0, Seed: 7, Log: [], Input: 0 },
    machines: Game.Runtime.machines(Game.Runtime.machine(Phase, { _tag: "Calm", waves: 0 })),
    debug: { hostClock: HostClock.test() },
    checkpoints: 32
  }).value
  const step = (input: number) => {
    source.value = input
    expectOk(runtime.tick(simulate))
  }
  /** Everything that must match between runtimes: entities, resources, machines, queues, children order, and the next id. */
  const state = () => {
    const dump = runtime.debug.dump()
    return {
      entities: dump.entities,
      resources: dump.resources,
      machines: dump.machines,
      pending: dump.pendingCommands,
      world: runtime.inspect(ReadWorld)
    }
  }
  return { runtime, source, mirror, step, state }
}

/** The input of a tick, as the peer that sends it knows it. */
const truth = (tick: number) => (tick * 7 + (tick >> 2)) % 11

describe("Runtime checkpoints", () => {
  it("re-runs ticks after a rewind exactly like a runtime that never rewound", () => {
    const reference = makeGame()
    for (let tick = 0; tick < 120; tick++) reference.step(truth(tick))

    // Input arrives `delay` ticks late; until then the last known input is the guess.
    const delay = 5
    const peer = makeGame()
    const history: Array<Checkpoint.Checkpoint<typeof Root>> = []
    const guessed: Array<number> = []
    let rewinds = 0
    for (let tick = 0; tick < 120 + delay; tick++) {
      const confirmed = tick - delay
      if (confirmed >= 0 && guessed[confirmed] !== truth(confirmed)) {
        // The guess for `confirmed` was wrong: rewind to it and run again up to now.
        expectOk(peer.runtime.rewind(history[confirmed]!))
        rewinds += 1
        for (let at = confirmed; at < Math.min(tick, 120); at++) {
          history[at] = peer.runtime.checkpoint(simulate)
          guessed[at] = at <= confirmed ? truth(at) : truth(confirmed)
          peer.step(guessed[at]!)
        }
      }
      if (tick >= 120) continue
      history[tick] = peer.runtime.checkpoint(simulate)
      guessed[tick] = confirmed >= 0 ? truth(Math.max(confirmed, 0)) : 0
      if (tick <= confirmed) guessed[tick] = truth(tick)
      peer.step(guessed[tick]!)
      expectOk(peer.runtime.tick(render))
    }
    expect(rewinds).toBeGreaterThan(10)
    expect(peer.state()).toEqual(reference.state())
    // One more spawn gets the same id on both: the next id rewound too.
    reference.step(1)
    peer.step(1)
    expect(peer.state()).toEqual(reference.state())
  })

  it("puts back entity ids, so a spawn after a rewind gets the id it got the first time", () => {
    const game = makeGame()
    game.step(1)
    const before = game.state()
    const checkpoint = game.runtime.checkpoint(simulate)
    game.step(1)
    const ahead = game.state()
    expectOk(game.runtime.rewind(checkpoint))
    expect(game.state()).toEqual(before)
    game.step(1)
    expect(game.state()).toEqual(ahead)
  })

  it("keeps queued commands, queued transitions, and unread events, which restore drops", () => {
    const Queue = Game.System("Checkpoint/Queue", {
      nextMachines: { phase: Game.System.nextState(Phase) },
      events: { hit: Game.System.writeEvent(Hit) },
      commands: Game.System.commands(Game.System.spawns(Pos))
    }, ({ nextMachines, events, commands }) => {
      nextMachines.phase.set({ _tag: "Rush" })
      events.hit.emit({ id: 0, left: 0 })
      commands.spawn(Game.Command.spawn([Pos, { x: 9 }]))
    })
    const Apply = Game.Schedule(Game.Schedule.applyStateTransitions(transitions), Watcher)
    const reference = makeGame()
    expectOk(reference.runtime.tick(Game.Schedule(Queue)))
    expectOk(reference.runtime.tick(Apply))

    const game = makeGame()
    expectOk(game.runtime.tick(Game.Schedule(Queue)))
    const checkpoint = game.runtime.checkpoint(Apply)
    expectOk(game.runtime.tick(Apply))
    expectOk(game.runtime.rewind(checkpoint))
    expectOk(game.runtime.tick(Apply))
    expect(game.state()).toEqual(reference.state())
  })

  it("keeps transient components and resources as they were", () => {
    const game = makeGame()
    game.step(1)
    game.step(2)
    const checkpoint = game.runtime.checkpoint(simulate)
    const before = game.runtime.debug.dump()
    game.step(4)
    game.step(5)
    expectOk(game.runtime.rewind(checkpoint))
    const after = game.runtime.debug.dump()
    expect(after.entities).toEqual(before.entities)
    expect(after.resources).toEqual(before.resources)
    expect(after.entities.some((entity) => Sprite.name in entity.components)).toBe(true)
  })

  it("rewinds to the same checkpoint more than once", () => {
    const game = makeGame()
    game.step(1)
    const checkpoint = game.runtime.checkpoint(simulate)
    const at = game.state()
    for (let attempt = 0; attempt < 3; attempt++) {
      game.step(attempt + 1)
      game.step(attempt + 2)
      expectOk(game.runtime.rewind(checkpoint))
      expect(game.state()).toEqual(at)
    }
  })

  it("releases newer checkpoints on rewind, older ones past the window, and all of them on restore", () => {
    const game = makeGame()
    const first = game.runtime.checkpoint(simulate)
    game.step(1)
    const second = game.runtime.checkpoint(simulate)
    game.step(1)
    expectOk(game.runtime.rewind(first))
    expect(game.runtime.rewind(second)).toEqual({ ok: false, error: { _tag: "Released", reason: "rewound" } })
    expectOk(game.runtime.rewind(first))

    const taken: Array<Checkpoint.Checkpoint<typeof Root>> = []
    for (let tick = 0; tick < 33; tick++) {
      taken.push(game.runtime.checkpoint(simulate))
      game.step(tick)
    }
    expect(game.runtime.rewind(taken[0]!)).toEqual({ ok: false, error: { _tag: "Released", reason: "window" } })
    expectOk(game.runtime.rewind(taken[1]!))
  })

  it("rejects a checkpoint of another runtime, and one parsed back from JSON", () => {
    const one = makeGame()
    const other = makeGame()
    const checkpoint = one.runtime.checkpoint(simulate)
    expect(other.runtime.rewind(checkpoint)).toEqual({ ok: false, error: { _tag: "OtherRuntime" } })
    expect(JSON.stringify(checkpoint)).toBe("{}")
    const parsed = JSON.parse(JSON.stringify(checkpoint)) as unknown
    expect(Checkpoint.isCheckpoint(checkpoint)).toBe(true)
    expect(Checkpoint.isCheckpoint(parsed)).toBe(false)
  })

  it("throws when taken or rewound during a tick", () => {
    const game = makeGame()
    const checkpoint = game.runtime.checkpoint(simulate)
    const Inside = Game.System("Checkpoint/Inside", {}, () => {
      game.runtime.checkpoint(simulate)
    })
    expect(() => game.runtime.tick(Game.Schedule(Inside))).toThrow("runtime.checkpoint was called while a schedule is running")
    const Back = Game.System("Checkpoint/Back", {}, () => {
      game.runtime.rewind(checkpoint)
    })
    expect(() => game.runtime.tick(Game.Schedule(Back))).toThrow("runtime.rewind was called while a schedule is running")
  })

  it("throws for a system with local state in a schedule whose type was erased", () => {
    const Scratch = Game.System("Checkpoint/Scratch", { local: () => ({ seen: 0 }) }, ({ local }) => {
      local.seen += 1
    })
    const game = makeGame()
    const erased = Game.Schedule(Scratch) as unknown as typeof simulate
    expect(() => game.runtime.checkpoint(erased)).toThrow("Checkpoint/Scratch keeps local state")
  })

  it("shows an entity the rewind took away and the re-run brought back as changed, not as despawned and spawned", () => {
    const Drop = Game.System("Checkpoint/Drop", {
      resources: { input: Game.System.readResource(Input) },
      commands: Game.System.commands(Game.System.spawns(Pos))
    }, ({ resources, commands }) => {
      commands.spawn(Game.Command.spawn([Pos, { x: resources.input.get() }]))
    })
    const drop = Game.Schedule(Capture, Drop, Game.Schedule.applyDeferred())
    const game = makeGame()
    const checkpoint = game.runtime.checkpoint(drop)
    game.source.value = 1
    expectOk(game.runtime.tick(drop))
    expectOk(game.runtime.tick(render))
    expect([...game.mirror.nodes]).toEqual([[1, 1]])
    expectOk(game.runtime.rewind(checkpoint))
    game.source.value = 2
    expectOk(game.runtime.tick(drop))
    expectOk(game.runtime.tick(render))
    expect([...game.mirror.nodes]).toEqual([[1, 2]])
    expect({ created: game.mirror.created, destroyed: game.mirror.destroyed }).toEqual({ created: 1, destroyed: 0 })
    // Rewound again and not brought back: now it is removed.
    expectOk(game.runtime.rewind(checkpoint))
    expectOk(game.runtime.tick(render))
    expect([...game.mirror.nodes]).toEqual([])
    expect(game.mirror.destroyed).toBe(1)
  })

  it("lets a reader outside the rewound schedule see one net change", () => {
    const reference = makeGame()
    const game = makeGame()
    for (let tick = 0; tick < 12; tick++) {
      reference.step(truth(tick))
      game.step(truth(tick))
      expectOk(reference.runtime.tick(render))
      expectOk(game.runtime.tick(render))
    }
    const checkpoint = game.runtime.checkpoint(simulate)
    // A wrong future, drawn.
    for (let tick = 0; tick < 6; tick++) {
      game.step(10 - tick)
      expectOk(game.runtime.tick(render))
    }
    const created = game.mirror.created
    expectOk(game.runtime.rewind(checkpoint))
    for (let tick = 12; tick < 18; tick++) {
      reference.step(truth(tick))
      game.step(truth(tick))
    }
    expectOk(reference.runtime.tick(render))
    expectOk(game.runtime.tick(render))
    // The mirror shows the world as it is now, and nothing that survived was destroyed and made again.
    expect([...game.mirror.nodes].sort(([a], [b]) => a - b)).toEqual([...reference.mirror.nodes].sort(([a], [b]) => a - b))
    const ids = new Set<number>(game.state().world.filter((entity) => entity.pos !== undefined).map((entity) => entity.id))
    expect([...game.mirror.nodes.keys()].every((id) => ids.has(id))).toBe(true)
    expect(game.mirror.created - created).toBeLessThanOrEqual(reference.mirror.created)
  })
})

// Numbers are kept unboxed, so a page can hold numbers and other values side
// by side: a rewind across a write that swaps one for the other puts back both.
describe("Runtime checkpoints of mixed pages", () => {
  const Charge = Descriptor.Component<number | "full">()("CheckpointMixed/Charge")
  const Turn = Descriptor.Resource<number>()("CheckpointMixed/Turn")
  const Mixed = Schema.bind(Schema.fragment({ components: { Charge }, resources: { Turn } }), Schema.defineRoot("CheckpointMixed"))

  const Setup = Mixed.System("CheckpointMixed/Setup", {
    commands: Mixed.System.commands(Mixed.System.spawns(Charge))
  }, ({ commands }) => {
    for (let index = 0; index < 4; index++) commands.spawn(Mixed.Command.spawn([Charge, index]))
  })
  const Step = Mixed.System("CheckpointMixed/Step", {
    resources: { turn: Mixed.System.writeResource(Turn) },
    queries: { all: Mixed.Query({ selection: { charge: Mixed.Query.write(Charge) } }) }
  }, ({ resources, queries }) => {
    const turn = resources.turn.get() + 1
    resources.turn.set(turn)
    for (const { entity, data } of queries.all.each()) {
      // Each entity alternates between a number and "full", out of step with the others.
      data.charge.set((entity.id + turn) % 2 === 0 ? "full" : entity.id * 10 + turn)
    }
  })
  const simulate = Mixed.Schedule(Step)
  const ReadCharges = Mixed.Inspector("CheckpointMixed/Read", {
    queries: { all: Mixed.Query({ selection: { charge: Mixed.Query.read(Charge) } }) }
  }, ({ queries }) => queries.all.each().map(({ entity, data }) => [entity.id, data.charge.get()] as const))

  const make = () => {
    const runtime = Mixed.Runtime.make({ services: Mixed.Runtime.services(), resources: { Turn: 0 } }).value
    expectOk(runtime.tick(Mixed.Schedule(Setup, Mixed.Schedule.applyDeferred())))
    return runtime
  }

  it("puts back numbers and other values a committed write swapped", () => {
    const reference = make()
    const runtime = make()
    for (let tick = 0; tick < 3; tick++) {
      expectOk(reference.tick(simulate))
      expectOk(runtime.tick(simulate))
    }
    const before = runtime.inspect(ReadCharges)
    const checkpoint = runtime.checkpoint(simulate)
    for (let tick = 0; tick < 3; tick++) expectOk(runtime.tick(simulate))
    expect(runtime.inspect(ReadCharges)).not.toEqual(before)

    expectOk(runtime.rewind(checkpoint))
    expect(runtime.inspect(ReadCharges)).toEqual(before)
    for (let tick = 0; tick < 3; tick++) {
      expectOk(reference.tick(simulate))
      expectOk(runtime.tick(simulate))
    }
    expect(runtime.inspect(ReadCharges)).toEqual(reference.inspect(ReadCharges))
  })

  it("puts back a number and an object swapped within one run", () => {
    // Each slot stores a number unboxed and any other value as it is, so a rewind has both kinds to put back.
    const MixedRoot = Schema.defineRoot("CheckpointSwap")
    const Target = Descriptor.Component<number | { readonly x: number }>()("CheckpointSwap/Target")
    const Turn = Descriptor.Resource<number>()("CheckpointSwap/Turn")
    const Mixed = Schema.bind(Schema.fragment({ components: { Target }, resources: { Turn } }), MixedRoot)
    const Swap = Mixed.System("CheckpointSwap/Swap", {
      resources: { turn: Mixed.System.writeResource(Turn) },
      queries: { targets: Mixed.Query({ selection: { target: Mixed.Query.write(Target) } }) },
      commands: Mixed.System.commands(Mixed.System.spawns(Target))
    }, ({ resources, queries, commands }) => {
      const turn = resources.turn.get() + 1
      resources.turn.set(turn)
      if (turn === 1) {
        commands.spawn(Mixed.Command.spawn([Target, 0]))
        commands.spawn(Mixed.Command.spawn([Target, { x: 0 }]))
        return
      }
      for (const { entity, data } of queries.targets.each()) {
        const n = turn * 10 + entity.id
        // Within one run: a number then an object, an object then a number, or a number alone.
        if (turn % 3 === 0) {
          data.target.set(n)
          data.target.set({ x: n })
        } else if (turn % 3 === 1) {
          data.target.set({ x: n })
          data.target.set(n)
        } else data.target.set(n + 0.5)
      }
    })
    const ReadTargets = Mixed.Inspector("CheckpointSwap/Read", {
      queries: { targets: Mixed.Query({ selection: { target: Mixed.Query.read(Target) } }) }
    }, ({ queries }) => queries.targets.each().map(({ entity, data }) => [entity.id, data.target.get()] as const))
    const schedule = Mixed.Schedule(Swap, Mixed.Schedule.applyDeferred())
    const runtime = Mixed.Runtime.make({ services: Mixed.Runtime.services(), resources: { Turn: 0 }, debug: { hostClock: HostClock.test() } }).value

    expectOk(runtime.tick(schedule))
    // A checkpoint before every tick, and what each tick left: turns 2 to 7 cover every kind of write over every kind.
    const checkpoints: Array<Checkpoint.Checkpoint<typeof MixedRoot>> = []
    const states: Array<unknown> = [runtime.inspect(ReadTargets)]
    for (let tick = 0; tick < 6; tick++) {
      checkpoints.push(runtime.checkpoint(schedule))
      expectOk(runtime.tick(schedule))
      states.push(runtime.inspect(ReadTargets))
    }
    expect(states[1]).toEqual([[1, 21.5], [2, 22.5]])
    // Newest first, since a rewind releases the checkpoints after it.
    for (const at of [4, 3, 0]) {
      expectOk(runtime.rewind(checkpoints[at]!))
      expect(runtime.inspect(ReadTargets)).toEqual(states[at])
      for (let tick = at; tick < 6; tick++) {
        if (tick > at) checkpoints[tick] = runtime.checkpoint(schedule)
        expectOk(runtime.tick(schedule))
        expect(runtime.inspect(ReadTargets)).toEqual(states[tick + 1])
      }
    }
  })
})
