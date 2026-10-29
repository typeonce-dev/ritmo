/**
 * Listening for the agent, which cannot hear: turns a hum, a whistle, a
 * tapped beat, or a recorded tune into what a song is written in, a tempo,
 * a key, and a melody of whole notes on a grid of beats.
 *
 * - The melody follows the strongest pitch moment to moment (YIN, the
 *   standard pitch tracker for one voice), cut into notes where the pitch
 *   jumps or the voice re-starts. Best on one voice: a hum, a whistle, a
 *   lead line; under a full band it follows whatever is loudest.
 * - The tempo is the beat that lines up best with where notes and hits
 *   start.
 * - The key is the major or minor key whose notes match how long each
 *   pitch sounds (Krumhansl's key profiles), from the whole spectrum, so it
 *   works on chords and full recordings too.
 */
import { fft } from "../../sound/core/render.ts"
import { nameOf, type HeardNote, type Reference } from "./song.ts"

export interface Heard extends Reference {
  /** What the listening found, for the agent: how much of the audio had a clear pitch, how many notes, how sure the tempo is. */
  readonly found: {
    readonly seconds: number
    /** Share of the audio with a clear, sung or played pitch, 0 to 1. */
    readonly voiced: number
    /** Where the melody sits: its lowest and highest notes. */
    readonly range: readonly [string, string] | undefined
    /** How much better the chosen tempo fits than the next best, 0 (a guess) to 1 (clear). */
    readonly tempoConfidence: number
  }
}

export interface ListenOptions {
  /** The tempo, when it is known (a metronome was on, or the person said so): only the melody and key are listened for. */
  readonly tempo?: number | undefined
  /** The audio file's name, kept in the reference. */
  readonly audio?: string | undefined
}

/** The rate pitch tracking runs at: plenty for voices (up to about 1.6 kHz) and quick. */
const RATE = 11025
const WINDOW = 512
const HOP = 64
const LOWEST = 70
const HIGHEST = 1600

/** Low-passes and decimates to about `RATE`, so pitch tracking is cheap. */
const downsample = (samples: Float32Array, rate: number): { readonly samples: Float32Array; readonly rate: number } => {
  const factor = Math.max(1, Math.round(rate / RATE))
  if (factor === 1) return { samples, rate }
  const out = new Float32Array(Math.floor(samples.length / factor))
  // Two passes of a box filter as wide as the factor: enough to keep the octave above the cut out.
  for (let i = 0; i < out.length; i++) {
    let sum = 0
    const from = Math.max(0, i * factor - factor)
    const to = Math.min(samples.length, i * factor + factor)
    for (let j = from; j < to; j++) sum += samples[j]! * (1 - Math.abs(j - i * factor) / factor)
    out[i] = sum / factor
  }
  return { samples: out, rate: rate / factor }
}

interface Frame {
  readonly time: number
  readonly rms: number
  /** MIDI number (fractional), or 0 for no clear pitch. */
  readonly pitch: number
  readonly clarity: number
}

