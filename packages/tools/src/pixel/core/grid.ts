/**
 * The pixel grid hidden in an upscaled picture: where each "fake pixel"
 * (a cell) starts and ends.
 *
 * A grid is a list of cuts on each axis, in source pixels (fractions
 * allowed). Cells lie between consecutive cuts. A uniform grid comes from a
 * cell size and an offset; auto-detection finds those from the picture, and
 * refinement then moves each cut onto the nearest edge, for pictures whose
 * cells drift (AI output is often stretched unevenly).
 */

/** Pixels in RGBA order, row by row: the shape of the browser's `ImageData`. */
export interface RgbaImage {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

/** A uniform grid: every cell the same size, shifted by an offset. */
export interface GridSpec {
  readonly cellWidth: number
  readonly cellHeight: number
  readonly offsetX: number
  readonly offsetY: number
}

/**
 * Cut positions on each axis, ascending, from the left (top) edge of the
 * picture. With `bend`, the lines are not straight: each moves a little in
 * every row (column) of cells, and `xs` / `ys` are where they would be
 * straight.
 */
export interface Grid {
  readonly xs: ReadonlyArray<number>
  readonly ys: ReadonlyArray<number>
  /**
   * Bent lines: `bend.xs[i][j]` is column cut i where it crosses row j of
   * cells (between `ys[j]` and `ys[j + 1]`), and `bend.ys[i][j]` row cut i
   * in column j.
   */
  readonly bend?: { readonly xs: ReadonlyArray<ReadonlyArray<number>>; readonly ys: ReadonlyArray<ReadonlyArray<number>> } | undefined
}

/** The source box of the cell in column x, row y: [left, top, right, bottom]. */
export const cellBox = (grid: Grid, x: number, y: number): readonly [number, number, number, number] =>
  grid.bend === undefined
    ? [grid.xs[x]!, grid.ys[y]!, grid.xs[x + 1]!, grid.ys[y + 1]!]
    : [grid.bend.xs[x]![y]!, grid.bend.ys[y]![x]!, grid.bend.xs[x + 1]![y]!, grid.bend.ys[y + 1]![x]!]

/** What auto-detection found on one axis. */
export interface AxisFit {
  readonly cell: number
  readonly offset: number
  /** 0 (no grid at all) to 1 (the middle of every cell is flat, all change is on the lines). */
  readonly confidence: number
}

export interface Detection {
  readonly spec: GridSpec
  readonly x: AxisFit
  readonly y: AxisFit
  /** The weaker of the two axes: below about 0.5, check the grid by eye. */
  readonly confidence: number
}

/**
 * Cuts for one axis of a uniform grid. A partial cell at either end of the
 * picture is kept when it is at least half a cell, and dropped otherwise.
 */
export const uniformCuts = (length: number, cell: number, offset: number): Array<number> => {
  if (!(cell > 0) || length <= 0) return [0, length]
  const first = ((offset % cell) + cell) % cell
  const cuts: Array<number> = []
  if (first >= cell / 2) cuts.push(0)
  for (let k = 0; ; k++) {
    const at = first + k * cell
    if (at > length + 1e-9) break
    cuts.push(at)
  }
  const last = cuts[cuts.length - 1]!
  if (length - last >= cell / 2) cuts.push(length)
  // A picture smaller than one cell is one cell.
  if (cuts.length < 2) return [0, length]
  return cuts
}

export const uniformGrid = (width: number, height: number, spec: GridSpec): Grid => ({
  xs: uniformCuts(width, spec.cellWidth, spec.offsetX),
  ys: uniformCuts(height, spec.cellHeight, spec.offsetY)
})

/** The number of cells a grid makes on each axis: the size of the fixed picture. */
export const gridSize = (grid: Grid): { readonly width: number; readonly height: number } => ({
  width: Math.max(0, grid.xs.length - 1),
  height: Math.max(0, grid.ys.length - 1)
})

/**
 * How sharply the color changes across each column boundary (`columns[x]`,
 * between pixels x - 1 and x) and each row boundary, averaged along it.
 * Cell edges show up as peaks repeating at the cell size.
 */
export const edgeProfiles = (image: RgbaImage): { readonly columns: Float64Array; readonly rows: Float64Array } => {
  const { width, height, data } = image
  const columns = new Float64Array(width + 1)
  const rows = new Float64Array(height + 1)
  const stride = width * 4
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * stride + x * 4
      if (x > 0) columns[x]! += difference(data, i, i - 4)
      if (y > 0) rows[y]! += difference(data, i, i - stride)
    }
  }
  for (let x = 0; x <= width; x++) columns[x]! /= Math.max(1, height)
  for (let y = 0; y <= height; y++) rows[y]! /= Math.max(1, width)
  return { columns, rows }
}

