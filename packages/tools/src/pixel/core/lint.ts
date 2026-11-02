/**
 * Checks pixel art against a project's rules: its size, its palette, how
 * many colors it uses, half-transparent pixels, stray pixels, and colors
 * too close to tell apart; the pixel craft (`craft.ts`: jaggies, doubles,
 * holes, and in animations flicker); and an animation's motion
 * (`motion.ts`). Each issue says what is wrong, where, and how bad: errors
 * break the rules, warnings are worth a look, and a warning judged
 * deliberate is accepted with why (`acceptIssues`).
 */
import { pack, toHex, toOklab, type Rgb } from "./color.ts"
import { CRAFT_SPOTS, doubles, framesOfArt, holes, jaggies, specks, type Frames, type Spot } from "./craft.ts"
import { TRANSPARENT, type PixelArt } from "./fix.ts"
import { jumpsAtSeam, motionOf, type Motion } from "./motion.ts"
import { playOrder, type Loop } from "./sheet.ts"

export interface LintRules {
  /** The only colors allowed. */
  readonly palette?: ReadonlyArray<Rgb> | undefined
  /** The sizes allowed. */
  readonly sizes?: ReadonlyArray<{ readonly width: number; readonly height: number }> | undefined
  readonly maxColors?: number | undefined
  /** The picture's background must be transparent: a sprite, not a scene (judged by its corners and border). */
  readonly transparentBackground?: boolean | undefined
}

export type Severity = "error" | "warning"

export interface Issue {
  readonly rule:
    | "size"
    | "off-palette"
    | "too-many-colors"
    | "partial-alpha"
    | "opaque-background"
    | "stray-pixel"
    | "near-duplicate-colors"
    // Animation sheets (see `reportOfSheet`).
    | "one-frame"
    | "empty-frame"
    | "frame-scale"
    // The craft (see `craftIssues`).
    | "jaggies"
    | "doubles"
    | "holes"
    | "flicker"
    // An animation's motion (see `motionIssues`).
    | "area"
    | "skate"
    | "seam"
  readonly severity: Severity
  readonly message: string
  /** How many pixels the issue covers. */
  readonly count: number
  /** Some of the pixels, as [x, y]: the first 20. In an animation, [x, y, frame], the frame numbered from 1 in the animation's own frames. */
  readonly at: ReadonlyArray<readonly [x: number, y: number, frame?: number]>
  /** The animation the issue is in, on a sheet. */
  readonly animation?: string
}

/** Colors closer than this (OKLab) look the same: in pixel art they are noise or anti-aliasing. */
const NEAR_DUPLICATE = 0.03
const SHOWN = 20

