/**
 * The whole fix, from a picture and a recipe to the fixed pixel art: the one
 * pipeline the web page and the CLI both run, so they always agree.
 *
 * Grid, then reading cells, snapping to the palette, thinning split
 * outlines, cleaning specks, shrinking, and removing the background, in
 * that order. A cache lets the
 * page rerun it on every slider move without detecting the grid again.
 *
 * The background is found in the cells' own colors, not the palette's: a
 * palette with no color close to the background snaps it to the nearest one
 * (often the outline), and a background found there would take the outline
 * with it.
 */
import { backgroundColors, clearMasked, findBackground } from "./background.ts"
import { cleanUp } from "./cleanup.ts"
import { applyEdits } from "./edits.ts"
import { cropToContent } from "./export.ts"
import type { Rgb } from "./color.ts"
import { quantize, sampleCells, type CellSamples, type PixelArt } from "./fix.ts"
import { detectGrid, gridSize, refineGrid, uniformGrid, type Detection, type Grid, type GridSpec, type RgbaImage } from "./grid.ts"
import { lostColors, type LostColor } from "./lost.ts"
import { hasOutlines, outlineMask, thinOutlines, type OutlineMask } from "./outline.ts"
import type { GridChoice, Recipe } from "./recipe.ts"
import { reduce } from "./reduce.ts"

/** Steps kept between runs: the grid and the cells read only change when their settings do. */
export interface PipelineCache {
  mask?: { readonly image: RgbaImage; readonly mask: OutlineMask }
  baseGrid?: { readonly image: RgbaImage; readonly key: string; readonly grid: Grid }
  samples?: { readonly grid: Grid; readonly key: string; readonly samples: CellSamples }
}

export interface Outcome {
  /** The grid's cell size and offset, as found or given. */
  readonly spec: GridSpec
  /** What auto-detection found, when the recipe asked for it. */
  readonly detection: Detection | undefined
  readonly grid: Grid
  /** Whether the outline handling ran: the recipe's "on", or "auto" finding one-pixel outlines. */
  readonly outlines: boolean
  readonly samples: CellSamples
  readonly art: PixelArt
  /** What is exported and checked: `art`, cropped to its subject when the recipe asks. */
  readonly exported: PixelArt
  /** Colors the palette has no match for (empty without a palette). */
  readonly lost: ReadonlyArray<LostColor>
  /** The specks cleaned, each as its cells. */
  readonly specks: ReadonlyArray<ReadonlyArray<number>>
  /** The background colors found, when removing the background. */
  readonly backgroundFound: ReadonlyArray<Rgb>
  /** The pixels painted by hand (row by row, in the fixed picture). */
  readonly painted: ReadonlyArray<number>
  /** The hand edits and kept specks were made at another size, so they were left out. */
  readonly editsStale: boolean
  readonly cleanKeepStale: boolean
}

/** The grid's cell size and offset for a choice; undefined when "auto" finds no grid. */
export const resolveGrid = (
  image: RgbaImage,
  choice: GridChoice
): { readonly spec: GridSpec; readonly detection: Detection | undefined } | undefined => {
  switch (choice.kind) {
    case "cells":
      return { spec: choice.spec, detection: undefined }
    case "size": {
      const width = Math.max(1, Math.round(choice.width))
      const height = Math.max(1, Math.round(choice.height ?? (image.height * width) / image.width))
      return { spec: { cellWidth: image.width / width, cellHeight: image.height / height, offsetX: 0, offsetY: 0 }, detection: undefined }
    }
    case "auto": {
      const detection = detectGrid(image)
      return detection === undefined ? undefined : { spec: detection.spec, detection }
    }
  }
}

/** The picture's outline pixels, and whether the recipe's outline handling applies to it with cells of this size. */
export const outlinesOf = (
  image: RgbaImage,
  spec: GridSpec,
  recipe: Recipe,
  cache: PipelineCache = {}
): { readonly mask: OutlineMask; readonly on: boolean } => {
  if (cache.mask?.image !== image) cache.mask = { image, mask: outlineMask(image) }
  const mask = cache.mask.mask
  const cell = (spec.cellWidth + spec.cellHeight) / 2
  // Pictures at their own size (one pixel per cell) have no strokes to split.
  if (recipe.outlines === "off" || cell < 2) return { mask, on: false }
  return { mask, on: recipe.outlines === "on" || hasOutlines(mask, cell) }
}

/**
 * The grid's cuts: uniform, then moved onto edges when following (with
 * outlines, kept off dark strokes), then the lines dragged by hand.
 */
export const buildGrid = (image: RgbaImage, spec: GridSpec, recipe: Recipe, cache: PipelineCache = {}, outlines?: OutlineMask): Grid => {
  const key = JSON.stringify([spec, recipe.follow, outlines !== undefined])
  if (cache.baseGrid?.image !== image || cache.baseGrid.key !== key) {
    let next = uniformGrid(image.width, image.height, spec)
    if (recipe.follow !== "off") next = refineGrid(image, next, { bend: recipe.follow === "bend", outlines })
    cache.baseGrid = { image, key, grid: next }
  }
  const base = cache.baseGrid.grid
  if (recipe.moved.length === 0) return base
  const xs = [...base.xs]
  const ys = [...base.ys]
  const bend = base.bend === undefined ? undefined : { xs: base.bend.xs.map((line) => [...line]), ys: base.bend.ys.map((line) => [...line]) }
  for (const [id, position] of recipe.moved) {
    const [axis, index] = id.split(":")
    const cuts = axis === "x" ? xs : ys
    const i = Number(index)
    if (i < 0 || i >= cuts.length) continue
    // A bent line dragged by hand moves as a whole.
    const line = bend === undefined ? undefined : (axis === "x" ? bend.xs : bend.ys)[i]
    if (line !== undefined) for (let j = 0; j < line.length; j++) line[j]! += position - cuts[i]!
    cuts[i] = position
  }
  return bend === undefined ? { xs, ys } : { xs, ys, bend }
}

