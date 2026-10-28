/**
 * The whole fix for an animation sheet: what the page and `pixel sheet` both
 * run. The background is cleared from the sheet, every frame is read on one
 * grid size and fixed with one recipe (so one palette), and the frames are
 * placed on one canvas with their anchors on one spot.
 *
 * A cache keeps the slow steps (clearing, finding each frame's grid) between
 * runs, so the page reruns it on every slider move.
 */
import { defaultBackgroundOptions } from "./background.ts"
import type { Rgb } from "./color.ts"
import { proposePalette, type ProposeMethod, type Proposal } from "./palette.ts"
import { TRANSPARENT, type PixelArt } from "./fix.ts"
import { detectGrid, fitOffsets, type Detection, type GridSpec, type RgbaImage } from "./grid.ts"
import { lostColors, type LostColor } from "./lost.ts"
import { runWithSpec, type Outcome, type PipelineCache } from "./pipeline.ts"
import type { Recipe } from "./recipe.ts"
import {
  anchorOf,
  clearSheet,
  cropImage,
  fillNoise,
  findFrames,
  frameOf,
  layOut,
  looksAnimated,
  removeGridLines,
  sharePalette,
  sheetBackground,
  type FrameBox,
  type Placed,
  type Point,
  type Sheet
} from "./sheet.ts"

/** A frame as cut from the cleared sheet, with its grid as found alone and its own pipeline cache. */
interface FrameEntry {
  readonly crop: RgbaImage
  readonly detection: Detection | undefined
  readonly pipeline: PipelineCache
}

export interface AnimationCache {
  cleared?: { readonly image: RgbaImage; readonly key: string; readonly cleared: RgbaImage; readonly colors: ReadonlyArray<Rgb> }
  /** By box, so moving one frame's box reads only that frame again. */
  frames?: Map<string, FrameEntry>
}

/** One frame, fixed. */
export interface FixedFrame {
  readonly index: number
  readonly box: FrameBox
  /** The frame as cut from the sheet, background cleared: what its grid is read from. */
  readonly crop: RgbaImage
  /** The frame's own grid: the shared cell size at the frame's own offset. */
  readonly spec: GridSpec
  /** What detection found in this frame alone. */
  readonly detection: Detection | undefined
  readonly outcome: Outcome
  /** The fixed frame, on the animation's shared palette. */
  readonly art: PixelArt
  /** Where its anchor is in its own pixels, before nudging (undefined for the "box" anchor or an empty frame). */
  readonly anchor: Point | undefined
}

export interface AnimationOutcome {
  /** The background colors cleared from the sheet (empty when it is not cleared). */
  readonly backgroundFound: ReadonlyArray<Rgb>
  /** The sheet with its background cleared: what frames are found and read in. */
  readonly cleared: RgbaImage
  /** The cell size every frame is read at. */
  readonly cell: { readonly width: number; readonly height: number }
  /** How sure the shared cell size is, 0 to 1: the frames' own confidence, where they agree on it. */
  readonly confidence: number | undefined
  /** Every frame, included or not. */
  readonly frames: ReadonlyArray<FixedFrame>
  /** The included frames, in order, on one canvas. */
  readonly placed: ReadonlyArray<Placed & { readonly index: number }>
  readonly width: number
  readonly height: number
  /** Colors the palette has no match for, across the included frames. */
  readonly lost: ReadonlyArray<LostColor & { readonly frame: number }>
}

/** Clears the sheet's background (when the recipe removes backgrounds), reusing the last run's when nothing changed. */
export const clearedSheet = (image: RgbaImage, recipe: Recipe, cache: AnimationCache = {}): { readonly cleared: RgbaImage; readonly colors: ReadonlyArray<Rgb> } => {
  const key = JSON.stringify([recipe.removeBackground, recipe.background.tolerance])
  if (cache.cleared?.image !== image || cache.cleared.key !== key) {
    if (!recipe.removeBackground) cache.cleared = { image, key, cleared: image, colors: [] }
    else {
      const colors = sheetBackground(image)
      // A sheet's tolerance follows how noisy its fill is (JPEG noise), so a dark outline next to a
      // dark background is kept; the recipe's tolerance moves it from there.
      const noise = colors[0] === undefined ? 0 : fillNoise(image, colors[0])
      const tolerance = Math.max(0.02, Math.max(0.04, 4 * noise + 0.01) + recipe.background.tolerance - defaultBackgroundOptions.tolerance)
      const unlined = removeGridLines(image, colors, tolerance)
      cache.cleared = { image, key, cleared: clearSheet(unlined.image, unlined.colors, tolerance).image, colors }
      delete cache.frames
    }
  }
  return { cleared: cache.cleared.cleared, colors: cache.cleared.colors }
}