/** YIN: the lag at which the signal best repeats itself is one period of its pitch. */
const track = (samples: Float32Array, rate: number): Array<Frame> => {
  const maxLag = Math.floor(rate / LOWEST)
  const minLag = Math.floor(rate / HIGHEST)
  const difference = new Float64Array(maxLag + 1)
  const frames: Array<Frame> = []
  for (let start = 0; start + WINDOW + maxLag < samples.length; start += HOP) {
    let energy = 0
    for (let i = 0; i < WINDOW; i++) energy += samples[start + i]! ** 2
    const rms = Math.sqrt(energy / WINDOW)
    difference[0] = 1
    let running = 0
    let lag = -1
    for (let tau = 1; tau <= maxLag; tau++) {
      let sum = 0
      for (let i = 0; i < WINDOW; i++) {
        const d = samples[start + i]! - samples[start + i + tau]!
        sum += d * d
      }
      running += sum
      difference[tau] = running === 0 ? 1 : (sum * tau) / running
    }
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (difference[tau]! < 0.15) {
        while (tau + 1 <= maxLag && difference[tau + 1]! < difference[tau]!) tau++
        lag = tau
        break
      }
    }
    if (lag < 0) {
      // No dip under the threshold: the deepest one, if it is deep enough to be a pitch at all.
      let best = minLag
      for (let tau = minLag; tau <= maxLag; tau++) if (difference[tau]! < difference[best]!) best = tau
      if (difference[best]! < 0.35) lag = best
    }
    let pitch = 0
    let clarity = 0
    if (lag > 0) {
      // A parabola through the dip finds the period between samples.
      const a = difference[lag - 1] ?? difference[lag]!
      const b = difference[lag]!
      const c = difference[lag + 1] ?? difference[lag]!
      const shift = a + c - 2 * b === 0 ? 0 : (a - c) / (2 * (a + c - 2 * b))
      const frequency = rate / (lag + shift)
      pitch = 69 + 12 * Math.log2(frequency / 440)
      clarity = 1 - b
    }
    frames.push({ time: (start + WINDOW / 2) / rate, rms, pitch, clarity })
  }
  return frames
}

const median = (values: ReadonlyArray<number>): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]!
}

interface RawNote {
  readonly start: number
  readonly end: number
  readonly pitch: number
}

/** Cuts the pitch line into notes: a note holds while the pitch stays near its middle and the voice does not re-start. */
const segment = (frames: ReadonlyArray<Frame>, rate: number): { readonly notes: Array<RawNote>; readonly voiced: Array<boolean> } => {
  const loud = median(frames.map((frame) => frame.rms).filter((rms) => rms > 0)) * 0.3
  const peak = frames.reduce((max, frame) => Math.max(max, frame.rms), 0)
  const floor = Math.max(loud, peak * 0.06)
  const voiced = frames.map((frame) => frame.pitch > 0 && frame.clarity > 0.6 && frame.rms > floor)
  // A median over a few frames removes one-frame octave slips.
  const smooth = frames.map((_, i) => {
    if (!voiced[i]) return 0
    const near: Array<number> = []
    for (let j = Math.max(0, i - 3); j <= Math.min(frames.length - 1, i + 3); j++) if (voiced[j]) near.push(frames[j]!.pitch)
    return median(near)
  })
  const notes: Array<RawNote> = []
  const frameTime = HOP / rate
  let current: { start: number; pitches: Array<number>; quiet: number } | undefined
  const close = (end: number): void => {
    if (current !== undefined && end - current.start >= 0.07) notes.push({ start: current.start, end, pitch: median(current.pitches) })
    current = undefined
  }
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!
    if (!voiced[i]) {
      // A short dip (a breath, a consonant) inside a held note is not its end.
      if (current !== undefined && ++current.quiet * frameTime > 0.04) close(frame.time - current.quiet * frameTime)
      continue
    }
    const pitch = smooth[i]!
    // A re-start: the voice comes back up sharply from a dip, as in "da-da" on one pitch.
    const before = frames[i - 6]?.rms ?? 0
    const restart = current !== undefined && frame.rms > before * 2.2 && before < peak * 0.25
    if (current !== undefined && (Math.abs(pitch - median(current.pitches)) > 0.7 || restart)) close(frame.time)
    if (current === undefined) current = { start: frame.time, pitches: [], quiet: 0 }
    current.pitches.push(pitch)
    current.quiet = 0
  }
  close(frames[frames.length - 1]?.time ?? 0)
  return { notes, voiced }
}

