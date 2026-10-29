/**
 * The instruments a song can use: each one is synthesized from a small
 * model of how the real instrument makes its sound (a plucked string for
 * the guitar, struck strings for the piano, a breath and a tube for the
 * flute), so they need no sample files and play the same bits everywhere.
 *
 * Each instrument turns one note (a pitch, how long it is held, how hard it
 * is played) into mono samples; the renderer places, pans, and mixes them.
 */

export type InstrumentKind = "melodic" | "drums"

export interface Instrument {
  readonly label: string
  readonly kind: InstrumentKind
  /** What it sounds like and what it is good for, for the agent and the person. */
  readonly about: string
  /** The lowest and highest notes it plays well, as MIDI numbers. */
  readonly range: readonly [number, number]
  /** The General MIDI program a MIDI export names for it (drums use channel 10). */
  readonly program: number
  /** The page draws its notes in this color. */
  readonly color: string
}

export const instruments = {
  piano: { label: "Piano", kind: "melodic", about: "A grand piano: chords, melodies, bass. Warm and full; notes ring and fade.", range: [21, 108], program: 0, color: "#7aa2f7" },
  epiano: { label: "Electric piano", kind: "melodic", about: "A soft electric piano (Rhodes): mellow chords, lo-fi and cozy tunes.", range: [28, 103], program: 4, color: "#9d8cf7" },
  guitar: { label: "Acoustic guitar", kind: "melodic", about: "A plucked steel-string guitar: strummed chords, picked patterns (arpeggios), folk melodies.", range: [40, 88], program: 25, color: "#f0a843" },
  bass: { label: "Bass guitar", kind: "melodic", about: "A plucked electric bass: the low line under the chords, one note at a time.", range: [28, 60], program: 33, color: "#e06c75" },
  strings: { label: "Strings", kind: "melodic", about: "A string section: long held chords that swell in, sweeping melodies. Slow to start, so give it long notes.", range: [28, 96], program: 48, color: "#56b6c2" },
  flute: { label: "Flute", kind: "melodic", about: "A breathy wooden flute: gentle melodies, one note at a time, best in its middle and high notes.", range: [60, 96], program: 73, color: "#98c379" },
  marimba: { label: "Marimba", kind: "melodic", about: "Wooden bars struck by mallets: short bright notes, playful patterns.", range: [45, 96], program: 12, color: "#d19a66" },
  bells: { label: "Bells", kind: "melodic", about: "Glassy bells: sparkle, magic, a few long high notes over the rest.", range: [60, 108], program: 9, color: "#e5c07b" },
  pad: { label: "Warm pad", kind: "melodic", about: "A soft synth pad: a cushion of held chords behind everything; slow to swell.", range: [36, 96], program: 89, color: "#c678dd" },
  chipLead: { label: "Chip lead", kind: "melodic", about: "A retro game-console square wave: chiptune melodies, one note at a time.", range: [48, 96], program: 80, color: "#4cc38a" },
  chipBass: { label: "Chip bass", kind: "melodic", about: "A retro game-console triangle wave: chiptune bass lines.", range: [28, 72], program: 38, color: "#2fb3a3" },
  rockGuitar: { label: "Distorted guitar", kind: "melodic", about: "An electric guitar through an overdriven amp: rock riffs, power chords (a note and the one seven semitones up), crunchy rhythm parts.", range: [40, 88], program: 30, color: "#ff7b54" },
  reese: { label: "Reese bass", kind: "melodic", about: "Detuned saws, a sub, and grit, slowly moving: the drum & bass bass, also for dark electronic lines. One note at a time; hold notes long.", range: [28, 60], program: 38, color: "#b4475a" },
  synthLead: { label: "Synth lead", kind: "melodic", about: "A wide stack of detuned saws (a supersaw): modern electronic leads and riffs, bright and big. One note at a time.", range: [48, 96], program: 81, color: "#3fb6f2" },
  drums: { label: "Drum kit", kind: "drums", about: "A clean drum kit. Its notes are drums, not pitches: kick, snare, hat, openHat, clap, tomLow, tomHigh, crash, rim, shaker.", range: [0, 127], program: 0, color: "#bdbab3" },
  breaks: { label: "Punchy kit", kind: "drums", about: "A hard-hitting kit for rock, drum & bass, and electronic music: a clicky, driven kick, a cracking snare, crisp hats. The same drums as the drum kit.", range: [0, 127], program: 0, color: "#e8e3d5" }
} as const satisfies Record<string, Instrument>

