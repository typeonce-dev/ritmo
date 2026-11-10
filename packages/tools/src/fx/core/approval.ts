/**
 * What the person approved, kept so a later change to it shows: everything
 * `fx render` hands the game. That is the draft, a hash of each frame's final
 * colors, how fast it plays, whether it loops, its canvas size, and its
 * anchor (the pixel the game places on the effect's spot). An edit to the
 * module, a tune, a seed, a recolor, or a palette color all change what the
 * game gets, so each of them reads as a change here, whoever made it.
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
export const approvalOf = (draft: string, run: Run, palette: Palette): Approved => ({
  draft,
  fps: run.fps,
  loop: run.loop,
  size: [run.width, run.height],
  anchor: [run.anchor.x, run.anchor.y],
  frames: framesHashed(run, palette)
})

/**
 * What is different from what the person approved, in a few words;
 * `undefined` when nothing is. What an approval from an older version did not
 * keep (`unkept` in `bank.ts`) is not compared: it is not a change.
 */
export const changedSince = (approved: Approved, draft: string, run: Run, palette: Palette): string | undefined => {
  if (approved.draft !== draft) return `the game gets draft ${draft}, the person approved draft ${approved.draft}`
  const now = framesHashed(run, palette)
  const parts: Array<string> = []
  const resized = approved.size !== undefined && (approved.size[0] !== run.width || approved.size[1] !== run.height)
  if (approved.size !== undefined && resized) parts.push(`its canvas is ${run.width}×${run.height}, ${approved.size[0]}×${approved.size[1]} when approved`)
  if (now.length !== approved.frames.length) parts.push(`${now.length} frames, ${approved.frames.length} when approved`)
  // A new canvas size changes every frame's hash: the size says it.
  else if (!resized) {
    const frames = now.flatMap((hash, f) => (hash === approved.frames[f] ? [] : [f]))
    if (frames.length === 1) parts.push(`frame ${frames[0]} looks different`)
    else if (frames.length > 1) parts.push(`frames ${spans(frames)} look different`)
  }
  if (run.fps !== approved.fps) parts.push(`${run.fps} fps, ${approved.fps} when approved`)
  if (approved.anchor !== undefined && (approved.anchor[0] !== run.anchor.x || approved.anchor[1] !== run.anchor.y))
    parts.push(`its anchor moved from ${approved.anchor[0]},${approved.anchor[1]} to ${run.anchor.x},${run.anchor.y}`)
  if (approved.loop !== undefined && approved.loop !== run.loop) parts.push(run.loop ? "it loops, it played once when approved" : "it plays once, it looped when approved")
  return parts.length === 0 ? undefined : parts.join("; ")
}
