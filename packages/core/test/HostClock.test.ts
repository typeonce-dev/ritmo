import { describe, expect, it } from "vitest"
import { Debug, Descriptor, HostClock, Schema } from "@typeonce/ritmo"

describe("HostClock.test", () => {
  it("starts at 0 and moves only through adjust", () => {
    const clock = HostClock.test()
    expect(clock.now()).toBe(0)
    expect(clock.adjust(16)).toEqual({ ok: true, value: undefined })
    expect(clock.now()).toBe(16)
    expect(clock.adjust(0).ok).toBe(true)
    expect(clock.now()).toBe(16)
  })

  it("rejects a negative adjustment and does not move", () => {
    const clock = HostClock.test()
    clock.adjust(10)
    expect(clock.adjust(-5)).toEqual({ ok: false, error: { _tag: "InvalidAdjustment", ms: -5 } })
    expect(clock.now()).toBe(10)
  })

  it("rejects non-finite adjustments without poisoning later readings", () => {
    const clock = HostClock.test()
    for (const ms of [NaN, Infinity, -Infinity]) expect(clock.adjust(ms).ok).toBe(false)
    expect(clock.now()).toBe(0)
    expect(clock.adjust(Number.MAX_VALUE).ok).toBe(true)
    expect(clock.adjust(Number.MAX_VALUE).ok).toBe(false)
    expect(clock.now()).toBe(Number.MAX_VALUE)
  })
})

describe("HostClock.elapsed", () => {
  it("is the difference, clamped to 0 when the clock went backwards", () => {
    expect(HostClock.elapsed(10, 25)).toBe(15)
    expect(HostClock.elapsed(25, 10)).toBe(0)
  })
})

describe("HostClock.standard", () => {
  it("reads a number of milliseconds", () => {
    expect(typeof HostClock.standard.now()).toBe("number")
  })
})

const Tick = Descriptor.Service<{ readonly clock: HostClock.TestHostClock; readonly step: number }>()("HostClockTest/Tick")
const Root = Schema.defineRoot("HostClockTest")
const Game = Schema.bind(Schema.fragment({}), Root)
const Advance = Game.System("HostClockTest/Advance", { services: { tick: Game.System.service(Tick) } }, ({ services }) => {
  services.tick.clock.adjust(services.tick.step)
})
const Idle = Game.System("HostClockTest/Idle", {}, () => {})

/** Runs one tick on a runtime timed by `clock`, where Advance moves the clock by `step`. */
const traced = (clock: HostClock.TestHostClock, step: number) => {
  const runtime = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(Tick, { clock, step })),
    debug: { hostClock: clock }
  }).value
  const update = Game.Schedule(Advance, Idle)
  runtime.debug.nameSchedules({ update })
  const events: Array<Debug.TraceEvent> = []
  const stop = runtime.debug.observe((event) => events.push(event))
  runtime.tick(update)
  stop()
  return events.flatMap((event) =>
    event.type === "system" ? [[event.system, event.ms]]
    : event.type === "schedule.end" ? [[`schedule ${event.schedule}`, event.ms]]
    : [])
}

describe("debug trace timings", () => {
  it("are 0 with a test clock nobody moves", () => {
    expect(traced(HostClock.test(), 0)).toEqual([
      ["HostClockTest/Advance", 0],
      ["HostClockTest/Idle", 0],
      ["schedule update", 0]
    ])
  })

  it("are what the test clock moved while a system ran", () => {
    expect(traced(HostClock.test(), 12)).toEqual([
      ["HostClockTest/Advance", 12],
      ["HostClockTest/Idle", 0],
      ["schedule update", 12]
    ])
  })
})
