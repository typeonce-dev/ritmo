/**
 * Plays rendered sounds through Web Audio: the samples the CLI measures,
 * not a second synthesis, so what the person hears is what the agent read.
 * One sound plays at a time; playing another stops it.
 */
import type { Rendered } from "../core/render.ts"

export interface Playing {
  /** What is playing: a sound's name, or a take's id. */
  readonly id: string
  /** Seconds into it. */
  readonly at: number
  readonly length: number
}

export interface Player {
  readonly play: (rendered: Rendered, id: string) => void
  readonly stop: () => void
  readonly playing: () => Playing | undefined
}

/** `onChange` runs every frame while a sound plays, and once when it stops. */
export const makePlayer = (onChange: () => void): Player => {
  let context: AudioContext | undefined
  let current: { readonly source: AudioBufferSourceNode; readonly id: string; readonly start: number; readonly length: number } | undefined
  let frame: number | undefined

  const tick = (): void => {
    frame = undefined
    onChange()
    if (current !== undefined) frame = requestAnimationFrame(tick)
  }

  const stop = (): void => {
    if (current === undefined) return
    const { source } = current
    current = undefined
    source.onended = null
    source.stop()
    onChange()
  }

  return {
    play: (rendered, id) => {
      stop()
      context ??= new AudioContext()
      void context.resume()
      const buffer = context.createBuffer(1, Math.max(1, rendered.samples.length), rendered.sampleRate)
      buffer.copyToChannel(rendered.samples, 0)
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      const playing = { source, id, start: context.currentTime, length: buffer.duration }
      source.onended = () => {
        if (current?.source !== source) return
        current = undefined
        onChange()
      }
      current = playing
      source.start()
      if (frame === undefined) frame = requestAnimationFrame(tick)
    },
    stop,
    playing: () =>
      current === undefined || context === undefined
        ? undefined
        : { id: current.id, at: Math.min(current.length, context.currentTime - current.start), length: current.length }
  }
}
