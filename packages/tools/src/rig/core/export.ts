/**
 * A clip's frames as pictures. For the game: a sprite sheet of its frames
 * in one row, its JSON, and a GIF, laid out and written through the pixel
 * fixer's sheet and GIF writers. For an agent to look at: a contact sheet
 * (frames in rows no wider than about 2000 pixels, each numbered with its
 * phase, and under each row the same frames with their bones), or one
 * picture per frame, with the person's open comments ringed; each cropped
 * to the character (`viewBox`) unless asked for the whole frame.
 */
import { makeMatcher, pack, unpack, type Rgb } from "../../pixel/core/color.ts"
import type { PixelArt } from "../../pixel/core/fix.ts"
import type { RgbaImage } from "../../pixel/core/grid.ts"
import type { AtlasRect } from "../../pixel/core/spritesheet.ts"
import { isSpan, type Comment } from "./bank.ts"
import { phaseAt, type Clip, type Run } from "./clip.ts"
import { over, renderArt, renderBackdrop, renderBones, rgbaOf } from "./raster.ts"
import { momentsOf } from "../../fx/core/export.ts"
import { commentSpot } from "./view.ts"
import { boundsOf } from "./pose.ts"
import { tipOf, type Rig, type V } from "./rig.ts"

/** A contact sheet is at most this wide when its columns are not given. */
export const MAX_WIDTH = 2000

const INK = "#e6e9f0"
const MUTED = "#8a93a8"
const WARM = "#ffb454"
const PANEL = "#12151d"
const MARK = "#ff2bd6"
const GAP = 4
const HEAD = 24

// ---------------------------------------------------------------------------
// A small drawing kit

const blank = (width: number, height: number, color: string): RgbaImage => {
  const [r, g, b] = rgbaOf(color)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set([r, g, b, 255], i * 4)
  return { width, height, data }
}

const paste = (dst: RgbaImage, src: RgbaImage, x0: number, y0: number): void => {
  for (let y = 0; y < src.height; y++) {
    const dy = y0 + y
    if (dy < 0 || dy >= dst.height) continue
    for (let x = 0; x < src.width; x++) {
      const dx = x0 + x
      if (dx < 0 || dx >= dst.width) continue
      dst.data.set(src.data.subarray((y * src.width + x) * 4, (y * src.width + x) * 4 + 4), (dy * dst.width + dx) * 4)
    }
  }
}

const dot = (img: RgbaImage, x: number, y: number, color: Rgb): void => {
  if (x >= 0 && y >= 0 && x < img.width && y < img.height) img.data.set([color.r, color.g, color.b, 255], (y * img.width + x) * 4)
}

const rgbOf = (color: string): Rgb => {
  const [r, g, b] = rgbaOf(color)
  return { r, g, b }
}

/** A 3 × 5 pixel font: digits, capitals, and a few signs. */
const FONT: Readonly<Record<string, string>> = {
  "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111", "4": "101101111001001",
  "5": "111100111001111", "6": "111100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001111",
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111",
  F: "111100110100100", G: "011100101101011", H: "101101111101101", I: "111010010010111", J: "001001001101010",
  K: "101101110101101", L: "100100100100111", M: "101111111101101", N: "110101101101101", O: "010101101101010",
  P: "110101110100100", Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101", Y: "101101010010010",
  Z: "111001010100111", "-": "000000111000000", ".": "000000000000010", ":": "000010000010000", "/": "001001010100100",
  " ": "000000000000000", "%": "101001010100101", "(": "010100100100010", ")": "010001001001010", ",": "000000000010100"
}

/** Writes text in the 3 × 5 font, each font pixel `size` pixels. */
const text = (img: RgbaImage, x0: number, y0: number, s: string, color: string, size = 2): void => {
  const rgb = rgbOf(color)
  let x = x0
  for (const ch of s.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT[" "]!
    for (let gy = 0; gy < 5; gy++)
      for (let gx = 0; gx < 3; gx++)
        if (glyph[gy * 3 + gx] === "1") for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) dot(img, x + gx * size + xx, y0 + gy * size + yy, rgb)
    x += 4 * size
  }
}

/** A magenta square ring around a pixel, with the comment's number. */
const ring = (img: RgbaImage, x: number, y: number, label: string): void => {
  const mark = rgbOf(MARK)
  for (let t = 0; t < 2; t++)
    for (let d = -5 - t; d <= 5 + t; d++) {
      dot(img, x + d, y - 5 - t, mark)
      dot(img, x + d, y + 5 + t, mark)
      dot(img, x - 5 - t, y + d, mark)
      dot(img, x + 5 + t, y + d, mark)
    }
  text(img, x + 8, y - 12, label, MARK)
}

