/**
 * Turning the cells of a grid into true pixels: one color per cell, taken
 * from the palette.
 *
 * Each cell is read from its middle only (its edges blend in the
 * neighbours' colors when the picture is blurred). With a palette, every
 * pixel read votes for its nearest palette color and the most votes win, so
 * no in-between color is ever made up. Without one, the cell keeps the
 * median of its colors. Specks left over are cleaned up in `cleanup.ts`.
 */
import { channel, makeMatcher, pack, unpack, type Metric, type Rgb } from "./color.ts"
import { gridSize, type Grid, type RgbaImage } from "./grid.ts"

/** The fixed picture: one entry per pixel, an index into `palette`, or -1 where it is transparent. */
export interface PixelArt {
  readonly width: number
  readonly height: number
  readonly palette: ReadonlyArray<Rgb>
  readonly indices: Int32Array
}

export const TRANSPARENT = -1

/** The pixels read from each cell, row by row. */
export interface CellSamples {
  readonly width: number
  readonly height: number
  readonly cells: ReadonlyArray<Cell>
}

export interface Cell {
  /** The opaque pixels read, packed as 0xRRGGBB. */
  readonly colors: ReadonlyArray<number>
  /** How many pixels read were transparent. */
  readonly transparent: number
}

export interface SampleOptions {
  /** The share of each side of a cell left out, 0 (the whole cell) to 0.45 (just the middle). */
  readonly inset: number
  /** Pixels with alpha below this (0..255) count as transparent. */
  readonly alphaThreshold: number
}

export const defaultSampleOptions: SampleOptions = { inset: 0.25, alphaThreshold: 128 }

/** Reads the middle of every cell of a grid. */
export const sampleCells = (image: RgbaImage, grid: Grid, options: SampleOptions): CellSamples => {
  const { width, height } = gridSize(grid)
  const inset = Math.min(0.45, Math.max(0, options.inset))
  const span = (cuts: ReadonlyArray<number>, i: number, limit: number): readonly [number, number] => {
    const from = cuts[i]!
    const to = cuts[i + 1]!
    const margin = (to - from) * inset
    // Pixels whose centers fall inside the trimmed cell; at least the one in the middle.
    let first = Math.ceil(from + margin - 0.5)
    let last = Math.floor(to - margin - 0.5)
    if (last < first) first = last = Math.floor((from + to) / 2)
    return [Math.max(0, Math.min(limit - 1, first)), Math.max(0, Math.min(limit - 1, last))]
  }
  const columns = Array.from({ length: width }, (_, i) => span(grid.xs, i, image.width))
  const rows = Array.from({ length: height }, (_, i) => span(grid.ys, i, image.height))
  const cells: Array<Cell> = []
  for (const [y0, y1] of rows) {
    for (const [x0, x1] of columns) {
      const colors: Array<number> = []
      let transparent = 0
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = (y * image.width + x) * 4
          if (image.data[i + 3]! < options.alphaThreshold) transparent++
          else colors.push(pack(image.data[i]!, image.data[i + 1]!, image.data[i + 2]!))
        }
      }
      cells.push({ colors, transparent })
    }
  }
  return { width, height, cells }
}

/** The per-channel median of a cell's opaque colors. */
export const medianColor = (colors: ReadonlyArray<number>): Rgb => {
  const median = (shift: number): number => {
    const values = colors.map((color) => (color >> shift) & 255).sort((a, b) => a - b)
    return values[Math.floor(values.length / 2)] ?? 0
  }
  return { r: median(16), g: median(8), b: median(0) }
}

/** The color each opaque cell would keep without a palette: what a palette is extracted from. */
export const cellColors = (samples: CellSamples): Array<Rgb> =>
  samples.cells.filter((cell) => cell.colors.length > cell.transparent).map((cell) => medianColor(cell.colors))

export type Dither = "none" | "ordered"

export interface QuantizeOptions {
  /** The colors allowed; empty keeps each cell's own (median) color. */
  readonly palette: ReadonlyArray<Rgb>
  readonly metric: Metric
  /** Ordered (Bayer) dithering mixes palette colors to fake missing shades; off by default, as hand-made pixel art rarely wants it. */
  readonly dither: Dither
  /** 0 to 1: how far a shade may be pushed toward the next palette color. */
  readonly ditherStrength: number
}

const bayer4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((value) => (value + 0.5) / 16 - 0.5)

/** One color per cell. */
export const quantize = (samples: CellSamples, options: QuantizeOptions): PixelArt => {
  const { width, height, cells } = samples
  const indices = new Int32Array(width * height)
  const opaque = (cell: Cell): boolean => cell.colors.length > cell.transparent

  if (options.palette.length === 0) {
    const palette: Array<Rgb> = []
    const slots = new Map<number, number>()
    cells.forEach((cell, i) => {
      if (!opaque(cell)) {
        indices[i] = TRANSPARENT
        return
      }
      const color = medianColor(cell.colors)
      const key = pack(color.r, color.g, color.b)
      let slot = slots.get(key)
      if (slot === undefined) {
        slot = palette.length
        slots.set(key, slot)
        palette.push(color)
      }
      indices[i] = slot
    })
    return { width, height, palette, indices }
  }

  const matcher = makeMatcher(options.palette, options.metric)
  const votes = new Int32Array(options.palette.length)
  cells.forEach((cell, i) => {
    if (!opaque(cell)) {
      indices[i] = TRANSPARENT
      return
    }
    if (options.dither === "ordered") {
      const color = medianColor(cell.colors)
      const x = i % width
      const y = Math.floor(i / width)
      const push = bayer4[(y % 4) * 4 + (x % 4)]! * options.ditherStrength * 64
      indices[i] = matcher.nearest({
        r: channel(color.r + push),
        g: channel(color.g + push),
        b: channel(color.b + push)
      })
      return
    }
    votes.fill(0)
    for (const color of cell.colors) votes[matcher.nearest(unpack(color))]!++
    let best = 0
    for (let v = 1; v < votes.length; v++) if (votes[v]! > votes[best]!) best = v
    indices[i] = best
  })
  return { width, height, palette: options.palette, indices }
}

/** The palette colors the picture uses, in palette order, with how many pixels use each. */
export const usedColors = (art: PixelArt): Array<{ readonly color: Rgb; readonly count: number }> => {
  const counts = new Int32Array(art.palette.length)
  for (const index of art.indices) if (index >= 0) counts[index]!++
  return art.palette.map((color, i) => ({ color, count: counts[i]! })).filter((entry) => entry.count > 0)
}
