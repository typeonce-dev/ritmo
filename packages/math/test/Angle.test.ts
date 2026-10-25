import { describe, expect, it } from "vitest"

import { Random } from "@typeonce/ritmo"
import { Angle } from "@typeonce/ritmo-math"

const PI = Math.PI
const TAU = 2 * Math.PI

describe("Angle.wrap", () => {
  it("brings angles into [-π, π) by whole turns", () => {
    expect(Angle.wrap(0)).toBe(0)
    expect(Angle.wrap(1)).toBe(1)
    expect(Angle.wrap(-1)).toBe(-1)
    expect(Angle.wrap(1 + TAU)).toBeCloseTo(1, 14)
    expect(Angle.wrap(-1 - 3 * TAU)).toBeCloseTo(-1, 13)
    expect(Angle.wrap(3 * PI / 2)).toBeCloseTo(-PI / 2, 14)
    expect(Angle.wrap(-3 * PI / 2)).toBeCloseTo(PI / 2, 14)
  })

  it("gives -π for both ties at ±π", () => {
    expect(Angle.wrap(PI)).toBe(-PI)
    expect(Angle.wrap(-PI)).toBe(-PI)
    expect(Angle.wrap(TAU + PI)).toBe(-PI)
  })

  it("never returns -0, and keeps every result in range", () => {
    expect(Object.is(Angle.wrap(-0), 0)).toBe(true)
    expect(Object.is(Angle.wrap(-TAU), 0)).toBe(true)
    const random = Random.make(9)
    for (let draw = 0; draw < 10_000; draw++) {
      const angle = random.range(-1e6, 1e6)
      const wrapped = Angle.wrap(angle)
      expect(wrapped >= -PI && wrapped < PI).toBe(true)
      expect(Math.abs(Math.sin(wrapped) - Math.sin(angle))).toBeLessThan(1e-9)
    }
  })

  it("is exact: the remainder of a whole number of turns", () => {
    const angle = 1e3 + 0.123
    expect(Angle.wrap(angle)).toBe(angle % TAU >= PI ? angle % TAU - TAU : angle % TAU)
  })
})

describe("Angle.turnToward", () => {
  it("turns by at most maxStep, the short way", () => {
    expect(Angle.turnToward(0, 1, 0.25)).toBe(0.25)
    expect(Angle.turnToward(0, -1, 0.25)).toBe(-0.25)
    // From just below π to just above -π is a short step across the wrap.
    const turned = Angle.turnToward(PI - 0.1, -PI + 0.1, 0.05)
    expect(turned).toBeCloseTo(PI - 0.05, 14)
    const across = Angle.turnToward(PI - 0.1, -PI + 0.1, 0.15)
    expect(across).toBeCloseTo(-PI + 0.05, 14)
  })

  it("never overshoots: the wrapped target once it is within maxStep", () => {
    expect(Angle.turnToward(0, 0.2, 0.25)).toBe(0.2)
    expect(Angle.turnToward(0, 0.25, 0.25)).toBe(0.25)
    expect(Angle.turnToward(0, 0.2 + TAU, 1)).toBeCloseTo(0.2, 14)
    expect(Angle.turnToward(0, PI, Infinity)).toBe(-PI)
  })

  it("returns the wrapped angle when maxStep is 0 or less", () => {
    expect(Angle.turnToward(0.5, 2, 0)).toBe(0.5)
    expect(Angle.turnToward(0.5, 2, -1)).toBe(0.5)
    expect(Angle.turnToward(0.5, 2, Number.NaN)).toBe(0.5)
    expect(Angle.turnToward(PI, 2, 0)).toBe(-PI)
    expect(Angle.turnToward(0.5 + TAU, 2, 0)).toBeCloseTo(0.5, 14)
  })

  it("turns the negative way from exactly half a turn apart, and wraps the result", () => {
    expect(Angle.turnToward(0, PI, 0.5)).toBe(-0.5)
    expect(Angle.turnToward(-PI + 0.1, 0.5, 0.25)).toBeCloseTo(PI - 0.15, 14)
  })
})
