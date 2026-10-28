/**
 * The animation view: the fixed frames, all at one whole scale. "frames"
 * shows every frame side by side (click one to choose it); "play" shows one
 * frame large, with the frame before it faintly underneath (onion skin) so
 * a jump or a wobble shows. A line marks the anchor every frame stands on.
 * Zooms with the wheel or a pinch, pans by dragging.
 */
import { TRANSPARENT, type PixelArt } from "../core/fix.ts"
import type { Point } from "../core/sheet.ts"

export type PlayerView = "frames" | "play"

export interface PlayerScene {
  /** The frames, one size, one palette. */
  readonly frames: ReadonlyArray<PixelArt>
  /** Each frame's number on the sheet, from 1 (labels). */
  readonly numbers: ReadonlyArray<number>
  readonly view: PlayerView
  /** The frame shown (play) or chosen (frames), by position in `frames`. */
  readonly current: number
  /** The frame drawn faintly under the current one, if any. */
  readonly onion: number | undefined
  /** Where the anchor is on every frame, when frames are anchored. */
  readonly anchor: Point | undefined
  readonly showGrid: boolean
}

export interface PlayerEvents {
  /** A frame was clicked in the frames view. */
  readonly choose: (index: number) => void
  readonly viewChanged: () => void
}

export interface Player {
  readonly setScene: (scene: PlayerScene) => void
  readonly fit: () => void
  readonly zoomBy: (factor: number) => void
  readonly zoom: () => number
}

const GAP = 3
const ANCHOR_COLOR = "rgba(255, 64, 160, 0.85)"
const CHOSEN_COLOR = "rgba(255, 200, 0, 1)"