/** `partial`: how many half-transparent pixels the picture had before it became pixel art (see `artOfImage`). */
export const lintArt = (art: PixelArt, rules: LintRules = {}, partial = 0): Array<Issue> => {
  const issues: Array<Issue> = []
  const { width, height, indices } = art
  const xy = (i: number): readonly [number, number] => [i % width, Math.floor(i / width)]

  if (rules.sizes !== undefined && rules.sizes.length > 0 && !rules.sizes.some((size) => size.width === width && size.height === height)) {
    issues.push({
      rule: "size",
      severity: "error",
      message: `${width}×${height} is not an allowed size (${rules.sizes.map((size) => `${size.width}×${size.height}`).join(", ")})`,
      count: width * height,
      at: []
    })
  }

  const counts = new Map<number, number>()
  for (const index of indices) if (index !== TRANSPARENT) counts.set(index, (counts.get(index) ?? 0) + 1)
  const used = [...counts.keys()]

  if (rules.palette !== undefined && rules.palette.length > 0) {
    const allowed = new Set(rules.palette.map((color) => pack(color.r, color.g, color.b)))
    const off = new Set(used.filter((index) => {
      const color = art.palette[index]!
      return !allowed.has(pack(color.r, color.g, color.b))
    }))
    if (off.size > 0) {
      const cells: Array<number> = []
      indices.forEach((index, i) => {
        if (off.has(index)) cells.push(i)
      })
      issues.push({
        rule: "off-palette",
        severity: "error",
        message: `${off.size} color${off.size === 1 ? "" : "s"} outside the palette (${[...off].slice(0, 8).map((index) => toHex(art.palette[index]!)).join(", ")}${off.size > 8 ? ", …" : ""}) on ${cells.length} pixels`,
        count: cells.length,
        at: cells.slice(0, SHOWN).map(xy)
      })
    }
  }

  if (rules.maxColors !== undefined && used.length > rules.maxColors) {
    issues.push({
      rule: "too-many-colors",
      severity: "error",
      message: `${used.length} colors, more than the ${rules.maxColors} allowed`,
      count: used.length,
      at: []
    })
  }

  if (partial > 0) {
    issues.push({
      rule: "partial-alpha",
      severity: "error",
      message: `${partial} half-transparent pixel${partial === 1 ? "" : "s"}: pixel art is fully opaque or fully transparent`,
      count: partial,
      at: []
    })
  }

  if (rules.transparentBackground === true && width > 0 && height > 0) {
    const border: Array<number> = []
    for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x)
    for (let y = 1; y < height - 1; y++) border.push(y * width, y * width + width - 1)
    const opaque = border.filter((i) => indices[i] !== TRANSPARENT)
    // A sprite may touch its edges; a background left in fills the corners too.
    const corners = [0, width - 1, (height - 1) * width, height * width - 1].filter((i) => indices[i] !== TRANSPARENT).length
    if (corners >= 3 && opaque.length > border.length / 2) {
      issues.push({
        rule: "opaque-background",
        severity: "error",
        message: `${opaque.length} of ${border.length} border pixels are opaque: the background was not removed`,
        count: opaque.length,
        at: opaque.slice(0, SHOWN).map(xy)
      })
    }
  }

  // A stray pixel: none of its four neighbours shares its color, while five or more of its eight share another.
  const strays: Array<number> = []
  const at = (x: number, y: number): number | undefined => (x < 0 || y < 0 || x >= width || y >= height ? undefined : indices[y * width + x])
  const around = new Map<number, number>()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const self = indices[y * width + x]!
      if (self === TRANSPARENT) continue
      if (at(x - 1, y) === self || at(x + 1, y) === self || at(x, y - 1) === self || at(x, y + 1) === self) continue
      around.clear()
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const value = dx === 0 && dy === 0 ? undefined : at(x + dx, y + dy)
          if (value !== undefined && value !== self) around.set(value, (around.get(value) ?? 0) + 1)
        }
      }
      if ([...around.values()].some((count) => count >= 5)) strays.push(y * width + x)
    }
  }
  if (strays.length > 0) {
    issues.push({
      rule: "stray-pixel",
      severity: "warning",
      message: `${strays.length} lone pixel${strays.length === 1 ? "" : "s"} surrounded by another color: noise, unless it is a deliberate highlight`,
      count: strays.length,
      at: strays.slice(0, SHOWN).map(xy)
    })
  }

  const labs = used.map((index) => ({ index, lab: toOklab(art.palette[index]!) }))
  const pairs: Array<string> = []
  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) {
      const a = labs[i]!
      const b = labs[j]!
      if (Math.hypot(a.lab.l - b.lab.l, a.lab.a - b.lab.a, a.lab.b - b.lab.b) < NEAR_DUPLICATE) {
        pairs.push(`${toHex(art.palette[a.index]!)}/${toHex(art.palette[b.index]!)}`)
      }
    }
  }
  if (pairs.length > 0) {
    issues.push({
      rule: "near-duplicate-colors",
      severity: "warning",
      message: `${pairs.length} pair${pairs.length === 1 ? "" : "s"} of colors too close to tell apart (${pairs.slice(0, 6).join(", ")}${pairs.length > 6 ? ", …" : ""}): merge them`,
      count: pairs.length,
      at: []
    })
  }
  issues.push(...craftIssues([art]))
  return issues
}

// ---------------------------------------------------------------------------
// Craft

/** Flicker on lone pixels warns above this share of drawn pixels: a spark or two is a choice, a boil is many. */
export const SPECKS = 0.01

/**
 * The outline's color: the one most of the shape's edge pixels have (pixels
 * beside an empty one), when more than half of them have it. Its one-pixel
 * lines are judged on their own, since inside a filled shape a line is the
 * color, not the silhouette.
 */