/** Where sound starts: a rise in loudness, for beats without a pitch (taps, claps, drums). */
const hits = (frames: ReadonlyArray<Frame>): Array<number> => {
  const peak = frames.reduce((max, frame) => Math.max(max, frame.rms), 0)
  const found: Array<number> = []
  for (let i = 4; i < frames.length; i++) {
    const before = Math.min(...frames.slice(i - 4, i).map((frame) => frame.rms))
    const now = frames[i]!.rms
    if (now > peak * 0.2 && now > before * 2.5 && (found.length === 0 || frames[i]!.time - found[found.length - 1]! > 0.09)) found.push(frames[i]!.time)
  }
  return found
}

/** The tempo whose beats (and half beats) land nearest the onsets, preferring the 80–140 range songs mostly sit in. */
const findTempo = (onsets: ReadonlyArray<number>): { readonly tempo: number; readonly confidence: number } => {
  if (onsets.length < 3) return { tempo: 100, confidence: 0 }
  const scores: Array<{ readonly tempo: number; readonly score: number }> = []
  for (let tempo = 60; tempo <= 180; tempo += 0.5) {
    const beat = 60 / tempo
    // Each onset scores by how near it falls to an eighth note of the grid, the grid starting on the first onset.
    let score = 0
    for (const onset of onsets) {
      const position = (onset - onsets[0]!) / (beat / 2)
      const off = Math.abs(position - Math.round(position))
      score += Math.exp(-((off / 0.12) ** 2)) * (Math.round(position) % 2 === 0 ? 1 : 0.6)
    }
    // A finer grid always fits more onsets; this prior keeps it to tempos people hum and play at.
    const prior = Math.exp(-0.5 * (Math.log2(tempo / 105) / 0.45) ** 2)
    scores.push({ tempo, score: (score / onsets.length) * prior })
  }
  scores.sort((a, b) => b.score - a.score)
  const best = scores[0]!
  // The runner-up that is not a near neighbour of the best.
  const rival = scores.find((entry) => Math.abs(entry.tempo - best.tempo) > 4)
  return { tempo: best.tempo, confidence: rival === undefined || best.score === 0 ? 1 : Math.max(0, Math.min(1, (best.score - rival.score) / best.score / 0.25)) }
}

// Krumhansl-Kessler key profiles: how strongly each note of the scale belongs to a major or a minor key.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

const correlation = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): number => {
  const meanA = a.reduce((s, x) => s + x, 0) / a.length
  const meanB = b.reduce((s, x) => s + x, 0) / b.length
  let top = 0
  let left = 0
  let right = 0
  for (let i = 0; i < a.length; i++) {
    top += (a[i]! - meanA) * (b[i]! - meanB)
    left += (a[i]! - meanA) ** 2
    right += (b[i]! - meanB) ** 2
  }
  return left === 0 || right === 0 ? 0 : top / Math.sqrt(left * right)
}

/** How much each of the twelve pitch classes sounds, from the spectrum (chords and full recordings) and the heard notes. */
const chroma = (samples: Float32Array, rate: number, notes: ReadonlyArray<RawNote>): Array<number> => {
  const classes = Array.from({ length: 12 }, () => 0)
  const size = 4096
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let start = 0; start + size <= samples.length; start += size / 2) {
    for (let i = 0; i < size; i++) {
      re[i] = samples[start + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size))
      im[i] = 0
    }
    fft(re, im, false)
    for (let bin = 1; bin < size / 2; bin++) {
      const frequency = (bin * rate) / size
      if (frequency < 65 || frequency > 2100) continue
      const midi = 69 + 12 * Math.log2(frequency / 440)
      classes[((Math.round(midi) % 12) + 12) % 12]! += Math.sqrt(re[bin]! ** 2 + im[bin]! ** 2)
    }
  }
  const total = classes.reduce((s, x) => s + x, 0) || 1
  const fromNotes = Array.from({ length: 12 }, () => 0)
  for (const note of notes) fromNotes[((Math.round(note.pitch) % 12) + 12) % 12]! += note.end - note.start
  const noteTotal = fromNotes.reduce((s, x) => s + x, 0) || 1
  return classes.map((value, i) => value / total + fromNotes[i]! / noteTotal)
}