export const makePlayer = (canvas: HTMLCanvasElement, events: PlayerEvents): Player => {
  const context = canvas.getContext("2d")!
  let scene: PlayerScene = { frames: [], numbers: [], view: "play", current: 0, onion: undefined, anchor: undefined, showGrid: false }
  /** Screen pixels per art pixel, a whole number when 1 or more. */
  let zoom = 1
  let panX = 0
  let panY = 0
  let fitted = false
  let fittedKey = ""
  let drag: { lastX: number; lastY: number; moved: number } | undefined
  const pointers = new Map<number, { x: number; y: number }>()
  let pinch: { distance: number } | undefined
  let checker: CanvasPattern | null = null

  const size = (): { width: number; height: number } => {
    const rect = canvas.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  }

  /** The picture's size in art pixels: one frame, or the row of all of them. */
  const extent = (): { width: number; height: number } => {
    const first = scene.frames[0]
    if (first === undefined) return { width: 0, height: 0 }
    if (scene.view === "play") return { width: first.width, height: first.height }
    return { width: scene.frames.length * first.width + (scene.frames.length - 1) * GAP, height: first.height }
  }

  const fit = (): void => {
    const picture = extent()
    const view = size()
    if (picture.width === 0 || view.width === 0) return
    const top = 44
    const bottom = 96
    let next = Math.min((view.width - 48) / picture.width, (view.height - top - bottom) / picture.height)
    next = next >= 1 ? Math.floor(next) : Math.max(0.1, next)
    zoom = next
    panX = Math.round((view.width - picture.width * zoom) / 2)
    panY = Math.round(top + (view.height - top - bottom - picture.height * zoom) / 2)
    fitted = true
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

  /** Draws a frame with its top left at (left, top) in art pixels, at `alpha`. */
  const drawArt = (art: PixelArt, left: number, top: number, alpha: number): void => {
    context.globalAlpha = alpha
    for (let y = 0; y < art.height; y++) {
      for (let x = 0; x < art.width; x++) {
        const index = art.indices[y * art.width + x]!
        if (index === TRANSPARENT) continue
        const color = art.palette[index]!
        context.fillStyle = `rgb(${color.r},${color.g},${color.b})`
        const sx = Math.round(panX + (left + x) * zoom)
        const sy = Math.round(panY + (top + y) * zoom)
        context.fillRect(sx, sy, Math.round(panX + (left + x + 1) * zoom) - sx, Math.round(panY + (top + y + 1) * zoom) - sy)
      }
    }
    context.globalAlpha = 1
  }

  const drawPixelGrid = (left: number, top: number, width: number, height: number): void => {
    if (!scene.showGrid || zoom < 6) return
    context.strokeStyle = "rgba(0, 0, 0, 0.12)"
    context.lineWidth = 1
    context.beginPath()
    for (let x = 0; x <= width; x++) {
      const at = Math.round(panX + (left + x) * zoom) + 0.5
      context.moveTo(at, panY + top * zoom)
      context.lineTo(at, panY + (top + height) * zoom)
    }
    for (let y = 0; y <= height; y++) {
      const at = Math.round(panY + (top + y) * zoom) + 0.5
      context.moveTo(panX + left * zoom, at)
      context.lineTo(panX + (left + width) * zoom, at)
    }
    context.stroke()
  }

  const drawAnchor = (left: number, width: number): void => {
    const anchor = scene.anchor
    if (anchor === undefined) return
    context.strokeStyle = ANCHOR_COLOR
    context.lineWidth = 1
    context.setLineDash([4, 3])
    // The line the frames stand on (under the anchor row), and a tick at the anchor's column.
    const y = Math.round(panY + (anchor.y + 1) * zoom) + 0.5
    context.beginPath()
    context.moveTo(panX + left * zoom - 8, y)
    context.lineTo(panX + (left + width) * zoom + 8, y)
    context.stroke()
    context.setLineDash([])
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
    const first = scene.frames[0]
    if (first === undefined) return
    const key = `${scene.view}:${scene.frames.length}:${first.width}x${first.height}`
    if (!fitted || key !== fittedKey) {
      fittedKey = key
      fit()
      return
    }
    context.imageSmoothingEnabled = false
    context.font = '600 11px "Inter", system-ui, sans-serif'
    context.textAlign = "center"
    context.textBaseline = "top"
    if (scene.view === "play") {
      const art = scene.frames[scene.current] ?? first
      context.fillStyle = ensureChecker() ?? "#ddd"
      context.fillRect(panX, panY, art.width * zoom, art.height * zoom)
      const under = scene.onion === undefined ? undefined : scene.frames[scene.onion]
      if (under !== undefined) drawArt(under, 0, 0, 0.3)
      drawArt(art, 0, 0, under === undefined ? 1 : 0.92)
      drawPixelGrid(0, 0, art.width, art.height)
      drawAnchor(0, art.width)
      return
    }
    scene.frames.forEach((art, i) => {
      const left = i * (art.width + GAP)
      const sx = panX + left * zoom
      context.fillStyle = ensureChecker() ?? "#ddd"
      context.fillRect(sx, panY, art.width * zoom, art.height * zoom)
      drawArt(art, left, 0, 1)
      drawPixelGrid(left, 0, art.width, art.height)
      if (i === scene.current) {
        context.strokeStyle = CHOSEN_COLOR
        context.lineWidth = 2
        context.strokeRect(Math.round(sx) - 1, Math.round(panY) - 1, art.width * zoom + 2, art.height * zoom + 2)
      }
      context.fillStyle = i === scene.current ? CHOSEN_COLOR : "rgba(236, 236, 239, 0.85)"
      context.fillText(String(scene.numbers[i] ?? i + 1), sx + (art.width * zoom) / 2, panY + art.height * zoom + 8)
    })
    drawAnchor(0, extent().width)
  }

  const local = (event: PointerEvent | WheelEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  canvas.addEventListener("pointerdown", (event) => {
    const at = local(event)
    canvas.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, at)
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinch = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y) }
      drag = undefined
      return
    }
    drag = { lastX: at.x, lastY: at.y, moved: 0 }
    canvas.style.cursor = "grabbing"
  })
  canvas.addEventListener("pointermove", (event) => {
    const at = local(event)
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, at)
    if (pinch !== undefined && pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      // Whole steps at 1 and above: zoom once the fingers have moved a step's worth.
      if (pinch.distance > 0 && Math.abs(distance / pinch.distance - 1) > 0.15) {
        zoomAt(distance / pinch.distance, { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 })
        pinch.distance = distance
      }
      return
    }
    if (drag === undefined) return
    panX += at.x - drag.lastX
    panY += at.y - drag.lastY
    drag.moved += Math.abs(at.x - drag.lastX) + Math.abs(at.y - drag.lastY)
    drag.lastX = at.x
    drag.lastY = at.y
    draw()
  })
  const release = (event: PointerEvent): void => {
    pointers.delete(event.pointerId)
    if (pointers.size < 2) pinch = undefined
    const ended = drag
    drag = undefined
    canvas.style.cursor = "grab"
    // A click (no drag) on a frame chooses it.
    if (ended !== undefined && ended.moved < 4 && scene.view === "frames") {
      const first = scene.frames[0]
      const at = local(event)
      if (first !== undefined) {
        const x = (at.x - panX) / zoom
        const y = (at.y - panY) / zoom
        const index = Math.floor(x / (first.width + GAP))
        if (index >= 0 && index < scene.frames.length && x - index * (first.width + GAP) < first.width && y >= 0 && y < first.height + 4) events.choose(index)
      }
    }
  }
  canvas.addEventListener("pointerup", release)
  canvas.addEventListener("pointercancel", (event) => {
    pointers.delete(event.pointerId)
    if (pointers.size < 2) pinch = undefined
    drag = undefined
  })
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault()
      zoomAt(event.deltaY < 0 ? 1.25 : 0.8, local(event))
    },
    { passive: false }
  )
  canvas.addEventListener("dblclick", fit)
  canvas.style.cursor = "grab"
  new ResizeObserver(() => draw()).observe(canvas)

  /** Zooms keeping the point under the pointer still; at 1 or more, by whole steps so pixels stay square. */
  const zoomAt = (factor: number, at: { x: number; y: number }): void => {
    let next = zoom * factor
    if (next >= 1) next = factor > 1 ? Math.max(Math.ceil(zoom + 0.01), Math.round(next)) : Math.max(1, Math.min(Math.floor(zoom - 0.01), Math.round(next)))
    next = Math.min(96, Math.max(0.1, next))
    panX = at.x - ((at.x - panX) * next) / zoom
    panY = at.y - ((at.y - panY) * next) / zoom
    zoom = next
    draw()
    events.viewChanged()
  }

  return {
    setScene: (next) => {
      scene = next
      draw()
    },
    fit,
    zoomBy: (factor) => {
      const view = size()
      zoomAt(factor, { x: view.width / 2, y: view.height / 2 })
    },
    zoom: () => zoom
  }
}
