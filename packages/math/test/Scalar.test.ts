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

describe("Scalar.spring", () => {
  const start: Scalar.Spring = { value: 0, velocity: 0 }
  const specs = [0, 0.3, 1, 1 + 1e-9, 1 - 1e-9, 2.5].map((dampingRatio) => ({ frequencyHz: 2, dampingRatio }))

  /** Many small steps of the same spring, for comparing against one big one. */
  const stepped = (from: Scalar.Spring, target: number, spec: Scalar.SpringSpec, seconds: number, steps: number) => {
    let state = from
    for (let step = 0; step < steps; step++) state = Scalar.spring(state, target, spec, seconds / steps)
    return state
  }

  it("is the same at any step rate", () => {
    for (const spec of specs) {
      const once = Scalar.spring({ value: 3, velocity: -4 }, 10, spec, 0.75)
      const many = stepped({ value: 3, velocity: -4 }, 10, spec, 0.75, 90)
      expect(many.value).toBeCloseTo(once.value, 9)
      expect(many.velocity).toBeCloseTo(once.velocity, 8)
    }
  })

  it("solves x'' = -omega^2 x - 2 zeta omega x' (checked by finite differences)", () => {
    for (const spec of specs) {
      const omega = 2 * Math.PI * spec.frequencyHz
      const h = 1e-4
      const at = (t: number) => Scalar.spring({ value: 1, velocity: 2 }, 0, spec, t)
      const t = 0.4
      const acceleration = (at(t + h).value - 2 * at(t).value + at(t - h).value) / (h * h)
      const expected = -omega * omega * at(t).value - 2 * spec.dampingRatio * omega * at(t).velocity
      expect(acceleration).toBeCloseTo(expected, 2)
      expect((at(t + h).value - at(t - h).value) / (2 * h)).toBeCloseTo(at(t).velocity, 5)
    }
  })

  it("overshoots below a damping ratio of 1, and not at or above it from rest", () => {
    const peak = (dampingRatio: number) => {
      let state = start
      let highest = 0
      for (let step = 0; step < 240; step++) {
        state = Scalar.spring(state, 1, { frequencyHz: 2, dampingRatio }, 1 / 60)
        highest = Math.max(highest, state.value)
      }
      return highest
    }
    expect(peak(0.3)).toBeGreaterThan(1.3)
    expect(peak(1)).toBeLessThanOrEqual(1)
    expect(peak(2.5)).toBeLessThanOrEqual(1)
  })

  it("is continuous across critical damping", () => {
    const at = (dampingRatio: number) => Scalar.spring({ value: 1, velocity: 3 }, 0, { frequencyHz: 2, dampingRatio }, 0.3)
    for (const near of [1 - 1e-9, 1 + 1e-9]) {
      expect(at(near).value).toBeCloseTo(at(1).value, 7)
      expect(at(near).velocity).toBeCloseTo(at(1).velocity, 7)
    }
  })

  it("stays finite and settles over a long dt, where stepping would blow up", () => {
    for (const spec of specs.slice(1)) {
      const late = Scalar.spring({ value: 5, velocity: 100 }, 1, spec, 100)
      expect(late.value).toBeCloseTo(1, 9)
      expect(late.velocity).toBeCloseTo(0, 9)
    }
    const heavy = Scalar.spring({ value: 5, velocity: 0 }, 1, { frequencyHz: 1, dampingRatio: 1e6 }, 1)
    expect(Number.isFinite(heavy.value) && Number.isFinite(heavy.velocity)).toBe(true)
    expect(heavy.value).toBeGreaterThan(4.99)
  })

  it("keeps current unless dt and frequencyHz are above 0", () => {
    const current = { value: 1, velocity: 2 }
    const spec = { frequencyHz: 2, dampingRatio: 0.5 }
    expect(Scalar.spring(current, 5, spec, 0)).toBe(current)
    expect(Scalar.spring(current, 5, spec, -1)).toBe(current)
    expect(Scalar.spring(current, 5, spec, Number.NaN)).toBe(current)
    expect(Scalar.spring(current, 5, { frequencyHz: 0, dampingRatio: 0.5 }, 1)).toBe(current)
    expect(Scalar.spring(current, 5, { frequencyHz: Number.NaN, dampingRatio: 0.5 }, 1)).toBe(current)
  })

  it("counts a negative damping ratio as 0, which swings forever", () => {
    const spec = { frequencyHz: 1, dampingRatio: -2 }
    expect(Scalar.spring({ value: 1, velocity: 0 }, 0, spec, 0.5)).toEqual(Scalar.spring({ value: 1, velocity: 0 }, 0, { frequencyHz: 1, dampingRatio: 0 }, 0.5))
    const fullSwing = Scalar.spring({ value: 1, velocity: 0 }, 0, spec, 1)
    expect(fullSwing.value).toBeCloseTo(1, 9)
  })

  it("settles at the target over an infinite dt, unless undamped", () => {
    const current = { value: 1, velocity: 2 }
    expect(Scalar.spring(current, 5, { frequencyHz: 2, dampingRatio: 0.5 }, Infinity)).toEqual({ value: 5, velocity: 0 })
    expect(Scalar.spring(current, 5, { frequencyHz: Infinity, dampingRatio: 1 }, 1 / 60)).toEqual({ value: 5, velocity: 0 })
    expect(Scalar.spring(current, 5, { frequencyHz: 2, dampingRatio: 0 }, Infinity)).toBe(current)
  })

  it("stops in place at an infinite damping ratio", () => {
    expect(Scalar.spring({ value: 1, velocity: 2 }, 5, { frequencyHz: 2, dampingRatio: Infinity }, 1)).toEqual({ value: 1, velocity: 0 })
  })
})
