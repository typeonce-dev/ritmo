/**
 * The song on the stage, drawn on canvases: the arrangement (every track as
 * a lane of small notes, under a ruler of bars) and the note grid of the
 * chosen track (pitches up the side, beats along the top), where notes are
 * placed, moved, stretched, and removed with a pointer or a finger.
 *
 * The grid knows nothing of saving or playing: it reports what the person
 * did through its callbacks, and the page changes the song.
 */
import { drums, instruments } from "../core/instruments.ts"
import { inKey, lengthInBeats, midiOf, nameOf, parseKey, type Note, type Song, type Track } from "../core/song.ts"
import type { Comment } from "../core/review.ts"

export interface View {
  readonly song: Song
  readonly track: number
  /** Pixels per beat. */
  readonly beat: number
  /** The grid notes snap to, in beats. */
  readonly snap: number
  readonly selection: { readonly from: number; readonly to: number } | undefined
  readonly playhead: number | undefined
  readonly showReference: boolean
  readonly chosen: number | undefined
  readonly comments: ReadonlyArray<Comment>
  /** Tracks heard now (mute and solo applied), by index. */
  readonly heard: ReadonlyArray<number>
}

export const GUTTER = 64
const RULER = 22
const LANE = 26
const REFERENCE_LANE = 30
const ROW = 13
const DRUM_ROW = 22

const ink = {
  text: "rgba(243, 241, 236, 0.55)",
  faint: "rgba(243, 241, 236, 0.06)",
  beat: "rgba(243, 241, 236, 0.07)",
  bar: "rgba(243, 241, 236, 0.2)",
  inKey: "rgba(243, 241, 236, 0.035)",
  selection: "rgba(255, 90, 54, 0.12)",
  selectionEdge: "rgba(255, 90, 54, 0.7)",
  playhead: "#ff5a36",
  reference: "rgba(243, 241, 236, 0.75)",
  comment: "#f0a843"
}

const setup = (canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | undefined => {
  const ratio = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
  }
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const context = canvas.getContext("2d")
  if (context === null) return undefined
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  return context
}

const widthOf = (view: View): number => GUTTER + lengthInBeats(view.song) * view.beat + 8

/** The ruler: bar numbers, beats, the selection, the comments' flags, and the playhead. */
const ruler = (context: CanvasRenderingContext2D, view: View, height: number): void => {
  const { song } = view
  const total = lengthInBeats(song)
  context.font = "600 10.5px JetBrains Mono, ui-monospace, monospace"
  context.textBaseline = "middle"
  for (let b = 0; b <= total; b++) {
    const x = GUTTER + b * view.beat
    const bar = b % song.beatsPerBar === 0
    context.fillStyle = bar ? ink.bar : ink.beat
    context.fillRect(Math.round(x), bar ? 0 : RULER - 6, 1, bar ? height : 6)
    if (bar && b < total) {
      context.fillStyle = ink.text
      context.fillText(String(b / song.beatsPerBar + 1), x + 5, RULER / 2)
    }
  }
  context.fillStyle = ink.bar
  context.fillRect(GUTTER, RULER - 1, total * view.beat, 1)
  for (const comment of view.comments) {
    const x = GUTTER + comment.from * view.beat
    context.fillStyle = ink.comment
    context.beginPath()
    context.moveTo(x, RULER - 1)
    context.lineTo(x, 3)
    context.lineTo(x + 8, 6.5)
    context.lineTo(x, 10)
    context.fill()
    context.fillRect(x, RULER - 3, Math.max(2, (comment.to - comment.from) * view.beat), 2)
  }
}

const overlay = (context: CanvasRenderingContext2D, view: View, height: number): void => {
  if (view.selection !== undefined) {
    const x = GUTTER + view.selection.from * view.beat
    const w = (view.selection.to - view.selection.from) * view.beat
    context.fillStyle = ink.selection
    context.fillRect(x, 0, w, height)
    context.fillStyle = ink.selectionEdge
    context.fillRect(x, 0, 1, height)
    context.fillRect(x + w - 1, 0, 1, height)
  }
  if (view.playhead !== undefined) {
    context.fillStyle = ink.playhead
    context.fillRect(Math.round(GUTTER + view.playhead * view.beat), 0, 2, height)
  }
}

