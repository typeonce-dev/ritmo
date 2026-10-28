/**
 * Writing an animation out the ways games read one: every frame on one
 * picture (a strip, or a grid of rows), with a JSON file saying where each
 * frame is, how long it shows, and where its anchor is.
 *
 * The JSON is the "hash" spritesheet format that Pixi's `Spritesheet`,
 * Phaser's `atlas`, and Aseprite's export share (`frames`, `meta`), with
 * Pixi's `animations` and Aseprite's `frameTags` for the clip, and each
 * frame's `anchor` (where it stands, 0 to 1 across the frame) for engines
 * that place sprites by it.
 */
import { TRANSPARENT, type PixelArt } from "./fix.ts"
import type { Point, Loop } from "./sheet.ts"

/** How frames are laid out on one picture: one row, or rows of `columns` frames. */
export interface SheetLayout {
  /** Frames per row; the frame count (or more) makes a strip. */
  readonly columns: number
  /** Empty pixels between frames (and none around them). */
  readonly spacing: number
}

/** Frames per row and rows for a layout. */
export const gridOf = (count: number, layout: SheetLayout): { readonly columns: number; readonly rows: number } => {
  const columns = Math.max(1, Math.min(count, Math.round(layout.columns)))
  return { columns, rows: Math.max(1, Math.ceil(count / columns)) }
}

/** Where a frame sits on the sheet, in the sheet's pixels at 1x. */
export const frameRect = (i: number, width: number, height: number, count: number, layout: SheetLayout): { x: number; y: number; w: number; h: number } => {
  const { columns } = gridOf(count, layout)
  const spacing = Math.max(0, Math.round(layout.spacing))
  return { x: (i % columns) * (width + spacing), y: Math.floor(i / columns) * (height + spacing), w: width, h: height }
}

/** Every frame on one picture, laid out as asked. Frames must share one size and one palette. */
export const sheetArt = (frames: ReadonlyArray<PixelArt>, layout: SheetLayout): PixelArt => {
  const first = frames[0]
  if (first === undefined) return { width: 0, height: 0, palette: [], indices: new Int32Array() }
  const { columns, rows } = gridOf(frames.length, layout)
  const spacing = Math.max(0, Math.round(layout.spacing))
  const width = columns * first.width + (columns - 1) * spacing
  const height = rows * first.height + (rows - 1) * spacing
  const indices = new Int32Array(width * height).fill(TRANSPARENT)
  frames.forEach((art, i) => {
    const at = frameRect(i, first.width, first.height, frames.length, layout)
    for (let y = 0; y < art.height; y++) {
      indices.set(art.indices.subarray(y * art.width, (y + 1) * art.width), (at.y + y) * width + at.x)
    }
  })
  return { width, height, palette: first.palette, indices }
}

export interface SpritesheetInfo {
  /** The animation's name: frames are named "<name> 0", "<name> 1", ... */
  readonly name: string
  /** The sheet picture's file name, as the JSON refers to it. */
  readonly image: string
  readonly frameWidth: number
  readonly frameHeight: number
  readonly count: number
  readonly layout: SheetLayout
  /** Each pixel of the picture written this many times. */
  readonly scale: number
  readonly fps: number
  readonly loop: Loop
  /** Where every frame's anchor is, in frame pixels at 1x (one spot for all, as laid out). */
  readonly anchor: Point
}

const round = (value: number): number => Math.round(value * 10000) / 10000

/** The spritesheet's JSON (see the module's comment for who reads it). */
export const spritesheetJson = (info: SpritesheetInfo): string => {
  const scale = Math.max(1, Math.floor(info.scale))
  const duration = Math.round(1000 / Math.max(0.1, info.fps))
  const names = Array.from({ length: info.count }, (_, i) => `${info.name} ${i}`)
  const anchor = {
    x: round((info.anchor.x + 0.5) / info.frameWidth),
    y: round((info.anchor.y + 1) / info.frameHeight)
  }
  const frames: Record<string, unknown> = {}
  names.forEach((name, i) => {
    const rect = frameRect(i, info.frameWidth, info.frameHeight, info.count, info.layout)
    const frame = { x: rect.x * scale, y: rect.y * scale, w: rect.w * scale, h: rect.h * scale }
    frames[name] = {
      frame,
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: frame.w, h: frame.h },
      sourceSize: { w: frame.w, h: frame.h },
      duration,
      anchor
    }
  })
  const { columns, rows } = gridOf(info.count, info.layout)
  const spacing = Math.max(0, Math.round(info.layout.spacing))
  const size = {
    w: (columns * info.frameWidth + (columns - 1) * spacing) * scale,
    h: (rows * info.frameHeight + (rows - 1) * spacing) * scale
  }
  return (
    JSON.stringify(
      {
        frames,
        animations: { [info.name]: names },
        meta: {
          app: "https://ritmo.typeonce.dev/tools/pixel/",
          version: "1",
          image: info.image,
          format: "RGBA8888",
          size,
          scale: "1",
          frameTags: [{ name: info.name, from: 0, to: info.count - 1, direction: info.loop }],
          fps: info.fps
        }
      },
      null,
      2
    ) + "\n"
  )
}
