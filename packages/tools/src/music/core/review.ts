/**
 * The review: what the person said about a song, kept next to it
 * (`theme.song.json` → `theme.song.review.json`) for the agent to read with
 * `music notes`. The song's status (new, approved, changes asked), a note
 * on the whole, comments pinned to a few bars (and a track), and a summary
 * of the edits the person made by hand since the agent last wrote the song.
 *
 * Edits land in the song itself as they are made; the summary is there so
 * the agent knows what the person changed and keeps it. Once a song is
 * approved, the review also keeps what they heard, so a later change to it
 * shows.
 *
 * A plain audio file (music not written as a song) has no notes to edit, and
 * often sits in a folder that ships with the game, so its review is not kept
 * beside it: all of them live in one `music.review.json`, by path, at the
 * game's root.
 */
import { hashText } from "../../internal/hash.ts"
import { approvedSaid, goneSaid, isUnrecorded, statuses, UNRECORDED_NEXT, type Status } from "../../internal/review.ts"
import { instruments } from "./instruments.ts"
import { barsOf, encodeSong, type Decoded, type Note, type Song, type Track } from "./song.ts"

export interface Comment {
  readonly id: string
  /** The span it is about, in beats. */
  readonly from: number
  readonly to: number
  /** The track it is about, by name; none for every track. */
  readonly track?: string | undefined
  readonly text: string
}

/** What the person heard when they approved a song: a hash of what the whole song shares, and of each track in order. */
export interface Approved {
  readonly song: string
  readonly tracks: ReadonlyArray<string>
}

export interface Review {
  readonly status: Status
  readonly note: string
  readonly comments: ReadonlyArray<Comment>
  /** What the person changed by hand since the agent last wrote the song, a line each. */
  readonly edits: ReadonlyArray<string>
  readonly approved?: Approved | undefined
}

export const emptyReview: Review = { status: "new", note: "", comments: [], edits: [] }

