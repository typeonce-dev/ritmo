/**
 * Sound recipes: a game sound as plain JSON, a few layers built from small
 * instruments, mixed into a room. The renderer (`render.ts`) turns a recipe
 * into samples the same way in Node and in the browser, so what the page
 * plays, what the CLI measures, and what the game plays are one sound.
 *
 * ```json
 * {
 *   "reverb": 0.12,
 *   "layers": [
 *     { "type": "click", "gain": 0.45 },
 *     { "type": "tone", "wave": "sine", "from": 160, "to": 55, "duration": 0.12, "gain": 0.65, "attack": 0.002 },
 *     { "type": "crunch", "from": 1500, "to": 500, "duration": 0.07, "gain": 0.3 }
 *   ]
 * }
 * ```
 *
 * A bank is a file of named recipes (`{"version": 1, "master": 0.6,
 * "sounds": {...}}`): the game's sounds, one file, and the master volume the
 * game plays them at.
 */

export type Wave = "sine" | "triangle" | "square" | "sawtooth"
export const waves: ReadonlyArray<Wave> = ["sine", "triangle", "square", "sawtooth"]

export type Filter = "lowpass" | "highpass" | "bandpass"
export const filters: ReadonlyArray<Filter> = ["lowpass", "highpass", "bandpass"]

/** Every layer starts `delay` seconds after the sound does, and fades in over `attack` seconds. */
interface Timed {
  readonly delay: number
  readonly gain: number
}

/** A tone gliding from `from` to `to` Hz over its duration, fading in and dying away: thuds, notes, hums. */
export interface ToneLayer extends Timed {
  readonly type: "tone"
  readonly wave: Wave
  readonly from: number
  readonly to: number
  readonly duration: number
  readonly attack: number
}

/** A burst of noise through a filter gliding from `from` to `to` Hz: air, debris, hiss, rumble. */
export interface NoiseLayer extends Timed {
  readonly type: "noise"
  readonly filter: Filter
  readonly from: number
  readonly to: number
  /** How narrow the band (bandpass), or how much the cutoff rings (lowpass, highpass, in dB). */
  readonly q: number
  readonly duration: number
  readonly attack: number
}

/**
 * A swing through the air: a band of noise rising from `low` to `peak` Hz
 * as the swing speeds up, loudest at `peakAt` (a share of the duration),
 * then falling away.
 */
export interface SwishLayer extends Timed {
  readonly type: "swish"
  readonly low: number
  readonly peak: number
  readonly peakAt: number
  readonly q: number
  readonly duration: number
}

/** Distorted band-passed noise gliding from `from` to `to` Hz: the crack of a blow. */
export interface CrunchLayer extends Timed {
  readonly type: "crunch"
  readonly from: number
  readonly to: number
  readonly duration: number
}

/** A metallic ring: inharmonic partials of `pitch` Hz, the higher ones dying first. */
export interface MetalLayer extends Timed {
  readonly type: "metal"
  readonly pitch: number
  readonly duration: number
}

/** The contact of a blow: a very short, bright tick. */
export interface ClickLayer extends Timed {
  readonly type: "click"
}

export type Layer = ToneLayer | NoiseLayer | SwishLayer | CrunchLayer | MetalLayer | ClickLayer
export type LayerType = Layer["type"]
export const layerTypes: ReadonlyArray<LayerType> = ["tone", "noise", "swish", "crunch", "metal", "click"]

/**
 * Broad changes over the whole sound, made by the person with sliders, kept
 * apart from the layers so they can be read and undone at a glance.
 */
export interface Tune {
  /** Semitones up (or down): every frequency, tones and filters. */
  readonly pitch: number
  /** Every duration and delay times this. */
  readonly length: number
  /** Semitones up (or down) for the filters only: brighter or darker without changing the notes. */
  readonly brightness: number
  /** Added to the room's share (0 to 1 in all). */
  readonly echo: number
  /** Decibels up (or down). */
  readonly volume: number
}

export const neutralTune: Tune = { pitch: 0, length: 1, brightness: 0, echo: 0, volume: 0 }

