import { describe, expect, it } from "vitest"
import { Clock, Debug, FixedLoop, HostClock, Result, Schema } from "@typeonce/ritmo"

const Game = Schema.bind(Schema.fragment({}))
const Fail = Game.System("LoopIgnored/Fail", {}, () => Result.fail("boom" as const))
const step = Game.Schedule(Fail)

describe("FixedLoop.start", () => {
  it("advances deterministic fixed updates and exposes interpolation", () => {
    let tick: ((value: FixedLoop.Tick) => void) | undefined
    let stopped = false
    const frames: Array<FixedLoop.Frame> = []
    const steps: Array<number> = []

    const driver = FixedLoop.start({
      source: FixedLoop.source((onTick) => {
        tick = onTick
        return { stop: () => { stopped = true } }
      }),
      step: Clock.hz(100),
      maxFrameSeconds: 0.1,
      maxStepsPerFrame: 3,
      update: (step) => {
        steps.push(step)
        return Result.succeed(undefined)
      },
      render: (frame) => frames.push(frame),
      onFailure: () => {
        throw new Error("unexpected loop failure")
      }
    })

    expect(driver._tag).toBe("Success")
    tick?.({ deltaMS: 25 })
    tick?.({ deltaMS: 10 })

    expect(steps).toEqual([0.01, 0.01, 0.01])
    expect(frames).toHaveLength(2)
    expect(frames[0]).toMatchObject({ fixedSteps: 2, droppedSeconds: 0 })
    expect(frames[0]?.alpha).toBeCloseTo(0.5)
    expect(frames[1]).toMatchObject({ fixedSteps: 1, droppedSeconds: 0 })
    expect(frames[1]?.alpha).toBeCloseTo(0.5)
    expect(stopped).toBe(false)
  })

  it("bounds catch-up work and reports expected update failures", () => {
    let tick: ((value: FixedLoop.Tick) => void) | undefined
    let stopCount = 0
    const frames: Array<FixedLoop.Frame> = []
    const failures: Array<FixedLoop.Failure<"Paused">> = []
    let updates = 0

    const driver = FixedLoop.start({
      source: FixedLoop.source((onTick) => {
        tick = onTick
        return { stop: () => { stopCount += 1 } }
      }),
      step: Clock.hz(100),
      maxFrameSeconds: 0.1,
      maxStepsPerFrame: 3,
      update: () => {
        updates += 1
        return updates === 4 ? Result.fail("Paused" as const) : Result.succeed(undefined)
      },
      render: (frame) => frames.push(frame),
      onFailure: (failure) => failures.push(failure)
    })

    expect(driver._tag).toBe("Success")
    tick?.({ deltaMS: 100 })
    expect(updates).toBe(3)
    expect(frames[0]?.fixedSteps).toBe(3)
    expect(frames[0]?.droppedSeconds).toBeCloseTo(0.07)

    tick?.({ deltaMS: 10 })
    expect(failures).toEqual([{ _tag: "UpdateFailure", error: "Paused" }])
    expect(stopCount).toBe(1)
    expect(frames).toHaveLength(1)
  })

  it("rejects invalid timing before subscribing", () => {
    let subscribed = false
    const result = FixedLoop.start({
      source: FixedLoop.source(() => {
        subscribed = true
        return { stop() {} }
      }),
      step: Clock.hz(60),
      maxFrameSeconds: 0,
      maxStepsPerFrame: 3,
      update: () => Result.succeed(undefined),
      render: () => {},
      onFailure: () => {}
    })

    expect(result).toEqual({
      _tag: "Failure",
      failure: {
        _tag: "InvalidFixedLoopOptions",
        field: "maxFrameSeconds",
        reason: "mustBeFiniteAndPositive",
        value: 0
      }
    })
    expect(subscribed).toBe(false)
  })
})

describe("ignored tick failures through FixedLoop", () => {
  it("does not report a failure FixedLoop handled (it reads ok and stops)", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.test() } }).success
    const seen: Array<Debug.FailureIgnoredEvent> = []
    runtime.debug.observe((event) => {
      if (event.type === "failure.ignored") seen.push(event)
    })
    let tick: ((value: FixedLoop.Tick) => void) | undefined
    const failures: Array<unknown> = []
    const driver = FixedLoop.start({
      source: FixedLoop.source((onTick) => {
        tick = onTick
        return { stop: () => {} }
      }),
      step: Clock.hz(100),
      maxFrameSeconds: 0.1,
      maxStepsPerFrame: 3,
      update: () => runtime.tick(step),
      render: () => {},
      onFailure: (failure) => failures.push(failure)
    })
    expect(driver._tag).toBe("Success")
    tick?.({ deltaMS: 10 })
    runtime.debug.checkIgnoredFailures()
    expect(failures).toHaveLength(1)
    expect(seen).toEqual([])
  })
})