/** Runs the recipe on a picture; undefined when the recipe asks for "auto" and the picture has no grid to find. */
export const runRecipe = (image: RgbaImage, recipe: Recipe, cache: PipelineCache = {}): Outcome | undefined => {
  const resolved = resolveGrid(image, recipe.grid)
  if (resolved === undefined) return undefined
  return runWithSpec(image, recipe, resolved.spec, resolved.detection, cache)
}

/** Runs the recipe with a grid already resolved: the page resolves it once, when a picture opens. */
export const runWithSpec = (
  image: RgbaImage,
  recipe: Recipe,
  spec: GridSpec,
  detection: Detection | undefined,
  cache: PipelineCache = {}
): Outcome => {
  const outlines = outlinesOf(image, spec, recipe, cache)
  const grid = buildGrid(image, spec, recipe, cache, outlines.on ? outlines.mask : undefined)
  const sampleKey = JSON.stringify(recipe.sample)
  if (cache.samples?.grid !== grid || cache.samples.key !== sampleKey) {
    cache.samples = { grid, key: sampleKey, samples: sampleCells(image, grid, recipe.sample) }
  }
  const samples = cache.samples.samples
  const palette = recipe.palette?.colors ?? []
  let art = quantize(samples, {
    palette,
    metric: recipe.metric,
    dither: recipe.dither,
    ditherStrength: recipe.ditherStrength
  })
  if (outlines.on) art = thinOutlines(art, grid, outlines.mask)

  // Each cell's own color, where the background is told apart from the subject.
  const own = palette.length > 0 ? quantize(samples, { palette: [], metric: recipe.metric, dither: "none", ditherStrength: 0 }) : art

  let lost: ReadonlyArray<LostColor> = []
  if (palette.length > 0) {
    const skip = recipe.removeBackground ? findBackground(own, backgroundColors(own), recipe.background) : undefined
    lost = lostColors(samples, art, recipe.lostThreshold, skip)
  }

  let specks: ReadonlyArray<ReadonlyArray<number>> = []
  const gridKey = `${art.width}x${art.height}`
  const cleanKeepStale = recipe.cleanKeep.size !== gridKey && recipe.cleanKeep.cells.length > 0
  if (recipe.cleanup.size > 0) {
    const cleaned = cleanUp(art, samples, {
      size: recipe.cleanup.size,
      strength: recipe.cleanup.strength,
      metric: recipe.metric,
      protect: recipe.palette?.locked ?? [],
      keep: recipe.cleanKeep.size === gridKey ? recipe.cleanKeep.cells : []
    })
    art = cleaned.art
    specks = cleaned.specks
  }

  let ownShrunk = own
  if (recipe.targetWidth !== undefined && recipe.targetWidth < art.width) {
    const width = Math.max(1, Math.round(recipe.targetWidth))
    const height = Math.max(1, Math.round((art.height * width) / art.width))
    art = reduce(art, width, height, recipe.reduceMode)
    if (recipe.removeBackground) ownShrunk = reduce(own, width, height, recipe.reduceMode)
  }

  let backgroundFound: ReadonlyArray<Rgb> = []
  const size = `${art.width}x${art.height}`
  const editsStale = recipe.edits.size !== size && recipe.edits.strokes.length > 0
  let mask: Uint8Array | undefined
  if (recipe.removeBackground) {
    const colors = backgroundColors(ownShrunk)
    backgroundFound = colors.map((index) => ownShrunk.palette[index]!)
    mask = findBackground(ownShrunk, colors, recipe.background)
  }
  const strokes = editsStale ? [] : recipe.edits.strokes
  let painted: ReadonlyArray<number> = []
  if (strokes.length > 0) {
    const edited = applyEdits(art, mask ?? new Uint8Array(art.width * art.height), strokes.flat(), recipe.metric)
    art = edited.art
    mask = edited.mask
    painted = edited.painted
  }
  if (mask !== undefined) art = clearMasked(art, mask)

  const exported = recipe.crop ? cropToContent(art) : art
  return { spec, detection, grid, outlines: outlines.on, samples, art, exported, lost, specks, backgroundFound, painted, editsStale, cleanKeepStale }
}

/** The size ("WxH") of the fixed picture before shrinking: what kept specks are recorded against. */
export const gridKeyOf = (grid: Grid): string => {
  const size = gridSize(grid)
  return `${size.width}x${size.height}`
}

/** One line on what auto-detection found, for people and agents alike. */
export const describeDetection = (image: RgbaImage, detection: Detection | undefined): string => {
  if (detection === undefined) return "No grid found: the picture has no edges. Set the cell size by hand."
  const fmt = (value: number): string => String(Math.round(value * 100) / 100)
  const percent = Math.round(detection.confidence * 100)
  const size = gridSize(uniformGrid(image.width, image.height, detection.spec))
  const verdict =
    detection.confidence >= 0.5
      ? "Looks right."
      : detection.confidence >= 0.3
        ? "Probably right: check the grid on the picture."
        : "Unsure: check the grid, and set the cell size by hand if it is off."
  return `Found ${fmt(detection.spec.cellWidth)} × ${fmt(detection.spec.cellHeight)} px cells, making ${size.width} × ${size.height} pixels. Confidence ${percent}%. ${verdict}`
}