export interface Recipe {
  /** What the sound is for, in a few words: the agent's intent, shown to the person. */
  readonly about?: string | undefined
  /** How much of the sound goes to the room, 0 to 1. */
  readonly reverb: number
  /** A heavy sound turns the others down for a moment (the game's mixer reads this). */
  readonly heavy?: boolean | undefined
  /** The least time between two plays, in seconds (the game's mixer reads this). */
  readonly interval?: number | undefined
  readonly layers: ReadonlyArray<Layer>
  readonly tune?: Tune | undefined
}

export interface Bank {
  /** The game's master volume over every sound, 1 by default: sounds are measured as the game plays them. */
  readonly master?: number | undefined
  readonly sounds: Readonly<Record<string, Recipe>>
}

export type Decoded<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** Reads values out of untrusted JSON, collecting every problem with where it is. */
const reader = (errors: Array<string>) => {
  const number = (value: unknown, name: string, fallback: number | undefined, min?: number, max?: number): number => {
    if (value === undefined) {
      if (fallback === undefined) errors.push(`${name} is missing`)
      return fallback ?? 0
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`${name} must be a number`)
      return fallback ?? 0
    }
    if (min !== undefined && value < min) errors.push(`${name} must be at least ${min}`)
    if (max !== undefined && value > max) errors.push(`${name} must be at most ${max}`)
    return value
  }
  const oneOf = <T extends string>(value: unknown, name: string, options: ReadonlyArray<T>, fallback: T): T => {
    if (value === undefined) return fallback
    const found = options.find((option) => option === value)
    if (found !== undefined) return found
    errors.push(`${name} must be one of ${options.join(", ")}`)
    return fallback
  }
  return { number, oneOf }
}

/** The highest frequency a layer may ask for: past it, nothing is heard at 44.1 kHz. */
const NYQUIST = 20000

const decodeLayer = (raw: unknown, at: string, errors: Array<string>): Layer | undefined => {
  if (!isRecord(raw)) {
    errors.push(`${at} must be an object`)
    return undefined
  }
  const { number, oneOf } = reader(errors)
  const type = raw.type
  const delay = number(raw.delay, `${at}.delay`, 0, 0)
  const gain = number(raw.gain, `${at}.gain`, undefined, 0, 4)
  const hz = (key: string, fallback?: number): number => number(raw[key], `${at}.${key}`, fallback, 1, NYQUIST)
  const duration = (): number => number(raw.duration, `${at}.duration`, undefined, 0.001, 10)
  switch (type) {
    case "tone":
      return {
        type,
        wave: oneOf(raw.wave, `${at}.wave`, waves, "sine"),
        from: hz("from"),
        to: hz("to", typeof raw.from === "number" ? raw.from : undefined),
        duration: duration(),
        gain,
        delay,
        attack: number(raw.attack, `${at}.attack`, 0.006, 0.0005)
      }
    case "noise":
      return {
        type,
        filter: oneOf(raw.filter, `${at}.filter`, filters, "lowpass"),
        from: hz("from"),
        to: hz("to", typeof raw.from === "number" ? raw.from : undefined),
        q: number(raw.q, `${at}.q`, 1, 0.01, 40),
        duration: duration(),
        gain,
        delay,
        attack: number(raw.attack, `${at}.attack`, 0.004, 0.0005)
      }
    case "swish":
      return {
        type,
        low: hz("low"),
        peak: hz("peak"),
        peakAt: number(raw.peakAt, `${at}.peakAt`, 0.4, 0.01, 0.99),
        q: number(raw.q, `${at}.q`, 1, 0.01, 40),
        duration: duration(),
        gain,
        delay
      }
    case "crunch":
      return { type, from: hz("from"), to: hz("to", typeof raw.from === "number" ? raw.from : undefined), duration: duration(), gain, delay }
    case "metal":
      return { type, pitch: hz("pitch"), duration: duration(), gain, delay }
    case "click":
      return { type, gain, delay }
    default:
      errors.push(`${at}.type must be one of ${layerTypes.join(", ")}`)
      return undefined
  }
}

const decodeTune = (raw: unknown, at: string, errors: Array<string>): Tune | undefined => {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    errors.push(`${at} must be an object`)
    return undefined
  }
  const { number } = reader(errors)
  return {
    pitch: number(raw.pitch, `${at}.pitch`, 0, -24, 24),
    length: number(raw.length, `${at}.length`, 1, 0.25, 4),
    brightness: number(raw.brightness, `${at}.brightness`, 0, -24, 24),
    echo: number(raw.echo, `${at}.echo`, 0, -1, 1),
    volume: number(raw.volume, `${at}.volume`, 0, -40, 24)
  }
}

