import { describe, expect, it } from "vitest"
import { Debug, Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"

const hostClock = HostClock.test()

const Position = Descriptor.Component<{ readonly x: number }>()("Stepping/Position")
const Ping = Descriptor.Event<number>()("Stepping/Ping")
const Clock = Descriptor.Service<{ readonly now: () => number }>()("Stepping/Clock")
const Game = Schema.bind(Schema.fragment({ components: { Position }, events: { Ping } }))
const Flow = Game.StateMachine("Stepping/Flow", { Menu: {}, Playing: {} })

const Spawn = Game.System("Stepping/Spawn", { commands: Game.System.commands(Game.System.spawns(Position)) }, ({ commands }) => {
  commands.spawn(Game.Command.spawn([Position, { x: 0 }]))
})
const Move = Game.System("Stepping/Move", {
  queries: { movers: Game.Query({ selection: { position: Game.Query.write(Position) } }) },
  events: { ping: Game.System.writeEvent(Ping) }
}, ({ queries, events }) => {
  for (const match of queries.movers.each()) match.data.position.update((position) => ({ x: position.x + 1 }))
  events.ping.emit(1)
})
const Seen: Array<number> = []
const Listen = Game.System("Stepping/Listen", { events: { ping: Game.System.readEvent(Ping) } }, ({ events }) => {
  Seen.push(events.ping.all().length)
})
const Play = Game.System("Stepping/Play", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
  nextMachines.flow.set({ _tag: "Playing" })
})
const update = Game.Schedule(Spawn, Game.Schedule.applyDeferred(), Move, Listen, Play, Game.Schedule.applyStateTransitions())

const makeRuntime = () => Game.Runtime.make({
  services: Game.Runtime.services(),
  machines: Game.Runtime.machines(Game.Runtime.machine(Flow, { _tag: "Menu" })),
  debug: { hostClock }
}).value

const stepAll = (cursor: Debug.FrameCursor): void => {
  while (cursor.remaining().length > 0) {
    const result = cursor.next()
    if (!result.ok) return
  }
}

