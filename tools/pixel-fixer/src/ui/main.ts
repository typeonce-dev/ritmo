/**
 * The pixel fixer's page: one state object, a pipeline that recomputes the
 * fixed picture when anything changes, and panels that edit the state.
 *
 * A picture is fixed as one picture, or, when it is an animation sheet (a
 * row of frames), as an animation: the same settings fix every frame, and
 * the stage shows the sheet with its frame boxes, the frames side by side,
 * or the animation playing.
 */
import {
  backgroundColors,
  defaultBackgroundOptions,
  findBackground,
  SPECK_SIZE,
  type BackgroundOptions
} from "../core/background.ts"
import type { Edit } from "../core/edits.ts"
import { metrics, parseHex, toHex, type Metric, type Rgb } from "../core/color.ts"
import { demoImage } from "../core/demo.ts"
import { toJson, toRgba, toSvg } from "../core/export.ts"
import { defaultLostThreshold, type LostColor } from "../core/lost.ts"
import {
  defaultSampleOptions,
  medianColor,
  quantize,
  TRANSPARENT,
  usedColors,
  type CellSamples,
  type Dither,
  type PixelArt,
  type SampleOptions
} from "../core/fix.ts"
import {
  detectGrid,
  gridSize,
  type Axis,
  type Detection,
  type Grid,
  type GridSpec,
  type RgbaImage
} from "../core/grid.ts"
import {
  parsePalette,
  presets,
  proposeMethods,
  proposePalette,
  toGpl,
  toHexFile,
  type Palette,
  type Proposal,
  type ProposeMethod
} from "../core/palette.ts"
import type { LintRules } from "../core/lint.ts"
import { describeDetection, gridKeyOf, resolveGrid, runWithSpec, type PipelineCache } from "../core/pipeline.ts"
import { decodeRecipe, encodeRecipe, presetPalette, type Recipe } from "../core/recipe.ts"
import { reportOfArt, reportOfFix, reportOfSheet, type Report } from "../core/report.ts"
import { detectFrames, isAnimationSheet, proposeForSheet, runSheet, type AnimationCache, type AnimationOutcome } from "../core/animation.ts"
import { toGif } from "../core/gif.ts"
import { anchors, defaultSheet, frameOf, playOrder, type Sheet } from "../core/sheet.ts"
import { sheetArt, spritesheetJson, type SheetLayout } from "../core/spritesheet.ts"
import { toZip } from "../core/zip.ts"
import { formatSprite, parseJsonMap, parseSprite } from "../core/sprite.ts"
import { reduceModes, type ReduceMode } from "../core/reduce.ts"
import { h, replace } from "./dom.ts"
import {
  badge,
  button,
  callout,
  chip,
  group,
  hint,
  icon,
  mark,
  numberInput,
  prop,
  reveal,
  section,
  segmented,
  selectInput,
  sliderRow,
  switchRow,
  textInput,
  type IconName
} from "./kit.ts"
import { baseName, canvasOf, download, loadImage, pngOf } from "./files.ts"
import { makeHistory } from "./history.ts"
import { makePlayer } from "./player.ts"
import { makeViewer, type Box, type ViewMode } from "./viewer.ts"

interface Swatch {
  readonly color: Rgb
  readonly locked: boolean
}

/** What is shown for an animation: the sheet with its frame boxes, the fixed frames side by side, or the animation playing. */
type AnimationView = "sheet" | "frames" | "play"

interface State {
  source: { readonly image: RgbaImage; readonly canvas: HTMLCanvasElement; readonly name: string } | undefined
  /** Fixed as one picture, or as an animation of the frames on it. */
  kind: "picture" | "animation"
  /** The animation's frames and how they play, when `kind` is "animation". */
  sheet: Sheet
  /** The animation's cell size typed by hand; undefined finds it in the frames. */
  sheetCell: number | undefined
  animationView: AnimationView
  /** The frame being edited (its box, or its nudge), by its index on the sheet. */
  selectedFrame: number | undefined
  playing: boolean
  /** Shows the frame before faintly under the one playing. */
  onion: boolean
  /** The sheet as it is, or with its background cleared, in the sheet view. */
  sheetShows: "cleared" | "original"
  /** How the exported sheet lays its frames out. */
  exportLayout: { kind: "strip" | "grid"; columns: number; spacing: number }
  spec: GridSpec
  linked: boolean
  follow: boolean
  /** Lines dragged by hand, by "axis:index", in source pixels. Cleared when the grid's numbers change. */
  moved: Map<string, number>
  detection: Detection | undefined
  detectionNote: string
  /** Whether the note above is good news (a confident grid) or asks for a look. */
  noteGood: boolean
  sample: SampleOptions
  /** The palette's name, or "original" to keep each cell's own color. */
  paletteName: string
  swatches: Array<Swatch>
  proposeMethod: ProposeMethod
  /** How many colors to propose from the picture. */
  proposeCount: number
  /** How many colors the palette keeps (locked ones included) when the proposals are applied. */
  keepCount: number
  proposals: Array<Proposal>
  metric: Metric
  dither: Dither
  ditherStrength: number
  /** Specks up to `size` pixels (0: off) merge into their surroundings when doubtful enough for `strength` (0 to 1). */
  cleanup: { size: number; strength: number; show: boolean }
  /** Cells whose speck was brought back by hand, for the grid size they were made at. */
  cleanKeep: { size: string; cells: Array<number> }
  /** The fixed picture's width, smaller than the grid's to merge pixels; undefined keeps one pixel per cell. */
  targetWidth: number | undefined
  reduceMode: ReduceMode
  removeBackground: boolean
  /** Exports without the transparent margins. */
  crop: boolean
  background: BackgroundOptions
  /** What pressing on the picture does: pan, move grid lines, erase, restore, or paint pixels, or pick a color. */
  tool: "move" | "lines" | "erase" | "restore" | "paint" | "pick" | "frames"
  /** The color Paint paints; it snaps to the nearest palette color. */
  paintColor: Rgb | undefined
  /** How far (OKLab) a cell's own color may be from the palette color it got before it counts as lost. */
  lostThreshold: number
  /** Whether erasing, restoring, or painting takes one pixel or its whole area of one color. */
  brush: "pixel" | "area"
  /** Strokes painted by hand, for the size they were made at: a new size drops them. */
  edits: { size: string; strokes: Array<Array<Edit>> }
  mode: ViewMode
  showGrid: boolean
  exportScale: number
  /** The project's rules the Check panel holds the result to, as in pixel.config.json. */
  rules: { sizes: string; maxColors: number | undefined; transparentBackground: boolean }
  message: string
}

const ORIGINAL = "original"

const state: State = {
  source: undefined,
  kind: "picture",
  sheet: defaultSheet,
  sheetCell: undefined,
  animationView: "play",
  selectedFrame: undefined,
  playing: true,
  onion: false,
  sheetShows: "cleared",
  exportLayout: { kind: "strip", columns: 4, spacing: 0 },
  spec: { cellWidth: 8, cellHeight: 8, offsetX: 0, offsetY: 0 },
  linked: true,
  follow: false,
  moved: new Map(),
  detection: undefined,
  detectionNote: "",
  noteGood: false,
  sample: defaultSampleOptions,
  paletteName: presets[2]!.name,
  swatches: presets[2]!.colors.map((color) => ({ color, locked: false })),
  proposeMethod: "dominant",
  proposeCount: 24,
  keepCount: 12,
  proposals: [],
  metric: "oklab",
  dither: "none",
  ditherStrength: 0.5,
  cleanup: { size: 0, strength: 0.5, show: true },
  cleanKeep: { size: "", cells: [] },
  targetWidth: undefined,
  reduceMode: "outlines",
  removeBackground: true,
  crop: false,
  background: defaultBackgroundOptions,
  tool: "move",
  paintColor: undefined,
  lostThreshold: defaultLostThreshold,
  brush: "pixel",
  edits: { size: "", strokes: [] },
  mode: "compare",
  showGrid: true,
  exportScale: 8,
  rules: { sizes: "", maxColors: undefined, transparentBackground: false },
  message: ""
}

/** The settings undo and redo cover: everything but the picture itself and how it is viewed. */
const undoable = [
  "kind",
  "sheet",
  "sheetCell",
  "spec",
  "linked",
  "follow",
  "moved",
  "detection",
  "detectionNote",
  "noteGood",
  "sample",
  "paletteName",
  "swatches",
  "proposeMethod",
  "proposeCount",
  "keepCount",
  "proposals",
  "metric",
  "dither",
  "ditherStrength",
  "cleanup",
  "cleanKeep",
  "targetWidth",
  "reduceMode",
  "removeBackground",
  "crop",
  "background",
  "lostThreshold",
  "edits"
] as const satisfies ReadonlyArray<keyof State>

const history = makeHistory(
  () => JSON.stringify(undoable.map((key) => (key === "moved" ? [...state.moved] : state[key]) ?? null)),
  (snapshot) => {
    const values = JSON.parse(snapshot) as Array<unknown>
    const target = state as unknown as Record<string, unknown>
    undoable.forEach((key, i) => {
      const value = values[i] ?? undefined
      target[key] = key === "moved" ? new Map(value as Array<[string, number]>) : value
    })
    state.message = ""
    update()
  },
  () => renderTopbar()
)

// The pipeline's cache: a slider for dithering must not re-detect the grid.
let cache: PipelineCache = {}
let grid: Grid | undefined
let samples: CellSamples | undefined
let result: PixelArt | undefined
/** What Export writes: the result, cropped to its subject when asked. */
let exported: PixelArt | undefined
/** The background colors found in the last result, for the Background panel. */
let backgroundFound: Array<Rgb> = []
/** The colors the palette lost in the last result, and the cells of the one pointed at. */
let lost: Array<LostColor> = []
let highlight: ReadonlyArray<number> = []
/** The specks cleaned in the last result, each as its cells. */
let specks: ReadonlyArray<ReadonlyArray<number>> = []
/** The pixels painted by hand in the last result. */
let painted: ReadonlyArray<number> = []
/** What `pixel check` would say about the last result. */
let report: Report | undefined
/** Fit the view to the picture on the next render (a new picture, or a switch between picture and animation). */
let refit = false
/** The animation's place in its play order (which repeats the middle frames backwards when playing there and back). */
let frame = 0
/** The last animation run, when the picture is fixed as an animation. */
let animation: AnimationOutcome | undefined
let animationCache: AnimationCache = {}
/** The sheet with its background cleared, ready to draw, for the sheet view. */
let clearedCanvas: { readonly image: RgbaImage; readonly canvas: HTMLCanvasElement } | undefined

/** The page's settings as a recipe: what the shared pipeline runs, and what Save recipe writes. */
const recipeOf = (): Recipe => ({
  grid: { kind: "cells", spec: state.spec },
  follow: state.follow,
  moved: [...state.moved],
  sample: state.sample,
  palette:
    state.paletteName === ORIGINAL
      ? undefined
      : {
          name: state.paletteName,
          colors: state.swatches.map((swatch) => swatch.color),
          locked: state.swatches.flatMap((swatch, i) => (swatch.locked ? [i] : []))
        },
  metric: state.metric,
  dither: state.dither,
  ditherStrength: state.ditherStrength,
  cleanup: { size: state.cleanup.size, strength: state.cleanup.strength },
  cleanKeep: state.cleanKeep,
  targetWidth: state.targetWidth,
  reduceMode: state.reduceMode,
  removeBackground: state.removeBackground,
  crop: state.crop,
  background: state.background,
  lostThreshold: state.lostThreshold,
  edits: state.edits,
  sheet: state.kind === "animation" ? state.sheet : undefined
})

/** The recipe an animation runs: the page's, with the cell size found in the frames unless one was typed. */
const animationRecipe = (): Recipe => ({
  ...recipeOf(),
  grid: state.sheetCell === undefined ? { kind: "auto" } : { kind: "cells", spec: { cellWidth: state.sheetCell, cellHeight: state.sheetCell, offsetX: 0, offsetY: 0 } }
})

/** "16x16, 32x32" as sizes; anything unreadable is left out. */
const parseSizes = (text: string): Array<{ width: number; height: number }> =>
  [...text.matchAll(/(\d+)\s*[x×]\s*(\d+)/g)].map((match) => ({ width: Number(match[1]), height: Number(match[2]) }))

