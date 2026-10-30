/**
 * A run's frames as pixel art: a sprite sheet with its JSON and a GIF for
 * the game (through the pixel fixer's writers), and a contact sheet, every
 * frame side by side and enlarged, for an agent to look at.
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

export interface ContactOptions {
  /** Each pixel drawn this many times on both axes. */
  readonly scale: number
  /** Frames per row. */
  readonly columns: number
  /** What the frames are drawn over: dark (a night level), light, a checkerboard, or a `#rrggbb` (one of the game's backgrounds). */
  readonly backdrop: "dark" | "light" | "checker" | `#${string}`
  /** Pixels to ring, each on its frame: where a check fires, or where the person pinned a comment. */
  readonly marks?: ReadonlyArray<{ readonly frame: number; readonly x: number; readonly y: number }> | undefined
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

/** Every frame enlarged, in rows, on a backdrop, with a gap between frames. */
export const contactSheet = (run: Run, palette: Palette, options: ContactOptions): RgbaImage => {
  const colors = rgbOf(palette)
  const scale = Math.max(1, Math.floor(options.scale))
  const columns = Math.max(1, Math.min(run.frames.length, Math.floor(options.columns)))
  const rows = Math.ceil(run.frames.length / columns)
  const gap = Math.max(2, scale)
  const cw = run.width * scale
  const ch = run.height * scale
  const width = columns * cw + (columns + 1) * gap
  const height = rows * ch + (rows + 1) * gap
  const data = new Uint8ClampedArray(width * height * 4)
  const set = (x: number, y: number, rgb: number): void => {
    const i = (y * width + x) * 4
    data[i] = (rgb >> 16) & 255
    data[i + 1] = (rgb >> 8) & 255
    data[i + 2] = rgb & 255
    data[i + 3] = 255
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, 0x0c0d14)
  const [a, b] = options.backdrop.startsWith("#") ? solid(options.backdrop) : BACKDROPS[options.backdrop as keyof typeof BACKDROPS]
  // The backdrop is in squares of 4 effect pixels, so the pixel size shows.
  run.frames.forEach((frame, f) => {
    const left = gap + (f % columns) * (cw + gap)
    const top = gap + Math.floor(f / columns) * (ch + gap)
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const px = Math.floor(x / scale)
        const py = Math.floor(y / scale)
        const v = frame[py * run.width + px]!
        const color = colors[v - 1]
        if (v > 0 && color !== undefined) set(left + x, top + y, (color.r << 16) | (color.g << 8) | color.b)
        else set(left + x, top + y, (Math.floor(px / 4) + Math.floor(py / 4)) % 2 === 0 ? a : b)
      }
    // Each mark: a square ring two screen pixels thick around its pixel, leaving the pixel itself visible.
    for (const mark of options.marks ?? []) {
      if (mark.frame !== f) continue
      const x0 = left + mark.x * scale - 3
      const y0 = top + mark.y * scale - 3
      const size = scale + 6
      for (let dy = 0; dy < size; dy++)
        for (let dx = 0; dx < size; dx++) {
          const edge = dx < 2 || dy < 2 || dx >= size - 2 || dy >= size - 2
          const x = x0 + dx
          const y = y0 + dy
          if (edge && x >= 0 && y >= 0 && x < width && y < height) set(x, y, MARK)
        }
    }
  })
  return { width, height, data }
}
