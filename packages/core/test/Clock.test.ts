import { describe, expect, it } from "vitest"
import { Clock, Descriptor, Result, Schema } from "@typeonce/ritmo"
import { worldOf } from "./world-of.ts"

const step = Clock.hz(60)
const Time = Clock.resource("ClockRun/Time", step)
const Slow = Clock.resource("ClockRun/Slow", Clock.hz(10))
const Game = Schema.bind(Schema.fragment({ resources: { Time, Slow } }))
const Flow = Game.StateMachine("ClockRun/Flow", ["Playing", "Paused"])
const paused = Game.Condition.inState(Flow, "Paused")

const AdvanceTime = Clock.system(Game, { name: "ClockRun/AdvanceTime", resource: Time, hold: [paused] })
const AdvanceSlow = Clock.system(Game, { name: "ClockRun/AdvanceSlow", resource: Slow })
const second = Clock.duration(step, 1)
const seen: Array<{ readonly step: number; readonly dt: number; readonly every: boolean }> = []
const Watch = Game.System("ClockRun/Watch", { resources: { time: Game.System.thisTick(Game.System.readResource(Time)) } }, ({ resources }) => {
  const time = resources.time.get()
  seen.push({ step: time.step, dt: time.dt, every: Clock.every(time, Clock.duration(step, 0.05)) })
})
const Pause = Game.System("ClockRun/Pause", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
  nextMachines.flow.set("Paused")
})
const Resume = Game.System("ClockRun/Resume", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
  nextMachines.flow.set("Playing")
})

const make = () => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: { Time: Clock.start(step), Slow: Clock.start(Clock.hz(10)) },
    machines: Game.Runtime.machines(Game.Runtime.machine(Flow, "Playing"))
  })
  if (made._tag === "Failure") throw new Error("clock values are valid")
  return made.success
}

describe("Clock", () => {
  it("builds the step of a rate, and rejects other rates at runtime too", () => {
    expect(step).toEqual({ kind: "ClockStep", hz: 60, dt: 1 / 60 })
    const unchecked = Clock.hz as unknown as (hz: number) => Clock.Step
    expect(() => unchecked(0)).toThrow("Clock.hz needs a positive whole number of steps per second")
    expect(() => unchecked(29.97)).toThrow("Clock.hz needs a positive whole number of steps per second")
  })

  it("advances one step per tick, and holds (dt 0, every false) while a hold condition passes", () => {
    const runtime = make()
    seen.length = 0
    const tick = Game.Schedule(AdvanceTime, Watch)
    runtime.tick(tick)
    runtime.tick(tick)
    runtime.tick(Game.Schedule(Pause, Game.Schedule.applyStateTransitions()))
    runtime.tick(tick)
    runtime.tick(tick)
    runtime.tick(Game.Schedule(Resume, Game.Schedule.applyStateTransitions()))
    runtime.tick(tick)
    runtime.tick(tick)
    expect(seen).toEqual([
      { step: 1, dt: 1 / 60, every: false },
      { step: 2, dt: 1 / 60, every: false },
      { step: 2, dt: 0, every: false },
      { step: 2, dt: 0, every: false },
      { step: 3, dt: 1 / 60, every: true },
      { step: 4, dt: 1 / 60, every: false }
    ])
  })

  it("measures elapsed time exactly, in steps", () => {
    const runtime = make()
    const read = Game.Inspector("ClockRun/Read", { resources: { time: Game.System.readResource(Time) } }, ({ resources }) => resources.time.get())
    for (let index = 0; index < 600; index++) runtime.tick(Game.Schedule(AdvanceTime))
    expect(Clock.elapsed(runtime.inspect(read))).toBe(10)
    expect(Clock.steps(second)).toBe(60)
  })

  it("rounds durations to the nearest whole step, at least one", () => {
    expect(Clock.steps(Clock.duration(step, 0.025))).toBe(2)
    expect(Clock.steps(Clock.duration(step, 0.02))).toBe(1)
    expect(Clock.steps(Clock.duration(Clock.hz(4), 0.25))).toBe(1)
    expect(Clock.durationRaw(step, 0.5)).toEqual(Result.succeed({ kind: "ClockDuration", steps: 30, hz: 60 }))
    expect(Clock.durationRaw(step, 0.001)).toEqual(Result.fail({ _tag: "InvalidDuration", seconds: 0.001, message: "0.001s is shorter than one step (1/60s)" }))
    expect(Clock.durationRaw(step, -1)._tag).toBe("Failure")
    expect(Clock.durationRaw(step, Number.NaN)._tag).toBe("Failure")
    expect(Clock.durationRaw(step, Number.MAX_VALUE)._tag).toBe("Failure")
    expect(Clock.steps(Clock.duration(Clock.hz(10000000), 1e-7))).toBe(1)
  })

  it("runs two clocks of one game at their own rates", () => {
    const runtime = make()
    const read = Game.Inspector("ClockRun/ReadBoth", {
      resources: { time: Game.System.readResource(Time), slow: Game.System.readResource(Slow) }
    }, ({ resources }) => [resources.time.get(), resources.slow.get()] as const)
    for (let index = 0; index < 20; index++) runtime.tick(Game.Schedule(AdvanceTime, AdvanceSlow))
    const [time, slow] = runtime.inspect(read)
    expect([Clock.elapsed(time), Clock.elapsed(slow)]).toEqual([20 / 60, 2])
  })

  it("refuses to restore a save made at another rate, naming the resource", () => {
    const runtime = make()
    runtime.tick(Game.Schedule(AdvanceTime))
    const saved = worldOf(runtime.snapshot())
    const FastTime = Clock.resource("ClockRun/Time", Clock.hz(120))
    const Fast = Schema.bind(Schema.fragment({ resources: { Time: FastTime, Slow } }))
    const made = Fast.Runtime.make({ services: Fast.Runtime.services(), resources: { Time: Clock.start(Clock.hz(120)), Slow: Clock.start(Clock.hz(10)) } })
    if (made._tag === "Failure") throw new Error("clock values are valid")
    expect(made.success.restore(saved)).toEqual(Result.fail({
      _tag: "InvalidResource",
      name: "ClockRun/Time",
      error: { _tag: "InvalidTime", message: "saved at 60 Hz, this game runs at 120 Hz" }
    }))
    expect(runtime.restore(saved)._tag).toBe("Success")
  })

  it("is not a component or other plain resource", () => {
    const Plain = Descriptor.Resource<number>()("ClockRun/Plain")
    expect(Plain.kind).toBe("resource")
  })
})

describe("Clock.durationOfSteps", () => {
  it("spans exactly the given steps, and throws on a computed count that is not a positive whole number", () => {
    expect(Clock.steps(Clock.durationOfSteps(step, 3))).toBe(3)
    const zero: number = 0
    expect(() => Clock.durationOfSteps(step, zero)).toThrow("Clock.durationOfSteps needs a positive whole number of steps, got 0")
    const half: number = 0.5
    expect(() => Clock.durationOfSteps(step, half)).toThrow("got 0.5")
  })
})