/** Where a song's review lives. */
export const reviewPath = (songPath: string): string => (songPath.endsWith(".json") ? songPath.slice(0, -".json".length) : songPath) + ".review.json"

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`

const isStrings = (value: unknown): value is ReadonlyArray<string> => Array.isArray(value) && value.every((entry) => typeof entry === "string")

/**
 * The song as it reads from its file, split into what is heard: not its
 * `about`, its reference, its key's name, or a track's name. Read back from
 * the encoded song, so an edit the file rounds away is no change.
 */
const heardOf = (song: Song): Approved => {
  const { tempo, beatsPerBar, bars, loop, master, compressor, tracks }: { readonly tempo: unknown; readonly beatsPerBar: unknown; readonly bars: unknown; readonly loop: unknown; readonly master: unknown; readonly compressor: unknown; readonly tracks: ReadonlyArray<Record<string, unknown>> } = JSON.parse(encodeSong(song))
  return {
    song: hashText(JSON.stringify([tempo, beatsPerBar, bars, loop, master, compressor])),
    tracks: tracks.map(({ name: _name, ...track }) => hashText(JSON.stringify(track)))
  }
}

/** What to keep when the person approves a song, as it sounds now. */
export const approvalOf = (song: Song): Approved => heardOf(song)

/** What is different from what the person approved, in a few words; `undefined` when nothing is. */
export const changedSince = (approved: Approved, song: Song): string | undefined => {
  const now = heardOf(song)
  const parts: Array<string> = []
  if (now.song !== approved.song) parts.push("its tempo, length, loop, or master changed")
  if (now.tracks.length !== approved.tracks.length) parts.push(`${count(now.tracks.length, "track")}, ${approved.tracks.length} when approved`)
  else {
    const tracks = song.tracks.filter((_, index) => now.tracks[index] !== approved.tracks[index]).map((track) => track.name)
    if (tracks.length > 0) parts.push(`${tracks.join(", ")} changed`)
  }
  return parts.length === 0 ? undefined : parts.join("; ")
}

/** What changed since the person approved this song, when they did and something has. */
export const changedOf = (review: Review, song: Song): string | undefined =>
  review.status === "approved" && review.approved !== undefined ? changedSince(review.approved, song) : undefined

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
  const approved = isRecord(raw.approved) && typeof raw.approved.song === "string" && isStrings(raw.approved.tracks) ? { song: raw.approved.song, tracks: raw.approved.tracks } : undefined
  if (raw.approved !== undefined && approved === undefined) errors.push('approved must be {"song", "tracks": ["hash", ...]}')
  if (errors.length > 0) return { ok: false, error: errors.join("; ") }
  return { ok: true, value: { status: status ?? "new", note: typeof raw.note === "string" ? raw.note : "", comments, edits, ...(approved === undefined ? {} : { approved }) } }
}

export const encodeReview = (review: Review): string => JSON.stringify({ version: 1, ...review }, null, 2) + "\n"

// ---------------------------------------------------------------------------
// What changed between two versions of a song, in words

const noteKey = (note: Note): string => `${note.at}|${note.pitch}|${note.length}|${note.velocity}`

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

/** What `music notes` prints for a song: the status, the note, comments in song order with their bars, the edits, and what changed since it was approved. */
export const reviewSummary = (song: Song, review: Review) => {
  const changed = changedOf(review, song)
  return {
    status: review.status,
    note: review.note,
    comments: [...review.comments]
      .sort((a, b) => a.from - b.from)
      .map((comment) => ({ where: `${barsOf(song, comment.from, comment.to)}${comment.track === undefined ? "" : `, ${comment.track}`}`, from: comment.from, to: comment.to, track: comment.track, text: comment.text })),
    edits: review.edits,
    changedSinceApproved: changed,
    ...(isUnrecorded(review.status, review.approved) ? { unrecorded: true as const } : {}),
    next:
      changed !== undefined
        ? "The song changed since the person approved it. Tell them what changed and ask them to listen again; only they approve it."
        : isUnrecorded(review.status, review.approved)
          ? UNRECORDED_NEXT
          : review.status === "approved"
          ? "The person approved the song. Render it (`music render`) for the game."
          : review.comments.length === 0 && review.edits.length === 0 && review.note === ""
            ? "Nothing said yet. Wait for the person, or ask them to listen."
            : "Act on each comment in its bars; keep the person's edits (they are already in the song). Then `music check` and tell the person what changed."
  }
}

// ---------------------------------------------------------------------------
// Plain audio files

/** The file every plain audio file's review lives in, at the game's root. */
export const AUDIO_REVIEWS = "music.review.json"

export interface AudioComment {
  readonly id: string
  /** The span it is about, in seconds. */
  readonly from: number
  readonly to: number
  readonly text: string
}

export interface AudioReview {
  readonly status: Status
  readonly note: string
  readonly comments: ReadonlyArray<AudioComment>
  /** A hash of the file the person approved. */
  readonly approved?: string | undefined
}

export const emptyAudioReview: AudioReview = { status: "new", note: "", comments: [] }

const audioReviewOf = (raw: unknown, where: string, errors: Array<string>): AudioReview | undefined => {
  if (!isRecord(raw)) {
    errors.push(`${where} must be {"status", "note", "comments"}`)
    return undefined
  }
  const status = statuses.find((entry) => entry === raw.status)
  if (raw.status !== undefined && status === undefined) errors.push(`${where}.status must be one of ${statuses.join(", ")}`)
  const comments: Array<AudioComment> = []
  for (const [i, comment] of (Array.isArray(raw.comments) ? raw.comments : []).entries()) {
    if (!isRecord(comment) || typeof comment.id !== "string" || typeof comment.text !== "string" || typeof comment.from !== "number" || typeof comment.to !== "number") {
      errors.push(`${where}.comments[${i}] must be {"id", "from", "to", "text"}`)
      continue
    }
    comments.push({ id: comment.id, from: comment.from, to: comment.to, text: comment.text })
  }
  if (raw.approved !== undefined && typeof raw.approved !== "string") errors.push(`${where}.approved must be a hash`)
  return { status: status ?? "new", note: typeof raw.note === "string" ? raw.note : "", comments, ...(typeof raw.approved === "string" ? { approved: raw.approved } : {}) }
}

const parsed = (text: string): Decoded<unknown> => {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: `not JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** One file's review, as the page saves it. */
export const decodeAudioReview = (text: string): Decoded<AudioReview> => {
  const raw = parsed(text)
  if (!raw.ok) return raw
  const errors: Array<string> = []
  const review = audioReviewOf(raw.value, "the review", errors)
  return review === undefined || errors.length > 0 ? { ok: false, error: errors.join("; ") } : { ok: true, value: review }
}