/** The fixed pixels the palette is used on: the picture, or every frame of the animation. */
const fixedArt = (): PixelArt | undefined => (state.kind === "animation" ? exported : result)

/** The rules the Check panel holds the result to: the panel's own, and the palette chosen. */
const rulesOf = (): LintRules => ({
  palette: state.paletteName === ORIGINAL ? undefined : state.swatches.map((swatch) => swatch.color),
  sizes: parseSizes(state.rules.sizes),
  maxColors: state.rules.maxColors,
  transparentBackground: state.rules.transparentBackground
})

const recompute = (): void => {
  const source = state.source
  if (source === undefined) {
    grid = undefined
    result = undefined
    exported = undefined
    report = undefined
    animation = undefined
    return
  }
  if (state.kind === "animation") {
    const recipe = animationRecipe()
    animation = runSheet(source.image, recipe, state.sheet, animationCache)
    if (clearedCanvas?.image !== animation.cleared) clearedCanvas = { image: animation.cleared, canvas: canvasOf(animation.cleared) }
    grid = undefined
    samples = undefined
    lost = []
    specks = animation.frames.flatMap((frame) => frame.outcome.specks)
    painted = []
    backgroundFound = [...animation.backgroundFound]
    result = undefined
    exported = sheetArt(
      animation.placed.map((frame) => frame.art),
      exportLayout()
    )
    report = reportOfSheet(source.image, recipe, animation, rulesOf())
    return
  }
  animation = undefined
  const outcome = runWithSpec(source.image, recipeOf(), state.spec, state.detection, cache)
  grid = outcome.grid
  samples = outcome.samples
  lost = [...outcome.lost]
  specks = outcome.specks
  painted = outcome.painted
  backgroundFound = [...outcome.backgroundFound]
  result = outcome.art
  exported = outcome.exported
  // Pixel art at its own size (a sprite source) has no grid to judge, only rules.
  report =
    state.spec.cellWidth === 1 && state.spec.cellHeight === 1
      ? reportOfArt(outcome.art, rulesOf(), 0, source.image)
      : reportOfFix(source.image, recipeOf(), outcome, rulesOf())
  // Hand edits belong to the size they were made at: a new size starts them over.
  const gridKey = gridKeyOf(outcome.grid)
  if (state.cleanKeep.size !== gridKey) state.cleanKeep = { size: gridKey, cells: [] }
  const size = `${outcome.art.width}x${outcome.art.height}`
  if (state.edits.size !== size) state.edits = { size, strokes: [] }
}

let scheduled = false
let panelsStale = false
/** True while a slider reports a value mid-drag. */
let dragging = false
/**
 * Recomputes and redraws on the next frame, once however many changes come
 * in. `panels: false` leaves the side panels as they are, for changes made
 * while a slider is being dragged (rebuilding it would drop the drag).
 */
const update = (options: { readonly panels: boolean } = { panels: true }): void => {
  if (options.panels && !dragging) panelsStale = true
  history.schedule()
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    recompute()
    render(panelsStale)
    panelsStale = false
  })
}

// ---------------------------------------------------------------------------
// Loading pictures

/** Opens a picture; with `spec`, its grid is given (pixel art at its own size) instead of detected. */
const setSource = (image: RgbaImage, canvas: HTMLCanvasElement, name: string, spec?: GridSpec): void => {
  state.source = { image, canvas, name }
  state.moved.clear()
  state.targetWidth = undefined
  state.edits = { size: "", strokes: [] }
  state.proposals = []
  state.kind = "picture"
  state.sheet = defaultSheet
  state.selectedFrame = undefined
  if (state.tool === "frames") state.tool = "move"
  cache = {}
  animationCache = {}
  clearedCanvas = undefined
  samples = undefined
  state.message = ""
  refit = true
  history.reset()
  if (spec === undefined) {
    // A sheet's grid is found in its frames; a picture's, in the whole of it.
    if (!openAsAnimation()) autoDetect()
    else state.detectionNote = ""
    return
  }
  state.spec = spec
  state.linked = true
  state.detection = undefined
  state.sample = { ...state.sample, inset: 0 }
  state.detectionNote = "Pixel art at its own size: one pixel per cell."
  state.noteGood = true
  update()
}

/**
 * Looks for frames in the picture just opened: when it holds two or more
 * alike, it opens as an animation, with a palette proposed from all of them.
 */
const openAsAnimation = (): boolean => {
  const source = state.source
  if (source === undefined) return false
  const recipe: Recipe = { ...recipeOf(), removeBackground: true }
  const frames = detectFrames(source.image, recipe, animationCache)
  if (!isAnimationSheet(source.image, recipe, frames, animationCache)) return false
  state.kind = "animation"
  state.removeBackground = true
  state.sheet = { ...defaultSheet, frames }
  state.sheetCell = undefined
  state.animationView = "play"
  state.playing = true
  frame = 0
  state.keepCount = 16
  propose()
  state.message = `Found ${frames.length} frames: opened as an animation. Choose Picture in the top bar to fix it as one picture.`
  return true
}

/** Fixes the picture as one picture, or as an animation of the frames on it (found the first time). */
const setKind = (kind: State["kind"]): void => {
  const source = state.source
  if (kind === state.kind || source === undefined) return
  if (kind === "animation" && state.sheet.frames.length === 0) {
    const found = detectFrames(source.image, { ...recipeOf(), removeBackground: true }, animationCache)
    // Nothing found: one box around the whole picture, to move and add to by hand.
    state.sheet = { ...state.sheet, frames: found.length > 0 ? found : [frameOf({ x: 0, y: 0, width: source.image.width, height: source.image.height })] }
    state.removeBackground = true
  }
  state.kind = kind
  // A picture opened as an animation has not looked for its own grid yet.
  if (kind === "picture" && state.detectionNote === "") autoDetect()
  if (kind === "picture" && state.tool === "frames") state.tool = "move"
  if (kind === "animation" && state.tool !== "move" && state.tool !== "frames") state.tool = "move"
  refit = true
  update()
}

const ONE_PIXEL: GridSpec = { cellWidth: 1, cellHeight: 1, offsetX: 0, offsetY: 0 }

/** Opens pixel art given as data (a sprite source or a JSON map) as a picture with one pixel per cell. */
const openArt = (art: PixelArt, name: string): void => {
  const image = toRgba(art)
  setSource(image, canvasOf(image), name, ONE_PIXEL)
}

/**
 * Opens a dropped or picked file: a picture, a sprite source (.txt), a JSON
 * map, a recipe (applied to the picture open), or a pixel.config.json (its
 * rules, palette, and recipe).
 */
