/**
 * Finding the way around walls: a flow field over a grid of square cells.
 *
 * Every open cell knows its distance to the goal along the shortest path over
 * its eight neighbors (never cutting a wall's corner), so each body only asks
 * which neighbor is closer: one search serves every body following the same
 * goal. Cells are blocked where a body of `clearance` would touch a wall, so
 * the ways it gives keep bodies off the walls.
 *
 * A cell is blocked by its center alone, so a step between two open cells
 * can pass over a wall more than `clearance` from every center the step
 * needs open. A wall `width` by `height` can be stepped through somewhere
 * exactly when
 * `hypot(max(0, cellSize - width), max(0, cellSize - height)) > 2 * clearance`:
 * a fence thinner than `cellSize - 2 * clearance` between two cell centers,
 * or a post smaller than a cell where four open cells meet, which the
 * diagonal step crosses (the corner rule lets it only between four open
 * cells). No step crosses a wall at least `cellSize - clearance * √2` thick
 * both ways, and none crosses any wall when `cellSize <= clearance * √2`. At
 * cells of a body's diameter (`2 * clearance`), no wall a cell long or more
 * can be stepped through, only a shorter one. A game with thinner walls
 * (fences, pillars, thin boxes) makes the cells smaller or the clearance
 * larger until the rule holds; otherwise a way can lead a body into such a
 * wall, where `Collide2.moveCircle` stops it.
 *
 * The grid covers the area the walls span. The walls are taken again only
 * when they change, and distances are worked out again only when the goal
 * moves to another cell, so calling `setWalls` and `setGoal` every step is
 * cheap.
 *
 * @example
 * ```ts
 * declare const cellSize: number, bodyRadius: number
 * declare const walls: ReadonlyArray<Box2.Box2>
 * declare const player: Vec2.Vec2, enemy: Vec2.Vec2
 * // ---cut---
 * const made = FlowField.make(cellSize)
 * if (!made.ok) throw new Error(`bad cell size ${made.error.value}`)
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
   *
   * A wall at least `cellSize - clearance * √2` thick both ways stops every
   * step, and every wall does when `cellSize <= clearance * √2`. A thinner
   * one can fall between the centers of open cells and be stepped through:
   * a fence under `cellSize - 2 * clearance` thick, or a post smaller than a
   * cell where four open cells meet (the module docs give the exact rule).
   * For thin walls, use smaller cells or a larger clearance.
   */
  setWalls(boxes: ReadonlyArray<Box2>, clearance: number): void
  /**
   * Makes `goal` the place every way leads to, searching again only when it
   * is in another cell than last time (or the walls changed). The goal's own
   * cell may be blocked (a target standing against a wall, or backed into a
   * corner): the ways then lead to the nearest open cells around it that it
   * can see in a straight line, however many blocked cells deep it stands.
   */
  setGoal(goal: Vec2): void
  /**
   * The unit direction from `at` toward the center of the neighboring cell
   * closest to the goal, or `undefined` when there is none: outside the grid,
   * walled off from the goal, or already there (in the goal's cell, or in an
   * open cell next to a goal in a blocked one, where the straight line to the
   * goal is the way). From a blocked cell with no open neighbor to step to (a
   * body pressed into a corner) it leads to the nearest open cells it can see
   * in a straight line, to the one closest to the goal.
   *
   * It agrees with {@link distance}: `way` gives a direction exactly where
   * `distance` is a number, except where the body is already there.
   */
  way(at: Vec2): Vec2 | undefined
  /**
   * The path distance, in cells, from the cell holding `at` to the goal, or
   * `undefined` outside the grid or when walled off. From a blocked cell
   * other than the goal's (a body pressed against a wall or into a corner),
   * which the search does not cross, it is the distance out along the steps
   * {@link way} takes: to the nearest open cells it can head for, plus their
   * distance, so it is more than theirs. It is `undefined` exactly where
   * `way` is, except where the body is already there.
   */
  distance(at: Vec2): number | undefined
}

