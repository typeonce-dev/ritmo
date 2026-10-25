import { describe, expect, it } from "vitest"

import { Ops } from "@typeonce/ritmo"
import { Vec2 } from "@typeonce/ritmo-math"

describe("Vec2", () => {
  it("does plain arithmetic", () => {
    expect(Vec2.length({ x: 3, y: 4 })).toBe(5)
    expect(Vec2.add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 })
    expect(Vec2.subtract({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: -2, y: -2 })
    expect(Vec2.scale({ x: 1, y: -2 }, 3)).toEqual({ x: 3, y: -6 })
    expect(Vec2.dot({ x: 1, y: 2 }, { x: 3, y: 4 })).toBe(11)
    expect(Vec2.distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(Vec2.distanceSquared({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25)
    expect(Vec2.lengthSquared({ x: 3, y: 4 })).toBe(25)
    expect(Vec2.lerp({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 })
    const turned = Vec2.rotate({ x: 1, y: 0 }, Math.PI / 2)
    expect(turned.x).toBeCloseTo(0, 12)
    expect(turned.y).toBeCloseTo(1, 12)
  })

  it("normalizes to the caller's fallback at zero", () => {
    expect(Vec2.normalizeOr({ x: 0, y: 0 }, { x: 1, y: 0 })).toEqual({ x: 1, y: 0 })
    expect(Vec2.normalizeOr({ x: 0, y: -2 }, Vec2.zero)).toEqual({ x: 0, y: -1 })
  })

  it("steers without overshooting, and caps lengths", () => {
    expect(Vec2.moveToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 4)).toEqual({ x: 4, y: 0 })
    expect(Vec2.moveToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 40)).toEqual({ x: 10, y: 0 })
    expect(Vec2.clampLength({ x: 30, y: 40 }, 5)).toEqual({ x: 3, y: 4 })
    expect(Vec2.clampLength({ x: 3, y: 4 }, 10)).toEqual({ x: 3, y: 4 })
  })

  it("turns a quarter turn exactly with perpendicular, the 2D cross product through dot", () => {
    expect(Vec2.perpendicular({ x: 3, y: 4 })).toEqual({ x: -4, y: 3 })
    expect(Vec2.perpendicular(Vec2.perpendicular({ x: 3, y: 4 }))).toEqual({ x: -3, y: -4 })
    // Left of the forward direction is positive, right is negative.
    const forward = { x: 1, y: 0 }
    expect(Vec2.dot(Vec2.perpendicular(forward), { x: 5, y: 2 })).toBe(2)
    expect(Vec2.dot(Vec2.perpendicular(forward), { x: 5, y: -2 })).toBe(-2)
  })

  it("goes between angles and unit vectors through Ops", () => {
    expect(Vec2.fromAngle(0)).toEqual({ x: 1, y: 0 })
    expect(Vec2.fromAngle(1.25)).toEqual({ x: Ops.cos(1.25), y: Ops.sin(1.25) })
    expect(Vec2.length(Vec2.fromAngle(2.5))).toBeCloseTo(1, 15)
    expect(Vec2.angle({ x: 3, y: 4 })).toBe(Ops.atan2(4, 3))
    expect(Vec2.angle({ x: 0, y: 2 })).toBe(Math.PI / 2)
    expect(Vec2.angle({ x: -1, y: 0 })).toBe(Math.PI)
    expect(Vec2.angle(Vec2.fromAngle(-2))).toBeCloseTo(-2, 15)
  })

  it("gives 0 for the zero vector and never -0 or a flip to -π from a negative zero", () => {
    expect(Object.is(Vec2.angle({ x: 0, y: 0 }), 0)).toBe(true)
    expect(Object.is(Vec2.angle({ x: -0, y: -0 }), 0)).toBe(true)
    expect(Object.is(Vec2.angle({ x: -0, y: 0 }), 0)).toBe(true)
    expect(Object.is(Vec2.angle({ x: 1, y: -0 }), 0)).toBe(true)
    expect(Vec2.angle({ x: -1, y: -0 })).toBe(Math.PI)
  })

  it("decays toward a target the same way at any step rate, along the straight line", () => {
    const current = { x: 10, y: -20 }
    const target = { x: 0, y: 0 }
    const once = Vec2.decayToward(current, target, 3, 0.5)
    const factor = Ops.exp(-1.5)
    expect(once).toEqual({ x: 10 * factor, y: -20 * factor })
    let stepped = current
    for (let step = 0; step < 50; step++) stepped = Vec2.decayToward(stepped, target, 3, 0.01)
    expect(stepped.x).toBeCloseTo(once.x, 12)
    expect(stepped.y).toBeCloseTo(once.y, 12)
    expect(stepped.y / stepped.x).toBeCloseTo(-2, 12)
  })

  it("keeps current without time or rate, and reaches the target at an infinite rate", () => {
    const current = { x: 1, y: 2 }
    const target = { x: 5, y: 5 }
    expect(Vec2.decayToward(current, target, 3, 0)).toBe(current)
    expect(Vec2.decayToward(current, target, 0, 1)).toBe(current)
    expect(Vec2.decayToward(current, target, -3, 1)).toBe(current)
    expect(Vec2.decayToward(current, target, 3, -1)).toBe(current)
    expect(Vec2.decayToward(current, target, Number.NaN, 1)).toBe(current)
    expect(Vec2.decayToward(current, target, Infinity, 0)).toBe(current)
    expect(Vec2.decayToward(current, target, Infinity, 1 / 60)).toBe(target)
  })
})
