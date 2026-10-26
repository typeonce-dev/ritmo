/**
 * The pixel fixer's page: one state object, a pipeline that recomputes the
 * fixed picture when anything changes, and panels that edit the state.
 */
import { metrics, parseHex, toHex, type Metric, type Rgb } from "../core/color.ts"
import { demoImage } from "../core/demo.ts"
import { toJson, toRgba, toSvg } from "../core/export.ts"
import {
  cellColors,
  defaultSampleOptions,
  quantize,
  removeStrays,
  sampleCells,
  usedColors,
  type CellSamples,
  type Dither,
  type PixelArt,
  type SampleOptions
} from "../core/fix.ts"
import {
  detectGrid,
  gridSize,
  refineGrid,
  uniformGrid,
  type Axis,
  type Detection,
  type Grid,
  type GridSpec,
  type RgbaImage
} from "../core/grid.ts"
import { extractPalette, parsePalette, presets, toGpl, toHexFile, type Palette } from "../core/palette.ts"
import { h, replace } from "./dom.ts"
import { baseName, canvasOf, download, loadImage, pngOf } from "./files.ts"
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
  sample: SampleOptions
  /** The palette's name, or "original" to keep each cell's own color. */
  paletteName: string
  swatches: Array<Swatch>
  extractCount: number
  metric: Metric
  dither: Dither
  ditherStrength: number
  cleanup: boolean
  mode: ViewMode
  showGrid: boolean
  exportScale: number
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
  sample: defaultSampleOptions,
  paletteName: presets[2]!.name,
  swatches: presets[2]!.colors.map((color) => ({ color, locked: false })),
  extractCount: 16,
  metric: "oklab",
  dither: "none",
  ditherStrength: 0.5,
  cleanup: false,
  mode: "compare",
  showGrid: true,
  exportScale: 8,
  message: ""
}

// The pipeline, cached step by step: a slider for dithering must not re-detect the grid.
let baseGrid: { key: string; grid: Grid } | undefined
let grid: Grid | undefined
let samples: { grid: Grid; key: string; samples: CellSamples } | undefined
let result: PixelArt | undefined

const computeGrid = (): Grid | undefined => {
  const source = state.source
  if (source === undefined) return undefined
  const key = JSON.stringify([state.spec, state.follow])
  if (baseGrid?.key !== key) {
    let next = uniformGrid(source.image.width, source.image.height, state.spec)
    if (state.follow) next = refineGrid(source.image, next)
    baseGrid = { key, grid: next }
  }
  if (state.moved.size === 0) return baseGrid.grid
  const xs = [...baseGrid.grid.xs]
  const ys = [...baseGrid.grid.ys]
  for (const [id, position] of state.moved) {
    const [axis, index] = id.split(":")
    const cuts = axis === "x" ? xs : ys
    const i = Number(index)
    if (i >= 0 && i < cuts.length) cuts[i] = position
  }
  return { xs, ys }
}

