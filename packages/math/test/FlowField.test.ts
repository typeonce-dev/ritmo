import { describe, expect, it } from "vitest"

import { type Box2, FlowField, Scalar, type Vec2 } from "@typeonce/ritmo-math"

const cellSize = (value: number): Scalar.Positive => {
  const size = Scalar.Positive.result(value)
  if (size._tag === "Failure") throw new Error("test cell size")
  return size.success
}

/** A walled room 600 wide with a wall down its middle, open only at the bottom. */
const room: ReadonlyArray<Box2.Box2> = [
  { minX: -20, minY: -20, maxX: 620, maxY: 0 },
  { minX: -20, minY: 600, maxX: 620, maxY: 620 },
  { minX: -20, minY: 0, maxX: 0, maxY: 600 },
  { minX: 600, minY: 0, maxX: 620, maxY: 600 },
  { minX: 290, minY: 0, maxX: 310, maxY: 480 }
]

/** Follows the field from `from` in steps of `stride` until within `reach` of `goal`; the path taken. */
const walk = (field: FlowField.FlowField, from: Vec2.Vec2, goal: Vec2.Vec2, stride = 10, reach = 30) => {
  const path = [from]
  let at = from
  for (let step = 0; step < 400 && Math.hypot(goal.x - at.x, goal.y - at.y) > reach; step++) {
    const way = field.way(at)
    if (way === undefined) break
    at = { x: at.x + way.x * stride, y: at.y + way.y * stride }
    path.push(at)
  }
  return path
}

describe("FlowField", () => {
  it("leads around a wall in between, through the opening, never into a wall", () => {
    const field = FlowField.make(cellSize(20))
    field.setWalls(room, 15)
    const goal = { x: 450, y: 100 }
    field.setGoal(goal)
    const path = walk(field, { x: 150, y: 100 }, goal)
    const end = path[path.length - 1]!
    expect(Math.hypot(goal.x - end.x, goal.y - end.y)).toBeLessThanOrEqual(30)
    // It went down through the opening below the middle wall.
    expect(Math.max(...path.map((at) => at.y))).toBeGreaterThan(480)
    for (const at of path) expect(room.some((box) => at.x > box.minX && at.x < box.maxX && at.y > box.minY && at.y < box.maxY)).toBe(false)
    // Down to the opening and back up: much longer than the straight line.
    expect(field.distance({ x: 150, y: 100 })! * 20).toBeGreaterThan(700)
    expect(field.distance(goal)).toBe(0)
  })

  it("has no way out of a walled-off place, or outside the walls", () => {
    const field = FlowField.make(cellSize(20))
    field.setWalls([...room.slice(0, 4), { minX: 290, minY: 0, maxX: 310, maxY: 600 }], 15)
    field.setGoal({ x: 450, y: 100 })
    expect(field.way({ x: 150, y: 100 })).toBeUndefined()
    expect(field.distance({ x: 150, y: 100 })).toBeUndefined()
    expect(field.way({ x: 2000, y: 100 })).toBeUndefined()
    expect(field.distance({ x: 2000, y: 100 })).toBeUndefined()
  })

  it("knows no way before a goal, and searches again when the walls change", () => {
    const field = FlowField.make(cellSize(20))
    field.setWalls(room, 15)
    expect(field.distance({ x: 150, y: 100 })).toBeUndefined()
    field.setGoal({ x: 450, y: 100 })
    expect(field.way({ x: 150, y: 100 })).toBeDefined()
    // Closing the opening, with the goal in the same cell: the field follows the walls.
    field.setWalls([...room.slice(0, 4), { minX: 290, minY: 0, maxX: 310, maxY: 600 }], 15)
    field.setGoal({ x: 450, y: 100 })
    expect(field.way({ x: 150, y: 100 })).toBeUndefined()
  })

  it("never cuts a wall's corner diagonally", () => {
    // Two blocks touching at a corner; the diagonal between them is closed.
    const field = FlowField.make(cellSize(10))
    const blocks = [{ minX: 0, minY: 0, maxX: 50, maxY: 50 }, { minX: 50, minY: 50, maxX: 100, maxY: 100 }, { minX: -10, minY: -10, maxX: 110, maxY: -9 }]
    field.setWalls(blocks, 1)
    field.setGoal({ x: 75, y: 25 })
    const way = field.way({ x: 25, y: 75 })
    expect(way === undefined || !(way.x > 0 && way.y < 0)).toBe(true)
  })
})