const difference = (data: Uint8ClampedArray, i: number, j: number): number =>
  Math.abs(data[i]! - data[j]!) +
  Math.abs(data[i + 1]! - data[j + 1]!) +
  Math.abs(data[i + 2]! - data[j + 2]!) +
  Math.abs(data[i + 3]! - data[j + 3]!)

/** The profile blurred by [1, 2, 1] / 4. */
const smoothed = (profile: Float64Array): Float64Array => {
  const out = new Float64Array(profile.length)
  for (let x = 0; x < profile.length; x++) {
    out[x] = ((profile[x - 1] ?? 0) + 2 * profile[x]! + (profile[x + 1] ?? 0)) / 4
  }
  return out
}

/** The profile at a fractional position, read linearly between boundaries. */
const at = (profile: Float64Array, position: number): number => {
  if (position < 0 || position > profile.length - 1) return 0
  const i = Math.floor(position)
  const f = position - i
  return profile[i]! * (1 - f) + (profile[i + 1] ?? 0) * f
}

/** The mean edge strength on the lines of a grid with this cell and offset. */
const onLines = (profile: Float64Array, length: number, cell: number, offset: number): number => {
  let sum = 0
  let count = 0
  for (let k = 0; ; k++) {
    const position = offset + k * cell
    if (position >= length - 0.5) break
    if (position > 0.5) {
      sum += at(profile, position)
      count++
    }
  }
  return count === 0 ? 0 : sum / count
}

interface Candidate {
  readonly cell: number
  readonly offset: number
  readonly score: number
}

const bestOffset = (profile: Float64Array, length: number, cell: number, from: number, to: number, step: number): Candidate => {
  let best: Candidate = { cell, offset: 0, score: -1 }
  for (let offset = from; offset < to; offset += step) {
    const score = onLines(profile, length, cell, offset)
    if (score > best.score) best = { cell, offset, score }
  }
  return best
}

/**
 * How strongly the profile repeats with this period: the magnitude of its
 * Fourier component at that frequency, after removing its mean and fading
 * its ends (so the picture's borders do not read as a repeat).
 */
const strength = (centered: Float64Array, cell: number): number => {
  let re = 0
  let im = 0
  const step = (2 * Math.PI) / cell
  for (let x = 1; x < centered.length - 1; x++) {
    const value = centered[x]!
    if (value === 0) continue
    re += value * Math.cos(step * x)
    im += value * Math.sin(step * x)
  }
  return Math.hypot(re, im)
}

/**
 * The mean edge strength inside the cells (away from their lines), within
 * `from..to`, where a true grid has none: only noise.
 */
const insideCells = (profile: Float64Array, from: number, to: number, cell: number, offset: number): number => {
  const reach = Math.min(Math.max(1, 0.15 * cell), cell / 2 - 0.5)
  let sum = 0
  let count = 0
  for (let x = from; x <= to; x++) {
    const phase = (((x - offset) % cell) + cell) % cell
    if (Math.min(phase, cell - phase) <= reach) continue
    sum += profile[x]!
    count++
  }
  return count === 0 ? 0 : sum / count
}

export type Axis = "x" | "y"

