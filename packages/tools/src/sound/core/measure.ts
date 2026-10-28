/**
 * What can be checked about a sound without hearing it: how long it lasts,
 * how loud it is (at its peak and at its loudest moment), how fast it
 * starts, how bright it is, and whether it ends with a click. An agent
 * reads these to keep a bank consistent; a person still decides how it
 * sounds.
 */
import type { Bank, Recipe } from "./recipe.ts"
import { fft, render, type Rendered } from "./render.ts"

export interface Measures {
  /** Seconds until the sound falls below -60 dBFS for good (its echo included). */
  readonly duration: number
  /** The loudest sample, in dBFS (0 is full scale). */
  readonly peak: number
  /** The loudest 50 ms, as RMS in dBFS: how loud the sound feels. */
  readonly loudness: number
  /** Milliseconds until the sound first reaches a tenth of its peak. */
  readonly attack: number
  /** The spectral centroid of its loudest moment, in Hz: low for thuds, high for hiss. */
  readonly brightness: number
  /** How loud its last 1 ms is, in dBFS: loud means it stops with a click. */
  readonly ending: number
}

export type Severity = "error" | "warning"

export interface Issue {
  readonly rule: "empty" | "silent" | "clipping" | "late-start" | "long" | "end-click" | "too-loud" | "too-quiet"
  readonly severity: Severity
  readonly message: string
}

const db = (amplitude: number): number => (amplitude <= 1e-9 ? -180 : 20 * Math.log10(amplitude))
const round = (value: number, digits = 1): number => Math.round(value * 10 ** digits) / 10 ** digits

export const measure = ({ samples, sampleRate }: Rendered): Measures => {
  let peak = 0
  for (const x of samples) peak = Math.max(peak, Math.abs(x))
  let last = 0
  const quiet = 0.001
  for (let i = samples.length - 1; i >= 0; i--) {
    if (Math.abs(samples[i]!) >= quiet) {
      last = i + 1
      break
    }
  }
  let first = 0
  while (first < samples.length && Math.abs(samples[first]!) < peak * 0.1) first++
  // The loudest 50 ms, in steps of 5 ms.
  const window = Math.round(sampleRate * 0.05)
  const hop = Math.round(sampleRate * 0.005)
  let loudest = 0
  let loudestAt = 0
  for (let start = 0; start < Math.max(1, samples.length - window + 1); start += hop) {
    let sum = 0
    const end = Math.min(samples.length, start + window)
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!
    const rms = Math.sqrt(sum / window)
    if (rms > loudest) {
      loudest = rms
      loudestAt = start
    }
  }
  const tail = Math.round(sampleRate * 0.001)
  let ending = 0
  for (let i = Math.max(0, last - tail); i < last; i++) ending = Math.max(ending, Math.abs(samples[i]!))
  return {
    duration: round(last / sampleRate, 3),
    peak: round(db(peak)),
    loudness: round(db(loudest)),
    attack: round((first / sampleRate) * 1000),
    brightness: Math.round(centroid(samples, sampleRate, loudestAt, window)),
    ending: round(db(ending))
  }
}

/** The spectral centroid of `size` samples from `start` (Hann windowed, zero-padded to a power of two). */
const centroid = (samples: Float32Array, sampleRate: number, start: number, size: number): number => {
  let n = 1
  while (n < size) n <<= 1
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < size && start + i < samples.length; i++) re[i] = samples[start + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)))
  fft(re, im, false)
  let weighted = 0
  let total = 0
  for (let k = 1; k < n / 2; k++) {
    const magnitude = Math.hypot(re[k]!, im[k]!)
    weighted += magnitude * ((k * sampleRate) / n)
    total += magnitude
  }
  return total === 0 ? 0 : weighted / total
}

/** Limits a sound is checked against. */
export const limits = {
  /** A sound quieter than this at its peak is not heard in a game (dBFS). */
  silent: -40,
  /** Past full scale, samples are clipped: the sound distorts (dBFS). */
  clipping: 0,
  /** A game sound must answer an action at once: later than this (ms) feels late (a swing's whoosh builds for about 60). */
  lateStart: 80,
  /** Longer than this (s) is long for an effect. */
  long: 3,
  /** A last millisecond louder than this (dBFS) ends with a click. */
  endClick: -40,
  /** Louder or quieter than the middle of its kind (heavy or not) by this many dB stands out. */
  louder: 10,
  quieter: 14
} as const

