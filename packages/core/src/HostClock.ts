/**
 * The host's wall clock, as an injected contract.
 *
 * Core and the generic devtools modules never read a platform clock
 * (`performance`, `Date`) themselves: whatever measures host time (debug
 * trace durations, session timings, replay windows) takes a `HostClock`.
 * Platform packages provide implementations (`BrowserHostClock.make(window)`
 * in the browser package); `standard` works in every JavaScript engine, and
 * `test()` is a manual clock for deterministic tests.
 *
 * Host time is for measuring the host (how long a tick took), never for game
 * logic: simulation time is a resource the schedule advances.
 *
 * @example
 * ```ts
 * const runtime = Game.Runtime.make({ services, debug: { hostClock: HostClock.standard } }).value
 * ```
 *
 * @module HostClock
 * @docGroup runtime
 */
import * as Result from "./Result.ts"

/** A host clock: `now()` in milliseconds, from an arbitrary origin. */
export interface HostClock {
  readonly now: () => number
}

/**
 * `Date.now`, which every JavaScript engine provides. Its readings can jump
 * (the system clock is adjusted, or the device sleeps), so a duration
 * computed from two readings can be negative: consumers clamp durations to
 * 0. Prefer a monotonic platform clock when there is one
 * (`BrowserHostClock.make(window)`).
 */
// oxlint-disable-next-line ritmo/use-clock-for-time -- HostClock is host time, for hosts and tools; systems read Clock.
export const standard: HostClock = { now: () => Date.now() }

/** `adjust` must leave a finite clock reading and never move backwards. */
export interface InvalidAdjustment {
  readonly _tag: "InvalidAdjustment"
  readonly ms: number
}

/** A manual clock for tests: starts at 0 and moves only through `adjust`. */
export interface TestHostClock extends HostClock {
  /** Moves the clock forward by `ms` (0 or more). */
  readonly adjust: (ms: number) => Result.Result<void, InvalidAdjustment>
}

/** A test clock at 0. Every reading is the same until `adjust` moves it. */
export const test = (): TestHostClock => {
  let current = 0
  return {
    now: () => current,
    adjust: (ms) => {
      if (!Number.isFinite(ms) || ms < 0 || !Number.isFinite(current + ms)) return Result.fail({ _tag: "InvalidAdjustment", ms })
      current += ms
      return Result.succeed(undefined)
    }
  }
}

/** A duration between two readings, clamped to 0 when the clock went backwards. */
export const elapsed = (from: number, to: number): number => Math.max(0, to - from)
