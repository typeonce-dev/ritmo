/**
 * Animation sheets: one picture holding the frames of an animation, the way
 * image generators hand them out (a row of boxes, often with labels under
 * them and a fake grid painted behind them).
 *
 * The sheet's background is cleared first, in the source: the colors that
 * cover most of its border are background, flooded inward from the border
 * (so dark parts enclosed by a sprite, like its eyes, stay). What is left is
 * the frames and their labels. Bands of rows with something in them are the
 * rows of frames; a band much shorter than the tallest is a row of labels
 * and is left out. Each band is cut into frames at its widest empty gaps.
 *
 * Every frame is then fixed with the same recipe (one palette), on one grid
 * size (each frame keeps its own offset, since generators draw every frame
 * on its own), and placed on one canvas so its anchor (the feet, by
 * default) stays still from frame to frame.
 */
import { toOklab, type Lab, type Rgb } from "./color.ts"
import { TRANSPARENT, type PixelArt } from "./fix.ts"
import type { RgbaImage } from "./grid.ts"

/** A frame's box in the source picture, in whole source pixels. */
export interface FrameBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * What lines frames up: the body's middle column, at the height drawn on the
 * sheet (the ground: hops and bobs stay); under the body (the feet, pinned to
 * one row); at the body's middle; or nothing (frames are placed as their
 * boxes are).
 */
export type Anchor = "ground" | "feet" | "center" | "box"

export const anchors: ReadonlyArray<{ readonly id: Anchor; readonly label: string; readonly hint: string }> = [
  { id: "ground", label: "Ground", hint: "Each frame keeps its height as drawn, so hops and bobs stay; only the sideways drift is taken out." },
  { id: "feet", label: "Feet", hint: "Each frame stands on the same spot: the bottom of its body, centered on it. Hops are flattened." },
  { id: "center", label: "Center", hint: "Each frame's body is centered on the same spot: for flying or floating things." },
  { id: "box", label: "Box", hint: "Frames are placed as they sit in their boxes, unmoved." }
]

/** How an animation plays: start to end and again, or there and back. */
export type Loop = "forward" | "pingpong"

/** One frame of a sheet: its box, whether the animation uses it, and a nudge by hand in fixed pixels. */
export interface SheetFrame {
  readonly box: FrameBox
  readonly include: boolean
  readonly nudge: { readonly x: number; readonly y: number }
}

/** Everything that makes a sheet into an animation, beyond the recipe every frame shares. */
export interface Sheet {
  readonly frames: ReadonlyArray<SheetFrame>
  readonly anchor: Anchor
  /** Frames per second. */
  readonly fps: number
  readonly loop: Loop
  /** Empty pixels kept around the frames, on every side. */
  readonly padding: number
}

export const defaultSheet: Sheet = { frames: [], anchor: "ground", fps: 8, loop: "forward", padding: 1 }

export const frameOf = (box: FrameBox): SheetFrame => ({ box, include: true, nudge: { x: 0, y: 0 } })

// ---------------------------------------------------------------------------
// Clearing the background

const distance = (x: Lab, y: Lab): number => Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b)

/** Border colors closer than this (OKLab) count as one; JPEG noise would otherwise split a flat color into many. */
const SAME_COLOR = 0.06
/** A border color is background when it covers at least this share of the border. */
const COMMON_ENOUGH = 0.03

/**
 * The background's colors: those covering much of the picture's border (a
 * painted grid behind the frames gives two, its fill and its lines).
 * Transparent border pixels are already background.
 */
export const sheetBackground = (image: RgbaImage): Array<Rgb> => {
  const { width, height, data } = image
  const groups: Array<{ lab: Lab; color: Rgb; n: number }> = []
  let total = 0
  const count = (x: number, y: number): void => {
    const i = (y * width + x) * 4
    if (data[i + 3]! < 128) return
    total++
    const color = { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! }
    const lab = toOklab(color)
    const group = groups.find((other) => distance(other.lab, lab) <= SAME_COLOR)
    if (group === undefined) groups.push({ lab, color, n: 1 })
    else group.n++
  }
  // Every border pixel, two deep: enough to see a painted grid's lines.
  for (let depth = 0; depth < Math.min(2, height); depth++) {
    for (let x = 0; x < width; x++) {
      count(x, depth)
      count(x, height - 1 - depth)
    }
  }
  for (let depth = 0; depth < Math.min(2, width); depth++) {
    for (let y = 0; y < height; y++) {
      count(depth, y)
      count(width - 1 - depth, y)
    }
  }
  return groups
    .filter((group) => group.n >= COMMON_ENOUGH * total)
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .map((group) => group.color)
}