export type InstrumentId = keyof typeof instruments
export const instrumentIds: ReadonlyArray<InstrumentId> = ["piano", "epiano", "guitar", "rockGuitar", "bass", "reese", "strings", "flute", "marimba", "bells", "pad", "synthLead", "chipLead", "chipBass", "drums", "breaks"]

/** The instruments whose notes are drums. */
export type KitId = "drums" | "breaks"
export const isKit = (id: InstrumentId): id is KitId => instruments[id].kind === "drums"

export type DrumName = "kick" | "snare" | "hat" | "openHat" | "clap" | "tomLow" | "tomHigh" | "crash" | "rim" | "shaker"
/** The drums, top to bottom as the page lists them, with their General MIDI numbers. */
export const drums: ReadonlyArray<{ readonly name: DrumName; readonly label: string; readonly gm: number }> = [
  { name: "crash", label: "Crash", gm: 49 },
  { name: "openHat", label: "Open hat", gm: 46 },
  { name: "hat", label: "Hat", gm: 42 },
  { name: "shaker", label: "Shaker", gm: 70 },
  { name: "tomHigh", label: "High tom", gm: 50 },
  { name: "tomLow", label: "Low tom", gm: 45 },
  { name: "rim", label: "Rim", gm: 37 },
  { name: "clap", label: "Clap", gm: 39 },
  { name: "snare", label: "Snare", gm: 38 },
  { name: "kick", label: "Kick", gm: 36 }
]
export const drumNames: ReadonlyArray<string> = drums.map((drum) => drum.name)
export const isDrum = (name: string): name is DrumName => drumNames.includes(name)

// ---------------------------------------------------------------------------
// Small pieces

const TAU = 2 * Math.PI

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

const saw = (phase: number, step: number): number => 2 * phase - 1 - blep(phase, step)
const pulse = (phase: number, step: number, width: number): number => (phase < width ? 1 : -1) + blep(phase, step) - blep((phase + 1 - width) % 1, step)

/** A one-pole lowpass: cheap darkening. `cutoff` in Hz. */
const onePole = (cutoff: number, rate: number) => {
  const a = Math.exp((-TAU * cutoff) / rate)
  let y = 0
  return (x: number): number => (y = x * (1 - a) + y * a)
}

/** A state-variable filter (Zavalishin's, stable at any cutoff): lowpass, bandpass, and highpass at once, its cutoff settable per sample. */
const svf = (rate: number, q: number) => {
  const k = 1 / q
  let ic1 = 0
  let ic2 = 0
  let a1 = 0
  let a2 = 0
  let a3 = 0
  return {
    set: (cutoff: number): void => {
      const g = Math.tan((Math.PI * Math.min(cutoff, rate * 0.45)) / rate)
      a1 = 1 / (1 + g * (g + k))
      a2 = g * a1
      a3 = g * a2
    },
    step: (x: number): { readonly low: number; readonly band: number; readonly high: number } => {
      const v3 = x - ic2
      const v1 = a1 * ic1 + a2 * v3
      const v2 = ic2 + a2 * ic1 + a3 * v3
      ic1 = 2 * v1 - ic1
      ic2 = 2 * v2 - ic2
      return { low: v2, band: v1, high: x - k * v1 - v2 }
    }
  }
}

