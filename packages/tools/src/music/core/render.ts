/**
 * Turns a song into stereo samples: every note played by its instrument,
 * placed at its beat, panned, sent to a shared room, and mixed. The same
 * bits come out in Node and in every browser (noise is seeded by the note
 * itself), so the CLI measures exactly what the page plays.
 *
 * A looping song is rendered one pass long, with what rings past its end
 * (a last chord, the room) folded back over its start: played on repeat, it
 * has no seam.
 */
import { isDrum, isKit, playDrum, playVoice, type InstrumentId } from "./instruments.ts"
import { lengthInSeconds, midiOf, secondsPerBeat, type Note, type Song, type Track } from "./song.ts"

export const SAMPLE_RATE = 44100

export interface Stereo {
  readonly sampleRate: number
  readonly left: Float32Array<ArrayBuffer>
  readonly right: Float32Array<ArrayBuffer>
}

/** Notes already played, by what they are: a melody repeats, so most notes render once. Pass one cache to many renders (the page does). */
export type NoteCache = Map<string, Float32Array>

export interface RenderOptions {
  readonly sampleRate?: number
  /** Only these tracks (by index); muted tracks are left out unless named here. */
  readonly tracks?: ReadonlyArray<number>
  readonly cache?: NoteCache | undefined
}

