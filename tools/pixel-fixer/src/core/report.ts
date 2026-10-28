/**
 * What `check` says about a picture, for agents first: is it clean pixel
 * art, can it be fixed with confidence, or does a person need to look?
 *
 * The grid is judged twice, independently: by detection's own confidence,
 * and by the fit (scaling the fixed pixels back up over the source, how much
 * of the middle of each cell really is one color). A wrong grid can fool one
 * measure; it rarely fools both, and when either is low the answer is
 * "needs-person", never a confident bad fix.
 */
import type { AnimationOutcome } from "./animation.ts"
import { pack, toHex, toOklab, unpack, type Lab } from "./color.ts"
import { medianColor, usedColors, type CellSamples, type PixelArt } from "./fix.ts"
import type { GridSpec, RgbaImage } from "./grid.ts"
import { lintArt, type Issue, type LintRules } from "./lint.ts"
import { runRecipe, type Outcome } from "./pipeline.ts"
import type { Recipe } from "./recipe.ts"
import { sheetArt } from "./spritesheet.ts"
import { artOfImage } from "./sprite.ts"

export type Verdict = "clean" | "fixable" | "needs-person"

export interface Report {
  readonly verdict: Verdict
  /** One sentence for whoever reads the report. */
  readonly summary: string
  /** "pixel-art": one pixel per pixel already; "upscaled": fake pixels, each many source pixels; "animation": a sheet of frames. */
  readonly kind: "pixel-art" | "upscaled" | "animation"
  readonly source: { readonly width: number; readonly height: number }
  readonly grid?: {
    readonly cellWidth: number
    readonly cellHeight: number
    readonly offsetX: number
    readonly offsetY: number
    /** Detection's own confidence, 0 to 1 (absent when the grid was given). */
    readonly confidence?: number
    /** How much of the middle of each cell is one color, 0 to 1. */
    readonly fit: number
  }
  /** The output's size is one frame's; `colors` counts every frame's. */
  readonly output: { readonly width: number; readonly height: number; readonly colors: number }
  /** For an animation sheet: its frames, where they are in the source, and how sure each frame's own grid was. */
  readonly animation?: {
    readonly frames: number
    readonly included: number
    readonly fps: number
    readonly loop: string
    readonly anchor: string
    readonly boxes: ReadonlyArray<{
      readonly frame: number
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
      readonly include: boolean
      /** The cell size this frame alone looks drawn at, and how sure that is. */
      readonly cell?: number
      readonly confidence?: number
    }>
  }
  readonly palette?: {
    readonly name: string
    /** Colors the palette has no match for, with what they became. */
    readonly lost: ReadonlyArray<{ readonly color: string; readonly became: string; readonly pixels: number }>
  }
  readonly issues: ReadonlyArray<Issue>
}

/** Thresholds for a confident fix. */
export const CONFIDENT = { confidence: 0.5, fit: 0.9 } as const

/** Two colors this close (OKLab) count as the same when measuring the fit. */
const FIT_DISTANCE = 0.06

/** How much of the middle of each cell (the pixels read) is close to the cell's own color: 1 when every cell is flat. */
export const gridFit = (samples: CellSamples): number => {
  const labs = new Map<number, Lab>()
  const lab = (packed: number): Lab => {
    let value = labs.get(packed)
    if (value === undefined) {
      value = toOklab(unpack(packed))
      labs.set(packed, value)
    }
    return value
  }
  let near = 0
  let total = 0
  for (const cell of samples.cells) {
    if (cell.colors.length === 0) continue
    const median = medianColor(cell.colors)
    const center = lab(pack(median.r, median.g, median.b))
    for (const color of cell.colors) {
      const own = lab(color)
      if (Math.hypot(own.l - center.l, own.a - center.a, own.b - center.b) <= FIT_DISTANCE) near++
      total++
    }
  }
  return total === 0 ? 1 : near / total
}

const round = (value: number, places = 3): number => Math.round(value * 10 ** places) / 10 ** places

/** Pixel art at its own size has few colors; a blurry or upscaled-and-smoothed picture has many. */
const FEW_COLORS = 256