/** Shapes the note's ends: a quick fade in (no click) and a fade out after `held` seconds over `release`. */
const gate = (t: number, attack: number, held: number, release: number): number => {
  const rise = attack <= 0 ? 1 : Math.min(1, t / attack)
  if (t <= held) return rise
  return rise * Math.max(0, 1 - (t - held) / release)
}

/** Overdrive: soft clipping that keeps the level near 1 at any `amount`. */
const drive = (x: number, amount: number): number => Math.tanh(x * amount) / Math.tanh(amount)

const frequency = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

export interface NoteInput {
  readonly midi: number
  /** How long the note is held, in seconds. */
  readonly held: number
  readonly velocity: number
  readonly rate: number
  readonly random: () => number
}

// ---------------------------------------------------------------------------
// Melodic instruments

/** Struck strings: inharmonic partials that die faster the higher they are, two strings a hair apart, and the hammer's thump. */
const piano = ({ midi, held, velocity, rate, random }: NoteInput): Float32Array => {
  const f = frequency(midi)
  const low = Math.max(0, Math.min(1, (72 - midi) / 48))
  const ring = 1.2 + 4 * low
  const release = 0.18 + 0.2 * low
  const length = Math.min(held + release, ring + 0.2)
  const out = new Float32Array(Math.ceil(length * rate))
  const stiffness = 0.0002 + 0.0004 * (1 - low)
  const partials = Math.min(12, Math.floor(9000 / f))
  const brightness = 0.6 + 0.9 * velocity
  for (let n = 1; n <= partials; n++) {
    const fn = f * n * Math.sqrt(1 + stiffness * n * n)
    const level = Math.pow(n, -(2.3 - brightness)) * (n === 1 ? 1 : 0.8)
    const fast = 3 + n * 1.6
    const slow = (0.9 + 0.35 * n) / ring
    for (const detune of [1, 1.0009]) {
      // A rotating phasor and two decaying levels, stepped by multiplication: no sin or exp per sample.
      const step = (TAU * fn * detune) / rate
      const turnCos = Math.cos(step)
      const turnSin = Math.sin(step)
      const start = random() * TAU
      let c = Math.cos(start)
      let s = Math.sin(start)
      let fastLevel = 0.6 * level * 0.5
      let slowLevel = 0.4 * level * 0.5
      const fastKeep = Math.exp(-fast / rate)
      const slowKeep = Math.exp((-slow * 3) / rate)
      for (let i = 0; i < out.length; i++) {
        out[i]! += s * (fastLevel + slowLevel)
        const nextC = c * turnCos - s * turnSin
        s = c * turnSin + s * turnCos
        c = nextC
        fastLevel *= fastKeep
        slowLevel *= slowKeep
        if (fastLevel + slowLevel < 1e-5) break
      }
    }
  }
  // The hammer: a short, dull knock.
  const knock = onePole(800 + 1500 * velocity, rate)
  for (let i = 0; i < Math.min(out.length, rate * 0.02); i++) out[i]! += knock(random() * 2 - 1) * 0.3 * velocity * (1 - i / (rate * 0.02))
  for (let i = 0; i < out.length; i++) out[i]! *= gate(i / rate, 0.002, held, release) * 0.5
  return out
}

/** A tine and a pickup: a bell-like FM tone whose bite fades as the note rings. */
const epiano = ({ midi, held, velocity, rate }: NoteInput): Float32Array => {
  const f = frequency(midi)
  const release = 0.25
  const length = Math.min(held + release, 3.5)
  const out = new Float32Array(Math.ceil(length * rate))
  let carrier = 0
  let modulator = 0
  let tine = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    const index = (0.6 + 2.2 * velocity) * Math.exp(-t * 2.2) + 0.25
    const tineLevel = 0.35 * velocity * Math.exp(-t * 18)
    const value = Math.sin(carrier + index * Math.sin(modulator)) + tineLevel * Math.sin(tine)
    out[i] = value * Math.exp(-t * (0.5 + midi / 120)) * gate(t, 0.003, held, release) * 0.32
    carrier += (TAU * f) / rate
    modulator += (TAU * f) / rate
    tine += (TAU * f * 14) / rate
  }
  return out
}

