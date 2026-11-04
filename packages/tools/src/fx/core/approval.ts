/**
 * What the person approved, kept so a later change to it shows: the draft the
 * game gets, how fast it plays, and a hash of each frame's final colors. An
 * edit to the module, a tune, a seed, a recolor, or a palette color all change
 * what the game gets, so each of them reads as a change here, whoever made it.
 */
import { makeHash } from "../../internal/hash.ts"
import type { Approved } from "./bank.ts"
import { spans } from "./check.ts"
import type { Palette, Run } from "./effect.ts"
import { rgbOf } from "./export.ts"

/** The hash of the canvas's width and each pixel's color, with transparent apart from every color. */
const hashFrame = (frame: Uint8Array, width: number, colors: ReadonlyArray<number>): string => {
  const hash = makeHash()
  hash.mix(width)
  hash.mix(width >> 8)
  for (const v of frame) {
    const color = colors[v - 1]
    if (v === 0 || color === undefined) {
      hash.mix(0)
      continue
    }
    hash.mix(1)
    hash.mix(color >> 16)
    hash.mix(color >> 8)
    hash.mix(color)
  }
  return hash.done()
}

const framesHashed = (run: Run, palette: Palette): Array<string> => {
  const colors = rgbOf(palette).map((color) => (color.r << 16) | (color.g << 8) | color.b)
  return run.frames.map((frame) => hashFrame(frame, run.width, colors))
}

/** What to keep when the person approves `draft`, as it draws now. */
export const approvalOf = (draft: string, run: Run, palette: Palette): Approved => ({ draft, fps: run.fps, frames: framesHashed(run, palette) })

/** What is different from what the person approved, in a few words; `undefined` when nothing is. */
export const changedSince = (approved: Approved, draft: string, run: Run, palette: Palette): string | undefined => {
  if (approved.draft !== draft) return `the game gets draft ${draft}, the person approved draft ${approved.draft}`
  const now = framesHashed(run, palette)
  const parts: Array<string> = []
  if (now.length !== approved.frames.length) parts.push(`${now.length} frames, ${approved.frames.length} when approved`)
  else {
    const frames = now.flatMap((hash, f) => (hash === approved.frames[f] ? [] : [f]))
    if (frames.length === 1) parts.push(`frame ${frames[0]} looks different`)
    else if (frames.length > 1) parts.push(`frames ${spans(frames)} look different`)
  }
  if (run.fps !== approved.fps) parts.push(`${run.fps} fps, ${approved.fps} when approved`)
  return parts.length === 0 ? undefined : parts.join("; ")
}
