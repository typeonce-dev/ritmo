import { Clock, Descriptor, Schema } from "@typeonce/ritmo"
import type { Result } from "@typeonce/ritmo"
import { describe, expect, it } from "tstyche"

const step = Clock.hz(60)
const Time = Clock.resource("ClockTypes/Time", step)
const Slow = Clock.resource("ClockTypes/Slow", Clock.hz(10))
const Paused = Descriptor.Resource<boolean>()("ClockTypes/Paused")
const Game = Schema.bind(Schema.fragment({ resources: { Time, Slow, Paused } }))
const Flow = Game.StateMachine("ClockTypes/Flow", ["Playing", "Menu"])
const inMenu = Game.Condition.inState(Flow, "Menu")

describe("Clock.hz", () => {
  it("infers a step of the literal rate", () => {
    expect(step).type.toBe<Clock.Step<60>>()
    expect(step.dt).type.toBe<number>()
  })

  it("rejects zero, negative, fractional, and non-literal rates", () => {
    // @ts-expect-error Clock.hz needs a positive whole number of steps per second
    Clock.hz(0)
    // @ts-expect-error Clock.hz needs a positive whole number of steps per second
    Clock.hz(-30)
    // @ts-expect-error Clock.hz needs a positive whole number of steps per second
    Clock.hz(59.94)
    const rate: number = 60
    // @ts-expect-error Clock.hz needs a literal
    Clock.hz(rate)
    // @ts-expect-error Clock.hz needs a positive whole number of steps per second
    Clock.hz(9007199254740992)
    const chooseRate = (): 0 | 60 => 60
    // @ts-expect-error Clock.hz needs one literal rate
    Clock.hz(chooseRate())
    // @ts-expect-error Property '[stepBrand]' is missing
    const forged: Clock.Step<60> = { kind: "ClockStep", hz: 60, dt: 0 }
  })
})

describe("Clock.resource and Clock.start", () => {
  it("hold the time of one rate", () => {
    expect(Clock.start(step)).type.toBe<Clock.Time<60>>()
    expect(Time).type.toBe<Clock.ClockResource<"ClockTypes/Time", 60>>()
    expect(Clock.elapsed(Clock.start(step))).type.toBe<number>()
  })

  it("provide a runtime's clock value, of the matching rate only", () => {
    Game.Runtime.make({ services: Game.Runtime.services(), resources: { Time: Clock.start(step), Slow: Clock.start(Clock.hz(10)), Paused: false } })
    // @ts-expect-error Type '60' is not assignable to type '10'
    Game.Runtime.make({ services: Game.Runtime.services(), resources: { Time: Clock.start(step), Slow: Clock.start(step), Paused: false } })
  })
})

describe("Clock.duration", () => {
  it("infers a duration of the step's rate", () => {
    expect(Clock.duration(step, 0.5)).type.toBe<Clock.Duration<60>>()
    expect(Clock.duration(step, 2)).type.toBe<Clock.Duration<60>>()
    expect(Clock.steps(Clock.duration(step, 0.25))).type.toBe<number>()
    expect(Clock.durationRaw(step, 0.001)).type.toBe<Result.Result<Clock.Duration<60>, Clock.InvalidDuration>>()
  })

  it("accepts exactly one step and rejects anything shorter", () => {
    Clock.duration(Clock.hz(50), 0.02)
    Clock.duration(Clock.hz(4), 0.25)
    expect(Clock.duration(Clock.hz(10000000), 1e-7)).type.toBe<Clock.Duration<10000000>>()
    // @ts-expect-error 1e-8s is shorter than one step (1/60s)
    Clock.duration(step, 1e-8)
    // @ts-expect-error a duration must fit in a safe whole number of steps
    Clock.duration(step, 1e+30)
    // @ts-expect-error 0.001s is shorter than one step (1/60s)
    Clock.duration(step, 0.001)
    // @ts-expect-error 0.016s is shorter than one step (1/60s)
    Clock.duration(step, 0.016)
    // @ts-expect-error 0.019s is shorter than one step (1/50s)
    Clock.duration(Clock.hz(50), 0.019)
    // @ts-expect-error 0s is shorter than one step (1/60s)
    Clock.duration(step, 0)
  })

  it("rejects negative and non-literal seconds", () => {
    // @ts-expect-error Clock.duration needs a non-negative number of seconds
    Clock.duration(step, -1)
    const seconds: number = 1
    // @ts-expect-error Clock.duration needs a literal number of seconds: use Clock.durationRaw for data
    Clock.duration(step, seconds)
  })

  it("checks every against the clock's own rate", () => {
    const t = Clock.start(step)
    expect(Clock.every(t, Clock.duration(step, 1))).type.toBe<boolean>()
    expect(Clock.every).type.not.toBeCallableWith(t, Clock.duration(Clock.hz(10), 1))
    expect(Clock.every).type.toBeCallableWith(t, Clock.duration(step, 1))
    // @ts-expect-error Property '[durationBrand]' is missing
    Clock.every(t, { kind: "ClockDuration", hz: 60, steps: 0 })
  })
})