/**
 * A plucked string (Karplus-Strong): a burst of noise circulating in a delay
 * as long as one vibration, softened a little every pass, which is how a
 * real string loses its brightness. `bright` sets the pluck (pick or finger),
 * `sustain` how long the string rings.
 */
const pluck = ({ midi, held, velocity, rate, random }: NoteInput, bright: number, sustain: number, release: number): Float32Array => {
  const f = frequency(midi)
  const length = Math.min(held + release, sustain + 0.1)
  const out = new Float32Array(Math.ceil(length * rate))
  const period = rate / f
  // The loop's average filter delays half a sample; a fractional allpass makes up the rest, so the string is in tune.
  const whole = Math.floor(period - 0.5)
  const fraction = period - 0.5 - whole
  const allpass = (1 - fraction) / (1 + fraction)
  const line = new Float64Array(whole + 2)
  const color = onePole(f * (2 + 10 * bright * (0.4 + 0.6 * velocity)), rate)
  for (let i = 0; i < line.length; i++) line[i] = color(random() * 2 - 1)
  let mean = 0
  for (const x of line) mean += x / line.length
  for (let i = 0; i < line.length; i++) line[i]! -= mean
  // How much each pass keeps, so the string falls 60 dB over `sustain` seconds (shorter for high notes).
  const keep = Math.pow(0.001, 1 / (f * sustain * (1.2 - Math.min(0.6, midi / 160))))
  let read = 0
  let apIn = 0
  let apOut = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    const current = line[read]!
    const next = line[(read + 1) % line.length]!
    const averaged = 0.5 * (current + next) * (t > held ? keep * 0.985 : keep)
    // The fractional delay.
    const tuned = allpass * averaged + apIn - allpass * apOut
    apIn = averaged
    apOut = tuned
    line[read] = tuned
    read = (read + 1) % line.length
    out[i] = current
  }
  for (let i = 0; i < out.length; i++) out[i]! *= gate(i / rate, 0.001, held, release) * 0.55
  return out
}

const guitar = (input: NoteInput): Float32Array => {
  const out = pluck(input, 0.55, 3, 0.12)
  for (let i = 0; i < out.length; i++) out[i]! *= 2.4
  // The body: a little warmth around 200 Hz.
  const body = svf(input.rate, 1.2)
  body.set(210)
  for (let i = 0; i < out.length; i++) out[i] = out[i]! + body.step(out[i]!).band * 0.25
  return out
}

const bass = (input: NoteInput): Float32Array => {
  const out = pluck(input, 0.12, 2.5, 0.08)
  // A clean low fundamental under the string, for weight on small speakers too.
  const f = frequency(input.midi)
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / input.rate
    out[i] = out[i]! * 1.2 + Math.sin(phase) * 0.22 * Math.exp(-t * 1.5) * gate(t, 0.004, input.held, 0.08)
    phase += (TAU * f) / input.rate
  }
  return out
}

/** Detuned saws through a lowpass that opens as the note swells, with a slow vibrato: an ensemble of bowed strings, or a pad. */
const ensemble = ({ midi, held, velocity, rate, random }: NoteInput, voices: ReadonlyArray<number>, attack: number, release: number, cutoff: number, vibrato: number, level: number): Float32Array => {
  const f = frequency(midi)
  const out = new Float32Array(Math.ceil((held + release) * rate))
  const filter = svf(rate, 0.8)
  const phases = voices.map(() => random())
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    const swell = Math.min(1, t / attack)
    const wobble = 1 + vibrato * Math.min(1, Math.max(0, t - 0.25) * 2) * Math.sin(TAU * 5.2 * t)
    let x = 0
    voices.forEach((cents, v) => {
      const step = (f * wobble * Math.pow(2, cents / 1200)) / rate
      x += saw(phases[v]!, step)
      phases[v] = (phases[v]! + step) % 1
    })
    if (i % 32 === 0) filter.set(f * 1.5 + cutoff * (0.5 + 0.5 * velocity) * (0.35 + 0.65 * swell))
    out[i] = filter.step(x / voices.length).low * gate(t, attack, held, release) * level
  }
  return out
}