/** A magenta frame around a cell in a span comment, with the comment's number in its top right corner. */
const band = (img: RgbaImage, x0: number, y0: number, w: number, h: number, label: string): void => {
  const mark = rgbOf(MARK)
  for (let t = 0; t < 2; t++) {
    for (let x = x0; x < x0 + w; x++) {
      dot(img, x, y0 + t, mark)
      dot(img, x, y0 + h - 1 - t, mark)
    }
    for (let y = y0; y < y0 + h; y++) {
      dot(img, x0 + t, y, mark)
      dot(img, x0 + w - 1 - t, y, mark)
    }
  }
  text(img, x0 + w - 6 - 8 * label.length, y0 + 4, label, MARK)
}

// ---------------------------------------------------------------------------
// Looking

/** A box on a frame, in frame pixels at 1× from its top left. */
export interface Box {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** Room left around the character in a cropped look, in frame pixels at 1×. */
const MARGIN = 12

/**
 * The part of the frame a look shows: every drawn part on the frames
 * shown, joined into one box, with a margin, and down past the ground line
 * so feet read against it; within the frame. The whole frame when `full`.
 */
export const viewBox = (rig: Rig, run: Run, frames: ReadonlyArray<number>, full = false): Box => {
  if (full) return { x: 0, y: 0, w: rig.width, h: rig.height }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const f of frames)
    for (const d of run.frames[f]?.drawn ?? []) {
      const b = boundsOf(d.geom)
      const pad = d.outline === null ? 0 : d.line
      minX = Math.min(minX, rig.anchor[0] + b.minX - pad)
      maxX = Math.max(maxX, rig.anchor[0] + b.maxX + pad)
      minY = Math.min(minY, rig.anchor[1] - b.maxY - pad)
      maxY = Math.max(maxY, rig.anchor[1] - b.minY + pad)
    }
  if (maxX < minX) return { x: 0, y: 0, w: rig.width, h: rig.height }
  const x = Math.max(0, Math.floor(minX - MARGIN))
  const y = Math.max(0, Math.floor(minY - MARGIN))
  const right = Math.min(rig.width, Math.ceil(maxX + MARGIN))
  const bottom = Math.min(rig.height, Math.ceil(Math.max(maxY, rig.anchor[1]) + MARGIN))
  return { x, y, w: right - x, h: bottom - y }
}

/** A box on a frame drawn `scale` times bigger, in whole pixels. */
const scaled = (box: Box, scale: number, width: number, height: number): Box => {
  const x = Math.floor(box.x * scale)
  const y = Math.floor(box.y * scale)
  return { x, y, w: Math.min(width, Math.ceil((box.x + box.w) * scale)) - x, h: Math.min(height, Math.ceil((box.y + box.h) * scale)) - y }
}

const crop = (img: RgbaImage, box: Box): RgbaImage => {
  if (box.x === 0 && box.y === 0 && box.w === img.width && box.h === img.height) return img
  const out = blank(box.w, box.h, PANEL)
  paste(out, img, -box.x, -box.y)
  return out
}

/** What `lookSheet` and `framePictures` draw. */
export interface LookOptions {
  /** Pixels per world unit: 2 draws the frames twice as big, 0.5 half as big. */
  readonly scale: number
  /** The part of each frame to show (`viewBox`), in frame pixels at 1×. */
  readonly view: Box
  /** Frames per row; by default as many as fit in `MAX_WIDTH`. */
  readonly columns?: number | undefined
  /** The frames to show, in order. */
  readonly frames: ReadonlyArray<number>
  /** Under each row of frames, the same frames with their bones (and the trail bone's path). */
  readonly bones: boolean
  /** The frame before, faint, under each frame: to see spacing. */
  readonly onion: boolean
  /** The person's open comments on this draft: pixel ones ringed, span ones framing their frames. */
  readonly comments: ReadonlyArray<Comment & { readonly number: number }>
  /** The line written across the top. */
  readonly title: string
}

/** Each frame's trail-bone tip, where it shows, for the bones layer. */
const trailPoints = (rig: Rig, clip: Clip, run: Run): ReadonlyArray<V | undefined> | undefined => {
  const bone = clip.trail
  return bone === undefined ? undefined : run.frames.map((fr) => (fr.shown.has(bone) ? tipOf(rig, fr.world, bone) : undefined))
}

