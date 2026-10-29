/**
 * The picture view: the source, the fixed result laid over the same frame,
 * or both split by a draggable divider; the grid on top, whose lines can be
 * dragged one by one. Zooms with the wheel or a pinch, pans by dragging.
 *
 * For an animation sheet it shows the frames' boxes over the sheet, each
 * with its own grid; with the Boxes tool a box is moved by dragging it,
 * resized by its edges and corners, and a new one drawn on empty space.
 */
import type { Axis, Grid } from "../core/grid.ts"
import { TRANSPARENT, type PixelArt } from "../core/fix.ts"

export type ViewMode = "source" | "result" | "compare"

export interface Scene {
  readonly source: HTMLCanvasElement | undefined
  readonly grid: Grid | undefined
  readonly result: PixelArt | undefined
  readonly mode: ViewMode
  readonly showGrid: boolean
  /** Lines moved by hand, drawn in another color: "x:3", "y:0". */
  readonly moved: ReadonlySet<string>
  /** Whether pressing on the fixed picture paints (erases or restores) instead of panning. */
  readonly painting: boolean
  /** Whether pressing on the picture (source or fixed) picks the grid cell under it. */
  readonly picking: boolean
  /** Whether grid lines can be dragged (the Lines tool); otherwise a press on a line pans like anywhere else. */
  readonly adjusting: boolean
  /** Grid cells (row by row) to point out, drawn over everything. */
  readonly highlight: ReadonlyArray<number>
  /** Grid cells (row by row) to mark with an outline only, so their color stays visible. */
  readonly marked: ReadonlyArray<number>
  /** Pixels of the fixed picture (row by row) painted by hand, outlined where the fixed picture shows. */
  readonly painted: ReadonlyArray<number>
  /** An animation sheet's frame boxes, in source pixels, drawn over the source. */
  readonly boxes?: ReadonlyArray<SceneBox> | undefined
  /** Each frame's own grid, in source pixels (drawn instead of `grid`). */
  readonly frameGrids?: ReadonlyArray<Grid> | undefined
  /** The box being edited, by index. */
  readonly selectedBox?: number | undefined
  /** Whether boxes can be moved, resized, and drawn (the Boxes tool). */
  readonly editingBoxes?: boolean | undefined
}

export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface SceneBox extends Box {
  /** Left out of the animation: drawn dashed and dimmed. */
  readonly include: boolean
  /** Which animation the frame is in: neighbouring animations are drawn in different colors. */
  readonly group: number
}

export interface ViewerEvents {
  /** A grid line is being dragged to a new position, in source pixels. */
  readonly moveLine: (axis: Axis, index: number, position: number) => void
  readonly viewChanged: () => void
  /** A pixel of the fixed picture painted over, in its own pixels; `start` is true for the first of a stroke. */
  readonly paint: (x: number, y: number, start: boolean) => void
  /** A press on the picture while picking: the grid cell under it. */
  readonly pick: (x: number, y: number) => void
  /** An Alt-press on the fixed picture while painting: the pixel whose color to take. */
  readonly sample: (x: number, y: number) => void
  /** A box was pressed (or empty space: undefined), with the Boxes tool. */
  readonly selectBox?: (index: number | undefined) => void
  /** A box was moved or resized: its new place, in whole source pixels, when the drag ends. */
  readonly changeBox?: (index: number, box: Box) => void
  /** A new box was drawn on empty space. */
  readonly addBox?: (box: Box) => void
}

export interface Viewer {
  readonly setScene: (scene: Scene) => void
  readonly fit: () => void
  readonly zoomBy: (factor: number) => void
  readonly zoom: () => number
}

/** Which sides of a box a drag moves: all four to move it, some to resize it. */
interface BoxGrip {
  readonly index: number
  readonly left: boolean
  readonly right: boolean
  readonly top: boolean
  readonly bottom: boolean
}