/** Two cell sizes this close (a share of the larger) are one size. */
const SAME_SIZE = 0.02
/**
 * Two cell sizes this close (a share of the larger) are one square cell, stretched: a
 * screenshot or a resize often scales one axis a few percent more than the other. The
 * wrong sizes are fractions and multiples of the true one, far outside it.
 */
const NEAR_SQUARE = 0.1
/** How much less clean (share of cells with an edge in their middle) the other axis's size may be and still be chosen. */
const SQUARE_SLACK = 0.12

/**
 * How often the middle of a cell holds an edge, along one axis: for each line
 * of pixels across the picture (each row, for "x") and each cell, whether two
 * neighbouring pixels in the middle half of the cell differ by more than
 * `threshold` (summed over channels). A true grid has almost none; a wrong
 * size has an edge in many cells, however large its cells are.
 */
const edgesInside = (image: RgbaImage, axis: Axis, cell: number, offset: number, threshold: number): number => {
  const length = axis === "x" ? image.width : image.height
  const across = axis === "x" ? image.height : image.width
  const step = axis === "x" ? 4 : image.width * 4
  const lineStep = axis === "x" ? image.width * 4 : 4
  const cuts = uniformCuts(length, cell, offset)
  let crossed = 0
  let count = 0
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i]!
    const to = cuts[i + 1]!
    const first = Math.ceil(from + (to - from) * 0.25 - 0.5)
    const last = Math.min(length - 1, Math.max(first + 1, Math.floor(to - (to - from) * 0.25 - 0.5)))
    for (let line = 0; line < across; line++) {
      for (let at = first + 1; at <= last; at++) {
        const p = line * lineStep + at * step
        if (difference(image.data, p, p - step) > threshold) {
          crossed++
          break
        }
      }
      count++
    }
  }
  return count === 0 ? 0 : crossed / count
}

/** A step between neighbouring pixels larger than this is an edge, not noise: well above the typical step. */
const edgeThreshold = (image: RgbaImage): number => {
  const steps: Array<number> = []
  const stride = Math.max(1, Math.floor((image.width * image.height) / 20000))
  for (let i = 0; i < image.width * image.height; i += stride) {
    if (i % image.width === 0) continue
    steps.push(difference(image.data, i * 4, i * 4 - 4))
  }
  steps.sort((a, b) => a - b)
  return Math.max(24, 3 * (steps[Math.floor(steps.length / 2)] ?? 0))
}

/**
 * Finds the cell size and offset on one axis from its edge profile.
 *
 * Cell edges repeat every cell, so the profile's spectrum peaks at the cell
 * size, and at its fractions too (cell / 2 also lands on every edge). Each
 * strong peak is refined to a few thousandths of a pixel, with its offset
 * (upscales by a factor that is not a whole number are common), and judged
 * by how flat the middle of its cells is.
 *
 * `prefer` is a size to choose (or one within `NEAR_SQUARE` of it) when it is
 * nearly as clean as the cleanest: the other axis's cell, since pixel art's
 * cells are square.
 */