const recompute = (): void => {
  grid = computeGrid()
  const source = state.source
  if (source === undefined || grid === undefined) {
    result = undefined
    return
  }
  const sampleKey = JSON.stringify(state.sample)
  if (samples?.grid !== grid || samples.key !== sampleKey) {
    samples = { grid, key: sampleKey, samples: sampleCells(source.image, grid, state.sample) }
  }
  const palette = state.paletteName === ORIGINAL ? [] : state.swatches.map((swatch) => swatch.color)
  let art = quantize(samples.samples, {
    palette,
    metric: state.metric,
    dither: state.dither,
    ditherStrength: state.ditherStrength
  })
  if (state.cleanup) art = removeStrays(art)
  result = art
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

const setSource = (image: RgbaImage, canvas: HTMLCanvasElement, name: string): void => {
  state.source = { image, canvas, name }
  state.moved.clear()
  baseGrid = undefined
  samples = undefined
  state.message = ""
  autoDetect()
}

const openFile = async (file: Blob, name: string): Promise<void> => {
  if (!file.type.startsWith("image/")) {
    state.message = `${name} is not a picture.`
    update()
    return
  }
  try {
    const { image, canvas } = await loadImage(file)
    setSource(image, canvas, name)
  } catch (error) {
    state.message = `Could not read ${name}: ${error instanceof Error ? error.message : String(error)}`
    update()
  }
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
  if (detection === undefined) {
    state.detectionNote = "No grid found: the picture has no edges. Set the cell size by hand."
  } else {
    state.spec = detection.spec
    state.linked = Math.abs(detection.spec.cellWidth - detection.spec.cellHeight) < 0.02 * detection.spec.cellWidth
    const percent = Math.round(detection.confidence * 100)
    const size = gridSize(uniformGrid(source.image.width, source.image.height, detection.spec))
    const verdict =
      detection.confidence >= 0.5
        ? "Looks right."
        : detection.confidence >= 0.3
          ? "Probably right: check the grid on the picture."
          : "Unsure: check the grid, and set the cell size by hand if it is off."
    state.detectionNote = `Found ${fmt(detection.spec.cellWidth)} × ${fmt(detection.spec.cellHeight)} px cells, making ${size.width} × ${size.height} pixels. Confidence ${percent}%. ${verdict}`
  }
  update()
}

const fmt = (value: number): string => String(Math.round(value * 100) / 100)

// ---------------------------------------------------------------------------
// The page

const app = document.getElementById("app")!
const canvas = h("canvas", { class: "view", attrs: { "aria-label": "Picture view" } })
const viewer = makeViewer(canvas, {
  moveLine: (axis: Axis, index: number, position: number) => {
    state.moved.set(`${axis}:${index}`, position)
    update()
  },
  viewChanged: () => renderStatus()
})

const status = h("div", { class: "status" })
const toolbar = h("div", { class: "toolbar" })
const panels = h("div", { class: "panels" })
const empty = h(
  "div",
  { class: "empty" },
  h("p", { class: "empty-title" }, "Drop a picture here"),
  h("p", {}, "or paste one, or pick a file. Everything stays on this device."),
  h(
    "div",
    { class: "row center" },
    h("button", { class: "primary", on: { click: () => fileInput.click() } }, "Open a picture"),
    h("button", { on: { click: openDemo } }, "Try the demo")
  )
)
const stage = h("div", { class: "stage" }, canvas, empty, status)

const fileInput = h("input", {
  props: { type: "file", accept: "image/*" },
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
        { class: `note ${state.detection !== undefined && state.detection.confidence >= 0.5 ? "good" : "warn"}` },
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
    size !== undefined && h("p", { class: "stat" }, `Output: ${size.width} × ${size.height} pixels`),
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

const extract = (): void => {
  if (samples === undefined) return
  const locked = state.swatches.filter((swatch) => swatch.locked).map((swatch) => swatch.color)
  const colors = extractPalette(cellColors(samples.samples), Math.max(1, state.extractCount), locked)
  state.paletteName = "Extracted from the picture"
  state.swatches = colors.map((color, index) => ({ color, locked: index < locked.length }))
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
    h(
      "div",
      { class: "row" },
      numberField("Colors", state.extractCount, (value) => {
        state.extractCount = Math.min(256, Math.max(1, Math.round(value)))
        update()
      }, { min: 1, max: 256, step: 1 }),
      h("button", { on: { click: extract }, attrs: { disabled: state.source === undefined } }, "Extract")
    ),
    h("p", { class: "hint" }, "Picks the colors that best cover the picture. Locked colors stay, and count toward the total."),
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
    checkbox(
      "Remove stray pixels",
      state.cleanup,
      (checked) => {
        state.cleanup = checked
        update()
      },
      "A lone pixel surrounded by one other color takes that color. Also removes deliberate one-pixel highlights."
    )
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
      h("button", { attrs: { disabled }, on: { click: () => download(`${name}-palette.gpl`, toGpl(paletteOf())) } }, "Palette .gpl")
    ),
    h(
      "p",
      { class: "hint" },
      "The SVG is drawn in pixel units with crisp edges: it stays sharp at any size. The scale only sets the size it opens at. The palette files hold the colors the picture uses."
    )
  )
}

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
    moved: new Set(state.moved.keys())
  })
}

update()
