/**
 * Checking a song: what the agent can know about it without hearing it.
 * It renders the song and measures it (length, peak, loudness, each track's
 * loudness), and reads its notes for what usually sounds wrong: notes out of
 * the key, notes an instrument cannot play well, a track drowned by the
 * others, the same note struck twice at once. With a reference, it says how
 * closely the song's melody follows it.
 */
import { instruments } from "./instruments.ts"
import { loudnessOf, peakOf, renderSong, type NoteCache } from "./render.ts"
import { barsOf, inKey, lengthInBeats, lengthInSeconds, midiOf, nameOf, parseKey, type Song } from "./song.ts"

export type Severity = "error" | "warning"

export interface Issue {
  readonly rule: string
  readonly severity: Severity
  /** The track it is about, by name; none for the whole song. */
  readonly track?: string | undefined
  readonly message: string
}

export interface TrackReport {
  readonly name: string
  readonly instrument: string
  readonly notes: number
  /** RMS in dBFS of the track alone, at its volume. */
  readonly loudness: number
  readonly range: readonly [string, string] | undefined
}

export interface Follow {
  /** The track whose notes follow the reference most closely. */
  readonly track: string
  /** Share of the reference's notes this track also plays at that moment (same note, any octave), 0 to 1. */
  readonly share: number
}

export type Verdict = "clean" | "warnings" | "errors"

export interface SongReport {
  readonly verdict: Verdict
  readonly seconds: number
  readonly bars: number
  readonly tempo: number
  readonly key: string
  readonly peak: number
  readonly loudness: number
  readonly tracks: ReadonlyArray<TrackReport>
  readonly follows?: Follow | undefined
  readonly issues: ReadonlyArray<Issue>
}

export const limits = {
  /** Past full scale, samples are clipped (dBFS). */
  clipping: -0.1,
  /** Game music this quiet gets lost under the sounds (RMS dBFS). */
  quiet: -30,
  /** A track this much quieter than the loudest one is barely heard (dB). */
  buried: 18,
  /** A melody following less than this share of the reference has wandered off it. */
  follows: 0.5
} as const

const round = (value: number): number => Math.round(value * 10) / 10

/** How closely each melodic track follows the reference's notes; the closest one. */
export const followOf = (song: Song): Follow | undefined => {
  const reference = song.reference
  if (reference === undefined || reference.notes.length === 0) return undefined
  let best: Follow | undefined
  for (const track of song.tracks) {
    if (instruments[track.instrument].kind === "drums") continue
    let matched = 0
    for (const heard of reference.notes) {
      const pitch = midiOf(heard.pitch)
      const at = heard.at + reference.offset + Math.min(heard.length, 0.25) / 2
      const hit = track.notes.some((note) => note.at <= at && at < note.at + note.length && (((midiOf(note.pitch) ?? -1) - (pitch ?? 0)) % 12 + 12) % 12 === 0)
      if (hit) matched++
    }
    const share = Math.round((matched / reference.notes.length) * 100) / 100
    if (best === undefined || share > best.share) best = { track: track.name, share }
  }
  return best
}