export const detectAxis = (
  image: RgbaImage,
  axis: Axis,
  profile: Float64Array,
  maxCell = 128,
  prefer?: number
): AxisFit | undefined => {
  const length = axis === "x" ? image.width : image.height
  const top = Math.min(maxCell, Math.floor(length / 2))
  if (top < 2) return undefined
  let mean = 0
  for (let x = 1; x < length; x++) mean += profile[x]!
  mean /= Math.max(1, length - 1)
  if (mean === 0) return undefined

  // Only the part of the picture with something in it counts (a sprite on a wide empty
  // background would otherwise read as one huge repeat), and the strongest edges are
  // capped (the outline against transparency would otherwise drown the rest).
  let first = 1
  let last = length - 1
  const peak = Math.max(...profile)
  while (first < last && profile[first]! < 0.02 * peak) first++
  while (last > first && profile[last]! < 0.02 * peak) last--
  const active = Array.from(profile.subarray(first, last + 1))
    .filter((value) => value > 0)
    .sort((a, b) => a - b)
  const cap = active[Math.floor(active.length * 0.9)] ?? peak
  let activeMean = 0
  for (let x = first; x <= last; x++) activeMean += Math.min(cap, profile[x]!)
  activeMean /= Math.max(1, last - first + 1)
  const span = last - first + 2
  const centered = new Float64Array(profile.length)
  for (let x = first; x <= last; x++) {
    const fade = Math.sin((Math.PI * (x - first + 1)) / span) ** 2
    centered[x] = (Math.min(cap, profile[x]!) - activeMean) * fade
  }

  // Sampled evenly in frequency, four samples per spectrum bin, from the largest cell to 2.
  const spectrum: Array<{ readonly cell: number; readonly value: number }> = []
  const lowest = 1 / Math.max(2, Math.min(top, Math.floor(span / 2)))
  const fineness = 1 / (4 * length)
  for (let frequency = lowest; frequency <= 0.5 + 1e-12; frequency += fineness) {
    spectrum.push({ cell: 1 / frequency, value: strength(centered, 1 / frequency) })
  }
  const highest = Math.max(...spectrum.map((sample) => sample.value))
  if (highest === 0) return undefined
  const peaks = spectrum
    .filter(
      (sample, i) =>
        sample.value >= 0.25 * highest &&
        sample.value >= (spectrum[i - 1]?.value ?? 0) &&
        sample.value >= (spectrum[i + 1]?.value ?? 0)
    )
    .sort((a, b) => b.value - a.value)
    .slice(0, 12)
  // The true size's own peak can be weaker than its fractions' (sharp edges repeat at
  // every fraction), so whole multiples of each peak are candidates too.
  const sizes: Array<number> = prefer !== undefined && prefer <= top ? [prefer] : []
  for (const peak of peaks) {
    for (let k = 1; k <= 4; k++) {
      const size = peak.cell * k
      if (size > top) break
      if (sizes.every((other) => Math.abs(other - size) > 0.01 * size)) sizes.push(size)
    }
  }

  // Lines are scored on a smoothed profile: a sharp edge is one pixel wide, and a line a
  // fraction of a pixel off it would otherwise miss it.
  const smooth = smoothed(profile)
  const refine = (cell: number): Candidate => {
    const coarse = bestOffset(smooth, length, cell, 0, cell, 0.25)
    let fine = coarse
    const reach = Math.max(0.05, 0.03 * cell)
    for (let size = Math.max(2, cell - reach); size <= cell + reach; size += reach / 40) {
      const candidate = bestOffset(smooth, length, size, coarse.offset - 0.75, coarse.offset + 0.75, 0.05)
      if (candidate.score > fine.score) fine = candidate
    }
    return fine
  }

  // Each candidate is judged by how often the middle of its cells (as the fix reads
  // them) holds an edge: the true size almost never, a wrong size often. A fraction
  // of the true size is just as clean but has half its lines mid-cell, so among the
  // sizes about as clean as the cleanest, the one with the strongest lines wins.
  const threshold = edgeThreshold(image)
  const judged = sizes.map((size) => {
    const candidate = refine(size)
    return { candidate, residual: edgesInside(image, axis, candidate.cell, candidate.offset, threshold) }
  })
  if (judged.length === 0) return undefined
  const flattest = Math.min(...judged.map((entry) => entry.residual))
  const square = judged.filter(
    (entry) => prefer !== undefined && Math.abs(entry.candidate.cell - prefer) <= NEAR_SQUARE * prefer && entry.residual <= flattest + SQUARE_SLACK
  )
  const best = (square.length > 0 ? square : judged.filter((entry) => entry.residual <= flattest + 0.04)).reduce((chosen, entry) =>
    entry.candidate.score > chosen.candidate.score ? entry : chosen
  )
  const fine = best.candidate
  const cell = Math.round(fine.cell * 1000) / 1000
  const offset = Math.round(((((fine.offset % cell) + cell) % cell) * 100)) / 100
  // Sure when the middles of the cells hold no edges and the lines stand out from them.
  const lines = onLines(profile, length, cell, offset)
  const contrast = lines > 0 ? 1 - insideCells(profile, first, last, cell, offset) / lines : 0
  const confidence = Math.min(1 - best.residual, contrast)
  return { cell, offset: offset >= cell ? 0 : offset, confidence: Math.min(1, Math.max(0, confidence)) }
}

