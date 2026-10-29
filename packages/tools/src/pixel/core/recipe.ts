/**
 * A recipe: every setting that turns a picture into fixed pixel art, hand
 * edits included, as plain JSON. The web page saves and opens recipes and
 * the CLI runs them, so a picture tuned by hand can be fixed again the same
 * way by an agent, and an agent's run can be opened in the page to finish by
 * hand.
 */
import { parseHex, toHex, type Metric, type Rgb } from "./color.ts"
import { defaultBackgroundOptions, type BackgroundOptions } from "./background.ts"
import type { Edit } from "./edits.ts"
import { defaultLostThreshold } from "./lost.ts"
import { defaultSampleOptions, type Dither, type SampleOptions } from "./fix.ts"
import type { GridSpec } from "./grid.ts"
import { presets } from "./palette.ts"
import type { ReduceMode } from "./reduce.ts"
import { anchors, animationOf, DEFAULT_FPS, defaultSheet, isAnimationName, type Sheet, type SheetAnimation, type SheetFrame } from "./sheet.ts"

/**
 * Where the grid comes from: found in the picture ("auto"), given as a cell
 * size and offset ("cells"), or made by cutting the picture into a number of
 * pixels ("size": pixelating a picture that is not pixel art; `height`
 * defaults to keeping the picture's proportions).
 */
export type GridChoice =
  | { readonly kind: "auto" }
  | { readonly kind: "cells"; readonly spec: GridSpec }
  | { readonly kind: "size"; readonly width: number; readonly height?: number | undefined }

export interface RecipePalette {
  readonly name: string
  readonly colors: ReadonlyArray<Rgb>
  /** Indices into `colors` that are locked: never cleaned away. */
  readonly locked: ReadonlyArray<number>
}

export interface Recipe {
  readonly grid: GridChoice
  /** Moves each line onto its nearest edge, for pictures whose cells drift. */
  readonly follow: boolean
  /** Lines dragged by hand, as ["x:3", position] in source pixels. */
  readonly moved: ReadonlyArray<readonly [string, number]>
  readonly sample: SampleOptions
  /** The colors allowed; undefined keeps each cell's own color. */
  readonly palette: RecipePalette | undefined
  readonly metric: Metric
  readonly dither: Dither
  readonly ditherStrength: number
  /** Specks up to `size` pixels (0: off) merge into their surroundings when doubtful enough for `strength` (0 to 1). */
  readonly cleanup: { readonly size: number; readonly strength: number }
  /** Cells whose speck was brought back by hand, for the grid size ("WxH") they were made at. */
  readonly cleanKeep: { readonly size: string; readonly cells: ReadonlyArray<number> }
  /** The fixed picture's width, smaller than the grid's to merge pixels; undefined keeps one pixel per cell. */
  readonly targetWidth: number | undefined
  readonly reduceMode: ReduceMode
  readonly removeBackground: boolean
  /** Exports without the transparent margins: only the box around the subject. */
  readonly crop: boolean
  readonly background: BackgroundOptions
  /** How far (OKLab) a cell's own color may be from its palette color before it counts as lost. */
  readonly lostThreshold: number
  /** Erase, restore, and paint strokes made by hand, for the size ("WxH") they were made at. */
  readonly edits: { readonly size: string; readonly strokes: ReadonlyArray<ReadonlyArray<Edit>> }
  /**
   * The picture is an animation sheet: its frames, how they line up, and how
   * they play. Every frame is fixed with the rest of the recipe. Undefined
   * for a single picture.
   */
  readonly sheet: Sheet | undefined
}

export const defaultRecipe: Recipe = {
  grid: { kind: "auto" },
  follow: false,
  moved: [],
  sample: defaultSampleOptions,
  palette: undefined,
  metric: "oklab",
  dither: "none",
  ditherStrength: 0.5,
  cleanup: { size: 0, strength: 0.5 },
  cleanKeep: { size: "", cells: [] },
  targetWidth: undefined,
  reduceMode: "outlines",
  removeBackground: false,
  crop: false,
  background: defaultBackgroundOptions,
  lostThreshold: defaultLostThreshold,
  edits: { size: "", strokes: [] },
  sheet: undefined
}