/**
 * How far the background's fill strays from its own color on the border
 * (JPEG noise, a gradient), in OKLab: the 95th percentile of the border
 * pixels near it. A clean fill strays little, so the art's dark outline,
 * often close to a dark background, is kept.
 */
export const fillNoise = (image: RgbaImage, fill: Rgb): number => {
  const { width, height, data } = image
  const target = toOklab(fill)
  const found: Array<number> = []
  const look = (x: number, y: number): void => {
    const i = (y * width + x) * 4
    if (data[i + 3]! < 128) return
    const d = distance(toOklab({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]! }), target)
    if (d <= SAME_COLOR) found.push(d)
  }
  for (let x = 0; x < width; x++) {
    look(x, 0)
    look(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    look(0, y)
    look(width - 1, y)
  }
  if (found.length === 0) return SAME_COLOR
  found.sort((a, b) => a - b)
  return found[Math.floor(found.length * 0.95)]!
}

/**
 * A row (or column) is a painted line when the line's color covers at least
 * this share of it: frames hide much of a line where they cross it.
 */
const LINE_SHARE = 0.25
/** How far past a line its two sides are looked at, for blurred line edges. */
const LINE_SIDE = 2

/**
 * The sheet with the lines of a painted grid painted over in the
 * background's fill, where they run over the background (never over the
 * art). A grid's lines are often as dark as the art's outline, so clearing
 * them by color would flood through the outline into the art.
 *
 * `colors` are the background's colors, most common first (the fill). Any
 * other color that covers most of whole rows or columns is a line color.
 * Returns the sheet, and the colors still to clear (the line colors gone).
 */
export const removeGridLines = (
  image: RgbaImage,
  colors: ReadonlyArray<Rgb>,
  tolerance: number
): { readonly image: RgbaImage; readonly colors: ReadonlyArray<Rgb> } => {
  const fill = colors[0]
  if (fill === undefined || colors.length < 2) return { image, colors }
  const { width, height } = image
  const data = new Uint8ClampedArray(image.data)
  const fillLab = toOklab(fill)
  // Colors repeat a lot: convert each one once.
  const labs = new Map<number, Lab>()
  const near = (p: number, target: Lab): boolean => {
    const i = p * 4
    if (data[i + 3]! < 128) return false
    const key = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!
    let lab = labs.get(key)
    if (lab === undefined) {
      lab = toOklab({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]! })
      labs.set(key, lab)
    }
    return distance(lab, target) <= tolerance
  }
  const kept: Array<Rgb> = [fill]
  for (const color of colors.slice(1)) {
    const lab = toOklab(color)
    const rowShare = Array.from({ length: height }, (_, y) => {
      let n = 0
      for (let x = 0; x < width; x++) if (near(y * width + x, lab)) n++
      return n / width
    })
    const columnShare = Array.from({ length: width }, (_, x) => {
      let n = 0
      for (let y = 0; y < height; y++) if (near(y * width + x, lab)) n++
      return n / height
    })
    // Lines are thin; a checkerboard's second tone fills half of every row, in one thick run.
    const thin = (runs: Array<Run>, size: number): Array<Run> => runs.filter((run) => run.to - run.from <= Math.max(4, 0.01 * size))
    const lineRows = thin(
      runsOf(
        rowShare.map((share) => share >= LINE_SHARE),
        1
      ),
      height
    )
    const lineColumns = thin(
      runsOf(
        columnShare.map((share) => share >= LINE_SHARE),
        1
      ),
      width
    )
    if (lineRows.length + lineColumns.length < 2) {
      kept.push(color)
      continue
    }
    const paint = (p: number): void => {
      data[p * 4] = fill.r
      data[p * 4 + 1] = fill.g
      data[p * 4 + 2] = fill.b
      data[p * 4 + 3] = 255
    }
    // Across a line, it is background when both sides are the fill (or another line beside it,
    // as where a frame's box runs next to the grid); rows first, then columns, so a crossing
    // (lines on two sides) is painted once its row line is.
    const onRow = new Uint8Array(height)
    for (const run of lineRows) onRow.fill(1, run.from, run.to)
    const onColumn = new Uint8Array(width)
    for (const run of lineColumns) onColumn.fill(1, run.from, run.to)
    const side = (p: number, beside: boolean): boolean => near(p, fillLab) || (beside && near(p, lab))
    for (const run of lineRows) {
      const above = run.from - 1 - LINE_SIDE
      const below = run.to + LINE_SIDE
      for (let x = 0; x < width; x++) {
        // At the sheet's edge, the one side there is.
        if ((above >= 0 && !side(above * width + x, onRow[above] === 1)) || (below < height && !side(below * width + x, onRow[below] === 1))) continue
        for (let y = Math.max(0, run.from - LINE_SIDE); y < Math.min(height, run.to + LINE_SIDE); y++) paint(y * width + x)
      }
    }
    for (const run of lineColumns) {
      const left = run.from - 1 - LINE_SIDE
      const right = run.to + LINE_SIDE
      for (let y = 0; y < height; y++) {
        if ((left >= 0 && !side(y * width + left, onColumn[left] === 1)) || (right < width && !side(y * width + right, onColumn[right] === 1))) continue
        for (let x = Math.max(0, run.from - LINE_SIDE); x < Math.min(width, run.to + LINE_SIDE); x++) paint(y * width + x)
      }
    }
  }
  return { image: { width, height, data }, colors: kept }
}