/** Reads one recipe from parsed JSON; `at` names it in errors. */
export const decodeRecipeValue = (raw: unknown, at: string, errors: Array<string>): Recipe | undefined => {
  if (!isRecord(raw)) {
    errors.push(`${at} must be an object`)
    return undefined
  }
  const { number } = reader(errors)
  if (!Array.isArray(raw.layers)) {
    errors.push(`${at}.layers must be a list`)
    return undefined
  }
  const layers = raw.layers.flatMap((layer: unknown, i: number) => decodeLayer(layer, `${at}.layers[${i}]`, errors) ?? [])
  if (raw.about !== undefined && typeof raw.about !== "string") errors.push(`${at}.about must be text`)
  if (raw.heavy !== undefined && typeof raw.heavy !== "boolean") errors.push(`${at}.heavy must be true or false`)
  const recipe: Recipe = {
    about: typeof raw.about === "string" ? raw.about : undefined,
    reverb: number(raw.reverb, `${at}.reverb`, 0, 0, 1),
    heavy: raw.heavy === true ? true : undefined,
    interval: raw.interval === undefined ? undefined : number(raw.interval, `${at}.interval`, 0, 0),
    layers,
    tune: decodeTune(raw.tune, `${at}.tune`, errors)
  }
  return recipe
}