/** A recipe palette from a preset's name ("Sweetie 16", or "sweetie-16"), undefined when there is no such preset. */
export const presetPalette = (name: string): RecipePalette | undefined => {
  const slug = (text: string): string => text.toLowerCase().replace(/\(\d+\)/g, "").replace(/[^a-z0-9]+/g, "")
  const preset = presets.find((entry) => slug(entry.name) === slug(name))
  return preset === undefined ? undefined : { name: preset.name, colors: preset.colors, locked: [] }
}

/** The recipe as JSON, with colors as hex. */
export const encodeRecipe = (recipe: Recipe): string =>
  JSON.stringify(
    {
      version: 1,
      ...recipe,
      palette:
        recipe.palette === undefined
          ? null
          : { name: recipe.palette.name, colors: recipe.palette.colors.map(toHex), locked: recipe.palette.locked },
      targetWidth: recipe.targetWidth ?? null,
      edits: {
        size: recipe.edits.size,
        strokes: recipe.edits.strokes.map((stroke) => stroke.map((edit) => (edit.tool === "paint" ? { ...edit, color: toHex(edit.color) } : edit)))
      },
      sheet: recipe.sheet ?? null
    },
    null,
    2
  ) + "\n"

export type Decoded<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Reads a recipe written by `encodeRecipe` (or by hand). Missing settings
 * take their defaults, so a recipe can be as short as `{"palette": "sweetie-16"}`:
 * the palette may also be a preset's name, or a list of hex colors.
 */