const openFile = async (file: Blob, name: string): Promise<void> => {
  const fail = (text: string): void => {
    state.message = text
    update()
  }
  if (file.type.startsWith("image/")) {
    try {
      const { image, canvas } = await loadImage(file)
      // Finding frames and grids in a large picture takes a moment: say so first.
      state.message = `Reading ${name}…`
      renderToast()
      await new Promise((resolve) => setTimeout(resolve, 30))
      setSource(image, canvas, name)
    } catch (error) {
      fail(`Could not read ${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
    return
  }
  const text = await file.text()
  if (!/\.json$/i.test(name)) {
    const parsed = parseSprite(text)
    if (parsed.ok) openArt(parsed.art, name)
    else fail(`${name} is not a picture or a sprite source: ${parsed.problems.slice(0, 3).map((problem) => (problem.line === undefined ? problem.message : `line ${problem.line}: ${problem.message}`)).join("; ")}`)
    return
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    fail(`${name} is not JSON.`)
    return
  }
  const record: Readonly<Record<string, unknown>> = isRecord(raw) ? raw : {}
  if ("pixels" in record) {
    const parsed = parseJsonMap(text)
    if (parsed.ok) openArt(parsed.art, name)
    else fail(`${name}: ${parsed.problems[0]?.message ?? "not a JSON map"}`)
    return
  }
  if (/pixel\.config/i.test(name) || "sizes" in record || "maxColors" in record) {
    applyConfig(record, name)
    return
  }
  const decoded = decodeRecipe(text)
  if (decoded.ok) applyRecipe(decoded.value, name)
  else fail(`${name} is not a recipe: ${decoded.error}`)
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** Sets the page from a recipe: the grid, the palette, and every setting, hand edits included. */
const applyRecipe = (recipe: Recipe, name: string): void => {
  const source = state.source
  if (source === undefined) {
    state.message = `Open the picture first, then the recipe ${name}.`
    update()
    return
  }
  if (recipe.grid.kind === "auto") autoDetect()
  else {
    const resolved = resolveGrid(source.image, recipe.grid)
    if (resolved !== undefined) state.spec = resolved.spec
    state.detection = undefined
    state.linked = Math.abs(state.spec.cellWidth - state.spec.cellHeight) < 0.02 * state.spec.cellWidth
    state.detectionNote = `Grid from ${name}.`
    state.noteGood = true
  }
  state.follow = recipe.follow
  state.moved = new Map(recipe.moved)
  state.sample = recipe.sample
  if (recipe.palette === undefined) state.paletteName = ORIGINAL
  else {
    const locked = new Set(recipe.palette.locked)
    state.paletteName = recipe.palette.name
    state.swatches = recipe.palette.colors.map((color, i) => ({ color, locked: locked.has(i) }))
  }
  state.metric = recipe.metric
  state.dither = recipe.dither
  state.ditherStrength = recipe.ditherStrength
  state.cleanup = { ...state.cleanup, ...recipe.cleanup }
  state.cleanKeep = { size: recipe.cleanKeep.size, cells: [...recipe.cleanKeep.cells] }
  state.targetWidth = recipe.targetWidth
  state.reduceMode = recipe.reduceMode
  state.removeBackground = recipe.removeBackground
  state.crop = recipe.crop
  state.background = recipe.background
  state.lostThreshold = recipe.lostThreshold
  state.edits = { size: recipe.edits.size, strokes: recipe.edits.strokes.map((stroke) => [...stroke]) }
  if (recipe.sheet !== undefined) {
    state.kind = "animation"
    state.sheet = recipe.sheet
    state.sheetCell = recipe.grid.kind === "cells" ? recipe.grid.spec.cellWidth : undefined
    state.selectedFrame = undefined
    if (state.tool !== "move" && state.tool !== "frames") state.tool = "move"
  } else state.kind = "picture"
  // The recipe's sizes must be the ones it was made at, or its hand edits are dropped.
  cache = {}
  state.message = `Applied ${name}.`
  update()
}

/** Takes a pixel.config.json's rules, its palette when it names a preset or colors, and its recipe settings. */
const applyConfig = (config: Readonly<Record<string, unknown>>, name: string): void => {
  const field = (key: string): unknown => config[key]
  const sizes = field("sizes")
  const maxColors = field("maxColors")
  state.rules = {
    sizes: Array.isArray(sizes) ? sizes.filter((size) => typeof size === "string").join(", ") : state.rules.sizes,
    maxColors: typeof maxColors === "number" ? maxColors : undefined,
    transparentBackground: field("transparentBackground") === true
  }
  const notes: Array<string> = [`Rules from ${name}.`]
  const palette = field("palette")
  const chosen = typeof palette === "string" ? presetPalette(palette) : undefined
  if (chosen !== undefined) setPalette(chosen.name, chosen.colors)
  else if (Array.isArray(palette)) setPalette("Project", parsePalette(palette.join(" ")).colors)
  else if (typeof palette === "string") notes.push(`Its palette "${palette}" is a file: import it in Palette.`)
  const recipe = field("recipe")
  if (typeof recipe === "object" && recipe !== null && state.source !== undefined) {
    const decoded = decodeRecipe(JSON.stringify({ ...recipe, palette: null, grid: { kind: "cells", spec: state.spec } }))
    if (decoded.ok) {
      state.cleanup = { ...state.cleanup, ...decoded.value.cleanup }
      state.metric = decoded.value.metric
      state.dither = decoded.value.dither
      state.reduceMode = decoded.value.reduceMode
    }
  }
  if (state.rules.transparentBackground) state.removeBackground = true
  state.message = notes.join(" ")
  update()
}

const openDemo = (): void => {
  const image = demoImage()
  setSource(image, canvasOf(image), "demo-mushroom.png")
}

const autoDetect = (): void => {
  const source = state.source
  if (source === undefined) return
  const detection = detectGrid(source.image)
  state.detection = detection
  state.moved.clear()
  state.detectionNote = describeDetection(source.image, detection)
  state.noteGood = detection !== undefined && detection.confidence >= 0.5
  if (detection !== undefined) {
    state.spec = detection.spec
    state.linked = Math.abs(detection.spec.cellWidth - detection.spec.cellHeight) < 0.02 * detection.spec.cellWidth
  }
  update()
}


// ---------------------------------------------------------------------------
// The page: a top bar, the picture with its floating tools, and the inspector

const app = document.getElementById("app")!
const canvas = h("canvas", { class: "view", attrs: { "aria-label": "Picture view" } })
const viewer = makeViewer(canvas, {
  moveLine: (axis: Axis, index: number, position: number) => {
    state.moved.set(`${axis}:${index}`, position)
    update()
  },
  viewChanged: () => renderZoom(),
  selectBox: (index) => {
    state.selectedFrame = index
    update()
  },
  changeBox: (index, box) => setFrameBox(index, box),
  addBox: (box) => addFrame(box),
  pick: (x: number, y: number) => {
    const cell = samples?.cells[y * samples.width + x]
    if (cell !== undefined && cell.colors.length > 0) keepColor(medianColor(cell.colors))
  },
  sample: (x: number, y: number) => {
    const index = result?.indices[y * result.width + x]
    if (result === undefined || index === undefined || index === TRANSPARENT) return
    state.paintColor = result.palette[index]!
    update()
  },
  paint: (x: number, y: number, start: boolean) => {
    // Restoring over a cleaned speck brings the speck back, when the picture has one pixel per cell.
    if (state.tool === "restore" && grid !== undefined && state.targetWidth === undefined) {
      const cell = y * gridSize(grid).width + x
      const speck = specks.find((cells) => cells.includes(cell))
      if (speck !== undefined) state.cleanKeep.cells.push(...speck)
    }
    const area = state.brush === "area"
    let edit: Edit
    if (state.tool === "paint") {
      if (state.paintColor === undefined) return
      edit = { x, y, area, tool: "paint", color: state.paintColor }
    } else {
      edit = { x, y, area, tool: state.tool === "erase" ? "erase" : "restore" }
    }
    if (start) state.edits.strokes.push([])
    state.edits.strokes[state.edits.strokes.length - 1]!.push(edit)
    update()
  }
})

const playerCanvas = h("canvas", { class: "view", attrs: { "aria-label": "Animation view", hidden: true } })
const player = makePlayer(playerCanvas, {
  choose: (index) => {
    const placed = animation?.placed[index]
    if (placed === undefined) return
    state.selectedFrame = placed.index
    state.playing = false
    const order = playOrder(animation!.placed.length, state.sheet.loop)
    frame = Math.max(0, order.indexOf(index))
    update()
  },
  viewChanged: () => renderZoom()
})

const fileInput = h("input", {
  props: { type: "file", accept: "image/*,.txt,.json" },
  attrs: { hidden: true },
  on: {
    change: () => {
      const file = fileInput.files?.[0]
      if (file !== undefined) void openFile(file, file.name)
      fileInput.value = ""
    }
  }
})

const topbar = h("header", { class: "topbar" })
const tools = h("div", { class: "floating tools" })
const zoomBox = h("div", { class: "floating zoom" })
const toast = h("div", { class: "toast", attrs: { role: "status", "aria-live": "polite" } })
const panels = h("aside", { class: "inspector", attrs: { "aria-label": "Settings" } })
const empty = h(
  "div",
  { class: "empty" },
  h(
    "div",
    { class: "empty-card" },
    h("div", { class: "empty-icon" }, mark()),
    h("h2", {}, "Drop a picture to fix"),
    h("p", {}, "Or paste one, or open a file. Pictures never leave this device."),
    h(
      "div",
      { class: "empty-actions" },
      button("Open a picture", () => fileInput.click(), { variant: "primary", icon: "open" }),
      button("Try the demo", openDemo, { variant: "secondary" })
    ),
    h("p", { class: "empty-note" }, "Animation sheets open as animations: every frame found, fixed, lined up, and played."),
    h("p", { class: "empty-note" }, "Sprite sources (.txt), JSON maps, recipes, and pixel.config.json open here too."),
    h("p", { class: "empty-note" }, "A free tool from Ritmo, the agent-first ECS runtime.")
  )
)
const playback = h("div", { class: "floating playback" })
const stage = h("div", { class: "stage" }, canvas, playerCanvas, empty, tools, playback, zoomBox, toast)

app.append(topbar, h("main", { class: "layout" }, h("section", { class: "workspace" }, stage), panels), fileInput)

// Drop and paste anywhere on the page.
window.addEventListener("dragover", (event) => {
  event.preventDefault()
  stage.classList.add("dropping")
})
window.addEventListener("dragleave", () => stage.classList.remove("dropping"))
window.addEventListener("drop", (event) => {
  event.preventDefault()
  stage.classList.remove("dropping")
  const file = event.dataTransfer?.files[0]
  if (file !== undefined) void openFile(file, file.name)
})
window.addEventListener("paste", (event) => {
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
  const item = [...(event.clipboardData?.items ?? [])].find((entry) => entry.type.startsWith("image/"))
  const file = item?.getAsFile()
  if (file != null) void openFile(file, "pasted.png")
})

// ---------------------------------------------------------------------------
// Controls wired to the page: sliders move the picture while dragged

const slider = (
  label: string,
  value: number,
  range: { min: number; max: number; step: number },
  show: (value: number) => string,
  onChange: (value: number) => void,
  title?: string
): HTMLElement =>
  sliderRow(
    label,
    value,
    range,
    show,
    (next) => {
      // While dragging, the picture follows but the panels stay; they catch up on release.
      dragging = true
      onChange(next)
      dragging = false
    },
    () => update(),
    title
  )

const sectionOf = (id: string, title: string, extra: { readonly action?: Node | false; readonly help?: string } = {}, ...children: Array<Node | false | undefined | ReadonlyArray<Node | false | undefined>>): HTMLElement =>
  section({ id, title, onToggle: () => update(), ...(extra.action === undefined ? {} : { action: extra.action }), ...(extra.help === undefined ? {} : { help: extra.help }) }, ...children)

const pixels = (count: number): string => `${count} pixel${count === 1 ? "" : "s"}`

// ---------------------------------------------------------------------------
// Grid and size

const setSpec = (next: Partial<GridSpec>): void => {
  state.spec = { ...state.spec, ...next }
  state.moved.clear()
  update()
}

const gridPanel = (): HTMLElement => {
  const setSide = (side: "cellWidth" | "cellHeight") => (value: number) => {
    const size = Math.max(1, value)
    setSpec(state.linked ? { cellWidth: size, cellHeight: size } : { [side]: size })
  }
  return sectionOf(
    "grid",
    "Grid",
    {
      action: button("Auto-detect", autoDetect, { variant: "ghost", small: true, icon: "wand", title: "Find the grid again" }),
      help:
        "The grid marks the picture's fake pixels: each cell becomes one pixel. Cell sizes may be fractions (AI pictures are often scaled by 7.6 or 23.3). To move one line by hand, choose Lines in the toolbar and drag it; moved lines turn yellow. Following drifting lines moves every line onto its nearest edge, for pictures whose cells grow or shrink."
    },
    state.detectionNote !== "" && callout(state.noteGood ? "good" : "warn", state.detectionNote),
    prop(
      "Cell size",
      h(
        "div",
        { class: "pair" },
        numberInput(state.spec.cellWidth, setSide("cellWidth"), { min: 1, prefix: "W", label: "Cell width" }),
        numberInput(state.spec.cellHeight, setSide("cellHeight"), { min: 1, prefix: "H", label: "Cell height" })
      ),
      "Source pixels per pixel. Fractions are fine."
    ),
    prop(
      "Offset",
      h(
        "div",
        { class: "pair" },
        numberInput(state.spec.offsetX, (value) => setSpec({ offsetX: value }), { step: 0.25, prefix: "X", label: "Offset X" }),
        numberInput(state.spec.offsetY, (value) => setSpec({ offsetY: value }), { step: 0.25, prefix: "Y", label: "Offset Y" })
      ),
      "Where the first full cell starts, from the top left."
    ),
    switchRow("Square cells", state.linked, (checked) => {
      state.linked = checked
      if (checked) setSpec({ cellHeight: state.spec.cellWidth })
      else update()
    }),
    switchRow(
      "Follow drifting lines",
      state.follow,
      (checked) => {
        state.follow = checked
        state.moved.clear()
        update()
      },
      "Moves each line onto the nearest edge, for pictures whose cells grow or shrink across the picture."
    ),
    switchRow("Show grid", state.showGrid, (checked) => {
      state.showGrid = checked
      update()
    }, "G"),
    state.moved.size > 0 &&
      h(
        "div",
        { class: "inline-action" },
        h("span", {}, `${state.moved.size} line${state.moved.size === 1 ? "" : "s"} moved by hand`),
        button("Reset", () => {
          state.moved.clear()
          update()
        }, { variant: "ghost", small: true })
      ),
    group(
      "Reading cells",
      slider(
        "Read middle",
        Math.round((1 - 2 * state.sample.inset) * 100),
        { min: 10, max: 100, step: 5 },
        (value) => `${value}%`,
        (value) => {
          state.sample = { ...state.sample, inset: (1 - value / 100) / 2 }
          update()
        },
        "How much of each cell is read. Less ignores blurred edges; more helps tiny cells."
      ),
      slider(
        "Alpha cutoff",
        state.sample.alphaThreshold,
        { min: 1, max: 255, step: 1 },
        (value) => String(value),
        (value) => {
          state.sample = { ...state.sample, alphaThreshold: value }
          update()
        },
        "Pixels more transparent than this count as transparent."
      )
    )
  )
}

const sizePanel = (): HTMLElement | false => {
  if (grid === undefined) return false
  const size = gridSize(grid)
  const width = state.targetWidth ?? size.width
  const height = Math.max(1, Math.round((size.height * width) / size.width))
  const setWidth = (value: number | undefined): void => {
    state.targetWidth = value === undefined || value >= size.width ? undefined : Math.max(1, Math.round(value))
    update()
  }
  const fractions = [
    { id: "1", label: "Full" },
    { id: "2", label: "½" },
    { id: "3", label: "⅓" },
    { id: "4", label: "¼" }
  ] as const
  const current = fractions.find((fraction) => width === Math.round(size.width / Number(fraction.id)))?.id ?? "custom"
  return sectionOf(
    "size",
    "Size",
    {
      action: h("span", { class: "meta" }, `${width} × ${height}`),
      help: "One pixel per cell is the picture's true size. A smaller width merges blocks of cells into one pixel each, at any ratio. Keeping outlines lets a dark line through a block win over its most common color, so one-pixel outlines survive; a lone dark pixel does not."
    },
    prop("Width", numberInput(width, (value) => setWidth(value), { min: 1, max: size.width, step: 1, suffix: "px", label: "Width" }), "Fewer pixels than cells: each new pixel merges a block of them."),
    prop(
      "Scale",
      segmented(current, fractions, (id) => setWidth(id === "1" ? undefined : size.width / Number(id)), { label: "Scale", class: "fill" })
    ),
    state.targetWidth !== undefined &&
      prop(
        "Merge by",
        selectInput(state.reduceMode, reduceModes, (mode) => {
          state.reduceMode = mode
          update()
        }, "Merge by")
      )
  )
}

// ---------------------------------------------------------------------------
// Palette

/** The swatch whose details show under the palette, by index. */
let selectedSwatch: number | undefined

const setPalette = (name: string, colors: ReadonlyArray<Rgb>): void => {
  state.paletteName = name
  state.swatches = colors.map((color) => ({ color, locked: false }))
  selectedSwatch = undefined
  update()
}

const editedName = (): string => (state.paletteName.endsWith("(edited)") ? state.paletteName : `${state.paletteName} (edited)`)

const colorInput = (hex: string, label: string, onPick: (color: Rgb) => void): HTMLInputElement =>
  h("input", {
    class: "color-input",
    props: { type: "color", value: hex },
    attrs: { "aria-label": label },
    on: {
      change: (event) => {
        const target = event.currentTarget
        if (!(target instanceof HTMLInputElement)) return
        const color = parseHex(target.value)
        if (color !== undefined) onPick(color)
      }
    }
  })

const swatchEditor = (): HTMLElement => {
  const fixed = fixedArt()
  const used = fixed === undefined ? new Map<string, number>() : new Map(usedColors(fixed).map((entry) => [toHex(entry.color), entry.count]))
  if (selectedSwatch !== undefined && selectedSwatch >= state.swatches.length) selectedSwatch = undefined
  const chosen = selectedSwatch === undefined ? undefined : state.swatches[selectedSwatch]
  const add = h("label", { class: "swatch add", title: "Add a color" }, icon("plus"))
  add.append(
    colorInput("#808080", "Add a color", (color) => {
      if (state.paletteName === ORIGINAL) state.paletteName = "Custom"
      state.swatches.push({ color, locked: false })
      state.paletteName = editedName()
      selectedSwatch = state.swatches.length - 1
      update()
    })
  )
  return h(
    "div",
    {},
    h(
      "div",
      { class: "swatches" },
      state.swatches.map((swatch, index) => {
        const hex = toHex(swatch.color)
        const count = used.get(hex) ?? 0
        return h(
          "button",
          {
            class: `swatch${count === 0 ? " unused" : ""}${index === selectedSwatch ? " selected" : ""}`,
            title: `${hex}${count > 0 ? `, ${pixels(count)}` : ", unused"}${swatch.locked ? ", locked" : ""}`,
            attrs: { type: "button", style: `--color:${hex}`, "aria-pressed": String(index === selectedSwatch), "aria-label": `${hex}${swatch.locked ? " (locked)" : ""}` },
            on: {
              click: () => {
                selectedSwatch = index === selectedSwatch ? undefined : index
                update()
              }
            }
          },
          swatch.locked && h("span", { class: "swatch-lock" }, icon("lock"))
        )
      }),
      add
    ),
    chosen !== undefined &&
      selectedSwatch !== undefined &&
      ((index: number, swatch: Swatch) => {
        const hex = toHex(swatch.color)
        const count = used.get(hex) ?? 0
        const picker = h("label", { class: "swatch big", title: "Change this color", attrs: { style: `--color:${hex}` } })
        picker.append(
          colorInput(hex, `Change ${hex}`, (color) => {
            state.swatches[index] = { ...swatch, color }
            state.paletteName = editedName()
            update()
          })
        )
        return h(
          "div",
          { class: "swatch-detail" },
          picker,
          h("div", { class: "swatch-info" }, h("strong", {}, hex), h("span", {}, count > 0 ? `${pixels(count)}` : "Unused")),
          button(swatch.locked ? "Unlock" : "Lock", () => {
            state.swatches[index] = { ...swatch, locked: !swatch.locked }
            update()
          }, { variant: "ghost", small: true, iconOnly: true, icon: swatch.locked ? "lock" : "unlock", pressed: swatch.locked, title: swatch.locked ? "Locked: always kept. Click to unlock" : "Lock: always keep this color" }),
          button("Remove", () => {
            state.swatches.splice(index, 1)
            state.paletteName = editedName()
            selectedSwatch = undefined
            update()
          }, { variant: "ghost", small: true, iconOnly: true, icon: "trash" })
        )
      })(selectedSwatch, chosen)
  )
}

const PICKED = "Picked from the picture"

/** Adds a color to the palette, locked so proposals and "Colors kept" never drop it; locks it if it is there already. */
const keepColor = (color: Rgb): void => {
  if (state.paletteName === ORIGINAL) {
    state.message = "Choose a palette first: without one, every pixel already keeps its own color."
    update()
    return
  }
  const hex = toHex(color)
  const index = state.swatches.findIndex((swatch) => toHex(swatch.color) === hex)
  if (index >= 0) state.swatches[index] = { color, locked: true }
  else state.swatches.push({ color, locked: true })
  if (state.paletteName !== PICKED) state.paletteName = editedName()
  state.message = `Kept ${hex} in the palette, locked.`
  highlight = []
  update()
}

const importText = (text: string, name: string): void => {
  const palette: Palette = parsePalette(text, name)
  if (palette.colors.length === 0) {
    state.message = "No colors found in that palette."
  } else {
    state.message = `Imported ${palette.colors.length} colors.`
    setPalette(palette.name, palette.colors)
  }
  update()
}

const fetchLospec = async (slug: string): Promise<void> => {
  const clean = slug
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/lospec\.com\/palette-list\//, "")
    .replace(/\.(hex|gpl|png)$/, "")
    .replace(/[^a-z0-9-]/g, "")
  if (clean === "") return
  try {
    const response = await fetch(`https://lospec.com/palette-list/${clean}.hex`)
    if (!response.ok) throw new Error(`lospec.com answered ${response.status}`)
    importText(await response.text(), clean)
  } catch (error) {
    state.message = `Could not fetch "${clean}" from Lospec (${error instanceof Error ? error.message : String(error)}). Download its .hex file from lospec.com and import the file instead.`
    update()
  }
}

const palettePanel = (): HTMLElement => {
  const options = [
    { id: ORIGINAL, label: "None: keep the picture's colors" },
    ...presets.map((preset) => ({ id: preset.name, label: preset.name }))
  ]
  if (!options.some((option) => option.id === state.paletteName)) {
    options.push({ id: state.paletteName, label: state.paletteName })
  }
  const paletteFile = h("input", {
    props: { type: "file", accept: ".hex,.gpl,.txt,text/plain" },
    attrs: { hidden: true },
    on: {
      change: () => {
        const file = paletteFile.files?.[0]
        if (file !== undefined) void file.text().then((text) => importText(text, baseName(file.name)))
        paletteFile.value = ""
      }
    }
  })
  const pasted = h("textarea", { class: "textarea", attrs: { rows: 2, placeholder: "#1a1c2c, #5d275d, …", "aria-label": "Hex colors", spellcheck: "false" } })
  const slug = h("input", { props: { type: "text" }, attrs: { placeholder: "endesga-32", "aria-label": "Lospec palette name", spellcheck: "false" } })
  const fixed = fixedArt()
  const used = fixed === undefined ? 0 : usedColors(fixed).length
  return sectionOf(
    "palette",
    "Palette",
    {
      action: state.paletteName !== ORIGINAL && h("span", { class: "meta" }, `${used} of ${state.swatches.length} used`),
      help: "Every pixel gets the palette color nearest to its cell. Click a color to change, lock, or remove it; locked colors are always kept. Faded colors are not used by the picture."
    },
    selectInput(state.paletteName, options, (id) => {
      if (id === ORIGINAL) {
        state.paletteName = ORIGINAL
        update()
        return
      }
      const preset = presets.find((entry) => entry.name === id)
      if (preset !== undefined) setPalette(preset.name, preset.colors)
    }, "Palette"),
    state.paletteName === ORIGINAL ? hint(`Each pixel keeps its cell's own color. ${used} colors in use.`) : swatchEditor(),
    group(
      "Import",
      h(
        "div",
        { class: "stack" },
        button("Open .hex or .gpl file", () => paletteFile.click(), { variant: "secondary", icon: "open", class: "block" }),
        paletteFile,
        h("div", { class: "combo" }, h("label", { class: "input" }, pasted), button("Use", () => importText(pasted.value, "Pasted"), { variant: "secondary" })),
        h("div", { class: "combo" }, h("label", { class: "input" }, h("span", { class: "affix" }, "Lospec"), slug), button("Fetch", () => void fetchLospec(slug.value), { variant: "secondary" }))
      )
    )
  )
}

/** Proposes colors from the picture's cells, leaving out the background when it is removed, and keeps the top ones. */
const propose = (): void => {
  if (state.kind === "animation") {
    if (state.source === undefined) return
    state.proposals = proposeForSheet(state.source.image, animationRecipe(), state.sheet, state.proposeCount, state.proposeMethod, animationCache)
    keepTop(state.keepCount)
    return
  }
  if (samples === undefined) return
  const cells = quantize(samples, { palette: [], metric: state.metric, dither: "none", ditherStrength: 0 })
  const mask = state.removeBackground ? findBackground(cells, backgroundColors(cells), state.background) : undefined
  const colors: Array<Rgb> = []
  cells.indices.forEach((index, i) => {
    if (index !== TRANSPARENT && mask?.[i] !== 1) colors.push(cells.palette[index]!)
  })
  state.proposals = proposePalette(colors, state.proposeCount, state.proposeMethod)
  keepTop(state.keepCount)
}

/** The palette becomes the locked colors and the most used proposals, `count` colors in all. */
const keepTop = (count: number): void => {
  const locked = state.swatches.filter((swatch) => swatch.locked)
  const lockedHex = new Set(locked.map((swatch) => toHex(swatch.color)))
  const picks = state.proposals
    .filter((proposal) => !lockedHex.has(toHex(proposal.color)))
    .slice(0, Math.max(0, count - locked.length))
    .map((proposal) => ({ color: proposal.color, locked: false }))
  state.paletteName = PICKED
  state.swatches = [...locked, ...picks]
  selectedSwatch = undefined
  update()
}

const toggleProposal = (color: Rgb): void => {
  const hex = toHex(color)
  const index = state.swatches.findIndex((swatch) => toHex(swatch.color) === hex)
  if (index >= 0) state.swatches.splice(index, 1)
  else state.swatches.push({ color, locked: false })
  state.paletteName = PICKED
  selectedSwatch = undefined
  update()
}

const proposalPicker = (): HTMLElement | false => {
  if (state.proposals.length === 0) return false
  const inPalette = new Set(state.swatches.map((swatch) => toHex(swatch.color)))
  return h(
    "div",
    { class: "stack" },
    slider(
      "Colors kept",
      Math.min(state.keepCount, state.proposals.length),
      { min: 1, max: state.proposals.length, step: 1 },
      (value) => String(value),
      (value) => {
        state.keepCount = value
        keepTop(value)
      },
      "Keeps the most used proposed colors (locked colors count toward it)."
    ),
    h(
      "div",
      { class: "swatches proposals" },
      state.proposals.map((proposal) => {
        const hex = toHex(proposal.color)
        const on = inPalette.has(hex)
        return h(
          "button",
          {
            class: `proposal${on ? " on" : ""}`,
            title: `${hex}: ${on ? "in the palette, click to remove" : "click to add"}`,
            attrs: { type: "button", "aria-pressed": String(on) },
            on: { click: () => toggleProposal(proposal.color) }
          },
          h("span", { class: "swatch", attrs: { style: `--color:${hex}` } }),
          h("span", { class: "share" }, `${proposal.share >= 0.01 ? Math.round(proposal.share * 100) : "<1"}%`)
        )
      })
    ),
    hint("Most used first. Click a color to add it to the palette or take it out.")
  )
}

const proposePanel = (): HTMLElement =>
  sectionOf(
    "propose",
    "Colors from the picture",
    { help: proposeMethods.map((method) => `${method.label}: ${method.hint}`).join(" ") + " Locked colors always stay." },
    prop("Method", selectInput(state.proposeMethod, proposeMethods, (method) => {
      state.proposeMethod = method
      if (state.proposals.length > 0) propose()
      else update()
    }, "Method"), proposeMethods.find((method) => method.id === state.proposeMethod)!.hint),
    prop(
      "Colors",
      h(
        "div",
        { class: "combo" },
        numberInput(
          state.proposeCount,
          (value) => {
            state.proposeCount = Math.min(64, Math.max(1, Math.round(value)))
            if (state.proposals.length > 0) propose()
            else update()
          },
          { min: 1, max: 64, step: 1, label: "How many colors to propose" }
        ),
        button("Propose", propose, { variant: "secondary", icon: "sparkle", disabled: state.source === undefined })
      )
    ),
    proposalPicker()
  )

const matchingPanel = (): HTMLElement =>
  sectionOf(
    "matching",
    "Matching",
    {
      help: "Each cell is read from its middle, every pixel read votes for its nearest palette color, and the most votes win, so no in-between color is ever made up. Cleaning up merges the small specks of one color an image generator's noise leaves, but only when there is doubt they are real; diagonal neighbours count, so one-pixel outlines are never specks. Locked colors are never cleaned, and painting over a cleaned speck with Restore brings it back."
    },
    prop("Nearest by", selectInput(state.metric, metrics, (metric) => {
      state.metric = metric
      update()
    }, "Nearest color by")),
    prop(
      "Dithering",
      selectInput(
        state.dither,
        [
          { id: "none", label: "Off" },
          { id: "ordered", label: "Ordered (Bayer 4×4)" }
        ],
        (dither) => {
          state.dither = dither
          update()
        },
        "Dithering"
      )
    ),
    state.dither === "ordered" &&
      slider("Dither strength", Math.round(state.ditherStrength * 100), { min: 0, max: 100, step: 5 }, (value) => `${value}%`, (value) => {
        state.ditherStrength = value / 100
        update()
      }),
    group(
      "Clean up specks",
      prop(
        "Specks up to",
        segmented(
          String(state.cleanup.size),
          [
            { id: "0", label: "Off" },
            { id: "1", label: "1 px" },
            { id: "2", label: "2 px" },
            { id: "3", label: "3 px" }
          ],
          (value) => {
            state.cleanup = { ...state.cleanup, size: Number(value) }
            update()
          },
          { label: "Specks up to", class: "fill" }
        )
      ),
      state.cleanup.size > 0 &&
        slider(
          "Strength",
          Math.round(state.cleanup.strength * 100),
          { min: 0, max: 100, step: 5 },
          (value) => `${value}%`,
          (value) => {
            state.cleanup = { ...state.cleanup, strength: value / 100 }
            update()
          },
          "Low merges only specks that were a coin flip, or nearly the color around them. High also merges specks drawn clearly in a different color."
        ),
      state.cleanup.size > 0 &&
        switchRow("Outline cleaned pixels", state.cleanup.show, (checked) => {
          state.cleanup = { ...state.cleanup, show: checked }
          update()
        }),
      state.cleanup.size > 0 &&
        hint(`${specks.length} speck${specks.length === 1 ? "" : "s"} cleaned, ${pixels(specks.reduce((sum, cells) => sum + cells.length, 0))}.`),
      state.cleanKeep.cells.length > 0 &&
        h(
          "div",
          { class: "inline-action" },
          h("span", {}, "Some specks were brought back by hand"),
          button("Clean again", () => {
            state.cleanKeep = { ...state.cleanKeep, cells: [] }
            update()
          }, { variant: "ghost", small: true })
        )
    )
  )

const lostPanel = (): HTMLElement | false => {
  if (state.paletteName === ORIGINAL || result === undefined) return false
  return sectionOf(
    "lost",
    "Lost colors",
    {
      action: lost.length > 0 && badge(String(lost.length), "warn"),
      help: "Details the palette has no match for: pixels whose own color is far from the color they got (a small saturated accent turned dull, a dark grey turned black). Point at a row to see its pixels; Keep adds the color, locked. To keep any other color, choose Pick in the toolbar and click the picture."
    },
    lost.length === 0
      ? hint("None: every pixel is close to the color it got.")
      : h(
          "div",
          { class: "list" },
          lost.map((entry) =>
            h(
              "div",
              {
                class: "list-row",
                on: {
                  mouseenter: () => {
                    highlight = entry.cells
                    update({ panels: false })
                  },
                  mouseleave: () => {
                    highlight = []
                    update({ panels: false })
                  }
                }
              },
              chip(toHex(entry.color)),
              h("span", { class: "arrow" }, "→"),
              chip(toHex(entry.became)),
              h("span", { class: "list-text" }, pixels(entry.cells.length)),
              button("Keep", () => keepColor(entry.color), { variant: "ghost", small: true, title: `Add ${toHex(entry.color)} to the palette, locked` })
            )
          )
        ),
    slider(
      "Lost above",
      Math.round(state.lostThreshold * 100),
      { min: 4, max: 30, step: 1 },
      (value) => String(value),
      (value) => {
        state.lostThreshold = value / 100
        update()
      },
      "How far a pixel's own color may be from the color it got. Lower lists more."
    )
  )
}

const backgroundPanel = (): HTMLElement =>
  sectionOf(
    "background",
    "Background",
    {
      help: "The colors covering most of the border are the background (one, or the two tones of a fake checkerboard). It is flooded in from the border and stops at the outline. To erase or bring back pixels by hand, choose Erase or Restore in the toolbar and paint on the fixed picture, one pixel or a whole area of one color at a time. Paint recolors pixels the same way."
    },
    switchRow(
      "Remove the background",
      state.removeBackground,
      (checked) => {
        state.removeBackground = checked
        update()
      },
      "Makes the background transparent, including a fake checkerboard painted into the picture."
    ),
    state.removeBackground &&
      prop(
        "Found",
        backgroundFound.length === 0
          ? h("span", { class: "meta" }, "No color on the border")
          : h("div", { class: "chips" }, backgroundFound.map((color) => chip(toHex(color))))
      ),
    state.removeBackground &&
      slider(
        "Tolerance",
        Math.round(state.background.tolerance * 100),
        { min: 0, max: 30, step: 1 },
        (value) => String(value),
        (value) => {
          state.background = { ...state.background, tolerance: value / 100 }
          update()
        },
        "How close a color must be to a background color to count as background."
      ),
    state.removeBackground &&
      switchRow(
        "Enclosed areas too",
        state.background.enclosed,
        (checked) => {
          state.background = { ...state.background, enclosed: checked }
          update()
        },
        "Removes background-colored areas the border cannot reach, like a gap between arm and body. Also removes highlights of the same color."
      ),
    state.removeBackground &&
      switchRow(
        "Remove specks",
        state.background.specks,
        (checked) => {
          state.background = { ...state.background, specks: checked }
          update()
        },
        `Also removes groups of up to ${SPECK_SIZE} pixels left alone in the background.`
      ),
    state.removeBackground &&
      switchRow(
        "Remove the shadow",
        state.background.shadow,
        (checked) => {
          state.background = { ...state.background, shadow: checked }
          update()
        },
        "Also removes a drop shadow under the subject: the background's color made darker, with no outline, in the bottom half."
      ),
    h(
      "div",
      { class: "inline-action" },
      h("span", {}, state.edits.strokes.length === 0 ? "Use Erase, Restore, or Paint to edit by hand" : `${state.edits.strokes.length} stroke${state.edits.strokes.length === 1 ? "" : "s"} by hand`),
      state.edits.strokes.length > 0 &&
        button("Clear", () => {
          state.edits.strokes = []
          update()
        }, { variant: "ghost", small: true })
    )
  )

// ---------------------------------------------------------------------------
// Check and export

/** What the CLI's `pixel check` says about the result, against the project's rules. */
const checkPanel = (): HTMLElement => {
  const current = report
  const errors = current === undefined ? 0 : current.issues.filter((issue) => issue.severity === "error").length
  const status: { readonly text: string; readonly tone: "good" | "warn" | "bad" } | undefined =
    current === undefined
      ? undefined
      : current.verdict === "needs-person"
        ? { text: "Needs a look", tone: "bad" }
        : errors > 0
          ? { text: `${errors} broken`, tone: "warn" }
          : { text: current.kind === "pixel-art" ? "Clean" : "Confident", tone: "good" }
  return sectionOf(
    "check",
    "Check",
    {
      action: status !== undefined && badge(status.text, status.tone),
      help: "The same check agents run with the pixel CLI: how sure the grid is, and the project's rules. Open a pixel.config.json to take a project's rules, palette, and settings."
    },
    current !== undefined && h("p", { class: "summary" }, current.summary),
    current !== undefined &&
      current.issues.length > 0 &&
      h(
        "ul",
        { class: "issues" },
        current.issues.map((issue) => h("li", { class: issue.severity }, icon(issue.severity === "error" ? "alert" : "info"), h("span", {}, issue.message)))
      ),
    group(
      "Rules",
      prop("Sizes", textInput(state.rules.sizes, (value) => {
        state.rules = { ...state.rules, sizes: value }
        update()
      }, { placeholder: "Any, or 16x16, 32x32", label: "Allowed sizes" }), "Sizes the art may have, like \"16x16, 32x32\""),
      prop(
        "Max colors",
        numberInput(
          state.rules.maxColors,
          (value) => {
            state.rules = { ...state.rules, maxColors: value >= 1 ? Math.round(value) : undefined }
            update()
          },
          { min: 0, step: 1, label: "Max colors", placeholder: "Any" }
        ),
        "The most colors the art may use (empty: any)"
      ),
      switchRow("Transparent background", state.rules.transparentBackground, (checked) => {
        state.rules = { ...state.rules, transparentBackground: checked }
        update()
      }, "The art is a sprite: its background must be transparent.")
    )
  )
}

const preview = h("canvas", { class: "preview" })

/** The fixed picture at a whole scale that fits the panel. */
const drawPreview = (): void => {
  const art = exported
  if (art === undefined) return
  const scale = Math.max(1, Math.min(8, Math.floor(200 / Math.max(art.width, art.height))))
  const image = canvasOf(toRgba(art, scale))
  preview.width = image.width
  preview.height = image.height
  const context = preview.getContext("2d")!
  context.clearRect(0, 0, preview.width, preview.height)
  context.drawImage(image, 0, 0)
}

const exportPanel = (): HTMLElement | false => {
  const art = exported
  if (art === undefined) return false
  const name = state.source === undefined ? "pixel-art" : baseName(state.source.name)
  drawPreview()
  const paletteOf = (): Palette => ({ name: state.paletteName === ORIGINAL ? name : state.paletteName, colors: usedColors(art).map((entry) => entry.color) })
  const scale = state.exportScale
  return sectionOf(
    "export",
    "Export",
    {
      action: h("span", { class: "meta" }, `${art.width} × ${art.height} · ${usedColors(art).length} colors`),
      help: "PNG at 1× is the true pixel art. The SVG is drawn in pixel units with crisp edges, so it stays sharp at any size; the scale only sets the size it opens at. The JSON map holds the palette and one row of palette indices per pixel row (-1 for transparent). The recipe holds every setting, hand edits included: open it here again, or run it with pixel fix --recipe."
    },
    h("div", { class: "preview-box" }, preview),
    switchRow(
      "Crop to the subject",
      state.crop,
      (checked) => {
        state.crop = checked
        update()
      },
      "Exports without the transparent margins: only the box around what is left once the background is removed."
    ),
    prop(
      "Scale",
      selectInput(
        String(scale),
        [1, 2, 4, 8, 16, 32].map((option) => ({ id: String(option), label: `${option}×  ·  ${art.width * option} × ${art.height * option}` })),
        (value) => {
          state.exportScale = Number(value)
          update()
        },
        "Export scale"
      )
    ),
    h(
      "div",
      { class: "export-main" },
      button("PNG 1×", () => void pngOf(art, 1).then((blob) => download(`${name}-fixed.png`, blob)), { variant: "primary", icon: "download" }),
      button(`PNG ${scale}×`, () => void pngOf(art, scale).then((blob) => download(`${name}-fixed-${scale}x.png`, blob)), { variant: "secondary", icon: "download", disabled: scale === 1 })
    ),
    group(
      "Other formats",
      h(
        "div",
        { class: "export-grid" },
        button("SVG", () => download(`${name}-fixed.svg`, toSvg(art, scale), "image/svg+xml"), { variant: "secondary", small: true }),
        button("JSON map", () => download(`${name}-fixed.json`, toJson(art), "application/json"), { variant: "secondary", small: true }),
        button("Sprite text", () => download(`${name}-fixed.sprite.txt`, formatSprite(art)), {
          variant: "secondary",
          small: true,
          disabled: usedColors(art).length > 70,
          title: "The fixed picture as text: one letter per color, one row per pixel row"
        }),
        button("Recipe", () => download(`${name}.recipe.json`, encodeRecipe(recipeOf()), "application/json"), {
          variant: "secondary",
          small: true,
          title: "Every setting, hand edits included: open it here again, or run it with pixel fix --recipe"
        }),
        button("Palette .hex", () => download(`${name}-palette.hex`, toHexFile(paletteOf())), { variant: "secondary", small: true }),
        button("Palette .gpl", () => download(`${name}-palette.gpl`, toGpl(paletteOf())), { variant: "secondary", small: true })
      )
    )
  )
}

const RITMO_URL = "https://ritmo.typeonce.dev/"

/** Where the tool comes from, at the end of the settings. */
const aboutPanel = (): HTMLElement =>
  h(
    "footer",
    { class: "about" },
    h("div", { class: "ruler", attrs: { "aria-hidden": "true" } }),
    h("div", { class: "about-head" }, mark(), "Pixel fixer, by Ritmo"),
    h(
      "p",
      {},
      "A free tool from ",
      h("a", { attrs: { href: RITMO_URL, target: "_blank", rel: "noopener" } }, "Ritmo"),
      ", the agent-first type safe ECS runtime. Agents run the same fixes from the command line: ",
      h("code", {}, "pixel check"),
      ", ",
      h("code", {}, "pixel fix"),
      ". A recipe saved here runs there, and back."
    )
  )

/** Before a picture is open: what the tool does, in three steps. */
const introPanel = (): HTMLElement =>
  h(
    "div",
    { class: "intro" },
    h("h2", {}, "Fix AI-made pixel art"),
    h(
      "ol",
      {},
      h("li", {}, h("strong", {}, "Open a picture."), " The grid of fake pixels is found for you."),
      h("li", {}, h("strong", {}, "Pick a palette."), " Every pixel snaps to its nearest color."),
      h("li", {}, h("strong", {}, "Export"), " crisp pixel art at its true size, as PNG or SVG."),
      h("li", {}, h("strong", {}, "Animation sheets"), " play as animations, frame by frame on one grid, ready as a sprite sheet or a GIF.")
    )
  )

// ---------------------------------------------------------------------------
// Animation: frames, playback, and the frames' panel

/** The animation's frames on the canvas, in the order they play, as positions in `animation.placed`. */
const playing = (): Array<number> => playOrder(animation?.placed.length ?? 0, state.sheet.loop)

/** The frame on screen, as a position in `animation.placed`. */
const shownFrame = (): number => {
  const order = playing()
  return order.length === 0 ? 0 : order[((frame % order.length) + order.length) % order.length]!
}

/** The sheet's frames, changed with `change`. */
const setFrames = (change: (frames: Array<Sheet["frames"][number]>) => void): void => {
  const frames = [...state.sheet.frames]
  change(frames)
  state.sheet = { ...state.sheet, frames }
  update()
}

const setFrameBox = (index: number, box: Box): void =>
  setFrames((frames) => {
    const current = frames[index]
    if (current !== undefined) frames[index] = { ...current, box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.max(1, Math.round(box.width)), height: Math.max(1, Math.round(box.height)) } }
  })

/** Adds a frame drawn by hand, in reading order: before the first frame below it or to its right on the same row. */
const addFrame = (box: Box): void => {
  const middle = box.y + box.height / 2
  const at = state.sheet.frames.findIndex((other) => {
    const sameRow = middle >= other.box.y && middle <= other.box.y + other.box.height
    return sameRow ? other.box.x > box.x : other.box.y > middle
  })
  const index = at < 0 ? state.sheet.frames.length : at
  state.selectedFrame = index
  state.message = `Frame ${index + 1} added.`
  setFrames((frames) => frames.splice(index, 0, frameOf({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) })))
}