/**
 * True when a picture is already pixel art at its own size: no grid of fake
 * pixels found in it, or only an unsure one in a picture with few colors (a
 * small sprite's own shapes can look like a grid).
 */
const isNative = (image: RgbaImage, outcome: Outcome | undefined): boolean => {
  if (outcome === undefined) return true
  const { spec, detection } = outcome
  if (Math.min(spec.cellWidth, spec.cellHeight) < 1.5) return true
  if (detection !== undefined && detection.confidence < 0.3) return true
  const sure = (detection === undefined || detection.confidence >= CONFIDENT.confidence) && gridFit(outcome.samples) >= CONFIDENT.fit
  return !sure && artOfImage(image).art.palette.length <= FEW_COLORS
}

const errors = (issues: ReadonlyArray<Issue>): number => issues.filter((issue) => issue.severity === "error").length

export interface Checked {
  readonly report: Report
  /** The recipe with its grid resolved (found, or one pixel per pixel for pixel art): what a fix runs and saves. */
  readonly recipe: Recipe
  /** The fix, unless no grid was found. */
  readonly outcome: Outcome | undefined
}

/**
 * Checks a picture. With a recipe whose grid is "auto" (the default), a
 * picture without a grid of fake pixels is taken as pixel art at its own
 * size and only linted; otherwise it is fixed with the recipe, and the fix
 * is judged.
 */
export const checkImage = (image: RgbaImage, recipe: Recipe, rules: LintRules = {}): Checked => {
  const found = runRecipe(image, recipe)
  if (recipe.grid.kind === "auto" && isNative(image, found)) {
    // Fixing pixel art at its own size reads one pixel per cell.
    const resolved: Recipe = { ...recipe, grid: { kind: "cells", spec: { cellWidth: 1, cellHeight: 1, offsetX: 0, offsetY: 0 } }, sample: { ...recipe.sample, inset: 0 } }
    const { art, partial } = artOfImage(image, recipe.sample.alphaThreshold)
    return {
      recipe: resolved,
      outcome: runRecipe(image, resolved),
      report: reportOfArt(art, { ...rules, palette: rules.palette ?? recipe.palette?.colors }, partial, image)
    }
  }
  if (found === undefined) {
    return {
      recipe,
      outcome: undefined,
      report: {
        verdict: "needs-person",
        summary: "No grid found and the picture is not pixel art at its own size: set the grid by hand.",
        kind: "upscaled",
        source: { width: image.width, height: image.height },
        output: { width: 0, height: 0, colors: 0 },
        issues: []
      }
    }
  }
  const resolved: Recipe = { ...recipe, grid: { kind: "cells", spec: found.spec } }
  return { recipe: resolved, outcome: found, report: reportOfFix(image, recipe, found, rules) }
}

/**
 * The report on pixel art at its own size (a picture, a sprite source, or a
 * fix of either): clean, or fixable when it breaks rules.
 */
export const reportOfArt = (
  art: PixelArt,
  rules: LintRules = {},
  partial = 0,
  source: { readonly width: number; readonly height: number } = art
): Report => {
  const issues = lintArt(art, rules, partial)
  const count = errors(issues)
  const colors = usedColors(art).length
  return {
    verdict: count === 0 ? "clean" : "fixable",
    summary:
      count === 0
        ? `Clean pixel art, ${art.width}×${art.height}, ${colors} colors.`
        : `Pixel art at its own size, ${art.width}×${art.height}, with ${count} rule${count === 1 ? "" : "s"} broken: see issues.`,
    kind: "pixel-art",
    source: { width: source.width, height: source.height },
    output: { width: art.width, height: art.height, colors },
    issues
  }
}