const rounded = (context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void => {
  context.beginPath()
  context.roundRect(x, y, Math.max(1, w), h, Math.min(r, w / 2, h / 2))
}

// ---------------------------------------------------------------------------
// The arrangement

export const arrangementHeight = (song: Song): number => RULER + (song.reference === undefined ? 0 : REFERENCE_LANE) + song.tracks.length * LANE + 6

/** Which lane a point is in: the reference, a track, or the ruler. */
export const arrangementHit = (song: Song, y: number): { readonly kind: "ruler" } | { readonly kind: "reference" } | { readonly kind: "track"; readonly index: number } | undefined => {
  if (y < RULER) return { kind: "ruler" }
  let top = RULER
  if (song.reference !== undefined) {
    if (y < top + REFERENCE_LANE) return { kind: "reference" }
    top += REFERENCE_LANE
  }
  const index = Math.floor((y - top) / LANE)
  return index >= 0 && index < song.tracks.length ? { kind: "track", index } : undefined
}

/** A pitch line through a lane: the reference's contour, `low` to `high` MIDI mapped onto the lane. */
const contourLine = (context: CanvasRenderingContext2D, view: View, top: number, height: number, low: number, high: number, width: number): void => {
  const reference = view.song.reference
  if (reference === undefined) return
  context.strokeStyle = ink.reference
  context.lineWidth = width
  context.lineJoin = "round"
  context.lineCap = "round"
  context.beginPath()
  let drawing = false
  reference.contour.forEach((pitch, i) => {
    if (pitch <= 0) {
      drawing = false
      return
    }
    const x = GUTTER + (reference.offset + i * 0.125) * view.beat
    const y = top + height - ((pitch - low) / Math.max(1, high - low)) * height
    if (drawing) context.lineTo(x, y)
    else context.moveTo(x, y)
    drawing = true
  })
  context.stroke()
}

export const drawArrangement = (canvas: HTMLCanvasElement, view: View): void => {
  const { song } = view
  const width = widthOf(view)
  const height = arrangementHeight(song)
  const context = setup(canvas, width, height)
  if (context === undefined) return
  ruler(context, view, height)
  let top = RULER
  context.font = "500 11px Inter, system-ui, sans-serif"
  context.textBaseline = "middle"
  if (song.reference !== undefined) {
    const midis = song.reference.contour.filter((pitch) => pitch > 0)
    const low = Math.min(...midis, 60) - 1
    const high = Math.max(...midis, 60) + 1
    context.fillStyle = ink.faint
    context.fillRect(GUTTER, top + 2, lengthInBeats(song) * view.beat, REFERENCE_LANE - 4)
    contourLine(context, view, top + 5, REFERENCE_LANE - 10, low, high, 1.5)
    context.fillStyle = ink.text
    context.fillText("hum", 8, top + REFERENCE_LANE / 2)
    top += REFERENCE_LANE
  }
  song.tracks.forEach((track, index) => {
    const instrument = instruments[track.instrument]
    const chosen = index === view.track
    const heard = view.heard.includes(index)
    if (chosen) {
      context.fillStyle = "rgba(243, 241, 236, 0.07)"
      context.fillRect(0, top, width, LANE)
    }
    context.fillStyle = instrument.color
    context.fillRect(0, top + 4, 3, LANE - 8)
    context.fillStyle = chosen ? "#f3f1ec" : ink.text
    const label = track.name.length > 6 ? `${track.name.slice(0, 6)}…` : track.name
    context.fillText(label, 8, top + LANE / 2)
    const midis = track.notes.flatMap((note) => midiOf(note.pitch) ?? [])
    const low = Math.min(...midis)
    const high = Math.max(...midis)
    context.globalAlpha = heard ? 0.95 : 0.25
    context.fillStyle = instrument.color
    for (const note of track.notes) {
      const x = GUTTER + note.at * view.beat
      const w = Math.max(2, note.length * view.beat - 1)
      let y: number
      if (instrument.kind === "drums") {
        const row = drums.findIndex((drum) => drum.name === note.pitch)
        y = top + 3 + (row / Math.max(1, drums.length - 1)) * (LANE - 9)
      } else {
        const midi = midiOf(note.pitch) ?? low
        y = top + 3 + (high === low ? 0.5 : 1 - (midi - low) / (high - low)) * (LANE - 9)
      }
      context.fillRect(x, y, w, 3)
    }
    context.globalAlpha = 1
    top += LANE
  })
  overlay(context, view, height)
}

// ---------------------------------------------------------------------------
// The note grid

interface Rows {
  readonly drums: boolean
  readonly count: number
  readonly height: number
  /** The row a note sits on. */
  readonly rowOf: (pitch: string) => number
  /** The pitch on a row. */
  readonly pitchOf: (row: number) => string
  readonly label: (row: number) => string
}

/** The rows the grid shows: the drum kit's drums, or the instrument's range trimmed to around the notes in use. */
export const rowsOf = (song: Song, track: Track): Rows => {
  const instrument = instruments[track.instrument]
  if (instrument.kind === "drums") {
    return {
      drums: true,
      count: drums.length,
      height: DRUM_ROW,
      rowOf: (pitch) => drums.findIndex((drum) => drum.name === pitch),
      pitchOf: (row) => drums[Math.max(0, Math.min(drums.length - 1, row))]!.name,
      label: (row) => drums[row]?.label ?? ""
    }
  }
  const [low, high] = instrument.range
  const used = track.notes.flatMap((note) => midiOf(note.pitch) ?? [])
  const heard = song.reference?.notes.flatMap((note) => midiOf(note.pitch) ?? []) ?? []
  const all = [...used, ...heard]
  const middle = all.length === 0 ? Math.round((low + high) / 2 / 12) * 12 : Math.round((Math.min(...all) + Math.max(...all)) / 2)
  const top = Math.min(high, Math.max(...all, middle + 12) + 5)
  const bottom = Math.max(low, Math.min(...all, middle - 12) - 5)
  const count = top - bottom + 1
  return {
    drums: false,
    count,
    height: ROW,
    rowOf: (pitch) => top - (midiOf(pitch) ?? top),
    pitchOf: (row) => nameOf(top - Math.max(0, Math.min(count - 1, row))),
    label: (row) => nameOf(top - row)
  }
}

export const gridHeight = (song: Song, track: Track): number => {
  const rows = rowsOf(song, track)
  return RULER + rows.count * rows.height + 1
}

export const drawGrid = (canvas: HTMLCanvasElement, view: View): void => {
  const { song } = view
  const track = song.tracks[view.track]
  if (track === undefined) return
  const instrument = instruments[track.instrument]
  const rows = rowsOf(song, track)
  const width = widthOf(view)
  const height = RULER + rows.count * rows.height + 1
  const context = setup(canvas, width, height)
  if (context === undefined) return
  const total = lengthInBeats(song)
  const key = parseKey(song.key)
  // Rows: the key's notes a shade lighter, so in-key places are easy to see.
  for (let row = 0; row < rows.count; row++) {
    const y = RULER + row * rows.height
    const pitch = rows.pitchOf(row)
    const midi = midiOf(pitch)
    if (!rows.drums && key !== undefined && midi !== undefined && inKey(key, midi)) {
      context.fillStyle = ink.inKey
      context.fillRect(GUTTER, y, total * view.beat, rows.height)
    }
    if (rows.drums || (midi !== undefined && midi % 12 === 0)) {
      context.fillStyle = ink.beat
      context.fillRect(GUTTER, y + rows.height - 1, total * view.beat, 1)
    }
  }
  // Snap lines, faintly, under the beats and bars the ruler draws.
  if (view.snap < 1 && view.beat * view.snap >= 6) {
    context.fillStyle = "rgba(243, 241, 236, 0.025)"
    for (let b = 0; b < total; b += view.snap) context.fillRect(Math.round(GUTTER + b * view.beat), RULER, 1, height - RULER)
  }
  ruler(context, view, height)
  // The keys down the side.
  context.font = "500 10px JetBrains Mono, ui-monospace, monospace"
  context.textBaseline = "middle"
  for (let row = 0; row < rows.count; row++) {
    const y = RULER + row * rows.height
    const pitch = rows.pitchOf(row)
    const midi = midiOf(pitch)
    const black = midi !== undefined && [1, 3, 6, 8, 10].includes(midi % 12)
    context.fillStyle = rows.drums ? "#1d2026" : black ? "#14161a" : "#2a2e35"
    context.fillRect(0, y, GUTTER - 4, rows.height - 1)
    if (rows.drums || (midi !== undefined && (midi % 12 === 0 || (key !== undefined && midi % 12 === key.root)))) {
      context.fillStyle = rows.drums ? ink.text : midi !== undefined && key !== undefined && midi % 12 === key.root ? "#f3f1ec" : ink.text
      context.fillText(rows.label(row), 5, y + rows.height / 2)
    }
  }
  // The reference: its notes as outlines, its pitch line through them.
  if (!rows.drums && view.showReference && song.reference !== undefined) {
    const reference = song.reference
    context.strokeStyle = "rgba(243, 241, 236, 0.45)"
    context.setLineDash([3, 3])
    context.lineWidth = 1
    for (const heard of reference.notes) {
      const row = rows.rowOf(heard.pitch)
      if (row < 0 || row >= rows.count) continue
      rounded(context, GUTTER + (heard.at + reference.offset) * view.beat + 0.5, RULER + row * rows.height + 0.5, heard.length * view.beat - 1, rows.height - 1, 3)
      context.stroke()
    }
    context.setLineDash([])
    const topMidi = midiOf(rows.pitchOf(0)) ?? 0
    // The line through row centres: MIDI n sits at the middle of its row.
    contourLine(context, view, RULER + rows.height / 2, (rows.count - 1) * rows.height, topMidi - (rows.count - 1), topMidi, 1.25)
  }
  // The notes.
  track.notes.forEach((note, index) => {
    const row = rows.rowOf(note.pitch)
    if (row < 0 || row >= rows.count) return
    const x = GUTTER + note.at * view.beat
    const y = RULER + row * rows.height
    const w = note.length * view.beat
    const chosen = index === view.chosen
    context.globalAlpha = 0.45 + 0.55 * note.velocity
    context.fillStyle = instrument.color
    rounded(context, x + 0.5, y + 1, w - 1, rows.height - 2, 3)
    context.fill()
    context.globalAlpha = 1
    if (chosen) {
      context.strokeStyle = "#f3f1ec"
      context.lineWidth = 1.5
      rounded(context, x + 0.5, y + 1, w - 1, rows.height - 2, 3)
      context.stroke()
    }
    if (w > 34 && rows.height >= 13 && !rows.drums) {
      context.fillStyle = "rgba(14, 16, 19, 0.75)"
      context.font = "600 9.5px JetBrains Mono, ui-monospace, monospace"
      context.fillText(note.pitch, x + 4, y + rows.height / 2 + 0.5)
    }
  })
  overlay(context, view, height)
}

// ---------------------------------------------------------------------------
// Editing on the grid

export interface GridHandlers {
  readonly view: () => View
  /** A note placed; returns its index. */
  readonly add: (note: Note) => number
  /** A note changed while dragging: `commit` on release. */
  readonly move: (index: number, note: Note, commit: boolean) => void
  readonly remove: (index: number) => void
  readonly choose: (index: number | undefined) => void
  readonly audition: (pitch: string, velocity: number) => void
  readonly seek: (beat: number) => void
  readonly region: (from: number, to: number) => void
}

/** Where the pointer is on the grid, in beats and rows. */
const locate = (canvas: HTMLCanvasElement, event: PointerEvent | MouseEvent, view: View, rows: Rows) => {
  const box = canvas.getBoundingClientRect()
  const x = event.clientX - box.left
  const y = event.clientY - box.top
  return { x, y, beat: (x - GUTTER) / view.beat, row: Math.floor((y - RULER) / rows.height) }
}

/** The note on `row` under `beat`, the one drawn last (on top) first; -1 if none. */
const noteAt = (track: Track, rows: Rows, row: number, beat: number): number => {
  for (let i = track.notes.length - 1; i >= 0; i--) {
    const note = track.notes[i]!
    if (rows.rowOf(note.pitch) === row && note.at <= beat && beat < note.at + note.length) return i
  }
  return -1
}

const snapTo = (beat: number, snap: number): number => Math.round(beat / snap) * snap
const floorTo = (beat: number, snap: number): number => Math.floor(beat / snap + 1e-6) * snap

/** The ruler on either canvas: a click moves the playhead, a drag selects bars. */
const rulerDrag = (canvas: HTMLCanvasElement, event: PointerEvent, handlers: GridHandlers): void => {
  const view = handlers.view()
  const box = canvas.getBoundingClientRect()
  const beatAt = (clientX: number): number => Math.max(0, Math.min(lengthInBeats(view.song), (clientX - box.left - GUTTER) / view.beat))
  const from = beatAt(event.clientX)
  let moved = false
  const onMove = (move: PointerEvent): void => {
    const to = beatAt(move.clientX)
    if (Math.abs(to - from) * view.beat < 6 && !moved) return
    moved = true
    const bar = view.song.beatsPerBar
    // Selections are whole bars: comments are about bars.
    const a = Math.floor(Math.min(from, to) / bar) * bar
    const b = Math.ceil(Math.max(from, to) / bar) * bar
    handlers.region(a, Math.max(a + bar, b))
  }
  const onUp = (): void => {
    window.removeEventListener("pointermove", onMove)
    window.removeEventListener("pointerup", onUp)
    if (!moved) handlers.seek(from)
  }
  window.addEventListener("pointermove", onMove)
  window.addEventListener("pointerup", onUp)
}

export const attachArrangement = (canvas: HTMLCanvasElement, handlers: GridHandlers & { readonly pickTrack: (index: number) => void }): void => {
  canvas.addEventListener("pointerdown", (event) => {
    const view = handlers.view()
    const box = canvas.getBoundingClientRect()
    const hit = arrangementHit(view.song, event.clientY - box.top)
    if (hit?.kind === "ruler") rulerDrag(canvas, event, handlers)
    else if (hit?.kind === "track") handlers.pickTrack(hit.index)
    else if (hit?.kind === "reference") handlers.seek(Math.max(0, (event.clientX - box.left - GUTTER) / view.beat))
  })
}

export const attachGrid = (canvas: HTMLCanvasElement, handlers: GridHandlers): void => {
  canvas.addEventListener("contextmenu", (event) => event.preventDefault())
  canvas.addEventListener("pointerdown", (event) => {
    const view = handlers.view()
    const track = view.song.tracks[view.track]
    if (track === undefined) return
    const rows = rowsOf(view.song, track)
    const at = locate(canvas, event, view, rows)
    if (at.y < RULER) return rulerDrag(canvas, event, handlers)
    if (at.row < 0 || at.row >= rows.count) return
    if (at.x < GUTTER) return handlers.audition(rows.pitchOf(at.row), 0.8)
    event.preventDefault()
    const total = lengthInBeats(view.song)
    const index = noteAt(track, rows, at.row, at.beat)
    if (event.button === 2) {
      if (index >= 0) handlers.remove(index)
      return
    }
    let target = index
    let mode: "move" | "stretch" = "move"
    let grabbed = 0
    if (target >= 0) {
      const note = track.notes[target]!
      const right = GUTTER + (note.at + note.length) * view.beat
      mode = right - at.x < Math.min(8, (note.length * view.beat) / 3) ? "stretch" : "move"
      grabbed = at.beat - note.at
      handlers.choose(target)
    } else {
      // A new note, as long as the last one placed (or the snap), starting under the pointer.
      const length = rows.drums ? Math.max(view.snap, 0.25) : lastLength
      const start = Math.min(total - view.snap, floorTo(at.beat, view.snap))
      const note: Note = { at: Math.max(0, start), length: Math.min(length, total - start), pitch: rows.pitchOf(at.row), velocity: 0.8 }
      target = handlers.add(note)
      handlers.audition(note.pitch, note.velocity)
      mode = rows.drums ? "move" : "stretch"
      grabbed = 0
    }
    const original = handlers.view().song.tracks[view.track]?.notes[target]
    if (original === undefined) return
    let latest = original
    let moved = false
    canvas.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent): void => {
      const now = locate(canvas, move, view, rows)
      let next: Note
      if (mode === "stretch") {
        const end = Math.max(original.at + view.snap, snapTo(now.beat, view.snap))
        next = { ...original, length: Math.min(end, total) - original.at }
      } else {
        const start = Math.max(0, Math.min(total - original.length, snapTo(now.beat - grabbed, view.snap)))
        next = { ...original, at: start, pitch: rows.pitchOf(now.row) }
      }
      if (next.at === latest.at && next.length === latest.length && next.pitch === latest.pitch) return
      if (next.pitch !== latest.pitch) handlers.audition(next.pitch, next.velocity)
      moved = true
      latest = next
      handlers.move(target, next, false)
    }
    const onUp = (): void => {
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerup", onUp)
      canvas.removeEventListener("pointercancel", onUp)
      if (!rows.drums) lastLength = latest.length
      handlers.move(target, latest, true)
      if (!moved && index >= 0) handlers.audition(latest.pitch, latest.velocity)
    }
    canvas.addEventListener("pointermove", onMove)
    canvas.addEventListener("pointerup", onUp)
    canvas.addEventListener("pointercancel", onUp)
  })
  canvas.addEventListener("dblclick", (event) => {
    const view = handlers.view()
    const track = view.song.tracks[view.track]
    if (track === undefined) return
    const rows = rowsOf(view.song, track)
    const at = locate(canvas, event, view, rows)
    const index = noteAt(track, rows, at.row, at.beat)
    if (index >= 0) handlers.remove(index)
  })
}

/** The length of the last note placed or stretched, in beats: the next new note's length. */
let lastLength = 1