const removeFrame = (index: number): void => {
  state.selectedFrame = undefined
  setFrames((frames) => frames.splice(index, 1))
}

const toggleFrame = (index: number): void =>
  setFrames((frames) => {
    const current = frames[index]
    if (current !== undefined) frames[index] = { ...current, include: !current.include }
  })

/** Moves a frame by whole pixels on the animation's canvas. */
const nudgeFrame = (index: number, dx: number, dy: number): void =>
  setFrames((frames) => {
    const current = frames[index]
    if (current !== undefined) frames[index] = { ...current, nudge: { x: current.nudge.x + dx, y: current.nudge.y + dy } }
  })

/** The frames found again, replacing every box (hand nudges and left-out frames are dropped). */
const findFramesAgain = (): void => {
  const source = state.source
  if (source === undefined) return
  const found = detectFrames(source.image, { ...recipeOf(), removeBackground: true }, animationCache)
  state.selectedFrame = undefined
  state.message = found.length === 0 ? "No frames found: draw boxes with the Boxes tool." : `Found ${found.length} frame${found.length === 1 ? "" : "s"}.`
  setFrames((frames) => frames.splice(0, frames.length, ...found))
}

/** Steps the animation by `by` frames, stopping playback. */
const step = (by: number): void => {
  state.playing = false
  frame += by
  const placed = animation?.placed[shownFrame()]
  if (placed !== undefined) state.selectedFrame = placed.index
  update()
}

