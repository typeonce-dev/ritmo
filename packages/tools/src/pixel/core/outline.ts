/**
 * One-pixel outlines: the dark lines most pixel art draws around and inside
 * its shapes.
 *
 * Image generators draw them about one cell wide but not on the cells, so a
 * grid line through the middle of a stroke splits it between two cells, and
 * the fixed picture gets a doubled outline. With outlines on, the grid keeps
 * its lines off dark strokes (`grid.ts`'s `crossingProfile`), and a stroke
 * still split in two is given back to the cell holding more of it
 * (`thinOutlines`).
 *
 * After ToPixel (https://github.com/daisuqe/ToPixel), whose outline mode
 * these follow.
 */
import { TRANSPARENT, type PixelArt } from "./fix.ts"
import { cellBox, gridSize, type DarkMask, type Grid, type RgbaImage } from "./grid.ts"

/** The picture's outline pixels: opaque and among its darkest. */
export interface OutlineMask extends DarkMask {
  /** The darkest luminance (0 to 255) that still counts as outline. */
  readonly threshold: number
}

const luminance = (r: number, g: number, b: number): number => r * 0.299 + g * 0.587 + b * 0.114

/**
 * The darkest luminance that still counts as outline, from a luminance
 * histogram of the opaque pixels: past the darkest 5%, at the emptiest
 * luminance within reach, so the darkest shade of a fill a little lighter
 * than the outline stays out; capped well below middle grey (a picture with
 * no dark lines then has almost none).
 */
const darkThreshold = (histogram: Uint32Array): number => {
  let opaque = 0
  for (const count of histogram) opaque += count
  if (opaque === 0) return -1
  let seen = 0
  let darkest = 0
  for (; darkest < 255; darkest++) {
    seen += histogram[darkest]!
    if (seen >= opaque * 0.05) break
  }
  const smooth = (value: number): number => {
    let sum = 0
    for (let k = Math.max(0, value - 2); k <= Math.min(255, value + 2); k++) sum += histogram[k]!
    return sum
  }
  const top = Math.min(darkest + 60, 120)
  let threshold = Math.min(darkest + 30, 100)
  let emptiest = Number.POSITIVE_INFINITY
  for (let value = darkest + 8; value <= top; value++) {
    const count = smooth(value)
    if (count < emptiest) {
      emptiest = count
      threshold = value
    }
  }
  // A run of equally empty values: the cut goes in its middle.
  let end = threshold
  while (end + 1 <= top && smooth(end + 1) === emptiest) end++
  return Math.floor((threshold + end) / 2)
}

/** The picture's outline pixels (see `darkThreshold`). */
export const outlineMask = (image: RgbaImage): OutlineMask => {
  const { width, height, data } = image
  const histogram = new Uint32Array(256)
  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3]! >= 128) histogram[Math.floor(luminance(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!))]!++
  }
  const threshold = darkThreshold(histogram)
  const dark = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3]! >= 128 && luminance(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!) <= threshold) dark[i] = 1
  }
  return { width, height, dark, threshold }
}

/** Which of a fixed picture's palette colors are its outline colors, judged by the same rule as `outlineMask`. */
export const outlineColorsOfArt = (art: PixelArt): Array<boolean> => {
  const histogram = new Uint32Array(256)
  const level = art.palette.map((color) => Math.floor(luminance(color.r, color.g, color.b)))
  for (const index of art.indices) if (index !== TRANSPARENT) histogram[level[index]!]!++
  const threshold = darkThreshold(histogram)
  return level.map((value) => value <= threshold)
}

/**
 * Whether the picture's dark strokes are about one cell wide: the typical
 * one-pixel outline, which the outline handling is for. Measured as the
 * median width of the dark runs along rows and columns that are between
 * half a cell and a few cells long.
 */
export const hasOutlines = (mask: OutlineMask, cell: number): boolean => {
  if (!(cell >= 2)) return false
  const { width, height, dark } = mask
  const runs: Array<number> = []
  const scan = (length: number, lines: number, at: (line: number, t: number) => number): void => {
    for (let line = 0; line < lines; line += 2) {
      let run = 0
      for (let t = 0; t <= length; t++) {
        if (t < length && dark[at(line, t)] === 1) run++
        else {
          if (run >= cell * 0.4 && run < cell * 2.6) runs.push(run)
          run = 0
        }
      }
    }
  }
  scan(width, height, (y, x) => y * width + x)
  scan(height, width, (x, y) => y * width + x)
  if (runs.length < 40) return false
  runs.sort((a, b) => a - b)
  const median = runs[runs.length >> 1]! / cell
  return median >= 0.6 && median <= 1.5
}

/** The palette colors as dark as the source's outline pixels. */
export const outlineColors = (art: PixelArt, mask: OutlineMask): Array<boolean> =>
  art.palette.map((color) => luminance(color.r, color.g, color.b) <= mask.threshold)

/**
 * Two neighbouring outline pixels whose source stroke is only about one cell
 * wide are one stroke split by the grid: the pixel whose cell holds less of
 * the stroke takes the color of its neighbour on the outer side (or turns
 * transparent at the picture's edge). Real two-pixel-thick strokes, wider
 * than about 1.4 cells in the source, stay, and so does a pixel the outline
 * would break without (a step of a staircase).
 */
