/**
 * MIDI export: the song as a Standard MIDI File (format 1, one MIDI track
 * per song track), the notes-only format every music program opens. The
 * drum kit plays on channel 10 with General MIDI's drum numbers; every other
 * track names its instrument's General MIDI program.
 */
import { drums, instruments } from "./instruments.ts"
import { midiOf, parseKey, type Song } from "./song.ts"

const TICKS = 480

const variable = (value: number): Array<number> => {
  const bytes = [value & 0x7f]
  let rest = value >> 7
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80)
    rest >>= 7
  }
  return bytes
}

const chunk = (id: string, body: ReadonlyArray<number>): Array<number> => [...[...id].map((c) => c.charCodeAt(0)), (body.length >>> 24) & 0xff, (body.length >>> 16) & 0xff, (body.length >>> 8) & 0xff, body.length & 0xff, ...body]

const text = (type: number, value: string): Array<number> => {
  const bytes = [...new TextEncoder().encode(value)]
  return [0xff, type, ...variable(bytes.length), ...bytes]
}

interface Event {
  readonly tick: number
  /** Note offs sort before note ons at one tick, so a repeated note restarts. */
  readonly order: number
  readonly bytes: ReadonlyArray<number>
}

const track = (events: ReadonlyArray<Event>): Array<number> => {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order)
  const body: Array<number> = []
  let last = 0
  for (const event of sorted) {
    body.push(...variable(event.tick - last), ...event.bytes)
    last = event.tick
  }
  body.push(0, 0xff, 0x2f, 0)
  return chunk("MTrk", body)
}

/** The song as a `.mid` file. */
export const toMidi = (song: Song): Uint8Array => {
  const tempo = Math.round(60_000_000 / song.tempo)
  const key = parseKey(song.key)
  // The key signature: sharps (positive) or flats on the circle of fifths, counted from the key's relative major.
  const toMajor: Readonly<Record<string, number>> = { minor: 3, "harmonic minor": 3, "minor pentatonic": 3, blues: 3, dorian: 10, phrygian: 8, lydian: 7, mixolydian: 5 }
  const minor = key !== undefined && toMajor[key.scale] === 3
  const fifths = key === undefined ? 0 : (((key.root + (toMajor[key.scale] ?? 0)) % 12) * 7) % 12
  const signed = fifths > 6 ? fifths - 12 : fifths
  const head: Array<Event> = [
    { tick: 0, order: 0, bytes: text(0x03, song.about ?? "Song") },
    { tick: 0, order: 0, bytes: [0xff, 0x51, 3, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff] },
    { tick: 0, order: 0, bytes: [0xff, 0x58, 4, song.beatsPerBar, 2, 24, 8] },
    { tick: 0, order: 0, bytes: [0xff, 0x59, 2, signed & 0xff, minor ? 1 : 0] }
  ]
  // Channel 10 (9 from 0) is General MIDI's drums; the other instruments share the other fifteen.
  const melodic = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]
  let next = 0
  const tracks = song.tracks.map((entry) => {
    const isDrums = instruments[entry.instrument].kind === "drums"
    const ch = isDrums ? 9 : melodic[next++ % melodic.length]!
    const events: Array<Event> = [
      { tick: 0, order: 0, bytes: text(0x03, entry.name) },
      ...(isDrums ? [] : [{ tick: 0, order: 0, bytes: [0xc0 | ch, instruments[entry.instrument].program] }]),
      { tick: 0, order: 0, bytes: [0xb0 | ch, 7, Math.min(127, Math.round(entry.volume * 100))] },
      { tick: 0, order: 0, bytes: [0xb0 | ch, 10, Math.round((entry.pan + 1) * 63.5)] }
    ]
    for (const note of entry.notes) {
      const number = isDrums ? drums.find((drum) => drum.name === note.pitch)?.gm : midiOf(note.pitch)
      if (number === undefined) continue
      const on = Math.round(note.at * TICKS)
      const off = Math.max(on + 1, Math.round((note.at + note.length) * TICKS))
      const velocity = Math.max(1, Math.round(note.velocity * 127))
      events.push({ tick: on, order: 1, bytes: [0x90 | ch, number, velocity] }, { tick: off, order: 0, bytes: [0x80 | ch, number, 0] })
    }
    return track(events)
  })
  const header = chunk("MThd", [0, 1, ((tracks.length + 1) >> 8) & 0xff, (tracks.length + 1) & 0xff, (TICKS >> 8) & 0xff, TICKS & 0xff])
  return new Uint8Array([...header, ...track(head), ...tracks.flat()])
}
