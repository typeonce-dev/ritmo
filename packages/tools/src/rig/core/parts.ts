/**
 * Cutting a character parts sheet (an AI-made picture of a character's
 * head, torso, and limbs drawn apart on one background) into one picture
 * per part, for a rig's image parts.
 *
 * The background is cleared as the pixel fixer clears an animation sheet
 * (`clearedSheet`: its border colors, flooded inward, painted grid lines
 * included), and the parts come out in the pixel fixer's reading order.
 * The boxes are the sheet's drawn islands (8-connected), joined where they
 * nearly touch: a parts sheet holds parts of every size, so the animation
 * sheet's frame finding (rows of alike frames, short rows dropped as
 * labels) does not fit it. There is no grid snapping and no palette: the
 * parts are anti-aliased art and keep their pixels.
 *
 * Each part's pivot is a guess the agent corrects: the point on the part's
 * long axis nearest the sheet's centre of mass, which approximates the
 * joint that attaches it toward the body; the part that holds the centre
 * of mass itself (the torso, drawn in the middle) pivots on the lower end
 * of its axis (the hips). A pivot on an end of the axis sits half the
 * part's width in from it (a quarter of its length at most), where a
 * rounded joint's centre is.
 */
import { defaultRecipe } from "../../pixel/core/recipe.ts"
import { clearedSheet } from "../../pixel/core/animation.ts"
import type { RgbaImage } from "../../pixel/core/grid.ts"
import { cropImage, isAnimationName, readingOrder, type FrameBox } from "../../pixel/core/sheet.ts"
import type { Decoded, V } from "./rig.ts"

/** A pixel counts toward a part's island at this alpha or more: the soft edge around it comes with the crop. */
const SOLID = 64
/** Islands closer than this share of the sheet's longer side (and at least 2 pixels) are one part: a gap in anti-aliasing, a detached glint. */
const JOIN = 0.004
/** A part with fewer drawn pixels than this share of the largest's, or under this many pixels on its longer side, is a speck. */
const TINY_SHARE = 0.01
const TINY_SIDE = 6

/** A part's long axis, in its own picture's pixels: from the end nearest its pivot to the far end, its length, and its width across. */
export interface Axis {
  readonly from: V
  readonly to: V
  readonly length: number
  readonly width: number
}

/** One part cut from the sheet. */
export interface PartCut {
  readonly name: string
  readonly image: RgbaImage
  /** The box it came from, in the sheet's pixels. */
  readonly box: FrameBox
  /** The guessed pivot, in the part's own pixels (from its top left). */
  readonly pivot: V
  readonly axis: Axis
}

export interface Cut {
  readonly parts: ReadonlyArray<PartCut>
  /** Boxes left out (a label, a speck) and names that did not match, in words. */
  readonly warnings: ReadonlyArray<string>
}

interface Island {
  x0: number
  y0: number
  x1: number
  y1: number
  mass: number
  /** How many islands were joined into it: a label is many small glyphs. */
  pieces: number
}

/** The sheet's drawn islands (8-connected at `SOLID` alpha), as boxes with their pixel counts. */
const islandsOf = (image: RgbaImage): Array<Island> => {
  const { width, height, data } = image
  const seen = new Uint8Array(width * height)
  const islands: Array<Island> = []
  const stack: Array<number> = []
  for (let start = 0; start < width * height; start++) {
    if (seen[start] === 1 || data[start * 4 + 3]! < SOLID) continue
    const island: Island = { x0: width, y0: height, x1: 0, y1: 0, mass: 0, pieces: 1 }
    seen[start] = 1
    stack.push(start)
    while (stack.length > 0) {
      const p = stack.pop()!
      const x = p % width
      const y = (p - x) / width
      island.x0 = Math.min(island.x0, x)
      island.y0 = Math.min(island.y0, y)
      island.x1 = Math.max(island.x1, x + 1)
      island.y1 = Math.max(island.y1, y + 1)
      island.mass++
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const q = ny * width + nx
          if (seen[q] === 1 || data[q * 4 + 3]! < SOLID) continue
          seen[q] = 1
          stack.push(q)
        }
    }
    islands.push(island)
  }
  return islands
}

/** Islands whose boxes come within `gap` pixels of each other, joined, until none do. */
const joined = (islands: ReadonlyArray<Island>, gap: number): Array<Island> => {
  const out = islands.map((island) => ({ ...island }))
  for (let merged = true; merged; ) {
    merged = false
    for (let i = 0; i < out.length && !merged; i++)
      for (let j = i + 1; j < out.length && !merged; j++) {
        const a = out[i]!
        const b = out[j]!
        if (a.x0 - gap < b.x1 && b.x0 - gap < a.x1 && a.y0 - gap < b.y1 && b.y0 - gap < a.y1) {
          out[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), mass: a.mass + b.mass, pieces: a.pieces + b.pieces }
          out.splice(j, 1)
          merged = true
        }
      }
  }
  return out
}