export const checkSong = (song: Song, cache?: NoteCache): SongReport => {
  const issues: Array<Issue> = []
  const key = parseKey(song.key)
  const end = lengthInBeats(song)
  const mix = renderSong(song, { cache })
  const peak = peakOf(mix)
  const loudness = loudnessOf(mix)
  const tracks: Array<TrackReport> = song.tracks.map((track, index) => {
    const instrument = instruments[track.instrument]
    const melodic = instrument.kind === "melodic"
    const midis = melodic ? track.notes.flatMap((note) => midiOf(note.pitch) ?? []) : []
    if (track.notes.length === 0) issues.push({ rule: "empty-track", severity: "warning", track: track.name, message: "Has no notes." })
    if (melodic && key !== undefined) {
      const outside = track.notes.filter((note) => !inKey(key, midiOf(note.pitch) ?? 0))
      if (outside.length > 0) {
        const listed = outside.slice(0, 6).map((note) => `${note.pitch} (${barsOf(song, note.at, note.at + note.length)})`)
        issues.push({ rule: "out-of-key", severity: "warning", track: track.name, message: `${outside.length} note${outside.length === 1 ? " is" : "s are"} outside ${song.key}: ${listed.join(", ")}${outside.length > 6 ? ", …" : ""}. Fine for a passing color; otherwise move ${outside.length === 1 ? "it" : "them"} to a note of the key.` })
      }
    }
    if (melodic) {
      const [low, high] = instrument.range
      const outOfRange = midis.filter((midi) => midi < low || midi > high)
      if (outOfRange.length > 0) issues.push({ rule: "range", severity: "warning", track: track.name, message: `${outOfRange.length} note${outOfRange.length === 1 ? "" : "s"} outside what the ${instrument.label.toLowerCase()} plays well (${nameOf(low)} to ${nameOf(high)}): ${[...new Set(outOfRange.map(nameOf))].slice(0, 6).join(", ")}.` })
    }
    const late = track.notes.filter((note) => note.at >= end)
    if (late.length > 0) issues.push({ rule: "past-the-end", severity: "warning", track: track.name, message: `${late.length} note${late.length === 1 ? " starts" : "s start"} after the song's last bar (${song.bars}) and ${late.length === 1 ? "is" : "are"} never heard. Add bars or move ${late.length === 1 ? "it" : "them"}.` })
    // The same note struck again while it still sounds: two copies at once, or a note cut short.
    let doubled = 0
    const sorted = [...track.notes].sort((a, b) => a.at - b.at)
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length && sorted[j]!.at < sorted[i]!.at + sorted[i]!.length - 1e-6; j++) if (sorted[j]!.pitch === sorted[i]!.pitch) doubled++
    }
    if (doubled > 0) issues.push({ rule: "overlap", severity: "warning", track: track.name, message: `${doubled} note${doubled === 1 ? " starts" : "s start"} while the same note is still held. Shorten the first, or remove one.` })
    // Each track alone, uncompressed: the compressor would lift a buried track and hide it.
    const alone = loudnessOf(renderSong({ ...song, compressor: false }, { tracks: [index], cache }))
    return {
      name: track.name,
      instrument: track.instrument,
      notes: track.notes.length,
      loudness: alone,
      range: midis.length === 0 ? undefined : [nameOf(Math.min(...midis)), nameOf(Math.max(...midis))]
    }
  })
  if (song.tracks.every((track) => track.notes.length === 0)) issues.push({ rule: "silent", severity: "error", message: "No track has notes: the song is silent." })
  else if (peak > limits.clipping) issues.push({ rule: "clipping", severity: "error", message: `Peaks at +${round(Math.max(0, peak))} dBFS: it clips and distorts. Lower master by about ${Math.ceil(peak + 1)} dB (master × ${round(Math.pow(10, -(peak + 1) / 20))}).` })
  else if (loudness < limits.quiet) issues.push({ rule: "quiet", severity: "warning", message: `${loudness} dBFS overall: quiet for game music (about -18 to -24 sits well under sound effects). Raise master.` })
  const heard = tracks.filter((track, i) => track.notes > 0 && song.tracks[i]!.mute !== true)
  const loudest = Math.max(...heard.map((track) => track.loudness))
  for (const track of heard) {
    if (loudest - track.loudness > limits.buried) issues.push({ rule: "buried", severity: "warning", track: track.name, message: `${round(loudest - track.loudness)} dB under the loudest track: barely heard. Raise its volume, or drop it.` })
  }
  const follows = followOf(song)
  if (follows !== undefined && follows.share < limits.follows) issues.push({ rule: "off-reference", severity: "warning", message: `The closest track (${follows.track}) plays ${Math.round(follows.share * 100)}% of the reference's notes: the melody has wandered from the hum. Keep its notes, or say why not.` })
  const verdict: Verdict = issues.some((issue) => issue.severity === "error") ? "errors" : issues.length > 0 ? "warnings" : "clean"
  return { verdict, seconds: round(lengthInSeconds(song)), bars: song.bars, tempo: song.tempo, key: song.key, peak, loudness, tracks, follows, issues }
}
