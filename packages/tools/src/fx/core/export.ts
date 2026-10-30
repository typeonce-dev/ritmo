/**
 * A run's frames as pixel art: a sprite sheet with its JSON and a GIF for
 * the game (through the pixel fixer's writers); for an agent to look at, a
 * contact sheet (every frame side by side and enlarged) and a compare sheet
 * (every draft in a row, the same moments in each column), both with the
 * game's stand-in sprite behind the effect when the bank has one.
 */
import { parseHex, type Rgb } from "../../pixel/core/color.ts"
import { TRANSPARENT, type PixelArt } from "../../pixel/core/fix.ts"
import type { RgbaImage } from "../../pixel/core/grid.ts"
import type { Palette, Run } from "./effect.ts"

export const rgbOf = (palette: Palette): Array<Rgb> => Object.values(palette).map((hex) => parseHex(hex) ?? { r: 0, g: 0, b: 0 })

/** Each frame as pixel art on the palette. */
export const framesOf = (run: Run, palette: Palette): Array<PixelArt> => {
  const colors = rgbOf(palette)
  return run.frames.map((frame) => ({ width: run.width, height: run.height, palette: colors, indices: Int32Array.from(frame, (v) => (v === 0 ? TRANSPARENT : v - 1)) }))
}

/** A picture placed on an effect's canvas: its top-left pixel, in the effect's pixels (it may stick out). */
export interface Placed {
  readonly image: RgbaImage
  readonly x: number
  readonly y: number
}

/** The stand-in placed with its anchor on `spot` of the effect's canvas. */
export const placeStandIn = (image: RgbaImage, anchor: readonly [number, number], spot: readonly [number, number]): Placed => ({ image, x: spot[0] - anchor[0], y: spot[1] - anchor[1] })

/** What a frame shows: the effect's canvas, grown to hold the stand-in where it sticks out. `left` and `top` are 0 or below. */
export interface View {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export const viewOf = (run: { readonly width: number; readonly height: number }, standIn?: Placed): View => {
  if (standIn === undefined) return { left: 0, top: 0, width: run.width, height: run.height }
  const left = Math.min(0, standIn.x)
  const top = Math.min(0, standIn.y)
  return {
    left,
    top,
    width: Math.max(run.width, standIn.x + standIn.image.width) - left,
    height: Math.max(run.height, standIn.y + standIn.image.height) - top
  }
}

type Backdrop = "dark" | "light" | "checker" | `#${string}`

export interface ContactOptions {
  /** Each pixel drawn this many times on both axes. */
  readonly scale: number
  /** Frames per row. */
  readonly columns: number
  /** What the frames are drawn over: dark (a night level), light, a checkerboard, or a `#rrggbb` (one of the game's backgrounds). */
  readonly backdrop: Backdrop
  /** Pixels to ring, each on its frame: where a check fires, or where the person pinned a comment. */
  readonly marks?: ReadonlyArray<{ readonly frame: number; readonly x: number; readonly y: number }> | undefined
  /** One of the game's sprites, drawn behind every frame to show the effect's size. */
  readonly standIn?: Placed | undefined
}

const BACKDROPS = {
  dark: [0x1a1c2c, 0x1f2133],
  light: [0xe8e4d8, 0xdcd8cc],
  checker: [0x3a3a44, 0x5a5a66]
} as const

// Magenta: the debug color, in almost no game's palette, so a ring shows on fire, ice, and smoke alike.
const MARK = 0xff2bd6

/** A solid background, with a slightly lighter or darker square every other one so the pixel size still shows. */
const solid = (hex: string): readonly [number, number] => {
  const color = parseHex(hex) ?? { r: 0, g: 0, b: 0 }
  const base = (color.r << 16) | (color.g << 8) | color.b
  const shift = (color.r + color.g + color.b) / 3 > 128 ? -10 : 10
  const nudge = (v: number): number => Math.max(0, Math.min(255, v + shift))
  return [base, (nudge(color.r) << 16) | (nudge(color.g) << 8) | nudge(color.b)]
}

/** A blank sheet to draw cells on, and how to set one of its pixels. */
const sheet = (width: number, height: number) => {
  const data = new Uint8ClampedArray(width * height * 4)
  const set = (x: number, y: number, rgb: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = (y * width + x) * 4
    data[i] = (rgb >> 16) & 255
    data[i + 1] = (rgb >> 8) & 255
    data[i + 2] = rgb & 255
    data[i + 3] = 255
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, 0x0c0d14)
  return { image: { width, height, data } satisfies RgbaImage, set }
}

interface Cell {
  readonly run: Run
  readonly frame: number
  readonly view: View
  readonly marks?: ContactOptions["marks"]
  readonly standIn?: Placed | undefined
}

/** One frame enlarged at (left, top) of a sheet: the backdrop, the stand-in, the effect, then the marks. */
const drawCell = (set: (x: number, y: number, rgb: number) => void, left: number, top: number, cell: Cell, colors: ReadonlyArray<Rgb>, scale: number, backdrop: Backdrop): void => {
  const { run, view, standIn } = cell
  const [a, b] = backdrop.startsWith("#") ? solid(backdrop) : BACKDROPS[backdrop as keyof typeof BACKDROPS]
  const pixels = run.frames[cell.frame]
  for (let vy = 0; vy < view.height; vy++)
    for (let vx = 0; vx < view.width; vx++) {
      // In the effect's own pixels: the backdrop's squares of 4 line up with its canvas, so the pixel size shows.
      const px = vx + view.left
      const py = vy + view.top
      let rgb = (Math.floor(px / 4) + Math.floor(py / 4)) % 2 === 0 ? a : b
      if (standIn !== undefined) {
        const sx = px - standIn.x
        const sy = py - standIn.y
        if (sx >= 0 && sy >= 0 && sx < standIn.image.width && sy < standIn.image.height) {
          const i = (sy * standIn.image.width + sx) * 4
          if (standIn.image.data[i + 3]! >= 128) rgb = (standIn.image.data[i]! << 16) | (standIn.image.data[i + 1]! << 8) | standIn.image.data[i + 2]!
        }
      }
      const v = pixels !== undefined && px >= 0 && py >= 0 && px < run.width && py < run.height ? pixels[py * run.width + px]! : 0
      const color = colors[v - 1]
      if (v > 0 && color !== undefined) rgb = (color.r << 16) | (color.g << 8) | color.b
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) set(left + vx * scale + dx, top + vy * scale + dy, rgb)
    }
  // Each mark: a square ring two screen pixels thick around its pixel, leaving the pixel itself visible.
  for (const mark of cell.marks ?? []) {
    if (mark.frame !== cell.frame) continue
    const x0 = left + (mark.x - view.left) * scale - 3
    const y0 = top + (mark.y - view.top) * scale - 3
    const size = scale + 6
    for (let dy = 0; dy < size; dy++)
      for (let dx = 0; dx < size; dx++) if (dx < 2 || dy < 2 || dx >= size - 2 || dy >= size - 2) set(x0 + dx, y0 + dy, MARK)
  }
}

