/**
 * Takes: other versions of a sound for a person to choose from. The agent
 * (or the page) makes a few at once, each nudged toward what was asked
 * ("heavier", "brighter") and a little different from the others, and the
 * person picks the one that sounds right. Picking is quicker and surer than
 * describing a sound in words.
 */
import { applyTune, type Layer, type Recipe } from "./recipe.ts"
import { seeded } from "./render.ts"

export type Toward = "heavier" | "lighter" | "brighter" | "darker" | "shorter" | "longer" | "punchier" | "softer" | "wider"

export const towards: ReadonlyArray<{ readonly id: Toward; readonly label: string; readonly hint: string }> = [
  { id: "wider", label: "Anything", hint: "Takes spread around the sound, in no one direction." },
  { id: "heavier", label: "Heavier", hint: "Lower, longer, with more weight." },
  { id: "lighter", label: "Lighter", hint: "Higher, shorter, thinner." },
  { id: "brighter", label: "Brighter", hint: "More highs in the noise; the notes stay." },
  { id: "darker", label: "Darker", hint: "Fewer highs in the noise; the notes stay." },
  { id: "punchier", label: "Punchier", hint: "A sharper start and a quicker end." },
  { id: "softer", label: "Softer", hint: "A gentler start, rounder, quieter." },
  { id: "shorter", label: "Shorter", hint: "Everything quicker." },
  { id: "longer", label: "Longer", hint: "Everything drawn out." }
]

export interface Take {
  /** Unique within the sound's takes: "t1", "t2", ... */
  readonly id: string
  /** What changed, in a few words: "2.1 semitones lower, 18% longer". */
  readonly label: string
  readonly recipe: Recipe
}

/** How far each direction moves a sound: pitch in semitones, time and gain as factors, filters in semitones. */
interface Push {
  readonly pitch: number
  readonly time: number
  readonly gain: number
  readonly filters: number
  readonly attack: number
  readonly reverb: number
}

const pushes: Record<Toward, Push> = {
  wider: { pitch: 0, time: 1, gain: 1, filters: 0, attack: 1, reverb: 0 },
  heavier: { pitch: -3, time: 1.25, gain: 1.15, filters: -3, attack: 1, reverb: 0.05 },
  lighter: { pitch: 3, time: 0.8, gain: 0.9, filters: 3, attack: 1, reverb: -0.03 },
  brighter: { pitch: 0, time: 1, gain: 1, filters: 5, attack: 1, reverb: 0 },
  darker: { pitch: 0, time: 1, gain: 1, filters: -5, attack: 1, reverb: 0 },
  punchier: { pitch: 0, time: 0.85, gain: 1.15, filters: 1, attack: 0.4, reverb: -0.04 },
  softer: { pitch: 0, time: 1.1, gain: 0.8, filters: -2, attack: 2.5, reverb: 0.04 },
  shorter: { pitch: 0, time: 0.7, gain: 1, filters: 0, attack: 0.8, reverb: -0.03 },
  longer: { pitch: 0, time: 1.4, gain: 1, filters: 0, attack: 1.2, reverb: 0.04 }
}

/** How much the takes differ from each other, around the push: pitch and filters in semitones, time and gain as a share. */
const SPREAD = { pitch: 1.5, filters: 3, time: 0.15, gain: 0.2 }

const clampHz = (hz: number): number => Math.min(20000, Math.max(20, hz))

const describe = (pitch: number, filters: number, time: number, gain: number): string => {
  const parts: Array<string> = []
  if (Math.abs(pitch) >= 0.3) parts.push(`${Math.abs(Math.round(pitch * 10) / 10)} semitones ${pitch < 0 ? "lower" : "higher"}`)
  if (Math.abs(filters - pitch) >= 0.5) parts.push(filters - pitch > 0 ? "brighter" : "darker")
  if (Math.abs(time - 1) >= 0.04) parts.push(`${Math.round(Math.abs(time - 1) * 100)}% ${time > 1 ? "longer" : "shorter"}`)
  if (Math.abs(gain - 1) >= 0.05) parts.push(`${Math.abs(Math.round(20 * Math.log10(gain) * 10) / 10)} dB ${gain > 1 ? "louder" : "quieter"}`)
  return parts.length === 0 ? "about the same" : parts.join(", ")
}

