/**
 * The picture view: the source, the fixed result laid over the same frame,
 * or both split by a draggable divider; the grid on top, whose lines can be
 * dragged one by one. Zooms with the wheel or a pinch, pans by dragging.
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
}

export interface ViewerEvents {
  /** A grid line is being dragged to a new position, in source pixels. */
  readonly moveLine: (axis: Axis, index: number, position: number) => void
  readonly viewChanged: () => void
}

export interface Viewer {
  readonly setScene: (scene: Scene) => void
  readonly fit: () => void
  readonly zoomBy: (factor: number) => void
  readonly zoom: () => number
}

interface Drag {
  readonly kind: "pan" | "line" | "divider"
  readonly axis?: Axis
  readonly index?: number
  lastX: number
  lastY: number
}

const GRID_COLOR = "rgba(255, 64, 160, 0.85)"
const MOVED_COLOR = "rgba(255, 200, 0, 0.95)"
const HOVER_COLOR = "rgba(0, 220, 255, 1)"

export const makeViewer = (canvas: HTMLCanvasElement, events: ViewerEvents): Viewer => {
  const context = canvas.getContext("2d")!
  let scene: Scene = { source: undefined, grid: undefined, result: undefined, mode: "source", showGrid: true, moved: new Set() }
  let zoom = 1
  let panX = 0
  let panY = 0
  let divider = 0.5
  let hover: { readonly axis: Axis; readonly index: number } | "divider" | undefined
  let drag: Drag | undefined
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
    zoom = Math.min((view.width - 32) / picture.width, (view.height - 32) / picture.height)
    if (zoom > 1) zoom = Math.floor(zoom * 4) / 4
    zoom = Math.max(0.05, zoom)
    panX = (view.width - picture.width * zoom) / 2
    panY = (view.height - picture.height * zoom) / 2
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

  const drawResult = (): void => {
    const { result, grid } = scene
    if (result === undefined || grid === undefined) return
    const xs = grid.xs.map((value) => Math.round(toScreen(value, "x")))
    const ys = grid.ys.map((value) => Math.round(toScreen(value, "y")))
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
    const { grid } = scene
    if (grid === undefined || !scene.showGrid) return
    const view = size()
    const top = toScreen(grid.ys[0]!, "y")
    const bottom = toScreen(grid.ys[grid.ys.length - 1]!, "y")
    const left = toScreen(grid.xs[0]!, "x")
    const right = toScreen(grid.xs[grid.xs.length - 1]!, "x")
    const spacing = Math.min(
      ((grid.xs[grid.xs.length - 1]! - grid.xs[0]!) / Math.max(1, grid.xs.length - 1)) * zoom,
      ((grid.ys[grid.ys.length - 1]! - grid.ys[0]!) / Math.max(1, grid.ys.length - 1)) * zoom
    )
    // Lines closer than a few screen pixels would only paint the picture over.
    if (spacing < 3) return
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
    else if (scene.mode === "result") drawResult()
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
      context.restore()
    }
    if (scene.mode !== "result") drawGrid()
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
      context.font = "12px system-ui, sans-serif"
      context.textAlign = "center"
      context.textBaseline = "middle"
      context.fillText("⇔", split, view.height / 2 + 1)
      context.textAlign = "left"
      context.textBaseline = "top"
      context.font = "600 12px system-ui, sans-serif"
      const label = (text: string, x: number): void => {
        const metrics = context.measureText(text)
        context.fillStyle = "rgba(0,0,0,0.6)"
        context.fillRect(x - 6, 8, metrics.width + 12, 22)
        context.fillStyle = "#ffffff"
        context.fillText(text, x, 13)
      }
      label("Source", Math.max(14, split - 70))
      label("Fixed", split + 14)
    }
  }

  /** The grid line or divider under a point, if any. */
  const hitTest = (x: number, y: number): typeof hover => {
    const view = size()
    if (scene.mode === "compare" && Math.abs(x - view.width * divider) <= 12) return "divider"
    const { grid } = scene
    if (grid === undefined || !scene.showGrid || scene.mode === "result") return undefined
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
    canvas.style.cursor =
      hover === "divider" ? "ew-resize" : hover !== undefined ? (hover.axis === "x" ? "col-resize" : "row-resize") : drag?.kind === "pan" ? "grabbing" : "grab"
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
    const hit = event.pointerType === "touch" ? hitTestTouch(at.x, at.y) : hitTest(at.x, at.y)
    if (hit === "divider") drag = { kind: "divider", lastX: at.x, lastY: at.y }
    else if (hit !== undefined) drag = { kind: "line", axis: hit.axis, index: hit.index, lastX: at.x, lastY: at.y }
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
    if (drag === undefined) {
      const next = hitTest(at.x, at.y)
      const changed = JSON.stringify(next) !== JSON.stringify(hover)
      hover = next
      setCursor()
      if (changed) draw()
      return
    }
    if (drag.kind === "pan") {
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

  const release = (event: PointerEvent): void => {
    pointers.delete(event.pointerId)
    if (pointers.size < 2) pinch = undefined
    if (pointers.size === 0) {
      drag = undefined
      setCursor()
      draw()
    }
  }
  canvas.addEventListener("pointerup", release)
  canvas.addEventListener("pointercancel", release)
  canvas.addEventListener("pointerleave", () => {
    if (drag === undefined && hover !== undefined) {
      hover = undefined
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