/**
 * The sheet with its background made transparent: pixels close to a
 * background color (`tolerance`, OKLab), flooded from the border. Also
 * returns the mask (1: cleared).
 */
export const clearSheet = (image: RgbaImage, colors: ReadonlyArray<Rgb>, tolerance: number): { readonly image: RgbaImage; readonly mask: Uint8Array } => {
  const { width, height, data } = image
  const targets = colors.map(toOklab)
  // Colors repeat a lot: remember each one's answer.
  const seen = new Map<number, boolean>()
  const like = (p: number): boolean => {
    const i = p * 4
    if (data[i + 3]! < 128) return true
    const key = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!
    let answer = seen.get(key)
    if (answer === undefined) {
      const lab = toOklab({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]! })
      answer = targets.some((target) => distance(lab, target) <= tolerance)
      seen.set(key, answer)
    }
    return answer
  }
  const mask = new Uint8Array(width * height)
  const stack: Array<number> = []
  const seed = (p: number): void => {
    if (mask[p] === 1 || !like(p)) return
    mask[p] = 1
    stack.push(p)
  }
  for (let x = 0; x < width; x++) {
    seed(x)
    seed((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    seed(y * width)
    seed(y * width + width - 1)
  }
  while (stack.length > 0) {
    const p = stack.pop()!
    const x = p % width
    if (x > 0) seed(p - 1)
    if (x < width - 1) seed(p + 1)
    if (p >= width) seed(p - width)
    if (p + width < mask.length) seed(p + width)
  }
  const out = new Uint8ClampedArray(data)
  for (let p = 0; p < mask.length; p++) if (mask[p] === 1) out[p * 4 + 3] = 0
  return { image: { width, height, data: out }, mask }
}

// ---------------------------------------------------------------------------
// Finding the frames

interface Run {
  readonly from: number
  /** Exclusive. */
  readonly to: number
}

/** Runs of `true` in a list, joined across gaps shorter than `bridge`. */
const runsOf = (occupied: ReadonlyArray<boolean>, bridge: number): Array<Run> => {
  const runs: Array<{ from: number; to: number }> = []
  for (let i = 0; i < occupied.length; i++) {
    if (!occupied[i]) continue
    const last = runs[runs.length - 1]
    if (last !== undefined && i - last.to < bridge) last.to = i + 1
    else runs.push({ from: i, to: i + 1 })
  }
  return runs
}

/** Opaque pixels per row and per column of a part of the picture. */
const counts = (image: RgbaImage, area: FrameBox): { readonly rows: Array<number>; readonly columns: Array<number> } => {
  const rows = new Array<number>(area.height).fill(0)
  const columns = new Array<number>(area.width).fill(0)
  for (let y = 0; y < area.height; y++) {
    for (let x = 0; x < area.width; x++) {
      if (image.data[((area.y + y) * image.width + area.x + x) * 4 + 3]! >= 128) {
        rows[y]!++
        columns[x]!++
      }
    }
  }
  return { rows, columns }
}

/** A band shorter than this share of the tallest is a row of labels, not frames. */
const LABEL_BAND = 0.4

/**
 * The frames of a sheet whose background is cleared (`clearSheet`): one box
 * per frame, row by row, left to right. Boxes reach halfway into the gaps
 * around them, so a frame's loose bits (sparks, dust) stay inside it.
 * Returns one box around everything when the sheet has a single frame.
 *
 * The sheet is cut into rows of art, each row into frames, and each frame's
 * box is cut into rows again when it holds frames stacked one over another:
 * a sheet made of blocks side by side whose rows do not line up (walking on
 * the left, throwing on the right) has no empty row across its whole width
 * between two of a block's rows. Every cut is judged at the sheet's size, so
 * a gap inside a frame (a body and the bomb it throws) never splits it.
 */
export const findFrames = (image: RgbaImage): Array<FrameBox> => {
  const least = Math.max(2, 0.01 * image.width)
  const spacing: Array<number> = []
  const top = framesIn(image, { x: 0, y: 0, width: image.width, height: image.height }, least, spacing)
  // Below the top, frames split only at gaps not much narrower than the narrowest gap that
  // already split two frames: one frame's own gaps (a body and its bomb) are narrower.
  const usual = spacing.length === 0 ? least : Math.max(least, 0.6 * Math.min(...spacing))
  const again = (box: FrameBox, depth: number): Array<FrameBox> => {
    if (depth >= DEPTH || bandsIn(image, box).kept.length < 2) return [box]
    const inner = framesIn(image, box, usual, [])
    return inner.length > 1 ? inner.flatMap((part) => again(part, depth + 1)) : [box]
  }
  return top.flatMap((box) => again(box, 0))
}

/** How many times a box is cut into rows again: blocks within blocks are rare. */
const DEPTH = 3

/** The rows of art in one part of the sheet, and those tall enough to be frames (the rest are labels). */
const bandsIn = (image: RgbaImage, area: FrameBox): { readonly bands: Array<Run>; readonly kept: Array<Run> } => {
  const { rows } = counts(image, area)
  // A row with a pixel or two in it is noise left by the clearing, not art.
  const noise = Math.max(1, Math.round(image.width * 0.001))
  const bands = runsOf(
    rows.map((n) => n > noise),
    Math.max(2, Math.round(image.height * 0.01))
  )
    .filter((band) => band.to - band.from >= 3)
    .map((band) => ({ from: band.from + area.y, to: band.to + area.y }))
  const tallest = Math.max(0, ...bands.map((band) => band.to - band.from))
  return { bands, kept: bands.filter((band) => band.to - band.from >= LABEL_BAND * tallest) }
}

/**
 * The frames inside one part of the sheet, split only at gaps at least
 * `least` wide. Adds the width of each gap it split frames at to `spacing`.
 */
const framesIn = (image: RgbaImage, area: FrameBox, least: number, spacing: Array<number>): Array<FrameBox> => {
  const { bands, kept } = bandsIn(image, area)
  if (bands.length === 0) return []
  const bottomOf = area.y + area.height

  const boxes: Array<FrameBox> = []
  kept.forEach((band) => {
    // The band's own space, halfway to the bands around it (labels included).
    const above = bands[bands.indexOf(band) - 1]
    const below = bands[bands.indexOf(band) + 1]
    const marginTop = Math.round((band.from - (above?.to ?? Math.max(area.y, band.from - (band.to - band.from) * 0.1))) / 2)
    const marginBottom = Math.round(((below?.from ?? Math.min(bottomOf, band.to + (band.to - band.from) * 0.1)) - band.to) / 2)
    const top = Math.max(area.y, band.from - Math.min(marginTop, Math.round(0.15 * (band.to - band.from))))
    const bottom = Math.min(bottomOf, band.to + Math.min(marginBottom, Math.round(0.15 * (band.to - band.from))))
    const { columns } = counts(image, { x: area.x, y: band.from, width: area.width, height: band.to - band.from })
    const pieces = runsOf(
      columns.map((n) => n > 0),
      1
    ).map((piece) => ({ from: piece.from + area.x, to: piece.to + area.x }))
    if (pieces.length === 0) return
    // Gaps between the pieces; the frames are split at the widest ones.
    const gaps = pieces.slice(1).map((piece, i) => ({ at: i, size: piece.from - pieces[i]!.to }))
    const splits = widestGaps(
      gaps.map((gap) => gap.size),
      least
    )
    const cuts = new Set(splits.map((i) => gaps[i]!.at))
    for (const i of splits) spacing.push(gaps[i]!.size)
    let start = pieces[0]!.from
    const groups: Array<Run> = []
    pieces.forEach((piece, i) => {
      if (cuts.has(i)) {
        groups.push({ from: start, to: piece.to })
        start = pieces[i + 1]!.from
      }
    })
    groups.push({ from: start, to: pieces[pieces.length - 1]!.to })
    // Two frames close together (a flame reaching toward the next frame) make one group about
    // twice as wide as the rest: split it at its own widest gap.
    for (let pass = 0; pass < pieces.length; pass++) {
      const widths = groups.map((run) => run.to - run.from).sort((a, b) => a - b)
      const median = widths[Math.floor(widths.length / 2)]!
      const wide = groups.findIndex((run) => run.to - run.from > 1.6 * median)
      if (groups.length < 2 || wide < 0) break
      const run = groups[wide]!
      const inside = pieces.filter((piece) => piece.from >= run.from && piece.to <= run.to)
      let at = -1
      for (let i = 1; i < inside.length; i++) {
        if (at < 0 || inside[i]!.from - inside[i - 1]!.to > inside[at]!.from - inside[at - 1]!.to) at = i
      }
      if (at < 0 || inside[at]!.from - inside[at - 1]!.to < least) break
      groups.splice(wide, 1, { from: run.from, to: inside[at - 1]!.to }, { from: inside[at]!.from, to: run.to })
    }
    // A group with almost nothing in it is noise when it sits against a frame, and joins
    // it; set apart like a frame, it is one (the last wisp of smoke of an explosion).
    const mass = (run: Run): number => columns.slice(run.from - area.x, run.to - area.x).reduce((sum, n) => sum + n, 0)
    const biggest = Math.max(...groups.map(mass))
    const spaced = groups.slice(1).map((run, i) => run.from - groups[i]!.to)
    const usualGap = [...spaced].sort((a, b) => a - b)[Math.floor(spaced.length / 2)] ?? 0
    const solid: Array<Run> = []
    groups.forEach((run, i) => {
      const before = i > 0 ? run.from - groups[i - 1]!.to : Number.POSITIVE_INFINITY
      const after = i + 1 < groups.length ? groups[i + 1]!.from - run.to : Number.POSITIVE_INFINITY
      if (mass(run) >= 0.02 * biggest || Math.min(before, after) >= 0.5 * usualGap) {
        solid.push(run)
        return
      }
      // Joins the nearer neighbour: the one before when it is already kept, else the next.
      const last = solid[solid.length - 1]
      if (last !== undefined && before <= after) solid[solid.length - 1] = { from: last.from, to: run.to }
      else if (i + 1 < groups.length) groups[i + 1] = { from: run.from, to: groups[i + 1]!.to }
      else if (last !== undefined) solid[solid.length - 1] = { from: last.from, to: run.to }
    })
    const typicalGap =
      solid.length > 1 ? solid.slice(1).reduce((sum, run, i) => sum + (run.from - solid[i]!.to), 0) / (solid.length - 1) : Math.round(0.05 * (band.to - band.from))
    solid.forEach((run, i) => {
      const left = i === 0 ? Math.max(area.x, run.from - Math.round(typicalGap / 2)) : Math.round((solid[i - 1]!.to + run.from) / 2)
      const right = i === solid.length - 1 ? Math.min(area.x + area.width, run.to + Math.round(typicalGap / 2)) : Math.round((run.to + solid[i + 1]!.from) / 2)
      boxes.push({ x: left, y: top, width: right - left, height: bottom - top })
    })
  })
  return boxes
}

/**
 * Which gaps (by index) separate frames: the widest ones, down to the
 * biggest drop in width. Gaps inside a frame (between a body and its
 * sparks) are much narrower than the gaps between frames. A gap narrower
 * than `least` (1% of the sheet at the top) never splits.
 */
const widestGaps = (gaps: ReadonlyArray<number>, least: number): Array<number> => {
  const order = gaps.map((size, i) => ({ size, i })).sort((a, b) => b.size - a.size)
  const wide = order.filter((gap) => gap.size >= least)
  if (wide.length === 0) return []
  if (wide.length === 1) return [wide[0]!.i]
  // The split is where the next gap is much narrower than the one before.
  let cut = wide.length
  let drop = 1
  for (let k = 0; k + 1 < wide.length; k++) {
    const ratio = wide[k]!.size / Math.max(1, wide[k + 1]!.size)
    if (ratio > drop) {
      drop = ratio
      cut = k + 1
    }
  }
  // Gaps all about as wide split everywhere.
  if (drop < 1.6) cut = wide.length
  return wide.slice(0, cut).map((gap) => gap.i)
}

/** The part of a picture inside a box (clamped to the picture). */
export const cropImage = (image: RgbaImage, box: FrameBox): RgbaImage => {
  const x0 = Math.max(0, Math.min(image.width, Math.round(box.x)))
  const y0 = Math.max(0, Math.min(image.height, Math.round(box.y)))
  const x1 = Math.max(x0, Math.min(image.width, Math.round(box.x + box.width)))
  const y1 = Math.max(y0, Math.min(image.height, Math.round(box.y + box.height)))
  const width = x1 - x0
  const height = y1 - y0
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    data.set(image.data.subarray(((y0 + y) * image.width + x0) * 4, ((y0 + y) * image.width + x1) * 4), y * width * 4)
  }
  return { width, height, data }
}

