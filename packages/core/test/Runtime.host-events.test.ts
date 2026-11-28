import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"
import * as Runtime from "@typeonce/ritmo/Runtime"
import * as Codecs from "./codecs.ts"

const expectOk = (result: { readonly ok: boolean; readonly error?: unknown }): void => {
  expect(result.ok ? undefined : result.error).toBeUndefined()
}

const Ping = Descriptor.Event<{ readonly value: number }>()("HostEvents/Ping")
const Pong = Descriptor.Event<number>()("HostEvents/Pong")
const Count = Descriptor.ConstructedResource(Codecs.integer)("HostEvents/Count")
const Root = Schema.defineRoot("HostEvents")
const Game = Schema.bind(Schema.fragment({ events: { Ping, Pong }, resources: { Count } }), Root)

const makeRuntime = () => {
  const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Count: 0 } })
  if (!made.ok) throw new Error("the runtime did not build")
  return made.value
}
const makeDebugRuntime = () => {
  const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Count: 0 }, debug: { hostClock: HostClock.test() } })
  if (!made.ok) throw new Error("the runtime did not build")
  return made.value
}

/** Counts up and emits the new count: a tick run again after a rewind publishes the same value. */
const Counter = Game.System("HostEvents/Counter", {
  resources: { count: Game.System.writeResource(Count) },
  events: { ping: Game.System.writeEvent(Ping) }
}, ({ resources, events }) => {
  const next = resources.count.get() + 1
  resources.count.set(next)
  events.ping.emit({ value: next })
})
const step = Game.Schedule(Counter)

const values = (records: ReadonlyArray<Runtime.EventRecord<{ readonly value: number }>>) => records.map((record) => [record.tick, record.value.value])

