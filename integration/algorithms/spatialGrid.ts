/**
 * A uniform spatial hash for broad-phase queries over circles.
 *
 * Rebuilt every step: `clear`, then `insert` each circle under the caller's
 * own index (its position in an array the caller keeps). Queries visit each
 * candidate whose cells overlap the query box once; the caller runs the
 * exact test. Cell arrays are reused between rebuilds, so a steady state
 * allocates nothing per step.
 *
 * Cells are keyed by packing their coordinates into 16 bits per axis, so
 * cells from -32768 to 32767 on each axis are distinct. Coordinates beyond
 * that share keys with other cells: a query then visits extra candidates,
 * but never misses one.
 *
 * @example
 * ```ts
 * const grid = SpatialGrid.make(cellSize)
 * // Each step:
 * grid.clear()
 * bodies.forEach((body, index) => grid.insert(index, body.x, body.y, body.r))
 * grid.forEachIn(x - range, y - range, x + range, y + range, (index) => {
 *   const other = bodies[index]!
 *   // exact test against `other`
 * })
 * ```
 *
 * @module SpatialGrid
 * @docGroup helpers
 *
 * @categoryDescription Grid Types
 * The grid interface.
 *
 * @categoryDescription Construction
 * Making a grid.
 */
import type * as Scalar from "./Scalar.ts"

/**
 * A spatial hash over circles.
 *
 * @category Grid Types
 */
export interface SpatialGrid {
  /** The side of one square cell, in world units. */
  readonly cellSize: Scalar.Positive
  /** Removes every circle, keeping the storage for the next rebuild. */
  clear(): void
  /**
   * Adds circle `index` (a non-negative integer) covering `[x ± r] × [y ± r]`.
   * A non-finite coordinate or radius throws: it would cover no cell or all of them.
   */
  insert(index: number, x: number, y: number, r: number): void
  /**
   * Calls `visit` once for every circle whose cells overlap the box, in no
   * particular order. `visit` must not insert into or query this grid. A
   * non-finite bound throws (an unbounded box would never finish); a box
   * covering more cells than are occupied scans the occupied cells instead.
   */
  forEachIn(minX: number, minY: number, maxX: number, maxY: number, visit: (index: number) => void): void
}

const key = (cx: number, cy: number): number => ((cx + 32768) << 16) | ((cy + 32768) & 0xffff)

// Keys repeat every 65,536 cells, so a longer span visits nothing new.
const AXIS_CELLS = 65_536
const lastCell = (first: number, last: number): number => Math.min(last, first + AXIS_CELLS - 1)
/** Whether a cell coordinate packed in a key falls in `[first, last]`, counting the keys' wrap-around. */
const coveredBy = (coordinate: number, first: number, last: number): boolean =>
  (((coordinate - first) % AXIS_CELLS) + AXIS_CELLS) % AXIS_CELLS <= last - first

const notFinite = (operation: string, ...values: ReadonlyArray<number>): never => {
  const value = values.find((value) => !Number.isFinite(value))
  throw new Error(`SpatialGrid.${operation} needs finite numbers, got ${value}`)
}

class Grid implements SpatialGrid {
  readonly cellSize: Scalar.Positive
  private readonly cells = new Map<number, Array<number>>()
  private readonly used: Array<Array<number>> = []
  // `stamp[index] === query` marks a circle already visited by this query.
  private stamp = new Int32Array(64)
  private query = 0

  constructor(cellSize: Scalar.Positive) {
    this.cellSize = cellSize
  }

  clear(): void {
    for (const cell of this.used) cell.length = 0
    this.used.length = 0
  }

  insert(index: number, x: number, y: number, r: number): void {
    // `x - x === 0` is false only for NaN and ±Infinity, without a call per number.
    if (x - x !== 0 || y - y !== 0 || r - r !== 0) notFinite("insert", x, y, r)
    const size = this.cellSize
    const minX = Math.floor((x - r) / size)
    const maxX = lastCell(minX, Math.floor((x + r) / size))
    const minY = Math.floor((y - r) / size)
    const maxY = lastCell(minY, Math.floor((y + r) / size))
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const cellKey = key(cx, cy)
        let cell = this.cells.get(cellKey)
        if (cell === undefined) {
          cell = []
          this.cells.set(cellKey, cell)
        }
        if (cell.length === 0) this.used.push(cell)
        cell.push(index)
      }
    }
    if (index >= this.stamp.length) {
      const grown = new Int32Array(Math.max(index + 1, this.stamp.length * 2))
      grown.set(this.stamp)
      this.stamp = grown
    }
  }

  forEachIn(minX: number, minY: number, maxX: number, maxY: number, visit: (index: number) => void): void {
    if (minX - minX !== 0 || minY - minY !== 0 || maxX - maxX !== 0 || maxY - maxY !== 0) notFinite("forEachIn", minX, minY, maxX, maxY)
    const size = this.cellSize
    // Start the marks over before the counter leaves the stamps' range (after
    // about two billion queries), so old marks never match a new query.
    if (this.query === 0x7fffffff) {
      this.stamp.fill(0)
      this.query = 0
    }
    this.query += 1
    const query = this.query
    const stamp = this.stamp
    const x0 = Math.floor(minX / size)
    const x1 = lastCell(x0, Math.floor(maxX / size))
    const y0 = Math.floor(minY / size)
    const y1 = lastCell(y0, Math.floor(maxY / size))
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size) {
      // A box larger than the occupied area: scan the cells that exist.
      for (const [cellKey, cell] of this.cells) {
        if (cell.length === 0) continue
        if (!coveredBy(((cellKey >> 16) & 0xffff) - 32768, x0, x1) || !coveredBy((cellKey & 0xffff) - 32768, y0, y1)) continue
        for (let offset = 0; offset < cell.length; offset++) {
          const index = cell[offset]!
          if (stamp[index] === query) continue
          stamp[index] = query
          visit(index)
        }
      }
      return
    }
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const cell = this.cells.get(key(cx, cy))
        if (cell === undefined) continue
        for (let offset = 0; offset < cell.length; offset++) {
          const index = cell[offset]!
          if (stamp[index] === query) continue
          stamp[index] = query
          visit(index)
        }
      }
    }
  }
}

/**
 * An empty grid with square cells of `cellSize` world units. Pick a size near
 * the typical query box: much smaller cells make every insert and query
 * touch many cells, much larger ones return many far candidates.
 *
 * @category Construction
 */
export const make = (cellSize: Scalar.Positive): SpatialGrid => new Grid(cellSize)
