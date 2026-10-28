/**
 * Turns a recipe into samples: mono, 44.1 kHz by default, the same bits in
 * Node and in every browser (noise comes from a seeded generator, not
 * `Math.random`). The instruments follow Web Audio's own (exponential
 * ramps, biquad filters, a wave-shaper curve, a convolution room), so a game
 * that builds the same layers live with Web Audio sounds the same; a game can
 * also play these samples as they are.
 */
import { applyTune, type Filter, type Layer, type Recipe, type Wave } from "./recipe.ts"

export interface RenderOptions {
  readonly sampleRate?: number
  /** Which take of the noise: two seeds make two slightly different hits of one sound. */
  readonly seed?: number
  /** The game's master volume over every sound (the bank's `master`), 1 by default. */
  readonly master?: number | undefined
}

export interface Rendered {
  readonly sampleRate: number
  readonly samples: Float32Array<ArrayBuffer>
}

export const SAMPLE_RATE = 44100
/** How long the room rings, in seconds. */
const ROOM = 1.3
/** How loud the room returns. */
const ROOM_LEVEL = 0.9
/** Web Audio's ramps start and end here, not at 0 (an exponential ramp cannot reach 0). */
const FLOOR = 0.0001

// ---------------------------------------------------------------------------
// Small pieces

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

/** An exponential ramp from `a` to `b` over `[0, length]`, as Web Audio's `exponentialRampToValueAtTime`. */
const ramp = (a: number, b: number, t: number, length: number): number => (length <= 0 ? b : a * Math.pow(b / a, Math.min(1, Math.max(0, t / length))))

/** A layer's loudness at `t` seconds into it: up from silence over `attack`, down to silence at `duration`. */
const envelope = (t: number, duration: number, gain: number, attack: number): number => {
  if (t < 0 || t >= duration) return 0
  const top = Math.max(0.0002, gain)
  const rise = Math.min(attack, duration * 0.9)
  return t < rise ? ramp(FLOOR, top, t, rise) : ramp(top, FLOOR, t - rise, duration - rise)
}

/** Corrects a naive square or sawtooth at its jumps, so high notes do not alias (PolyBLEP). */
const blep = (phase: number, step: number): number => {
  if (phase < step) {
    const t = phase / step
    return t + t - t * t - 1
  }
  if (phase > 1 - step) {
    const t = (phase - 1) / step
    return t * t + t + t + 1
  }
  return 0
}

const oscillator = (wave: Wave, phase: number, step: number): number => {
  switch (wave) {
    case "sine":
      return Math.sin(2 * Math.PI * phase)
    case "triangle":
      return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase
    case "square":
      return (phase < 0.5 ? 1 : -1) + blep(phase, step) - blep((phase + 0.5) % 1, step)
    case "sawtooth":
      return 2 * phase - 1 - blep(phase, step)
  }
}

/**
 * A biquad filter (the RBJ cookbook, as Web Audio's BiquadFilterNode): `q`
 * is in decibels for lowpass and highpass, a plain Q for bandpass. Its
 * frequency can move every few samples.
 */
const makeBiquad = (type: Filter, q: number, sampleRate: number) => {
  let b0 = 0
  let b1 = 0
  let b2 = 0
  let a1 = 0
  let a2 = 0
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  const set = (frequency: number): void => {
    const w = (2 * Math.PI * Math.min(frequency, sampleRate * 0.49)) / sampleRate
    const cos = Math.cos(w)
    const qLinear = type === "bandpass" ? Math.max(0.0001, q) : Math.pow(10, q / 20)
    const alpha = Math.sin(w) / (2 * qLinear)
    const a0 = 1 + alpha
    if (type === "lowpass") {
      b0 = (1 - cos) / 2 / a0
      b1 = (1 - cos) / a0
      b2 = b0
    } else if (type === "highpass") {
      b0 = (1 + cos) / 2 / a0
      b1 = -(1 + cos) / a0
      b2 = b0
    } else {
      b0 = alpha / a0
      b1 = 0
      b2 = -alpha / a0
    }
    a1 = (-2 * cos) / a0
    a2 = (1 - alpha) / a0
  }
  const step = (x: number): number => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    return y
  }
  return { set, step }
}

/** How often (in samples) a moving filter recomputes itself. */
const FILTER_STEP = 16

/** The metal's partials: [frequency ratio, level, share of the duration]. */
const PARTIALS = [
  [1, 1, 1],
  [2.76, 0.6, 0.7],
  [5.4, 0.4, 0.45],
  [8.93, 0.25, 0.3]
] as const

