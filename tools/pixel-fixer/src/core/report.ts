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
import { pack, toHex, toOklab, unpack, type Lab } from "./color.ts"
import { medianColor, usedColors, type CellSamples, type PixelArt } from "./fix.ts"
import type { GridSpec, RgbaImage } from "./grid.ts"
import { lintArt, type Issue, type LintRules } from "./lint.ts"
import { runRecipe, type Outcome } from "./pipeline.ts"
import type { Recipe } from "./recipe.ts"
import { artOfImage } from "./sprite.ts"

export type Verdict = "clean" | "fixable" | "needs-person"

export interface Report {
  readonly verdict: Verdict
  /** One sentence for whoever reads the report. */
  readonly summary: string
  /** "pixel-art": one pixel per pixel already; "upscaled": fake pixels, each many source pixels. */
  readonly kind: "pixel-art" | "upscaled"
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
  readonly output: { readonly width: number; readonly height: number; readonly colors: number }
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
  const issues = lintArt(outcome.art, { ...rules, palette: rules.palette ?? recipe.palette?.colors })
  const spec: GridSpec = outcome.spec
  // A grid given by hand or by size is trusted as given; only the fit can doubt it.
  const sure = (confidence === undefined || confidence >= CONFIDENT.confidence) && fit >= CONFIDENT.fit
  // Pixelating a picture that is not pixel art has no true grid to fit.
  const pixelating = recipe.grid.kind === "size"
  const verdict: Verdict = sure || pixelating ? (errors(issues) === 0 ? "fixable" : "needs-person") : "needs-person"
  const colors = usedColors(outcome.art).length
  const size = `${outcome.art.width}×${outcome.art.height}`
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
    output: { width: outcome.art.width, height: outcome.art.height, colors },
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
