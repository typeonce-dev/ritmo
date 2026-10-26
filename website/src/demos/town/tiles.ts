// Which piece of which sheet each part of the town is drawn with. Plain data
// for the renderer: tile coordinates in the Ninja Adventure sheets (16 px
// tiles), and the autotiling that picks path and water edges.
import { buildings, groundAt, MAP_COLUMNS, MAP_ROWS, trees } from "./map.ts"
import type { BuildingKind, Cell, Direction, Ground } from "./map.ts"

/** The tileset images the town uses. */
export type Sheet = "floor" | "floorDetail" | "water" | "nature" | "house" | "element"

/** A rectangle of tiles on one sheet. */
export interface Region {
  readonly sheet: Sheet
  readonly col: number
  readonly row: number
  readonly columns: number
  readonly rows: number
}

const tile = (sheet: Sheet, col: number, row: number, columns = 1, rows = 1): Region => ({ sheet, col, row, columns, rows })

export const buildingArt = {
  home: tile("house", 0, 0, 4, 3)
} as const satisfies Record<BuildingKind, Region>

const treeArt = [tile("nature", 0, 0, 2, 2), tile("nature", 16, 0, 2, 2)] as const
export const signArt = tile("element", 0, 2)
const flowersArt = tile("floorDetail", 5, 2)
const bushArt = tile("nature", 10, 9)
const grassArt = tile("floor", 0, 12)
const grassDetails = [tile("floor", 1, 12), tile("floor", 2, 12), tile("floor", 3, 12), tile("floor", 2, 11), tile("floor", 3, 11)] as const
const tufts = [tile("floorDetail", 0, 2), tile("floorDetail", 3, 2), tile("floorDetail", 2, 2)] as const

/** Column of each direction in a character's walk sheet; rows are the four frames. */
export const walkColumn = { Down: 0, Up: 1, Left: 2, Right: 3 } as const satisfies Record<Direction, number>

// ── Autotiling ──────────────────────────────────────────────────────────
//
// Path and water are 47-tile "blob" sets laid out the same way in both
// sheets. The key lists which neighbours are the same terrain, as bits in
// the order N E S W NE SE SW NW; a corner counts only when both of its
// sides do. The value is the tile's offset from the set's top-left tile.
const blob: Readonly<Record<string, readonly [number, number]>> = {
  "00000000": [3, 3], "00010000": [2, 3], "01000000": [0, 3], "01010000": [1, 3],
  "00100000": [3, 0], "10100000": [3, 1], "10000000": [3, 2],
  "01100000": [4, 0], "01100100": [0, 0], "00110000": [7, 0], "00110010": [2, 0],
  "11000000": [4, 3], "11001000": [0, 2], "10010000": [7, 3], "10010001": [2, 2],
  "01110000": [8, 0], "01110010": [5, 0], "01110100": [6, 0], "01110110": [1, 0],
  "11010000": [8, 3], "11010001": [5, 3], "11011000": [6, 3], "11011001": [1, 2],
  "11100000": [4, 4], "11100100": [4, 2], "11101000": [4, 1], "11101100": [0, 1],
  "10110000": [7, 4], "10110001": [7, 1], "10110010": [7, 2], "10110011": [2, 1],
  "11110000": [8, 4], "11110001": [10, 3], "11110010": [10, 2], "11110011": [5, 4],
  "11110100": [9, 2], "11110101": [9, 0], "11110110": [8, 2], "11110111": [5, 2],
  "11111000": [9, 3], "11111001": [8, 1], "11111010": [9, 1], "11111011": [5, 1],
  "11111100": [6, 4], "11111101": [6, 1], "11111110": [6, 2], "11111111": [1, 1]
}

/** Where each blob set starts on its sheet, and the full-tile variants for variety. */
const blobSets = {
  path: { sheet: "floor", col: 0, row: 7, fullVariants: [[1, 1], [1, 1], [1, 1], [0, 4], [1, 4]] },
  water: { sheet: "water", col: 0, row: 6, fullVariants: [[1, 1]] }
} as const satisfies Record<"path" | "water", { readonly sheet: Sheet; readonly col: number; readonly row: number; readonly fullVariants: ReadonlyArray<readonly [number, number]> }>

/** A stable pseudo-random number per cell, for picking variants. */
const hash = (cell: Cell, salt: number): number => {
  let h = Math.imul(cell.col + 1, 73856093) ^ Math.imul(cell.row + 1, 19349663) ^ Math.imul(salt, 83492791)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const blobRegion = (terrain: "path" | "water", cell: Cell): Region => {
  const same = (col: number, row: number) => groundAt({ col: cell.col + col, row: cell.row + row }) === terrain
  const n = same(0, -1), e = same(1, 0), s = same(0, 1), w = same(-1, 0)
  const bits = [n, e, s, w, n && e && same(1, -1), s && e && same(1, 1), s && w && same(-1, 1), n && w && same(-1, -1)]
  const key = bits.map(Number).join("")
  const set = blobSets[terrain]
  const offset = key === "11111111"
    ? set.fullVariants[Math.floor(hash(cell, 1) * set.fullVariants.length)] ?? [1, 1]
    : blob[key] ?? [1, 1]
  return tile(set.sheet, set.col + offset[0], set.row + offset[1])
}

const pick = <A>(items: ReadonlyArray<A>, cell: Cell, salt: number): A | undefined => items[Math.floor(hash(cell, salt) * items.length)]

const grassRegion = (cell: Cell): Region => hash(cell, 2) < 0.18 ? pick(grassDetails, cell, 3) ?? grassArt : grassArt

/** One image to place: its region, at a tile of the map. */
export interface Placed {
  readonly region: Region
  readonly cell: Cell
}

/** The ground layer: one full tile per cell. */
export const groundLayer = (): ReadonlyArray<Placed> => {
  const placed: Array<Placed> = []
  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLUMNS; col++) {
      const cell = { col, row }
      const ground: Ground | undefined = groundAt(cell)
      const region = ground === "path" || ground === "water" ? blobRegion(ground, cell) : grassRegion(cell)
      placed.push({ region, cell })
    }
  }
  return placed
}

/** What stands on the ground: flowers, bushes, tufts of grass, trees, and buildings. */
export const objectLayer = (): ReadonlyArray<Placed> => {
  const placed: Array<Placed> = []
  const covered = new Set<string>()
  const cover = (origin: Cell, columns: number, rows: number) => {
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) covered.add(`${origin.col + col},${origin.row + row}`)
  }
  trees.forEach((cell) => cover(cell, 2, 2))
  buildings.forEach(({ kind, cell }) => cover(cell, buildingArt[kind].columns, buildingArt[kind].rows))

  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLUMNS; col++) {
      const cell = { col, row }
      const ground = groundAt(cell)
      if (ground === "flowers") placed.push({ region: flowersArt, cell })
      else if (ground === "bush") placed.push({ region: bushArt, cell })
      else if (ground === "grass" && !covered.has(`${col},${row}`) && hash(cell, 4) < 0.07) {
        const tuft = pick(tufts, cell, 5)
        if (tuft !== undefined) placed.push({ region: tuft, cell })
      }
    }
  }
  for (const cell of trees) placed.push({ region: pick(treeArt, cell, 6) ?? treeArt[0], cell })
  for (const { kind, cell } of buildings) placed.push({ region: buildingArt[kind], cell })
  return placed
}
