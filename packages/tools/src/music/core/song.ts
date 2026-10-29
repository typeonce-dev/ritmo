/**
 * Songs: a piece of game music as plain JSON. A song is a tempo, a key,
 * a number of bars, and tracks; each track is one instrument playing notes
 * on a timeline counted in beats. The renderer (`render.ts`) turns it into
 * sound the same way in Node and in the browser, so what the page plays,
 * what the CLI measures, and the WAV the game gets are one song.
 *
 * ```json
 * {
 *   "version": 1,
 *   "tempo": 96,
 *   "key": "A minor",
 *   "bars": 8,
 *   "tracks": [
 *     { "name": "Melody", "instrument": "flute", "notes": [{ "at": 0, "length": 1, "pitch": "E5" }] },
 *     { "name": "Drums", "instrument": "drums", "notes": [{ "at": 0, "length": 0.5, "pitch": "kick" }] }
 *   ]
 * }
 * ```
 *
 * Time is in beats from the start of the song (`at: 4` is the first beat of
 * bar 2 in 4/4), pitches are note names (`"C4"` is middle C, `"F#3"`), or
 * drum names on a drum track. A song may carry a `reference`: what
 * `music listen` heard in a hum or a recording (its tempo, key, and melody),
 * for the agent to build the song around and the page to draw under it.
 */
import { drumNames, instrumentIds, instruments, isDrum, type InstrumentId } from "./instruments.ts"

export type Decoded<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: string }

export interface Note {
  /** When it starts, in beats from the song's start. */
  readonly at: number
  /** How long it is held, in beats. */
  readonly length: number
  /** A note name (`"A4"`), or a drum name on a drum track (`"kick"`). */
  readonly pitch: string
  /** How hard it is played, 0 to 1. */
  readonly velocity: number
}

export interface Track {
  readonly name: string
  readonly instrument: InstrumentId
  /** 0 to 1.5: how loud the track is in the mix. */
  readonly volume: number
  /** -1 (left) to 1 (right). */
  readonly pan: number
  /** How much of the track goes to the room, 0 to 1. */
  readonly reverb: number
  readonly mute?: boolean | undefined
  readonly notes: ReadonlyArray<Note>
}

/** A note heard in the reference: a whole semitone, in beats on the song's grid. */
export interface HeardNote {
  readonly at: number
  readonly length: number
  /** A note name. */
  readonly pitch: string
}

/** What `music listen` heard in a hum, a beat, or a recording. */
export interface Reference {
  /** The audio file it was heard in, next to the song. */
  readonly audio?: string | undefined
  /** Beats per minute, as heard. */
  readonly tempo: number
  /** The key it sounds in, as heard: `"D minor"`. */
  readonly key: string
  /** Its length in beats. */
  readonly length: number
  /** The melody: each held pitch, rounded to a semitone and to the grid. */
  readonly notes: ReadonlyArray<HeardNote>
  /** The raw pitch line, one value every eighth of a beat (MIDI note number, fractional; 0 where nothing is sung). */
  readonly contour: ReadonlyArray<number>
  /** Where on the song the reference starts, in beats (0 by default). */
  readonly offset: number
  /** Seconds into the audio file where its beat 0 falls (its first note). */
  readonly start: number
}

export interface Song {
  /** What the song is for, in a few words: the agent's intent, shown to the person. */
  readonly about?: string | undefined
  /** Beats per minute. */
  readonly tempo: number
  /** The key: a note and a scale, `"A minor"`, `"C major"`, `"D dorian"`. */
  readonly key: string
  /** Beats in a bar: 4 (most music), 3 (a waltz), or 6. */
  readonly beatsPerBar: number
  readonly bars: number
  /** A loop's end wraps into its start, so it repeats without a seam (game music mostly loops). */
  readonly loop: boolean
  /** The volume over the whole song, 0 to 2. */
  readonly master: number
  /** Squeezes the whole mix louder and punchier, its peaks held under -1 dBFS: for rock, drum & bass, and electronic songs. Off by default. */
  readonly compressor: boolean
  readonly tracks: ReadonlyArray<Track>
  readonly reference?: Reference | undefined
}

