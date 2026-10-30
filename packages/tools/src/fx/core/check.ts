/**
 * Measuring a draft's frames for what an agent cannot see by reading its
 * code: where it is cut off, whether it ends or loops cleanly, whether its
 * pixels form shapes or noise, whether it draws the same frames every time,
 * the pixel art craft rules (`craft.ts`), and the project's own rules
 * (`pixel.config.json`, shared with its sprites).
 */
import { pack, parseHex, toHex, toOklab, type Rgb } from "../../pixel/core/color.ts"
import { doubles, faintOn, flicker, holes, jaggies, SHOWN, type Spot } from "./craft.ts"
import { runEffect, type Effect, type Palette, type RunOptions, type Run } from "./effect.ts"

/** The project's pixel art rules that apply to effects: its palette and how many colors one piece of art may use. */
export interface Rules {
  readonly palette?: ReadonlyArray<Rgb> | undefined
  readonly maxColors?: number | undefined
}

/** What a draft is checked against beyond its own frames. */
export interface Context {
  readonly rules?: Rules | undefined
  /** The game's backgrounds by name (`#rrggbb`), to check the effect shows on each. */
  readonly backdrops?: Readonly<Record<string, string>> | undefined
}

/** A craft rule warns from this many spots in a draft: one or two can be a deliberate corner or notch. */
export const CRAFT_SPOTS = 3
/** Flicker warns above this share of drawn pixels: a shimmer is a few, a boil is many. */
export const FLICKER = 0.06
/** Contrast warns when more than this share of drawn pixels barely differ from a background. */
export const FAINT_SHARE = 0.5
/** Seeds a draft is also drawn with, to see how far it can reach: particles one seed keeps inside, another throws past the edge. */
export const OTHER_SEEDS: ReadonlyArray<number> = [2, 3, 7]

export interface Measures {
  readonly frames: number
  readonly fps: number
  readonly loop: boolean
  /** How long one play lasts, in milliseconds. */
  readonly duration: number
  /** Every pixel any frame draws, as one box. */
  readonly bounds: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | undefined
  /** The most of the canvas one frame covers, from 0 to 1, and which frame. */
  readonly peak: { readonly cover: number; readonly frame: number }
  readonly colors: ReadonlyArray<string>
}

export interface Issue {
  readonly level: "error" | "warning"
  readonly code: string
  readonly message: string
  /** Where it happens: some of the pixels, each on its frame (look at them with `fx look --marks <code>`). */
  readonly at?: ReadonlyArray<Spot> | undefined
}

const lit = (frame: Uint8Array): number => frame.reduce((sum, v) => sum + (v > 0 ? 1 : 0), 0)

export const measure = (run: Run, palette: Palette): Measures => {
  const names = Object.keys(palette)
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  let peak = { cover: 0, frame: 0 }
  const used = new Set<number>()
  run.frames.forEach((frame, f) => {
    let count = 0
    for (let i = 0; i < frame.length; i++) {
      const v = frame[i]!
      if (v === 0) continue
      count++
      used.add(v)
      const x = i % run.width
      const y = Math.floor(i / run.width)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    const cover = count / frame.length
    if (cover > peak.cover) peak = { cover: Math.round(cover * 1000) / 1000, frame: f }
  })
  return {
    frames: run.frames.length,
    fps: run.fps,
    loop: run.loop,
    duration: Math.round((run.frames.length / run.fps) * 1000),
    bounds: maxX < 0 ? undefined : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    peak,
    colors: [...used].sort((a, b) => a - b).map((v) => names[v - 1]!)
  }
}

/** Pixels that differ between two frames, as a share of the canvas. */
const difference = (a: Uint8Array, b: Uint8Array): number => {
  let count = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++
  return count / a.length
}

/** The share of lit pixels with no lit neighbour, over every frame. */
const loneShare = (run: Run): number => {
  let lone = 0
  let all = 0
  for (const frame of run.frames) {
    for (let i = 0; i < frame.length; i++) {
      if (frame[i] === 0) continue
      all++
      const x = i % run.width
      const y = Math.floor(i / run.width)
      let neighbours = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && ny >= 0 && nx < run.width && ny < run.height && frame[ny * run.width + nx]! > 0) neighbours++
        }
      if (neighbours === 0) lone++
    }
  }
  return all === 0 ? 0 : lone / all
}

const spans = (frames: ReadonlyArray<number>): string => {
  const parts: Array<string> = []
  let start = frames[0]
  let last = frames[0]
  for (const f of [...frames.slice(1), undefined]) {
    if (f !== undefined && last !== undefined && f === last + 1) {
      last = f
      continue
    }
    if (start !== undefined) parts.push(start === last ? `${start}` : `${start}-${last}`)
    start = f
    last = f
  }
  return parts.join(", ")
}