export const thinOutlines = (art: PixelArt, grid: Grid, mask: OutlineMask): PixelArt => {
  const { width, height } = gridSize(grid)
  if (width !== art.width || height !== art.height) return art
  const dark = outlineColors(art, mask)
  const indices = new Int32Array(art.indices)
  const isOutline = (i: number): boolean => indices[i]! !== TRANSPARENT && dark[indices[i]!] === true
  const boxes = Array.from({ length: width * height }, (_, i) => cellBox(grid, i % width, Math.floor(i / width)))
  const darkIn = (box: readonly [number, number, number, number]): number => {
    let count = 0
    for (let y = Math.max(0, Math.floor(box[1])); y < Math.min(mask.height, Math.ceil(box[3])); y++) {
      for (let x = Math.max(0, Math.floor(box[0])); x < Math.min(mask.width, Math.ceil(box[2])); x++) count += mask.dark[y * mask.width + x]!
    }
    return count
  }
  // The mean dark width across a box, measured along rows (horizontal) or columns, over the lines that have any.
  const span = (box: readonly [number, number, number, number], horizontal: boolean): number => {
    const [left, top, right, bottom] = box
    const a0 = Math.max(0, Math.floor(horizontal ? top : left))
    const a1 = Math.min(horizontal ? mask.height : mask.width, Math.ceil(horizontal ? bottom : right))
    const b0 = Math.max(0, Math.floor(horizontal ? left : top))
    const b1 = Math.min(horizontal ? mask.width : mask.height, Math.ceil(horizontal ? right : bottom))
    let total = 0
    let lines = 0
    for (let a = a0; a < a1; a++) {
      let sum = 0
      for (let b = b0; b < b1; b++) sum += mask.dark[horizontal ? a * mask.width + b : b * mask.width + a]!
      if (sum > 0) {
        total += sum
        lines++
      }
    }
    return lines === 0 ? 0 : total / lines
  }
  // Whether the outline pixel can go without splitting the outline around it: its outline
  // neighbours (diagonals count) stay one connected group, and there are at least two.
  const RING = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as const
  const removable = (i: number): boolean => {
    const x = i % width
    const y = (i - x) / width
    const on = RING.map(([dx, dy]) => x + dx >= 0 && y + dy >= 0 && x + dx < width && y + dy < height && isOutline((y + dy) * width + x + dx))
    const seen = new Array<boolean>(8).fill(false)
    let groups = 0
    for (let k = 0; k < 8; k++) {
      if (!on[k] || seen[k]) continue
      groups++
      const stack = [k]
      seen[k] = true
      while (stack.length > 0) {
        const u = stack.pop()!
        for (let v = 0; v < 8; v++) {
          if (!on[v] || seen[v]) continue
          if (Math.max(Math.abs(RING[u]![0] - RING[v]![0]), Math.abs(RING[u]![1] - RING[v]![1])) === 1) {
            seen[v] = true
            stack.push(v)
          }
        }
      }
    }
    // An end of a stroke (touching nothing but its pair) stays: the stroke would only get shorter.
    return groups === 1 && on.filter(Boolean).length >= 2
  }
  // Across the stroke (above and below a horizontal pair), every outline neighbour of the pixel
  // going is one of the pixel staying too: two strokes meeting (a T, a corner) are not a split stroke.
  const sameSides = (lose: number, keep: number, horizontal: boolean): boolean => {
    const step = horizontal ? width : 1
    for (const d of [-step, step]) {
      const valid = (i: number): boolean => (horizontal ? i >= 0 && i < width * height : Math.floor(i / width) === Math.floor((i - d) / width))
      const a = lose + d
      const b = keep + d
      if (valid(a) && isOutline(a) && !(valid(b) && isOutline(b))) return false
    }
    return true
  }
  for (const horizontal of [true, false]) {
    const lines = horizontal ? height : width
    const along = horizontal ? width : height
    const at = (line: number, t: number): number => (horizontal ? line * width + t : t * width + line)
    for (let line = 0; line < lines; line++) {
      let t = 0
      while (t < along) {
        if (!isOutline(at(line, t))) {
          t++
          continue
        }
        let end = t
        while (end < along && isOutline(at(line, end))) end++
        if (end - t === 2) {
          const i = at(line, t)
          const j = at(line, t + 1)
          const a = boxes[i]!
          const b = boxes[j]!
          const cell = horizontal ? (a[2] - a[0] + b[2] - b[0]) / 2 : (a[3] - a[1] + b[3] - b[1]) / 2
          const union = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] as const
          if (span(union, horizontal) < 1.4 * cell) {
            // The pixel holding less of the stroke goes, unless the outline would break without it.
            const firstLess = darkIn(a) < darkIn(b)
            const can = (lose: number, keep: number): boolean => removable(lose) && sameSides(lose, keep, horizontal)
            const loseFirst = firstLess ? (can(i, j) ? true : can(j, i) ? false : undefined) : can(j, i) ? false : can(i, j) ? true : undefined
            if (loseFirst !== undefined) {
              const lose = loseFirst ? i : j
              const from = loseFirst ? (t > 0 ? at(line, t - 1) : -1) : end < along ? at(line, end) : -1
              if (from < 0) indices[lose] = TRANSPARENT
              else if (!isOutline(from)) indices[lose] = indices[from]!
            }
          }
        }
        t = end
      }
    }
  }
  return { ...art, indices }
}

