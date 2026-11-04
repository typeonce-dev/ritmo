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
import { frameDuration, playOrder, type Loop, type Point } from "./sheet.ts"

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
  /** How many beats each of its frames shows (see `SheetFrame`). */
  readonly beats: ReadonlyArray<number>
  readonly loop: Loop
}

/** An animation's frames in the order they play, each with how long it shows in milliseconds. */
export const played = (clip: AtlasClip): { readonly frames: ReadonlyArray<PixelArt>; readonly delays: ReadonlyArray<number> } => {
  const order = playOrder(clip.frames.length, clip.loop)
  return { frames: order.map((i) => clip.frames[i]!), delays: order.map((i) => frameDuration(clip.fps, clip.beats[i]!)) }
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
        duration: frameDuration(clip.fps, clip.beats[rect.frame]!),
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
          frameTags
        }
      },
      null,
      2
    ) + "\n"
  )
}

// ---------------------------------------------------------------------------
// Reading a sheet's JSON back

/** One frame of a sheet as its JSON places it: a box on the picture, and how long it shows in milliseconds. */
export interface SheetRect {
  readonly name: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly duration: number
}

/** One animation of a sheet read back: its frames (indices into the sheet's), as the JSON lists them and in the order they play. */
export interface SheetAnimationRead {
  readonly name: string
  readonly frames: ReadonlyArray<number>
  /** `frames` played forward, backward, or there and back. */
  readonly play: ReadonlyArray<number>
}

/** A sheet as a review shows it: its frames, and its animations. */
export interface ReadSheet {
  readonly frames: ReadonlyArray<SheetRect>
  readonly animations: ReadonlyArray<SheetAnimationRead>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The frame time Aseprite gives a frame with no duration. */
const DEFAULT_DURATION = 100

const rectOf = (name: string, raw: unknown): SheetRect | undefined => {
  if (!isRecord(raw) || !isRecord(raw.frame)) return undefined
  const { x, y, w, h } = raw.frame
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(w) || !Number.isInteger(h) || typeof x !== "number" || typeof y !== "number" || typeof w !== "number" || typeof h !== "number") return undefined
  return { name, x, y, w, h, duration: typeof raw.duration === "number" && raw.duration > 0 ? raw.duration : DEFAULT_DURATION }
}

/**
 * Reads a spritesheet's JSON (`spritesheetJson`'s, or any "hash" or "array"
 * one with frame boxes, as Aseprite and TexturePacker write) for the picture
 * it sits beside. `undefined` when it is not a sheet's JSON at all (another
 * format, a JSON map): the picture is then a still. A sheet whose frames do
 * not fit the picture is an error.
 *
 * Animations come from Pixi's `animations`, else Aseprite's `frameTags`
 * (played the way each says: forward, reverse, or there and back), else all
 * the frames in order as one.
 */
export const readSpritesheet = (json: unknown, picture: { readonly width: number; readonly height: number }): { readonly ok: true; readonly sheet: ReadSheet } | { readonly ok: false; readonly error: string } | undefined => {
  if (!isRecord(json)) return undefined
  const entries: Array<readonly [string, unknown]> = Array.isArray(json.frames)
    ? json.frames.map((frame: unknown, i) => [isRecord(frame) && typeof frame.filename === "string" ? frame.filename : String(i), frame] as const)
    : isRecord(json.frames)
      ? Object.entries(json.frames)
      : []
  const frames = entries.map(([name, raw]) => rectOf(name, raw))
  if (frames.length === 0 || frames.some((frame) => frame === undefined)) return undefined
  const rects = frames.filter((frame): frame is SheetRect => frame !== undefined)
  const outside = rects.find((rect) => rect.w < 1 || rect.h < 1 || rect.x < 0 || rect.y < 0 || rect.x + rect.w > picture.width || rect.y + rect.h > picture.height)
  if (outside !== undefined) return { ok: false, error: `its frame "${outside.name}" (${outside.x},${outside.y} ${outside.w}×${outside.h}) is not on the ${picture.width}×${picture.height} picture` }
  const index = new Map(rects.map((rect, i) => [rect.name, i]))
  const meta = isRecord(json.meta) ? json.meta : {}
  const tags = (Array.isArray(meta.frameTags) ? meta.frameTags : []).filter(
    (tag): tag is { readonly name: string; readonly from: number; readonly to: number; readonly direction?: unknown } =>
      isRecord(tag) && typeof tag.name === "string" && Number.isInteger(tag.from) && Number.isInteger(tag.to)
  )
  const direction = (name: string): unknown => tags.find((tag) => tag.name === name)?.direction
  const ordered = (name: string, frames: Array<number>): SheetAnimationRead => {
    const way = direction(name)
    if (way === "reverse") return { name, frames, play: [...frames].reverse() }
    if (way === "pingpong" && frames.length > 2) return { name, frames, play: [...frames, ...frames.slice(1, -1).reverse()] }
    return { name, frames, play: frames }
  }
  const animations = isRecord(json.animations)
    ? Object.entries(json.animations).flatMap(([name, names]) => {
        const order = (Array.isArray(names) ? names : []).flatMap((frame) => {
          const i = typeof frame === "string" ? index.get(frame) : undefined
          return i === undefined ? [] : [i]
        })
        return order.length === 0 ? [] : [ordered(name, order)]
      })
    : tags.flatMap((tag) => {
        const order = Array.from({ length: tag.to - tag.from + 1 }, (_, i) => tag.from + i).filter((i) => i >= 0 && i < rects.length)
        return order.length === 0 ? [] : [ordered(tag.name, order)]
      })
  return { ok: true, sheet: { frames: rects, animations: animations.length > 0 ? animations : [ordered("frames", rects.map((_, i) => i))] } }
}