/** `detectGrid` on the whole picture. */
const detectWhole = (image: RgbaImage): Detection | undefined => {
  const { columns, rows } = edgeProfiles(image)
  let x = detectAxis(image, "x", columns)
  let y = detectAxis(image, "y", rows)
  if (x === undefined || y === undefined) return undefined
  // Cells are square: when the axes disagree, the less sure one looks again for the
  // surer one's size, or one near it (a fraction of the true size always looks at
  // least as clean).
  if (Math.abs(x.cell - y.cell) > SAME_SIZE * Math.max(x.cell, y.cell)) {
    if (x.confidence >= y.confidence) {
      const again = detectAxis(image, "y", rows, undefined, x.cell)
      if (again !== undefined && Math.abs(again.cell - x.cell) <= NEAR_SQUARE * x.cell) y = again
    } else {
      const again = detectAxis(image, "x", columns, undefined, y.cell)
      if (again !== undefined && Math.abs(again.cell - y.cell) <= NEAR_SQUARE * y.cell) x = again
    }
  }
  return {
    spec: { cellWidth: x.cell, cellHeight: y.cell, offsetX: x.offset, offsetY: y.offset },
    x,
    y,
    confidence: Math.min(x.confidence, y.confidence)
  }
}

/** A border color is the background when this share of the border is within `BORDER_TOLERANCE` of it. */
const BORDER_SHARE = 0.9
/** How far (largest channel step) a pixel may be from the border color and still be background. */
const BORDER_TOLERANCE = 24
/** Pixels kept around the subject, so its outline (its strongest edges) is inside the box, where the edge profiles see it. */
const CROP_MARGIN = 4

/**
 * The box holding the picture's subject: its visible pixels (alpha 128 or more), or, in an
 * opaque picture whose border is one color, the pixels away from that color. Undefined
 * when the subject fills the picture.
 */
const contentBox = (image: RgbaImage): readonly [number, number, number, number] | undefined => {
  const { width, height, data } = image
  let transparent = false
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! < 128) {
      transparent = true
      break
    }
  }
  let key: readonly [number, number, number] | undefined
  if (!transparent) {
    const border: Array<number> = []
    for (let x = 0; x < width; x++) border.push(x * 4, ((height - 1) * width + x) * 4)
    for (let y = 1; y < height - 1; y++) border.push(y * width * 4, (y * width + width - 1) * 4)
    const median = (channel: number): number => {
      const values = border.map((i) => data[i + channel]!).sort((a, b) => a - b)
      return values[Math.floor(values.length / 2)]!
    }
    const candidate = [median(0), median(1), median(2)] as const
    const near = border.filter((i) => Math.max(Math.abs(data[i]! - candidate[0]), Math.abs(data[i + 1]! - candidate[1]), Math.abs(data[i + 2]! - candidate[2])) <= BORDER_TOLERANCE).length
    if (near < BORDER_SHARE * border.length) return undefined
    key = candidate
  }
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const content =
        key === undefined
          ? data[i + 3]! >= 128
          : Math.max(Math.abs(data[i]! - key[0]), Math.abs(data[i + 1]! - key[1]), Math.abs(data[i + 2]! - key[2])) > BORDER_TOLERANCE
      if (!content) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  if (right < 0) return undefined
  const box = [Math.max(0, left - CROP_MARGIN), Math.max(0, top - CROP_MARGIN), Math.min(width, right + 1 + CROP_MARGIN), Math.min(height, bottom + 1 + CROP_MARGIN)] as const
  if (box[0] === 0 && box[1] === 0 && box[2] === width && box[3] === height) return undefined
  return box
}