const framesOf = (spots: ReadonlyArray<Spot>): string => spans([...new Set(spots.map((spot) => spot.frame))].sort((a, b) => a - b))

/** The craft rules on a run, each with where it breaks. */
export const craftIssues = (run: Run, palette: Palette, context: Context = {}): Array<Issue> => {
  const issues: Array<Issue> = []
  const spotted = (code: string, spots: ReadonlyArray<Spot>, message: (frames: string) => string): void => {
    if (spots.length >= CRAFT_SPOTS) issues.push({ level: "warning", code, message: message(framesOf(spots)), at: spots.slice(0, SHOWN) })
  }
  spotted("jaggies", jaggies(run), (frames) => `uneven steps along edges on frames ${frames} (a run of 1 between runs of 3, or 3 between 1s): the curve looks broken; make the steps grow or shrink steadily`)
  spotted("doubles", doubles(run), (frames) => `one-pixel lines thickened into an L at corners on frames ${frames}: take out the corner pixel (fx.ring and fx.line never make one)`)
  spotted("holes", holes(run), (frames) => `single empty pixels inside shapes on frames ${frames}: pinholes, often from two outlines a pixel apart; fill them (fx.ring takes a width)`)
  const flickering = flicker(run)
  if (flickering.share > FLICKER)
    issues.push({
      level: "warning",
      code: "flicker",
      message: `${Math.round(flickering.share * 100)}% of pixels change for one frame and change back (frames ${framesOf(flickering.spots)}): in motion it boils; round positions the same way every frame, or move in whole steps`,
      at: flickering.spots.slice(0, SHOWN)
    })
  for (const faint of faintOn(run, palette, context.backdrops ?? {}))
    if (faint.share > FAINT_SHARE)
      issues.push({
        level: "warning",
        code: "contrast",
        message: `on the ${faint.name} background (${faint.hex}), ${Math.round(faint.share * 100)}% of its pixels barely differ from it: it will not read there; add a darker or lighter edge`
      })
  const max = context.rules?.maxColors
  if (max !== undefined) {
    const used = new Set<number>()
    for (const frame of run.frames) for (const v of frame) if (v > 0) used.add(v)
    if (used.size > max) issues.push({ level: "error", code: "too-many-colors", message: `${used.size} colors, more than the ${max} pixel.config.json allows` })
  }
  return issues
}

/** Colors closer than this (OKLab) look the same: in pixel art they are noise. */
const NEAR_DUPLICATE = 0.03

/** The bank's palette against the project's rules: colors outside the project palette, and pairs too close to tell apart. */
export const paletteIssues = (palette: Palette, rules: Rules = {}): Array<Issue> => {
  const issues: Array<Issue> = []
  const colors = Object.entries(palette).map(([name, hex]) => ({ name, rgb: parseHex(hex) ?? { r: 0, g: 0, b: 0 } }))
  if (rules.palette !== undefined && rules.palette.length > 0) {
    const allowed = new Set(rules.palette.map((color) => pack(color.r, color.g, color.b)))
    const off = colors.filter((color) => !allowed.has(pack(color.rgb.r, color.rgb.g, color.rgb.b)))
    if (off.length > 0)
      issues.push({
        level: "error",
        code: "off-palette",
        message: `${off.map((color) => `${color.name} (${toHex(color.rgb)})`).join(", ")} ${off.length === 1 ? "is" : "are"} not in the project palette (pixel.config.json): effects and sprites share one palette; use its colors`
      })
  }
  const pairs: Array<string> = []
  for (let i = 0; i < colors.length; i++)
    for (let j = i + 1; j < colors.length; j++) {
      const a = toOklab(colors[i]!.rgb)
      const b = toOklab(colors[j]!.rgb)
      if (Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b) < NEAR_DUPLICATE) pairs.push(`${colors[i]!.name}/${colors[j]!.name}`)
    }
  if (pairs.length > 0) issues.push({ level: "warning", code: "near-duplicate-colors", message: `colors too close to tell apart: ${pairs.join(", ")}; merge them` })
  return issues
}

