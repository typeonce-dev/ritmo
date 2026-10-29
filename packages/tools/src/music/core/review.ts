/**
 * The review: what the person said about a song, kept next to it
 * (`theme.song.json` → `theme.song.review.json`) for the agent to read with
 * `music notes`. The song's status (new, approved, changes asked), a note
 * on the whole, comments pinned to a few bars (and a track), and a summary
 * of the edits the person made by hand since the agent last wrote the song.
 *
 * Edits land in the song itself as they are made; the summary is there so
 * the agent knows what the person changed and keeps it.
 */
import { instruments } from "./instruments.ts"
import { barsOf, type Decoded, type Note, type Song, type Track } from "./song.ts"

export type Status = "new" | "approved" | "changes"
export const statuses: ReadonlyArray<Status> = ["new", "approved", "changes"]

export interface Comment {
  readonly id: string
  /** The span it is about, in beats. */
  readonly from: number
  readonly to: number
  /** The track it is about, by name; none for every track. */
  readonly track?: string | undefined
  readonly text: string
}

export interface Review {
  readonly status: Status
  readonly note: string
  readonly comments: ReadonlyArray<Comment>
  /** What the person changed by hand since the agent last wrote the song, a line each. */
  readonly edits: ReadonlyArray<string>
}

export const emptyReview: Review = { status: "new", note: "", comments: [], edits: [] }

/** Where a song's review lives. */
export const reviewPath = (songPath: string): string => (songPath.endsWith(".json") ? songPath.slice(0, -".json".length) : songPath) + ".review.json"

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

export const decodeReview = (text: string): Decoded<Review> => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `not JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!isRecord(raw)) return { ok: false, error: 'a review is {"version": 1, "status": "new", "note": "", "comments": [], "edits": []}' }
  const errors: Array<string> = []
  const status = statuses.find((entry) => entry === raw.status)
  if (raw.status !== undefined && status === undefined) errors.push(`status must be one of ${statuses.join(", ")}`)
  const comments: Array<Comment> = []
  for (const [i, comment] of (Array.isArray(raw.comments) ? raw.comments : []).entries()) {
    if (!isRecord(comment) || typeof comment.id !== "string" || typeof comment.text !== "string" || typeof comment.from !== "number" || typeof comment.to !== "number") {
      errors.push(`comments[${i}] must be {"id", "from", "to", "text"}`)
      continue
    }
    comments.push({ id: comment.id, from: comment.from, to: comment.to, track: typeof comment.track === "string" ? comment.track : undefined, text: comment.text })
  }
  const edits = (Array.isArray(raw.edits) ? raw.edits : []).filter((line): line is string => typeof line === "string")
  if (errors.length > 0) return { ok: false, error: errors.join("; ") }
  return { ok: true, value: { status: status ?? "new", note: typeof raw.note === "string" ? raw.note : "", comments, edits } }
}

export const encodeReview = (review: Review): string => JSON.stringify({ version: 1, ...review }, null, 2) + "\n"

// ---------------------------------------------------------------------------
// What changed between two versions of a song, in words

const noteKey = (note: Note): string => `${note.at}|${note.pitch}|${note.length}|${note.velocity}`

const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`

const span = (song: Song, notes: ReadonlyArray<Note>): string => barsOf(song, Math.min(...notes.map((note) => note.at)), Math.max(...notes.map((note) => note.at + note.length)))