/** The part of a picture inside a box. */
const cropImage = (image: RgbaImage, [left, top, right, bottom]: readonly [number, number, number, number]): RgbaImage => {
  const width = right - left
  const height = bottom - top
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    data.set(image.data.subarray(((y + top) * image.width + left) * 4, ((y + top) * image.width + right) * 4), y * width * 4)
  }
  return { width, height, data }
}

/**
 * Finds the grid of an upscaled pixel-art picture; undefined when it has no edges at all.
 * It is read on the subject only, then placed back on the whole picture.
 */
export const detectGrid = (image: RgbaImage): Detection | undefined => {
  const box = contentBox(image)
  if (box === undefined) return detectWhole(image)
  const found = detectWhole(cropImage(image, box))
  if (found === undefined) return undefined
  const shift = (offset: number, by: number, cell: number): number => {
    const moved = Math.round(((((offset + by) % cell) + cell) % cell) * 100) / 100
    return moved >= cell ? 0 : moved
  }
  const offsetX = shift(found.spec.offsetX, box[0], found.spec.cellWidth)
  const offsetY = shift(found.spec.offsetY, box[1], found.spec.cellHeight)
  return {
    ...found,
    spec: { ...found.spec, offsetX, offsetY },
    x: { ...found.x, offset: offsetX },
    y: { ...found.y, offset: offsetY }
  }
}

/**
 * Outline pixels, for keeping grid lines off dark strokes: 1 where a pixel is
 * one, row by row (`outline.ts`'s `outlineMask` makes it).
 */
export interface DarkMask {
  readonly width: number
  readonly height: number
  readonly dark: Uint8Array
}

/**
 * How much a cut at each position would split a dark stroke: `profile[x]`
 * is the share of lines (rows from `from` to `to`, for "x") where the pixels
 * on both sides of the boundary before x are outline pixels.
 */
export const crossingProfile = (mask: DarkMask, axis: Axis, from = 0, to = axis === "x" ? mask.height : mask.width): Float64Array => {
  const { width, dark } = mask
  const length = axis === "x" ? mask.width : mask.height
  const out = new Float64Array(length + 1)
  const lines = Math.max(1, to - from)
  for (let a = 1; a < length; a++) {
    let count = 0
    for (let line = from; line < to; line++) {
      const i = axis === "x" ? line * width + a : a * width + line
      if (dark[i] === 1 && dark[axis === "x" ? i - 1 : i - width] === 1) count++
    }
    out[a] = count / lines
  }
  return out
}

/** The edge profile of one axis over a band of lines only (rows from `from` to `to`, for "x"). */
const bandProfile = (image: RgbaImage, axis: Axis, from: number, to: number): Float64Array => {
  const { width, data } = image
  const length = axis === "x" ? image.width : image.height
  const out = new Float64Array(length + 1)
  const stride = width * 4
  const lines = Math.max(1, to - from)
  for (let a = 1; a < length; a++) {
    let sum = 0
    for (let line = from; line < to; line++) {
      const i = axis === "x" ? line * stride + a * 4 : a * stride + line * 4
      sum += difference(data, i, axis === "x" ? i - 4 : i - stride)
    }
    out[a] = sum / lines
  }
  return out
}

/** How much a cut on a dark stroke costs, in units of a typical edge's worth. */
const CROSSING_COST = 4
/** How much a gap a share `s` off the expected cell size costs: `SPACING_COST * s * s`. */
const SPACING_COST = 20

/**
 * Moves the inner cuts onto edges, for pictures whose cells drift or are
 * uneven. All cuts are placed together (dynamic programming): each lands on
 * a strong edge where there is one, every gap stays near the typical cell,
 * and a cut costs more where it would split a dark stroke (`crossings`, with
 * outlines on). Each cut stays within half a cell of where it was, so the
 * number of cells only changes when a sliver left at either end of the
 * picture joins its neighbour; cuts on the picture's border never move.
 */
