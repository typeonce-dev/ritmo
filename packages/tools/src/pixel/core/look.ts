/**
 * `pixel look`'s picture: art as the player will see it, and up close, in one
 * PNG for an agent to read. An enlarged sprite alone shows its pixels, not
 * whether it reads; this draws it the way the game will:
 *
 * - on top, every piece at display size (the game's whole-number scale), on
 *   the game's backdrop (a color or one of its floor tiles, repeated), beside
 *   the game's stand-in sprite (its player), all standing on one ground line;
 * - below, every piece up close (a row each), on the same backdrop, with the pixels a
 *   check found ringed in magenta.
 *
 * An animation is its frames, side by side, in both rows.
 */
import { TRANSPARENT, type PixelArt } from "./fix.ts"
import type { RgbaImage } from "./grid.ts"

/** What the art is drawn over: a color, or a tile repeated at the art's scale (a floor, a wall). */
export type Backdrop = { readonly kind: "color"; readonly rgb: number } | { readonly kind: "tile"; readonly tile: RgbaImage }

/** Backdrops by name when the project gives none: a night level, a day level, a checkerboard that shows transparency. */
export const BACKDROPS: Readonly<Record<"dark" | "light" | "checker", number>> = { dark: 0x1a1c2c, light: 0xe8e4d8, checker: 0x3a3a44 }

/** One piece to look at: a picture (one frame) or an animation, with the pixels to ring, each [x, y] or [x, y, frame from 1]. */
export interface LookPiece {
  readonly frames: ReadonlyArray<PixelArt>
  readonly marks: ReadonlyArray<readonly [x: number, y: number, frame?: number]>
}

export interface LookOptions {
  /** Screen pixels per art pixel in the game: the display size. */
  readonly scale: number
  readonly backdrop: Backdrop
  /** The game's player, drawn first in the top row at the same scale, for size. */
  readonly standIn?: PixelArt | undefined
}

/** Where a piece of the top row is: its frame, its left edge and its ground line, in art pixels. */
interface Slot {
  readonly art: PixelArt
  readonly x: number
}

// Magenta: the debug color, in almost no game's palette, so a ring shows on any art.
const MARK = 0xff2bd6
// The band between the two rows, and the margin around pieces, in screen pixels.
const BAND = 0x0c0d14
const GAP = 4
const ROW = 8

/** How many screen pixels an art pixel gets up close: about four times the display size, kept to a picture an agent can read. */
export const zoomOf = (pieces: ReadonlyArray<LookPiece>, scale: number): number => {
  const biggest = Math.max(1, ...pieces.flatMap((piece) => piece.frames.map((art) => Math.max(art.width, art.height))))
  return Math.max(scale + 1, Math.min(scale * 4, Math.floor(320 / biggest)))
}

/** The lowest row with a drawn pixel, so pieces stand on one line whatever their empty margins. */
const footOf = (art: PixelArt): number => {
  for (let y = art.height - 1; y >= 0; y--) for (let x = 0; x < art.width; x++) if (art.indices[y * art.width + x] !== TRANSPARENT) return y
  return art.height - 1
}

const rgbOf = (art: PixelArt, index: number): number => {
  const color = art.palette[index]!
  return (color.r << 16) | (color.g << 8) | color.b
}

