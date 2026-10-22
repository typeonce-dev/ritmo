import { describe, expect, it } from "vitest"

import { Random, Scalar, SpatialGrid } from "@typeonce/ritmo-math"

const cellSize = (value: number): Scalar.Positive => {
  const size = Scalar.Positive.result(value)
  if (size._tag === "Failure") throw new Error("test cell size")
  return size.success
}

describe("SpatialGrid", () => {
  it("visits every circle overlapping the query box exactly once, matching brute force", () => {
    const random = Random.make(11)
    const grid = SpatialGrid.make(cellSize(32))
    for (let round = 0; round < 20; round++) {
      // Rebuilt each round, as each step does.
      grid.clear()
      const circles = Array.from({ length: 300 }, () => ({ x: random.range(-500, 500), y: random.range(-500, 500), r: random.range(1, 60) }))
      circles.forEach((circle, index) => grid.insert(index, circle.x, circle.y, circle.r))
      for (let query = 0; query < 50; query++) {
        const x = random.range(-600, 600)
        const y = random.range(-600, 600)
        const half = random.range(0, 150)
        const visited: Array<number> = []
        grid.forEachIn(x - half, y - half, x + half, y + half, (index) => visited.push(index))
        expect(new Set(visited).size).toBe(visited.length)
        const overlapping = circles.flatMap((circle, index) =>
          circle.x + circle.r >= x - half && circle.x - circle.r <= x + half && circle.y + circle.r >= y - half && circle.y - circle.r <= y + half ? [index] : [])
        for (const index of overlapping) expect(visited).toContain(index)
      }
    }
  })

  it("forgets circles on clear", () => {
    const grid = SpatialGrid.make(cellSize(10))
    grid.insert(0, 5, 5, 1)
    grid.clear()
    grid.insert(1, 50, 50, 1)
    const visited: Array<number> = []
    grid.forEachIn(-100, -100, 100, 100, (index) => visited.push(index))
    expect(visited).toEqual([1])
  })
})

describe("SpatialGrid bounds", () => {
  it("throws on non-finite input and finishes a huge box", () => {
    const grid = SpatialGrid.make(cellSize(10))
    grid.insert(0, 5, 5, 1)
    expect(() => grid.insert(1, Number.NaN, 0, 1)).toThrow("SpatialGrid.insert needs finite numbers, got NaN")
    expect(() => grid.forEachIn(-Infinity, 0, 10, 10, () => {})).toThrow("SpatialGrid.forEachIn needs finite numbers, got -Infinity")
    const seen: Array<number> = []
    grid.forEachIn(-1e12, -1e12, 1e12, 1e12, (index) => seen.push(index))
    expect(seen).toEqual([0])
  })
})

describe("SpatialGrid scans", () => {
  it("visits the same circles whether it walks the box's cells or scans the occupied ones", () => {
    const random = Random.make(11)
    const size = 8
    const circles = Array.from({ length: 60 }, () => ({ x: random.range(-200, 200), y: random.range(-200, 200), r: random.range(0, 12) }))
    const grid = SpatialGrid.make(cellSize(size))
    circles.forEach((circle, index) => grid.insert(index, circle.x, circle.y, circle.r))
    const cellsOf = (min: number, max: number) => [Math.floor(min / size), Math.floor(max / size)] as const
    for (let query = 0; query < 200; query++) {
      const x = random.range(-250, 250)
      const y = random.range(-250, 250)
      // Small boxes walk cells; large ones cover more cells than are occupied and scan.
      const half = query % 2 === 0 ? random.range(0, 10) : random.range(100, 400)
      const seen: Array<number> = []
      grid.forEachIn(x - half, y - half, x + half, y + half, (index) => seen.push(index))
      const [qx0, qx1] = cellsOf(x - half, x + half)
      const [qy0, qy1] = cellsOf(y - half, y + half)
      const expected = circles.flatMap((circle, index) => {
        const [cx0, cx1] = cellsOf(circle.x - circle.r, circle.x + circle.r)
        const [cy0, cy1] = cellsOf(circle.y - circle.r, circle.y + circle.r)
        return cx0 <= qx1 && qx0 <= cx1 && cy0 <= qy1 && qy0 <= cy1 ? [index] : []
      })
      expect(seen.sort((a, b) => a - b)).toEqual(expected)
    }
  })
})

