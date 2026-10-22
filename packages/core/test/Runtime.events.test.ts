import { describe, expect, it } from "vitest"
import { Descriptor, Result, Schema } from "@typeonce/ritmo"
import * as Runtime from "@typeonce/ritmo/Runtime"

const Ping = Descriptor.Event<{ value: number }>()("Ping")
const Game = Schema.bind(Schema.fragment({ events: { Ping } }))

const makeRuntime = () => Game.Runtime.make({ services: Game.Runtime.services() }).success

const emitter = (name: string, values: ReadonlyArray<number>) =>
  Game.System(name, { events: { ping: Game.System.writeEvent(Ping) } }, ({ events }) => {
    for (const value of values) events.ping.emit({ value })
  })

const reader = (name: string, log: Array<ReadonlyArray<number>>) =>
  Game.System(name, { events: { ping: Game.System.readEvent(Ping) } }, ({ events }) => {
    log.push(events.ping.all().map((event) => event.value))
  })

describe("Runtime events", () => {
  it("delivers events to later systems in the same schedule without a marker", () => {
    const log: Array<ReadonlyArray<number>> = []
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(emitter("Events/Emit", [1, 2]), reader("Events/Read", log)))
    expect(log).toEqual([[1, 2]])
  })

  it("delivers events emitted after a reader ran on its next run", () => {
    const log: Array<ReadonlyArray<number>> = []
    const read = reader("Events/ReadFirst", log)
    const schedule = Game.Schedule(read, emitter("Events/EmitAfter", [7]))
    const runtime = makeRuntime()
    runtime.tick(schedule)
    runtime.tick(schedule)
    expect(log).toEqual([[], [7]])
  })

  it("delivers every event exactly once to each reader, independently", () => {
    const first: Array<ReadonlyArray<number>> = []
    const second: Array<ReadonlyArray<number>> = []
    const emit = emitter("Events/EmitOnce", [1])
    const readFirst = reader("Events/ReaderA", first)
    const readSecond = reader("Events/ReaderB", second)
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(emit, readFirst))
    runtime.tick(Game.Schedule(readFirst, readSecond))
    runtime.tick(Game.Schedule(readFirst, readSecond))
    expect(first).toEqual([[1], [], []])
    expect(second).toEqual([[1], []])
  })

  it("keeps emission order across systems and runs", () => {
    const log: Array<ReadonlyArray<number>> = []
    const read = reader("Events/ReadOrdered", log)
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(emitter("Events/EmitA", [1, 2]), emitter("Events/EmitB", [3])))
    runtime.tick(Game.Schedule(emitter("Events/EmitC", [4]), read))
    expect(log).toEqual([[1, 2, 3, 4]])
  })

  it("publishes nothing from a failed system and redelivers to a failed reader", () => {
    const log: Array<ReadonlyArray<number>> = []
    const failingEmit = Game.System("Events/FailingEmit", { events: { ping: Game.System.writeEvent(Ping) } }, ({ events }) => {
      events.ping.emit({ value: 9 })
      return Result.fail("Boom" as const)
    })
    let fail = true
    const flakyRead = Game.System("Events/FlakyRead", { events: { ping: Game.System.readEvent(Ping) } }, ({ events }) => {
      log.push(events.ping.all().map((event) => event.value))
      if (fail) {
        fail = false
        return Result.fail("NotYet" as const)
      }
      return Result.succeed(undefined)
    })
    const runtime = makeRuntime()
    expect(runtime.tick(Game.Schedule(failingEmit))._tag).toBe("Failure")
    expect(runtime.tick(Game.Schedule(emitter("Events/EmitValid", [1]), flakyRead))._tag).toBe("Failure")
    expect(runtime.tick(Game.Schedule(flakyRead))._tag).toBe("Success")
    expect(log).toEqual([[1], [1]])
  })

  it("lets a system read the events it emitted on its next run", () => {
    const log: Array<ReadonlyArray<number>> = []
    let next = 0
    const echo = Game.System("Events/Echo", {
      events: { read: Game.System.readEvent(Ping), write: Game.System.writeEvent(Ping) }
    }, ({ events }) => {
      log.push(events.read.all().map((event) => event.value))
      events.write.emit({ value: next++ })
    })
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(echo))
    runtime.tick(Game.Schedule(echo))
    runtime.tick(Game.Schedule(echo))
    expect(log).toEqual([[], [0], [1]])
  })

  it("holds events until every reading system has run, for schedules ticked at different rates", () => {
    const log: Array<ReadonlyArray<number>> = []
    let next = 0
    const emitEveryFrame = Game.System("Events/EmitPerFrame", { events: { ping: Game.System.writeEvent(Ping) } }, ({ events }) => {
      events.ping.emit({ value: next++ })
    })
    const fixed = Game.Schedule(reader("Events/FixedRead", log))
    const frame = Game.Schedule(emitEveryFrame)
    const runtime = makeRuntime()

    runtime.tick(fixed)
    // The fixed schedule runs only every third tick.
    for (let tick = 0; tick < 7; tick++) {
      runtime.tick(frame)
      if (tick % 3 === 2) runtime.tick(fixed)
    }
    runtime.tick(fixed)
    expect(log).toEqual([[], [0, 1, 2], [3, 4, 5], [6]])
  })

  it("keeps events no system has read yet for the current and previous tick only", () => {
    const log: Array<ReadonlyArray<number>> = []
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(emitter("Events/EmitUnread", [1])))
    runtime.tick(Game.Schedule())
    runtime.tick(Game.Schedule())
    runtime.tick(Game.Schedule(reader("Events/TooLate", log)))
    expect(log).toEqual([[]])
  })

  it("gives a new reader's first run the events still held for other readers", () => {
    const log: Array<ReadonlyArray<number>> = []
    const held = reader("Events/Holder", [])
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(held))
    runtime.tick(Game.Schedule(emitter("Events/EmitHeld", [2])))
    runtime.tick(Game.Schedule())
    runtime.tick(Game.Schedule())
    runtime.tick(Game.Schedule(reader("Events/Newcomer", log)))
    expect(log).toEqual([[2]])
  })

  it("discards events published while a reader is skipped by its run conditions", () => {
    const Local = Schema.bind(Schema.fragment({ events: { Ping } }))
    const Mode = Local.StateMachine("Events/Mode", ["On", "Off"])
    const log: Array<ReadonlyArray<number>> = []
    const gated = Local.System("Events/Gated", {
      when: [Local.Condition.inState(Mode, "On")],
      events: { ping: Local.System.readEvent(Ping) }
    }, ({ events }) => {
      log.push(events.ping.all().map((event) => event.value))
    })
    const emit = Local.System("Events/EmitGated", { events: { ping: Local.System.writeEvent(Ping) } }, ({ events }) => {
      events.ping.emit({ value: 1 })
    })
    const toggle = (value: "On" | "Off") => Local.System(`Events/Set${value}`, {
      nextMachines: { mode: Local.System.nextState(Mode) }
    }, ({ nextMachines }) => {
      nextMachines.mode.set(value)
    })
    const runtime = Local.Runtime.make({
      services: Local.Runtime.services(),
      machines: Local.Runtime.machines(Local.Runtime.machine(Mode, "On"))
    }).success
    runtime.tick(Local.Schedule(gated))
    runtime.tick(Local.Schedule(toggle("Off"), Local.Schedule.applyStateTransitions()))
    runtime.tick(Local.Schedule(emit, gated))
    runtime.tick(Local.Schedule(toggle("On"), Local.Schedule.applyStateTransitions(), gated))
    expect(log).toEqual([[], []])
  })

  it("drops the oldest events past the stream capacity and reports lagged readers", () => {
    const seen: Array<{ readonly count: number; readonly lagged: boolean }> = []
    const dormant = Game.System("Events/Dormant", { events: { ping: Game.System.readEvent(Ping) } }, ({ events }) => {
      seen.push({ count: events.ping.all().length, lagged: events.ping.lagged() })
    })
    const flood = Game.System("Events/Flood", { events: { ping: Game.System.writeEvent(Ping) } }, ({ events }) => {
      for (let index = 0; index <= Runtime.streamCapacity; index++) events.ping.emit({ value: index })
    })
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(dormant))
    runtime.tick(Game.Schedule(flood))
    runtime.tick(Game.Schedule(emitter("Events/After", [1])))
    runtime.tick(Game.Schedule(dormant))
    runtime.tick(Game.Schedule(dormant))
    expect(seen).toEqual([
      { count: 0, lagged: false },
      { count: 1, lagged: true },
      { count: 0, lagged: false }
    ])
  })

  it("does not hold events for inspectors, which report lagged instead", () => {
    const Peek = Game.Inspector("Events/Peek", { events: { ping: Game.System.readEvent(Ping) } }, ({ events }) => ({
      values: events.ping.all().map((event) => event.value),
      lagged: events.ping.lagged()
    }))
    const runtime = makeRuntime()
    expect(runtime.inspect(Peek)).toEqual({ values: [], lagged: false })
    runtime.tick(Game.Schedule(emitter("Events/EmitForPeek", [1])))
    expect(runtime.inspect(Peek)).toEqual({ values: [1], lagged: false })
    runtime.tick(Game.Schedule(emitter("Events/EmitMissed", [2])))
    runtime.tick(Game.Schedule())
    runtime.tick(Game.Schedule())
    expect(runtime.inspect(Peek)).toEqual({ values: [], lagged: true })
  })
})