// ---------------------------------------------------------------------------
// Anchors and one canvas

/** A point in a frame's own fixed pixels. */
export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * The frame's body: its largest group of touching opaque pixels (sparks and
 * loose bits around it are not the body).
 */
export const bodyOf = (art: PixelArt): Array<number> => {
  const { width, height, indices } = art
  const seen = new Uint8Array(indices.length)
  let best: Array<number> = []
  for (let start = 0; start < indices.length; start++) {
    if (seen[start] === 1 || indices[start] === TRANSPARENT) continue
    const group = [start]
    seen[start] = 1
    for (let k = 0; k < group.length; k++) {
      const p = group[k]!
      const x = p % width
      const y = (p - x) / width
      const visit = (n: number): void => {
        if (seen[n] === 1 || indices[n] === TRANSPARENT) return
        seen[n] = 1
        group.push(n)
      }
      if (x > 0) visit(p - 1)
      if (x < width - 1) visit(p + 1)
      if (y > 0) visit(p - width)
      if (y < height - 1) visit(p + width)
    }
    if (group.length > best.length) best = group
  }
  return best
}

/**
 * Where a frame's anchor is, in its own pixels: the body's lowest row
 * ("feet" and "ground") or its middle row ("center"), at the body's average column.
 * Undefined for "box", and for a frame with nothing in it.
 */