const trackEdits = (song: Song, before: Track, after: Track): Array<string> => {
  const lines: Array<string> = []
  const name = after.name
  if (before.name !== after.name) lines.push(`Renamed the track ${before.name} to ${after.name}.`)
  if (before.instrument !== after.instrument) lines.push(`${name}: changed the instrument from ${instruments[before.instrument].label} to ${instruments[after.instrument].label}.`)
  if (Math.abs(before.volume - after.volume) > 0.005) lines.push(`${name}: volume ${before.volume.toFixed(2)} → ${after.volume.toFixed(2)}.`)
  if (Math.abs(before.pan - after.pan) > 0.005) lines.push(`${name}: pan ${before.pan.toFixed(2)} → ${after.pan.toFixed(2)}.`)
  if (Math.abs(before.reverb - after.reverb) > 0.005) lines.push(`${name}: reverb ${before.reverb.toFixed(2)} → ${after.reverb.toFixed(2)}.`)
  if ((before.mute === true) !== (after.mute === true)) lines.push(`${name}: ${after.mute === true ? "muted" : "unmuted"}.`)
  const was = new Map<string, number>()
  for (const note of before.notes) was.set(noteKey(note), (was.get(noteKey(note)) ?? 0) + 1)
  const added: Array<Note> = []
  for (const note of after.notes) {
    const left = was.get(noteKey(note)) ?? 0
    if (left > 0) was.set(noteKey(note), left - 1)
    else added.push(note)
  }
  const now = new Map<string, number>()
  for (const note of after.notes) now.set(noteKey(note), (now.get(noteKey(note)) ?? 0) + 1)
  const removed: Array<Note> = []
  for (const note of before.notes) {
    const left = now.get(noteKey(note)) ?? 0
    if (left > 0) now.set(noteKey(note), left - 1)
    else removed.push(note)
  }
  if (added.length > 0 && removed.length > 0) lines.push(`${name}: rewrote notes in ${span(song, [...added, ...removed])} (${count(added.length, "note")} in, ${count(removed.length, "note")} out).`)
  else if (added.length > 0) lines.push(`${name}: added ${count(added.length, "note")} in ${span(song, added)}.`)
  else if (removed.length > 0) lines.push(`${name}: removed ${count(removed.length, "note")} in ${span(song, removed)}.`)
  return lines
}

/** The person's edits, a line each, from the song the agent wrote (`before`) to the song now (`after`). */
export const describeEdits = (before: Song, after: Song): Array<string> => {
  const lines: Array<string> = []
  if (before.tempo !== after.tempo) lines.push(`Tempo ${before.tempo} → ${after.tempo} BPM.`)
  if (before.key !== after.key) lines.push(`Key ${before.key} → ${after.key}.`)
  if (before.bars !== after.bars) lines.push(`Bars ${before.bars} → ${after.bars}.`)
  if (before.beatsPerBar !== after.beatsPerBar) lines.push(`Beats per bar ${before.beatsPerBar} → ${after.beatsPerBar}.`)
  if (Math.abs(before.master - after.master) > 0.005) lines.push(`Master volume ${before.master.toFixed(2)} → ${after.master.toFixed(2)}.`)
  if (before.loop !== after.loop) lines.push(after.loop ? "Made it loop." : "Made it play once (no loop).")
  if (before.compressor !== after.compressor) lines.push(after.compressor ? "Turned the compressor on." : "Turned the compressor off.")
  // Tracks are matched by position: renaming one is an edit of it, not a new track.
  const shared = Math.min(before.tracks.length, after.tracks.length)
  for (let i = 0; i < shared; i++) lines.push(...trackEdits(after, before.tracks[i]!, after.tracks[i]!))
  for (const track of after.tracks.slice(shared)) lines.push(`Added a track: ${track.name} (${instruments[track.instrument].label}, ${count(track.notes.length, "note")}).`)
  for (const track of before.tracks.slice(shared)) lines.push(`Removed the track ${track.name}.`)
  if (JSON.stringify(before.reference) !== JSON.stringify(after.reference)) lines.push(after.reference === undefined ? "Removed the reference." : `Recorded a new reference: ${after.reference.tempo} BPM, ${after.reference.key}, ${count(after.reference.notes.length, "note")}.`)
  return lines
}

/** What `music notes` prints: the status, the note, comments in song order with their bars, and the edits. */
export const reviewSummary = (song: Song, review: Review) => ({
  status: review.status,
  note: review.note,
  comments: [...review.comments]
    .sort((a, b) => a.from - b.from)
    .map((comment) => ({ where: `${barsOf(song, comment.from, comment.to)}${comment.track === undefined ? "" : `, ${comment.track}`}`, from: comment.from, to: comment.to, track: comment.track, text: comment.text })),
  edits: review.edits,
  next:
    review.status === "approved"
      ? "The person approved the song. Render it (`music render`) for the game."
      : review.comments.length === 0 && review.edits.length === 0 && review.note === ""
        ? "Nothing said yet. Wait for the person, or ask them to listen."
        : "Act on each comment in its bars; keep the person's edits (they are already in the song). Then `music check` and tell the person what changed."
})
