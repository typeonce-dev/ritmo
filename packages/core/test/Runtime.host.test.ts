import { describe, expect, it } from "vitest"
import { Decode, Descriptor, Entity, HostClock, Result, Schema } from "@typeonce/ritmo"
import * as Runtime from "@typeonce/ritmo/Runtime"
import { worldOf } from "./world-of.ts"

const hostClock = HostClock.test()

const Ping = Descriptor.Event<number>()("Host/Ping")
const Ready = Descriptor.TransientResource<boolean>()("Host/Ready")
const Count = Descriptor.ConstructedResource(Decode.number)("Host/Count")
const Game = Schema.bind(Schema.fragment({ events: { Ping }, resources: { Ready, Count } }))
const Flow = Game.StateMachine("Host/Flow", ["Playing", "Menu"])
const ready = Game.Condition.check("Host/Ready", { resources: { ready: Game.System.readResource(Ready) } }, ({ resources }) => resources.ready.get())
const playing = Game.Condition.inState(Flow, "Playing")
const make = () => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: { Ready: true, Count: 0 },
    machines: Game.Runtime.machines(Game.Runtime.machine(Flow, "Playing")),
    debug: { hostClock }
  })
  if (made._tag === "Failure") throw new Error("invalid fixture")
  return made.success
}
const setReady = (value: boolean) => Game.System(`Host/Ready/${value}`, { resources: { ready: Game.System.writeResource(Ready) } }, ({ resources }) => { resources.ready.set(value) })
const setFlow = (value: "Playing" | "Menu") => Game.System(`Host/Flow/${value}`, { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => { nextMachines.flow.set(value) })
const read = (name: string, log: Array<ReadonlyArray<number>>) => Game.System(name, { events: { ping: Game.System.readEvent(Ping) } }, ({ events }) => { log.push(events.ping.all()) })

describe("host events and pause gates", () => {
  it.each(["when-outside", "pause-outside"])("holds a pause backlog and discards it across a mode change: %s", (order) => {
    const runtime = make()
    const seen: Array<ReadonlyArray<number>> = []
    const reader = read("Host/Read", seen)
    const gated = order === "when-outside"
      ? Game.Schedule.when([playing], Game.Schedule.pauseWhen([ready], reader))
      : Game.Schedule.pauseWhen([ready], Game.Schedule.when([playing], reader))
    runtime.tick(gated)
    runtime.tick(Game.Schedule(setReady(false)))
    runtime.send(Ping, 1)
    for (let index = 0; index < 4; index++) runtime.tick(gated)
    runtime.tick(Game.Schedule(setReady(true), gated))
    expect(seen).toEqual([[], [1]])
    runtime.tick(Game.Schedule(setReady(false)))
    runtime.send(Ping, 2)
    runtime.tick(gated)
    runtime.tick(Game.Schedule(setFlow("Menu"), Game.Schedule.applyStateTransitions(), gated))
    runtime.tick(Game.Schedule(setFlow("Playing"), Game.Schedule.applyStateTransitions(), setReady(true), gated))
    expect(seen).toEqual([[], [1], []])
  })

  it("discards events even when the first run is skipped", () => {
    const runtime = make()
    const seen: Array<ReadonlyArray<number>> = []
    const gated = Game.Schedule.when([ready], read("Host/InitiallySkipped", seen))
    runtime.send(Ping, 3)
    runtime.tick(Game.Schedule(setReady(false), gated))
    runtime.tick(Game.Schedule(setReady(true), gated))
    expect(seen).toEqual([[]])
  })

  it("registers a reader during its first pause and traces held skips", () => {
    const runtime = make()
    const seen: Array<ReadonlyArray<number>> = []
    const traces: Array<boolean> = []
    runtime.debug.observe((event) => { if (event.type === "system.skipped") traces.push(event.held) })
    const gated = Game.Schedule.pauseWhen([ready], read("Host/InitiallyPaused", seen))
    runtime.tick(Game.Schedule(setReady(false), gated))
    runtime.send(Ping, 4)
    for (let index = 0; index < 4; index++) runtime.tick(gated)
    runtime.tick(Game.Schedule(setReady(true), gated))
    expect(seen).toEqual([[4]])
    expect(traces).toEqual([true, true, true, true, true])
  })

  it("reports capacity loss after a long pause", () => {
    const runtime = make()
    const seen: Array<{ count: number; lagged: boolean }> = []
    const reader = Game.System("Host/Lagged", { events: { ping: Game.System.readEvent(Ping) } }, ({ events }) => { seen.push({ count: events.ping.all().length, lagged: events.ping.lagged() }) })
    const gated = Game.Schedule.pauseWhen([ready], reader)
    runtime.tick(Game.Schedule(setReady(false), gated))
    for (let value = 0; value <= Runtime.streamCapacity; value++) runtime.send(Ping, value)
    runtime.tick(Game.Schedule(setReady(true), gated))
    runtime.tick(gated)
    expect(seen).toEqual([{ count: Runtime.streamCapacity, lagged: true }, { count: 0, lagged: false }])
  })

  it("delivers a host event once to fixed and render readers at different rates", () => {
    const runtime = make()
    const fixedLog: Array<ReadonlyArray<number>> = []
    const renderLog: Array<ReadonlyArray<number>> = []
    const fixed = Game.Schedule(read("Host/Fixed", fixedLog))
    const render = Game.Schedule(read("Host/Render", renderLog))
    runtime.tick(fixed, render)
    runtime.send(Ping, 5)
    for (let index = 0; index < 4; index++) runtime.tick(render)
    runtime.tick(fixed)
    runtime.tick(fixed)
    expect(fixedLog).toEqual([[], [5], []])
    expect(renderLog).toEqual([[], [5], [], [], []])
  })

  it("rejects unknown descriptors and sends from inside a tick, including trace callbacks", () => {
    const runtime = make()
    const Unknown = Descriptor.Event<number>()("Host/Unknown")
    const erasedSend = runtime.send as (event: typeof Unknown, value: number) => void
    expect(() => erasedSend(Unknown, 1)).toThrow("not an event")
    const sendInside = Game.System("Host/SendInside", {}, () => runtime.send(Ping, 1))
    expect(() => runtime.tick(Game.Schedule(sendInside))).toThrow("while a schedule is running")
    const stop = runtime.debug.observe((event) => { if (event.type === "frame") runtime.send(Ping, 2) })
    expect(() => runtime.tick(Game.Schedule())).toThrow("while a schedule is running")
    stop()
    expect(() => runtime.send(Ping, 3)).not.toThrow()
  })

  it("rejects snapshot and restore from inside a tick, including trace callbacks", () => {
    const runtime = make()
    const saved = worldOf(runtime.snapshot())
    const snapshotInside = Game.System("Host/SnapshotInside", {}, () => { runtime.snapshot() })
    const restoreInside = Game.System("Host/RestoreInside", {}, () => { runtime.restore(saved) })
    expect(() => runtime.tick(Game.Schedule(snapshotInside))).toThrow("runtime.snapshot was called while a schedule is running")
    expect(() => runtime.tick(Game.Schedule(restoreInside))).toThrow("runtime.restore was called while a schedule is running")
    expect(() => runtime.tryTick(Game.Schedule(restoreInside))).toThrow("runtime.restore was called while a schedule is running")
    const sendInside = Game.System("Host/SendInsideTry", {}, () => runtime.send(Ping, 1))
    expect(() => runtime.tryTick(Game.Schedule(sendInside))).toThrow("while a schedule is running")
    const stop = runtime.debug.observe((event) => { if (event.type === "frame") runtime.restore(saved) })
    expect(() => runtime.tick(Game.Schedule())).toThrow("while a schedule is running")
    stop()
    expect(runtime.restore(saved)).toEqual({ _tag: "Success", success: undefined })
  })

  it("preserves unread host sends through restore without replaying already consumed sends or simulation events", () => {
    const runtime = make()
    const fastLog: Array<ReadonlyArray<number>> = []
    const slowLog: Array<ReadonlyArray<number>> = []
    const fast = Game.Schedule(read("Host/Fast", fastLog))
    const slow = Game.Schedule(read("Host/Slow", slowLog))
    const emitter = Game.System("Host/Emit", { events: { ping: Game.System.writeEvent(Ping) } }, ({ events }) => events.ping.emit(8))
    runtime.tick(fast, slow)
    runtime.send(Ping, 6)
    runtime.tick(fast)
    runtime.tick(Game.Schedule(emitter))
    const saved = worldOf(runtime.snapshot())
    expect(runtime.restore(saved)._tag).toBe("Success")
    runtime.tick(fast, slow)
    runtime.tick(fast, slow)
    expect(fastLog).toEqual([[], [6], [], []])
    expect(slowLog).toEqual([[], [6], []])
  })

  it("reports external event producers to the debug lints", () => {
    const runtime = make()
    const reader = read("Host/ReadLint", [])
    const emitter = Game.System("Host/WriteLint", { events: { ping: Game.System.writeEvent(Ping) } }, ({ events }) => events.ping.emit(1))
    runtime.debug.nameSchedules({ update: Game.Schedule(reader, emitter) })
    expect(runtime.debug.describe().lints.some((lint) => lint.code === "read-before-write")).toBe(true)
    runtime.send(Ping, 9)
    const described = runtime.debug.describe()
    expect(described.access.events[0]?.writers).toContain("runtime.send")
    expect(described.lints.some((lint) => lint.code === "read-before-write" || lint.code === "event-never-written")).toBe(false)
  })
})

describe("system local state", () => {
  it("keeps separate definitions independent even when their names match", () => {
    const seen: Array<number> = []
    const define = () => Game.System("Host/SameName", { local: () => ({ runs: 0 }) }, ({ local }) => { seen.push(++local.runs) })
    const first = define()
    const second = define()
    const runtime = make()
    runtime.tick(Game.Schedule(first, second))
    runtime.tick(Game.Schedule(first, second))
    expect(seen).toEqual([1, 1, 2, 2])
  })

  it("initializes on first encounter even while paused, and preserves state across gate changes", () => {
    let factories = 0
    const seen: Array<number> = []
    const system = Game.System("Host/GatedLocal", { local: () => { factories++; return { runs: 0 } } }, ({ local }) => { seen.push(++local.runs) })
    const runtime = make()
    const gated = Game.Schedule.when([playing], Game.Schedule.pauseWhen([ready], system))
    runtime.tick(Game.Schedule(setReady(false), gated))
    expect(factories).toBe(1)
    expect(seen).toEqual([])
    runtime.tick(Game.Schedule(setReady(true), gated))
    runtime.tick(Game.Schedule(setFlow("Menu"), Game.Schedule.applyStateTransitions(), gated))
    runtime.tick(Game.Schedule(setFlow("Playing"), Game.Schedule.applyStateTransitions(), gated))
    expect(factories).toBe(1)
    expect(seen).toEqual([1, 2])
  })

  it("retries initialization after a factory throws without installing a partial slot", () => {
    let factories = 0
    const seen: Array<number> = []
    const system = Game.System("Host/RetryFactory", { local: () => {
      if (++factories === 1) throw new Error("initialization failed")
      return { runs: 0 }
    } }, ({ local }) => { seen.push(++local.runs) })
    const runtime = make()
    expect(() => runtime.tick(Game.Schedule(system))).toThrow("initialization failed")
    runtime.tick(Game.Schedule(system))
    runtime.tick(Game.Schedule(system))
    expect(factories).toBe(2)
    expect(seen).toEqual([1, 2])
  })

  it("is per runtime, shared by gated copies, and excluded from rollback and snapshots", () => {
    let factories = 0
    const seen: Array<number> = []
    const system = Game.System("Host/Local", {
      local: () => { factories++; return { runs: 0 } },
      resources: { count: Game.System.writeResource(Count) }
    }, ({ local, resources }) => {
      seen.push(++local.runs)
      resources.count.set(99)
      return Result.fail("retry" as const)
    })
    const first = make()
    const second = make()
    first.tick(Game.Schedule(system))
    first.tick(Game.Schedule.when([ready], Game.Schedule.pauseWhen([playing], system)))
    second.tick(Game.Schedule(system))
    expect(seen).toEqual([1, 2, 1])
    expect(factories).toBe(2)
    expect(worldOf(first.snapshot()).resources).toEqual({ "Host/Count": 0 })
    first.debug.nameSchedules({ update: Game.Schedule(system) })
    expect(first.debug.describe().systems[0]?.local).toBe(true)
    expect(first.restore(null)._tag).toBe("Failure")
    expect(factories).toBe(2)
    expect(first.restore(worldOf(first.snapshot()))._tag).toBe("Success")
    first.tick(Game.Schedule(system))
    expect(seen).toEqual([1, 2, 1, 1])
    expect(factories).toBe(3)
  })

  it("leaves the world untouched if a local factory throws during restore", () => {
    const runtime = make()
    let fail = false
    const system = Game.System("Host/ThrowingFactory", { local: () => { if (fail) throw new Error("factory failed"); return {} } }, () => {})
    runtime.tick(Game.Schedule(system))
    const saved = worldOf(runtime.snapshot())
    fail = true
    expect(() => runtime.restore({ ...saved, resources: { "Host/Count": 100 } })).toThrow("factory failed")
    expect(worldOf(runtime.snapshot())).toEqual(saved)
  })

  it("keeps every existing local if a later factory throws during restore", () => {
    let fail = false
    const seen: Array<{ runs: number }> = []
    const first = Game.System("Host/FirstLocal", { local: () => ({ runs: 0 }) }, ({ local }) => { local.runs++; seen.push(local) })
    const second = Game.System("Host/SecondLocal", { local: () => {
      if (fail) throw new Error("second factory failed")
      return { runs: 0 }
    } }, ({ local }) => { local.runs++; seen.push(local) })
    const runtime = make()
    const schedule = Game.Schedule(first, second)
    runtime.tick(schedule)
    const saved = worldOf(runtime.snapshot())
    fail = true
    expect(() => runtime.restore(saved)).toThrow("second factory failed")
    expect(worldOf(runtime.snapshot())).toEqual(saved)
    runtime.tick(schedule)
    expect(seen[2]).toBe(seen[0])
    expect(seen[3]).toBe(seen[1])
    expect(seen.map((local) => local.runs)).toEqual([2, 2, 2, 2])
    fail = false
    expect(runtime.restore(saved)._tag).toBe("Success")
    runtime.tick(schedule)
    expect(seen[4]).not.toBe(seen[0])
    expect(seen[5]).not.toBe(seen[1])
    expect(seen.slice(4).map((local) => local.runs)).toEqual([1, 1])
  })
})

describe("numeric handles", () => {
  it("brands without allocating and compares by entity identity in sets", () => {
    const id = Entity.makeEntityId(7)
    const first = Entity.handle(id)
    const second = Entity.handle(id)
    expect(first).toBe(id)
    expect(second).toBe(first)
    expect(new Set([first, second]).size).toBe(1)
    expect(JSON.stringify(first)).toBe("7")
  })
})