/** The issues of one sound, given the middle loudness of its kind in the bank (the median of the heavy sounds, or of the others). */
export const issuesOf = (recipe: Recipe, measures: Measures, middle: number | undefined): Array<Issue> => {
  const issues: Array<Issue> = []
  if (recipe.layers.length === 0) return [{ rule: "empty", severity: "error", message: "No layers: the sound is silent." }]
  if (measures.peak < limits.silent) issues.push({ rule: "silent", severity: "error", message: `Peaks at ${measures.peak} dBFS: too quiet to be heard. Raise the layers' gain.` })
  if (measures.peak > limits.clipping)
    issues.push({ rule: "clipping", severity: "error", message: `Peaks at +${measures.peak} dBFS: it clips and distorts. Lower the gain (or the tune's volume) by ${Math.ceil(measures.peak + 1)} dB.` })
  if (measures.attack > limits.lateStart)
    issues.push({
      rule: "late-start",
      severity: "warning",
      message: `Reaches a tenth of its peak after ${measures.attack} ms: it will feel late if it answers an action (fine for a swell). Shorten the first layer's attack, or start a layer at once.`
    })
  if (measures.duration > limits.long) issues.push({ rule: "long", severity: "warning", message: `Lasts ${measures.duration} s, long for an effect.` })
  if (measures.ending > limits.endClick) issues.push({ rule: "end-click", severity: "warning", message: `Stops abruptly (${measures.ending} dBFS in its last millisecond): it ends with a click.` })
  if (middle !== undefined && measures.loudness > middle + limits.louder)
    issues.push({ rule: "too-loud", severity: "warning", message: `${round(measures.loudness - middle)} dB louder than the middle of its kind (${middle} dBFS${recipe.heavy === true ? ", heavy sounds" : ""}): it will stand out.` })
  if (middle !== undefined && measures.loudness < middle - limits.quieter)
    issues.push({ rule: "too-quiet", severity: "warning", message: `${round(middle - measures.loudness)} dB quieter than the middle of its kind (${middle} dBFS${recipe.heavy === true ? ", heavy sounds" : ""}): it may get lost.` })
  return issues
}

export interface SoundReport extends Measures {
  readonly name: string
  readonly about?: string | undefined
  readonly issues: ReadonlyArray<Issue>
}

export type Verdict = "clean" | "warnings" | "errors"

export interface BankReport {
  readonly verdict: Verdict
  readonly summary: string
  /** The median loudness of the bank's sounds, in dBFS, heavy ones and the others apart: each sound is compared with its kind's. */
  readonly middle: { readonly heavy: number | undefined; readonly other: number | undefined }
  readonly sounds: ReadonlyArray<SoundReport>
}

const median = (values: ReadonlyArray<number>): number | undefined => {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return round(sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2)
}

/** Measures every sound (or the named ones) of a bank, each against the whole bank's middle loudness. */
export const checkBank = (bank: Bank, names?: ReadonlyArray<string>): BankReport => {
  const all = Object.entries(bank.sounds).map(([name, recipe]) => ({ name, recipe, measures: measure(render(recipe, { master: bank.master })) }))
  const kind = (heavy: boolean) => all.filter((entry) => entry.recipe.layers.length > 0 && (entry.recipe.heavy === true) === heavy).map((entry) => entry.measures.loudness)
  const heavy = kind(true)
  const other = kind(false)
  // A kind of fewer than three sounds has no middle to stand out from.
  const middle = { heavy: heavy.length >= 3 ? median(heavy) : undefined, other: other.length >= 3 ? median(other) : undefined }
  const chosen = names === undefined || names.length === 0 ? all : all.filter((entry) => names.includes(entry.name))
  const sounds = chosen.map(({ name, recipe, measures }) => ({
    name,
    about: recipe.about,
    ...measures,
    issues: issuesOf(recipe, measures, recipe.heavy === true ? middle.heavy : middle.other)
  }))
  const errors = sounds.reduce((n, sound) => n + sound.issues.filter((issue) => issue.severity === "error").length, 0)
  const warnings = sounds.reduce((n, sound) => n + sound.issues.filter((issue) => issue.severity === "warning").length, 0)
  const verdict: Verdict = errors > 0 ? "errors" : warnings > 0 ? "warnings" : "clean"
  const summary =
    verdict === "clean"
      ? `${sounds.length} sound${sounds.length === 1 ? "" : "s"}, nothing to fix.`
      : `${sounds.length} sound${sounds.length === 1 ? "" : "s"}: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}.`
  return { verdict, summary, middle, sounds }
}