export const encodeAudioReview = (review: AudioReview): string => JSON.stringify(review)

/** `music.review.json`: each file's review, by its path from the folder it is in. */
export const decodeAudioReviews = (text: string): Decoded<Readonly<Record<string, AudioReview>>> => {
  const raw = parsed(text)
  if (!raw.ok) return raw
  if (!isRecord(raw.value) || !isRecord(raw.value.files)) return { ok: false, error: 'a review is {"version": 1, "files": {"path": {"status": ..., "note": ..., "comments": [...]}}}' }
  const errors: Array<string> = []
  const files: Record<string, AudioReview> = {}
  for (const [path, value] of Object.entries(raw.value.files)) {
    const review = audioReviewOf(value, path, errors)
    if (review !== undefined) files[path] = review
  }
  return errors.length > 0 ? { ok: false, error: errors.join("; ") } : { ok: true, value: files }
}

export const encodeAudioReviews = (files: Readonly<Record<string, AudioReview>>): string => JSON.stringify({ version: 1, files }, null, 2) + "\n"

/** What changed since the person approved this file, when they did and it has. */
export const audioChangedOf = (review: AudioReview, hash: string): string | undefined =>
  review.status === "approved" && review.approved !== undefined && review.approved !== hash ? "the file changed" : undefined

const seconds = (value: number): string => `${Math.floor(value / 60)}:${(value % 60).toFixed(1).padStart(4, "0")}`

/** What `music notes` prints for a plain audio file: the status, the note, comments in order with their times, and what changed since it was approved. */
export const audioReviewSummary = (review: AudioReview, hash: string) => {
  const changed = audioChangedOf(review, hash)
  return {
    status: review.status,
    note: review.note,
    comments: [...review.comments].sort((a, b) => a.from - b.from).map((comment) => ({ where: `${seconds(comment.from)} to ${seconds(comment.to)}`, from: comment.from, to: comment.to, text: comment.text })),
    changedSinceApproved: changed,
    ...(isUnrecorded(review.status, review.approved) ? { unrecorded: true as const } : {}),
    next:
      changed !== undefined
        ? "The file changed since the person approved it. Tell them what changed and ask them to listen again; only they approve it."
        : isUnrecorded(review.status, review.approved)
          ? UNRECORDED_NEXT
          : review.status === "approved"
          ? "The person approved the file. It is ready for the game."
          : review.comments.length === 0 && review.note === ""
            ? "Nothing said yet. Wait for the person, or ask them to listen."
            : "Act on the note and each comment where it points, and write the file again. Then tell the person what changed."
  }
}

// ---------------------------------------------------------------------------
// All the music at once

interface Summarized {
  readonly status: Status
  readonly changedSinceApproved?: string | undefined
  readonly unrecorded?: true | undefined
}

const urgency = (entry: Summarized): number => (entry.status === "changes" ? 0 : entry.changedSinceApproved !== undefined || entry.unrecorded === true ? 1 : entry.status === "new" ? 2 : 3)

/** What is left to do across the music, with the entries in the order to act on them: changes asked, changed since approved (or approved with no record), not reviewed yet, approved. `gone` counts the reviews whose music is no longer found. */
export const musicSummary = <A extends Summarized>(entries: ReadonlyArray<A>, gone = 0) => {
  const total = (status: Status): number => entries.filter((entry) => entry.status === status).length
  return {
    summary: `${approvedSaid(entries, "listen")}, ${total("changes")} with changes asked, ${total("new")} not reviewed yet (of ${entries.length}).${goneSaid(gone)}`,
    music: [...entries].sort((a, b) => urgency(a) - urgency(b))
  }
}
