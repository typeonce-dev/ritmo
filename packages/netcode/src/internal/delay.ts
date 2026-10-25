/**
 * The adaptive input delay policy: from the round trip to the slowest other
 * seat, the delay that covers the one-way trip, clamped to the bounds, with
 * hysteresis so a noisy round trip does not move it back and forth.
 *
 * The delay is this seat's own: the other peers learn which tick each input
 * is for from the input message, so a change needs no agreement. A rise
 * leaves the ticks it skips idle; a fall drops this seat's input for as
 * many frames as it fell, so no tick gets two inputs.
 */
import * as Result from "@typeonce/ritmo/Result"

import type { AdaptiveDelay, InvalidOptions } from "../Netcode.ts"

/** Measurements in a row whose target differs from the delay before it moves. */
export const settleAfter = 4

export interface Policy {
  /** The delay in use. */
  readonly delay: () => number
  /** Changes made, in total. */
  readonly changes: () => number
  /**
   * Takes one measurement: the smoothed round trip to the slowest other
   * seat (`undefined`: not measured yet). Returns the new delay when it
   * changes, otherwise `undefined`.
   */
  readonly measure: (roundTripMS: number | undefined) => number | undefined
}

const invalid = (value: unknown, reason: string): Result.Failure<InvalidOptions> =>
  Result.failure({ _tag: "InvalidOptions", field: "adaptiveDelay", value, reason })

const wholeNumber = (value: number, least: number): boolean => Number.isSafeInteger(value) && value >= least

/** Checks the bounds. The delay starts at `max`: too much delay costs a little lag, too little costs rollbacks. */
export const make = (bounds: AdaptiveDelay, stepMS: number): Result.Result<Policy, InvalidOptions> => {
  if (typeof bounds !== "object" || bounds === null) return invalid(bounds, "bounds of the delay: { min, max }")
  if (!wholeNumber(bounds.min, 0)) return invalid(bounds, "min is a whole number of ticks, 0 or more")
  if (!wholeNumber(bounds.max, bounds.min)) return invalid(bounds, "max is a whole number of ticks, min or more")
  let delay = bounds.max
  let changes = 0
  let differing = 0
  return Result.success({
    delay: () => delay,
    changes: () => changes,
    measure: (roundTripMS) => {
      if (roundTripMS === undefined) return undefined
      const target = Math.min(bounds.max, Math.max(bounds.min, Math.ceil(roundTripMS / 2 / stepMS)))
      if (target === delay) {
        differing = 0
        return undefined
      }
      differing += 1
      if (differing < settleAfter) return undefined
      differing = 0
      delay = target
      changes += 1
      return delay
    }
  })
}

/** A delay that never moves (`inputDelay`). */
export const fixed = (delay: number): Policy => ({ delay: () => delay, changes: () => 0, measure: () => undefined })
