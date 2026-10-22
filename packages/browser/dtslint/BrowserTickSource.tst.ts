import { BrowserTickSource } from "@typeonce/ritmo-browser"
import { Clock, FixedLoop, Result } from "@typeonce/ritmo"
import { describe, expect, it } from "tstyche"

describe("BrowserTickSource.make", () => {
  const host = {
    requestAnimationFrame: (_callback: (timestamp: number) => void) => 0,
    cancelAnimationFrame: (_handle: number) => {}
  }

  it("makes a core tick source from a window-like host", () => {
    expect(BrowserTickSource.make(host)).type.toBe<FixedLoop.TickSource>()
  })

  it("drives FixedLoop.start", () => {
    expect(FixedLoop.start).type.toBeCallableWith({
      source: BrowserTickSource.make(host),
      step: Clock.hz(60),
      maxFrameSeconds: 0.25,
      maxStepsPerFrame: 5,
      update: () => Result.succeed(undefined),
      render: () => {},
      onFailure: () => {}
    })
  })

  it("rejects a host without cancelAnimationFrame", () => {
    const noCancel = { requestAnimationFrame: host.requestAnimationFrame }
    // @ts-expect-error Property 'cancelAnimationFrame' is missing
    BrowserTickSource.make(noCancel)
  })
})
