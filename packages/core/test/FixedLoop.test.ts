import { describe, expect, it } from "vitest"
import { Clock, Debug, FixedLoop, HostClock, Result, Schema } from "@typeonce/ritmo"

const Game = Schema.bind(Schema.fragment({}))
const Fail = Game.System("LoopIgnored/Fail", {}, () => Result.failure("boom" as const))
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
        return Result.success(undefined)
      },
      render: (frame) => frames.push(frame),
      onFailure: () => {
        throw new Error("unexpected loop failure")
      }
    })

    expect(driver.ok).toBe(true)
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
        return updates === 4 ? Result.failure("Paused" as const) : Result.success(undefined)
      },
      render: (frame) => frames.push(frame),
      onFailure: (failure) => failures.push(failure)
    })

    expect(driver.ok).toBe(true)
    tick?.({ deltaMS: 100 })
    expect(updates).toBe(3)
    expect(frames[0]?.fixedSteps).toBe(3)
    expect(frames[0]?.droppedSeconds).toBeCloseTo(0.07)

    tick?.({ deltaMS: 10 })
    expect(failures).toEqual([{ kind: "UpdateFailure", error: "Paused" }])
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
      update: () => Result.success(undefined),
      render: () => {},
      onFailure: () => {}
    })

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "InvalidFixedLoopOptions",
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
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.test() } }).value
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
    expect(driver.ok).toBe(true)
    tick?.({ deltaMS: 10 })
    runtime.debug.checkIgnoredFailures()
    expect(failures).toHaveLength(1)
    expect(seen).toEqual([])
  })

  it("runs host time into the accumulator at the rate it reads each frame", () => {
    let tick: ((value: FixedLoop.Tick) => void) | undefined
    let rate = 0.9
    let updates = 0
    const failures: Array<FixedLoop.Failure<unknown>> = []
    FixedLoop.start({
      source: FixedLoop.source((onTick) => {
        tick = onTick
        return { stop: () => {} }
      }),
      step: Clock.hz(100),
      maxFrameSeconds: 0.1,
      maxStepsPerFrame: 5,
      rate: () => rate,
      update: () => {
        updates += 1
        return Result.success(undefined)
      },
      render: () => {},
      onFailure: (failure) => failures.push(failure)
    })
    // 50 ms at 0.9 admits 45 ms: four 10 ms steps, not five.
    tick?.({ deltaMS: 50 })
    expect(updates).toBe(4)
    rate = 1.1
    // 5 ms left over, then 50 ms at 1.1: 60 ms, six steps (capped at five).
    tick?.({ deltaMS: 50 })
    expect(updates).toBe(9)
    rate = 0.5
    tick?.({ deltaMS: 10 })
    expect(failures).toEqual([{ kind: "InvalidRate", rate: 0.5 }])
    expect(updates).toBe(9)
  })

  describe("a driver called from update or render", () => {
    /** A 100 Hz loop whose `update` and `render` can call into their own driver. */
    const makeLoop = (calls: {
      readonly onUpdate?: (driver: FixedLoop.Driver, update: number) => void
      readonly onRender?: (driver: FixedLoop.Driver, frame: number) => void
    }) => {
      let tick: ((value: FixedLoop.Tick) => void) | undefined
      const frames: Array<FixedLoop.Frame> = []
      let updates = 0
      let hostStops = 0
      const started = FixedLoop.start({
        source: FixedLoop.source((onTick) => {
          tick = onTick
          return { stop: () => { hostStops += 1 } }
        }),
        step: Clock.hz(100),
        maxFrameSeconds: 0.25,
        maxStepsPerFrame: 5,
        update: () => {
          updates += 1
          calls.onUpdate?.(driver, updates)
          return Result.success(undefined)
        },
        render: (frame) => {
          frames.push(frame)
          calls.onRender?.(driver, frames.length)
        },
        onFailure: () => {
          throw new Error("unexpected loop failure")
        }
      })
      if (!started.ok) throw new Error("invalid fixture")
      const driver = started.value
      return { tick: (deltaMS: number) => tick?.({ deltaMS }), frames, updates: () => updates, hostStops: () => hostStops }
    }

    it("reset() from update ends the frame's stepping at alpha 0 and loses no step on the next frame", () => {
      // A level loaded in the first update resets the loop.
      const loop = makeLoop({ onUpdate: (driver, update) => { if (update === 1) driver.reset() } })
      loop.tick(35)
      expect(loop.updates()).toBe(1)
      expect(loop.frames[0]).toMatchObject({ fixedSteps: 1, alpha: 0, droppedSeconds: 0 })
      loop.tick(10)
      expect(loop.updates()).toBe(2)
      expect(loop.frames[1]).toMatchObject({ fixedSteps: 1 })
      expect(loop.frames[1]!.alpha).toBeCloseTo(0)
    })

    it("stop() from update runs no further update and no render", () => {
      const loop = makeLoop({ onUpdate: (driver, update) => { if (update === 1) driver.stop() } })
      loop.tick(45)
      loop.tick(45)
      expect(loop.updates()).toBe(1)
      expect(loop.frames).toEqual([])
      expect(loop.hostStops()).toBe(1)
    })

    it("reset() and stop() from render apply from the next frame", () => {
      const reset = makeLoop({ onRender: (driver, frame) => { if (frame === 1) driver.reset() } })
      reset.tick(15)
      reset.tick(10)
      expect(reset.frames.map((frame) => frame.fixedSteps)).toEqual([1, 1])
      expect(reset.frames[1]!.alpha).toBeCloseTo(0)
      const stopped = makeLoop({ onRender: (driver) => driver.stop() })
      stopped.tick(15)
      stopped.tick(15)
      expect(stopped.updates()).toBe(1)
      expect(stopped.frames).toHaveLength(1)
      expect(stopped.hostStops()).toBe(1)
    })
  })
})