/** The report on a fix that has run. */
export const reportOfFix = (image: RgbaImage, recipe: Recipe, outcome: Outcome, rules: LintRules = {}): Report => {
  const fit = gridFit(outcome.samples)
  const confidence = outcome.detection?.confidence
  const issues = lintArt(outcome.exported, { ...rules, palette: rules.palette ?? recipe.palette?.colors })
  const spec: GridSpec = outcome.spec
  // A grid given by hand or by size is trusted as given; only the fit can doubt it.
  const sure = (confidence === undefined || confidence >= CONFIDENT.confidence) && fit >= CONFIDENT.fit
  // Pixelating a picture that is not pixel art has no true grid to fit.
  const pixelating = recipe.grid.kind === "size"
  const verdict: Verdict = sure || pixelating ? (errors(issues) === 0 ? "fixable" : "needs-person") : "needs-person"
  const colors = usedColors(outcome.exported).length
  const size = `${outcome.exported.width}×${outcome.exported.height}`
  const summary = pixelating
    ? `Pixelated to ${size}, ${colors} colors.${errors(issues) > 0 ? " Some rules are still broken: see issues." : " Look at the preview: whether it reads well is a judgement call."}`
    : verdict === "fixable"
      ? `Upscaled pixel art: fixes to ${size}, ${colors} colors (grid fit ${Math.round(fit * 100)}%${confidence === undefined ? "" : `, confidence ${Math.round(confidence * 100)}%`}).`
      : sure
        ? `Fixes to ${size}, but rules are still broken after fixing: see issues.`
        : `Unsure of the grid (fit ${Math.round(fit * 100)}%${confidence === undefined ? "" : `, confidence ${Math.round(confidence * 100)}%`}): look at the preview, or set the grid by hand.`
  return {
    verdict,
    summary,
    kind: "upscaled",
    source: { width: image.width, height: image.height },
    grid: {
      cellWidth: round(spec.cellWidth),
      cellHeight: round(spec.cellHeight),
      offsetX: round(spec.offsetX, 2),
      offsetY: round(spec.offsetY, 2),
      ...(confidence === undefined ? {} : { confidence: round(confidence) }),
      fit: round(fit)
    },
    output: { width: outcome.exported.width, height: outcome.exported.height, colors },
    ...(recipe.palette === undefined
      ? {}
      : {
          palette: {
            name: recipe.palette.name,
            lost: outcome.lost.map((entry) => ({ color: toHex(entry.color), became: toHex(entry.became), pixels: entry.cells.length }))
          }
        }),
    issues
  }
}

const rank: Record<Verdict, number> = { clean: 2, fixable: 1, "needs-person": 0 }

/**
 * Which of two reports describes the better asset: the better verdict, then
 * fewer broken rules, then fewer warnings, then the better grid fit.
 */
export const compareReports = (a: Report, b: Report): { readonly better: "a" | "b" | "same"; readonly reason: string } => {
  if (rank[a.verdict] !== rank[b.verdict]) {
    const better = rank[a.verdict] > rank[b.verdict] ? "a" : "b"
    return { better, reason: `${better} is ${better === "a" ? a.verdict : b.verdict}, the other ${better === "a" ? b.verdict : a.verdict}` }
  }
  const count = (report: Report, severity: Issue["severity"]): number =>
    report.issues.filter((issue) => issue.severity === severity).reduce((sum, issue) => sum + Math.max(1, issue.count), 0)
  for (const severity of ["error", "warning"] as const) {
    const left = count(a, severity)
    const right = count(b, severity)
    if (left !== right) return { better: left < right ? "a" : "b", reason: `${left < right ? "a" : "b"} has fewer ${severity}s (${Math.min(left, right)} against ${Math.max(left, right)})` }
  }
  const fitA = a.grid?.fit ?? 1
  const fitB = b.grid?.fit ?? 1
  if (Math.abs(fitA - fitB) > 0.01) return { better: fitA > fitB ? "a" : "b", reason: `${fitA > fitB ? "a" : "b"} has the better grid fit` }
  return { better: "same", reason: "both are equally clean" }
}

/** A frame whose own cell size is this far (a share) from the shared one looks drawn at another size. */
const OTHER_SCALE = 0.05

/**
 * The report on an animation sheet that has run: how sure the shared grid
 * is, each frame's box, and the project's rules on the frames. "needs-person"
 * when the grid is unsure or a frame came out empty.
 */