const strings = (input: NoteInput): Float32Array => ensemble(input, [-9, -3, 4, 10], 0.22, 0.45, 2600, 0.004, 0.5)
const pad = (input: NoteInput): Float32Array => ensemble(input, [-12, 0, 7, 1200], 0.55, 0.9, 1100, 0.002, 0.65)

/** A tube and a breath: a soft, nearly pure tone with a little noise in it and a vibrato that comes in late. */
const flute = ({ midi, held, velocity, rate, random }: NoteInput): Float32Array => {
  const f = frequency(midi)
  const release = 0.12
  const out = new Float32Array(Math.ceil((held + release) * rate))
  const breath = svf(rate, 4)
  breath.set(f * 2)
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    const vibrato = 1 + 0.004 * Math.min(1, Math.max(0, t - 0.3) * 3) * Math.sin(TAU * 5 * t)
    const tone = Math.sin(phase) + 0.22 * Math.sin(2 * phase) + 0.06 * Math.sin(3 * phase)
    const chiff = Math.exp(-t * 30) * 0.6
    const air = breath.step(random() * 2 - 1).band * (0.12 + chiff)
    out[i] = (tone + air) * gate(t, 0.05, held, release) * (0.13 + 0.08 * velocity)
    phase += (TAU * f * vibrato) / rate
  }
  return out
}

/** A struck wooden bar: the tone and its fourth-octave overtone dying fast, and the mallet's tap. */
const marimba = ({ midi, held, velocity, rate, random }: NoteInput): Float32Array => {
  const f = frequency(midi)
  const ring = 0.4 + 1.4 * Math.max(0, (84 - midi) / 40)
  const out = new Float32Array(Math.ceil(Math.min(held + 0.15, ring) * rate))
  const tap = onePole(3000, rate)
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    const value = Math.sin(TAU * f * t) * Math.exp((-t * 3) / ring) + 0.25 * velocity * Math.sin(TAU * f * 4 * t) * Math.exp(-t * 22) + 0.1 * Math.sin(TAU * f * 10 * t) * Math.exp(-t * 60)
    const mallet = i < rate * 0.004 ? tap(random() * 2 - 1) * 0.4 : 0
    out[i] = (value + mallet) * gate(t, 0.001, held, 0.15) * (0.25 + 0.15 * velocity)
  }
  return out
}

/** Glass bells: FM at an inharmonic ratio, ringing long. */
const bells = ({ midi, held, velocity, rate }: NoteInput): Float32Array => {
  const f = frequency(midi)
  const out = new Float32Array(Math.ceil(Math.min(held + 1.2, 3.5) * rate))
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    const index = (1 + 2.5 * velocity) * Math.exp(-t * 3)
    const value = Math.sin(TAU * f * t + index * Math.sin(TAU * f * 3.5 * t)) * Math.exp(-t * 1.3)
    out[i] = value * gate(t, 0.001, held, 1.2) * 0.28
  }
  return out
}

/** A retro console's pulse wave, a quarter wide, with a light vibrato. */
const chipLead = ({ midi, held, velocity, rate }: NoteInput): Float32Array => {
  const f = frequency(midi)
  const out = new Float32Array(Math.ceil((held + 0.04) * rate))
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    const step = (f * (1 + 0.006 * Math.min(1, Math.max(0, t - 0.2) * 4) * Math.sin(TAU * 6 * t))) / rate
    out[i] = pulse(phase, step, 0.25) * gate(t, 0.003, held, 0.04) * (0.09 + 0.07 * velocity)
    phase = (phase + step) % 1
  }
  return out
}

