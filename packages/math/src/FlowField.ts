/**
 * Finding the way around walls: a flow field over a grid of square cells.
 *
 * Every open cell knows its distance to the goal along the shortest path over
 * its eight neighbors (never cutting a wall's corner), so each body only asks
 * which neighbor is closer: one search serves every body following the same
 * goal. Cells are blocked where a body of `clearance` would touch a wall, so
 * the ways it gives keep bodies off the walls.
 *
 * The grid covers the area the walls span. The walls are taken again only
 * when they change, and distances are worked out again only when the goal
 * moves to another cell, so calling `setWalls` and `setGoal` every step is
 * cheap.
 *
 * @example
 * ```ts
 * const made = FlowField.make(cellSize)
 * if (!made.ok) return made
 * const paths = made.value
 * // Each step:
 * paths.setWalls(walls, bodyRadius)
 * paths.setGoal(player)
 * const way = paths.way(enemy) // unit vector, or undefined: walled off or outside
 * ```
 *
 * @module FlowField
 * @docGroup helpers
 *
 * @categoryDescription Field Types
 * The flow field interface.
 *
 * @categoryDescription Construction
 * Making a flow field.
 */
import * as Ops from "@typeonce/ritmo/Ops"
import * as Result from "@typeonce/ritmo/Result"
import { type Box2, overlapsCircle } from "./Box2.ts"
import type { Vec2 } from "./Vec2.ts"

/**
 * A flow field toward one goal.
 *
 * @category Field Types
 */
export interface FlowField {
  /** The side of one square cell, in world units: finite and above 0. */
  readonly cellSize: number
  /**
   * Takes `boxes` as the walls, blocking every cell whose center is within
   * `clearance` of one, over the area the walls span. Does nothing when the
   * walls and clearance are the same as last time.
   */
  setWalls(boxes: ReadonlyArray<Box2>, clearance: number): void
  /**
   * Makes `goal` the place every way leads to, searching again only when it
   * is in another cell than last time (or the walls changed). The goal's own
   * cell may be blocked (a target standing against a wall).
   */
  setGoal(goal: Vec2): void
  /**
   * The unit direction from `at` toward the center of the neighboring cell
   * closest to the goal, or `undefined` when there is none: outside the grid,
   * walled off from the goal, or already in the goal's cell.
   */
  way(at: Vec2): Vec2 | undefined
  /** The path distance from the cell holding `at` to the goal, or `undefined` outside the grid or when walled off. */
  distance(at: Vec2): number | undefined
}

// The eight steps to a neighbor (straight ones first) and their lengths, as
// parallel arrays: the search reads them for every cell it settles.
const stepX = Int8Array.of(1, -1, 0, 0, 1, 1, -1, -1)
const stepY = Int8Array.of(0, 0, 1, -1, 1, -1, 1, -1)
const stepCost = Float64Array.of(1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2)

class Field implements FlowField {
  readonly cellSize: number
  private columns = 0
  private rows = 0
  private originX = 0
  private originY = 0
  private blocked = new Uint8Array(0)
  private distances = new Float64Array(0)
  // The walls and clearance last taken, to skip `setWalls` when nothing changed.
  private walls: Float64Array | undefined
  private goal = -1
  // The search's queue: a binary heap of cells (`heap`) by their distance
  // when queued (`keys`), `queued` entries long. A cell is queued at most
  // once per neighbor that improves it, so eight entries per cell (plus the
  // goal) always fit.
  private heap = new Int32Array(0)
  private keys = new Float64Array(0)
  private queued = 0

  constructor(cellSize: number) {
    this.cellSize = cellSize
  }

  private sameWalls(boxes: ReadonlyArray<Box2>, clearance: number): boolean {
    const walls = this.walls
    if (walls === undefined || walls.length !== boxes.length * 4 + 1 || walls[0] !== clearance) return false
    for (let index = 0; index < boxes.length; index++) {
      const box = boxes[index]!
      const at = index * 4 + 1
      if (walls[at] !== box.minX || walls[at + 1] !== box.minY || walls[at + 2] !== box.maxX || walls[at + 3] !== box.maxY) return false
    }
    return true
  }

