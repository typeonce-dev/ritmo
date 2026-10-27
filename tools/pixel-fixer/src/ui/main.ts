/**
 * The pixel fixer's page: one state object, a pipeline that recomputes the
 * fixed picture when anything changes, and panels that edit the state.
 */
import {
  backgroundColors,
  defaultBackgroundOptions,
  findBackground,
  SPECK_SIZE,
  type BackgroundOptions,
  type Edit
} from "../core/background.ts"
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
import { reportOfArt, reportOfFix, type Report } from "../core/report.ts"
import { formatSprite, parseJsonMap, parseSprite } from "../core/sprite.ts"
import { reduceModes, type ReduceMode } from "../core/reduce.ts"
import { h, replace } from "./dom.ts"
import { baseName, canvasOf, download, loadImage, pngOf } from "./files.ts"
import { makeHistory } from "./history.ts"
import { makeViewer, type ViewMode } from "./viewer.ts"

interface Swatch {
  readonly color: Rgb
  readonly locked: boolean
}

interface State {
  source: { readonly image: RgbaImage; readonly canvas: HTMLCanvasElement; readonly name: string } | undefined
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
  background: BackgroundOptions
  /** What pressing on the fixed picture does: pan, or erase or restore pixels. */
  tool: "move" | "erase" | "restore" | "pick"
  /** How far (OKLab) a cell's own color may be from the palette color it got before it counts as lost. */
  lostThreshold: number
  /** Whether erasing or restoring takes one pixel or its whole area of one color. */
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
  removeBackground: false,
  background: defaultBackgroundOptions,
  tool: "move",
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
  () => renderToolbar()
)

// The pipeline's cache: a slider for dithering must not re-detect the grid.
let cache: PipelineCache = {}
let grid: Grid | undefined
let samples: CellSamples | undefined
let result: PixelArt | undefined
/** The background colors found in the last result, for the Background panel. */
let backgroundFound: Array<Rgb> = []
/** The colors the palette lost in the last result, and the cells of the one pointed at. */
let lost: Array<LostColor> = []
let highlight: ReadonlyArray<number> = []
/** The specks cleaned in the last result, each as its cells. */
let specks: ReadonlyArray<ReadonlyArray<number>> = []
/** What `pixel check` would say about the last result. */
let report: Report | undefined

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
  background: state.background,
  lostThreshold: state.lostThreshold,
  edits: state.edits
})