/** Whether the animation should be moving on screen now. */
const shouldPlay = (): boolean => state.playing && state.kind === "animation" && state.animationView !== "sheet" && state.source !== undefined

let looping = false
let lastTick: number | undefined
const tick = (now: number): void => {
  if (!shouldPlay()) {
    looping = false
    lastTick = undefined
    return
  }
  const every = 1000 / Math.max(0.5, state.sheet.fps)
  if (lastTick === undefined) lastTick = now
  else if (now - lastTick >= every) {
    // A slow frame skips ahead instead of slowing the animation down.
    frame += Math.floor((now - lastTick) / every)
    lastTick = now - ((now - lastTick) % every)
    renderPlayer()
    renderCounter()
  }
  requestAnimationFrame(tick)
}

/** Starts the playback loop when the animation should be playing and it is not running yet. */
const keepPlaying = (): void => {
  if (looping || !shouldPlay()) return
  looping = true
  lastTick = undefined
  requestAnimationFrame(tick)
}

const counter = h("span", { class: "frame-counter" })

const renderCounter = (): void => {
  const count = playing().length
  const placed = animation?.placed[shownFrame()]
  counter.textContent = count === 0 ? "No frames" : `Frame ${placed === undefined ? "" : placed.index + 1} · ${(frame % count + count) % count + 1}/${count}`
}