/** A retro console's stepped triangle wave. */
const chipBass = ({ midi, held, velocity, rate }: NoteInput): Float32Array => {
  const f = frequency(midi)
  const out = new Float32Array(Math.ceil((held + 0.03) * rate))
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    const triangle = phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase
    // Sixteen steps, as the old console's 4-bit wave.
    out[i] = (Math.round(triangle * 8) / 8) * gate(t, 0.002, held, 0.03) * (0.2 + 0.1 * velocity)
    phase = (phase + f / rate) % 1
  }
  return out
}

/**
 * An electric guitar into an overdriven amp: the plucked string, its lows
 * trimmed so the drive stays tight, clipped hard (which also holds the note
 * up, as a real amp does), then the speaker cabinet's top cut.
 */
const rockGuitar = (input: NoteInput): Float32Array => {
  const out = pluck(input, 0.85, 4, 0.1)
  const tight = svf(input.rate, 0.7)
  tight.set(110)
  const cabinet = svf(input.rate, 0.9)
  cabinet.set(4200)
  const presence = svf(input.rate, 1.6)
  presence.set(1800)
  const amount = 10 + 14 * input.velocity
  for (let i = 0; i < out.length; i++) {
    const driven = drive(tight.step(out[i]! * 3).high, amount)
    const shaped = cabinet.step(driven).low
    out[i] = (shaped + presence.step(shaped).band * 0.35) * gate(i / input.rate, 0.002, input.held, 0.1) * 0.3
  }
  return out
}

/** Three saws a few cents apart beating slowly, a sine under them for weight, a lowpass that drifts, and some drive: the reese. */
const reese = ({ midi, held, velocity, rate, random }: NoteInput): Float32Array => {
  const f = frequency(midi)
  const release = 0.06
  const out = new Float32Array(Math.ceil((held + release) * rate))
  const filter = svf(rate, 1.1)
  const detunes = [-10, 0, 9]
  const phases = detunes.map(() => random())
  const drift = random() * TAU
  let sub = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    let x = 0
    detunes.forEach((cents, v) => {
      const step = (f * Math.pow(2, cents / 1200)) / rate
      x += saw(phases[v]!, step)
      phases[v] = (phases[v]! + step) % 1
    })
    if (i % 32 === 0) filter.set(f * 3 + (500 + 700 * velocity) * (1 + 0.6 * Math.sin(TAU * 0.35 * t + drift)))
    const body = drive(filter.step(x / 3).low * 1.6, 2.2)
    out[i] = (body * 0.55 + Math.sin(sub) * 0.6) * gate(t, 0.004, held, release) * (0.2 + 0.08 * velocity)
    sub += (TAU * f) / rate
  }
  return out
}

/** Seven saws spread across about 40 cents, through a lowpass that opens on the attack and settles: a supersaw lead. */
const synthLead = ({ midi, held, velocity, rate, random }: NoteInput): Float32Array => {
  const f = frequency(midi)
  const release = 0.12
  const out = new Float32Array(Math.ceil((held + release) * rate))
  const filter = svf(rate, 0.9)
  const detunes = [-21, -13, -6, 0, 6, 13, 21]
  const phases = detunes.map(() => random())
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    const wobble = 1 + 0.004 * Math.min(1, Math.max(0, t - 0.25) * 3) * Math.sin(TAU * 5.5 * t)
    let x = 0
    detunes.forEach((cents, v) => {
      const step = (f * wobble * Math.pow(2, cents / 1200)) / rate
      x += saw(phases[v]!, step) * (cents === 0 ? 1.4 : 1)
      phases[v] = (phases[v]! + step) % 1
    })
    if (i % 32 === 0) filter.set(f * 2 + (2500 + 4000 * velocity) * (0.45 + 0.55 * Math.exp(-t * 6)))
    // Detuned saws add up like noise, not like one wave: divided by the square root of their count, the stack is as loud as one saw.
    out[i] = filter.step(x / Math.sqrt(detunes.length)).low * gate(t, 0.004, held, release) * (0.17 + 0.07 * velocity)
  }
  return out
}