/** Every frame enlarged, in rows, on a backdrop, with a gap between frames. */
export const contactSheet = (run: Run, palette: Palette, options: ContactOptions): RgbaImage => {
  const colors = rgbOf(palette)
  const scale = Math.max(1, Math.floor(options.scale))
  const columns = Math.max(1, Math.min(run.frames.length, Math.floor(options.columns)))
  const rows = Math.ceil(run.frames.length / columns)
  const gap = Math.max(2, scale)
  const view = viewOf(run, options.standIn)
  const cw = view.width * scale
  const ch = view.height * scale
  const { image, set } = sheet(columns * cw + (columns + 1) * gap, rows * ch + (rows + 1) * gap)
  run.frames.forEach((_, f) => {
    const left = gap + (f % columns) * (cw + gap)
    const top = gap + Math.floor(f / columns) * (ch + gap)
    drawCell(set, left, top, { run, frame: f, view, marks: options.marks, standIn: options.standIn }, colors, scale, options.backdrop)
  })
  return image
}

/** The frames a compare sheet shows of a run: `count` moments spread from its first frame to its last. */
export const momentsOf = (frames: number, count: number): Array<number> =>
  Array.from({ length: count }, (_, c) => (count === 1 ? 0 : Math.round((c * (frames - 1)) / (count - 1))))

/**
 * Drafts side by side: one row per draft, each column the same moment of
 * each (its first frame, its last, and evenly between), so the drafts'
 * shapes and timing compare in one picture.
 */
export const compareSheet = (
  rows: ReadonlyArray<{ readonly run: Run; readonly marks?: ContactOptions["marks"]; readonly standIn?: Placed | undefined }>,
  palette: Palette,
  options: Omit<ContactOptions, "marks" | "standIn">
): RgbaImage => {
  const colors = rgbOf(palette)
  const scale = Math.max(1, Math.floor(options.scale))
  const columns = Math.max(1, Math.min(Math.max(1, ...rows.map((row) => row.run.frames.length)), Math.floor(options.columns)))
  const gap = Math.max(2, scale)
  const views = rows.map((row) => viewOf(row.run, row.standIn))
  const cw = Math.max(1, ...views.map((view) => view.width)) * scale
  const ch = Math.max(1, ...views.map((view) => view.height)) * scale
  // A wider gap between rows than between frames, so each draft reads as its own strip.
  const rowGap = gap * 3
  const { image, set } = sheet(columns * cw + (columns + 1) * gap, rows.length * ch + (rows.length - 1) * rowGap + 2 * gap)
  rows.forEach((row, r) => {
    const view = views[r]!
    momentsOf(row.run.frames.length, columns).forEach((frame, c) => {
      // Each draft centred in its cell, so drafts of other sizes line up.
      const left = gap + c * (cw + gap) + Math.floor((cw - view.width * scale) / 2)
      const top = gap + r * (ch + rowGap) + Math.floor((ch - view.height * scale) / 2)
      drawCell(set, left, top, { run: row.run, frame, view, marks: row.marks, standIn: row.standIn }, colors, scale, options.backdrop)
    })
  })
  return image
}