describe("runtime.events", () => {
  it("holds every step of a frame until the host takes them, each once", () => {
    const runtime = makeRuntime()
    const pings = runtime.events(Ping)
    for (let index = 0; index < 4; index++) expectOk(runtime.tick(step))
    expect(values(pings.take())).toEqual([[1, 1], [2, 2], [3, 3], [4, 4]])
    expect(pings.take()).toEqual([])
    expectOk(runtime.tick(step))
    expect(values(pings.take())).toEqual([[5, 5]])
    expect(pings.lost()).toBeUndefined()
  })

  it("gives two readers every event each, and a reader made mid-run only later ones", () => {
    const runtime = makeRuntime()
    const first = runtime.events(Ping)
    expectOk(runtime.tick(step))
    const second = runtime.events(Ping)
    expectOk(runtime.tick(step))
    expect(values(first.take())).toEqual([[1, 1], [2, 2]])
    expect(values(second.take())).toEqual([[2, 2]])
    expectOk(runtime.tick(step))
    expect(values(second.take())).toEqual([[3, 3]])
    expect(values(first.take())).toEqual([[3, 3]])
  })

  it("hands out only its own event, and not what the host sent", () => {
    const runtime = makeRuntime()
    const pongs = runtime.events(Pong)
    const pings = runtime.events(Ping)
    runtime.send(Ping, { value: 100 })
    expectOk(runtime.tick(step))
    expect(values(pings.take())).toEqual([[1, 1]])
    expect(pongs.take()).toEqual([])
  })

  it("does not hand out the events of a failed tick", () => {
    const Fails = Game.System("HostEvents/Fails", {
      events: { ping: Game.System.writeEvent(Ping) }
    }, ({ events }) => {
      events.ping.emit({ value: -1 })
      return Result.failure("boom" as const)
    })
    const runtime = makeRuntime()
    const pings = runtime.events(Ping)
    expect(runtime.tick(Game.Schedule(Fails)).ok).toBe(false)
    expectOk(runtime.tick(step))
    expect(values(pings.take())).toEqual([[2, 1]])
  })

  it("reports ticks dropped past the window as lost, once", () => {
    const runtime = makeRuntime()
    const pings = runtime.events(Ping)
    const ticks = Runtime.eventWindow + 10
    for (let index = 0; index < ticks; index++) expectOk(runtime.tick(step))
    expect(pings.lost()).toEqual({ _tag: "EventsLost", from: 1, to: ticks - Runtime.eventWindow + 1, reason: "unread" })
    expect(pings.lost()).toBeUndefined()
    const kept = pings.take()
    expect(kept.length).toBe(Runtime.eventWindow)
    expect(kept[0]!.tick).toBe(ticks - Runtime.eventWindow + 1)
  })

  it("reports a tick that published more than the stream's capacity as lost", () => {
    const Flood = Game.System("HostEvents/Flood", { events: { pong: Game.System.writeEvent(Pong) } }, ({ events }) => {
      for (let index = 0; index < Runtime.streamCapacity + 1; index++) events.pong.emit(index)
    })
    const runtime = makeRuntime()
    const pongs = runtime.events(Pong)
    expectOk(runtime.tick(Game.Schedule(Flood)))
    // The host's sends trim the streams between ticks, before the reader copied the flood.
    runtime.send(Pong, 0)
    expect(pongs.take()).toEqual([])
    expect(pongs.lost()).toEqual({ _tag: "EventsLost", from: 1, to: 2, reason: "unread" })
  })

  it("drops what is unread on a restore, and reports it", () => {
    const runtime = makeRuntime()
    const pings = runtime.events(Ping)
    expectOk(runtime.tick(step))
    const saved = runtime.snapshot()
    expectOk(saved)
    if (!saved.ok) return
    expect(values(pings.take())).toEqual([[1, 1]])
    expectOk(runtime.tick(step))
    expectOk(runtime.tick(step))
    expectOk(runtime.restore(JSON.parse(JSON.stringify(saved.value))))
    expect(pings.take()).toEqual([])
    expect(pings.lost()).toEqual({ _tag: "EventsLost", from: 2, to: 4, reason: "restore" })
    expectOk(runtime.tick(step))
    expect(values(pings.take())).toEqual([[4, 2]])
    expect(pings.lost()).toBeUndefined()
  })

  it("reports nothing for a restore with nothing unread", () => {
    const runtime = makeRuntime()
    const pings = runtime.events(Ping)
    expectOk(runtime.tick(step))
    const saved = runtime.snapshot()
    if (!saved.ok) throw new Error("snapshot failed")
    pings.take()
    expectOk(runtime.restore(saved.value))
    expect(pings.lost()).toBeUndefined()
  })

  it("reports the ticks a rewind undid, drops their unread events, and hands out the ticks run again", () => {
    const runtime = makeDebugRuntime()
    const pings = runtime.events(Ping)
    expectOk(runtime.tick(step))
    const checkpoint = runtime.checkpoint(step)
    expectOk(runtime.tick(step))
    expect(values(pings.take())).toEqual([[1, 1], [2, 2]])
    expectOk(runtime.tick(step))
    expectOk(runtime.rewind(checkpoint))
    expect(pings.take()).toEqual([])
    expect(pings.lost()).toEqual({ _tag: "EventsLost", from: 2, to: 4, reason: "rewind" })
    expectOk(runtime.tick(step))
    expect(values(pings.take())).toEqual([[4, 2]])
    expect(pings.lost()).toBeUndefined()
  })

  it("reports nothing for a rewind to before the reader was made beyond the ticks it saw", () => {
    const runtime = makeRuntime()
    const checkpoint = runtime.checkpoint(step)
    expectOk(runtime.tick(step))
    const pings = runtime.events(Ping)
    expectOk(runtime.rewind(checkpoint))
    expect(pings.lost()).toBeUndefined()
    expectOk(runtime.tick(step))
    expectOk(runtime.tick(step))
    expectOk(runtime.rewind(checkpoint))
    expect(pings.lost()).toEqual({ _tag: "EventsLost", from: 2, to: 4, reason: "rewind" })
  })

  it("holds nothing once closed", () => {
    const runtime = makeRuntime()
    const pings = runtime.events(Ping)
    expectOk(runtime.tick(step))
    pings.close()
    pings.close()
    for (let index = 0; index < Runtime.eventWindow + 1; index++) expectOk(runtime.tick(step))
    expect(pings.take()).toEqual([])
    expect(pings.lost()).toBeUndefined()
  })

  it("throws for an event outside the schema, and when read inside a tick", () => {
    const runtime = makeRuntime()
    const Outside = Descriptor.Event<number>()("HostEvents/Outside")
    expect(() => runtime.events(Outside as never)).toThrow("is not an event of this runtime's schema")
    const pings = runtime.events(Ping)
    const Inside = Game.System("HostEvents/Inside", {}, () => {
      pings.take()
    })
    expect(() => runtime.tick(Game.Schedule(Inside))).toThrow("while a schedule is running")
  })

  it("hands out the world's frozen values on a debug runtime", () => {
    const runtime = makeDebugRuntime()
    const pings = runtime.events(Ping)
    expectOk(runtime.tick(step))
    const [record] = pings.take()
    expect(Object.isFrozen(record!.value)).toBe(true)
  })
})