  setWalls(boxes: ReadonlyArray<Box2>, clearance: number): void {
    if (this.sameWalls(boxes, clearance)) return
    const walls = new Float64Array(boxes.length * 4 + 1)
    walls[0] = clearance
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let index = 0; index < boxes.length; index++) {
      const box = boxes[index]!
      walls.set([box.minX, box.minY, box.maxX, box.maxY], index * 4 + 1)
      minX = Math.min(minX, box.minX)
      minY = Math.min(minY, box.minY)
      maxX = Math.max(maxX, box.maxX)
      maxY = Math.max(maxY, box.maxY)
    }
    this.walls = walls
    this.goal = -1
    if (boxes.length === 0) {
      this.columns = 0
      this.rows = 0
      return
    }
    const size = this.cellSize
    this.originX = minX
    this.originY = minY
    this.columns = Math.max(1, Math.ceil((maxX - minX) / size))
    this.rows = Math.max(1, Math.ceil((maxY - minY) / size))
    this.blocked = new Uint8Array(this.columns * this.rows)
    this.heap = new Int32Array(this.columns * this.rows * 8 + 1)
    this.keys = new Float64Array(this.columns * this.rows * 8 + 1)
    // No goal yet: every cell is unreachable until `setGoal`.
    this.distances = new Float64Array(this.columns * this.rows).fill(Infinity)
    for (let row = 0; row < this.rows; row++) {
      for (let column = 0; column < this.columns; column++) {
        const center = { x: minX + (column + 0.5) * size, y: minY + (row + 0.5) * size }
        if (boxes.some((box) => overlapsCircle(box, center, clearance))) this.blocked[row * this.columns + column] = 1
      }
    }
  }

  /** The cell holding `at`, or -1 outside the grid. */
  private cellOf(at: Vec2): number {
    const column = Math.floor((at.x - this.originX) / this.cellSize)
    const row = Math.floor((at.y - this.originY) / this.cellSize)
    return column < 0 || row < 0 || column >= this.columns || row >= this.rows ? -1 : row * this.columns + column
  }

  /** Whether the step from a cell by (dx, dy) stays in the grid on open cells, without cutting a corner. */
  private open(column: number, row: number, dx: number, dy: number): boolean {
    const x = column + dx
    const y = row + dy
    if (x < 0 || y < 0 || x >= this.columns || y >= this.rows || this.blocked[y * this.columns + x] === 1) return false
    return dx === 0 || dy === 0 || (this.blocked[row * this.columns + x] === 0 && this.blocked[y * this.columns + column] === 0)
  }

  setGoal(goal: Vec2): void {
    const start = this.cellOf(goal)
    if (start === this.goal) return
    this.goal = start
    const distances = this.distances
    distances.fill(Infinity)
    if (start < 0) return
    // Dijkstra from the goal over open cells.
    const columns = this.columns
    this.queued = 0
    distances[start] = 0
    this.push(start, 0)
    while (this.queued > 0) {
      const queued = this.keys[0]!
      const cell = this.pop()
      const here = distances[cell]!
      if (queued > here) continue
      const column = cell % columns
      const row = (cell - column) / columns
      for (let step = 0; step < 8; step++) {
        const dx = stepX[step]!
        const dy = stepY[step]!
        if (!this.open(column, row, dx, dy)) continue
        const next = (row + dy) * columns + column + dx
        const through = here + stepCost[step]!
        if (through >= distances[next]!) continue
        distances[next] = through
        this.push(next, through)
      }
    }
  }

  way(at: Vec2): Vec2 | undefined {
    const cell = this.cellOf(at)
    if (cell < 0) return undefined
    const columns = this.columns
    const distances = this.distances
    const column = cell % columns
    const row = (cell - column) / columns
    let best = distances[cell]!
    let targetX = 0
    let targetY = 0
    let found = false
    for (let step = 0; step < 8; step++) {
      const dx = stepX[step]!
      const dy = stepY[step]!
      if (!this.open(column, row, dx, dy)) continue
      const next = (row + dy) * columns + column + dx
      if (distances[next]! >= best) continue
      best = distances[next]!
      targetX = this.originX + (column + dx + 0.5) * this.cellSize
      targetY = this.originY + (row + dy + 0.5) * this.cellSize
      found = true
    }
    if (!found) return undefined
    const length = Ops.hypot(targetX - at.x, targetY - at.y)
    return length > 1e-6 ? { x: (targetX - at.x) / length, y: (targetY - at.y) / length } : undefined
  }

  distance(at: Vec2): number | undefined {
    const cell = this.cellOf(at)
    if (cell < 0) return undefined
    const distance = this.distances[cell]!
    return distance === Infinity ? undefined : distance
  }

  /** Queues `cell` at `key` (a cell queued again with a shorter distance leaves its old entry behind, skipped when popped). */
  private push(cell: number, key: number): void {
    const cells = this.heap
    const keys = this.keys
    let index = this.queued++
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (keys[parent]! <= key) break
      cells[index] = cells[parent]!
      keys[index] = keys[parent]!
      index = parent
    }
    cells[index] = cell
    keys[index] = key
  }

  /** Removes and returns the queued cell with the shortest distance (read its key from `keys[0]` first). */
  private pop(): number {
    const cells = this.heap
    const keys = this.keys
    const top = cells[0]!
    const length = --this.queued
    if (length === 0) return top
    const cell = cells[length]!
    const key = keys[length]!
    let index = 0
    for (;;) {
      const left = index * 2 + 1
      if (left >= length) break
      const right = left + 1
      const child = right < length && keys[right]! < keys[left]! ? right : left
      if (keys[child]! >= key) break
      cells[index] = cells[child]!
      keys[index] = keys[child]!
      index = child
    }
    cells[index] = cell
    keys[index] = key
    return top
  }
}

/**
 * Why {@link make} made no flow field: `value`, the cell size it was given,
 * is not a finite number above 0.
 *
 * @category Construction
 */
export interface InvalidCellSize {
  readonly _tag: "InvalidCellSize"
  readonly value: number
}

/**
 * An empty flow field (no walls, no goal) with square cells of `cellSize`
 * world units, or `InvalidCellSize` when `cellSize` is not a finite number
 * above 0. Smaller cells follow walls more closely and cost more to search;
 * around a body's diameter is a good start. Make it once (in a service or a
 * system's setup) and reuse it every step.
 *
 * @example
 * ```ts
 * const paths = FlowField.make(30)
 * if (!paths.ok) throw new Error(`bad cell size ${paths.error.value}`)
 * ```
 *
 * @category Construction
 */
export const make = (cellSize: number): Result.Result<FlowField, InvalidCellSize> =>
  cellSize > 0 && cellSize < Infinity
    ? Result.success(new Field(cellSize))
    : Result.failure({ _tag: "InvalidCellSize", value: cellSize })