const findKey = (weights: ReadonlyArray<number>): string => {
  let best = { score: -2, key: "C major" }
  for (let root = 0; root < 12; root++) {
    const rotated = weights.map((_, i) => weights[(i + root) % 12]!)
    const major = correlation(rotated, MAJOR)
    const minor = correlation(rotated, MINOR)
    if (major > best.score) best = { score: major, key: `${NAMES[root]} major` }
    if (minor > best.score) best = { score: minor, key: `${NAMES[root]} minor` }
  }
  return best.key
}

/** The grid notes snap to: sixteenth notes. */
const GRID = 0.25

/** Listens to audio (mono samples) and writes down what it heard. */
export const listen = (input: Float32Array, sampleRate: number, options: ListenOptions = {}): Heard => {
  const { samples, rate } = downsample(input, sampleRate)
  const frames = track(samples, rate)
  const { notes: raw, voiced } = segment(frames, rate)
  const onsets = raw.length >= 3 ? raw.map((note) => note.start) : hits(frames)
  const found = options.tempo === undefined ? findTempo(onsets) : { tempo: options.tempo, confidence: 1 }
  const tempo = Math.round(found.tempo)
  const beat = 60 / tempo
  const start = onsets[0] ?? 0
  const toBeats = (seconds: number): number => Math.max(0, Math.round((seconds - start) / beat / GRID) * GRID)
  const notes: Array<HeardNote> = []
  for (const note of raw) {
    const at = toBeats(note.start)
    const end = Math.max(at + GRID, toBeats(note.end))
    const previous = notes[notes.length - 1]
    const pitch = nameOf(Math.round(note.pitch))
    // Two notes snapped onto one grid step: the longer stays.
    if (previous !== undefined && previous.at === at) {
      if (end - at > previous.length) notes[notes.length - 1] = { at, length: end - at, pitch }
      continue
    }
    if (previous !== undefined && previous.at + previous.length > at) notes[notes.length - 1] = { ...previous, length: at - previous.at }
    notes.push({ at, length: end - at, pitch })
  }
  // A sung note mostly stops a moment before the next: one that ends within a sixteenth of the next is held up to it.
  for (let i = 0; i + 1 < notes.length; i++) {
    const note = notes[i]!
    const gap = notes[i + 1]!.at - (note.at + note.length)
    if (gap > 0 && gap <= GRID) notes[i] = { ...note, length: note.length + gap }
  }
  const lastTime = frames[frames.length - 1]?.time ?? 0
  const length = Math.max(GRID, Math.ceil((lastTime - start) / beat / GRID) * GRID)
  // The pitch line, an eighth of a beat a step, for drawing under the song.
  const contour: Array<number> = []
  for (let b = 0; b < length; b += 0.125) {
    const time = start + b * beat
    const near = frames.filter((frame, i) => voiced[i] && Math.abs(frame.time - time) < (beat * 0.125) / 2 + 0.003)
    contour.push(near.length === 0 ? 0 : Math.round(median(near.map((frame) => frame.pitch)) * 10) / 10)
  }
  const midis = raw.map((note) => Math.round(note.pitch))
  return {
    audio: options.audio,
    tempo,
    key: findKey(chroma(samples, rate, raw)),
    length,
    notes,
    contour,
    offset: 0,
    start: Math.round(start * 1000) / 1000,
    found: {
      seconds: Math.round((input.length / sampleRate) * 100) / 100,
      voiced: Math.round((voiced.filter(Boolean).length / Math.max(1, voiced.length)) * 100) / 100,
      range: midis.length === 0 ? undefined : [nameOf(Math.min(...midis)), nameOf(Math.max(...midis))],
      tempoConfidence: Math.round(found.confidence * 100) / 100
    }
  }
}

/** The reference as the song keeps it (what was found is for the agent's eyes only). */
export const referenceOf = (heard: Heard): Reference => {
  const { found: _found, ...reference } = heard
  return reference
}