export const anchorOf = (art: PixelArt, anchor: Anchor): Point | undefined => {
  if (anchor === "box") return undefined
  const body = bodyOf(art)
  if (body.length === 0) return undefined
  let sumX = 0
  let sumY = 0
  let bottom = 0
  for (const p of body) {
    const x = p % art.width
    const y = (p - x) / art.width
    sumX += x
    sumY += y
    bottom = Math.max(bottom, y)
  }
  return { x: Math.round(sumX / body.length), y: anchor === "center" ? Math.round(sumY / body.length) : bottom }
}

/** One palette for many pictures: every color any of them uses, once, in the order first met. */
export const sharePalette = (arts: ReadonlyArray<PixelArt>): Array<PixelArt> => {
  const palette: Array<Rgb> = []
  const slots = new Map<number, number>()
  return arts.map((art) => {
    const remap = art.palette.map((color) => {
      const key = (color.r << 16) | (color.g << 8) | color.b
      let slot = slots.get(key)
      if (slot === undefined) {
        slot = palette.length
        slots.set(key, slot)
        palette.push(color)
      }
      return slot
    })
    const indices = art.indices.map((index) => (index === TRANSPARENT ? TRANSPARENT : remap[index]!))
    return { width: art.width, height: art.height, palette, indices }
  })
}