// The eight steps to a neighbor (straight ones first) and their lengths, as
// parallel arrays: the search reads them for every cell it settles.
const stepX = Int8Array.of(1, -1, 0, 0, 1, 1, -1, -1)
const stepY = Int8Array.of(0, 0, 1, -1, 1, -1, 1, -1)
const stepCost = Float64Array.of(1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2)

/** The length of the shortest path of steps over (`dx`, `dy`) cells: diagonal ones first, then straight. */
const pathLength = (dx: number, dy: number): number => {
  const shorter = Math.min(Math.abs(dx), Math.abs(dy))
  return Math.max(Math.abs(dx), Math.abs(dy)) - shorter + shorter * Math.SQRT2
}

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
    if (this.blocked[start] === 0) this.push(start, 0)
    else this.pushBlocked(goal, start)
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
    if (!found) {
      const out = this.blocked[cell] === 1 && cell !== this.goal ? this.cellOut(at, cell) : -1
      if (out < 0) return undefined
      const outColumn = out % columns
      targetX = this.originX + (outColumn + 0.5) * this.cellSize
      targetY = this.originY + ((out - outColumn) / columns + 0.5) * this.cellSize
    }
    const length = Ops.hypot(targetX - at.x, targetY - at.y)
    return length > 1e-6 ? { x: (targetX - at.x) / length, y: (targetY - at.y) / length } : undefined
  }

  /**
   * Starts the search from a goal in a blocked cell: from the cell itself
   * when it has an open neighbor to step to, else (backed into a corner, or
   * more than a cell from the open ones) from the nearest open cells it can
   * see in a straight line: the corner rule keeps bodies from cutting past a
   * wall, not from reaching a goal at one. Kept out of `setGoal`, like
   * `cellOut` out of `way`, so the usual path stays as small as it was:
   * inside them, Node 22 allocated more on every call.
   */
  private pushBlocked(goal: Vec2, start: number): void {
    const goalColumn = start % this.columns
    const goalRow = (start - goalColumn) / this.columns
    if (this.stepsOut(goalColumn, goalRow)) {
      this.push(start, 0)
      return
    }
    const distances = this.distances
    for (let ring = 1, found = false, rings = this.rings(); !found && ring <= rings; ring++) {
      // Around the ring: all of its top and bottom rows, the ends of the others.
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx += dy === -ring || dy === ring ? 1 : 2 * ring) {
          const cell = this.openCell(goalColumn + dx, goalRow + dy)
          if (cell < 0 || !this.sees(goal, goalColumn + dx, goalRow + dy)) continue
          found = true
          const distance = pathLength(dx, dy)
          distances[cell] = distance
          this.push(cell, distance)
        }
      }
    }
  }

  /**
   * The open cell a body in a blocked cell with no neighbor to step to
   * (pressed into a corner) heads for: among the nearest open cells, the one
   * it can see in a straight line that leaves it closest to the goal. -1
   * when there is none.
   */
  private cellOut(at: Vec2, cell: number): number {
    const distances = this.distances
    const column = cell % this.columns
    const row = (cell - column) / this.columns
    let best = distances[cell]!
    let out = -1
    for (let ring = 1, near = false, rings = this.rings(); !near && ring <= rings; ring++) {
      // Around the ring, as in `pushBlocked`.
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx += dy === -ring || dy === ring ? 1 : 2 * ring) {
          const next = this.openCell(column + dx, row + dy)
          if (next < 0) continue
          near = true
          const through = pathLength(dx, dy) + distances[next]!
          if (through >= best || !this.sees(at, column + dx, row + dy)) continue
          best = through
          out = next
        }
      }
    }
    return out
  }

  /**
   * How many rings of cells around a blocked cell to look through for open
   * ones: enough to reach out of the clearance of any wall a body stands
   * against (deeper is inside a wall, or where no body fits).
   */
  private rings(): number {
    const clearance = this.walls![0]!
    return Math.min(Math.max(this.columns, this.rows) - 1, Math.ceil(clearance / this.cellSize) + 2)
  }

  /** The cell at (`column`, `row`) when it is in the grid and open, or -1. */
  private openCell(column: number, row: number): number {
    if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) return -1
    const cell = row * this.columns + column
    return this.blocked[cell] === 1 ? -1 : cell
  }

  /** Whether any step from the cell at (`column`, `row`) is {@link open}. */
  private stepsOut(column: number, row: number): boolean {
    for (let step = 0; step < 8; step++) if (this.open(column, row, stepX[step]!, stepY[step]!)) return true
    return false
  }

  /**
   * Whether the straight line from `from` to the center of the cell at
   * (`column`, `row`) crosses no wall (touching one is fine). As in
   * `Collide2.sweepCircle`, a wall that holds `from` is not in the way, so a
   * body inside a wall sees out of it.
   */
  private sees(from: Vec2, column: number, row: number): boolean {
    const walls = this.walls!
    const toX = this.originX + (column + 0.5) * this.cellSize
    const toY = this.originY + (row + 0.5) * this.cellSize
    const dx = toX - from.x
    const dy = toY - from.y
    const lowX = Math.min(from.x, toX)
    const highX = Math.max(from.x, toX)
    const lowY = Math.min(from.y, toY)
    const highY = Math.max(from.y, toY)
    for (let at = 1; at < walls.length; at += 4) {
      // A wall beside the line is not in the way: most are, so each side is
      // read only once the ones before it did not rule the wall out.
      const minX = walls[at]!
      if (minX >= highX) continue
      const maxX = walls[at + 2]!
      if (maxX <= lowX) continue
      const minY = walls[at + 1]!
      if (minY >= highY) continue
      const maxY = walls[at + 3]!
      if (maxY <= lowY) continue
      // Nor is a wall holding its start.
      if (from.x > minX && from.x < maxX && from.y > minY && from.y < maxY) continue
      // The part of the line inside the wall's slabs, x and y.
      let enter = 0
      let exit = 1
      if (dx === 0) {
        if (from.x <= minX || from.x >= maxX) continue
      } else {
        const t1 = (minX - from.x) / dx
        const t2 = (maxX - from.x) / dx
        enter = Math.max(enter, Math.min(t1, t2))
        exit = Math.min(exit, Math.max(t1, t2))
      }
      if (dy === 0) {
        if (from.y <= minY || from.y >= maxY) continue
      } else {
        const t1 = (minY - from.y) / dy
        const t2 = (maxY - from.y) / dy
        enter = Math.max(enter, Math.min(t1, t2))
        exit = Math.min(exit, Math.max(t1, t2))
      }
      if (enter < exit) return false
    }
    return true
  }

  distance(at: Vec2): number | undefined {
    const cell = this.cellOf(at)
    if (cell < 0) return undefined
    let distance = this.distances[cell]!
    if (distance === Infinity && this.blocked[cell] === 1) distance = this.distanceOut(at, cell)
    return distance === Infinity ? undefined : distance
  }

  /**
   * The path distance from a blocked cell, which the search does not cross,
   * out through the cells `way` heads for: the shortest step to an open
   * neighbor plus its distance, as the search gives an open cell, or else
   * the steps to the open cell `cellOut` picks plus its distance. Infinity
   * where `way` gives no direction. Kept out of `distance`, like `cellOut`
   * out of `way`.
   */
  private distanceOut(at: Vec2, cell: number): number {
    const columns = this.columns
    const distances = this.distances
    const column = cell % columns
    const row = (cell - column) / columns
    let through = Infinity
    for (let step = 0; step < 8; step++) {
      const dx = stepX[step]!
      const dy = stepY[step]!
      if (!this.open(column, row, dx, dy)) continue
      through = Math.min(through, distances[(row + dy) * columns + column + dx]! + stepCost[step]!)
    }
    if (through < Infinity) return through
    const out = this.cellOut(at, cell)
    if (out < 0) return Infinity
    const outColumn = out % columns
    return pathLength(outColumn - column, (out - outColumn) / columns - row) + distances[out]!
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