const parse = (text: string): Decoded<unknown> => {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: `not JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Reads one recipe written by `encodeRecipe` (or by hand). */
export const decodeRecipe = (text: string): Decoded<Recipe> => {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  const errors: Array<string> = []
  const recipe = decodeRecipeValue(parsed.value, "recipe", errors)
  return recipe === undefined || errors.length > 0 ? { ok: false, error: errors.join("; ") } : { ok: true, value: recipe }
}

/** Sound names are ids the game's code refers to: letters, digits, `-`, `_`, and `.`. */
export const isSoundName = (name: string): boolean => /^[A-Za-z][\w.-]{0,63}$/.test(name)

/** Reads a bank file: `{"version": 1, "sounds": {"name": recipe, ...}}`, reporting every problem at once. */
export const decodeBank = (text: string): Decoded<Bank> => {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  const raw = parsed.value
  if (!isRecord(raw) || !isRecord(raw.sounds)) return { ok: false, error: 'a bank is {"version": 1, "sounds": {"name": recipe, ...}}' }
  if (raw.version !== undefined && raw.version !== 1) return { ok: false, error: `bank version ${String(raw.version)} is not known (this tool reads version 1)` }
  const errors: Array<string> = []
  const sounds: Record<string, Recipe> = {}
  for (const [name, value] of Object.entries(raw.sounds)) {
    if (!isSoundName(name)) errors.push(`"${name}" is not a sound name (letters, digits, -, _, and ., starting with a letter)`)
    const recipe = decodeRecipeValue(value, name, errors)
    if (recipe !== undefined) sounds[name] = recipe
  }
  const master = raw.master === undefined ? undefined : reader(errors).number(raw.master, "master", 1, 0.01, 4)
  return errors.length > 0 ? { ok: false, error: errors.join("; ") } : { ok: true, value: { master, sounds } }
}

/** A recipe as JSON values, with defaults and empty fields left out, so files stay short. */
export const recipeValue = (recipe: Recipe): Record<string, unknown> => {
  const layers = recipe.layers.map((layer) => {
    const { delay, ...rest } = layer
    const out: Record<string, unknown> = { ...rest }
    if (delay !== 0) out.delay = delay
    return out
  })
  const tune = recipe.tune === undefined || isNeutral(recipe.tune) ? undefined : recipe.tune
  return {
    ...(recipe.about === undefined ? {} : { about: recipe.about }),
    reverb: recipe.reverb,
    ...(recipe.heavy === true ? { heavy: true } : {}),
    ...(recipe.interval === undefined ? {} : { interval: recipe.interval }),
    layers,
    ...(tune === undefined ? {} : { tune })
  }
}

export const isNeutral = (tune: Tune): boolean =>
  tune.pitch === 0 && tune.length === 1 && tune.brightness === 0 && tune.echo === 0 && tune.volume === 0

/**
 * JSON with each layer on one line: a bank is read and diffed by people and
 * agents, and a layer is one thought.
 */
const write = (value: unknown, indent: string): string => {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]"
    return `[\n${value.map((item) => `${indent}  ${JSON.stringify(item)}`).join(",\n")}\n${indent}]`
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined)
    if (entries.length === 0) return "{}"
    return `{\n${entries.map(([key, item]) => `${indent}  ${JSON.stringify(key)}: ${key === "tune" ? JSON.stringify(item) : write(item, `${indent}  `)}`).join(",\n")}\n${indent}}`
  }
  return JSON.stringify(value)
}

export const encodeRecipe = (recipe: Recipe): string => write(recipeValue(recipe), "") + "\n"

export const encodeBank = (bank: Bank): string => {
  const sounds: Record<string, unknown> = {}
  for (const [name, recipe] of Object.entries(bank.sounds)) sounds[name] = recipeValue(recipe)
  return write({ version: 1, ...(bank.master === undefined ? {} : { master: bank.master }), sounds }, "") + "\n"
}

/** The recipe with its tune folded into the layers: what the renderer plays, and what a game without tunes would ship. */
export const applyTune = (recipe: Recipe): Recipe => {
  const tune = recipe.tune
  if (tune === undefined || isNeutral(tune)) return recipe
  const pitch = Math.pow(2, tune.pitch / 12)
  const bright = pitch * Math.pow(2, tune.brightness / 12)
  const gain = Math.pow(10, tune.volume / 20)
  const time = tune.length
  const layers = recipe.layers.map((layer): Layer => {
    const delay = layer.delay * time
    const g = layer.gain * gain
    switch (layer.type) {
      case "tone":
        return { ...layer, from: clampHz(layer.from * pitch), to: clampHz(layer.to * pitch), duration: layer.duration * time, attack: layer.attack * time, delay, gain: g }
      case "noise":
        return { ...layer, from: clampHz(layer.from * bright), to: clampHz(layer.to * bright), duration: layer.duration * time, attack: layer.attack * time, delay, gain: g }
      case "swish":
        return { ...layer, low: clampHz(layer.low * bright), peak: clampHz(layer.peak * bright), duration: layer.duration * time, delay, gain: g }
      case "crunch":
        return { ...layer, from: clampHz(layer.from * bright), to: clampHz(layer.to * bright), duration: layer.duration * time, delay, gain: g }
      case "metal":
        return { ...layer, pitch: clampHz(layer.pitch * pitch), duration: layer.duration * time, delay, gain: g }
      case "click":
        return { ...layer, delay, gain: g }
    }
  })
  return { ...recipe, reverb: Math.min(1, Math.max(0, recipe.reverb + tune.echo)), layers, tune: undefined }
}

const clampHz = (hz: number): number => Math.min(NYQUIST, Math.max(1, hz))

/** A layer in a few words, for lists: "tone sine 160→55 Hz, 0.12 s". */
export const describeLayer = (layer: Layer): string => {
  const s = (seconds: number): string => `${seconds < 0.1 ? Math.round(seconds * 1000) + " ms" : Math.round(seconds * 100) / 100 + " s"}`
  const glide = (from: number, to: number): string => (Math.round(from) === Math.round(to) ? `${Math.round(from)} Hz` : `${Math.round(from)}→${Math.round(to)} Hz`)
  switch (layer.type) {
    case "tone":
      return `${layer.wave} ${glide(layer.from, layer.to)}, ${s(layer.duration)}`
    case "noise":
      return `${layer.filter} ${glide(layer.from, layer.to)}, ${s(layer.duration)}`
    case "swish":
      return `${Math.round(layer.low)}→${Math.round(layer.peak)} Hz, ${s(layer.duration)}`
    case "crunch":
      return `${glide(layer.from, layer.to)}, ${s(layer.duration)}`
    case "metal":
      return `${Math.round(layer.pitch)} Hz, ${s(layer.duration)}`
    case "click":
      return "tick"
  }
}
