/**
 * Plays rendered songs through Web Audio: the samples the CLI measures, not
 * a second synthesis, so what the person hears is what the agent read. A
 * looping song loops; swapping in a new render keeps the place, so an edit
 * is heard where the music is.
 */
import type { Stereo } from "../core/render.ts"

export interface Player {
  /** Plays `song` from `at` seconds; a song already playing is replaced at its own position unless `at` is given. */
  readonly play: (song: Stereo, options: { readonly loop: boolean; readonly at?: number | undefined; readonly extra?: AudioBuffer | undefined; readonly extraAt?: number | undefined }) => void
  readonly stop: () => void
  /** Seconds into the song, or undefined when stopped. */
  readonly position: () => number | undefined
  /** Plays a short sound once, over whatever plays (a note being placed). */
  readonly audition: (samples: Float32Array, sampleRate: number) => void
  /** Decodes any audio file the browser can play. */
  readonly decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>
  readonly context: () => AudioContext
}

/** `onChange` runs every frame while a song plays, and once when it stops. */
export const makePlayer = (onChange: () => void): Player => {
  let context: AudioContext | undefined
  let current: { readonly sources: ReadonlyArray<AudioBufferSourceNode>; readonly start: number; readonly offset: number; readonly length: number; readonly loop: boolean } | undefined
  let frame: number | undefined

  const audio = (): AudioContext => {
    context ??= new AudioContext()
    void context.resume()
    return context
  }

  const tick = (): void => {
    frame = undefined
    onChange()
    if (current !== undefined) frame = requestAnimationFrame(tick)
  }

  const position = (): number | undefined => {
    if (current === undefined || context === undefined) return undefined
    const elapsed = context.currentTime - current.start + current.offset
    return current.loop ? elapsed % current.length : Math.min(current.length, elapsed)
  }

  const halt = (): void => {
    if (current === undefined) return
    for (const source of current.sources) {
      source.onended = null
      source.stop()
    }
    current = undefined
  }

  return {
    play: (song, options) => {
      const ctx = audio()
      const at = options.at ?? position() ?? 0
      halt()
      const length = song.left.length / song.sampleRate
      const buffer = ctx.createBuffer(2, Math.max(1, song.left.length), song.sampleRate)
      buffer.copyToChannel(song.left, 0)
      buffer.copyToChannel(song.right, 1)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = options.loop
      source.connect(ctx.destination)
      const sources = [source]
      const start = ctx.currentTime + 0.02
      const offset = Math.max(0, Math.min(at, length - 0.001))
      source.start(start, offset)
      // The reference plays beside the song, lined up on its beat 0, once per pass.
      if (options.extra !== undefined) {
        const extra = ctx.createBufferSource()
        extra.buffer = options.extra
        extra.connect(ctx.destination)
        const into = offset + (options.extraAt ?? 0)
        if (into < options.extra.duration) {
          extra.start(start + Math.max(0, -into), Math.max(0, into))
          sources.push(extra)
        }
      }
      source.onended = () => {
        if (current?.sources[0] !== source) return
        current = undefined
        onChange()
      }
      current = { sources, start, offset, length, loop: options.loop }
      if (frame === undefined) frame = requestAnimationFrame(tick)
    },
    stop: () => {
      halt()
      onChange()
    },
    position,
    audition: (samples, sampleRate) => {
      const ctx = audio()
      const buffer = ctx.createBuffer(1, Math.max(1, samples.length), sampleRate)
      buffer.copyToChannel(new Float32Array(samples), 0)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.start()
    },
    decode: (bytes) => audio().decodeAudioData(bytes),
    context: audio
  }
}
