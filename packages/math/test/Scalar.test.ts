import { describe, expect, it } from "vitest"

import { Ops } from "@typeonce/ritmo"
import { Scalar } from "@typeonce/ritmo-math"

describe("Scalar", () => {
  it("moves toward a target by at most maxDelta, never overshooting", () => {
    expect(Scalar.moveToward(0, 10, 4)).toBe(4)
    expect(Scalar.moveToward(10, 0, 4)).toBe(6)
    expect(Scalar.moveToward(0, 10, 10)).toBe(10)
    expect(Scalar.moveToward(0, 10, 40)).toBe(10)
    expect(Scalar.moveToward(0, -3, Infinity)).toBe(-3)
    expect(Scalar.moveToward(5, 5, 1)).toBe(5)
  })

  it("keeps current when maxDelta is 0 or less", () => {
    expect(Scalar.moveToward(3, 10, 0)).toBe(3)
    expect(Scalar.moveToward(3, 10, -2)).toBe(3)
    expect(Scalar.moveToward(3, 10, Number.NaN)).toBe(3)
    expect(Scalar.moveToward(3, 3, -2)).toBe(3)
  })

  it("interpolates without clamping", () => {
    expect(Scalar.lerp(0, 10, 0.25)).toBe(2.5)
    expect(Scalar.lerp(0, 10, 0)).toBe(0)
    expect(Scalar.lerp(0, 10, 1)).toBe(10)
    expect(Scalar.lerp(0, 10, 1.5)).toBe(15)
    expect(Scalar.lerp(0, 10, -0.5)).toBe(-5)
  })

  it("decays toward a target through Ops.exp, the same at any step rate", () => {
    expect(Scalar.decayToward(10, 0, 2, 0.5)).toBe(10 * Ops.exp(-1))
    expect(Scalar.decayToward(0, 10, 2, 0.5)).toBe(10 + (0 - 10) * Ops.exp(-1))
    let stepped = 10
    for (let step = 0; step < 60; step++) stepped = Scalar.decayToward(stepped, 0, 2, 1 / 120)
    expect(stepped).toBeCloseTo(10 * Ops.exp(-1), 12)
  })

  it("keeps current unless rate * dt is above 0, and reaches the target at an infinite rate", () => {
    expect(Scalar.decayToward(1, 5, 2, 0)).toBe(1)
    expect(Scalar.decayToward(1, 5, 0, 1)).toBe(1)
    expect(Scalar.decayToward(1, 5, -2, 1)).toBe(1)
    expect(Scalar.decayToward(1, 5, 2, -1)).toBe(1)
    expect(Scalar.decayToward(1, 5, Number.NaN, 1)).toBe(1)
    expect(Scalar.decayToward(1, 5, Infinity, 0)).toBe(1)
    expect(Scalar.decayToward(1, 5, Infinity, 1 / 60)).toBe(5)
  })
})