describe("debug.beginFrame", () => {
  it("runs one frame step by step with the trace and host events of a tick", () => {
    const record = (drive: (runtime: ReturnType<typeof makeRuntime>) => void) => {
      const runtime = makeRuntime()
      runtime.debug.nameSchedules({ update })
      const trace: Array<Debug.TraceEvent> = []
      const host: Array<string> = []
      runtime.debug.observe((event) => trace.push(event))
      runtime.debug.observeHost((event) => host.push(event.type === "tick.end" ? `tick.end ${event.outcome}` : event.type))
      drive(runtime)
      return { trace, host, dump: runtime.debug.dump(), frame: runtime.debug.frame() }
    }
    const ticked = record((runtime) => {
      runtime.tick(update)
      runtime.tick(update)
    })
    const stepped = record((runtime) => {
      for (let frame = 0; frame < 2; frame++) {
        const begun = runtime.debug.beginFrame(update)
        if (!begun.ok) throw new Error("did not begin")
        expect(begun.value.frame).toBe(frame + 1)
        stepAll(begun.value)
      }
    })
    expect(stepped).toEqual(ticked)
    expect(stepped.host).toEqual(["tick.start", "tick.end ok", "tick.start", "tick.end ok"])
  })

  it("pauses between steps: commands apply at their marker, readers see what was published before them", () => {
    const runtime = makeRuntime()
    const begun = runtime.debug.beginFrame(update)
    if (!begun.ok) throw new Error("did not begin")
    const cursor = begun.value
    expect(cursor.remaining().map((step) => step.kind === "system" ? step.system : step.kind)).toEqual([
      "Stepping/Spawn", "applyDeferred", "Stepping/Move", "Stepping/Listen", "Stepping/Play", "applyStateTransitions"
    ])
    expect(cursor.next()).toEqual(Result.success({ step: { kind: "system", system: "Stepping/Spawn" }, ended: false }))
    expect(runtime.debug.dump()).toMatchObject({ entityCount: 0, pendingCommands: [{ system: "Stepping/Spawn" }] })
    cursor.next()
    expect(runtime.debug.dump()).toMatchObject({ entityCount: 1, pendingCommands: [] })
    cursor.next()
    expect(runtime.debug.dump().entities[0]?.components).toEqual({ "Stepping/Position": { x: 1 } })
    Seen.length = 0
    cursor.next()
    expect(Seen).toEqual([1])
    cursor.next()
    expect(runtime.debug.dump().machines["Stepping/Flow"]).toMatchObject({ current: { _tag: "Menu" }, pending: { _tag: "Playing" } })
    expect(cursor.next()).toEqual(Result.success({ step: { kind: "applyStateTransitions", schedules: [] }, ended: true }))
    expect(runtime.debug.dump().machines["Stepping/Flow"]?.current).toEqual({ _tag: "Playing" })
    expect(cursor.remaining()).toEqual([])
    expect(() => cursor.next()).toThrow(/after the frame ended/)
  })

  it("refuses everything that would interleave with the open frame", () => {
    const runtime = makeRuntime()
    const begun = runtime.debug.beginFrame(update)
    if (!begun.ok) throw new Error("did not begin")
    begun.value.next()
    expect(() => runtime.tick(update)).toThrow(/runtime\.tick was called while a stepped frame is open/)
    expect(() => runtime.tryTick(update)).toThrow(/runtime\.tryTick was called while a stepped frame is open/)
    expect(() => runtime.send(Ping, 1)).toThrow(/runtime\.send\(Stepping\/Ping\) was called while a stepped frame is open/)
    expect(() => runtime.checkpoint(update)).toThrow(/runtime\.checkpoint was called while a stepped frame is open/)
    expect(() => runtime.debug.beginFrame(update)).toThrow(/debug\.beginFrame was called while a stepped frame is open/)
    // Reading the world stays possible.
    expect(runtime.debug.dump().pendingCommands).toHaveLength(1)
    stepAll(begun.value)
    expect(runtime.tryTick(update).ok).toBe(true)
  })

  it("ends the frame at a failing system or a thrown defect", () => {
    const Fail = Game.System("Stepping/Fail", {}, () => Result.failure("Broken" as const))
    const Throw = Game.System("Stepping/Throw", {}, () => {
      throw new Error("kaboom")
    })
    const runtime = makeRuntime()
    const failing = runtime.debug.beginFrame(Game.Schedule(Move, Fail, Listen))
    if (!failing.ok) throw new Error("did not begin")
    failing.value.next()
    expect(failing.value.next()).toMatchObject({ ok: false, error: { kind: "SystemFailure", system: "Stepping/Fail", error: "Broken" } })
    expect(failing.value.remaining()).toEqual([])
    const throwing = runtime.debug.beginFrame(Game.Schedule(Throw, Listen))
    if (!throwing.ok) throw new Error("did not begin")
    expect(() => throwing.value.next()).toThrow("kaboom")
    expect(throwing.value.remaining()).toEqual([])
    expect(runtime.tryTick(update).ok).toBe(true)
  })

  it("fails without beginning a frame when requirements are missing, as tryTick does", () => {
    const Timed = Game.System("Stepping/Timed", { services: { clock: Game.System.service(Clock) } }, () => {})
    const runtime = makeRuntime()
    const begun = runtime.debug.beginFrame(Game.Schedule(Timed))
    expect(begun).toMatchObject({ ok: false, error: { kind: "MissingRuntimeRequirements", requirements: [{ kind: "service", name: "Stepping/Clock" }] } })
    expect(runtime.debug.frame()).toBe(0)
    expect(runtime.tryTick(update).ok).toBe(true)
  })

  it("ends an empty schedule's frame at once", () => {
    const runtime = makeRuntime()
    const begun = runtime.debug.beginFrame(Game.Schedule())
    if (!begun.ok) throw new Error("did not begin")
    expect(begun.value.remaining()).toEqual([])
    expect(runtime.tick(update).ok).toBe(true)
    expect(runtime.debug.frame()).toBe(2)
  })
})
