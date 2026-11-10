import { describe, expect, it } from "vitest"

import { Random, Result } from "@typeonce/ritmo"
import { Box2, Collide2, FlowField, type Vec2 } from "@typeonce/ritmo-math"

const fieldOf = (cellSize: number): FlowField.FlowField => {
  const made = FlowField.make(cellSize)
  if (!made.ok) throw new Error("test cell size")
  return made.value
}

/** A walled room 600 wide with a wall down its middle, open only at the bottom. */
const room: ReadonlyArray<Box2.Box2> = [
  { minX: -20, minY: -20, maxX: 620, maxY: 0 },
  { minX: -20, minY: 600, maxX: 620, maxY: 620 },
  { minX: -20, minY: 0, maxX: 0, maxY: 600 },
  { minX: 600, minY: 0, maxX: 620, maxY: 600 },
  { minX: 290, minY: 0, maxX: 310, maxY: 480 }
]

/** A 200 by 200 room with 20-thick walls: with 20-unit cells, their centers are at 10, 30, ... */
const square: ReadonlyArray<Box2.Box2> = [
  { minX: -20, minY: -20, maxX: 220, maxY: 0 },
  { minX: -20, minY: 200, maxX: 220, maxY: 220 },
  { minX: -20, minY: -20, maxX: 0, maxY: 220 },
  { minX: 200, minY: -20, maxX: 220, maxY: 220 }
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
    const field = fieldOf(20)
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
    const field = fieldOf(20)
    field.setWalls([...room.slice(0, 4), { minX: 290, minY: 0, maxX: 310, maxY: 600 }], 15)
    field.setGoal({ x: 450, y: 100 })
    expect(field.way({ x: 150, y: 100 })).toBeUndefined()
    expect(field.distance({ x: 150, y: 100 })).toBeUndefined()
    expect(field.way({ x: 2000, y: 100 })).toBeUndefined()
    expect(field.distance({ x: 2000, y: 100 })).toBeUndefined()
  })

  it("knows no way before a goal, and searches again when the walls change", () => {
    const field = fieldOf(20)
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
    const field = fieldOf(10)
    const blocks = [{ minX: 0, minY: 0, maxX: 50, maxY: 50 }, { minX: 50, minY: 50, maxX: 100, maxY: 100 }, { minX: -10, minY: -10, maxX: 110, maxY: -9 }]
    field.setWalls(blocks, 1)
    field.setGoal({ x: 75, y: 25 })
    const way = field.way({ x: 25, y: 75 })
    expect(way === undefined || !(way.x > 0 && way.y < 0)).toBe(true)
  })

  describe("a goal in a blocked cell", () => {
    it("finds a way to a goal in a room corner", () => {
      // Cells of a body's diameter: a radius-10 player pushed into the corner
      // stands in a blocked cell whose straight neighbours are blocked too.
      const field = fieldOf(20)
      field.setWalls(square, 10)
      field.setGoal({ x: 10.01, y: 10.01 })
      expect(field.way({ x: 100, y: 100 })).toBeDefined()
      expect(field.distance({ x: 100, y: 100 })).toBeDefined()
    })

    it("leads a chaser around a wall to a goal in each of the four corners", () => {
      // A wall across the room, open at the left: chasing in a straight line gets stuck behind it.
      const walls = [...square, { minX: 60, minY: 95, maxX: 220, maxY: 105 }]
      const field = fieldOf(20)
      field.setWalls(walls, 10)
      for (const goal of [{ x: 10.01, y: 10.01 }, { x: 189.99, y: 10.01 }, { x: 10.01, y: 189.99 }, { x: 189.99, y: 189.99 }]) {
        field.setGoal(goal)
        // From the other half of the room.
        const y = goal.y < 100 ? 170 : 30
        for (const from of [{ x: 100, y }, { x: 170, y }]) {
          // As the README chases: the way, or straight at the goal once next to it.
          let at: Vec2.Vec2 = from
          for (let step = 0; step < 200; step++) {
            const toGoal = { x: goal.x - at.x, y: goal.y - at.y }
            const length = Math.hypot(toGoal.x, toGoal.y)
            const way = field.way(at) ?? { x: toGoal.x / (length || 1), y: toGoal.y / (length || 1) }
            const stride = Math.min(5, length)
            at = Collide2.moveCircle(at, { x: way.x * stride, y: way.y * stride }, 10, { boxes: walls }).position
          }
          expect(Math.hypot(goal.x - at.x, goal.y - at.y)).toBeLessThan(0.1)
        }
      }
    })

    it("finds a goal two blocked cells deep against a wall, with a clearance of 1.5 cells", () => {
      // The chasers are radius 30; the player, radius 10, stands against the floor.
      const field = fieldOf(20)
      field.setWalls(square, 30)
      field.setGoal({ x: 100, y: 10.01 })
      expect(field.distance({ x: 100, y: 100 })).toBeDefined()
      const path = walk(field, { x: 100, y: 150 }, { x: 100, y: 10.01 }, 10, 45)
      const end = path[path.length - 1]!
      expect(end.y).toBeLessThan(55)
      // And backed into a corner.
      field.setGoal({ x: 10.01, y: 10.01 })
      expect(field.way({ x: 100, y: 100 })).toBeDefined()
    })

    it("gives a body in a blocked corner cell the way out toward the goal", () => {
      const field = fieldOf(20)
      field.setWalls(square, 10)
      field.setGoal({ x: 150, y: 150 })
      const way = field.way({ x: 10.01, y: 10.01 })
      expect(way).toBeDefined()
      expect(way!.x).toBeGreaterThan(0)
      expect(way!.y).toBeGreaterThan(0)
    })

    it("gives a body in a blocked corner cell the distance of the way out, more than the open cell it heads for", () => {
      const field = fieldOf(20)
      field.setWalls(square, 10)
      field.setGoal({ x: 150, y: 150 })
      // Every straight neighbour of the corner cell is blocked too: the way leads to the diagonal one.
      const corner = { x: 10.01, y: 10.01 }
      const out = field.distance({ x: 30, y: 30 })!
      expect(field.way(corner)).toBeDefined()
      expect(field.distance(corner)).toBeCloseTo(out + Math.SQRT2, 12)
      // Against a wall with an open neighbour: one step plus that neighbour's distance.
      const wall = { x: 100, y: 5 }
      expect(field.way(wall)).toBeDefined()
      expect(field.distance(wall)).toBeCloseTo(field.distance({ x: 110, y: 30 })! + 1, 12)
    })

    it("has neither a way nor a distance from a blocked cell walled off from the goal", () => {
      // A wall across the room, the goal on the far side: the corner body has open cells, none reaching the goal.
      const field = fieldOf(20)
      field.setWalls([...square, { minX: -20, minY: 95, maxX: 220, maxY: 105 }], 10)
      field.setGoal({ x: 150, y: 150 })
      expect(field.way({ x: 10.01, y: 10.01 })).toBeUndefined()
      expect(field.distance({ x: 10.01, y: 10.01 })).toBeUndefined()
      expect(field.distance({ x: 50, y: 50 })).toBeUndefined()
    })

    it("does not lead through a thin wall to a goal standing against it", () => {
      // A wall 1 thick: the cells either side are blocked, and the goal can see only its own side.
      const field = fieldOf(20)
      const thin = { minX: -20, minY: 99.5, maxX: 160, maxY: 100.5 }
      field.setWalls([...square, thin], 10)
      field.setGoal({ x: 50, y: 89.49 })
      // From the far side, the way leads around the end of the wall, not up to it.
      const path = walk(field, { x: 50, y: 150 }, { x: 50, y: 89.49 })
      expect(Math.max(...path.map((at) => at.x))).toBeGreaterThan(160)
    })
  })

  describe("walls thinner than a cell", () => {
    // Cells of 20 and a clearance of 5: a wall can be stepped through exactly when
    // hypot(max(0, 20 - width), max(0, 20 - height)) > 2 * 5.
    it("steps through a fence thinner than cellSize - 2 * clearance, and through no thicker one", () => {
      // A fence across the room on the line between the cell centers at x 90 and 110.
      const fence = (thickness: number) => ({ minX: 100 - thickness / 2, minY: 0, maxX: 100 + thickness / 2, maxY: 200 })
      const field = fieldOf(20)
      field.setWalls([...square, fence(9.9)], 5)
      field.setGoal({ x: 50, y: 100 })
      // Straight through it, as if it were not there.
      expect(field.distance({ x: 150, y: 100 })).toBe(5)
      expect(field.way({ x: 110, y: 110 })).toEqual({ x: -1, y: 0 })
      field.setWalls([...square, fence(10)], 5)
      field.setGoal({ x: 50, y: 100 })
      expect(field.distance({ x: 150, y: 100 })).toBeUndefined()
      expect(field.way({ x: 110, y: 110 })).toBeUndefined()
    })

    it("steps diagonally over a post under cellSize - clearance * √2 across where four cells meet, and over no larger one", () => {
      // 20 - 5 * √2 is 12.93.
      const post = (size: number) => ({ minX: 100 - size / 2, minY: 100 - size / 2, maxX: 100 + size / 2, maxY: 100 + size / 2 })
      const crosses = (size: number) => {
        const field = fieldOf(20)
        field.setWalls([...square, post(size)], 5)
        field.setGoal({ x: 110, y: 110 })
        return [10, 30, 50, 70, 90, 110, 130, 150, 170, 190].some((x) => [10, 30, 50, 70, 90, 110, 130, 150, 170, 190].some((y) => {
          const way = field.way({ x, y })
          return way !== undefined && Collide2.sweepCircle({ x, y }, { x: way.x * 20 * Math.SQRT2, y: way.y * 20 * Math.SQRT2 }, 0, { boxes: [post(size)] }) !== undefined
        }))
      }
      expect(crosses(12.9)).toBe(true)
      expect(crosses(12.95)).toBe(false)
    })
  })

  it("never leads across a blocked corner or through a wall, from an open cell or a blocked one", () => {
    const random = Random.make(3)
    for (let trial = 0; trial < 40; trial++) {
      const field = fieldOf(20)
      const walls = [...room, ...Array.from({ length: 8 }, () => {
        const x = random.range(0, 560)
        const y = random.range(0, 560)
        // At least a cell thick: a thinner wall can fall between two open cell centers.
        return { minX: x, minY: y, maxX: x + random.range(20, 60), maxY: y + random.range(20, 60) }
      })]
      const clearance = random.range(5, 35)
      field.setWalls(walls, clearance)
      // The goal against a wall, where its cell is often blocked.
      const goal = Collide2.pushOut({ x: random.range(0, 600), y: random.range(0, 600) }, clearance + 0.01, { boxes: walls })
      field.setGoal(goal)
      const blockedAt = (x: number, y: number) => walls.some((box) => Math.hypot(x - Math.max(box.minX, Math.min(x, box.maxX)), y - Math.max(box.minY, Math.min(y, box.maxY))) <= clearance)
      for (let x = 10; x < 600; x += 20) {
        for (let y = 10; y < 600; y += 20) {
          if (walls.some((box) => x > box.minX && x < box.maxX && y > box.minY && y < box.maxY)) continue
          const way = field.way({ x, y })
          if (way === undefined) continue
          // Nothing in the way for the first half cell.
          expect(Collide2.sweepCircle({ x, y }, { x: way.x * 10, y: way.y * 10 }, 0, { boxes: walls })).toBeUndefined()
          if (blockedAt(x, y)) continue
          // From an open cell, a step to a neighbour: a diagonal one only past two open cells.
          const dx = Math.round(way.x)
          const dy = Math.round(way.y)
          if (dx !== 0 && dy !== 0) {
            expect(blockedAt(x + dx * 20, y)).toBe(false)
            expect(blockedAt(x, y + dy * 20)).toBe(false)
          }
        }
      }
    }
  })

  it("has a distance exactly where it has a way or the body is already there, and the same distance in every open cell", () => {
    const random = Random.make(5)
    // The open cells' distances summed over every room, as the field gave them before blocked cells had one.
    let openTotal = 0
    for (let trial = 0; trial < 20; trial++) {
      const field = fieldOf(20)
      const walls = [...room, ...Array.from({ length: 8 }, () => {
        const x = random.range(0, 560)
        const y = random.range(0, 560)
        return { minX: x, minY: y, maxX: x + random.range(20, 60), maxY: y + random.range(20, 60) }
      })]
      const clearance = random.range(5, 35)
      field.setWalls(walls, clearance)
      const goal = Collide2.pushOut({ x: random.range(0, 600), y: random.range(0, 600) }, clearance + 0.01, { boxes: walls })
      field.setGoal(goal)
      // Already there: in the goal's cell, or in the open cells around a blocked one that the search starts from.
      const near = Math.ceil(clearance / 20) + 2
      for (let x = 10; x < 600; x += 20) {
        for (let y = 10; y < 600; y += 20) {
          const way = field.way({ x, y })
          const distance = field.distance({ x, y })
          if (way !== undefined) expect(distance).toBeDefined()
          else if (distance !== undefined) expect(Math.max(Math.abs(x - goal.x), Math.abs(y - goal.y))).toBeLessThan((near + 1) * 20)
          const open = !walls.some((box) => Box2.overlapsCircle(box, { x, y }, clearance))
          if (open && distance !== undefined) openTotal += distance
        }
      }
    }
    expect(openTotal).toBe(280101.98239274)
  })

  it("fails with InvalidCellSize unless the cell size is finite and above 0", () => {
    for (const cellSize of [0, -1, -0, Number.NaN, Infinity, -Infinity]) {
      expect(FlowField.make(cellSize)).toEqual(Result.failure({ _tag: "InvalidCellSize", value: cellSize }))
    }
    expect(fieldOf(Number.MIN_VALUE).cellSize).toBe(Number.MIN_VALUE)
  })
})
