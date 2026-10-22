import { Clock, FixedLoop, Result } from "@typeonce/ritmo"
import { describe, expect, it } from "tstyche"

describe("FixedLoop.start", () => {
  it("preserves the update failure type in the loop failure channel", () => {
    FixedLoop.start({
      source: FixedLoop.source(() => ({ stop() {} })),
      step: Clock.hz(60),
      maxFrameSeconds: 0.25,
      maxStepsPerFrame: 5,
      update: () => Result.fail("GameOver" as const),
      render: (frame) => {
        expect(frame.alpha).type.toBe<number>()
      },
      onFailure: (failure) => {
        expect(failure).type.toBe<FixedLoop.Failure<"GameOver">>()
      }
    })
  })

  it("takes the clock's step, never a number of seconds", () => {
    expect<FixedLoop.Options["step"]>().type.toBe<Clock.Step>()
    FixedLoop.start({
      source: FixedLoop.source(() => ({ stop() {} })),
      // @ts-expect-error Type 'number' is not assignable to type 'Step<number>'
      step: 1 / 60,
      maxFrameSeconds: 0.25,
      maxStepsPerFrame: 5,
      update: () => Result.succeed(undefined),
      render: () => {},
      onFailure: () => {}
    })
  })
})