// ---------------------------------------------------------------------------
// Drums

const noiseBurst = (out: Float32Array, rate: number, random: () => number, options: { readonly from: number; readonly to: number; readonly decay: number; readonly gain: number; readonly type: "low" | "band" | "high"; readonly q?: number; readonly delay?: number }): void => {
  const filter = svf(rate, options.q ?? 0.9)
  const start = Math.round((options.delay ?? 0) * rate)
  for (let i = start; i < out.length; i++) {
    const t = (i - start) / rate
    if (i % 16 === 0) filter.set(options.from * Math.pow(options.to / options.from, Math.min(1, t / options.decay)))
    const result = filter.step(random() * 2 - 1)
    const x = options.type === "low" ? result.low : options.type === "band" ? result.band : result.high
    out[i]! += x * options.gain * Math.exp(-t / (options.decay / 4.6))
  }
}

const sweep = (out: Float32Array, rate: number, options: { readonly from: number; readonly to: number; readonly glide: number; readonly decay: number; readonly gain: number }): void => {
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    const f = options.to + (options.from - options.to) * Math.exp(-t / options.glide)
    out[i]! += Math.sin(phase) * options.gain * Math.exp(-t / (options.decay / 4.6))
    phase += (TAU * f) / rate
  }
}

const drum = (name: DrumName, velocity: number, rate: number, random: () => number): Float32Array => {
  const length = name === "crash" ? 1.6 : name === "openHat" ? 0.45 : name === "kick" || name === "tomLow" ? 0.5 : 0.3
  const out = new Float32Array(Math.ceil(length * rate))
  const v = 0.4 + 0.6 * velocity
  switch (name) {
    case "kick":
      sweep(out, rate, { from: 160, to: 48, glide: 0.03, decay: 0.45, gain: 0.9 * v })
      noiseBurst(out, rate, random, { from: 3000, to: 1000, decay: 0.012, gain: 0.25 * v, type: "low" })
      break
    case "snare":
      sweep(out, rate, { from: 260, to: 185, glide: 0.02, decay: 0.12, gain: 0.35 * v })
      noiseBurst(out, rate, random, { from: 5000, to: 3500, decay: 0.2, gain: 0.45 * v, type: "high" })
      break
    case "hat":
      noiseBurst(out, rate, random, { from: 9000, to: 8000, decay: 0.05, gain: 0.25 * v, type: "high" })
      break
    case "openHat":
      noiseBurst(out, rate, random, { from: 8500, to: 7000, decay: 0.4, gain: 0.2 * v, type: "high" })
      break
    case "shaker":
      noiseBurst(out, rate, random, { from: 6500, to: 6000, decay: 0.07, gain: 0.18 * v, type: "band", q: 1.5 })
      break
    case "clap":
      for (const delay of [0, 0.011, 0.022]) noiseBurst(out, rate, random, { from: 1300, to: 1100, decay: 0.03, gain: 0.35 * v, type: "band", q: 1.4, delay })
      noiseBurst(out, rate, random, { from: 1200, to: 900, decay: 0.2, gain: 0.25 * v, type: "band", q: 1.2, delay: 0.03 })
      break
    case "rim":
      sweep(out, rate, { from: 1700, to: 1600, glide: 0.01, decay: 0.03, gain: 0.3 * v })
      noiseBurst(out, rate, random, { from: 3000, to: 2500, decay: 0.015, gain: 0.25 * v, type: "band", q: 2 })
      break
    case "tomLow":
      sweep(out, rate, { from: 140, to: 90, glide: 0.08, decay: 0.45, gain: 0.6 * v })
      break
    case "tomHigh":
      sweep(out, rate, { from: 220, to: 150, glide: 0.06, decay: 0.3, gain: 0.5 * v })
      break
    case "crash":
      noiseBurst(out, rate, random, { from: 7000, to: 4000, decay: 1.5, gain: 0.22 * v, type: "high" })
      for (const ratio of [1, 1.47, 2.09, 2.56]) sweep(out, rate, { from: 420 * ratio, to: 420 * ratio, glide: 1, decay: 0.9, gain: 0.02 * v })
      break
  }
  // A drum ends in silence, never mid-wave.
  const fade = Math.floor(rate * 0.01)
  for (let i = 0; i < fade; i++) out[out.length - 1 - i]! *= i / fade
  return out
}