export const reportOfSheet = (image: RgbaImage, recipe: Recipe, outcome: AnimationOutcome, rules: LintRules = {}): Report => {
  const sheet = recipe.sheet
  const placed = outcome.placed.map((frame) => frame.art)
  const strip = sheetArt(placed, { columns: placed.length, spacing: 1 })
  const issues: Array<Issue> = lintArt(strip, { ...rules, sizes: undefined, palette: rules.palette ?? recipe.palette?.colors }).filter(
    // Sparks and dust around a body are single pixels on purpose: stray pixels are judged on single pictures only.
    (issue) => issue.rule !== "stray-pixel"
  )
  const first = placed[0]
  if (first !== undefined && rules.sizes !== undefined && rules.sizes.length > 0) {
    issues.unshift(...lintArt(first, { sizes: rules.sizes }).filter((issue) => issue.rule === "size"))
  }
  if (outcome.placed.length < 2) {
    issues.push({ rule: "one-frame", severity: "warning", message: `${outcome.placed.length} frame${outcome.placed.length === 1 ? "" : "s"} in the animation: check the frames found, or add boxes by hand`, count: 0, at: [] })
  }
  const empty = outcome.frames.filter((frame) => sheet?.frames[frame.index]?.include === true && !frame.art.indices.some((index) => index >= 0))
  for (const frame of empty) {
    issues.push({ rule: "empty-frame", severity: "error", message: `Frame ${frame.index + 1} has nothing in it: move its box onto the art, or leave it out`, count: 0, at: [] })
  }
  const size = (outcome.cell.width + outcome.cell.height) / 2
  for (const frame of outcome.frames) {
    const own = frame.detection
    if (own === undefined || own.confidence < CONFIDENT.confidence) continue
    const cell = (own.spec.cellWidth + own.spec.cellHeight) / 2
    if (Math.abs(cell - size) > OTHER_SCALE * size) {
      issues.push({
        rule: "frame-scale",
        severity: "warning",
        message: `Frame ${frame.index + 1} looks drawn at another size (${round(cell)} px cells, against ${round(size)} for the animation): it is read at the animation's size`,
        count: 0,
        at: []
      })
    }
  }
  const confidence = outcome.confidence
  const sure = confidence === undefined || confidence >= CONFIDENT.confidence
  const verdict: Verdict = sure && errors(issues) === 0 ? "fixable" : "needs-person"
  const colors = usedColors(strip).length
  const count = outcome.placed.length
  const frameSize = `${outcome.width}×${outcome.height}`
  const summary =
    verdict === "fixable"
      ? `Animation of ${count} frame${count === 1 ? "" : "s"}, ${frameSize} each, ${colors} colors (cells ${round(size)} px${confidence === undefined ? "" : `, confidence ${Math.round(confidence * 100)}%`}).`
      : !sure
        ? `Unsure of the grid (confidence ${Math.round((confidence ?? 0) * 100)}%): look at the preview, or set the cell size by hand.`
        : `Animation of ${count} frames, but rules are still broken: see issues.`
  return {
    verdict,
    summary,
    kind: "animation",
    source: { width: image.width, height: image.height },
    grid: {
      cellWidth: round(outcome.cell.width),
      cellHeight: round(outcome.cell.height),
      offsetX: 0,
      offsetY: 0,
      ...(confidence === undefined ? {} : { confidence: round(confidence) }),
      fit: round(outcome.frames.length === 0 ? 0 : outcome.frames.reduce((sum, frame) => sum + gridFit(frame.outcome.samples), 0) / outcome.frames.length)
    },
    output: { width: outcome.width, height: outcome.height, colors },
    animation: {
      frames: outcome.frames.length,
      included: count,
      fps: sheet?.fps ?? 0,
      loop: sheet?.loop ?? "forward",
      anchor: sheet?.anchor ?? "feet",
      boxes: outcome.frames.map((frame) => ({
        frame: frame.index + 1,
        ...frame.box,
        include: sheet?.frames[frame.index]?.include ?? true,
        ...(frame.detection === undefined ? {} : { cell: round((frame.detection.spec.cellWidth + frame.detection.spec.cellHeight) / 2), confidence: round(frame.detection.confidence) })
      }))
    },
    ...(recipe.palette === undefined
      ? {}
      : {
          palette: {
            name: recipe.palette.name,
            lost: outcome.lost.map((entry) => ({ color: toHex(entry.color), became: toHex(entry.became), pixels: entry.cells.length }))
          }
        }),
    issues
  }
}