/** The alpha-weighted centre and principal axis of a picture's drawn pixels. */
const principal = (image: RgbaImage): { readonly centre: V; readonly major: V; readonly minor: V } | undefined => {
  let w = 0
  let sx = 0
  let sy = 0
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      const a = image.data[(y * image.width + x) * 4 + 3]! / 255
      w += a
      sx += a * (x + 0.5)
      sy += a * (y + 0.5)
    }
  if (w === 0) return undefined
  const cx = sx / w
  const cy = sy / w
  let xx = 0
  let yy = 0
  let xy = 0
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      const a = image.data[(y * image.width + x) * 4 + 3]! / 255
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      xx += a * dx * dx
      yy += a * dy * dy
      xy += a * dx * dy
    }
  // The covariance's larger eigenvector: the direction the part is longest along.
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy)
  return { centre: [cx, cy], major: [Math.cos(angle), Math.sin(angle)], minor: [-Math.sin(angle), Math.cos(angle)] }
}

const r1 = (n: number): number => Math.round(n * 10) / 10 + 0

/**
 * Cuts a parts sheet into one picture per part, in reading order, named
 * from `names` (then `part-<n>` for any left over). Specks and boxes that
 * look like labels (three or more small pieces in a row, short and wide
 * like a word) are left out, with a warning each.
 */
export const cutParts = (sheet: RgbaImage, names: ReadonlyArray<string> = []): Cut => {
  const warnings: Array<string> = []
  const { cleared } = clearedSheet(sheet, { ...defaultRecipe, removeBackground: true })
  const gap = Math.max(2, Math.round(JOIN * Math.max(sheet.width, sheet.height)))
  const islands = joined(islandsOf(cleared), gap)
  const largest = Math.max(0, ...islands.map((island) => island.mass))
  const heights = islands.map((island) => island.y1 - island.y0).sort((a, b) => a - b)
  const median = heights[Math.floor(heights.length / 2)] ?? 0
  const kept = islands.filter((island) => {
    const w = island.x1 - island.x0
    const h = island.y1 - island.y0
    const where = `the box at (${island.x0}, ${island.y0}), ${w} × ${h}`
    if (island.mass < TINY_SHARE * largest || Math.max(w, h) < TINY_SIDE) {
      warnings.push(`${where} is tiny (${island.mass} pixels): left out as a speck; draw it bigger or join it to its part if it is one`)
      return false
    }
    if (island.pieces >= 3 && w > 2.5 * h && h < 0.5 * median) {
      warnings.push(`${where} looks like a label (a row of small pieces, short and wide like a word): left out; erase labels from the sheet if it is a part`)
      return false
    }
    return true
  })
  const boxes = readingOrder(kept.map((island): FrameBox => ({ x: island.x0, y: island.y0, width: island.x1 - island.x0, height: island.y1 - island.y0 })))
  if (names.length > 0 && names.length !== boxes.length)
    warnings.push(`${names.length} names for ${boxes.length} parts: ${names.length > boxes.length ? `${names.slice(boxes.length).join(", ")} name nothing` : `the last ${boxes.length - names.length} are part-<n>`}; check the names against the parts in reading order`)
  // The centre of mass of every part kept: where the body is.
  let w = 0
  let mx = 0
  let my = 0
  for (const box of boxes)
    for (let y = box.y; y < box.y + box.height; y++)
      for (let x = box.x; x < box.x + box.width; x++) {
        const a = cleared.data[(y * cleared.width + x) * 4 + 3]! / 255
        w += a
        mx += a * (x + 0.5)
        my += a * (y + 0.5)
      }
  const mass: V = w === 0 ? [sheet.width / 2, sheet.height / 2] : [mx / w, my / w]
  const parts = boxes.map((box, i): PartCut => {
    // One pixel more on every side keeps the soft edge.
    const padded = { x: box.x - 1, y: box.y - 1, width: box.width + 2, height: box.height + 2 }
    const image = cropImage(cleared, padded)
    const ox = Math.max(0, padded.x)
    const oy = Math.max(0, padded.y)
    const axis = principal(image) ?? { centre: [image.width / 2, image.height / 2] as V, major: [0, 1] as V, minor: [1, 0] as V }
    let lo = Infinity
    let hi = -Infinity
    let across = 0
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        if (image.data[(y * image.width + x) * 4 + 3]! < 128) continue
        const dx = x + 0.5 - axis.centre[0]
        const dy = y + 0.5 - axis.centre[1]
        const t = dx * axis.major[0] + dy * axis.major[1]
        lo = Math.min(lo, t)
        hi = Math.max(hi, t)
        across = Math.max(across, Math.abs(dx * axis.minor[0] + dy * axis.minor[1]))
      }
    if (lo > hi) lo = hi = 0
    const end = (t: number): V => [axis.centre[0] + axis.major[0] * t, axis.centre[1] + axis.major[1] * t]
    // The sheet's centre of mass in the part's pixels.
    const m: V = [mass[0] - ox, mass[1] - oy]
    const inside = m[0] >= 0 && m[1] >= 0 && m[0] < image.width && m[1] < image.height && image.data[(Math.floor(m[1]) * image.width + Math.floor(m[0])) * 4 + 3]! >= 128
    const t = inside
      ? end(lo)[1] >= end(hi)[1]
        ? lo
        : hi
      : Math.min(hi, Math.max(lo, (m[0] - axis.centre[0]) * axis.major[0] + (m[1] - axis.centre[1]) * axis.major[1]))
    // On an end of the axis, the joint's centre is half the part's width in (a quarter of its length at most).
    const inset = Math.min(across, (hi - lo) / 4)
    const pivot = end(t <= lo ? lo + inset : t >= hi ? hi - inset : t)
    // The axis runs from the end nearer the pivot to the far one.
    const [from, to] = Math.abs(t - lo) <= Math.abs(hi - t) ? [end(lo), end(hi)] : [end(hi), end(lo)]
    return {
      name: names[i] ?? `part-${i + 1}`,
      image,
      box,
      pivot: [r1(pivot[0]), r1(pivot[1])],
      axis: { from: [r1(from[0]), r1(from[1])], to: [r1(to[0]), r1(to[1])], length: r1(hi - lo), width: r1(2 * across) }
    }
  })
  return { parts, warnings }
}