export const decodeRecipe = (text: string): Decoded<Recipe> => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `not JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!isRecord(raw)) return { ok: false, error: "a recipe is a JSON object" }
  const errors: Array<string> = []
  const number = (value: unknown, name: string, fallback: number): number => {
    if (value === undefined) return fallback
    if (typeof value === "number" && Number.isFinite(value)) return value
    errors.push(`${name} must be a number`)
    return fallback
  }
  const boolean = (value: unknown, name: string, fallback: boolean): boolean => {
    if (value === undefined) return fallback
    if (typeof value === "boolean") return value
    errors.push(`${name} must be true or false`)
    return fallback
  }
  const oneOf = <T extends string>(value: unknown, name: string, options: ReadonlyArray<T>, fallback: T): T => {
    if (value === undefined) return fallback
    const found = options.find((option) => option === value)
    if (found !== undefined) return found
    errors.push(`${name} must be one of ${options.join(", ")}`)
    return fallback
  }

  const grid = ((): GridChoice => {
    const value = raw.grid
    if (value === undefined || value === "auto") return { kind: "auto" }
    if (!isRecord(value)) {
      errors.push('grid must be "auto" or an object')
      return { kind: "auto" }
    }
    if (value.kind === "auto") return { kind: "auto" }
    if (value.kind === "size") {
      const width = number(value.width, "grid.width", 0)
      if (!(width >= 1)) errors.push("grid.width must be at least 1")
      return value.height === undefined ? { kind: "size", width } : { kind: "size", width, height: number(value.height, "grid.height", width) }
    }
    if (value.kind === "cells" && isRecord(value.spec)) {
      const spec = value.spec
      const cellWidth = number(spec.cellWidth, "grid.spec.cellWidth", 8)
      const cellHeight = number(spec.cellHeight, "grid.spec.cellHeight", cellWidth)
      if (!(cellWidth >= 1) || !(cellHeight >= 1)) errors.push("grid cells must be at least 1 pixel")
      return {
        kind: "cells",
        spec: { cellWidth, cellHeight, offsetX: number(spec.offsetX, "grid.spec.offsetX", 0), offsetY: number(spec.offsetY, "grid.spec.offsetY", 0) }
      }
    }
    errors.push('grid.kind must be "auto", "cells" (with a spec), or "size"')
    return { kind: "auto" }
  })()

  const palette = ((): RecipePalette | undefined => {
    const value = raw.palette
    if (value === undefined || value === null || value === "original") return undefined
    if (typeof value === "string") {
      const preset = presetPalette(value)
      if (preset === undefined) errors.push(`no preset palette named "${value}"`)
      return preset
    }
    const list = Array.isArray(value) ? value : isRecord(value) ? value.colors : undefined
    if (!Array.isArray(list)) {
      errors.push("palette must be a preset's name, a list of hex colors, or { name, colors, locked }")
      return undefined
    }
    const colors: Array<Rgb> = []
    for (const entry of list) {
      const color = typeof entry === "string" ? parseHex(entry) : undefined
      if (color === undefined) errors.push(`palette color ${JSON.stringify(entry)} is not a hex color`)
      else colors.push(color)
    }
    const record = isRecord(value) ? value : {}
    const locked = Array.isArray(record.locked)
      ? record.locked.filter((index): index is number => typeof index === "number" && index >= 0 && index < colors.length)
      : []
    return { name: typeof record.name === "string" ? record.name : "Custom", colors, locked }
  })()

  const sample = isRecord(raw.sample) ? raw.sample : {}
  const cleanup = isRecord(raw.cleanup) ? raw.cleanup : {}
  const background = isRecord(raw.background) ? raw.background : {}
  const sized = <A>(value: unknown, read: (list: Array<unknown>) => A, empty: A): { size: string; list: A } => {
    if (!isRecord(value)) return { size: "", list: empty }
    const list = Array.isArray(value.cells) ? value.cells : Array.isArray(value.strokes) ? value.strokes : []
    return { size: typeof value.size === "string" ? value.size : "", list: read(list) }
  }
  const cleanKeep = sized(raw.cleanKeep, (list) => list.filter((cell): cell is number => typeof cell === "number"), [] as Array<number>)
  const edits = sized(
    raw.edits,
    (list) =>
      list.filter(Array.isArray).map((stroke) =>
        stroke.filter(isRecord).flatMap((edit): Array<Edit> => {
          const at = { x: Number(edit.x), y: Number(edit.y), area: edit.area === true }
          if (edit.tool === "erase" || edit.tool === "restore") return [{ ...at, tool: edit.tool }]
          const color = edit.tool === "paint" && typeof edit.color === "string" ? parseHex(edit.color) : undefined
          if (color !== undefined) return [{ ...at, tool: "paint", color }]
          errors.push(`edit ${JSON.stringify(edit)} is not an erase, restore, or paint with a hex color`)
          return []
        })
      ),
    [] as Array<Array<Edit>>
  )
  const moved = Array.isArray(raw.moved)
    ? raw.moved.flatMap((entry): Array<readonly [string, number]> =>
        Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "number" ? [[entry[0], entry[1]]] : []
      )
    : []
  const sheet = ((): Sheet | undefined => {
    const value = raw.sheet
    if (value === undefined || value === null) return undefined
    if (!isRecord(value)) {
      errors.push("sheet must be an object")
      return undefined
    }
    const frames = Array.isArray(value.frames) ? value.frames : []
    const read = frames.flatMap((entry, i): Array<SheetFrame> => {
      const frame = isRecord(entry) ? entry : {}
      const box = isRecord(frame.box) ? frame.box : frame
      const at = (key: string): number => number(box[key], `sheet.frames[${i}].box.${key}`, 0)
      const nudge = isRecord(frame.nudge) ? frame.nudge : {}
      const width = at("width")
      const height = at("height")
      if (!(width >= 1) || !(height >= 1)) {
        errors.push(`sheet.frames[${i}] needs a box at least 1 pixel wide and tall`)
        return []
      }
      return [
        {
          box: { x: Math.round(at("x")), y: Math.round(at("y")), width: Math.round(width), height: Math.round(height) },
          include: boolean(frame.include, `sheet.frames[${i}].include`, true),
          nudge: { x: Math.round(number(nudge.x, `sheet.frames[${i}].nudge.x`, 0)), y: Math.round(number(nudge.y, `sheet.frames[${i}].nudge.y`, 0)) }
        }
      ]
    })
    const playing = (entry: Record<string, unknown>, where: string): Pick<SheetAnimation, "fps" | "loop"> => {
      const fps = number(entry.fps, `${where}.fps`, DEFAULT_FPS)
      if (!(fps > 0)) errors.push(`${where}.fps must be more than 0`)
      return { fps, loop: oneOf(entry.loop, `${where}.loop`, ["forward", "pingpong"], "forward") }
    }
    // A recipe from before sheets held animations: every frame is one animation, played as the sheet said.
    const animations = ((): Array<SheetAnimation> => {
      if (value.animations === undefined) {
        const played = playing(value, "sheet")
        return read.length === 0 ? [] : [{ ...animationOf("animation-1", read.map((_, i) => i)), ...played }]
      }
      if (!Array.isArray(value.animations)) {
        errors.push("sheet.animations must be a list")
        return []
      }
      const seen = new Set<number>()
      const names = new Set<string>()
      const list = value.animations.flatMap((entry, a): Array<SheetAnimation> => {
        const where = `sheet.animations[${a}]`
        if (!isRecord(entry) || typeof entry.name !== "string" || !isAnimationName(entry.name) || !Array.isArray(entry.frames)) {
          errors.push(`${where} needs a name (letters, digits, "-", "_", ".") and a list of frames`)
          return []
        }
        if (names.has(entry.name)) errors.push(`${where}: another animation is named "${entry.name}"`)
        names.add(entry.name)
        const frames = entry.frames.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < read.length)
        if (frames.length !== entry.frames.length || frames.length === 0) errors.push(`${where}.frames must be frame numbers from 0 to ${read.length - 1}, at least one`)
        for (const i of frames) {
          if (seen.has(i)) errors.push(`frame ${i} is in more than one animation`)
          seen.add(i)
        }
        return [{ name: entry.name, frames, include: boolean(entry.include, `${where}.include`, true), ...playing(entry, where) }]
      })
      if (seen.size !== read.length) errors.push(`every frame must be in an animation (${read.length - seen.size} are not)`)
      return list
    })()
    return {
      frames: read,
      animations,
      anchor: oneOf(value.anchor, "sheet.anchor", anchors.map((entry) => entry.id), defaultSheet.anchor),
      padding: Math.max(0, Math.round(number(value.padding, "sheet.padding", defaultSheet.padding)))
    }
  })()

  const targetWidth = raw.targetWidth === undefined || raw.targetWidth === null ? undefined : number(raw.targetWidth, "targetWidth", 1)

  const recipe: Recipe = {
    grid,
    follow: boolean(raw.follow, "follow", defaultRecipe.follow),
    moved,
    sample: {
      inset: number(sample.inset, "sample.inset", defaultSampleOptions.inset),
      alphaThreshold: number(sample.alphaThreshold, "sample.alphaThreshold", defaultSampleOptions.alphaThreshold)
    },
    palette,
    metric: oneOf(raw.metric, "metric", ["oklab", "ciede2000"], defaultRecipe.metric),
    dither: oneOf(raw.dither, "dither", ["none", "ordered"], defaultRecipe.dither),
    ditherStrength: number(raw.ditherStrength, "ditherStrength", defaultRecipe.ditherStrength),
    cleanup: {
      size: number(cleanup.size, "cleanup.size", defaultRecipe.cleanup.size),
      strength: number(cleanup.strength, "cleanup.strength", defaultRecipe.cleanup.strength)
    },
    cleanKeep: { size: cleanKeep.size, cells: cleanKeep.list },
    targetWidth,
    reduceMode: oneOf(raw.reduceMode, "reduceMode", ["common", "outlines"], defaultRecipe.reduceMode),
    removeBackground: boolean(raw.removeBackground, "removeBackground", defaultRecipe.removeBackground),
    crop: boolean(raw.crop, "crop", defaultRecipe.crop),
    background: {
      tolerance: number(background.tolerance, "background.tolerance", defaultBackgroundOptions.tolerance),
      enclosed: boolean(background.enclosed, "background.enclosed", defaultBackgroundOptions.enclosed),
      specks: boolean(background.specks, "background.specks", defaultBackgroundOptions.specks),
      shadow: boolean(background.shadow, "background.shadow", defaultBackgroundOptions.shadow)
    },
    lostThreshold: number(raw.lostThreshold, "lostThreshold", defaultRecipe.lostThreshold),
    edits: { size: edits.size, strokes: edits.list },
    sheet
  }
  return errors.length > 0 ? { ok: false, error: errors.join("; ") } : { ok: true, value: recipe }
}
