/**
 * Writing animations out the ways games read them: every frame of every
 * animation on one picture (each animation from a new row, its frames in
 * one row or in rows of a few), with a JSON file saying where each frame
 * is, how long it shows, and where its anchor is.
 *
 * The JSON is the "hash" spritesheet format that Pixi's `Spritesheet`,
 * Phaser's `atlas`, and Aseprite's export share (`frames`, `meta`), with
 * Pixi's `animations` and Aseprite's `frameTags` naming each animation's
 * frames, and each frame's `anchor` (where it stands, 0 to 1 across the
 * frame) for engines that place sprites by it.
 */
import { TRANSPARENT, type PixelArt } from "./fix.ts"
import type { Loop, Point } from "./sheet.ts"

/** How each animation's frames are laid out: one row, or rows of `columns` frames. */
export interface SheetLayout {
  /** Frames per row; an animation's frame count (or more) makes a strip. */
  readonly columns: number
  /** Empty pixels between frames, and between animations (none around them). */
  readonly spacing: number
}

/** One animation to write: its frames (one size, one palette with the others), its name, and how it plays. */
export interface AtlasClip {
  readonly name: string
  readonly frames: ReadonlyArray<PixelArt>
  /** Where every frame's anchor is, in frame pixels at 1x (one spot for all its frames). */
  readonly anchor: Point
  readonly fps: number
  readonly loop: Loop
}

/** Where one frame is on the picture, in its pixels at 1x. */
export interface AtlasRect {
  readonly clip: number
  readonly frame: number
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** Every frame on one picture, and where each one is. */
export interface Atlas {
  readonly art: PixelArt
  readonly rects: ReadonlyArray<AtlasRect>
}

/**
 * Lays every animation's frames out on one picture: each animation from a
 * new row, its frames in rows of `columns`. Frames must share one palette.
 */
export const atlasOf = (clips: ReadonlyArray<AtlasClip>, layout: SheetLayout): Atlas => {
  const spacing = Math.max(0, Math.round(layout.spacing))
  const rects: Array<AtlasRect> = []
  let top = 0
  let width = 0
  clips.forEach((clip, c) => {
    const first = clip.frames[0]
    if (first === undefined) return
    const columns = Math.max(1, Math.min(clip.frames.length, Math.round(layout.columns)))
    clip.frames.forEach((_, f) => {
      rects.push({ clip: c, frame: f, x: (f % columns) * (first.width + spacing), y: top + Math.floor(f / columns) * (first.height + spacing), w: first.width, h: first.height })
    })
    const rows = Math.ceil(clip.frames.length / columns)
    width = Math.max(width, columns * first.width + (columns - 1) * spacing)
    top += rows * first.height + (rows - 1) * spacing + spacing
  })
  const height = Math.max(0, top - spacing)
  const palette = clips.find((clip) => clip.frames.length > 0)?.frames[0]?.palette ?? []
  const indices = new Int32Array(width * height).fill(TRANSPARENT)
  for (const rect of rects) {
    const art = clips[rect.clip]!.frames[rect.frame]!
    for (let y = 0; y < art.height; y++) {
      indices.set(art.indices.subarray(y * art.width, (y + 1) * art.width), (rect.y + y) * width + rect.x)
    }
  }
  return { art: { width, height, palette, indices }, rects }
}

export interface SpritesheetInfo {
  /** The sheet picture's file name, as the JSON refers to it. */
  readonly image: string
  readonly clips: ReadonlyArray<AtlasClip>
  /** Where the frames are, from `atlasOf` on the same clips. */
  readonly atlas: Atlas
  /** Each pixel of the picture written this many times. */
  readonly scale: number
}

const round = (value: number): number => Math.round(value * 10000) / 10000

/** The spritesheet's JSON (see the module's comment for who reads it). Frames are named "<animation> 0", "<animation> 1", ... */
export const spritesheetJson = (info: SpritesheetInfo): string => {
  const scale = Math.max(1, Math.floor(info.scale))
  const frames: Record<string, unknown> = {}
  const animations: Record<string, Array<string>> = {}
  const frameTags: Array<{ name: string; from: number; to: number; direction: Loop }> = []
  info.clips.forEach((clip, c) => {
    const rects = info.atlas.rects.filter((rect) => rect.clip === c)
    const first = rects[0]
    if (first === undefined) return
    const duration = Math.round(1000 / Math.max(0.1, clip.fps))
    const anchor = { x: round((clip.anchor.x + 0.5) / first.w), y: round((clip.anchor.y + 1) / first.h) }
    const names = rects.map((rect) => `${clip.name} ${rect.frame}`)
    frameTags.push({ name: clip.name, from: Object.keys(frames).length, to: Object.keys(frames).length + names.length - 1, direction: clip.loop })
    rects.forEach((rect, i) => {
      const frame = { x: rect.x * scale, y: rect.y * scale, w: rect.w * scale, h: rect.h * scale }
      frames[names[i]!] = {
        frame,
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: frame.w, h: frame.h },
        sourceSize: { w: frame.w, h: frame.h },
        duration,
        anchor
      }
    })
    animations[clip.name] = names
  })
  return (
    JSON.stringify(
      {
        frames,
        animations,
        meta: {
          app: "https://ritmo.typeonce.dev/tools/pixel/",
          version: "1",
          image: info.image,
          format: "RGBA8888",
          size: { w: info.atlas.art.width * scale, h: info.atlas.art.height * scale },
          scale: "1",
          frameTags,
          fps: Object.fromEntries(info.clips.map((clip) => [clip.name, clip.fps]))
        }
      },
      null,
      2
    ) + "\n"
  )
}