/** A frame's cells, cropped to `view`: the art on the backdrop, and the bones over the faint art. */
const cellsOf = (rig: Rig, clip: Clip, run: Run, scale: number, onion: boolean, view: Box) => {
  const backdrop = renderBackdrop(rig, rig.look, scale)
  const box = scaled(view, scale, backdrop.width, backdrop.height)
  const trail = trailPoints(rig, clip, run)
  const arts = new Map<number, RgbaImage>()
  const art = (f: number): RgbaImage => {
    const known = arts.get(f)
    if (known !== undefined) return known
    const made = renderArt(rig, run.frames[f]!, scale)
    arts.set(f, made)
    return made
  }
  const previous = (f: number): number | undefined => (f > 0 ? f - 1 : clip.loop && run.frames.length > 1 ? run.frames.length - 1 : undefined)
  return {
    width: box.w,
    height: box.h,
    /** Where the cell's top left is on the whole frame, in pixels at this scale: comment rings are placed from it. */
    origin: [box.x, box.y] as V,
    art: (f: number): RgbaImage => {
      const before = previous(f)
      const under = onion && before !== undefined ? over(backdrop, art(before), 0.35) : backdrop
      return crop(over(under, art(f)), box)
    },
    bones: (f: number): RgbaImage => crop(over(over(backdrop, art(f), 0.45), renderBones(rig, run.frames[f]!, scale, trail === undefined ? undefined : { points: trail, current: f })), box)
  }
}

const labelCell = (img: RgbaImage, clip: Clip, f: number, x: number, y: number, h: number): void => {
  const phase = phaseAt(clip, f)
  text(img, x + 4, y + 4, String(f), INK)
  if (phase !== undefined) text(img, x + 4, y + h - 14, phase.fast ? `${phase.name} fast` : phase.name, phase.fast ? WARM : MUTED)
}

const markCell = (img: RgbaImage, rig: Rig, run: Run, comments: LookOptions["comments"], f: number, x: number, y: number, w: number, h: number, scale: number, origin: V): void => {
  for (const comment of comments) {
    if (isSpan(comment)) {
      if (f >= comment.from && f <= comment.to) band(img, x, y, w, h, String(comment.number))
    } else if (comment.frame === f && run.frames[f] !== undefined) {
      // Where its part is now, as the review page rings it.
      const [px, py] = commentSpot(rig, run.frames[f], comment)
      ring(img, x + Math.floor(px * scale) - origin[0], y + Math.floor(py * scale) - origin[1], String(comment.number))
    }
  }
}

/** The columns a contact sheet uses: as given; else one row when the frames fit in `MAX_WIDTH`, or rows as even as can be (8 frames in 4 and 4, not 7 and 1). */
export const columnsFor = (cellWidth: number, frames: number, columns?: number): number => {
  if (columns !== undefined) return Math.max(1, Math.min(frames, columns))
  const fit = Math.max(1, Math.floor((MAX_WIDTH - GAP) / (cellWidth + GAP)))
  return Math.max(1, Math.ceil(frames / Math.ceil(frames / fit)))
}

/**
 * The frames in rows, each numbered with its phase (`fast` ones in amber),
 * and under each row the same frames with their bones unless `bones` is
 * off; open comments ringed (a pixel) or framing their frames (a span).
 */
export const lookSheet = (rig: Rig, clip: Clip, run: Run, options: LookOptions): RgbaImage => {
  const scale = options.scale
  const cells = cellsOf(rig, clip, run, scale, options.onion, options.view)
  const w = cells.width
  const h = cells.height
  const columns = columnsFor(w, options.frames.length, options.columns)
  const rows = Math.ceil(options.frames.length / columns)
  const layers = options.bones ? 2 : 1
  const rowHeight = layers * (h + GAP)
  const sheet = blank(columns * (w + GAP) + GAP, HEAD + rows * rowHeight + GAP, PANEL)
  text(sheet, GAP, 7, options.title, INK)
  options.frames.forEach((f, i) => {
    const x = GAP + (i % columns) * (w + GAP)
    const y = HEAD + Math.floor(i / columns) * rowHeight
    paste(sheet, cells.art(f), x, y)
    labelCell(sheet, clip, f, x, y, h)
    markCell(sheet, rig, run, options.comments, f, x, y, w, h, scale, cells.origin)
    if (options.bones) {
      paste(sheet, cells.bones(f), x, y + h + GAP)
      labelCell(sheet, clip, f, x, y + h + GAP, h)
      markCell(sheet, rig, run, options.comments, f, x, y + h + GAP, w, h, scale, cells.origin)
    }
  })
  return sheet
}

/** One picture per frame, for `look --each`: the frame, and under it its bones unless `bones` is off. */
export const framePictures = (rig: Rig, clip: Clip, run: Run, options: LookOptions): Array<{ readonly frame: number; readonly image: RgbaImage }> => {
  const scale = options.scale
  const cells = cellsOf(rig, clip, run, scale, options.onion, options.view)
  const w = cells.width
  const h = cells.height
  return options.frames.map((f) => {
    const image = blank(w, options.bones ? 2 * h + GAP : h, PANEL)
    paste(image, cells.art(f), 0, 0)
    labelCell(image, clip, f, 0, 0, h)
    markCell(image, rig, run, options.comments, f, 0, 0, w, h, scale, cells.origin)
    if (options.bones) {
      paste(image, cells.bones(f), 0, h + GAP)
      labelCell(image, clip, f, 0, h + GAP, h)
    }
    return { frame: f, image }
  })
}