/**
 * `count` takes of a recipe, pushed `toward` a direction. Each take moves
 * the whole sound (so it stays itself) and each layer a little on its own
 * (so the takes differ in character, not only in pitch). The same seed
 * makes the same takes. A tune on the recipe is folded into the takes.
 */
export const makeTakes = (recipe: Recipe, toward: Toward, count: number, seed = 1): Array<Take> => {
  const base = applyTune(recipe)
  const push = pushes[toward]
  const random = seeded(seed * 7919 + toward.length)
  const around = (spread: number): number => (random() * 2 - 1) * spread
  return Array.from({ length: Math.max(1, Math.min(12, Math.round(count))) }, (_, i) => {
    const pitch = push.pitch + around(SPREAD.pitch)
    const filters = pitch + push.filters - push.pitch + around(SPREAD.filters)
    const time = push.time * (1 + around(SPREAD.time))
    const gain = push.gain * (1 + around(SPREAD.gain))
    const p = Math.pow(2, pitch / 12)
    const f = Math.pow(2, filters / 12)
    // Each layer wanders a little more on its own.
    const layers = base.layers.map((layer): Layer => {
      const own = 1 + around(0.08)
      const g = layer.gain * gain * (1 + around(0.12))
      const delay = layer.delay * time
      switch (layer.type) {
        case "tone":
          return { ...layer, from: clampHz(layer.from * p * own), to: clampHz(layer.to * p * own), duration: layer.duration * time * own, attack: Math.max(0.0005, layer.attack * push.attack), delay, gain: g }
        case "noise":
          return { ...layer, from: clampHz(layer.from * f * own), to: clampHz(layer.to * f * own), duration: layer.duration * time * own, attack: Math.max(0.0005, layer.attack * push.attack), delay, gain: g }
        case "swish":
          return { ...layer, low: clampHz(layer.low * f * own), peak: clampHz(layer.peak * f * own), duration: layer.duration * time * own, delay, gain: g }
        case "crunch":
          return { ...layer, from: clampHz(layer.from * f * own), to: clampHz(layer.to * f * own), duration: layer.duration * time * own, delay, gain: g }
        case "metal":
          return { ...layer, pitch: clampHz(layer.pitch * p * own), duration: layer.duration * time * own, delay, gain: g }
        case "click":
          return { ...layer, delay, gain: g }
      }
    })
    const reverb = Math.min(1, Math.max(0, base.reverb + push.reverb + around(0.03)))
    return { id: `t${i + 1}`, label: describe(pitch, filters, time, gain), recipe: { ...base, reverb: round(reverb), layers: layers.map(roundLayer) } }
  })
}

const round = (value: number): number => Math.round(value * 1000) / 1000
const roundHz = (value: number): number => Math.round(value)

/** Takes are written to files: keep their numbers short. */
const roundLayer = (layer: Layer): Layer => {
  const time = { delay: round(layer.delay), gain: round(layer.gain) }
  switch (layer.type) {
    case "tone":
      return { ...layer, ...time, from: roundHz(layer.from), to: roundHz(layer.to), duration: round(layer.duration), attack: Math.max(0.0005, round(layer.attack)) }
    case "noise":
      return { ...layer, ...time, from: roundHz(layer.from), to: roundHz(layer.to), duration: round(layer.duration), attack: Math.max(0.0005, round(layer.attack)) }
    case "swish":
      return { ...layer, ...time, low: roundHz(layer.low), peak: roundHz(layer.peak), duration: round(layer.duration) }
    case "crunch":
      return { ...layer, ...time, from: roundHz(layer.from), to: roundHz(layer.to), duration: round(layer.duration) }
    case "metal":
      return { ...layer, ...time, pitch: roundHz(layer.pitch), duration: round(layer.duration) }
    case "click":
      return { ...layer, ...time }
  }
}