/**
 * The punchy kit: a kick with a click on top and a lower, longer boom, a
 * snare with two body tones and a wide crack, tighter hats, and every drum
 * driven a little, so it hits like a produced record rather than a drum
 * machine.
 */
const breaks = (name: DrumName, velocity: number, rate: number, random: () => number): Float32Array => {
  const v = 0.4 + 0.6 * velocity
  let out: Float32Array
  let amount = 1.6
  switch (name) {
    case "kick":
      out = new Float32Array(Math.ceil(0.45 * rate))
      sweep(out, rate, { from: 240, to: 46, glide: 0.022, decay: 0.4, gain: 1 * v })
      noiseBurst(out, rate, random, { from: 9000, to: 4000, decay: 0.006, gain: 0.5 * v, type: "high" })
      amount = 2.6
      break
    case "snare":
      out = new Float32Array(Math.ceil(0.3 * rate))
      sweep(out, rate, { from: 330, to: 200, glide: 0.015, decay: 0.1, gain: 0.45 * v })
      sweep(out, rate, { from: 520, to: 330, glide: 0.01, decay: 0.05, gain: 0.2 * v })
      noiseBurst(out, rate, random, { from: 7000, to: 2500, decay: 0.22, gain: 0.7 * v, type: "band", q: 0.6 })
      amount = 2.4
      break
    case "hat":
      out = new Float32Array(Math.ceil(0.12 * rate))
      noiseBurst(out, rate, random, { from: 11000, to: 9000, decay: 0.035, gain: 0.32 * v, type: "high", q: 1.2 })
      break
    case "openHat":
      out = new Float32Array(Math.ceil(0.4 * rate))
      noiseBurst(out, rate, random, { from: 10000, to: 8000, decay: 0.32, gain: 0.26 * v, type: "high", q: 1.2 })
      break
    default:
      out = drum(name, velocity, rate, random)
      amount = 1.4
  }
  for (let i = 0; i < out.length; i++) out[i] = drive(out[i]!, amount)
  const fade = Math.floor(rate * 0.01)
  for (let i = 0; i < fade; i++) out[out.length - 1 - i]! *= i / fade
  return out
}

// ---------------------------------------------------------------------------

const voices: Record<Exclude<InstrumentId, KitId>, (input: NoteInput) => Float32Array> = { piano, epiano, guitar, rockGuitar, bass, reese, strings, flute, marimba, bells, pad, synthLead, chipLead, chipBass }

/** One note of a melodic instrument (`midi` a MIDI number), as mono samples from the note's start. */
export const playVoice = (instrument: Exclude<InstrumentId, KitId>, midi: number, held: number, velocity: number, rate: number, random: () => number): Float32Array =>
  voices[instrument]({ midi, held: Math.max(0.02, held), velocity, rate, random })

/** One hit of a drum kit, as mono samples from the hit. */
export const playDrum = (kit: KitId, name: DrumName, velocity: number, rate: number, random: () => number): Float32Array =>
  kit === "breaks" ? breaks(name, velocity, rate, random) : drum(name, velocity, rate, random)