/** A frame placed on the shared canvas. */
export interface Placed {
  readonly art: PixelArt
  /** Where the frame's anchor is on the canvas (the same for every frame, unless nudged). */
  readonly anchor: Point
}

/**
 * Every frame on one canvas, the same size, with their anchors on one spot.
 * `offsets` say where each frame's own (0, 0) goes relative to the anchor
 * spot; the canvas is the smallest that holds every frame's opaque pixels,
 * plus `padding` on every side.
 */
export const layOut = (
  arts: ReadonlyArray<PixelArt>,
  offsets: ReadonlyArray<Point>,
  padding: number
): { readonly frames: Array<Placed>; readonly width: number; readonly height: number } => {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  arts.forEach((art, i) => {
    const offset = offsets[i]!
    art.indices.forEach((index, p) => {
      if (index === TRANSPARENT) return
      const x = (p % art.width) + offset.x
      const y = Math.floor(p / art.width) + offset.y
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    })
  })
  if (right < left) {
    left = 0
    top = 0
    right = 0
    bottom = 0
  }
  const pad = Math.max(0, Math.round(padding))
  const width = right - left + 1 + 2 * pad
  const height = bottom - top + 1 + 2 * pad
  const frames = arts.map((art, i) => {
    const offset = offsets[i]!
    const indices = new Int32Array(width * height).fill(TRANSPARENT)
    const dx = offset.x - left + pad
    const dy = offset.y - top + pad
    art.indices.forEach((index, p) => {
      if (index === TRANSPARENT) return
      const x = (p % art.width) + dx
      const y = Math.floor(p / art.width) + dy
      if (x >= 0 && y >= 0 && x < width && y < height) indices[y * width + x] = index
    })
    return { art: { width, height, palette: art.palette, indices }, anchor: { x: -left + pad, y: -top + pad } }
  })
  return { frames, width, height }
}

