/**
 * An animation's motion, measured: what an agent cannot see by reading
 * still frames or a GIF it cannot watch. Each number is per frame of one
 * animation, its frames on one canvas with their anchors on one spot (as
 * `pixel sheet` writes them):
 *
 * - the body's area, which stays about the same frame to frame (a squash
 *   widens as it flattens);
 * - how far the foot on the ground moves between frames: a walk drawn in
 *   place moves its planted foot back by the same step every frame, and the
 *   game must move the sprite forward by that step to keep the foot still on
 *   the floor; an uneven step is a foot that skates;
 * - how much changes from the last frame back to the first, against the
 *   other steps: a loop that jumps there.
 */
import { TRANSPARENT, type PixelArt } from "./fix.ts"
import { bodyOf } from "./sheet.ts"

export interface Motion {
  /** The body's pixels on each frame (its largest group of touching pixels: sparks and loose bits are not the body). */
  readonly area: ReadonlyArray<number>
  /** How far the most different frame's body area is from the middle one, from 0 (all the same) up. */
  readonly areaChange: number
  /** The frames whose area is furthest off (numbered from 0, in play order), when any is past `AREA`. */
  readonly areaOff: ReadonlyArray<number>
  /** For each step from a frame to the next (the last to the first in a loop), how many pixels the foot on the ground moves, or null where no foot stays on the ground across the step (a hop, a lifted foot). */
  readonly steps: ReadonlyArray<number | null>
  /** The usual step, in pixels per frame, from the steps with a foot on the ground; positive is to the right. Undefined with fewer than two such steps. */
  readonly groundStep: number | undefined
  /** Whether the foot on the ground slides: the steps differ by more than `SKATE` from the usual one. */
  readonly skates: boolean
  /** The share of pixels that change from the last frame to the first, and on the other steps on average (loops only). */
  readonly seam: { readonly last: number; readonly mean: number } | undefined
}

/** A frame's body area this far (as a share of the middle one) from the middle one is worth a look. */
export const AREA = 0.3
/** Steps of the foot on the ground that differ by more than this many pixels from the usual one skate. */
export const SKATE = 1
/** A loop's last step changes this many times more than the others on average (and more than `SEAM_MIN`): it jumps. */
export const SEAM = 2.5
export const SEAM_MIN = 0.05
/** How much of the smaller contact two frames must share to be the same foot. */
const SAME_FOOT = 0.6

const median = (values: ReadonlyArray<number>): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** The share of pixels drawn on either frame that differ between them. */
export const difference = (a: PixelArt, b: PixelArt): number => {
  let changed = 0
  let drawn = 0
  for (let i = 0; i < a.indices.length; i++) {
    const x = a.indices[i]!
    const y = b.indices[i] ?? TRANSPARENT
    if (x === TRANSPARENT && y === TRANSPARENT) continue
    drawn++
    if (x !== y) changed++
  }
  return drawn === 0 ? 0 : changed / drawn
}

/** The columns where the body touches the ground row, or undefined when it does not reach the ground. */
const contactOf = (body: ReadonlyArray<number>, width: number, ground: number): Set<number> | undefined => {
  const columns = new Set<number>()
  let touches = false
  for (const p of body) {
    const x = p % width
    const y = (p - x) / width
    if (y !== ground) continue
    touches = true
    columns.add(x)
  }
  return touches ? columns : undefined
}

/** How far `b`'s contact sits from `a`'s, as the shift that lines up most of the smaller one; undefined when no shift lines up enough of it (the other foot is down). */
const shiftBetween = (a: Set<number>, b: Set<number>, reach: number): number | undefined => {
  const smaller = Math.min(a.size, b.size)
  if (smaller === 0) return undefined
  let best: number | undefined
  let bestShared = 0
  for (let distance = 0; distance <= reach; distance++) {
    for (const dx of distance === 0 ? [0] : [-distance, distance]) {
      let shared = 0
      for (const x of a) if (b.has(x + dx)) shared++
      if (shared > bestShared) {
        bestShared = shared
        best = dx
      }
    }
  }
  return best !== undefined && bestShared / smaller >= SAME_FOOT ? best : undefined
}

/**
 * Measures one animation's frames (one canvas, anchors on one spot, in play
 * order). `loop`: whether the last frame is followed by the first.
 */
export const motionOf = (frames: ReadonlyArray<PixelArt>, loop: boolean): Motion => {
  const width = frames[0]?.width ?? 0
  const bodies = frames.map(bodyOf)
  const area = bodies.map((body) => body.length)
  const drawn = area.filter((value) => value > 0)
  const middle = drawn.length === 0 ? 0 : median(drawn)
  const offBy = area.map((value) => (middle === 0 || value === 0 ? 0 : Math.abs(value - middle) / middle))
  const areaChange = Math.max(0, ...offBy)
  const areaOff = offBy.flatMap((value, i) => (value > AREA ? [i] : []))

  let ground = -1
  for (const body of bodies) for (const p of body) ground = Math.max(ground, Math.floor(p / Math.max(1, width)))
  const contacts = bodies.map((body) => contactOf(body, width, ground))
  const reach = Math.max(2, Math.round(width / 4))
  const count = frames.length < 2 ? 0 : loop ? frames.length : frames.length - 1
  const steps: Array<number | null> = []
  for (let f = 0; f < count; f++) {
    const a = contacts[f]
    const b = contacts[(f + 1) % frames.length]
    steps.push(a === undefined || b === undefined ? null : (shiftBetween(a, b, reach) ?? null))
  }
  const known = steps.filter((step): step is number => step !== null)
  const groundStep = known.length >= 2 ? median(known) : undefined
  const skates = groundStep !== undefined && known.some((step) => Math.abs(step - groundStep) > SKATE)

  let seam: Motion["seam"]
  if (loop && frames.length > 2) {
    const inner = frames.slice(1).map((frame, f) => difference(frames[f]!, frame))
    seam = { last: difference(frames[frames.length - 1]!, frames[0]!), mean: inner.reduce((sum, value) => sum + value, 0) / inner.length }
  }
  return { area, areaChange, areaOff, steps, groundStep, skates, seam }
}

/** Whether a loop's last step jumps (see `SEAM`). */
export const jumpsAtSeam = (motion: Motion): boolean => motion.seam !== undefined && motion.seam.last > SEAM_MIN && motion.seam.last > motion.seam.mean * SEAM