/** The frames found in a sheet, as the sheet's frames: every one included, none nudged. */
export const detectFrames = (image: RgbaImage, recipe: Recipe, cache: AnimationCache = {}): Sheet["frames"] => {
  const { cleared } = clearedSheet(image, recipe, cache)
  return findFrames(cleared).map(frameOf)
}

/** Whether a picture looks like an animation sheet: frames found in it, two or more and alike (see `looksAnimated`). */
export const isAnimationSheet = (image: RgbaImage, recipe: Recipe, frames: Sheet["frames"], cache: AnimationCache = {}): boolean =>
  looksAnimated(
    clearedSheet(image, recipe, cache).cleared,
    frames.map((frame) => frame.box)
  )

/** The weighted median of some values. */
const weightedMedian = (entries: ReadonlyArray<{ readonly value: number; readonly weight: number }>): number | undefined => {
  const sorted = [...entries].filter((entry) => entry.weight > 0).sort((a, b) => a.value - b.value)
  const total = sorted.reduce((sum, entry) => sum + entry.weight, 0)
  let seen = 0
  for (const entry of sorted) {
    seen += entry.weight
    if (seen >= total / 2) return entry.value
  }
  return sorted[sorted.length - 1]?.value
}

/** Two cell sizes this close (a share) agree. */
const AGREE = 0.03

/**
 * The cell size the frames share: what most of them found, weighted by how
 * sure each was. Cells are square in pixel art, so both axes vote.
 */
export const sharedCell = (detections: ReadonlyArray<Detection | undefined>): { readonly size: number; readonly confidence: number } | undefined => {
  const votes = detections.flatMap((detection) =>
    detection === undefined
      ? []
      : [
          { value: detection.x.cell, weight: detection.x.confidence + 0.01 },
          { value: detection.y.cell, weight: detection.y.confidence + 0.01 }
        ]
  )
  const size = weightedMedian(votes)
  if (size === undefined) return undefined
  // Sure when the frames that agree on the size are sure of it.
  const agreeing = detections.filter((detection) => detection !== undefined && Math.abs((detection.x.cell + detection.y.cell) / 2 - size) <= AGREE * size)
  const confidence = agreeing.length === 0 ? 0 : agreeing.reduce((sum, detection) => sum + detection!.confidence, 0) / agreeing.length
  const share = agreeing.length / Math.max(1, detections.length)
  return { size: Math.round(size * 1000) / 1000, confidence: confidence * share }
}

const boxKey = (box: FrameBox): string => `${box.x},${box.y},${box.width},${box.height}`

/**
 * Runs the recipe on every frame of a sheet. The recipe's grid gives the
 * cell size ("auto" finds it; "cells" gives it, and each frame finds its own
 * offset); its palette, matching, and cleanup apply to every frame. Hand
 * edits, shrinking, and cropping are for single pictures and are not used.
 */
