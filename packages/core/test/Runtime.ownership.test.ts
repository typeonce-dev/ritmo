import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import * as Codecs from "./codecs.ts"

// A game's own types are often mutable; the world owns what it is handed.
interface Body { x: number; trail: Array<{ x: number }> }

const BodyC = Descriptor.Component<Body>()("Ownership/Body")
const Samples = Descriptor.Component<{ readonly samples: Float32Array }>()("Ownership/Samples")
const Tuning = Descriptor.Resource<{ speed: number }>()("Ownership/Tuning")
const Hit = Descriptor.Event<{ x: number }>()("Ownership/Hit")

const Game = Schema.bind(Schema.fragment({
  components: { Body: BodyC, Samples },
  resources: { Tuning },
  events: { Hit }
}))
const Mode = Game.StateMachine("Ownership/Mode", { Idle: {}, Moving: Codecs.struct({ speed: Codecs.number }) })

const makeRuntime = (debug: boolean, tuning = { speed: 1 }) => Game.Runtime.make({
  services: Game.Runtime.services(),
  resources: { Tuning: tuning },
  machines: Game.Runtime.machines(Game.Runtime.machine(Mode, { _tag: "Idle" })),
  ...(debug ? { debug: { hostClock: HostClock.test() } } : {})
}).value

const spawning = (body: Body) => Game.System("Ownership/Spawn", {
  commands: Game.System.commands(Game.System.spawns(BodyC))
}, ({ commands }) => {
  commands.spawn(Game.Command.spawn([BodyC, body]))
})

const setting = (body: Body) => Game.System("Ownership/Set", {
  queries: { bodies: Game.Query({ selection: { body: Game.Query.write(BodyC) } }) }
}, ({ queries }) => {
  for (const { data } of queries.bodies.each()) data.body.set(body)
})

const ReadX = Game.Inspector("Ownership/ReadX", {
  queries: { bodies: Game.Query({ selection: { body: Game.Query.read(BodyC) } }) }
}, ({ queries }) => queries.bodies.each().map(({ data }) => data.body.get().x))

describe("values handed to the world", () => {
  it("are frozen in a debug runtime, so mutating a spawned value throws where it mutates", () => {
    const runtime = makeRuntime(true)
    const body: Body = { x: 1, trail: [] }
    runtime.tick(Game.Schedule(spawning(body), Game.Schedule.applyDeferred()))

    expect(() => { body.x = 99 }).toThrow(TypeError)
    expect(() => body.trail.push({ x: 5 })).toThrow(TypeError)
    expect(runtime.inspect(ReadX)).toEqual([1])
  })

  it("are frozen when queued, before the marker applies them", () => {
    const runtime = makeRuntime(true)
    const body: Body = { x: 1, trail: [] }
    runtime.tick(Game.Schedule(spawning(body)))

    expect(() => { body.x = 99 }).toThrow(TypeError)
  })

  it("are frozen when written through a cell", () => {
    const runtime = makeRuntime(true)
    const next: Body = { x: 2, trail: [{ x: 0 }] }
    runtime.tick(Game.Schedule(spawning({ x: 1, trail: [] }), Game.Schedule.applyDeferred(), setting(next)))

    expect(() => { next.x = 99 }).toThrow(TypeError)
    expect(() => { next.trail[0]!.x = 99 }).toThrow(TypeError)
    expect(runtime.inspect(ReadX)).toEqual([2])
  })

  it("keep a rewind exact: the mutation that would have changed the checkpoint throws", () => {
    const runtime = makeRuntime(true)
    const first: Body = { x: 1, trail: [] }
    runtime.tick(Game.Schedule(spawning(first), Game.Schedule.applyDeferred()))
    const simulate = Game.Schedule(setting({ x: 2, trail: [] }))
    const checkpoint = runtime.checkpoint(simulate)
    runtime.tick(simulate)

    expect(() => { first.x = 777 }).toThrow(TypeError)
    expect(runtime.rewind(checkpoint).ok).toBe(true)
    expect(runtime.inspect(ReadX)).toEqual([1])
  })

  it("can be replaced by a new value built from the frozen one", () => {
    const runtime = makeRuntime(true)
    const Move = Game.System("Ownership/Move", {
      queries: { bodies: Game.Query({ selection: { body: Game.Query.write(BodyC) } }) }
    }, ({ queries }) => {
      for (const { data } of queries.bodies.each()) data.body.update((body) => ({ ...body, x: body.x + 1 }))
    })
    runtime.tick(Game.Schedule(spawning({ x: 1, trail: [{ x: 0 }] }), Game.Schedule.applyDeferred(), Move))
    runtime.tick(Game.Schedule(Move))

    expect(runtime.inspect(ReadX)).toEqual([3])
  })

  it("freeze resources, events, and machine values", () => {
    const tuning = { speed: 1 }
    const runtime = makeRuntime(true, tuning)
    expect(() => { tuning.speed = 2 }).toThrow(TypeError)

    const next = { speed: 3 }
    const hit = { x: 4 }
    const moving = { _tag: "Moving" as const, speed: 5 }
    const Write = Game.System("Ownership/Write", {
      resources: { tuning: Game.System.writeResource(Tuning) },
      events: { hit: Game.System.writeEvent(Hit) },
      nextMachines: { mode: Game.System.nextState(Mode) }
    }, ({ resources, events, nextMachines }) => {
      resources.tuning.set(next)
      events.hit.emit(hit)
      nextMachines.mode.set(moving)
    })
    runtime.tick(Game.Schedule(Write))

    expect(() => { next.speed = 0 }).toThrow(TypeError)
    expect(() => { hit.x = 0 }).toThrow(TypeError)
    expect(() => { moving.speed = 0 }).toThrow(TypeError)

    const sent = { x: 6 }
    runtime.send(Hit, sent)
    expect(() => { sent.x = 0 }).toThrow(TypeError)
  })

  it("skip typed arrays, which cannot be frozen", () => {
    const runtime = makeRuntime(true)
    const samples = new Float32Array([1, 2])
    const Spawn = Game.System("Ownership/SpawnSamples", {
      commands: Game.System.commands(Game.System.spawns(Samples))
    }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Samples, { samples }]))
    })

    expect(runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred())).ok).toBe(true)
  })

  it("are not frozen without debug", () => {
    const tuning = { speed: 1 }
    const runtime = makeRuntime(false, tuning)
    const body: Body = { x: 1, trail: [] }
    runtime.tick(Game.Schedule(spawning(body), Game.Schedule.applyDeferred()))

    expect(Object.isFrozen(body)).toBe(false)
    expect(Object.isFrozen(tuning)).toBe(false)
  })
})