/** A click is a noise layer this short and bright. */
const CLICK = { filter: "highpass", from: 5000, to: 3000, q: 0.8, duration: 0.016, attack: 0.001 } as const

/** Where a layer ends, in seconds from the sound's start. */
export const layerEnd = (layer: Layer): number => layer.delay + (layer.type === "click" ? CLICK.duration : layer.duration)

// ---------------------------------------------------------------------------
// Instruments: each adds its layer into `out`

const addTone = (out: Float32Array, rate: number, wave: Wave, from: number, to: number, duration: number, gain: number, delay: number, attack: number): void => {
  const start = Math.round(delay * rate)
  const count = Math.ceil(duration * rate)
  let phase = 0
  for (let i = 0; i < count && start + i < out.length; i++) {
    const t = i / rate
    const frequency = ramp(from, Math.max(1, to), t, duration)
    const step = frequency / rate
    out[start + i]! += oscillator(wave, phase, step) * envelope(t, duration, gain, attack)
    phase += step
    phase -= Math.floor(phase)
  }
}

/**
 * Filtered noise. `frequency` gives the filter's frequency at `t`, `level`
 * the loudness; `shape` bends each sample after the filter (the crunch's
 * distortion).
 */
const addNoise = (
  out: Float32Array,
  rate: number,
  random: () => number,
  filter: Filter,
  q: number,
  delay: number,
  duration: number,
  frequency: (t: number) => number,
  level: (t: number) => number,
  shape?: (x: number) => number
): void => {
  const start = Math.round(delay * rate)
  const count = Math.ceil(duration * rate)
  const biquad = makeBiquad(filter, q, rate)
  for (let i = 0; i < count && start + i < out.length; i++) {
    const t = i / rate
    if (i % FILTER_STEP === 0) biquad.set(frequency(t))
    let x = biquad.step(random() * 2 - 1)
    if (shape !== undefined) x = shape(x)
    out[start + i]! += x * level(t)
  }
}

/** The crunch's distortion: 6× drive into a tanh curve, clamped as Web Audio's wave shaper clamps its input. */
const crunchShape = (x: number): number => Math.tanh(3 * Math.max(-1, Math.min(1, x * 6)))

const addLayer = (out: Float32Array, rate: number, layer: Layer, random: () => number): void => {
  switch (layer.type) {
    case "tone":
      addTone(out, rate, layer.wave, layer.from, layer.to, layer.duration, layer.gain, layer.delay, layer.attack)
      return
    case "noise":
      addNoise(
        out,
        rate,
        random,
        layer.filter,
        layer.q,
        layer.delay,
        layer.duration,
        (t) => ramp(layer.from, Math.max(1, layer.to), t, layer.duration),
        (t) => envelope(t, layer.duration, layer.gain, layer.attack)
      )
      return
    case "click":
      addNoise(
        out,
        rate,
        random,
        CLICK.filter,
        CLICK.q,
        layer.delay,
        CLICK.duration,
        (t) => ramp(CLICK.from, CLICK.to, t, CLICK.duration),
        (t) => envelope(t, CLICK.duration, layer.gain, CLICK.attack)
      )
      return
    case "swish": {
      const top = layer.duration * layer.peakAt
      addNoise(
        out,
        rate,
        random,
        "bandpass",
        layer.q,
        layer.delay,
        layer.duration,
        (t) => (t < top ? ramp(layer.low, layer.peak, t, top) : ramp(layer.peak, layer.low * 0.8, t - top, layer.duration - top)),
        (t) => (t < top ? ramp(FLOOR, Math.max(0.0002, layer.gain), t, top) : ramp(Math.max(0.0002, layer.gain), FLOOR, t - top, layer.duration - top))
      )
      return
    }
    case "crunch":
      addNoise(
        out,
        rate,
        random,
        "bandpass",
        1.4,
        layer.delay,
        layer.duration,
        (t) => ramp(layer.from, Math.max(1, layer.to), t, layer.duration),
        (t) => envelope(t, layer.duration, layer.gain, 0.002),
        crunchShape
      )
      return
    case "metal":
      for (const [ratio, level, share] of PARTIALS) {
        addTone(out, rate, "sine", layer.pitch * ratio, layer.pitch * ratio * 0.998, layer.duration * share, layer.gain * level, layer.delay, 0.002)
      }
      return
  }
}

// ---------------------------------------------------------------------------
// The room

/** In place, the FFT of `re` and `im` (their length a power of two); `inverse` without the 1/n. */
export const fft = (re: Float64Array, im: Float64Array, inverse: boolean): void => {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    for (let i = 0; i < n; i += size) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < size / 2; k++) {
        const a = i + k
        const b = a + size / 2
        const tr = re[b]! * cr - im[b]! * ci
        const ti = re[b]! * ci + im[b]! * cr
        re[b] = re[a]! - tr
        im[b] = im[a]! - ti
        re[a] = re[a]! + tr
        im[a] = im[a]! + ti
        const next = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = next
      }
    }
  }
}