/** What `parts.json` says about one part: its picture beside it, its size, where it came from, its guessed pivot, and its long axis. */
export interface PartEntry {
  readonly name: string
  readonly file: string
  readonly size: V
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly pivot: V
  readonly axis: Axis
}

/** `parts.json`: the parts `rig parts` cut, for `rig init --from` and for the agent to correct. */
export interface PartsFile {
  readonly version: 1
  readonly sheet: string
  readonly parts: ReadonlyArray<PartEntry>
}

/** Names `rig parts` takes: letters, digits, `_`, `.`, and `-`, as files and rig names both can be. */
export const isPartName = isAnimationName

export const encodeParts = (file: PartsFile): string => JSON.stringify(file, null, 2) + "\n"

/** Reads a `parts.json`, naming every problem in it; write one with `encodeParts`. */
export const decodeParts = (text: string): Decoded<PartsFile> => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `not JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
  const isPair = (value: unknown): value is V => Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "number" && Number.isFinite(v))
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.parts)) return { ok: false, error: 'a parts file is {"version": 1, "sheet": "...", "parts": [{"name", "file", "size", "box", "pivot", "axis"}]}' }
  const errors: Array<string> = []
  const parts: Array<PartEntry> = []
  for (const [i, part] of raw.parts.entries()) {
    const box = isRecord(part) ? part.box : undefined
    const axis = isRecord(part) ? part.axis : undefined
    if (
      !isRecord(part) ||
      typeof part.name !== "string" ||
      !isPartName(part.name) ||
      typeof part.file !== "string" ||
      !isPair(part.size) ||
      !isPair(part.pivot) ||
      !isRecord(box) ||
      !["x", "y", "width", "height"].every((k) => typeof box[k] === "number") ||
      !isRecord(axis) ||
      !isPair(axis.from) ||
      !isPair(axis.to) ||
      typeof axis.length !== "number" ||
      typeof axis.width !== "number"
    ) {
      errors.push(`parts[${i}] must be {"name", "file", "size": [w, h], "box": {"x", "y", "width", "height"}, "pivot": [x, y], "axis": {"from", "to", "length", "width"}}`)
      continue
    }
    parts.push({ name: part.name, file: part.file, size: part.size, box: box as PartEntry["box"], pivot: part.pivot, axis: { from: axis.from, to: axis.to, length: axis.length, width: axis.width } })
  }
  const names = parts.map((part) => part.name)
  const twice = names.filter((name, i) => names.indexOf(name) !== i)
  if (twice.length > 0) errors.push(`parts named twice: ${[...new Set(twice)].join(", ")}`)
  return errors.length > 0 ? { ok: false, error: errors.join("; ") } : { ok: true, value: { version: 1, sheet: typeof raw.sheet === "string" ? raw.sheet : "", parts } }
}