/** What breaks the rules in a run: errors to fix before showing it, warnings to weigh. */
export const issuesOf = (run: Run, again?: Run, palette: Palette = {}, context: Context = {}): Array<Issue> => {
  const issues: Array<Issue> = []
  for (const error of run.errors) issues.push({ level: "error", code: "draw", message: error })
  const counts = run.frames.map(lit)
  if (counts.every((count) => count === 0)) {
    issues.push({ level: "error", code: "blank", message: "every frame is empty: draw something, inside the canvas" })
    return issues
  }
  if (again !== undefined && run.frames.some((frame, f) => difference(frame, again.frames[f]!) > 0))
    issues.push({ level: "error", code: "random", message: "a second run draws other pixels: use fx.random() (it repeats per frame), never Math.random() or the time" })
  const cut = run.clipped.flatMap((count, f) => (count > 0 ? [f] : []))
  if (cut.length > 0)
    issues.push({ level: "warning", code: "clipped", message: `drawn past the canvas edge on frames ${spans(cut)}: the effect is cut off there; make size bigger or keep it inside` })
  const empty = counts.flatMap((count, f) => (count === 0 ? [f] : []))
  const first = counts.findIndex((count) => count > 0)
  const lastLit = counts.length - 1 - [...counts].reverse().findIndex((count) => count > 0)
  const gaps = empty.filter((f) => f > first && f < lastLit)
  if (gaps.length > 0) issues.push({ level: "warning", code: "gap", message: `empty frames ${spans(gaps)} in the middle: the effect blinks off` })
  if (!run.loop) {
    if (first > 0) issues.push({ level: "warning", code: "late", message: `nothing until frame ${first}: a one-shot should show on its first frame, so it lands with what caused it` })
    if (counts[counts.length - 1]! > 0)
      issues.push({ level: "warning", code: "no-end", message: "the last frame is not empty: a one-shot that stops while drawn pops off; fade or shrink it to nothing" })
    const tail = counts.length - 1 - lastLit
    if (tail > 1)
      issues.push({ level: "warning", code: "tail", message: `the last ${tail} frames are empty (${lastLit + 1}-${counts.length - 1}): one empty frame ends it; drop the rest (frames: ${lastLit + 2}) or stretch the fade over them` })
  } else if (run.frames.length > 2) {
    const steps = run.frames.slice(1).map((frame, f) => difference(run.frames[f]!, frame))
    const mean = steps.reduce((sum, v) => sum + v, 0) / steps.length
    const seam = difference(run.frames[run.frames.length - 1]!, run.frames[0]!)
    if (seam > 0.02 && seam > mean * 2.5)
      issues.push({ level: "warning", code: "seam", message: `the loop jumps from its last frame back to its first (${Math.round(seam * 100)}% of pixels change, ${Math.round(mean * 100)}% on other frames): make it a function of fx.t that wraps` })
  }
  const lone = loneShare(run)
  if (lone > 0.35)
    issues.push({ level: "warning", code: "noise", message: `${Math.round(lone * 100)}% of pixels stand alone: at game size that reads as noise, not shapes; group them (2x2, short lines) or draw fewer` })
  const full = Math.max(...counts) / (run.width * run.height)
  if (full > 0.7) issues.push({ level: "warning", code: "full", message: `one frame covers ${Math.round(full * 100)}% of the canvas: it hides what it plays over` })
  issues.push(...craftIssues(run, palette, context))
  return issues
}

export interface Checked {
  readonly run: Run
  readonly measures: Measures
  /** What is still to fix or weigh. */
  readonly issues: ReadonlyArray<Issue>
  /** Warnings the draft accepts as deliberate, each with its reason. */
  readonly accepted: ReadonlyArray<Issue & { readonly why: string }>
}

/** Where a draft clipped on its own seed fits, another seed may not: the first of `OTHER_SEEDS` that draws past the edge. */
const reachIssue = (effect: Effect, palette: Palette, options: RunOptions, run: Run): Issue | undefined => {
  if (run.clipped.some((count) => count > 0)) return undefined
  for (const seed of OTHER_SEEDS) {
    if (seed === (options.seed ?? 1)) continue
    const cut = runEffect(effect, palette, { ...options, seed }).clipped.flatMap((count, f) => (count > 0 ? [f] : []))
    if (cut.length > 0)
      return {
        level: "warning",
        code: "clipped-seed",
        message: `with seed ${seed} it is drawn past the canvas edge on frames ${spans(cut)}: this seed keeps it inside by luck, and a new seed cuts it off; make size bigger, or limit how far particles reach`
      }
  }
  return undefined
}

/**
 * Runs a draft twice (the second to catch randomness that is not the seed's)
 * and with a few other seeds (to see how far it can reach), measures it, and
 * lists its issues; warnings in `accept` (code → why) are set apart. Errors
 * are never accepted.
 */
export const checkEffect = (effect: Effect, palette: Palette, options: RunOptions & { readonly accept?: Readonly<Record<string, string>> | undefined } = {}, context: Context = {}): Checked => {
  const run = runEffect(effect, palette, options)
  const again = runEffect(effect, palette, options)
  const reach = run.errors.length === 0 ? reachIssue(effect, palette, options, run) : undefined
  const all = [...issuesOf(run, again, palette, context), ...(reach === undefined ? [] : [reach])]
  const why = (issue: Issue): string | undefined => (issue.level === "warning" ? options.accept?.[issue.code] : undefined)
  return {
    run,
    measures: measure(run, palette),
    issues: all.filter((issue) => why(issue) === undefined),
    accepted: all.flatMap((issue) => {
      const reason = why(issue)
      return reason === undefined ? [] : [{ ...issue, why: reason }]
    })
  }
}