// ---------------------------------------------------------------------------
// Baking

/** Every frame of a run, anti-aliased on a transparent frame, `scale` pixels per world unit. */
export const artOf = (rig: Rig, run: Run, scale: number): Array<RgbaImage> => run.frames.map((fr) => renderArt(rig, fr, scale))

/** The frames laid on one transparent picture where `rects` say (from the pixel fixer's `atlasOf`). */
export const sheetOf = (frames: ReadonlyArray<RgbaImage>, rects: ReadonlyArray<AtlasRect>, width: number, height: number): RgbaImage => {
  const sheet: RgbaImage = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  for (const rect of rects) {
    const frame = frames[rect.frame]
    if (frame !== undefined) paste(sheet, frame, rect.x, rect.y)
  }
  return sheet
}

/** At most this many colors in a GIF's one palette (one slot is kept for transparency). */
const GIF_COLORS = 255

/**
 * The frames on the rig's backdrop as pixel art on one shared palette, for
 * the pixel fixer's GIF writer: the 255 colors used most across every
 * frame, every other color drawn as its nearest (OKLab).
 */
export const gifFramesOf = (rig: Rig, frames: ReadonlyArray<RgbaImage>, scale: number): Array<PixelArt> => {
  const backdrop = renderBackdrop(rig, rig.look, scale)
  const flat = frames.map((frame) => over(backdrop, frame))
  const counts = new Map<number, number>()
  for (const image of flat) for (let i = 0; i < image.data.length; i += 4) {
    const key = pack(image.data[i]!, image.data[i + 1]!, image.data[i + 2]!)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([key]) => key)
  const kept = ranked.slice(0, GIF_COLORS)
  const palette = kept.map(unpack)
  const matcher = makeMatcher(palette, "oklab")
  const slot = new Map<number, number>(kept.map((key, i) => [key, i]))
  for (const key of ranked.slice(GIF_COLORS)) slot.set(key, matcher.nearest(unpack(key)))
  return flat.map((image) => {
    const indices = new Int32Array(image.width * image.height)
    for (let i = 0; i < indices.length; i++) indices[i] = slot.get(pack(image.data[i * 4]!, image.data[i * 4 + 1]!, image.data[i * 4 + 2]!))!
    return { width: image.width, height: image.height, palette, indices }
  })
}

/** One row of a compare sheet: a draft's run, named. */
export interface CompareRow {
  readonly name: string
  readonly clip: Clip
  readonly run: Run
}

/**
 * Drafts side by side: a row per draft, each column the same moment of
 * each (its first frame, its last, and evenly between, as the effects lab
 * compares), every frame numbered with its phase, each row's draft named
 * on its first cell. To weigh the drafts' poses and timing in one picture;
 * `lookSheet` shows one draft's every frame.
 */
export const compareSheet = (rig: Rig, rows: ReadonlyArray<CompareRow>, options: { readonly scale: number; readonly columns: number; readonly full?: boolean | undefined }): RgbaImage => {
  const scale = options.scale
  const backdrop = renderBackdrop(rig, rig.look, scale)
  // One crop for every row, so the drafts compare at the same place.
  const boxes = rows.map((row) => viewBox(rig, row.run, row.run.frames.map((_, f) => f), options.full))
  const joined = boxes.reduce((a, b) => {
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
  }, boxes[0] ?? { x: 0, y: 0, w: rig.width, h: rig.height })
  const box = scaled(joined, scale, backdrop.width, backdrop.height)
  const w = box.w
  const h = box.h
  const columns = Math.max(1, Math.min(Math.max(1, ...rows.map((row) => row.run.frames.length)), Math.floor(options.columns)))
  const sheet = blank(columns * (w + GAP) + GAP, HEAD + rows.length * (h + GAP) + GAP, PANEL)
  text(sheet, GAP, 7, `${rows.length} drafts, ${columns} moments each, first frame to last`, INK)
  rows.forEach((row, r) => {
    momentsOf(row.run.frames.length, columns).forEach((frame, c) => {
      const x = GAP + c * (w + GAP)
      const y = HEAD + r * (h + GAP)
      paste(sheet, crop(over(backdrop, renderArt(rig, row.run.frames[frame]!, scale)), box), x, y)
      labelCell(sheet, row.clip, frame, x, y, h)
      if (c === 0) text(sheet, x + w - 6 - 8 * row.name.length, y + 4, row.name, WARM)
    })
  })
  return sheet
}