/** The room's impulse: noise decaying over `ROOM` seconds, darker as it fades (air takes the highs first). */
const roomImpulse = (rate: number): Float64Array => {
  const random = seeded(0x5eed)
  const length = Math.floor(rate * ROOM)
  const preDelay = Math.floor(rate * 0.012)
  const impulse = new Float64Array(length)
  let smooth = 0
  let power = 0
  for (let i = preDelay; i < length; i++) {
    const t = (i - preDelay) / (length - preDelay)
    const darken = 0.15 + 0.8 * t
    smooth = smooth * darken + (random() * 2 - 1) * (1 - darken)
    impulse[i] = smooth * Math.pow(1 - t, 3) * (1.6 + 2 * t)
    power += impulse[i]! * impulse[i]!
  }
  // Normalized as Web Audio's ConvolverNode normalizes its buffer.
  const scale = 0.00125 / Math.sqrt(power / length)
  for (let i = 0; i < length; i++) impulse[i]! *= scale
  return impulse
}

const rooms = new Map<number, { readonly size: number; readonly re: Float64Array; readonly im: Float64Array }>()

/** The sound in the room: its own samples convolved with the room's impulse, `send` of it. */
const addRoom = (out: Float32Array, dryLength: number, rate: number, send: number): void => {
  if (send <= 0) return
  let size = 1
  while (size < dryLength + Math.floor(rate * ROOM)) size <<= 1
  let room = rooms.get(rate)
  if (room === undefined || room.size !== size) {
    const impulse = roomImpulse(rate)
    const re = new Float64Array(size)
    const im = new Float64Array(size)
    re.set(impulse)
    fft(re, im, false)
    room = { size, re, im }
    rooms.set(rate, room)
  }
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let i = 0; i < dryLength; i++) re[i] = out[i]! * send
  fft(re, im, false)
  for (let i = 0; i < size; i++) {
    const r = re[i]! * room.re[i]! - im[i]! * room.im[i]!
    im[i] = re[i]! * room.im[i]! + im[i]! * room.re[i]!
    re[i] = r
  }
  fft(re, im, true)
  for (let i = 0; i < out.length && i < size; i++) out[i]! += (re[i]! / size) * ROOM_LEVEL
}

// ---------------------------------------------------------------------------

/** How long the sound's own layers last, in seconds (the room rings past it). */
export const dryLength = (recipe: Recipe): number => applyTune(recipe).layers.reduce((end, layer) => Math.max(end, layerEnd(layer)), 0)

/** Below this, a sample counts as silence when trimming the tail (-80 dBFS). */
const SILENCE = 0.0001

/** Renders a recipe, its tune applied, trimmed where its tail falls silent. */
export const render = (recipe: Recipe, options: RenderOptions = {}): Rendered => {
  const rate = options.sampleRate ?? SAMPLE_RATE
  const played = applyTune(recipe)
  const random = seeded(options.seed ?? 1)
  const dry = Math.ceil((dryLength(played) + 0.02) * rate)
  const total = dry + (played.reverb > 0 ? Math.ceil(ROOM * rate) : 0)
  const out = new Float32Array(total)
  for (const layer of played.layers) addLayer(out, rate, layer, random)
  addRoom(out, dry, rate, played.reverb)
  const master = options.master ?? 1
  if (master !== 1) for (let i = 0; i < out.length; i++) out[i]! *= master
  let end = total
  while (end > 1 && Math.abs(out[end - 1]!) < SILENCE) end--
  return { sampleRate: rate, samples: out.slice(0, end) }
}

/** Several sounds one after another (`at` seconds from the start), mixed: a combo, heard in context. */
export const renderSequence = (parts: ReadonlyArray<{ readonly recipe: Recipe; readonly at: number }>, options: RenderOptions = {}): Rendered => {
  const rate = options.sampleRate ?? SAMPLE_RATE
  const rendered = parts.map((part, i) => ({ at: Math.round(part.at * rate), sound: render(part.recipe, { ...options, seed: (options.seed ?? 1) + i }) }))
  const length = rendered.reduce((end, part) => Math.max(end, part.at + part.sound.samples.length), 0)
  const out = new Float32Array(length)
  for (const part of rendered) {
    for (let i = 0; i < part.sound.samples.length; i++) out[part.at + i]! += part.sound.samples[i]!
  }
  return { sampleRate: rate, samples: out }
}