const outlineOf = (frames: Frames): number | undefined => {
  const { width: w, height: h } = frames
  const counts = new Map<number, number>()
  let edge = 0
  for (const frame of frames.frames)
    for (let i = 0; i < frame.length; i++) {
      const v = frame[i]!
      if (v === 0) continue
      const x = i % w
      const y = (i - x) / w
      const empty = (xx: number, yy: number): boolean => xx < 0 || yy < 0 || xx >= w || yy >= h || frame[yy * w + xx] === 0
      if (!(empty(x - 1, y) || empty(x + 1, y) || empty(x, y - 1) || empty(x, y + 1))) continue
      counts.set(v, (counts.get(v) ?? 0) + 1)
      edge++
    }
  const [color, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [0, 0]
  return edge > 0 && count / edge > 0.5 ? color : undefined
}

/**
 * The craft rules on pictures that share one canvas: one picture, or an
 * animation's frames in the order they are drawn on the sheet. Jaggies and
 * holes are read on the silhouette, doubles on the silhouette and on the
 * outline's own color. With `play` (the frames in the order they play, as
 * indices into `arts`), flicker on lone pixels too. Spots carry their frame,
 * from 1, when there is more than one picture.
 */
export const craftIssues = (arts: ReadonlyArray<PixelArt>, play?: { readonly order: ReadonlyArray<number> }, animation?: string): Array<Issue> => {
  if (arts.length === 0) return []
  const frames = framesOfArt(arts, true)
  const named = animation === undefined ? "" : `${animation}: `
  const many = arts.length > 1
  const where = (spots: ReadonlyArray<Spot>): Issue["at"] => spots.slice(0, SHOWN).map((spot) => (many ? [spot.x, spot.y, spot.frame + 1] : [spot.x, spot.y]))
  const on = (spots: ReadonlyArray<Spot>): string => {
    if (!many) return ""
    const numbers = [...new Set(spots.map((spot) => spot.frame + 1))].sort((a, b) => a - b)
    return ` on frame${numbers.length === 1 ? "" : "s"} ${numbers.join(", ")}`
  }
  const issues: Array<Issue> = []
  const spotted = (rule: Issue["rule"], spots: ReadonlyArray<Spot>, message: string): void => {
    if (spots.length < CRAFT_SPOTS) return
    issues.push({ rule, severity: "warning", message: `${named}${spots.length} ${message.replace("{on}", on(spots))}`, count: spots.length, at: where(spots), ...(animation === undefined ? {} : { animation }) })
  }
  spotted("jaggies", jaggies(frames), "uneven steps along the outline{on} (a run of 1 between runs of 3, or 3 between 1s): the curve looks broken; make the steps grow or shrink steadily")
  const outline = outlineOf(frames)
  const lines = outline === undefined ? [] : doubles({ ...frames, frames: frames.frames.map((frame) => frame.map((v) => (v === outline ? 1 : 0))) })
  const seen = new Set<string>()
  const thick = [...doubles(frames), ...lines].filter((spot) => {
    const key = `${spot.frame}:${spot.x}:${spot.y}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  spotted("doubles", thick, "corner pixels thicken one-pixel lines into an L{on}: take out the corner pixel, so the line steps diagonally")
  spotted("holes", holes(frames), "single empty pixels inside the shape{on}: pinholes, often left by a background removal or two outlines a pixel apart; fill them")
  if (play !== undefined && play.order.length >= 3) {
    const played = { ...frames, frames: play.order.map((i) => frames.frames[i]!) }
    const found = specks(played)
    const n = play.order.length
    // Playing there and back, the frame at each end sits between two showings of one frame: a change there is the turn, not a blink.
    const kept = found.spots.filter((spot) => play.order[(spot.frame - 1 + n) % n] !== play.order[(spot.frame + 1) % n])
    const share = found.spots.length === 0 ? 0 : (found.share * kept.length) / found.spots.length
    if (share > SPECKS) {
      const spots = kept.map((spot) => ({ ...spot, frame: play.order[spot.frame]! }))
      spotted("flicker", spots, `lone pixels change for one frame and change back{on} (${Math.round(share * 1000) / 10}% of the drawn pixels): in motion the body boils; hold still parts on the same pixels every frame`)
    }
  }
  return issues
}

// ---------------------------------------------------------------------------
// Motion

/** The numbers `motionIssues` judges, for the report: what the agent and the game read. */
export interface MotionReport {
  /** The body's pixels on each frame, in play order. */
  readonly area: ReadonlyArray<number>
  /** How far the foot on the ground moves on each step, in play order (null: no foot stays down across the step). */
  readonly steps: ReadonlyArray<number | null>
  /** The usual step of the foot on the ground, and the speed the game moves the sprite at to keep it planted (the opposite way: a foot drawn moving back means walking forward). */
  readonly ground?: { readonly pixelsPerFrame: number; readonly pixelsPerSecond: number }
}

const signed = (value: number): string => (value > 0 ? `+${value}` : `${value}`)

/**
 * An animation's motion, judged: frames on one canvas (as a sheet writes
 * them), in sheet order; `loop` says how they play.
 */
export const motionIssues = (arts: ReadonlyArray<PixelArt>, loop: Loop, fps: number, animation: string): { readonly issues: Array<Issue>; readonly motion: MotionReport } => {
  const order = playOrder(arts.length, loop)
  const motion: Motion = motionOf(order.map((i) => arts[i]!), true)
  const issues: Array<Issue> = []
  const base = { severity: "warning" as const, at: [], animation }
  if (motion.areaOff.length > 0) {
    const frames = [...new Set(motion.areaOff.map((i) => order[i]! + 1))].sort((a, b) => a - b)
    issues.push({
      ...base,
      rule: "area",
      count: frames.length,
      message: `${animation}: frame${frames.length === 1 ? "" : "s"} ${frames.join(", ")} change the body's size by up to ${Math.round(motion.areaChange * 100)}% (areas ${motion.area.join(", ")} in play order): the body keeps its area, so a squash widens as it flattens; accept it when the change is the action (a burst, something growing)`
    })
  }
  if (motion.skates && motion.groundStep !== undefined) {
    issues.push({
      ...base,
      rule: "skate",
      count: motion.steps.length,
      message: `${animation}: the foot on the ground moves ${motion.steps.map((step) => (step === null ? "–" : `${signed(step)}`)).join(", ")} px on each step (– where no foot stays down), against a usual ${signed(motion.groundStep)}: it slides where a step differs; move the planted foot by the same step every frame`
    })
  }
  if (jumpsAtSeam(motion) && motion.seam !== undefined) {
    issues.push({
      ...base,
      rule: "seam",
      count: 1,
      message: `${animation}: ${Math.round(motion.seam.last * 100)}% of its pixels change from the last frame back to the first, against ${Math.round(motion.seam.mean * 100)}% on other steps: the loop jumps there; draw the last frame leading into the first (or play it once, if it does not loop)`
    })
  }
  const ground =
    motion.groundStep === undefined ? undefined : { pixelsPerFrame: motion.groundStep, pixelsPerSecond: Math.round(-motion.groundStep * fps * 100) / 100 }
  return { issues, motion: { area: motion.area, steps: motion.steps, ...(ground === undefined ? {} : { ground }) } }
}

// ---------------------------------------------------------------------------
// Accepted warnings

/**
 * Sets apart the warnings judged deliberate: `accept` maps a rule to why
 * (`{"doubles": "the antenna is two pixels thick on purpose"}`). Errors are
 * never accepted.
 */
export const acceptIssues = (
  issues: ReadonlyArray<Issue>,
  accept: Readonly<Record<string, string>> | undefined
): { readonly issues: Array<Issue>; readonly accepted: Array<Issue & { readonly why: string }> } => {
  const why = (issue: Issue): string | undefined => (issue.severity === "warning" ? accept?.[issue.rule] : undefined)
  return {
    issues: issues.filter((issue) => why(issue) === undefined),
    accepted: issues.flatMap((issue) => {
      const reason = why(issue)
      return reason === undefined ? [] : [{ ...issue, why: reason }]
    })
  }
}