const renderPlayer = (): void => {
  const outcome = animation
  if (outcome === undefined) return
  const order = playing()
  const position = order.length === 0 ? 0 : ((frame % order.length) + order.length) % order.length
  const chosen = state.selectedFrame === undefined ? -1 : outcome.placed.findIndex((placed) => placed.index === state.selectedFrame)
  player.setScene({
    frames: outcome.placed.map((placed) => placed.art),
    numbers: outcome.placed.map((placed) => placed.index + 1),
    view: state.animationView === "frames" ? "frames" : "play",
    current: state.animationView === "frames" ? chosen : shownFrame(),
    onion: state.onion && order.length > 1 ? order[(position - 1 + order.length) % order.length] : undefined,
    anchor: state.sheet.anchor === "box" ? undefined : outcome.placed[0]?.anchor,
    showGrid: state.showGrid
  })
}

/** The floating bar under the animation: play, step, frame rate, how it loops, and onion skin. */
const renderPlayback = (): void => {
  playback.hidden = state.source === undefined || state.kind !== "animation" || state.animationView === "sheet"
  if (playback.hidden) return
  renderCounter()
  replace(
    playback,
    button("Previous frame", () => step(-1), { variant: "ghost", icon: "previous", iconOnly: true, small: true, title: "Previous frame (,)" }),
    button(state.playing ? "Pause" : "Play", () => {
      state.playing = !state.playing
      update()
    }, { variant: "ghost", icon: state.playing ? "pause" : "play", iconOnly: true, title: state.playing ? "Pause (Space)" : "Play (Space)" }),
    button("Next frame", () => step(1), { variant: "ghost", icon: "next", iconOnly: true, small: true, title: "Next frame (.)" }),
    counter,
    h("span", { class: "divider" }),
    h(
      "label",
      { class: "fps", title: "Frames per second" },
      numberInput(state.sheet.fps, (value) => {
        state.sheet = { ...state.sheet, fps: Math.min(60, Math.max(0.5, value)) }
        update()
      }, { min: 0.5, max: 60, step: 1, label: "Frames per second", suffix: "fps" })
    ),
    segmented(
      state.sheet.loop,
      [
        { id: "forward", label: "Loop", title: "Plays start to end, then again" },
        { id: "pingpong", label: "Ping-pong", title: "Plays there and back" }
      ],
      (loop) => {
        state.sheet = { ...state.sheet, loop }
        update()
      },
      { label: "Loop" }
    ),
    segmented(
      state.onion ? "on" : "off",
      [{ id: "on", label: "Onion skin", icon: "onion", iconOnly: true, title: "Show the frame before, faintly, under the frame playing" }],
      () => {
        state.onion = !state.onion
        update()
      },
      { label: "Onion skin" }
    )
  )
}

const framesPanel = (): HTMLElement | false => {
  const outcome = animation
  if (outcome === undefined) return false
  const frames = state.sheet.frames
  const included = frames.filter((entry) => entry.include).length
  const selected = state.selectedFrame === undefined ? undefined : frames[state.selectedFrame]
  return sectionOf(
    "frames",
    "Frames",
    {
      action: button("Find again", findFramesAgain, { variant: "ghost", small: true, icon: "wand", title: "Find the frames again (drops boxes changed by hand)" }),
      help:
        "Each box on the sheet is one frame, fixed with the same settings. Choose Boxes in the toolbar over the sheet to move a box, drag its edges, or draw a new one on empty space; a box left out keeps its place but is not in the animation. Every frame is placed so its anchor stays on one spot; nudge a frame by a pixel with the arrow keys when it looks off."
    },
    callout(
      included >= 2 ? "good" : "warn",
      `${frames.length} frame${frames.length === 1 ? "" : "s"} on the sheet, ${included} in the animation, ${outcome.width} × ${outcome.height} each.`
    ),
    h(
      "div",
      { class: "frame-list" },
      frames.map((entry, i) => {
        const nudged = entry.nudge.x !== 0 || entry.nudge.y !== 0
        return h(
          "div",
          {
            class: `frame-row${state.selectedFrame === i ? " on" : ""}${entry.include ? "" : " out"}`,
            on: {
              click: () => {
                state.selectedFrame = i
                const position = outcome.placed.findIndex((placed) => placed.index === i)
                if (position >= 0) {
                  state.playing = false
                  frame = Math.max(0, playing().indexOf(position))
                }
                update()
              }
            }
          },
          h("span", { class: "frame-number" }, String(i + 1)),
          h("span", { class: "list-text" }, `${entry.box.width} × ${entry.box.height} px${nudged ? ` · moved ${entry.nudge.x}, ${entry.nudge.y}` : ""}`),
          button(entry.include ? "In" : "Out", (event) => {
            event.stopPropagation()
            toggleFrame(i)
          }, { variant: "ghost", small: true, title: entry.include ? "In the animation: click to leave it out" : "Left out: click to put it back" })
        )
      })
    ),
    selected !== undefined &&
      h(
        "div",
        { class: "inline-action" },
        h("span", {}, `Frame ${state.selectedFrame! + 1}: arrow keys move it`),
        (selected.nudge.x !== 0 || selected.nudge.y !== 0) &&
          button("Reset", () => nudgeFrame(state.selectedFrame!, -selected.nudge.x, -selected.nudge.y), { variant: "ghost", small: true }),
        button("Remove", () => removeFrame(state.selectedFrame!), { variant: "ghost", small: true, icon: "trash", title: "Remove this frame's box (Delete)" })
      ),
    prop(
      "Anchor",
      segmented(state.sheet.anchor, anchors.map((entry) => ({ id: entry.id, label: entry.label, title: entry.hint })), (anchor) => {
        state.sheet = { ...state.sheet, anchor }
        update()
      }, { label: "Anchor", class: "fill" }),
      anchors.find((entry) => entry.id === state.sheet.anchor)!.hint
    ),
    prop(
      "Margin",
      numberInput(state.sheet.padding, (value) => {
        state.sheet = { ...state.sheet, padding: Math.max(0, Math.round(value)) }
        update()
      }, { min: 0, max: 64, step: 1, suffix: "px", label: "Margin" }),
      "Empty pixels kept around the frames, on every side."
    ),
    group(
      "Playback",
      prop("Speed", numberInput(state.sheet.fps, (value) => {
        state.sheet = { ...state.sheet, fps: Math.min(60, Math.max(0.5, value)) }
        update()
      }, { min: 0.5, max: 60, step: 1, suffix: "fps", label: "Speed" }), "Frames per second, saved in the JSON and the GIF."),
      prop(
        "Loop",
        segmented(
          state.sheet.loop,
          [
            { id: "forward", label: "Loop" },
            { id: "pingpong", label: "Ping-pong" }
          ],
          (loop) => {
            state.sheet = { ...state.sheet, loop }
            update()
          },
          { label: "Loop", class: "fill" }
        )
      )
    )
  )
}