export const runSheet = (image: RgbaImage, recipe: Recipe, sheet: Sheet, cache: AnimationCache = {}): AnimationOutcome => {
  const { cleared, colors } = clearedSheet(image, recipe, cache)
  const previous = cache.frames ?? new Map<string, FrameEntry>()
  const entries = new Map<string, FrameEntry>()
  const frameData = sheet.frames.map((frame) => {
    const key = boxKey(frame.box)
    let entry = entries.get(key) ?? previous.get(key)
    if (entry === undefined) {
      const crop = cropImage(cleared, frame.box)
      entry = { crop, detection: crop.width > 0 && crop.height > 0 ? detectGrid(crop) : undefined, pipeline: {} }
    }
    entries.set(key, entry)
    return entry
  })
  cache.frames = entries

  const found = sharedCell(frameData.map((entry) => entry.detection))
  const given = recipe.grid.kind === "cells" ? recipe.grid.spec : undefined
  const cell = given !== undefined ? { width: given.cellWidth, height: given.cellHeight } : { width: found?.size ?? 8, height: found?.size ?? 8 }

  // Each frame alone: no hand edits, no shrinking, no cropping, and its background already cleared.
  const frameRecipe: Recipe = {
    ...recipe,
    moved: [],
    targetWidth: undefined,
    removeBackground: false,
    crop: false,
    edits: { size: "", strokes: [] },
    cleanKeep: { size: "", cells: [] }
  }
  const fixed = sheet.frames.map((frame, index) => {
    const entry = frameData[index]!
    const offsets = entry.crop.width > 0 && entry.crop.height > 0 ? fitOffsets(entry.crop, cell.width, cell.height) : { offsetX: 0, offsetY: 0 }
    const spec: GridSpec = { cellWidth: cell.width, cellHeight: cell.height, ...offsets }
    const outcome = runWithSpec(entry.crop, frameRecipe, spec, entry.detection, entry.pipeline)
    return { index, box: frame.box, crop: entry.crop, spec, detection: entry.detection, outcome }
  })
  const shared = sharePalette(fixed.map((frame) => frame.outcome.art))
  const frames: Array<FixedFrame> = fixed.map((frame, i) => ({ ...frame, art: shared[i]!, anchor: anchorOf(shared[i]!, sheet.anchor) }))

  const included = frames.filter((frame) => sheet.frames[frame.index]!.include)
  // On the ground, each frame keeps its height as drawn on the sheet (a hop stays a hop): its
  // top, in cells, above the bottom of its row of boxes; the lowest feet of all set the ground.
  const drawn = included.map((frame) => {
    const row = included.filter((other) => overlapsVertically(other.box, frame.box))
    const bottom = Math.max(...row.map((other) => other.box.y + other.box.height))
    return Math.round((Math.max(0, Math.round(frame.box.y)) + frame.spec.offsetY - bottom) / cell.height)
  })
  const ground = Math.max(...included.map((frame, i) => drawn[i]! + (frame.anchor?.y ?? 0)))
  const offsets = included.map((frame, i) => {
    const nudge = sheet.frames[frame.index]!.nudge
    // Frames without an anchor sit as they are in their boxes.
    if (frame.anchor === undefined) return { x: nudge.x, y: nudge.y }
    if (sheet.anchor === "ground") return { x: nudge.x - frame.anchor.x, y: nudge.y + drawn[i]! - ground }
    return { x: nudge.x - frame.anchor.x, y: nudge.y - frame.anchor.y }
  })
  const laid = layOut(
    included.map((frame) => frame.art),
    offsets,
    sheet.padding
  )
  const lost =
    recipe.palette === undefined
      ? []
      : included.flatMap((frame) => lostColors(frame.outcome.samples, frame.outcome.art, recipe.lostThreshold).map((entry) => ({ ...entry, frame: frame.index })))
  return {
    backgroundFound: colors,
    cleared,
    cell,
    confidence: given !== undefined ? undefined : found?.confidence,
    frames,
    placed: laid.frames.map((placed, i) => ({ ...placed, index: included[i]!.index })),
    width: laid.width,
    height: laid.height,
    lost
  }
}

/** Whether two boxes share most of their height: frames on one row of the sheet. */
const overlapsVertically = (a: FrameBox, b: FrameBox): boolean =>
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) >= 0.5 * Math.min(a.height, b.height)

/** Every opaque cell color of every included frame, for proposing one palette for the whole animation. */
export const sheetColors = (outcome: AnimationOutcome): Array<Rgb> =>
  outcome.placed.flatMap((frame) => {
    const colors: Array<Rgb> = []
    frame.art.indices.forEach((index) => {
      if (index !== TRANSPARENT) colors.push(frame.art.palette[index]!)
    })
    return colors
  })

/** A palette proposed from every included frame's own colors (read without a palette): one palette for the whole animation. */
export const proposeForSheet = (
  image: RgbaImage,
  recipe: Recipe,
  sheet: Sheet,
  count: number,
  method: ProposeMethod,
  cache: AnimationCache = {}
): Array<Proposal> => proposePalette(sheetColors(runSheet(image, { ...recipe, palette: undefined }, sheet, cache)), count, method)