/** A seeded generator of numbers in [0, 1) (mulberry32). */
export const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hash = (text: string): number => {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/** One note's samples, from the cache when it was played before. */
export const noteSamples = (instrument: InstrumentId, note: Pick<Note, "pitch" | "velocity">, held: number, rate: number, cache?: NoteCache): Float32Array => {
  const key = `${instrument}|${note.pitch}|${Math.round(held * 1000)}|${Math.round(note.velocity * 100)}|${rate}`
  const found = cache?.get(key)
  if (found !== undefined) return found
  const velocity = Math.round(note.velocity * 100) / 100
  const random = seeded(hash(key))
  const midi = midiOf(note.pitch)
  const samples =
    isKit(instrument)
      ? isDrum(note.pitch)
        ? playDrum(instrument, note.pitch, velocity, rate, random)
        : new Float32Array(0)
      : midi === undefined
        ? new Float32Array(0)
        : playVoice(instrument, midi, held, velocity, rate, random)
  if (cache !== undefined) {
    if (cache.size > 4000) cache.clear()
    cache.set(key, samples)
  }
  return samples
}

// ---------------------------------------------------------------------------
// The room: a Freeverb (eight combs and four allpasses a side), the classic small reverb.

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
const ALLPASSES = [556, 441, 341, 225]
const SPREAD = 23

const room = (input: Float32Array, rate: number, offset: number): Float32Array => {
  const scale = rate / 44100
  const out = new Float32Array(input.length)
  const feedback = 0.84
  const damp = 0.3
  for (const size of COMBS) {
    const line = new Float32Array(Math.round((size + offset) * scale))
    let at = 0
    let store = 0
    for (let i = 0; i < input.length; i++) {
      const y = line[at]!
      store = y * (1 - damp) + store * damp
      line[at] = input[i]! + store * feedback
      at = (at + 1) % line.length
      out[i]! += y
    }
  }
  for (const size of ALLPASSES) {
    const line = new Float32Array(Math.round((size + offset) * scale))
    let at = 0
    for (let i = 0; i < out.length; i++) {
      const buffered = line[at]!
      const x = out[i]!
      line[at] = x + buffered * 0.5
      out[i] = buffered - x
      at = (at + 1) % line.length
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The compressor: one gain for both sides, following the louder one

const THRESHOLD = 0.18
const RATIO = 4
const MAKEUP = 2.2
const CEILING = 0.89

/**
 * Squeezes the mix: above the threshold, every 4 dB in becomes 1 dB out
 * (fast to clamp down, slower to let go), the result is raised back up, and
 * a soft clip holds the peaks under -1 dBFS. A looping song is run through
 * its own end first, so the start is squeezed as it is when the loop comes round.
 */
const compress = (left: Float32Array, right: Float32Array, rate: number, loop: boolean): void => {
  const attack = Math.exp(-1 / (0.004 * rate))
  const release = Math.exp(-1 / (0.15 * rate))
  let level = 0
  const follow = (i: number): number => {
    const x = Math.max(Math.abs(left[i]!), Math.abs(right[i]!))
    level = x > level ? x + (level - x) * attack : x + (level - x) * release
    return level
  }
  if (loop) for (let i = Math.max(0, left.length - Math.round(rate)); i < left.length; i++) follow(i)
  const clip = (x: number): number => (Math.abs(x) < CEILING * 0.7 ? x : Math.sign(x) * (CEILING * 0.7 + CEILING * 0.3 * Math.tanh((Math.abs(x) - CEILING * 0.7) / (CEILING * 0.3))))
  for (let i = 0; i < left.length; i++) {
    const env = follow(i)
    const gain = (env > THRESHOLD ? Math.pow(env / THRESHOLD, 1 / RATIO - 1) : 1) * MAKEUP
    left[i] = clip(left[i]! * gain)
    right[i] = clip(right[i]! * gain)
  }
}

/** How long the room rings past the last note, in seconds. */
const TAIL = 3
const ROOM_LEVEL = 0.12

// ---------------------------------------------------------------------------

/** Places a track's notes into `left` and `right` (and its share of the room into `send`). */
const addTrack = (track: Track, song: Song, rate: number, left: Float32Array, right: Float32Array, send: Float32Array, cache: NoteCache | undefined): void => {
  const beat = secondsPerBeat(song)
  // Constant-power panning: as loud in the middle as at either side.
  const angle = ((track.pan + 1) * Math.PI) / 4
  const gainLeft = Math.cos(angle) * track.volume
  const gainRight = Math.sin(angle) * track.volume
  for (const note of track.notes) {
    const samples = noteSamples(track.instrument, note, note.length * beat, rate, cache)
    const start = Math.round(note.at * beat * rate)
    const end = Math.min(left.length, start + samples.length)
    for (let i = start; i < end; i++) {
      const x = samples[i - start]!
      left[i]! += x * gainLeft
      right[i]! += x * gainRight
      send[i]! += x * track.volume * track.reverb
    }
  }
}

/** Renders the song (or some of its tracks) as stereo samples, at the song's master volume. */
export const renderSong = (song: Song, options: RenderOptions = {}): Stereo => {
  const rate = options.sampleRate ?? SAMPLE_RATE
  const pass = Math.round(lengthInSeconds(song) * rate)
  const total = pass + Math.round(TAIL * rate)
  const left = new Float32Array(total)
  const right = new Float32Array(total)
  const send = new Float32Array(total)
  song.tracks.forEach((track, index) => {
    const chosen = options.tracks === undefined ? track.mute !== true : options.tracks.includes(index)
    if (chosen) addTrack(track, song, rate, left, right, send, options.cache)
  })
  if (send.some((x) => x !== 0)) {
    const wetLeft = room(send, rate, 0)
    const wetRight = room(send, rate, SPREAD)
    for (let i = 0; i < total; i++) {
      left[i]! += wetLeft[i]! * ROOM_LEVEL
      right[i]! += wetRight[i]! * ROOM_LEVEL
    }
  }
  for (let i = 0; i < total; i++) {
    left[i]! *= song.master
    right[i]! *= song.master
  }
  if (!song.loop) {
    let end = total
    while (end > pass && Math.abs(left[end - 1]!) < 0.0001 && Math.abs(right[end - 1]!) < 0.0001) end--
    const out = { sampleRate: rate, left: left.slice(0, end), right: right.slice(0, end) }
    if (song.compressor) compress(out.left, out.right, rate, false)
    return out
  }
  // The tail wraps into the start: the loop's seam is filled by its own end.
  for (let i = pass; i < total; i++) {
    const at = (i - pass) % pass
    left[at]! += left[i]!
    right[at]! += right[i]!
  }
  const out = { sampleRate: rate, left: left.slice(0, pass), right: right.slice(0, pass) }
  if (song.compressor) compress(out.left, out.right, rate, true)
  return out
}

/** The loudest sample in dBFS (0 is full scale). */
export const peakOf = ({ left, right }: Stereo): number => {
  let peak = 0
  for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!))
  return peak === 0 ? -120 : Math.round(20 * Math.log10(peak) * 10) / 10
}

/** The loudness over the whole song as RMS in dBFS: how loud it feels next to other music. */
export const loudnessOf = ({ left, right }: Stereo): number => {
  let sum = 0
  for (let i = 0; i < left.length; i++) sum += left[i]! * left[i]! + right[i]! * right[i]!
  const rms = Math.sqrt(sum / Math.max(1, left.length * 2))
  return rms === 0 ? -120 : Math.round(20 * Math.log10(rms) * 10) / 10
}