/** The animation's grid: one cell size for every frame, found in all of them or typed; each frame finds its own offset. */
const sheetGridPanel = (): HTMLElement | false => {
  const outcome = animation
  if (outcome === undefined) return false
  const confidence = outcome.confidence
  const note =
    state.sheetCell !== undefined
      ? `Cells of ${state.sheetCell} px, as typed. Each frame finds its own offset.`
      : `Found ${Math.round(outcome.cell.width * 100) / 100} px cells across the frames${confidence === undefined ? "" : `, confidence ${Math.round(confidence * 100)}%`}. Each frame finds its own offset.`
  return sectionOf(
    "grid",
    "Grid",
    {
      action: button("Auto-detect", () => {
        state.sheetCell = undefined
        update()
      }, { variant: "ghost", small: true, icon: "wand", title: "Find the cell size in the frames again" }),
      help: "Every frame is read at one cell size, so the animation keeps one scale. Image generators draw each frame on its own, so each frame finds where its grid starts. Turn the grid on to see each frame's lines on the sheet."
    },
    callout(state.sheetCell !== undefined || (confidence ?? 0) >= 0.5 ? "good" : "warn", note),
    prop(
      "Cell size",
      numberInput(Math.round(outcome.cell.width * 1000) / 1000, (value) => {
        state.sheetCell = Math.max(1, value)
        update()
      }, { min: 1, label: "Cell size", suffix: "px" }),
      "Source pixels per pixel, for every frame. Fractions are fine."
    ),
    switchRow("Show grid", state.showGrid, (checked) => {
      state.showGrid = checked
      update()
    }, "G"),
    group(
      "Reading cells",
      slider(
        "Read middle",
        Math.round((1 - 2 * state.sample.inset) * 100),
        { min: 10, max: 100, step: 5 },
        (value) => `${value}%`,
        (value) => {
          state.sample = { ...state.sample, inset: (1 - value / 100) / 2 }
          update()
        },
        "How much of each cell is read. Less ignores blurred edges; more helps tiny cells."
      )
    )
  )
}

/** Clearing the sheet: its background, a grid painted behind the frames, and their boxes. */
const sheetBackgroundPanel = (): HTMLElement =>
  sectionOf(
    "background",
    "Background",
    {
      help: "The colors covering most of the sheet's border are its background, including a grid painted behind the frames and the frames' borders. They are cleared from the border inward, and stop at each sprite's outline. Labels under the frames are outside the boxes, so they are not in the animation."
    },
    switchRow("Clear the sheet's background", state.removeBackground, (checked) => {
      state.removeBackground = checked
      update()
    }, "Makes the sheet's background transparent before the frames are read."),
    state.removeBackground &&
      prop(
        "Found",
        backgroundFound.length === 0
          ? h("span", { class: "meta" }, "No color on the border")
          : h("div", { class: "chips" }, backgroundFound.map((color) => chip(toHex(color))))
      ),
    state.removeBackground &&
      slider(
        "Tolerance",
        Math.round(state.background.tolerance * 100),
        { min: 0, max: 30, step: 1 },
        (value) => String(value),
        (value) => {
          state.background = { ...state.background, tolerance: value / 100 }
          update()
        },
        "How close a color must be to a background color to be cleared. Raise it when a haze is left around the sprites; lower it when parts of a sprite go missing."
      )
  )

const exportLayout = (): SheetLayout => ({
  columns: state.exportLayout.kind === "strip" ? Math.max(1, animation?.placed.length ?? 1) : Math.max(1, state.exportLayout.columns),
  spacing: state.exportLayout.spacing
})

const bytesOf = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer())

const animationExportPanel = (): HTMLElement | false => {
  const outcome = animation
  const art = exported
  if (outcome === undefined || art === undefined || outcome.placed.length === 0) return false
  const name = state.source === undefined ? "animation" : baseName(state.source.name)
  drawPreview()
  const scale = state.exportScale
  const layout = exportLayout()
  const frames = outcome.placed.map((placed) => placed.art)
  const anchor = outcome.placed[0]!.anchor
  const sheetName = scale === 1 ? `${name}-sheet.png` : `${name}-sheet-${scale}x.png`
  const json = (): string =>
    spritesheetJson({ name, image: sheetName, frameWidth: outcome.width, frameHeight: outcome.height, count: frames.length, layout, scale, fps: state.sheet.fps, loop: state.sheet.loop, anchor })
  const paletteOf = (): Palette => ({ name: state.paletteName === ORIGINAL ? name : state.paletteName, colors: usedColors(art).map((entry) => entry.color) })
  return sectionOf(
    "export",
    "Export",
    {
      action: h("span", { class: "meta" }, `${frames.length} × ${outcome.width} × ${outcome.height} · ${usedColors(art).length} colors`),
      help: "The sheet holds every frame on one picture, as a strip or in rows, with a JSON file saying where each frame is, how long it shows, and where it stands (its anchor): Pixi's Spritesheet, Phaser's atlas, and Aseprite's JSON read it. The GIF plays the animation to share it. Frames gives each frame as its own PNG, in a ZIP. The recipe holds every setting and every box: open it here again, or run it with pixel sheet --recipe."
    },
    h("div", { class: "preview-box" }, preview),
    prop(
      "Layout",
      segmented(
        state.exportLayout.kind,
        [
          { id: "strip", label: "Strip" },
          { id: "grid", label: "Rows" }
        ],
        (kind) => {
          state.exportLayout = { ...state.exportLayout, kind }
          update()
        },
        { label: "Layout", class: "fill" }
      ),
      "One row of frames, or rows of a few frames each."
    ),
    state.exportLayout.kind === "grid" &&
      prop("Per row", numberInput(state.exportLayout.columns, (value) => {
        state.exportLayout = { ...state.exportLayout, columns: Math.max(1, Math.round(value)) }
        update()
      }, { min: 1, step: 1, label: "Frames per row" })),
    prop("Spacing", numberInput(state.exportLayout.spacing, (value) => {
      state.exportLayout = { ...state.exportLayout, spacing: Math.max(0, Math.round(value)) }
      update()
    }, { min: 0, step: 1, suffix: "px", label: "Spacing" }), "Empty pixels between frames on the sheet."),
    prop(
      "Scale",
      selectInput(
        String(scale),
        [1, 2, 4, 8, 16].map((option) => ({ id: String(option), label: `${option}×  ·  ${art.width * option} × ${art.height * option}` })),
        (value) => {
          state.exportScale = Number(value)
          update()
        },
        "Export scale"
      )
    ),
    h(
      "div",
      { class: "export-main" },
      button("Sheet PNG", () => void pngOf(art, scale).then((blob) => download(sheetName, blob)), { variant: "primary", icon: "download" }),
      button("JSON", () => download(`${name}-sheet${scale === 1 ? "" : `-${scale}x`}.json`, json(), "application/json"), {
        variant: "secondary",
        icon: "download",
        title: "Where each frame is on the sheet PNG at this scale, its duration, and its anchor"
      })
    ),
    group(
      "Other formats",
      h(
        "div",
        { class: "export-grid" },
        button("GIF", () => {
          const order = playOrder(frames.length, state.sheet.loop).map((i) => frames[i]!)
          download(`${name}.gif`, new Blob([toGif(order, { scale: Math.max(scale, 1), delay: 1000 / state.sheet.fps })], { type: "image/gif" }))
        }, { variant: "secondary", small: true, title: "The animation playing, at this scale, looping" }),
        button("Frames .zip", () => {
          void Promise.all(frames.map(async (frameArt, i) => ({ name: `${name}-${i}.png`, bytes: await bytesOf(await pngOf(frameArt, scale)) }))).then((entries) =>
            download(`${name}-frames.zip`, new Blob([toZip(entries)], { type: "application/zip" }))
          )
        }, { variant: "secondary", small: true, title: "Each frame as its own PNG, at this scale" }),
        button("Recipe", () => download(`${name}.recipe.json`, encodeRecipe(animationRecipe()), "application/json"), {
          variant: "secondary",
          small: true,
          title: "Every setting and every frame's box: open it here again, or run it with pixel sheet --recipe"
        }),
        button("Palette .hex", () => download(`${name}-palette.hex`, toHexFile(paletteOf())), { variant: "secondary", small: true }),
        button("Palette .gpl", () => download(`${name}-palette.gpl`, toGpl(paletteOf())), { variant: "secondary", small: true })
      )
    )
  )
}

// ---------------------------------------------------------------------------
// The top bar and the floating tools

const TOOLS = [
  { id: "move", label: "Move", icon: "move", title: "Move: drag to pan (V)" },
  { id: "lines", label: "Lines", icon: "lines", title: "Lines: drag a grid line onto an edge in the source (L)" },
  { id: "erase", label: "Erase", icon: "erase", title: "Erase: paint pixels transparent (E)" },
  { id: "restore", label: "Restore", icon: "restore", title: "Restore: paint erased pixels back (R)" },
  { id: "paint", label: "Paint", icon: "brush", title: "Paint: paint pixels a palette color; Alt-click a pixel to take its color (B)" },
  { id: "pick", label: "Pick", icon: "pick", title: "Pick: click a pixel to keep its color (I)" }
] as const satisfies ReadonlyArray<{ id: State["tool"]; label: string; icon: IconName; title: string }>

/** The tools over an animation's sheet: look around, or edit the frames' boxes. */
const SHEET_TOOLS = [
  { id: "move", label: "Move", icon: "move", title: "Move: drag to pan (V)" },
  { id: "frames", label: "Boxes", icon: "frames", title: "Boxes: drag a frame's box to move it, its edges to resize it, or draw a new one on empty space (F)" }
] as const satisfies ReadonlyArray<{ id: State["tool"]; label: string; icon: IconName; title: string }>

const setTool = (id: State["tool"]): void => {
  if (state.kind === "animation" && id !== "move" && id !== "frames") return
  if (state.kind === "picture" && id === "frames") return
  state.tool = id
  if (id === "frames") state.animationView = "sheet"
  // Painting happens on the fixed picture; grid lines are moved on the source.
  if ((id === "erase" || id === "restore" || id === "paint") && state.mode === "source") state.mode = "result"
  if (id === "paint" && state.paintColor === undefined) state.paintColor = paintColors()[0]
  if (id === "lines") {
    state.showGrid = true
    if (state.mode === "result") state.mode = "source"
  }
  update()
}

const renderTopbar = (): void => {
  const source = state.source
  const size = grid === undefined ? undefined : gridSize(grid)
  const out = result === undefined ? size : { width: result.width, height: result.height }
  replace(
    topbar,
    h(
      "div",
      { class: "topbar-start" },
      h(
        "div",
        { class: "brand" },
        mark(),
        h("span", {}, "Pixel fixer"),
        h("a", { class: "by", title: "Ritmo, the agent-first type safe ECS runtime", attrs: { href: RITMO_URL, target: "_blank", rel: "noopener" } }, "by ", h("b", {}, "ritmo"))
      ),
      source !== undefined &&
        h(
          "div",
          { class: "file", title: source.name },
          h("span", { class: "file-name" }, source.name),
          h(
            "span",
            { class: "file-meta" },
            state.kind === "animation" && animation !== undefined
              ? `${source.image.width} × ${source.image.height} → ${animation.placed.length} × ${animation.width} × ${animation.height}`
              : `${source.image.width} × ${source.image.height}${out === undefined ? "" : ` → ${out.width} × ${out.height}`}`
          )
        ),
      source !== undefined &&
        segmented(
          state.kind,
          [
            { id: "picture", label: "Picture", icon: "image", title: "Fix it as one picture" },
            { id: "animation", label: "Animation", icon: "film", title: "Fix it as an animation: one frame per box, played in order" }
          ],
          setKind,
          { label: "Fix as", class: "kind" }
        )
    ),
    h(
      "div",
      { class: "topbar-center" },
      source !== undefined &&
        state.kind === "picture" &&
        segmented(
          state.mode,
          [
            { id: "source", label: "Source" },
            { id: "compare", label: "Compare" },
            { id: "result", label: "Fixed" }
          ],
          (mode) => {
            state.mode = mode
            update()
          },
          { label: "View" }
        ),
      source !== undefined &&
        state.kind === "animation" &&
        segmented(
          state.animationView,
          [
            { id: "sheet", label: "Sheet", title: "The sheet with each frame's box" },
            { id: "frames", label: "Frames", title: "The fixed frames side by side" },
            { id: "play", label: "Play", title: "The animation playing" }
          ],
          (view) => {
            state.animationView = view
            if (view !== "sheet" && state.tool === "frames") state.tool = "move"
            refit = true
            update()
          },
          { label: "View" }
        )
    ),
    h(
      "div",
      { class: "topbar-end" },
      h(
        "div",
        { class: "button-group" },
        button("Undo", () => history.undo(), { variant: "ghost", icon: "undo", iconOnly: true, disabled: !history.canUndo(), title: "Undo (Ctrl/Cmd+Z)" }),
        button("Redo", () => history.redo(), { variant: "ghost", icon: "redo", iconOnly: true, disabled: !history.canRedo(), title: "Redo (Ctrl/Cmd+Shift+Z)" })
      ),
      h("span", { class: "divider" }),
      button("Demo", openDemo, { variant: "ghost", class: "hide-narrow", title: "Open the demo picture" }),
      button("Open", () => fileInput.click(), { variant: "secondary", icon: "open", title: "Open a picture, sprite source, recipe, or pixel.config.json" }),
      button("Export", () => reveal("export", () => update()), { variant: "primary", icon: "download", disabled: result === undefined && (animation?.placed.length ?? 0) === 0 })
    )
  )
}