// ---------------------------------------------------------------------------
// Pitches and keys

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const
const LETTERS: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** A note name's MIDI number (`"C4"` is 60, `"A4"` 69), or undefined if it is not one. */
export const midiOf = (pitch: string): number | undefined => {
  const match = /^([A-G])(#|b)?(-?\d)$/.exec(pitch)
  if (match === null) return undefined
  const base = LETTERS[match[1]!]!
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0
  const midi = (Number(match[3]) + 1) * 12 + base + accidental
  return midi >= 0 && midi <= 127 ? midi : undefined
}

/** A MIDI number's note name, sharps for black keys (`61` is `"C#4"`). */
export const nameOf = (midi: number): string => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`

/** A MIDI number's frequency in Hz (A4 = 440). */
export const frequencyOf = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

/** The scales a key may name, as semitones above the key's note. */
export const scales = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  "harmonic minor": [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "major pentatonic": [0, 2, 4, 7, 9],
  "minor pentatonic": [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10]
} as const satisfies Record<string, ReadonlyArray<number>>
export type Scale = keyof typeof scales
export const scaleNames: ReadonlyArray<Scale> = ["major", "minor", "harmonic minor", "dorian", "phrygian", "lydian", "mixolydian", "major pentatonic", "minor pentatonic", "blues"]
export const tonics: ReadonlyArray<string> = ["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"]

export interface Key {
  /** The key's note, 0 (C) to 11 (B). */
  readonly root: number
  readonly scale: Scale
  /** The pitch classes in the key (0 is C). */
  readonly classes: ReadonlyArray<number>
}

/** Reads `"A minor"`, `"F# dorian"`, `"Bb major pentatonic"`. */
export const parseKey = (key: string): Key | undefined => {
  const match = /^([A-G])(#|b)? (.+)$/.exec(key.trim())
  if (match === null) return undefined
  const scale = scaleNames.find((name) => name === match[3])
  if (scale === undefined) return undefined
  const root = (LETTERS[match[1]!]! + (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0) + 12) % 12
  return { root, scale, classes: scales[scale].map((step) => (root + step) % 12) }
}

export const inKey = (key: Key, midi: number): boolean => key.classes.includes(((midi % 12) + 12) % 12)

// ---------------------------------------------------------------------------
// Time

export const secondsPerBeat = (song: Song): number => 60 / song.tempo
export const lengthInBeats = (song: Song): number => song.bars * song.beatsPerBar
export const lengthInSeconds = (song: Song): number => lengthInBeats(song) * secondsPerBeat(song)

/** `"bar 3"`, or `"bars 3–4"`: where a span of beats lies, bars counted from 1. */
export const barsOf = (song: Song, from: number, to: number): string => {
  const first = Math.floor(from / song.beatsPerBar) + 1
  const last = Math.max(first, Math.ceil(to / song.beatsPerBar))
  return first === last ? `bar ${first}` : `bars ${first}–${last}`
}

// ---------------------------------------------------------------------------
// Decoding

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

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
  const text = (value: unknown, name: string, fallback?: string): string => {
    if (value === undefined && fallback !== undefined) return fallback
    if (typeof value !== "string") {
      errors.push(`${name} must be text`)
      return fallback ?? ""
    }
    return value
  }
  return { number, text }
}

const decodeNote = (raw: unknown, at: string, drums: boolean, errors: Array<string>): Note | undefined => {
  if (!isRecord(raw)) {
    errors.push(`${at} must be an object`)
    return undefined
  }
  const { number, text } = reader(errors)
  const pitch = text(raw.pitch, `${at}.pitch`)
  if (drums && !isDrum(pitch)) errors.push(`${at}.pitch must be a drum on a drum track: ${drumNames.join(", ")}`)
  if (!drums && midiOf(pitch) === undefined) errors.push(`${at}.pitch must be a note name like "C4", "F#3", or "Bb5" (got ${JSON.stringify(raw.pitch)})`)
  return {
    at: number(raw.at, `${at}.at`, undefined, 0),
    length: number(raw.length, `${at}.length`, undefined, 1 / 64, 64),
    pitch,
    velocity: number(raw.velocity, `${at}.velocity`, 0.8, 0, 1)
  }
}

const decodeTrack = (raw: unknown, at: string, errors: Array<string>): Track | undefined => {
  if (!isRecord(raw)) {
    errors.push(`${at} must be an object`)
    return undefined
  }
  const { number, text } = reader(errors)
  const instrument = instrumentIds.find((id) => id === raw.instrument)
  if (instrument === undefined) errors.push(`${at}.instrument must be one of ${instrumentIds.join(", ")}`)
  const drums = instrument !== undefined && instruments[instrument].kind === "drums"
  if (!Array.isArray(raw.notes)) errors.push(`${at}.notes must be a list`)
  const notes = (Array.isArray(raw.notes) ? raw.notes : []).flatMap((note: unknown, i: number) => decodeNote(note, `${at}.notes[${i}]`, drums, errors) ?? [])
  if (raw.mute !== undefined && typeof raw.mute !== "boolean") errors.push(`${at}.mute must be true or false`)
  return {
    name: text(raw.name, `${at}.name`, instrument === undefined ? "Track" : instruments[instrument].label),
    instrument: instrument ?? "piano",
    volume: number(raw.volume, `${at}.volume`, 0.8, 0, 1.5),
    pan: number(raw.pan, `${at}.pan`, 0, -1, 1),
    reverb: number(raw.reverb, `${at}.reverb`, 0.2, 0, 1),
    mute: raw.mute === true ? true : undefined,
    notes: [...notes].sort((a, b) => a.at - b.at)
  }
}

const decodeReference = (raw: unknown, at: string, errors: Array<string>): Reference | undefined => {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    errors.push(`${at} must be an object`)
    return undefined
  }
  const { number, text } = reader(errors)
  const notes: Array<HeardNote> = []
  for (const [i, note] of (Array.isArray(raw.notes) ? raw.notes : []).entries()) {
    if (!isRecord(note) || typeof note.pitch !== "string" || midiOf(note.pitch) === undefined) {
      errors.push(`${at}.notes[${i}] must be {"at", "length", "pitch"}`)
      continue
    }
    notes.push({ at: number(note.at, `${at}.notes[${i}].at`, 0, 0), length: number(note.length, `${at}.notes[${i}].length`, 0.25, 0), pitch: note.pitch })
  }
  const contour = Array.isArray(raw.contour) ? raw.contour.filter((value): value is number => typeof value === "number" && Number.isFinite(value)) : []
  return {
    audio: raw.audio === undefined ? undefined : text(raw.audio, `${at}.audio`),
    tempo: number(raw.tempo, `${at}.tempo`, 100, 20, 300),
    key: text(raw.key, `${at}.key`, "C major"),
    length: number(raw.length, `${at}.length`, 0, 0),
    notes,
    contour,
    offset: number(raw.offset, `${at}.offset`, 0),
    start: number(raw.start, `${at}.start`, 0, 0)
  }
}

/** Reads a song from parsed JSON, collecting every problem with where it is. */
export const decodeSongValue = (raw: unknown): Decoded<Song> => {
  if (!isRecord(raw)) return { ok: false, error: 'a song is {"version": 1, "tempo": 96, "key": "A minor", "bars": 8, "tracks": [...]}' }
  const errors: Array<string> = []
  const { number, text } = reader(errors)
  const key = text(raw.key, "key", "C major")
  if (parseKey(key) === undefined) errors.push(`key must be a note and a scale, like "A minor" or "F# dorian" (scales: ${scaleNames.join(", ")})`)
  const beatsPerBar = number(raw.beatsPerBar, "beatsPerBar", 4, 2, 12)
  if (!Number.isInteger(beatsPerBar)) errors.push("beatsPerBar must be a whole number")
  const bars = number(raw.bars, "bars", undefined, 1, 256)
  if (!Number.isInteger(bars)) errors.push("bars must be a whole number")
  if (!Array.isArray(raw.tracks)) errors.push("tracks must be a list")
  const tracks = (Array.isArray(raw.tracks) ? raw.tracks : []).flatMap((track: unknown, i: number) => decodeTrack(track, `tracks[${i}]`, errors) ?? [])
  if (raw.loop !== undefined && typeof raw.loop !== "boolean") errors.push("loop must be true or false")
  if (raw.compressor !== undefined && typeof raw.compressor !== "boolean") errors.push("compressor must be true or false")
  if (raw.about !== undefined && typeof raw.about !== "string") errors.push("about must be text")
  const song: Song = {
    about: typeof raw.about === "string" ? raw.about : undefined,
    tempo: number(raw.tempo, "tempo", undefined, 30, 300),
    key,
    beatsPerBar,
    bars,
    loop: raw.loop !== false,
    master: number(raw.master, "master", 0.8, 0, 2),
    compressor: raw.compressor === true,
    tracks,
    reference: decodeReference(raw.reference, "reference", errors)
  }
  return errors.length === 0 ? { ok: true, value: song } : { ok: false, error: errors.join("; ") }
}

export const decodeSong = (text: string): Decoded<Song> => {
  try {
    return decodeSongValue(JSON.parse(text))
  } catch (error) {
    return { ok: false, error: `not JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

// ---------------------------------------------------------------------------
// Encoding: one note per line, so a song reads and diffs well

const round = (value: number, digits = 4): number => Math.round(value * 10 ** digits) / 10 ** digits

const noteValue = (note: Note): Record<string, unknown> => ({ at: round(note.at), length: round(note.length), pitch: note.pitch, ...(note.velocity === 0.8 ? {} : { velocity: round(note.velocity, 2) }) })

/** The song as JSON, with every default left out and one note per line. */
export const encodeSong = (song: Song): string => {
  const head = {
    version: 1,
    ...(song.about === undefined ? {} : { about: song.about }),
    tempo: round(song.tempo, 2),
    key: song.key,
    ...(song.beatsPerBar === 4 ? {} : { beatsPerBar: song.beatsPerBar }),
    bars: song.bars,
    ...(song.loop ? {} : { loop: false }),
    master: round(song.master, 3),
    ...(song.compressor ? { compressor: true } : {})
  }
  const lines: Array<string> = ["{"]
  for (const [name, value] of Object.entries(head)) lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(value)},`)
  lines.push(`  "tracks": [`)
  song.tracks.forEach((track, t) => {
    const fields = {
      name: track.name,
      instrument: track.instrument,
      volume: round(track.volume, 3),
      ...(track.pan === 0 ? {} : { pan: round(track.pan, 3) }),
      reverb: round(track.reverb, 3),
      ...(track.mute === true ? { mute: true } : {})
    }
    lines.push(`    {`)
    for (const [name, value] of Object.entries(fields)) lines.push(`      ${JSON.stringify(name)}: ${JSON.stringify(value)},`)
    const notes = [...track.notes].sort((a, b) => a.at - b.at || (midiOf(a.pitch) ?? 0) - (midiOf(b.pitch) ?? 0))
    if (notes.length === 0) lines.push(`      "notes": []`)
    else {
      lines.push(`      "notes": [`)
      notes.forEach((note, i) => lines.push(`        ${JSON.stringify(noteValue(note))}${i === notes.length - 1 ? "" : ","}`))
      lines.push(`      ]`)
    }
    lines.push(`    }${t === song.tracks.length - 1 ? "" : ","}`)
  })
  if (song.reference === undefined) lines.push(`  ]`)
  else {
    const reference = song.reference
    lines.push(`  ],`)
    lines.push(`  "reference": {`)
    const fields = { ...(reference.audio === undefined ? {} : { audio: reference.audio }), tempo: round(reference.tempo, 1), key: reference.key, length: round(reference.length, 2), ...(reference.offset === 0 ? {} : { offset: round(reference.offset) }), start: round(reference.start, 3) }
    for (const [name, value] of Object.entries(fields)) lines.push(`    ${JSON.stringify(name)}: ${JSON.stringify(value)},`)
    lines.push(`    "notes": [${reference.notes.map((note) => JSON.stringify({ at: round(note.at), length: round(note.length), pitch: note.pitch })).join(", ")}],`)
    lines.push(`    "contour": [${reference.contour.map((value) => round(value, 1)).join(",")}]`)
    lines.push(`  }`)
  }
  lines.push("}")
  return lines.join("\n") + "\n"
}
