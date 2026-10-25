/**
 * The browser's animation frames as a core `FixedLoop.TickSource`.
 *
 * Each frame reports the milliseconds since the previous one; the first frame
 * reports zero because it establishes the clock. The window is passed in, so
 * nothing reads a global. To drive the loop from a renderer's own ticker
 * instead (such as Pixi's), wrap it with `FixedLoop.source`.
 *
 * @example
 * ```ts
 * const loop = FixedLoop.start({
 *   source: BrowserTickSource.make(window),
 *   step: Clock.hz(60),
 *   maxFrameSeconds: 0.25,
 *   maxStepsPerFrame: 5,
 *   update: () => runtime.tick(update),
 *   render: () => {},
 *   onFailure: (failure) => console.error(failure)
 * })
 * ```
 *
 * @module BrowserTickSource
 * @docGroup browser
 */
import * as FixedLoop from "@typeonce/ritmo/FixedLoop"

/** What the source needs from the window. */
export interface Host {
  requestAnimationFrame(callback: (timestamp: number) => void): number
  cancelAnimationFrame(handle: number): void
}

/** A tick source that schedules one `requestAnimationFrame` per frame until stopped. */
export const make = (host: Host): FixedLoop.TickSource => FixedLoop.source((onTick) => {
  let stopped = false
  let handle = 0
  let previous: number | undefined

  const frame = (timestamp: number): void => {
    if (stopped) {
      return
    }
    const deltaMS = previous === undefined ? 0 : timestamp - previous
    previous = timestamp
    onTick({ deltaMS })
    if (!stopped) {
      handle = host.requestAnimationFrame(frame)
    }
  }

  handle = host.requestAnimationFrame(frame)
  return {
    stop() {
      if (stopped) {
        return
      }
      stopped = true
      host.cancelAnimationFrame(handle)
    }
  }
})
