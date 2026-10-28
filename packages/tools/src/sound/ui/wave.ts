/** Waveforms on a canvas: the sound's shape, its time ruler, and the playhead. */
import type { Rendered } from "../core/render.ts"

export interface WaveOptions {
  /** How many seconds the canvas spans, so several waves share one scale. */
  readonly seconds: number
  readonly color: string
  /** Seconds into the sound the playhead is at, when playing. */
  readonly playhead?: number | undefined
  readonly playheadColor?: string
  /** Draws a tick and a label every tenth of a second. */
  readonly ruler?: { readonly line: string; readonly text: string } | undefined
}

/** Sizes a canvas's backing store to its box on screen; returns its size in device pixels. */
const fit = (canvas: HTMLCanvasElement): { readonly width: number; readonly height: number; readonly ratio: number } => {
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio))
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  return { width, height, ratio }
}

/** The ruler's step: the shortest of these that leaves room for its labels. */
const STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5]
const stepOf = (perSecond: number, room: number): number => STEPS.find((step) => step * perSecond >= room) ?? 10

export const drawWave = (canvas: HTMLCanvasElement, rendered: Rendered | undefined, options: WaveOptions): void => {
  const { width, height, ratio } = fit(canvas)
  const context = canvas.getContext("2d")
  if (context === null) return
  context.clearRect(0, 0, width, height)
  const rulerHeight = options.ruler === undefined ? 0 : Math.round(18 * ratio)
  const top = rulerHeight
  const middle = top + (height - top) / 2
  const half = (height - top) / 2 - 2 * ratio
  const perSecond = width / Math.max(1e-6, options.seconds)

  if (options.ruler !== undefined) {
    const step = stepOf(perSecond, 44 * ratio)
    context.fillStyle = options.ruler.text
    context.font = `${10 * ratio}px "JetBrains Mono", ui-monospace, monospace`
    context.textBaseline = "top"
    for (let i = 0; i * step <= options.seconds + 1e-9; i++) {
      const x = Math.round(i * step * perSecond) + 0.5
      context.fillStyle = options.ruler.line
      context.fillRect(x, top, Math.max(1, ratio), height - top)
      if (i > 0 && x < width - 24 * ratio) {
        context.fillStyle = options.ruler.text
        context.fillText(`${Math.round(i * step * 100) / 100}s`, x + 3 * ratio, 3 * ratio)
      }
    }
    context.fillStyle = options.ruler.line
    context.fillRect(0, Math.round(middle), width, Math.max(1, ratio))
  }

  if (rendered !== undefined && rendered.samples.length > 0) {
    const { samples, sampleRate } = rendered
    const columns = Math.min(width, Math.ceil((samples.length / sampleRate) * perSecond))
    context.fillStyle = options.color
    for (let x = 0; x < columns; x++) {
      const from = Math.floor(((x / perSecond) * sampleRate) | 0)
      const to = Math.min(samples.length, Math.floor((((x + 1) / perSecond) * sampleRate) | 0))
      let low = 0
      let high = 0
      for (let i = from; i < to; i++) {
        const value = samples[i]!
        if (value < low) low = value
        if (value > high) high = value
      }
      // Past full scale is drawn at the edge: it clips.
      const y0 = middle - Math.min(1, high) * half
      const y1 = middle - Math.max(-1, low) * half
      context.fillRect(x, y0, 1, Math.max(ratio, y1 - y0))
    }
  }

  if (options.playhead !== undefined) {
    const x = Math.round(options.playhead * perSecond)
    context.fillStyle = options.playheadColor ?? "#ff5a36"
    context.fillRect(x, top, Math.max(1, Math.round(1.5 * ratio)), height - top)
  }
}