interface Drag {
  readonly kind: "pan" | "line" | "divider" | "paint" | "box" | "new-box"
  readonly axis?: Axis
  readonly index?: number
  readonly grip?: BoxGrip
  /** Where the drag started, in source pixels, and the box as it was. */
  readonly from?: { readonly x: number; readonly y: number; readonly box?: Box }
  lastX: number
  lastY: number
  /** The last pixel painted, while painting. */
  pixel?: { x: number; y: number }
}

const GRID_COLOR = "rgba(255, 64, 160, 0.85)"
const MOVED_COLOR = "rgba(255, 200, 0, 0.95)"
const HOVER_COLOR = "rgba(0, 220, 255, 1)"
/** Pixels painted by hand: white, apart from the yellow of cleaned specks and moved lines. */
const PAINTED_COLOR = "rgba(255, 255, 255, 0.95)"
/** One color per animation, in turn. */
const BOX_COLORS = ["rgba(0, 220, 255, 0.95)", "rgba(120, 255, 120, 0.95)", "rgba(255, 110, 200, 0.95)", "rgba(180, 150, 255, 0.95)"]
const BOX_SELECTED = "rgba(255, 200, 0, 1)"
const BOX_OUT = "rgba(200, 200, 210, 0.8)"

export const makeViewer = (canvas: HTMLCanvasElement, events: ViewerEvents): Viewer => {
  const context = canvas.getContext("2d")!
  let scene: Scene = { source: undefined, grid: undefined, result: undefined, mode: "source", showGrid: true, moved: new Set(), painting: false, picking: false, adjusting: false, highlight: [], marked: [], painted: [] }
  let zoom = 1
  let panX = 0
  let panY = 0
  let divider = 0.5
  let hover: { readonly axis: Axis; readonly index: number } | "divider" | undefined
  let boxHover: BoxGrip | undefined
  let drag: Drag | undefined
  /** A box being dragged, drawn in its new place until the drag ends. */
  let draft: { readonly index: number | undefined; readonly box: Box } | undefined
  const pointers = new Map<number, { x: number; y: number }>()
  let pinch: { distance: number } | undefined
  let fitted = false
  let checker: CanvasPattern | null = null

  const size = (): { width: number; height: number } => {
    const rect = canvas.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  }

  const sourceSize = (): { width: number; height: number } | undefined =>
    scene.source === undefined ? undefined : { width: scene.source.width, height: scene.source.height }

  const fit = (): void => {
    const picture = sourceSize()
    if (picture === undefined) return
    const view = size()
    if (view.width === 0 || view.height === 0) return
    // Room for the labels along the top and the floating tools along the bottom.
    const top = 44
    const bottom = 68
    zoom = Math.min((view.width - 48) / picture.width, (view.height - top - bottom) / picture.height)
    if (zoom > 1) zoom = Math.floor(zoom * 4) / 4
    zoom = Math.max(0.05, zoom)
    panX = (view.width - picture.width * zoom) / 2
    panY = top + (view.height - top - bottom - picture.height * zoom) / 2
    fitted = true
    draw()
    events.viewChanged()
  }

  const zoomAt = (factor: number, x: number, y: number): void => {
    const next = Math.min(64, Math.max(0.05, zoom * factor))
    panX = x - ((x - panX) * next) / zoom
    panY = y - ((y - panY) * next) / zoom
    zoom = next
    draw()
    events.viewChanged()
  }

  const ensureChecker = (): CanvasPattern | null => {
    if (checker !== null) return checker
    const tile = document.createElement("canvas")
    tile.width = 16
    tile.height = 16
    const tileContext = tile.getContext("2d")!
    tileContext.fillStyle = "#c8c8c8"
    tileContext.fillRect(0, 0, 16, 16)
    tileContext.fillStyle = "#f0f0f0"
    tileContext.fillRect(0, 0, 8, 8)
    tileContext.fillRect(8, 8, 8, 8)
    checker = context.createPattern(tile, "repeat")
    return checker
  }

  const toScreen = (value: number, axis: Axis): number => (axis === "x" ? value * zoom + panX : value * zoom + panY)

  const drawSource = (): void => {
    if (scene.source === undefined) return
    context.imageSmoothingEnabled = false
    context.drawImage(scene.source, panX, panY, scene.source.width * zoom, scene.source.height * zoom)
  }

  /**
   * Where the fixed picture's pixels are, in source pixels: the grid's cells,
   * or, for a picture made smaller, even steps across the grid's extent.
   */
  const resultCuts = (): { xs: ReadonlyArray<number>; ys: ReadonlyArray<number> } | undefined => {
    const { result, grid } = scene
    if (result === undefined || grid === undefined) return undefined
    const even = (cuts: ReadonlyArray<number>, count: number): ReadonlyArray<number> => {
      if (cuts.length === count + 1) return cuts
      const from = cuts[0]!
      const step = (cuts[cuts.length - 1]! - from) / count
      return Array.from({ length: count + 1 }, (_, i) => from + i * step)
    }
    return { xs: even(grid.xs, result.width), ys: even(grid.ys, result.height) }
  }

  const drawResult = (): void => {
    const { result } = scene
    const cuts = resultCuts()
    if (result === undefined || cuts === undefined) return
    const xs = cuts.xs.map((value) => Math.round(toScreen(value, "x")))
    const ys = cuts.ys.map((value) => Math.round(toScreen(value, "y")))
    const view = size()
    for (let y = 0; y < result.height; y++) {
      const top = ys[y]!
      const bottom = ys[y + 1]!
      if (bottom < 0 || top > view.height) continue
      for (let x = 0; x < result.width; x++) {
        const left = xs[x]!
        const right = xs[x + 1]!
        if (right < 0 || left > view.width) continue
        const index = result.indices[y * result.width + x]!
        if (index === TRANSPARENT) {
          context.clearRect(left, top, right - left, bottom - top)
          context.fillStyle = ensureChecker() ?? "#ddd"
          context.fillRect(left, top, right - left, bottom - top)
          continue
        }
        const color = result.palette[index]!
        context.fillStyle = `rgb(${color.r},${color.g},${color.b})`
        context.fillRect(left, top, right - left, bottom - top)
      }
    }
  }

  const drawGrid = (): void => {
    if (scene.frameGrids !== undefined) {
      if (scene.showGrid) for (const grid of scene.frameGrids) drawOneGrid(grid)
      return
    }
    if (scene.grid !== undefined) drawOneGrid(scene.grid)
  }

  const drawOneGrid = (grid: Grid): void => {
    if (!scene.showGrid) return
    const view = size()
    const top = toScreen(grid.ys[0]!, "y")
    const bottom = toScreen(grid.ys[grid.ys.length - 1]!, "y")
    const left = toScreen(grid.xs[0]!, "x")
    const right = toScreen(grid.xs[grid.xs.length - 1]!, "x")
    const spacing = Math.min(
      ((grid.xs[grid.xs.length - 1]! - grid.xs[0]!) / Math.max(1, grid.xs.length - 1)) * zoom,
      ((grid.ys[grid.ys.length - 1]! - grid.ys[0]!) / Math.max(1, grid.ys.length - 1)) * zoom
    )
    // Lines closer than a few screen pixels would only paint the picture over (a sheet's many frames, sooner).
    if (spacing < (scene.frameGrids === undefined ? 3 : 6)) return
    context.lineWidth = 1
    const line = (axis: Axis, index: number, value: number): void => {
      const at = Math.round(toScreen(value, axis)) + 0.5
      const isHover = hover !== undefined && hover !== "divider" && hover.axis === axis && hover.index === index
      context.strokeStyle = isHover ? HOVER_COLOR : scene.moved.has(`${axis}:${index}`) ? MOVED_COLOR : GRID_COLOR
      context.lineWidth = isHover ? 2 : 1
      context.beginPath()
      if (axis === "x") {
        if (at < 0 || at > view.width) return
        context.moveTo(at, Math.max(0, top))
        context.lineTo(at, Math.min(view.height, bottom))
      } else {
        if (at < 0 || at > view.height) return
        context.moveTo(Math.max(0, left), at)
        context.lineTo(Math.min(view.width, right), at)
      }
      context.stroke()
    }
    grid.xs.forEach((value, index) => line("x", index, value))
    grid.ys.forEach((value, index) => line("y", index, value))
  }

  /** Draws `cells` (row by row) of the cuts given: the grid's, or the fixed picture's. */
  const drawCells = (
    cuts: { xs: ReadonlyArray<number>; ys: ReadonlyArray<number> } | undefined,
    cells: ReadonlyArray<number>,
    fill: string | undefined,
    stroke: string
  ): void => {
    if (cuts === undefined || cells.length === 0) return
    const columns = cuts.xs.length - 1
    context.strokeStyle = stroke
    context.lineWidth = 2
    for (const cell of cells) {
      const x = cell % columns
      const y = (cell - x) / columns
      const left = toScreen(cuts.xs[x]!, "x")
      const top = toScreen(cuts.ys[y]!, "y")
      const width = toScreen(cuts.xs[x + 1]!, "x") - left
      const height = toScreen(cuts.ys[y + 1]!, "y") - top
      if (fill !== undefined) {
        context.fillStyle = fill
        context.fillRect(left, top, width, height)
      }
      context.strokeRect(left + 1, top + 1, width - 2, height - 2)
    }
  }

  /** The boxes, the outside of them dimmed, each numbered at its top left. */
  const drawBoxes = (): void => {
    const boxes = scene.boxes
    if (boxes === undefined) return
    const view = size()
    const shown = boxes.map((box, i) => (draft !== undefined && draft.index === i ? { ...box, ...draft.box } : box))
    const rects = shown.map((box) => ({
      left: toScreen(box.x, "x"),
      top: toScreen(box.y, "y"),
      width: box.width * zoom,
      height: box.height * zoom
    }))
    // Everything outside the boxes is left out of the animation: dimmed.
    context.save()
    context.beginPath()
    context.rect(0, 0, view.width, view.height)
    for (const rect of rects) context.rect(rect.left + rect.width, rect.top, -rect.width, rect.height)
    context.fillStyle = "rgba(10, 10, 14, 0.55)"
    context.fill("evenodd")
    context.restore()
    context.font = '600 11px "Inter", system-ui, sans-serif'
    context.textBaseline = "middle"
    context.textAlign = "center"
    rects.forEach((rect, i) => {
      const box = shown[i]!
      const selected = scene.selectedBox === i
      const hovered = boxHover?.index === i
      const color = BOX_COLORS[box.group % BOX_COLORS.length]!
      context.strokeStyle = !box.include ? BOX_OUT : selected ? BOX_SELECTED : hovered ? HOVER_COLOR : color
      context.lineWidth = selected ? 2.5 : 1.5
      context.setLineDash(box.include ? [] : [6, 4])
      context.strokeRect(Math.round(rect.left) + 0.5, Math.round(rect.top) + 0.5, Math.round(rect.width), Math.round(rect.height))
      context.setLineDash([])
      const label = String(i + 1)
      const tag = Math.max(20, context.measureText(label).width + 12)
      context.fillStyle = !box.include ? BOX_OUT : selected ? BOX_SELECTED : color
      context.beginPath()
      context.roundRect(Math.round(rect.left), Math.round(rect.top) - 20, tag, 18, 4)
      context.fill()
      context.fillStyle = "#101014"
      context.fillText(label, Math.round(rect.left) + tag / 2, Math.round(rect.top) - 11)
      if (scene.editingBoxes && selected) {
        // Handles at the corners and the middle of each side.
        context.fillStyle = "#ffffff"
        context.strokeStyle = "#101014"
        context.lineWidth = 1
        for (const fx of [0, 0.5, 1]) {
          for (const fy of [0, 0.5, 1]) {
            if (fx === 0.5 && fy === 0.5) continue
            const hx = rect.left + rect.width * fx
            const hy = rect.top + rect.height * fy
            context.fillRect(Math.round(hx) - 4, Math.round(hy) - 4, 8, 8)
            context.strokeRect(Math.round(hx) - 4 + 0.5, Math.round(hy) - 4 + 0.5, 7, 7)
          }
        }
      }
    })
    if (draft !== undefined && draft.index === undefined) {
      context.strokeStyle = BOX_SELECTED
      context.lineWidth = 2
      context.setLineDash([6, 4])
      context.strokeRect(toScreen(draft.box.x, "x"), toScreen(draft.box.y, "y"), draft.box.width * zoom, draft.box.height * zoom)
      context.setLineDash([])
    }
    context.textAlign = "left"
    context.textBaseline = "alphabetic"
  }

  /** The box edge, corner, or inside under a point, with the Boxes tool. */
  const boxAt = (x: number, y: number, reach: number): BoxGrip | undefined => {
    const boxes = scene.boxes
    if (boxes === undefined || !scene.editingBoxes) return undefined
    // The selected box first, then the others from the top of the drawing down.
    const order = boxes.map((_, i) => i).reverse()
    if (scene.selectedBox !== undefined) order.unshift(scene.selectedBox)
    for (const i of order) {
      const box = boxes[i]
      if (box === undefined) continue
      const left = toScreen(box.x, "x")
      const top = toScreen(box.y, "y")
      const right = left + box.width * zoom
      const bottom = top + box.height * zoom
      if (x < left - reach || x > right + reach || y < top - reach || y > bottom + reach) continue
      const grip = {
        index: i,
        left: Math.abs(x - left) <= reach,
        right: Math.abs(x - right) <= reach,
        top: Math.abs(y - top) <= reach,
        bottom: Math.abs(y - bottom) <= reach
      }
      if (grip.left || grip.right || grip.top || grip.bottom) return grip
      if (x > left && x < right && y > top && y < bottom) return { index: i, left: true, right: true, top: true, bottom: true }
    }
    return undefined
  }

  const toSource = (x: number, y: number): { x: number; y: number } => ({ x: (x - panX) / zoom, y: (y - panY) / zoom })

  /** The box a drag makes of `from`, moved by the pointer now at `at` (source pixels). */
  const dragged = (grip: BoxGrip, box: Box, from: { x: number; y: number }, at: { x: number; y: number }): Box => {
    const dx = Math.round(at.x - from.x)
    const dy = Math.round(at.y - from.y)
    const whole = grip.left && grip.right && grip.top && grip.bottom
    if (whole) return { ...box, x: box.x + dx, y: box.y + dy }
    let left = box.x
    let right = box.x + box.width
    let top = box.y
    let bottom = box.y + box.height
    if (grip.left) left = Math.min(right - 4, left + dx)
    if (grip.right) right = Math.max(left + 4, right + dx)
    if (grip.top) top = Math.min(bottom - 4, top + dy)
    if (grip.bottom) bottom = Math.max(top + 4, bottom + dy)
    return { x: left, y: top, width: right - left, height: bottom - top }
  }

  const drawHighlight = (): void => {
    drawCells(scene.grid, scene.marked, undefined, MOVED_COLOR)
    drawCells(scene.grid, scene.highlight, "rgba(0, 220, 255, 0.35)", HOVER_COLOR)
  }

  const draw = (): void => {
    const ratio = window.devicePixelRatio || 1
    const view = size()
    const width = Math.round(view.width * ratio)
    const height = Math.round(view.height * ratio)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, view.width, view.height)
    const picture = sourceSize()
    if (picture === undefined) return
    if (!fitted) {
      fit()
      return
    }
    // The checkerboard shows where the picture is transparent.
    context.fillStyle = ensureChecker() ?? "#ddd"
    context.fillRect(panX, panY, picture.width * zoom, picture.height * zoom)

    if (scene.mode === "source") drawSource()
    else if (scene.mode === "result") {
      drawResult()
      drawCells(resultCuts(), scene.painted, undefined, PAINTED_COLOR)
    }
    else {
      const split = Math.round(view.width * divider)
      context.save()
      context.beginPath()
      context.rect(0, 0, split, view.height)
      context.clip()
      drawSource()
      context.restore()
      context.save()
      context.beginPath()
      context.rect(split, 0, view.width - split, view.height)
      context.clip()
      drawResult()
      drawCells(resultCuts(), scene.painted, undefined, PAINTED_COLOR)
      context.restore()
    }
    if (scene.mode !== "result") drawGrid()
    drawBoxes()
    drawHighlight()
    if (scene.mode === "compare") {
      const split = Math.round(view.width * divider) + 0.5
      context.strokeStyle = hover === "divider" ? HOVER_COLOR : "#ffffff"
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(split, 0)
      context.lineTo(split, view.height)
      context.stroke()
      context.fillStyle = "#ffffff"
      context.strokeStyle = "#202020"
      context.lineWidth = 1
      context.beginPath()
      context.arc(split, view.height / 2, 11, 0, Math.PI * 2)
      context.fill()
      context.stroke()
      context.fillStyle = "#202020"
      context.font = '12px "Inter", system-ui, sans-serif'
      context.textAlign = "center"
      context.textBaseline = "middle"
      context.fillText("⇔", split, view.height / 2 + 1)
      context.textAlign = "left"
      context.textBaseline = "top"
      context.font = '500 11.5px "Inter", system-ui, sans-serif'
      const label = (text: string, x: number): void => {
        const width = context.measureText(text).width + 16
        context.fillStyle = "rgba(20, 20, 24, 0.78)"
        context.beginPath()
        context.roundRect(x - 8, 10, width, 22, 6)
        context.fill()
        context.fillStyle = "#ececef"
        context.fillText(text, x, 15.5)
      }
      label("Source", Math.max(18, split - 66))
      label("Fixed", split + 18)
    }
  }

  /** The grid line or divider under a point, if any. */
  const hitTest = (x: number, y: number): typeof hover => {
    const view = size()
    if (scene.mode === "compare" && Math.abs(x - view.width * divider) <= 12) return "divider"
    const { grid } = scene
    if (grid === undefined || !scene.showGrid || !scene.adjusting || scene.mode === "result") return undefined
    let best: { axis: Axis; index: number; distance: number } | undefined
    const consider = (axis: Axis, cuts: ReadonlyArray<number>, at: number): void => {
      cuts.forEach((value, index) => {
        const distance = Math.abs(toScreen(value, axis) - at)
        if (distance <= 6 && (best === undefined || distance < best.distance)) best = { axis, index, distance }
      })
    }
    const top = toScreen(grid.ys[0]!, "y")
    const bottom = toScreen(grid.ys[grid.ys.length - 1]!, "y")
    const left = toScreen(grid.xs[0]!, "x")
    const right = toScreen(grid.xs[grid.xs.length - 1]!, "x")
    if (y >= top - 6 && y <= bottom + 6) consider("x", grid.xs, x)
    if (x >= left - 6 && x <= right + 6) consider("y", grid.ys, y)
    const found: { axis: Axis; index: number; distance: number } | undefined = best
    return found === undefined ? undefined : { axis: found.axis, index: found.index }
  }

  const local = (event: PointerEvent | WheelEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const setCursor = (): void => {
    if (boxHover !== undefined || drag?.kind === "box" || drag?.kind === "new-box") {
      const grip = drag?.grip ?? boxHover
      const whole = grip !== undefined && grip.left && grip.right && grip.top && grip.bottom
      canvas.style.cursor =
        grip === undefined
          ? "crosshair"
          : whole
            ? drag === undefined ? "move" : "grabbing"
            : (grip.left || grip.right) && (grip.top || grip.bottom)
              ? (grip.left && grip.top) || (grip.right && grip.bottom) ? "nwse-resize" : "nesw-resize"
              : grip.left || grip.right ? "ew-resize" : "ns-resize"
      return
    }
    canvas.style.cursor =
      scene.editingBoxes && drag === undefined ? "crosshair" :
      hover === "divider" ? "ew-resize" : hover !== undefined ? (hover.axis === "x" ? "col-resize" : "row-resize") : drag?.kind === "pan" ? "grabbing" : scene.painting || scene.picking ? "crosshair" : "grab"
  }

  canvas.addEventListener("pointerdown", (event) => {
    const at = local(event)
    pointers.set(event.pointerId, at)
    canvas.setPointerCapture(event.pointerId)
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinch = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y) }
      drag = undefined
      return
    }
    if (scene.editingBoxes && pointers.size === 1) {
      const grip = boxAt(at.x, at.y, event.pointerType === "touch" ? 14 : 6)
      const point = toSource(at.x, at.y)
      if (grip !== undefined) {
        const box = scene.boxes![grip.index]!
        events.selectBox?.(grip.index)
        drag = { kind: "box", grip, from: { ...point, box }, lastX: at.x, lastY: at.y }
      } else {
        events.selectBox?.(undefined)
        drag = { kind: "new-box", from: point, lastX: at.x, lastY: at.y }
      }
      setCursor()
      draw()
      return
    }
    if (scene.picking && pointers.size === 1 && !(scene.mode === "compare" && Math.abs(at.x - size().width * divider) <= 12)) {
      const cell = cellAt(at.x, at.y)
      if (cell !== undefined) {
        events.pick(cell.x, cell.y)
        return
      }
    }
    if (scene.painting && pointers.size === 1) {
      const pixel = pixelAt(at.x, at.y)
      const onDivider = scene.mode === "compare" && Math.abs(at.x - size().width * divider) <= 12
      if (pixel !== undefined && !onDivider && event.altKey) {
        events.sample(pixel.x, pixel.y)
        return
      }
      if (pixel !== undefined && !onDivider) {
        drag = { kind: "paint", lastX: at.x, lastY: at.y, pixel }
        events.paint(pixel.x, pixel.y, true)
        return
      }
    }
    const hit = event.pointerType === "touch" ? hitTestTouch(at.x, at.y) : hitTest(at.x, at.y)
    if (hit === "divider") drag = { kind: "divider", lastX: at.x, lastY: at.y }
    else if (hit !== undefined && !scene.painting) drag = { kind: "line", axis: hit.axis, index: hit.index, lastX: at.x, lastY: at.y }
    else drag = { kind: "pan", lastX: at.x, lastY: at.y }
    hover = hit
    setCursor()
    draw()
  })

  // Fingers are less precise: a wider reach for lines.
  const hitTestTouch = (x: number, y: number): typeof hover => {
    for (const reach of [0, 4, -4, 8, -8]) {
      const hit = hitTest(x + reach, y) ?? hitTest(x, y + reach)
      if (hit !== undefined) return hit
    }
    return undefined
  }

  canvas.addEventListener("pointermove", (event) => {
    const at = local(event)
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, at)
    if (pinch !== undefined && pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      if (pinch.distance > 0) zoomAt(distance / pinch.distance, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2)
      pinch.distance = distance
      return
    }
    if (drag === undefined && scene.editingBoxes) {
      const next = boxAt(at.x, at.y, event.pointerType === "touch" ? 14 : 6)
      const changed = JSON.stringify(next) !== JSON.stringify(boxHover)
      boxHover = next
      setCursor()
      if (changed) draw()
      return
    }
    if (drag === undefined) {
      const next = scene.painting || scene.picking ? (scene.mode === "compare" && Math.abs(at.x - size().width * divider) <= 12 ? "divider" : undefined) : hitTest(at.x, at.y)
      const changed = JSON.stringify(next) !== JSON.stringify(hover)
      hover = next
      setCursor()
      if (changed) draw()
      return
    }
    if (drag.kind === "paint") {
      const pixel = pixelAt(at.x, at.y)
      const last = drag.pixel
      if (pixel !== undefined && last !== undefined && (pixel.x !== last.x || pixel.y !== last.y)) {
        // Every pixel on the way, so a fast stroke leaves no gaps.
        const steps = Math.max(Math.abs(pixel.x - last.x), Math.abs(pixel.y - last.y))
        for (let k = 1; k <= steps; k++) {
          events.paint(Math.round(last.x + ((pixel.x - last.x) * k) / steps), Math.round(last.y + ((pixel.y - last.y) * k) / steps), false)
        }
      }
      if (pixel !== undefined) drag.pixel = pixel
    } else if (drag.kind === "box" && drag.grip !== undefined && drag.from?.box !== undefined) {
      draft = { index: drag.grip.index, box: dragged(drag.grip, drag.from.box, drag.from, toSource(at.x, at.y)) }
      draw()
    } else if (drag.kind === "new-box" && drag.from !== undefined) {
      const point = toSource(at.x, at.y)
      const x = Math.round(Math.min(point.x, drag.from.x))
      const y = Math.round(Math.min(point.y, drag.from.y))
      draft = { index: undefined, box: { x, y, width: Math.round(Math.max(point.x, drag.from.x)) - x, height: Math.round(Math.max(point.y, drag.from.y)) - y } }
      draw()
    } else if (drag.kind === "pan") {
      panX += at.x - drag.lastX
      panY += at.y - drag.lastY
      draw()
    } else if (drag.kind === "divider") {
      divider = Math.min(0.98, Math.max(0.02, at.x / size().width))
      draw()
    } else if (drag.axis !== undefined && drag.index !== undefined) {
      const position = drag.axis === "x" ? (at.x - panX) / zoom : (at.y - panY) / zoom
      events.moveLine(drag.axis, drag.index, Math.round(position * 4) / 4)
    }
    drag.lastX = at.x
    drag.lastY = at.y
  })

  const find = (values: ReadonlyArray<number>, at: number): number => {
    for (let i = 0; i < values.length - 1; i++) if (at >= values[i]! && at < values[i + 1]!) return i
    return -1
  }

  /** The grid cell under a point, wherever on the picture. */
  const cellAt = (x: number, y: number): { x: number; y: number } | undefined => {
    const { grid } = scene
    if (grid === undefined) return undefined
    const cx = find(grid.xs, (x - panX) / zoom)
    const cy = find(grid.ys, (y - panY) / zoom)
    return cx < 0 || cy < 0 ? undefined : { x: cx, y: cy }
  }

  /** The fixed picture's pixel under a point, where the fixed picture is shown. */
  const pixelAt = (x: number, y: number): { x: number; y: number } | undefined => {
    if (scene.mode === "source" || (scene.mode === "compare" && x < size().width * divider)) return undefined
    const cuts = resultCuts()
    if (cuts === undefined) return undefined
    const px = find(cuts.xs, (x - panX) / zoom)
    const py = find(cuts.ys, (y - panY) / zoom)
    return px < 0 || py < 0 ? undefined : { x: px, y: py }
  }

  const release = (event: PointerEvent): void => {
    pointers.delete(event.pointerId)
    if (pointers.size < 2) pinch = undefined
    if (pointers.size === 0) {
      const ended = draft
      draft = undefined
      if (ended !== undefined) {
        if (ended.index !== undefined) events.changeBox?.(ended.index, ended.box)
        // A click on empty space draws nothing: a box needs a few pixels.
        else if (ended.box.width * zoom >= 8 && ended.box.height * zoom >= 8) events.addBox?.(ended.box)
      }
      drag = undefined
      setCursor()
      draw()
    }
  }
  canvas.addEventListener("pointerup", release)
  canvas.addEventListener("pointercancel", release)
  canvas.addEventListener("pointerleave", () => {
    if (drag === undefined && (hover !== undefined || boxHover !== undefined)) {
      hover = undefined
      boxHover = undefined
      draw()
    }
  })
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault()
      const at = local(event)
      zoomAt(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)), at.x, at.y)
    },
    { passive: false }
  )
  canvas.addEventListener("dblclick", fit)
  new ResizeObserver(() => draw()).observe(canvas)

  return {
    setScene: (next) => {
      if (next.source !== scene.source) fitted = false
      scene = next
      draw()
    },
    fit,
    zoomBy: (factor) => {
      const view = size()
      zoomAt(factor, view.width / 2, view.height / 2)
    },
    zoom: () => zoom
  }
}