export const refineCuts = (profile: Float64Array, cuts: ReadonlyArray<number>, length: number, crossings?: Float64Array): Array<number> => {
  const out = placeCuts(profile, cuts, length, crossings)
  // Moving cuts can leave a sliver at either end of the picture: it joins its neighbour.
  if (out.length > 3 && out[0] === 0 && out[1]! < (out[2]! - out[1]!) / 2) out.splice(1, 1)
  const n = out.length
  if (n > 3 && out[n - 1] === length && length - out[n - 2]! < (out[n - 2]! - out[n - 3]!) / 2) out.splice(n - 2, 1)
  return out
}

/** `refineCuts` without joining slivers: always as many cuts as given. */
const placeCuts = (profile: Float64Array, cuts: ReadonlyArray<number>, length: number, crossings?: Float64Array): Array<number> => {
  const movable = cuts.map((cut, i) => (cut > 0 && cut < length ? i : -1)).filter((i) => i >= 0)
  if (movable.length < 2) return [...cuts]
  // Smoothed, so a blurred edge (a plateau a few pixels wide) peaks in its middle.
  const smooth = smoothed(profile)
  let mean = 0
  for (let x = 1; x < length; x++) mean += smooth[x]!
  mean = mean / Math.max(1, length - 1) || 1
  const first = movable[0]!
  const last = movable[movable.length - 1]!
  const spacing = (cuts[last]! - cuts[first]!) / (last - first)
  const step = Math.max(0.25, spacing / 40)
  const reach = spacing / 2
  const gain = (position: number): number => Math.min(at(smooth, position) / mean, 6) - (crossings === undefined ? 0 : CROSSING_COST * at(crossings, position))
  const candidates = movable.map((i) => {
    const list: Array<number> = []
    for (let position = cuts[i]! - reach; position <= cuts[i]! + reach + 1e-9; position += step) {
      if (position > 0.5 && position < length - 0.5) list.push(position)
    }
    return list.length > 0 ? list : [cuts[i]!]
  })
  let score = candidates[0]!.map(gain)
  const back: Array<Int32Array> = [new Int32Array(candidates[0]!.length).fill(-1)]
  for (let k = 1; k < candidates.length; k++) {
    const here = candidates[k]!
    const before = candidates[k - 1]!
    const gaps = movable[k]! - movable[k - 1]!
    const next = new Array<number>(here.length).fill(Number.NEGATIVE_INFINITY)
    const from = new Int32Array(here.length).fill(-1)
    here.forEach((position, b) => {
      for (let a = 0; a < before.length; a++) {
        const gap = (position - before[a]!) / gaps
        if (gap < spacing / 2) continue
        const value = score[a]! - SPACING_COST * ((gap - spacing) / spacing) ** 2
        if (value > next[b]!) {
          next[b] = value
          from[b] = a
        }
      }
      next[b]! += gain(position)
    })
    score = next
    back.push(from)
  }
  let pick = 0
  for (let b = 1; b < score.length; b++) if (score[b]! > score[pick]!) pick = b
  const out = [...cuts]
  for (let k = candidates.length - 1; k >= 0; k--) {
    out[movable[k]!] = Math.round(candidates[k]![pick]! * 100) / 100
    pick = Math.max(0, back[k]![pick]!)
  }
  return out
}

/** Rows (columns) of cells on each side whose edges also place a bent line's cuts in a row, so it bends smoothly. */
const BEND_SPAN = 1

/**
 * Bent lines for one axis: in every band of cells across it (each row, for
 * column lines), the cuts are placed as `refineCuts` places them, from the
 * edges of that band and its `BEND_SPAN` neighbours. `bend[i][j]` is cut i
 * in band j; `profiles[j]` (and `crossings[j]`) are band j's own profiles.
 */
