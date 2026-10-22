import { describe, expect, it } from "vitest"

import { Vec2, Vector2 } from "@typeonce/ritmo-math"

describe("Vec2", () => {
  it("does plain arithmetic, accepting validated vectors", () => {
    const validated = Vector2.result({ x: 3, y: 4 })
    if (validated._tag === "Failure") throw new Error("vector")
    expect(Vec2.length(validated.success)).toBe(5)
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
})