describe("Clock.system", () => {
  const AdvanceTime = Clock.system(Game, { name: "ClockTypes/AdvanceTime", resource: Time, hold: [inMenu] })
  const ReadNow = Game.System("ClockTypes/ReadNow", {
    resources: { time: Game.System.thisTick(Game.System.readResource(Time)) }
  }, () => {})
  const made = Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: { Time: Clock.start(step), Slow: Clock.start(Clock.hz(10)), Paused: false },
    machines: Game.Runtime.machines(Game.Runtime.machine(Flow, "Playing"))
  })
  if (made._tag === "Failure") throw new Error("unreachable")
  const runtime = made.success

  it("is a writer of its resource for thisTick reads", () => {
    Game.System("ClockTypes/ReadTyped", { resources: { time: Game.System.readResource(Time) } }, ({ resources }) => {
      expect(resources.time.get()).type.toBe<Clock.Time<60>>()
    })
    runtime.tick(Game.Schedule(AdvanceTime, ReadNow))
    // @ts-expect-error ClockTypes/ReadNow needs ClockTypes/Time from this tick, but its writer ClockTypes/AdvanceTime runs after it
    runtime.tick(Game.Schedule(ReadNow, AdvanceTime))
  })

  it("needs the machines its hold conditions read", () => {
    const madeBare = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Time: Clock.start(step), Slow: Clock.start(Clock.hz(10)), Paused: false } })
    if (madeBare._tag === "Failure") throw new Error("unreachable")
    const bare = madeBare.success
    // @ts-expect-error __runtimeRequirementError__: "Missing machine"; readonly __requirement__: "ClockTypes/Flow"
    bare.tick(Game.Schedule(AdvanceTime))
  })

  it("runs two clocks of one game side by side", () => {
    const AdvanceSlow = Clock.system(Game, { name: "ClockTypes/AdvanceSlow", resource: Slow })
    runtime.tick(Game.Schedule(AdvanceTime, AdvanceSlow, ReadNow))
  })

  it("accepts only clock resources of the game", () => {
    expect(Clock.system).type.not.toBeCallableWith(Game, { name: "ClockTypes/Bad", resource: Paused })
    expect(Clock.system).type.toBeCallableWith(Game, { name: "ClockTypes/Good", resource: Time })
  })
})

describe("Clock.durationOfSteps", () => {
  it("infers a duration of the step's rate from a whole step count", () => {
    expect(Clock.durationOfSteps(step, 3)).type.toBe<Clock.Duration<60>>()
    const counted: number = 4
    expect(Clock.durationOfSteps(step, counted)).type.toBe<Clock.Duration<60>>()
  })

  it("rejects a literal zero, negative, or fractional count", () => {
    // @ts-expect-error Clock.durationOfSteps needs a positive whole number of steps
    Clock.durationOfSteps(step, 0)
    // @ts-expect-error Clock.durationOfSteps needs a positive whole number of steps
    Clock.durationOfSteps(step, -2)
    // @ts-expect-error Clock.durationOfSteps needs a positive whole number of steps
    Clock.durationOfSteps(step, 1.5)
  })
})
