import { describe, expect, it } from "vitest"

import { Box2, Collide2 } from "@typeonce/ritmo-math"

describe("Box2.closestPoint", () => {
  const box = Box2.around(0, 0, 10, 5)

  it("clamps a point outside to the nearest edge or corner", () => {
    expect(Box2.closestPoint(box, { x: 20, y: 0 })).toEqual({ x: 10, y: 0 })
    expect(Box2.closestPoint(box, { x: 0, y: -9 })).toEqual({ x: 0, y: -5 })
    expect(Box2.closestPoint(box, { x: -30, y: 30 })).toEqual({ x: -10, y: 5 })
  })

  it("returns a point inside, or on an edge, unchanged", () => {
    expect(Box2.closestPoint(box, { x: 3, y: -2 })).toEqual({ x: 3, y: -2 })
    expect(Box2.closestPoint(box, { x: 10, y: 5 })).toEqual({ x: 10, y: 5 })
  })

  it("collapses to the point of a zero-size box", () => {
    expect(Box2.closestPoint(Box2.around(4, 4, 0, 0), { x: 0, y: 0 })).toEqual({ x: 4, y: 4 })
  })
})

describe("Collide2.overlapsCircleCircle", () => {
  it("counts touching as overlapping, like Box2.overlapsCircle", () => {
    expect(Collide2.overlapsCircleCircle({ x: 0, y: 0 }, 1, { x: 3, y: 0 }, 2)).toBe(true)
    expect(Box2.overlapsCircle(Box2.around(3, 0, 0, 0), { x: 0, y: 0 }, 3)).toBe(true)
  })

  it("tells overlapping and separate circles apart", () => {
    expect(Collide2.overlapsCircleCircle({ x: 0, y: 0 }, 1, { x: 1, y: 1 }, 1)).toBe(true)
    expect(Collide2.overlapsCircleCircle({ x: 0, y: 0 }, 1, { x: 3, y: 4 }, 3.999)).toBe(false)
    expect(Collide2.overlapsCircleCircle({ x: 0, y: 0 }, 1, { x: 3, y: 4 }, 4)).toBe(true)
  })

  it("treats zero radii as points", () => {
    expect(Collide2.overlapsCircleCircle({ x: 2, y: 2 }, 0, { x: 2, y: 2 }, 0)).toBe(true)
    expect(Collide2.overlapsCircleCircle({ x: 2, y: 2 }, 0, { x: 2, y: 2.5 }, 0)).toBe(false)
  })
})