/** The look picture (see the module's comment). */
export const lookPicture = (pieces: ReadonlyArray<LookPiece>, options: LookOptions): RgbaImage => {
  const scale = Math.max(1, Math.floor(options.scale))
  const zoom = zoomOf(pieces, scale)

  // Top row: the stand-in, then every frame of every piece, left to right, art pixels apart.
  const slots: Array<Slot> = []
  let cursor = GAP
  const place = (art: PixelArt, gap: number): void => {
    slots.push({ art, x: cursor })
    cursor += art.width + gap
  }
  if (options.standIn !== undefined) place(options.standIn, GAP * 2)
  for (const piece of pieces) {
    piece.frames.forEach((art, f) => place(art, f === piece.frames.length - 1 ? GAP * 2 : 2))
  }
  const tallest = Math.max(1, ...slots.map((slot) => footOf(slot.art) + 1))
  const topWidth = cursor - GAP
  const topHeight = tallest + GAP * 2
  const ground = topHeight - GAP

  // Below: each piece's frames up close, a row each (wrapping at `ROW` frames), in cells the size of that piece.
  const pad = GAP * scale
  const lines = pieces.flatMap((piece) => {
    const cellW = Math.max(1, ...piece.frames.map((art) => art.width)) * zoom
    const cellH = Math.max(1, ...piece.frames.map((art) => art.height)) * zoom
    const frames = piece.frames.map((art, f) => ({ art, marks: piece.marks.filter((mark) => (mark[2] ?? 1) === f + 1) }))
    const out: Array<{ readonly cellW: number; readonly cellH: number; readonly cells: typeof frames }> = []
    for (let i = 0; i < frames.length; i += ROW) out.push({ cellW, cellH, cells: frames.slice(i, i + ROW) })
    return out
  })
  const bottomWidth = Math.max(0, ...lines.map((line) => line.cells.length * line.cellW + (line.cells.length + 1) * pad))
  const bottomHeight = lines.reduce((sum, line) => sum + line.cellH + pad, pad)
  const width = Math.max(topWidth * scale, bottomWidth)
  const height = topHeight * scale + pad + bottomHeight
  const data = new Uint8ClampedArray(width * height * 4)
  const set = (x: number, y: number, rgb: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = (y * width + x) * 4
    data[i] = (rgb >> 16) & 255
    data[i + 1] = (rgb >> 8) & 255
    data[i + 2] = rgb & 255
    data[i + 3] = 255
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, BAND)

  /** The backdrop's color at an art pixel (a tile repeats from the area's corner). */
  const backdropAt = (ax: number, ay: number): number => {
    const backdrop = options.backdrop
    if (backdrop.kind === "color") return backdrop.rgb
    const { tile } = backdrop
    const i = ((ay % tile.height) * tile.width + (ax % tile.width)) * 4
    return (tile.data[i]! << 16) | (tile.data[i + 1]! << 8) | tile.data[i + 2]!
  }
  /** Fills an area with the backdrop, `size` screen pixels per art pixel. */
  const fill = (left: number, top: number, w: number, h: number, size: number): void => {
    for (let ay = 0; ay < Math.ceil(h / size); ay++)
      for (let ax = 0; ax < Math.ceil(w / size); ax++) {
        const rgb = backdropAt(ax, ay)
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) if (ax * size + dx < w && ay * size + dy < h) set(left + ax * size + dx, top + ay * size + dy, rgb)
      }
  }
  /** Draws art with its top-left at (left, top), `size` screen pixels per art pixel. */
  const draw = (art: PixelArt, left: number, top: number, size: number): void => {
    for (let y = 0; y < art.height; y++)
      for (let x = 0; x < art.width; x++) {
        const index = art.indices[y * art.width + x]!
        if (index === TRANSPARENT) continue
        const rgb = rgbOf(art, index)
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) set(left + x * size + dx, top + y * size + dy, rgb)
      }
  }

  fill(0, 0, width, topHeight * scale, scale)
  for (const slot of slots) draw(slot.art, slot.x * scale, (ground - 1 - footOf(slot.art)) * scale, scale)

  let lineTop = topHeight * scale + pad * 2
  for (const line of lines) {
    line.cells.forEach((cell, i) => {
      const left = pad + i * (line.cellW + pad)
      fill(left, lineTop, line.cellW, line.cellH, zoom)
      draw(cell.art, left, lineTop, zoom)
      // Each mark: a square ring two screen pixels thick around its pixel, leaving the pixel itself visible.
      for (const [x, y] of cell.marks) {
        const x0 = left + x * zoom - 3
        const y0 = lineTop + y * zoom - 3
        const size = zoom + 6
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) if (dx < 2 || dy < 2 || dx >= size - 2 || dy >= size - 2) set(x0 + dx, y0 + dy, MARK)
      }
    })
    lineTop += line.cellH + pad
  }
  return { width, height, data }
}