/** The order frames play in: start to end, or there and back without repeating the ends. */
export const playOrder = (count: number, loop: Loop): Array<number> => {
  const forward = Array.from({ length: count }, (_, i) => i)
  if (loop === "forward" || count < 3) return forward
  return [...forward, ...forward.slice(1, -1).reverse()]
}

/**
 * Whether boxes found in a sheet look like frames of an animation rather
 * than parts of one picture: at least two, and most of them (three in four)
 * alike, holding about as much art as the typical frame and about as wide.
 * The rest may be faint (the sparks and smoke at the end of an explosion):
 * one such frame does not make a sheet a picture.
 */
export const looksAnimated = (image: RgbaImage, boxes: ReadonlyArray<FrameBox>): boolean => {
  if (boxes.length < 2) return false
  const masses = boxes.map((box) => {
    const { columns } = counts(image, {
      x: Math.max(0, box.x),
      y: Math.max(0, box.y),
      width: Math.min(image.width, box.x + box.width) - Math.max(0, box.x),
      height: Math.min(image.height, box.y + box.height) - Math.max(0, box.y)
    })
    return columns.reduce((sum, n) => sum + n, 0)
  })
  const median = (values: ReadonlyArray<number>): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!
  const typicalMass = median(masses)
  const typicalWidth = median(boxes.map((box) => box.width))
  const alike = boxes.filter(
    (box, i) => masses[i]! >= 0.2 * typicalMass && masses[i]! <= 5 * typicalMass && box.width >= 0.4 * typicalWidth && box.width <= 2.5 * typicalWidth
  ).length
  return alike >= 2 && alike >= 0.75 * boxes.length
}