const bendCuts = (
  profiles: ReadonlyArray<Float64Array>,
  crossings: ReadonlyArray<Float64Array> | undefined,
  cuts: ReadonlyArray<number>,
  length: number
): Array<Array<number>> => {
  const sum = (list: ReadonlyArray<Float64Array>, j: number): Float64Array => {
    const out = new Float64Array(length + 1)
    for (let k = Math.max(0, j - BEND_SPAN); k <= Math.min(list.length - 1, j + BEND_SPAN); k++) {
      for (let x = 0; x <= length; x++) out[x]! += list[k]![x]!
    }
    return out
  }
  const bands = profiles.map((_, j) => placeCuts(sum(profiles, j), cuts, length, crossings === undefined ? undefined : sum(crossings, j)))
  return cuts.map((_, i) => bands.map((band) => band[i]!))
}

export interface RefineOptions {
  /** Let lines bend across the picture (each row and column of cells on its own), for pictures whose grid is warped. */
  readonly bend: boolean
  /** The picture's outline pixels: lines keep off its dark strokes. */
  readonly outlines?: DarkMask | undefined
}

/**
 * A grid with every inner cut moved onto its nearest edges (`refineCuts`),
 * or with `bend`, placed in every row and column of cells on its own
 * (`bendCuts`), each line then straight where its mean is.
 */
export const refineGrid = (image: RgbaImage, grid: Grid, options: RefineOptions = { bend: false }): Grid => {
  const mask = options.outlines
  if (!options.bend || grid.xs.length < 3 || grid.ys.length < 3) {
    const { columns, rows } = edgeProfiles(image)
    return {
      xs: refineCuts(columns, grid.xs, image.width, mask === undefined ? undefined : crossingProfile(mask, "x")),
      ys: refineCuts(rows, grid.ys, image.height, mask === undefined ? undefined : crossingProfile(mask, "y"))
    }
  }
  const band = (cuts: ReadonlyArray<number>, j: number, limit: number): readonly [number, number] => [
    Math.max(0, Math.round(cuts[j]!)),
    Math.min(limit, Math.max(Math.round(cuts[j]!) + 1, Math.round(cuts[j + 1]!)))
  ]
  const rowBands = Array.from({ length: grid.ys.length - 1 }, (_, j) => band(grid.ys, j, image.height))
  const columnBands = Array.from({ length: grid.xs.length - 1 }, (_, j) => band(grid.xs, j, image.width))
  const xs = bendCuts(
    rowBands.map(([from, to]) => bandProfile(image, "x", from, to)),
    mask === undefined ? undefined : rowBands.map(([from, to]) => crossingProfile(mask, "x", from, to)),
    grid.xs,
    image.width
  )
  const ys = bendCuts(
    columnBands.map(([from, to]) => bandProfile(image, "y", from, to)),
    mask === undefined ? undefined : columnBands.map(([from, to]) => crossingProfile(mask, "y", from, to)),
    grid.ys,
    image.height
  )
  const mean = (line: ReadonlyArray<number>): number => Math.round((line.reduce((total, value) => total + value, 0) / line.length) * 100) / 100
  return { xs: xs.map(mean), ys: ys.map(mean), bend: { xs, ys } }
}

/**
 * Where a grid of a known cell size starts in a picture: the offset whose
 * lines land on the strongest edges, on each axis. For frames of one sheet,
 * drawn at one size but each placed on its own.
 */
export const fitOffsets = (image: RgbaImage, cellWidth: number, cellHeight: number): { readonly offsetX: number; readonly offsetY: number } => {
  const { columns, rows } = edgeProfiles(image)
  const fit = (profile: Float64Array, length: number, cell: number): number => {
    const found = bestOffset(smoothed(profile), length, cell, 0, cell, 0.05).offset
    return Math.round(found * 100) / 100
  }
  return { offsetX: fit(columns, image.width, cellWidth), offsetY: fit(rows, image.height, cellHeight) }
}