const renderTools = (): void => {
  tools.hidden = state.source === undefined || (state.kind === "animation" && state.animationView !== "sheet")
  zoomBox.hidden = state.source === undefined
  if (tools.hidden) return
  if (state.kind === "animation") {
    const index = state.selectedFrame
    const chosen = index === undefined ? undefined : state.sheet.frames[index]
    replace(
      tools,
      segmented(state.tool, SHEET_TOOLS, setTool, { label: "Tool", class: "tool-strip" }),
      segmented(
        state.sheetShows,
        [
          { id: "cleared", label: "Cleared", icon: "erase", title: "The sheet with its background cleared: what the frames are read from" },
          { id: "original", label: "Original", icon: "image", title: "The sheet as it was opened" }
        ],
        (shows) => {
          state.sheetShows = shows
          update()
        },
        { label: "Sheet", class: "tool-strip" }
      ),
      chosen !== undefined &&
        index !== undefined &&
        h(
          "div",
          { class: "box-actions" },
          h("span", { class: "paint-hint" }, `Frame ${index + 1}`),
          button(chosen.include ? "Leave out" : "Put back", () => toggleFrame(index), { variant: "ghost", small: true }),
          button("Remove", () => removeFrame(index), { variant: "ghost", small: true, icon: "trash", iconOnly: true, title: "Remove this box (Delete)" })
        )
    )
    return
  }
  const painting = isPainting()
  replace(
    tools,
    segmented(state.tool, TOOLS, setTool, { label: "Tool", class: "tool-strip" }),
    painting &&
      segmented(
        state.brush,
        [
          { id: "pixel", label: "Pixel", icon: "pixel", title: "One pixel at a time" },
          { id: "area", label: "Area", icon: "area", title: "The whole connected area of one color" }
        ],
        (brush) => {
          state.brush = brush
          update()
        },
        { label: "Brush", class: "tool-strip" }
      ),
    state.tool === "paint" && paintStrip()
  )
}

const isPainting = (): boolean => state.tool === "erase" || state.tool === "restore" || state.tool === "paint"

/** The colors Paint offers: the palette's, or without one the colors the fixed picture uses. */
const paintColors = (): Array<Rgb> => {
  if (state.paletteName !== ORIGINAL) return state.swatches.map((swatch) => swatch.color)
  if (result === undefined) return []
  const used = new Set(Array.from(result.indices).filter((index) => index !== TRANSPARENT))
  return used.size > 48 ? [] : [...used].map((index) => result!.palette[index]!)
}

/** The color Paint paints, and the palette to choose it from. */
const paintStrip = (): HTMLElement => {
  const current = state.paintColor === undefined ? undefined : toHex(state.paintColor)
  return h(
    "div",
    { class: "paint-colors", attrs: { role: "group", "aria-label": "Paint color" } },
    paintColors().map((color) => {
      const hex = toHex(color)
      return h("button", {
        class: `paint-color${hex === current ? " on" : ""}`,
        title: hex,
        attrs: { type: "button", style: `--color:${hex}`, "aria-pressed": String(hex === current), "aria-label": hex },
        on: {
          click: () => {
            state.paintColor = color
            update()
          }
        }
      })
    }),
    h("span", { class: "paint-hint" }, current === undefined ? "Alt-click a pixel to take its color" : "Alt-click takes a color")
  )
}

const zoomText = h("span", { class: "zoom-value" })

/** Whether the stage shows the animation's frames (the player) rather than a picture or the sheet (the viewer). */
const showsPlayer = (): boolean => state.kind === "animation" && state.animationView !== "sheet"

const renderZoom = (): void => {
  zoomText.textContent = `${Math.round((showsPlayer() ? player.zoom() : viewer.zoom()) * 100)}%`
}

replace(
  zoomBox,
  button("Zoom out", () => (showsPlayer() ? player.zoomBy(1 / 1.5) : viewer.zoomBy(1 / 1.5)), { variant: "ghost", icon: "minus", iconOnly: true, small: true }),
  zoomText,
  button("Zoom in", () => (showsPlayer() ? player.zoomBy(1.5) : viewer.zoomBy(1.5)), { variant: "ghost", icon: "plus", iconOnly: true, small: true }),
  button("Fit", () => (showsPlayer() ? player.fit() : viewer.fit()), { variant: "ghost", icon: "fit", iconOnly: true, small: true, title: "Fit the picture (Shift+1, or double-click it)" })
)

let toastTimer: ReturnType<typeof setTimeout> | undefined
let shownMessage = ""

/** Shows the latest message for a few seconds at the bottom of the picture. */
const renderToast = (): void => {
  if (state.message === shownMessage) return
  shownMessage = state.message
  if (toastTimer !== undefined) clearTimeout(toastTimer)
  if (state.message === "") {
    toast.classList.remove("on")
    return
  }
  replace(toast, h("span", {}, state.message), button("Dismiss", () => {
    state.message = ""
    renderToast()
  }, { variant: "ghost", icon: "close", iconOnly: true, small: true }))
  toast.classList.add("on")
  toastTimer = setTimeout(() => {
    state.message = ""
    renderToast()
  }, 6000)
}

// Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes; text fields keep their own undo.
// Single keys pick a tool (V, L, E, R, B, I), toggle the grid (G), or fit the picture (Shift+1).
window.addEventListener("keydown", (event) => {
  const target = event.target
  if (target instanceof HTMLInputElement && target.type !== "range" && target.type !== "checkbox") return
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
  const key = event.key.toLowerCase()
  if (event.metaKey || event.ctrlKey) {
    if (key === "z" && !event.shiftKey) {
      event.preventDefault()
      history.undo()
    } else if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault()
      history.redo()
    }
    return
  }
  if (event.altKey || state.source === undefined) return
  if (state.kind === "animation") {
    // Space plays, comma and period step, arrows move the chosen (or shown) frame by a pixel, Delete removes a box.
    const target = state.selectedFrame ?? (state.animationView === "play" ? animation?.placed[shownFrame()]?.index : undefined)
    const arrows: Record<string, readonly [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }
    const arrow = arrows[key]
    const keys: Record<string, () => void> = {
      " ": () => {
        state.playing = !state.playing
        update()
      },
      ",": () => step(-1),
      ".": () => step(1),
      v: () => setTool("move"),
      f: () => setTool("frames"),
      g: () => {
        state.showGrid = !state.showGrid
        update()
      },
      delete: () => {
        if (state.selectedFrame !== undefined && state.animationView === "sheet") removeFrame(state.selectedFrame)
      },
      backspace: () => {
        if (state.selectedFrame !== undefined && state.animationView === "sheet") removeFrame(state.selectedFrame)
      },
      "!": () => (showsPlayer() ? player.fit() : viewer.fit())
    }
    if (arrow !== undefined && target !== undefined && state.animationView !== "sheet") {
      event.preventDefault()
      state.playing = false
      state.selectedFrame = target
      nudgeFrame(target, arrow[0] * (event.shiftKey ? 4 : 1), arrow[1] * (event.shiftKey ? 4 : 1))
      return
    }
    const action = keys[event.shiftKey && event.code === "Digit1" ? "!" : key]
    if (action !== undefined) {
      event.preventDefault()
      action()
    }
    return
  }
  const shortcuts: Record<string, () => void> = {
    v: () => setTool("move"),
    l: () => setTool("lines"),
    b: () => setTool("paint"),
    e: () => setTool("erase"),
    r: () => setTool("restore"),
    i: () => setTool("pick"),
    g: () => {
      state.showGrid = !state.showGrid
      update()
    },
    "!": () => viewer.fit()
  }
  const action = shortcuts[event.shiftKey && event.code === "Digit1" ? "!" : key]
  if (action !== undefined) {
    event.preventDefault()
    action()
  }
})

const render = (rebuildPanels: boolean): void => {
  empty.hidden = state.source !== undefined
  renderTopbar()
  renderTools()
  renderPlayback()
  renderZoom()
  renderToast()
  if (rebuildPanels) {
    // Panels are rebuilt whole; keep the scroll position, and the field being typed in, where the user left them.
    const scroll = panels.scrollTop
    const active = document.activeElement
    const focused = active instanceof HTMLInputElement && panels.contains(active) && active.type === "text" ? active.getAttribute("aria-label") : null
    const typed = active instanceof HTMLInputElement ? active.value : ""
    replace(
      panels,
      state.source === undefined
        ? [introPanel(), palettePanel(), matchingPanel(), checkPanel(), aboutPanel()]
        : state.kind === "animation"
          ? [framesPanel(), sheetGridPanel(), palettePanel(), proposePanel(), matchingPanel(), sheetBackgroundPanel(), checkPanel(), animationExportPanel(), aboutPanel()]
          : [gridPanel(), sizePanel(), palettePanel(), proposePanel(), matchingPanel(), lostPanel(), backgroundPanel(), checkPanel(), exportPanel(), aboutPanel()]
    )
    panels.scrollTop = scroll
    if (focused !== null) {
      const field = [...panels.querySelectorAll("input")].find((input) => input.getAttribute("aria-label") === focused)
      if (field !== undefined) {
        field.value = typed
        field.focus({ preventScroll: true })
        field.setSelectionRange(typed.length, typed.length)
      }
    }
  } else {
    drawPreview()
  }
  const onPlayer = showsPlayer()
  canvas.hidden = onPlayer
  playerCanvas.hidden = !onPlayer
  if (onPlayer) {
    renderPlayer()
    keepPlaying()
  } else if (state.kind === "animation" && animation !== undefined) {
    const shown = state.sheetShows === "cleared" && clearedCanvas !== undefined ? clearedCanvas.canvas : state.source?.canvas
    viewer.setScene({
      source: shown,
      grid: undefined,
      result: undefined,
      mode: "source",
      showGrid: state.showGrid,
      moved: new Set(),
      painting: false,
      picking: false,
      adjusting: false,
      highlight: [],
      marked: [],
      painted: [],
      boxes: state.sheet.frames.map((entry) => ({ ...entry.box, include: entry.include })),
      frameGrids: animation.frames.map((entry) => {
        const dx = Math.max(0, Math.round(entry.box.x))
        const dy = Math.max(0, Math.round(entry.box.y))
        return { xs: entry.outcome.grid.xs.map((cut) => cut + dx), ys: entry.outcome.grid.ys.map((cut) => cut + dy) }
      }),
      selectedBox: state.selectedFrame,
      editingBoxes: state.tool === "frames"
    })
  } else {
    viewer.setScene({
      source: state.source?.canvas,
      grid,
      result,
      mode: state.mode,
      showGrid: state.showGrid,
      moved: new Set(state.moved.keys()),
      painting: isPainting() && result !== undefined,
      picking: state.tool === "pick",
      adjusting: state.tool === "lines",
      highlight,
      marked: state.cleanup.size > 0 && state.cleanup.show ? specks.flat() : [],
      painted
    })
  }
  if (refit) {
    refit = false
    if (onPlayer) player.fit()
    else viewer.fit()
  }
}

update()