/** "16x16, 32x32" as sizes; anything unreadable is left out. */
const parseSizes = (text: string): Array<{ width: number; height: number }> =>
  [...text.matchAll(/(\d+)\s*[x×]\s*(\d+)/g)].map((match) => ({ width: Number(match[1]), height: Number(match[2]) }))

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
    report = undefined
    return
  }
  const outcome = runWithSpec(source.image, recipeOf(), state.spec, state.detection, cache)
  grid = outcome.grid
  samples = outcome.samples
  lost = [...outcome.lost]
  specks = outcome.specks
  backgroundFound = [...outcome.backgroundFound]
  result = outcome.art
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
  cache = {}
  samples = undefined
  state.message = ""
  history.reset()
  if (spec === undefined) {
    autoDetect()
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
  state.background = recipe.background
  state.lostThreshold = recipe.lostThreshold
  state.edits = { size: recipe.edits.size, strokes: recipe.edits.strokes.map((stroke) => [...stroke]) }
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
// The page

const app = document.getElementById("app")!
const canvas = h("canvas", { class: "view", attrs: { "aria-label": "Picture view" } })
const viewer = makeViewer(canvas, {
  moveLine: (axis: Axis, index: number, position: number) => {
    state.moved.set(`${axis}:${index}`, position)
    update()
  },
  viewChanged: () => renderStatus(),
  pick: (x: number, y: number) => {
    const cell = samples?.cells[y * samples.width + x]
    if (cell !== undefined && cell.colors.length > 0) keepColor(medianColor(cell.colors))
  },
  paint: (x: number, y: number, start: boolean) => {
    // Restoring over a cleaned speck brings the speck back, when the picture has one pixel per cell.
    if (state.tool === "restore" && grid !== undefined && state.targetWidth === undefined) {
      const cell = y * gridSize(grid).width + x
      const speck = specks.find((cells) => cells.includes(cell))
      if (speck !== undefined) state.cleanKeep.cells.push(...speck)
    }
    if (start) state.edits.strokes.push([])
    state.edits.strokes[state.edits.strokes.length - 1]!.push({ x, y, erase: state.tool === "erase", area: state.brush === "area" })
    update()
  }
})

const status = h("div", { class: "status" })
const toolbar = h("div", { class: "toolbar" })
const panels = h("div", { class: "panels" })
const empty = h(
  "div",
  { class: "empty" },
  h("p", { class: "empty-title" }, "Drop a picture here"),
  h("p", {}, "or paste one, or pick a file. Everything stays on this device."),
  h("p", { class: "hint" }, "Sprite sources (.txt), JSON maps, recipes, and pixel.config.json open here too."),
  h(
    "div",
    { class: "row center" },
    h("button", { class: "primary", on: { click: () => fileInput.click() } }, "Open a picture"),
    h("button", { on: { click: openDemo } }, "Try the demo")
  )
)
const stage = h("div", { class: "stage" }, canvas, empty, status)

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

app.append(
  h(
    "header",
    { class: "top" },
    h("h1", {}, "Pixel fixer"),
    h("p", { class: "tagline" }, "Turns blurry or AI-made pixel art into true pixels, in your palette.")
  ),
  h("main", { class: "layout" }, h("section", { class: "viewer" }, toolbar, stage), panels),
  fileInput
)

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
// Small form pieces

const numberField = (
  label: string,
  value: number,
  onChange: (value: number) => void,
  options: { min?: number; max?: number; step?: number; title?: string } = {}
): HTMLElement =>
  h(
    "label",
    { class: "field", title: options.title },
    h("span", {}, label),
    h("input", {
      props: { type: "number", value: String(value), step: String(options.step ?? 0.01) },
      attrs: { min: options.min, max: options.max, inputmode: "decimal" },
      on: {
        change: (event) => {
          const target = event.currentTarget
          if (!(target instanceof HTMLInputElement)) return
          const next = Number(target.value)
          if (Number.isFinite(next)) onChange(next)
        }
      }
    })
  )

const checkbox = (label: string, checked: boolean, onChange: (checked: boolean) => void, title?: string): HTMLElement =>
  h(
    "label",
    { class: "check", title },
    h("input", {
      props: { type: "checkbox", checked },
      on: {
        change: (event) => {
          const target = event.currentTarget
          if (target instanceof HTMLInputElement) onChange(target.checked)
        }
      }
    }),
    h("span", {}, label)
  )

const slider = (
  label: string,
  value: number,
  range: { min: number; max: number; step: number },
  show: (value: number) => string,
  onChange: (value: number) => void,
  title?: string
): HTMLElement => {
  // While dragging, the picture follows but the panels stay; they catch up on release.
  const output = h("output", {}, show(value))
  return h(
    "label",
    { class: "field slider", title },
    h("span", {}, label, " ", output),
    h("input", {
      props: { type: "range", min: String(range.min), max: String(range.max), step: String(range.step), value: String(value) },
      on: {
        input: (event) => {
          const target = event.currentTarget
          if (!(target instanceof HTMLInputElement)) return
          output.textContent = show(Number(target.value))
          dragging = true
          onChange(Number(target.value))
          dragging = false
        },
        change: () => update()
      }
    })
  )
}

const select = <T extends string>(
  label: string,
  value: T,
  options: ReadonlyArray<{ readonly id: T; readonly label: string }>,
  onChange: (value: T) => void
): HTMLElement =>
  h(
    "label",
    { class: "field" },
    h("span", {}, label),
    h(
      "select",
      {
        on: {
          change: (event) => {
            const target = event.currentTarget
            if (!(target instanceof HTMLSelectElement)) return
            const chosen = options.find((option) => option.id === target.value)
            if (chosen !== undefined) onChange(chosen.id)
          }
        }
      },
      options.map((option) => h("option", { props: { value: option.id, selected: option.id === value } }, option.label))
    )
  )

const panel = (title: string, ...children: Array<Node | false | undefined>): HTMLElement =>
  h("section", { class: "panel" }, h("h2", {}, title), children)

// ---------------------------------------------------------------------------
// Panels

const setSpec = (next: Partial<GridSpec>): void => {
  state.spec = { ...state.spec, ...next }
  state.moved.clear()
  update()
}

const gridPanel = (): HTMLElement => {
  const source = state.source
  const size = grid === undefined ? undefined : gridSize(grid)
  return panel(
    "Grid",
    h(
      "div",
      { class: "row" },
      h("button", { class: "primary", on: { click: autoDetect }, attrs: { disabled: source === undefined } }, "Auto-detect"),
      state.moved.size > 0 &&
        h(
          "button",
          {
            on: {
              click: () => {
                state.moved.clear()
                update()
              }
            }
          },
          `Reset ${state.moved.size} moved line${state.moved.size === 1 ? "" : "s"}`
        )
    ),
    state.detectionNote !== "" &&
      h(
        "p",
        { class: `note ${state.noteGood ? "good" : "warn"}` },
        state.detectionNote
      ),
    h(
      "div",
      { class: "grid2" },
      numberField(
        "Cell width",
        state.spec.cellWidth,
        (value) => setSpec(state.linked ? { cellWidth: Math.max(1, value), cellHeight: Math.max(1, value) } : { cellWidth: Math.max(1, value) }),
        { min: 1, title: "Source pixels per pixel, across. Fractions are fine." }
      ),
      numberField(
        "Cell height",
        state.spec.cellHeight,
        (value) => setSpec(state.linked ? { cellWidth: Math.max(1, value), cellHeight: Math.max(1, value) } : { cellHeight: Math.max(1, value) }),
        { min: 1, title: "Source pixels per pixel, down." }
      ),
      numberField("Offset X", state.spec.offsetX, (value) => setSpec({ offsetX: value }), {
        step: 0.25,
        title: "Where the first full cell starts, from the left edge."
      }),
      numberField("Offset Y", state.spec.offsetY, (value) => setSpec({ offsetY: value }), {
        step: 0.25,
        title: "Where the first full cell starts, from the top edge."
      })
    ),
    checkbox("Square cells", state.linked, (checked) => {
      state.linked = checked
      if (checked) setSpec({ cellHeight: state.spec.cellWidth })
      else update()
    }),
    checkbox(
      "Follow drifting lines",
      state.follow,
      (checked) => {
        state.follow = checked
        state.moved.clear()
        update()
      },
      "Moves each line onto the nearest edge, for pictures whose cells grow or shrink across the picture."
    ),
    checkbox("Show grid", state.showGrid, (checked) => {
      state.showGrid = checked
      update()
    }),
    h("p", { class: "hint" }, "Drag a single line on the picture to fix it by hand. Moved lines turn yellow."),
    size !== undefined && h("p", { class: "stat" }, `One pixel per cell: ${size.width} × ${size.height} pixels`),
    size !== undefined && sizeControls(size),
    h("h3", {}, "Reading cells"),
    slider(
      "Read the middle",
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
      "Transparent below alpha",
      state.sample.alphaThreshold,
      { min: 1, max: 255, step: 1 },
      (value) => String(value),
      (value) => {
        state.sample = { ...state.sample, alphaThreshold: value }
        update()
      }
    )
  )
}

const sizeControls = (size: { readonly width: number; readonly height: number }): HTMLElement => {
  const width = state.targetWidth ?? size.width
  const setWidth = (value: number | undefined): void => {
    state.targetWidth = value === undefined || value >= size.width ? undefined : Math.max(1, Math.round(value))
    update()
  }
  const fraction = (label: string, divisor: number): HTMLElement =>
    h(
      "button",
      {
        class: width === Math.round(size.width / divisor) ? "toggle on" : "toggle",
        on: { click: () => setWidth(divisor === 1 ? undefined : size.width / divisor) }
      },
      label
    )
  return h(
    "div",
    {},
    h("h3", {}, "Size"),
    h(
      "div",
      { class: "row" },
      numberField("Width", width, (value) => setWidth(value), {
        min: 1,
        max: size.width,
        step: 1,
        title: "Fewer pixels than cells: each new pixel merges a block of them."
      }),
      fraction("Full", 1),
      fraction("½", 2),
      fraction("⅓", 3),
      fraction("¼", 4)
    ),
    state.targetWidth !== undefined &&
      select("Merge by", state.reduceMode, reduceModes, (mode) => {
        state.reduceMode = mode
        update()
      }),
    state.targetWidth !== undefined &&
      h(
        "p",
        { class: "hint" },
        state.reduceMode === "outlines"
          ? "Each pixel takes its block's most common color, but a dark line through the block wins, so one-pixel outlines survive."
          : "Each pixel takes its block's most common color."
      )
  )
}

const setPalette = (name: string, colors: ReadonlyArray<Rgb>): void => {
  state.paletteName = name
  state.swatches = colors.map((color) => ({ color, locked: false }))
  update()
}

const editedName = (): string => (state.paletteName.endsWith("(edited)") ? state.paletteName : `${state.paletteName} (edited)`)

const swatchEditor = (): HTMLElement => {
  const used = result === undefined ? new Map<string, number>() : new Map(usedColors(result).map((entry) => [toHex(entry.color), entry.count]))
  return h(
    "div",
    { class: "swatches" },
    state.swatches.map((swatch, index) => {
      const hex = toHex(swatch.color)
      const count = used.get(hex) ?? 0
      const picker = h("input", {
        props: { type: "color", value: hex },
        attrs: { "aria-label": `Edit ${hex}` },
        on: {
          change: (event) => {
            const target = event.currentTarget
            if (!(target instanceof HTMLInputElement)) return
            const color = parseHex(target.value)
            if (color === undefined) return
            state.swatches[index] = { ...swatch, color }
            state.paletteName = editedName()
            update()
          }
        }
      })
      return h(
        "div",
        { class: `swatch${count === 0 ? " unused" : ""}`, title: `${hex}${count > 0 ? `, ${count} pixels` : ", unused"}` },
        h("span", { class: "chip", attrs: { style: `background:${hex}` } }, picker),
        h(
          "button",
          {
            class: `icon${swatch.locked ? " on" : ""}`,
            title: swatch.locked ? "Locked: kept when extracting" : "Lock: keep when extracting",
            on: {
              click: () => {
                state.swatches[index] = { ...swatch, locked: !swatch.locked }
                update()
              }
            }
          },
          swatch.locked ? "🔒" : "🔓"
        ),
        h(
          "button",
          {
            class: "icon",
            title: "Remove",
            on: {
              click: () => {
                state.swatches.splice(index, 1)
                state.paletteName = editedName()
                update()
              }
            }
          },
          "×"
        )
      )
    }),
    h(
      "label",
      { class: "swatch add", title: "Add a color" },
      h("span", { class: "chip add-chip" }, "+"),
      h("input", {
        props: { type: "color", value: "#808080" },
        attrs: { "aria-label": "Add a color" },
        on: {
          change: (event) => {
            const target = event.currentTarget
            if (!(target instanceof HTMLInputElement)) return
            const color = parseHex(target.value)
            if (color === undefined) return
            if (state.paletteName === ORIGINAL) state.paletteName = "Custom"
            state.swatches.push({ color, locked: false })
            state.paletteName = editedName()
            update()
          }
        }
      })
    )
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
  state.message = `Kept ${hex} in the palette (locked).`
  highlight = []
  update()
}

const lostPanel = (): HTMLElement | false => {
  if (state.paletteName === ORIGINAL || result === undefined) return false
  return panel(
    "Lost colors",
    lost.length === 0
      ? h("p", { class: "hint" }, "None: every pixel is close to the palette color it got.")
      : h(
          "div",
          { class: "lost" },
          lost.map((entry) =>
            h(
              "div",
              {
                class: "lost-row",
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
              h("span", { class: "chip mini", title: toHex(entry.color), attrs: { style: `background:${toHex(entry.color)}` } }),
              h("span", { class: "hint" }, "→"),
              h("span", { class: "chip mini", title: toHex(entry.became), attrs: { style: `background:${toHex(entry.became)}` } }),
              h("span", { class: "lost-count" }, `${entry.cells.length} px`),
              h("button", { title: `Add ${toHex(entry.color)} to the palette, locked`, on: { click: () => keepColor(entry.color) } }, "Keep")
            )
          )
        ),
    slider(
      "Lost when off by",
      Math.round(state.lostThreshold * 100),
      { min: 4, max: 30, step: 1 },
      (value) => String(value),
      (value) => {
        state.lostThreshold = value / 100
        update()
      },
      "How far a pixel's own color may be from the color it got. Lower lists more."
    ),
    h(
      "p",
      { class: "hint" },
      "Pixels whose own color is far from the palette color they got, grouped by color. Point at a row to see them; Keep adds the color, locked. To keep any other color, pick Pick above the picture and click it."
    )
  )
}

/** Proposes colors from the picture's cells, leaving out the background when it is removed, and keeps the top ones. */
const propose = (): void => {
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
  update()
}

const toggleProposal = (color: Rgb): void => {
  const hex = toHex(color)
  const index = state.swatches.findIndex((swatch) => toHex(swatch.color) === hex)
  if (index >= 0) state.swatches.splice(index, 1)
  else state.swatches.push({ color, locked: false })
  state.paletteName = PICKED
  update()
}

const proposalPicker = (): HTMLElement | false => {
  if (state.proposals.length === 0) return false
  const inPalette = new Set(state.swatches.map((swatch) => toHex(swatch.color)))
  return h(
    "div",
    {},
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
      { class: "swatches" },
      state.proposals.map((proposal) => {
        const hex = toHex(proposal.color)
        const on = inPalette.has(hex)
        return h(
          "button",
          {
            class: `swatch proposal${on ? " on" : ""}`,
            title: `${hex}: ${on ? "in the palette, click to remove" : "click to add"}`,
            attrs: { "aria-pressed": on },
            on: { click: () => toggleProposal(proposal.color) }
          },
          h("span", { class: "chip", attrs: { style: `background:${hex}` } }),
          h("span", { class: "share" }, `${proposal.share >= 0.01 ? Math.round(proposal.share * 100) : "<1"}%`)
        )
      })
    ),
    h("p", { class: "hint" }, "Most used first, with the share of the picture each covers. Click a color to add or remove it.")
  )
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
    { id: ORIGINAL, label: "Keep the picture's colors (no palette)" },
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
  const pasted = h("textarea", { attrs: { rows: 2, placeholder: "Paste hex colors: #1a1c2c, 5d275d, …" } })
  const slug = h("input", { props: { type: "text" }, attrs: { placeholder: "Lospec name, e.g. endesga-32" } })
  const used = result === undefined ? 0 : usedColors(result).length
  return panel(
    "Palette",
    select("Palette", state.paletteName, options, (id) => {
      if (id === ORIGINAL) {
        state.paletteName = ORIGINAL
        update()
        return
      }
      const preset = presets.find((entry) => entry.name === id)
      if (preset !== undefined) setPalette(preset.name, preset.colors)
    }),
    state.paletteName === ORIGINAL
      ? h("p", { class: "hint" }, `Each pixel keeps its cell's own color (the median). ${used} colors in use.`)
      : h(
          "div",
          {},
          h("p", { class: "stat" }, `${used} of ${state.swatches.length} colors in use. Click a color to edit it.`),
          swatchEditor()
        ),
    h("h3", {}, "From the picture"),
    select("Propose by", state.proposeMethod, proposeMethods, (method) => {
      state.proposeMethod = method
      if (state.proposals.length > 0) propose()
      else update()
    }),
    h("p", { class: "hint" }, proposeMethods.find((method) => method.id === state.proposeMethod)!.hint),
    h(
      "div",
      { class: "row" },
      numberField(
        "Propose",
        state.proposeCount,
        (value) => {
          state.proposeCount = Math.min(64, Math.max(1, Math.round(value)))
          if (state.proposals.length > 0) propose()
          else update()
        },
        { min: 1, max: 64, step: 1, title: "How many colors to propose." }
      ),
      h("button", { on: { click: propose }, attrs: { disabled: state.source === undefined } }, "Propose colors")
    ),
    proposalPicker(),
    h("p", { class: "hint" }, "Locked colors always stay in the palette."),
    h("h3", {}, "Import"),
    h(
      "div",
      { class: "row" },
      h("button", { on: { click: () => paletteFile.click() } }, "Open .hex or .gpl"),
      paletteFile
    ),
    h(
      "div",
      { class: "row" },
      pasted,
      h("button", { on: { click: () => importText(pasted.value, "Pasted") } }, "Use")
    ),
    h(
      "div",
      { class: "row" },
      slug,
      h("button", { on: { click: () => void fetchLospec(slug.value) } }, "Fetch")
    ),
    h("h3", {}, "Matching"),
    select("Nearest color by", state.metric, metrics, (metric) => {
      state.metric = metric
      update()
    }),
    select(
      "Dithering",
      state.dither,
      [
        { id: "none", label: "Off (majority color per cell)" },
        { id: "ordered", label: "Ordered (Bayer 4×4)" }
      ],
      (dither) => {
        state.dither = dither
        update()
      }
    ),
    state.dither === "ordered" &&
      slider("Strength", Math.round(state.ditherStrength * 100), { min: 0, max: 100, step: 5 }, (value) => `${value}%`, (value) => {
        state.ditherStrength = value / 100
        update()
      }),
    h("h3", {}, "Clean up specks"),
    select(
      "Specks up to",
      String(state.cleanup.size),
      [
        { id: "0", label: "Off" },
        { id: "1", label: "1 pixel" },
        { id: "2", label: "2 pixels" },
        { id: "3", label: "3 pixels" }
      ],
      (value) => {
        state.cleanup = { ...state.cleanup, size: Number(value) }
        update()
      }
    ),
    state.cleanup.size > 0 &&
      h(
        "div",
        {},
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
        checkbox("Show cleaned pixels", state.cleanup.show, (checked) => {
          state.cleanup = { ...state.cleanup, show: checked }
          update()
        }),
        h(
          "p",
          { class: "stat" },
          `${specks.length} speck${specks.length === 1 ? "" : "s"} cleaned (${specks.reduce((sum, cells) => sum + cells.length, 0)} pixels), outlined in yellow.`
        ),
        state.cleanKeep.cells.length > 0 &&
          h(
            "button",
            {
              on: {
                click: () => {
                  state.cleanKeep = { ...state.cleanKeep, cells: [] }
                  update()
                }
              }
            },
            "Clean the brought-back specks again"
          ),
        h(
          "p",
          { class: "hint" },
          "A speck is a group of one color this small (diagonal neighbours count, so thin outlines are never specks). It takes the color it touches most, unless it is clearly drawn and far from that color. Locked colors are never cleaned. Paint over a cleaned speck with Restore to bring it back."
        )
      )
  )
}

const backgroundPanel = (): HTMLElement =>
  panel(
    "Background",
    checkbox(
      "Remove the background",
      state.removeBackground,
      (checked) => {
        state.removeBackground = checked
        update()
      },
      "Makes the background transparent, including a fake checkerboard painted into the picture."
    ),
    state.removeBackground &&
      h(
        "div",
        {},
        backgroundFound.length === 0
          ? h("p", { class: "hint" }, "No background color found on the border.")
          : h(
              "div",
              { class: "row" },
              h("span", { class: "hint" }, "Found on the border:"),
              backgroundFound.map((color) =>
                h("span", { class: "chip mini", title: toHex(color), attrs: { style: `background:${toHex(color)}` } })
              )
            ),
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
        checkbox(
          "Also enclosed areas",
          state.background.enclosed,
          (checked) => {
            state.background = { ...state.background, enclosed: checked }
            update()
          },
          "Removes background-colored areas the border cannot reach, like a gap between arm and body. Also removes highlights of the same color."
        ),
        checkbox(
          "Remove specks",
          state.background.specks,
          (checked) => {
            state.background = { ...state.background, specks: checked }
            update()
          },
          `Also removes groups of up to ${SPECK_SIZE} pixels left alone in the background.`
        )
      ),
    h(
      "p",
      { class: "hint" },
      "To erase or bring back pixels by hand, pick Erase or Restore above the picture, then paint on the fixed picture: one pixel at a time, or a whole area of one color."
    ),
    state.edits.strokes.length > 0 &&
      h(
        "div",
        { class: "row" },
        h(
          "button",
          {
            on: {
              click: () => {
                state.edits.strokes = []
                update()
              }
            }
          },
          `Clear ${state.edits.strokes.length} stroke${state.edits.strokes.length === 1 ? "" : "s"}`
        )
      )
  )

// Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes; text fields keep their own undo.
window.addEventListener("keydown", (event) => {
  const target = event.target
  if (target instanceof HTMLInputElement && target.type !== "range" && target.type !== "checkbox") return
  if (target instanceof HTMLTextAreaElement) return
  if (!(event.metaKey || event.ctrlKey)) return
  const key = event.key.toLowerCase()
  if (key === "z" && !event.shiftKey) {
    event.preventDefault()
    history.undo()
  } else if ((key === "z" && event.shiftKey) || key === "y") {
    event.preventDefault()
    history.redo()
  }
})

/** What the CLI's `pixel check` says about the result, against the project's rules. */
const checkPanel = (): HTMLElement => {
  const current = report
  const broken = current !== undefined && (current.verdict === "needs-person" || current.issues.some((issue) => issue.severity === "error"))
  return panel(
    "Check",
    current !== undefined &&
      h(
        "p",
        { class: `note ${broken ? "warn" : "good"}` },
        current.summary
      ),
    current !== undefined &&
      current.issues.length > 0 &&
      h(
        "ul",
        { class: "issues" },
        current.issues.map((issue) => h("li", { class: issue.severity }, h("strong", {}, issue.severity === "error" ? "Error" : "Warning"), " ", issue.message))
      ),
    h(
      "div",
      { class: "grid2" },
      h(
        "label",
        { class: "field", title: 'Sizes the art may have, like "16x16, 32x32" (empty: any)' },
        h("span", {}, "Allowed sizes"),
        h("input", {
          props: { type: "text", value: state.rules.sizes, placeholder: "any" },
          on: {
            change: (event) => {
              const target = event.currentTarget
              if (!(target instanceof HTMLInputElement)) return
              state.rules = { ...state.rules, sizes: target.value }
              update()
            }
          }
        })
      ),
      numberField(
        "Max colors",
        state.rules.maxColors ?? 0,
        (value) => {
          state.rules = { ...state.rules, maxColors: value >= 1 ? Math.round(value) : undefined }
          update()
        },
        { min: 0, step: 1, title: "The most colors the art may use (0: any)" }
      )
    ),
    checkbox("Background must be transparent", state.rules.transparentBackground, (checked) => {
      state.rules = { ...state.rules, transparentBackground: checked }
      update()
    }),
    h("p", { class: "hint" }, "The same check agents run with the pixel CLI. Open a pixel.config.json to take a project's rules.")
  )
}

const preview = h("canvas", { class: "preview" })

/** The fixed picture at a whole scale that fits the panel. */
const drawPreview = (): void => {
  const art = result
  if (art === undefined) return
  const scale = Math.max(1, Math.min(8, Math.floor(240 / Math.max(art.width, art.height))))
  const pixels = canvasOf(toRgba(art, scale))
  preview.width = pixels.width
  preview.height = pixels.height
  const context = preview.getContext("2d")!
  context.clearRect(0, 0, preview.width, preview.height)
  context.drawImage(pixels, 0, 0)
}

const exportPanel = (): HTMLElement => {
  const name = state.source === undefined ? "pixel-art" : baseName(state.source.name)
  const art = result
  const disabled = art === undefined
  drawPreview()
  const paletteOf = (): Palette =>
    art === undefined
      ? { name, colors: [] }
      : { name: state.paletteName === ORIGINAL ? name : state.paletteName, colors: usedColors(art).map((entry) => entry.color) }
  return panel(
    "Export",
    art !== undefined && h("div", { class: "preview-box" }, preview),
    art !== undefined && h("p", { class: "stat" }, `${art.width} × ${art.height} pixels, ${usedColors(art).length} colors`),
    select(
      "Scale",
      String(state.exportScale),
      [1, 2, 4, 8, 16, 32].map((scale) => ({
        id: String(scale),
        label: art === undefined ? `${scale}×` : `${scale}× (${art.width * scale} × ${art.height * scale})`
      })),
      (value) => {
        state.exportScale = Number(value)
        update()
      }
    ),
    h(
      "div",
      { class: "buttons" },
      h(
        "button",
        {
          class: "primary",
          attrs: { disabled },
          on: { click: () => art && void pngOf(art, 1).then((blob) => download(`${name}-fixed.png`, blob)) }
        },
        "PNG 1×"
      ),
      h(
        "button",
        {
          attrs: { disabled },
          on: {
            click: () =>
              art && void pngOf(art, state.exportScale).then((blob) => download(`${name}-fixed-${state.exportScale}x.png`, blob))
          }
        },
        `PNG ${state.exportScale}×`
      ),
      h(
        "button",
        { attrs: { disabled }, on: { click: () => art && download(`${name}-fixed.svg`, toSvg(art, state.exportScale), "image/svg+xml") } },
        "SVG"
      ),
      h(
        "button",
        { attrs: { disabled }, on: { click: () => art && download(`${name}-fixed.json`, toJson(art), "application/json") } },
        "JSON map"
      ),
      h("button", { attrs: { disabled }, on: { click: () => download(`${name}-palette.hex`, toHexFile(paletteOf())) } }, "Palette .hex"),
      h("button", { attrs: { disabled }, on: { click: () => download(`${name}-palette.gpl`, toGpl(paletteOf())) } }, "Palette .gpl"),
      h(
        "button",
        {
          attrs: { disabled: disabled || usedColors(art).length > 70 },
          title: "The fixed picture as text: one letter per color, one row per pixel row",
          on: { click: () => art && download(`${name}-fixed.sprite.txt`, formatSprite(art)) }
        },
        "Sprite text"
      ),
      h(
        "button",
        {
          attrs: { disabled },
          title: "Every setting, hand edits included: open it here again, or run it with `pixel fix --recipe`",
          on: { click: () => download(`${name}.recipe.json`, encodeRecipe(recipeOf()), "application/json") }
        },
        "Recipe"
      )
    ),
    h(
      "p",
      { class: "hint" },
      "The SVG is drawn in pixel units with crisp edges: it stays sharp at any size. The scale only sets the size it opens at. The palette files hold the colors the picture uses."
    )
  )
}

const tool = (id: State["tool"], label: string, title: string): HTMLElement =>
  h(
    "button",
    {
      class: state.tool === id ? "tab on" : "tab",
      title,
      attrs: { "aria-pressed": state.tool === id },
      on: {
        click: () => {
          state.tool = id
          // Painting happens on the fixed picture.
          if ((id === "erase" || id === "restore") && state.mode === "source") state.mode = "result"
          update()
        }
      }
    },
    label
  )

const brush = (id: State["brush"], label: string, title: string): HTMLElement =>
  h(
    "button",
    {
      class: state.brush === id ? "tab on" : "tab",
      title,
      attrs: { "aria-pressed": state.brush === id },
      on: {
        click: () => {
          state.brush = id
          update()
        }
      }
    },
    label
  )

const renderToolbar = (): void => {
  const mode = (id: ViewMode, label: string): HTMLElement =>
    h(
      "button",
      {
        class: state.mode === id ? "tab on" : "tab",
        attrs: { "aria-pressed": state.mode === id },
        on: {
          click: () => {
            state.mode = id
            update()
          }
        }
      },
      label
    )
  replace(
    toolbar,
    h("div", { class: "tabs" }, mode("source", "Source"), mode("compare", "Compare"), mode("result", "Fixed")),
    h(
      "div",
      { class: "row" },
      h("div", { class: "tabs" }, tool("move", "Move", "Drag to pan"), tool("erase", "Erase", "Paint to make pixels transparent"), tool("restore", "Restore", "Paint to bring erased pixels back"), tool("pick", "Pick", "Click a pixel to keep its color in the palette")),
      (state.tool === "erase" || state.tool === "restore") &&
        h(
          "div",
          { class: "tabs" },
          brush("pixel", "Pixel", "One pixel at a time"),
          brush("area", "Area", "The whole connected area of one color")
        ),
      h(
        "div",
        { class: "tabs" },
        h("button", { class: "tab", title: "Undo (Ctrl/Cmd+Z)", attrs: { disabled: !history.canUndo() }, on: { click: () => history.undo() } }, "↶ Undo"),
        h(
          "button",
          { class: "tab", title: "Redo (Ctrl/Cmd+Shift+Z)", attrs: { disabled: !history.canRedo() }, on: { click: () => history.redo() } },
          "Redo ↷"
        )
      )
    ),
    h(
      "div",
      { class: "row" },
      h("button", { class: "icon-button", title: "Zoom out", on: { click: () => viewer.zoomBy(1 / 1.5) } }, "−"),
      h("button", { class: "icon-button", title: "Zoom in", on: { click: () => viewer.zoomBy(1.5) } }, "+"),
      h("button", { title: "Fit the picture (or double-click it)", on: { click: () => viewer.fit() } }, "Fit"),
      h("button", { on: { click: () => fileInput.click() } }, "Open…"),
      h("button", { on: { click: openDemo } }, "Demo")
    )
  )
}

const renderStatus = (): void => {
  const source = state.source
  if (source === undefined) {
    replace(status)
    return
  }
  const size = grid === undefined ? undefined : gridSize(grid)
  replace(
    status,
    h("span", {}, `${source.name} · ${source.image.width} × ${source.image.height}`),
    size !== undefined && h("span", {}, `→ ${size.width} × ${size.height}`),
    h("span", {}, `${Math.round(viewer.zoom() * 100)}%`)
  )
}

const render = (rebuildPanels: boolean): void => {
  empty.hidden = state.source !== undefined
  renderToolbar()
  renderStatus()
  if (rebuildPanels) {
    // Panels are rebuilt whole; keep the scroll position where the user left it.
    const scroll = panels.scrollTop
    replace(
      panels,
      state.message !== "" && h("p", { class: "message" }, state.message),
      gridPanel(),
      palettePanel(),
      lostPanel(),
      backgroundPanel(),
      checkPanel(),
      exportPanel()
    )
    panels.scrollTop = scroll
  } else {
    drawPreview()
  }
  viewer.setScene({
    source: state.source?.canvas,
    grid,
    result,
    mode: state.mode,
    showGrid: state.showGrid,
    moved: new Set(state.moved.keys()),
    painting: (state.tool === "erase" || state.tool === "restore") && result !== undefined,
    picking: state.tool === "pick",
    highlight,
    marked: state.cleanup.size > 0 && state.cleanup.show ? specks.flat() : []
  })
}

update()
