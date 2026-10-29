/**
 * The music lab's review page, served by `ritmo-tools music review <song>` (`main.ts`)
 * and shown on the website with an example song kept in the tab (`demo.ts`):
 * the person plays the song, records a hum as its reference, edits notes on
 * a grid, swaps instruments, and comments on bars. Every change is saved to
 * the song and its review as it happens, for the agent to read back
 * (`ritmo-tools music notes`); a song the agent rewrites while the page is
 * open shows up in it.
 *
 * Built from the pixel fixer's kit, so the tools look and work alike.
 */
import { badge, button, cliChip, callout, group, hint, icon, mark, numberInput, prop, section, segmented, selectInput, sliderRow, switchRow, textInput } from "../../pixel/ui/kit.ts"
import { h, replace } from "../../pixel/ui/dom.ts"
import { makeHistory } from "../../pixel/ui/history.ts"
import { monoWav, stereoWav } from "../core/audio.ts"
import { checkSong, type SongReport } from "../core/check.ts"
import { instrumentIds, instruments, type InstrumentId } from "../core/instruments.ts"
import { isSparse, listen, referenceOf } from "../core/listen.ts"
import { toMidi } from "../core/midi.ts"
import { noteSamples, renderSong, SAMPLE_RATE, type NoteCache, type Stereo } from "../core/render.ts"
import { decodeReview, describeEdits, emptyReview, encodeReview, type Comment, type Status } from "../core/review.ts"
import { barsOf, decodeSong, encodeSong, lengthInBeats, lengthInSeconds, parseKey, scaleNames, secondsPerBeat, type Note, type Scale, type Song, type Track } from "../core/song.ts"
import { arrangementHeight, attachArrangement, attachGrid, drawArrangement, drawGrid, GUTTER, type View } from "./grid.ts"
import { makePlayer } from "./player.ts"
import { canRecord, monoOf, startRecording, type Recording } from "./record.ts"
import { SERVER_GONE, type Session, type Store } from "./store.ts"

const RITMO_URL = "https://ritmo.typeonce.dev/"

/** Where the song, its review, and its audio are read and written: set once by `start`. */
let store!: Store

// ---------------------------------------------------------------------------
// State

const emptySong: Song = { tempo: 100, key: "C major", beatsPerBar: 4, bars: 4, loop: true, master: 0.8, compressor: false, tracks: [] }

const state = {
  songFile: "",
  name: "",
  song: emptySong,
  /** The song as the agent last wrote it: the person's edits are told against it. */
  baseline: emptySong,
  review: emptyReview,
  track: 0,
  chosen: undefined as number | undefined,
  selection: undefined as { from: number; to: number } | undefined,
  /** Seconds into the song where Play starts when stopped: where Pause left it, or where a click on the bar numbers put it. */
  cue: undefined as number | undefined,
  snap: 0.25,
  zoom: 1,
  showReference: true,
  withHum: false,
  solo: new Set<number>(),
  draft: "",
  draftTrack: "all" as string,
  recording: undefined as Recording | undefined,
  recordStart: 0,
  listening: false,
  message: "",
  saving: "saved" as "saved" | "saving" | "failed",
  version: "",
  loaded: false
}

const cache: NoteCache = new Map()
const track = (): Track | undefined => state.song.tracks[state.track]
const heard = (): Array<number> => {
  const all = state.song.tracks.map((_, i) => i)
  return state.solo.size > 0 ? all.filter((i) => state.solo.has(i)) : all.filter((i) => state.song.tracks[i]!.mute !== true)
}

// ---------------------------------------------------------------------------
// Saving: the song and the review go back to their files as they change

let songDirty = false
let reviewDirty = false
let saveTimer: ReturnType<typeof setTimeout> | undefined

const put = async (file: "song" | "review", text: string): Promise<void> => {
  state.version = await store.save(file, text)
}

const flush = async (): Promise<void> => {
  saveTimer = undefined
  try {
    if (songDirty) {
      songDirty = false
      await put("song", encodeSong(state.song))
    }
    if (reviewDirty) {
      reviewDirty = false
      await put("review", encodeReview(state.review))
    }
    state.saving = songDirty || reviewDirty ? "saving" : "saved"
  } catch (error) {
    state.saving = "failed"
    say(`Not saved: ${error instanceof Error ? error.message : String(error)}`)
  }
  renderTopbar()
}

const save = (what: { readonly song?: boolean; readonly review?: boolean }): void => {
  if (what.song === true) {
    songDirty = true
    // The edits the agent will read: everything the person changed since the agent's version.
    state.review = { ...state.review, edits: describeEdits(state.baseline, state.song) }
    reviewDirty = true
  }
  if (what.review === true) reviewDirty = true
  state.saving = "saving"
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flush(), 400)
}

const history = makeHistory(
  () => `${encodeSong(state.song)}\u0000${encodeReview(state.review)}`,
  (snapshot) => {
    const [songText = "", reviewText = ""] = snapshot.split("\u0000")
    const song = decodeSong(songText)
    const review = decodeReview(reviewText)
    if (song.ok) state.song = song.value
    if (review.ok) state.review = review.value
    state.chosen = undefined
    save({ song: true, review: true })
    songChanged()
  },
  () => renderTopbar()
)

/** Records a change to the song: undoable, saved, heard, and drawn. */
const changed = (): void => {
  save({ song: true })
  history.schedule()
  songChanged()
}

const reviewChanged = (): void => {
  save({ review: true })
  history.schedule()
  update()
}

const setSong = (song: Song): void => {
  state.song = song
}

const setTrack = (index: number, next: Track): void => {
  setSong({ ...state.song, tracks: state.song.tracks.map((entry, i) => (i === index ? next : entry)) })
}

// ---------------------------------------------------------------------------
// Loading, and following changes the agent makes while the page is open

const adopt = (answer: Session, fresh: boolean): boolean => {
  const song = decodeSong(answer.songText)
  if (!song.ok) {
    say(`The song has problems: ${song.error}`)
    return false
  }
  const review = answer.reviewText === null ? undefined : decodeReview(answer.reviewText)
  const agentWrote = fresh || encodeSong(song.value) !== encodeSong(state.song)
  state.song = song.value
  state.review = review?.ok === true ? review.value : emptyReview
  if (agentWrote) {
    // A new version from the agent: what the person edits from here is told against it.
    state.baseline = song.value
    if (!fresh && state.review.edits.length > 0) {
      state.review = { ...state.review, edits: [] }
      save({ review: true })
    }
  }
  state.songFile = answer.song
  state.name = answer.name
  state.version = answer.version
  if (state.track >= state.song.tracks.length) state.track = 0
  return agentWrote
}

const load = async (): Promise<void> => {
  const answer = await store.session()
  if (answer === undefined) return say("The server sent no song.")
  if (!adopt(answer, true)) return
  history.reset()
  history.schedule()
  state.loaded = true
  void loadHum()
  songChanged()
}

const follow = async (): Promise<void> => {
  if (saveTimer !== undefined || state.saving === "saving" || state.recording !== undefined) return
  try {
    const version = await store.version()
    if (version === undefined || version === state.version) return
    const session = await store.session()
    if (session === undefined) return
    const before = state.song.reference?.audio
    if (adopt(session, false)) {
      say("The agent changed the song.")
      history.schedule()
      if (state.song.reference?.audio !== before) void loadHum()
      songChanged()
    } else update()
  } catch {
    // The CLI was stopped; the page keeps what it has.
  }
}


// ---------------------------------------------------------------------------
// Playing

let mix: Stereo | undefined
let mixKey = ""
let hum: AudioBuffer | undefined

const player = makePlayer(() => drawPlayhead())

const currentMix = (): Stereo => {
  const key = JSON.stringify([encodeSong(state.song), heard()])
  if (mix === undefined || key !== mixKey) {
    mix = renderSong(state.song, { tracks: heard(), cache })
    mixKey = key
  }
  return mix
}

const play = (at?: number): void => {
  const reference = state.song.reference
  const humAlone = player.playingAlone()
  player.play(currentMix(), { loop: state.song.loop, at, extra: state.withHum ? hum : undefined, extraAt: (reference?.start ?? 0) - (reference?.offset ?? 0) * secondsPerBeat(state.song) })
  if (humAlone) renderList()
  renderTransport()
}

const startOf = (): number => (state.selection === undefined ? 0 : state.selection.from * secondsPerBeat(state.song))

/** Play from the cue, or Pause where the song is (which leaves the cue there). */
const toggle = (): void => {
  const position = player.position()
  if (position !== undefined) {
    state.cue = position
    player.stop()
  } else {
    play(state.cue ?? startOf())
    state.cue = undefined
  }
  draw()
  renderTransport()
}

/** Stop: back to the start (of the picked bars, when bars are picked). */
const stop = (): void => {
  state.cue = undefined
  player.stop()
  draw()
  renderTransport()
}

/** After an edit while playing: the new song, from where it was. */
let replayTimer: ReturnType<typeof setTimeout> | undefined
const replay = (): void => {
  if (player.position() === undefined) return
  if (replayTimer !== undefined) clearTimeout(replayTimer)
  replayTimer = setTimeout(() => {
    replayTimer = undefined
    if (player.position() !== undefined) play()
  }, 120)
}

const audition = (instrument: InstrumentId, pitch: string, velocity: number): void => {
  const samples = noteSamples(instrument, { pitch, velocity }, instruments[instrument].kind === "drums" ? 0.2 : 0.45, SAMPLE_RATE, cache)
  const level = (state.song.tracks[state.track]?.volume ?? 0.8) * state.song.master
  player.audition(samples.map((x) => x * level), SAMPLE_RATE)
}

const loadHum = async (): Promise<void> => {
  hum = undefined
  const audio = state.song.reference?.audio
  if (audio === undefined) return
  try {
    const bytes = await store.readAudio(audio)
    if (bytes !== undefined) hum = await player.decode(bytes)
  } catch {
    hum = undefined
  }
  renderList()
  renderPanels()
}

/** Plays the hum alone, or stops it when it already plays. */
const playHum = (): void => {
  if (player.playingAlone()) player.stop()
  else if (hum !== undefined) player.playAlone(hum, renderList)
  renderList()
  renderTransport()
}

const download = (bytes: Uint8Array<ArrayBuffer>, file: string, type: string): void => {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const link = h("a", { attrs: { href: url, download: file } })
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const baseName = (): string => state.name.replace(/\.json$/, "").replace(/\.song$/, "") || "song"

// ---------------------------------------------------------------------------
// Checking: the numbers `music check` gives the agent, kept fresh as the song changes

let report: SongReport | undefined
let checkTimer: ReturnType<typeof setTimeout> | undefined
const recheck = (): void => {
  if (checkTimer !== undefined) clearTimeout(checkTimer)
  checkTimer = setTimeout(() => {
    checkTimer = undefined
    report = checkSong(state.song, cache)
    renderPanels()
    renderHead()
  }, 500)
}

// ---------------------------------------------------------------------------
// Recording a hum, or reading an audio file, into the reference

const hear = async (bytes: ArrayBuffer, label: string): Promise<void> => {
  state.listening = true
  update()
  try {
    const buffer = await player.decode(bytes.slice(0))
    const samples = monoOf(buffer)
    // Let the page draw "Listening…" before the work.
    await new Promise((done) => setTimeout(done, 30))
    const audio = `${baseName()}.song.reference.wav`
    const heardNow = listen(samples, buffer.sampleRate, { audio })
    const reference = referenceOf(heardNow)
    // Nothing heard at all (no tune, no beat): the reference the song had stays.
    if (heardNow.notes.length === 0 && heardNow.found.tempoConfidence === 0) {
      say(`Heard no clear notes or beat in the ${label}. Try humming louder and closer, one note at a time.`)
    } else {
      await store.writeAudio(audio, monoWav(samples, buffer.sampleRate))
      hum = buffer
      const empty = state.song.tracks.every((entry) => entry.notes.length === 0)
      // A song with nothing in it yet takes the hum's tempo, key, and length.
      setSong(
        empty
          ? { ...state.song, tempo: heardNow.tempo, key: heardNow.key, bars: Math.max(4, Math.ceil(heardNow.length / (4 * state.song.beatsPerBar)) * 4), reference }
          : { ...state.song, reference }
      )
      state.showReference = true
      changed()
      say(
        heardNow.notes.length === 0
          ? `Heard a beat at ${heardNow.tempo} BPM, and no tune. Ask your agent to build the song on that beat.`
          : isSparse(heardNow)
            ? `Heard only ${heardNow.notes.length} notes in ${Math.round(heardNow.found.seconds)} seconds: the listener follows one voice, so a full song or a noisy room loses the tune. Hum the part alone, close to the microphone.`
            : `Heard ${heardNow.notes.length} notes at ${heardNow.tempo} BPM in ${heardNow.key}. Ask your agent to build the song around it.`
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // The listening happens here in the page; only keeping the audio needs the server.
    say(message === SERVER_GONE ? `Heard the ${label}, but could not keep it: ${message}.` : `Could not listen to the ${label}: ${message}`)
  }
  state.listening = false
  update()
}

let meterFrame: number | undefined
const meter = (): void => {
  meterFrame = undefined
  if (state.recording === undefined) return
  const bar = document.querySelector<HTMLElement>(".record-level span")
  if (bar !== null) bar.style.width = `${Math.round(state.recording.level() * 100)}%`
  const time = document.querySelector<HTMLElement>(".record-time")
  if (time !== null) time.textContent = clock((performance.now() - state.recordStart) / 1000)
  meterFrame = requestAnimationFrame(meter)
}

const record = async (): Promise<void> => {
  if (state.recording !== undefined) {
    const recording = state.recording
    state.recording = undefined
    if (meterFrame !== undefined) cancelAnimationFrame(meterFrame)
    update()
    await hear(await recording.stop(), "recording")
    return
  }
  if (!canRecord()) return say("Recording needs the page on localhost (or HTTPS). Open it there, or choose an audio file instead.")
  try {
    player.stop()
    state.recording = await startRecording(player.context())
    state.recordStart = performance.now()
    update()
    meter()
  } catch (error) {
    say(`The microphone is not available: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const fileInput = h("input", {
  props: { type: "file", accept: "audio/*,.wav,.mp3,.m4a,.ogg,.webm" },
  attrs: { hidden: true },
  on: {
    change: () => {
      const file = fileInput.files?.[0]
      if (file !== undefined) void file.arrayBuffer().then((bytes) => hear(bytes, file.name))
      fileInput.value = ""
    }
  }
})

// ---------------------------------------------------------------------------
// The page

const app = document.getElementById("app")!
const topbar = h("header", { class: "topbar" })
const list = h("aside", { class: "sounds tracks", attrs: { "aria-label": "Tracks" } })
const content = h("div", { class: "sound-view song-view" })
const transport = h("div", { class: "floating playback transport" })
const toast = h("div", { class: "toast", attrs: { role: "status", "aria-live": "polite" } })
const panels = h("aside", { class: "inspector", attrs: { "aria-label": "Settings" } })
const stage = h("div", { class: "stage" }, content, transport, toast)

app.append(topbar, h("main", { class: "layout lab" }, list, h("section", { class: "workspace" }, stage), panels), fileInput)

const head = h("div", { class: "sound-head" })
const arrangement = h("canvas", { class: "arrangement" })
const gridHead = h("div", { class: "grid-head" })
const grid = h("canvas", { class: "note-grid" })
const scroller = h("div", { class: "song-scroll" }, h("div", { class: "song-card" }, arrangement), gridHead, h("div", { class: "song-card grid-card" }, grid))
content.append(head, scroller)

const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`

const view = (): View => {
  const playing = player.position()
  const marker = playing ?? state.cue
  const available = Math.max(320, scroller.clientWidth - 2)
  const beat = Math.max(8, ((available - GUTTER - 8) / Math.max(1, lengthInBeats(state.song))) * state.zoom)
  return {
    song: state.song,
    track: state.track,
    beat,
    snap: state.snap,
    selection: state.selection,
    playhead: marker === undefined ? undefined : marker / secondsPerBeat(state.song),
    showReference: state.showReference,
    chosen: state.chosen,
    comments: state.review.comments,
    heard: heard()
  }
}

const draw = (): void => {
  const now = view()
  drawArrangement(arrangement, now)
  if (track() !== undefined) drawGrid(grid, now)
}

const drawPlayhead = (): void => {
  draw()
  renderTransport()
}

/** The song itself changed: re-hear it, re-check it, redraw everything. */
const songChanged = (): void => {
  mix = undefined
  recheck()
  replay()
  update()
}

const statusLabel: Record<Status, string> = { new: "To review", approved: "Approved", changes: "Changes asked" }

const renderTopbar = (): void => {
  const song = state.song
  replace(
    topbar,
    h(
      "div",
      { class: "topbar-start" },
      h(
        "div",
        { class: "brand" },
        mark(),
        h("span", {}, "Music lab"),
        h("a", { class: "by", title: "Ritmo, the agent-first type safe ECS runtime", attrs: { href: RITMO_URL, target: "_blank", rel: "noopener" } }, "by ", h("b", {}, "ritmo")),
        store.demo && cliChip("npx @typeonce/ritmo-tools music review theme.song.json", "Your coding agent can drive the music lab on your game's own songs: it hears your hum, arranges and checks the song, then opens this page for you to edit and comment.")
      ),
      state.loaded &&
        h(
          "div",
          { class: "file", title: state.songFile },
          h("span", { class: "file-name" }, state.name),
          h("span", { class: "file-meta" }, `${song.tempo} BPM · ${song.key} · ${song.bars} bars`)
        )
    ),
    h("div", { class: "topbar-center" }),
    h(
      "div",
      { class: "topbar-end" },
      h(
        "div",
        { class: "button-group" },
        button("Undo", () => history.undo(), { variant: "ghost", icon: "undo", iconOnly: true, disabled: !history.canUndo(), title: "Undo (Ctrl/Cmd+Z)" }),
        button("Redo", () => history.redo(), { variant: "ghost", icon: "redo", iconOnly: true, disabled: !history.canRedo(), title: "Redo (Ctrl/Cmd+Shift+Z)" })
      ),
      h("span", { class: "divider" }),
      h(
        "span",
        { class: `save-state ${state.saving}`, title: store.demo ? "A demo: changes stay in this tab" : "Changes are written to the song and its review as you make them" },
        state.saving === "saved" ? icon("check") : state.saving === "failed" ? icon("alert") : null,
        state.saving === "saved" ? (store.demo ? "Kept in this tab" : "Saved") : state.saving === "saving" ? "Saving…" : "Not saved"
      ),
      button("MIDI", () => download(new Uint8Array(toMidi(song)), `${baseName()}.mid`, "audio/midi"), { variant: "secondary", icon: "music", disabled: !state.loaded, title: "Download the notes as a MIDI file, for any music program" }),
      button("WAV", () => download(stereoWav(renderSong(song, { cache })), `${baseName()}.wav`, "audio/wav"), { variant: "primary", icon: "download", disabled: !state.loaded, title: "Download the song as a WAV file" })
    )
  )
}

const renderList = (): void => {
  const song = state.song
  const reference = song.reference
  const row = (options: { readonly on: boolean; readonly color: string; readonly name: string; readonly meta: string; readonly click: () => void; readonly extra?: ReadonlyArray<HTMLElement | false> }): HTMLElement =>
    h(
      "div",
      { class: `sound-row track-row${options.on ? " on" : ""}`, attrs: { role: "option", "aria-selected": String(options.on), tabindex: 0 }, on: { click: options.click } },
      h("span", { class: "lane-swatch", attrs: { style: `--color:${options.color}` } }),
      h("span", { class: "track-text" }, h("span", { class: "sound-name" }, options.name), h("span", { class: "track-meta" }, options.meta)),
      options.extra ?? []
    )
  const toggleButton = (label: string, on: boolean, title: string, click: () => void): HTMLElement =>
    h(
      "button",
      {
        class: `track-toggle${on ? " on" : ""}`,
        title,
        attrs: { type: "button", "aria-pressed": String(on) },
        on: {
          click: (event) => {
            event.stopPropagation()
            click()
          }
        }
      },
      label
    )
  replace(
    list,
    h(
      "div",
      { class: "sounds-head tracks-head" },
      h("h2", {}, "Reference"),
      state.recording !== undefined
        ? h(
            "div",
            { class: "recording" },
            h("span", { class: "record-dot" }),
            h("span", { class: "record-time" }, "0:00"),
            h("span", { class: "record-level" }, h("span", {})),
            button("Stop", () => void record(), { small: true, variant: "primary", icon: "stop" })
          )
        : h(
            "div",
            { class: "button-row" },
            button(state.listening ? "Listening…" : "Record a hum", () => void record(), { small: true, variant: reference === undefined ? "primary" : "secondary", icon: "mic", disabled: state.listening, title: "Hum, whistle, or sing the tune; the agent builds the song around it" }),
            button("Audio file", () => fileInput.click(), { small: true, variant: "ghost", icon: "open", disabled: state.listening, title: "A recording or a song to take the tune, tempo, and key from" })
          ),
      reference !== undefined &&
        row({
          on: player.playingAlone(),
          color: "#f3f1ec",
          name: "Hum",
          meta: `${reference.tempo} BPM · ${reference.key} · ${reference.notes.length} notes`,
          click: playHum,
          extra: [hum !== undefined && (player.playingAlone() ? toggleButton("■", true, "Stop the hum", playHum) : toggleButton("▶", false, "Play the hum alone", playHum))]
        })
    ),
    h(
      "div",
      { class: "sound-rows" },
      h("h2", { class: "rows-title" }, "Tracks"),
      song.tracks.length === 0 && h("p", { class: "hint empty-list" }, "No tracks yet. Record a hum and ask your agent for a song, or add a track."),
      song.tracks.map((entry, index) =>
        row({
          on: index === state.track,
          color: instruments[entry.instrument].color,
          name: entry.name,
          meta: `${instruments[entry.instrument].label} · ${entry.notes.length} notes`,
          click: () => pickTrack(index),
          extra: [
            toggleButton("M", entry.mute === true, "Mute this track (saved in the song)", () => {
              setTrack(index, { ...entry, mute: entry.mute === true ? undefined : true })
              changed()
            }),
            toggleButton("S", state.solo.has(index), "Hear only this track (and other soloed ones); not saved", () => {
              if (state.solo.has(index)) state.solo.delete(index)
              else state.solo.add(index)
              mix = undefined
              replay()
              update()
            })
          ]
        })
      ),
      button(
        "Add a track",
        () => {
          setSong({ ...state.song, tracks: [...state.song.tracks, { name: `Track ${state.song.tracks.length + 1}`, instrument: "piano", volume: 0.8, pan: 0, reverb: 0.2, notes: [] }] })
          state.track = state.song.tracks.length - 1
          changed()
        },
        { small: true, variant: "ghost", icon: "plus", class: "add-track" }
      )
    )
  )
}

const pickTrack = (index: number): void => {
  if (index === state.track) return
  state.track = index
  state.chosen = undefined
  update()
}

const pill = (text: string, tone = ""): HTMLElement => h("span", { class: `stage-pill ${tone}` }, text)

const renderHead = (): void => {
  const song = state.song
  const follows = report?.follows
  replace(
    head,
    h(
      "div",
      { class: "sound-title" },
      h("h1", {}, baseName()),
      pill(statusLabel[state.review.status], state.review.status),
      pill(`${song.tempo} BPM`),
      pill(song.key),
      pill(`${song.bars} bars · ${clock(lengthInSeconds(song))}`),
      song.loop && pill("Loops"),
      follows !== undefined && h("span", { class: `stage-pill ${follows.share >= 0.5 ? "approved" : "changes"}`, title: `${follows.track} plays this share of the hum's notes` }, `Follows the hum ${Math.round(follows.share * 100)}%`)
    ),
    song.about !== undefined && h("p", { class: "sound-about" }, song.about)
  )
}

const renderGridHead = (): void => {
  const current = track()
  if (current === undefined) {
    replace(gridHead)
    grid.hidden = true
    return
  }
  grid.hidden = false
  const drums = instruments[current.instrument].kind === "drums"
  replace(
    gridHead,
    h("span", { class: "lane-swatch", attrs: { style: `--color:${instruments[current.instrument].color}` } }),
    h("h2", {}, current.name),
    h("span", { class: "grid-meta" }, instruments[current.instrument].label),
    h("span", { class: "grid-hint" }, drums ? "Click to add a hit · drag to move · double-click to remove" : "Click to add a note · drag to move · drag its end to stretch · double-click to remove"),
    h("span", { class: "spacer" }),
    !drums && song().reference !== undefined && switchRow("Hum", state.showReference, (on) => {
      state.showReference = on
      draw()
    }, "Show the hum's notes and pitch line under this track"),
    segmented(
      String(state.snap),
      [
        { id: "0.25", label: "1/16", title: "Snap to sixteenth notes (a quarter beat)" },
        { id: "0.5", label: "1/8", title: "Snap to eighth notes (half a beat)" },
        { id: "1", label: "1/4", title: "Snap to beats" }
      ],
      (snap) => {
        state.snap = Number(snap)
        renderGridHead()
        draw()
      },
      { label: "Snap" }
    )
  )
}

const song = (): Song => state.song

const renderTransport = (): void => {
  const position = player.position()
  const playing = position !== undefined
  const beats = (position ?? state.cue ?? startOf()) / secondsPerBeat(state.song)
  const bar = Math.floor(beats / state.song.beatsPerBar) + 1
  const beat = Math.floor(beats % state.song.beatsPerBar) + 1
  const label = `${bar}.${beat} / ${state.song.bars}`
  const stopped = !playing && state.cue === undefined
  if (transport.dataset.label === label && transport.dataset.on === String(playing) && transport.dataset.stopped === String(stopped) && transport.dataset.hum === String(state.withHum)) return
  transport.dataset.label = label
  transport.dataset.on = String(playing)
  transport.dataset.stopped = String(stopped)
  transport.dataset.hum = String(state.withHum)
  replace(
    transport,
    button(playing ? "Pause" : "Play", toggle, { variant: "ghost", icon: playing ? "pause" : "play", iconOnly: true, title: playing ? "Pause (Space)" : state.cue === undefined ? "Play (Space)" : "Play from the marker (Space)" }),
    button("Stop", stop, { variant: "ghost", icon: "stop", iconOnly: true, disabled: stopped, title: "Stop and go back to the start" }),
    h("span", { class: "frame-counter", title: "Bar.beat / bars" }, label),
    h("span", { class: "divider" }),
    state.song.reference?.audio !== undefined &&
      button("With the hum", () => {
        state.withHum = !state.withHum
        if (playing) play()
        renderTransport()
      }, { variant: "ghost", icon: "mic", iconOnly: true, pressed: state.withHum, class: state.withHum ? "on" : "", title: state.withHum ? "Playing the hum with the song" : "Play the hum with the song, lined up" }),
    button("Zoom out", () => {
      state.zoom = Math.max(1, state.zoom / 1.5)
      draw()
    }, { variant: "ghost", icon: "minus", iconOnly: true }),
    button("Zoom in", () => {
      state.zoom = Math.min(8, state.zoom * 1.5)
      draw()
    }, { variant: "ghost", icon: "plus", iconOnly: true })
  )
}

const renderStage = (): void => {
  if (!state.loaded) {
    replace(head, h("div", { class: "empty-card lab-empty" }, h("div", { class: "empty-icon" }, mark()), h("h2", {}, "Opening the song…")))
    return
  }
  renderHead()
  renderGridHead()
  arrangement.style.height = `${arrangementHeight(state.song)}px`
  draw()
}

// ---------------------------------------------------------------------------
// The inspector

const statusOptions: ReadonlyArray<{ readonly id: Status; readonly label: string; readonly icon: "sparkle" | "check" | "alert"; readonly title: string }> = [
  { id: "new", label: "To review", icon: "sparkle", title: "Not reviewed yet" },
  { id: "approved", label: "Approved", icon: "check", title: "It sounds right" },
  { id: "changes", label: "Changes", icon: "alert", title: "Ask the agent for changes: say what in the note and the comments" }
]

const reviewPanel = (): HTMLElement =>
  section(
    {
      id: "music-review",
      title: "Review",
      help: "Approve the song, or ask for changes in your own words (\"calmer\", \"more like the hum at the end\"). Comments on bars say where. The agent reads it all with `ritmo-tools music notes`, with a list of what you edited by hand.",
      onToggle: update
    },
    segmented(state.review.status, statusOptions, (status) => {
      state.review = { ...state.review, status }
      reviewChanged()
    }, { label: "Status", class: "fill" }),
    h(
      "label",
      { class: "input note" },
      h("textarea", {
        props: { value: state.review.note, rows: 3 },
        attrs: { placeholder: "A note on the whole song (optional)", "aria-label": "Note" },
        on: {
          input: (event) => {
            const target = event.currentTarget
            if (!(target instanceof HTMLTextAreaElement)) return
            state.review = { ...state.review, note: target.value }
            save({ review: true })
            history.schedule()
            renderTopbar()
          }
        }
      })
    ),
    state.review.edits.length > 0 && group("Your edits", h("ul", { class: "edits" }, state.review.edits.map((line) => h("li", {}, line))))
  )

const commentsPanel = (): HTMLElement => {
  const selection = state.selection
  const where = selection === undefined ? undefined : barsOf(state.song, selection.from, selection.to)
  const add = (): void => {
    if (selection === undefined || state.draft.trim() === "") return
    const comment: Comment = { id: `c${Date.now().toString(36)}`, from: selection.from, to: selection.to, track: state.draftTrack === "all" ? undefined : state.draftTrack, text: state.draft.trim() }
    state.review = { ...state.review, comments: [...state.review.comments, comment] }
    state.draft = ""
    reviewChanged()
  }
  return section(
    {
      id: "music-comments",
      title: "Comments",
      help: "Drag across the bar numbers to pick bars, then say what should change there. Comments are pinned to those bars (and a track, if you choose one).",
      onToggle: update,
      action: h("span", { class: "meta" }, String(state.review.comments.length))
    },
    selection === undefined
      ? hint("Drag across the bar numbers above the tracks to pick bars to comment on.")
      : group(
          `On ${where}`,
          prop(
            "Track",
            selectInput(state.draftTrack, [{ id: "all", label: "Every track" }, ...state.song.tracks.map((entry) => ({ id: entry.name, label: entry.name }))], (value) => {
              state.draftTrack = value
            }, "Track")
          ),
          h(
            "label",
            { class: "input note" },
            h("textarea", {
              props: { value: state.draft, rows: 2 },
              attrs: { placeholder: "What should change here?", "aria-label": "Comment" },
              on: {
                input: (event) => {
                  const target = event.currentTarget
                  if (target instanceof HTMLTextAreaElement) state.draft = target.value
                },
                keydown: (event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) add()
                }
              }
            })
          ),
          h(
            "div",
            { class: "button-row" },
            button("Add comment", add, { small: true, variant: "primary", icon: "comment" }),
            button("Clear bars", () => {
              state.selection = undefined
              state.cue = undefined
              update()
            }, { small: true, variant: "ghost" })
          )
        ),
    state.review.comments.length > 0 &&
      h(
        "ul",
        { class: "comments" },
        [...state.review.comments]
          .sort((a, b) => a.from - b.from)
          .map((comment) =>
            h(
              "li",
              {
                on: {
                  click: () => {
                    state.selection = { from: comment.from, to: comment.to }
                    state.cue = undefined
                    update()
                  }
                }
              },
              h("span", { class: "comment-where" }, `${barsOf(state.song, comment.from, comment.to)}${comment.track === undefined ? "" : ` · ${comment.track}`}`),
              h("span", { class: "comment-text" }, comment.text),
              button("Remove", () => {
                state.review = { ...state.review, comments: state.review.comments.filter((entry) => entry.id !== comment.id) }
                reviewChanged()
              }, { variant: "ghost", icon: "trash", iconOnly: true, small: true })
            )
          )
      )
  )
}

const songPanel = (): HTMLElement => {
  const song = state.song
  const key = parseKey(song.key)
  const tonic = song.key.split(" ")[0] ?? "C"
  const tonicOptions = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
  return section(
    { id: "music-song", title: "Song", help: "The whole song: how fast (beats per minute), its key (which notes sound at home), and how long. A looping song repeats without a seam in the game.", onToggle: update },
    prop("Tempo", numberInput(song.tempo, (tempo) => {
      setSong({ ...song, tempo })
      changed()
    }, { min: 30, max: 300, step: 1, label: "Tempo", suffix: "BPM" })),
    prop(
      "Key",
      h(
        "div",
        { class: "key-picker" },
        selectInput(tonicOptions.includes(tonic) ? tonic : "C", tonicOptions.map((id) => ({ id, label: id })), (value) => {
          setSong({ ...song, key: `${value} ${key?.scale ?? "major"}` })
          changed()
        }, "Key note"),
        selectInput<Scale>(key?.scale ?? "major", scaleNames.map((id) => ({ id, label: id })), (scale) => {
          setSong({ ...song, key: `${tonic} ${scale}` })
          changed()
        }, "Scale")
      )
    ),
    prop("Bars", numberInput(song.bars, (bars) => {
      setSong({ ...song, bars: Math.max(1, Math.round(bars)) })
      changed()
    }, { min: 1, max: 256, step: 1, label: "Bars" })),
    switchRow("Loop", song.loop, (loop) => {
      setSong({ ...song, loop })
      changed()
    }, "Game music mostly loops: the end wraps into the start without a seam"),
    switchRow("Compressor", song.compressor, (compressor) => {
      setSong({ ...song, compressor })
      changed()
    }, "Squeezes the whole mix louder and punchier, its peaks held under -1 dBFS: for rock, drum & bass, and electronic songs"),
    sliderRow("Master", song.master, { min: 0, max: 1.5, step: 0.01 }, (v) => `${Math.round(v * 100)}%`, (master) => {
      setSong({ ...state.song, master })
    }, () => changed(), "The volume over the whole song")
  )
}

const trackPanel = (): HTMLElement | false => {
  const current = track()
  if (current === undefined) return false
  const index = state.track
  const edit = (next: Track, commit = true): void => {
    setTrack(index, next)
    if (commit) changed()
  }
  return section(
    { id: "music-track", title: "Track", help: "The chosen track: its instrument (try another: the notes stay), how loud it is, where it sits left to right, and how much room echo it has.", onToggle: update, action: h("span", { class: "meta" }, `${current.notes.length} notes`) },
    prop("Name", textInput(current.name, (name) => edit({ ...current, name: name.trim() === "" ? current.name : name.trim() }), { label: "Track name" })),
    prop(
      "Instrument",
      selectInput<InstrumentId>(current.instrument, instrumentIds.map((id) => ({ id, label: instruments[id].label })), (instrument) => {
        const fromDrums = instruments[current.instrument].kind !== instruments[instrument].kind
        if (fromDrums) return say("Drums and pitched instruments use different notes: add a new track for this one.")
        edit({ ...current, instrument })
      }, "Instrument")
    ),
    hint(instruments[current.instrument].about),
    sliderRow("Volume", current.volume, { min: 0, max: 1.5, step: 0.01 }, (v) => `${Math.round(v * 100)}%`, (volume) => edit({ ...current, volume }, false), () => changed()),
    sliderRow("Pan", current.pan, { min: -1, max: 1, step: 0.05 }, (v) => (Math.abs(v) < 0.025 ? "centre" : v < 0 ? `L ${Math.round(-v * 100)}` : `R ${Math.round(v * 100)}`), (pan) => edit({ ...current, pan }, false), () => changed()),
    sliderRow("Room", current.reverb, { min: 0, max: 1, step: 0.01 }, (v) => `${Math.round(v * 100)}%`, (reverb) => edit({ ...current, reverb }, false), () => changed(), "How much of the track goes to the room's echo"),
    state.chosen !== undefined &&
      current.notes[state.chosen] !== undefined &&
      group(
        `Note ${current.notes[state.chosen]!.pitch}`,
        sliderRow("Strength", current.notes[state.chosen]!.velocity, { min: 0.05, max: 1, step: 0.05 }, (v) => `${Math.round(v * 100)}%`, (velocity) => {
          const chosen = state.chosen
          if (chosen === undefined) return
          edit({ ...current, notes: current.notes.map((note, i) => (i === chosen ? { ...note, velocity } : note)) }, false)
          draw()
        }, () => changed(), "How hard the note is played")
      ),
    h(
      "div",
      { class: "button-row" },
      button("Remove track", () => {
        setSong({ ...state.song, tracks: state.song.tracks.filter((_, i) => i !== index) })
        state.track = Math.max(0, index - 1)
        state.solo.clear()
        changed()
      }, { small: true, variant: "danger", icon: "trash" })
    )
  )
}

const referencePanel = (): HTMLElement => {
  const reference = state.song.reference
  return section(
    {
      id: "music-reference",
      title: "Reference",
      help: "A hum, a whistle, a tapped beat, or a recorded tune. The tool listens to it for its tempo, key, and melody, so the agent can build the song around it. Hum one note at a time, close to the microphone.",
      onToggle: update,
      closed: reference === undefined ? false : true
    },
    reference === undefined
      ? [hint("No reference yet. Record a hum (top left) or choose an audio file; the tool hears its tempo, key, and tune.")]
      : [
          prop("Tempo", h("span", { class: "value" }, `${reference.tempo} BPM`)),
          prop("Key", h("span", { class: "value" }, reference.key)),
          prop("Notes", h("span", { class: "value" }, `${reference.notes.length} · ${barsOf(state.song, 0, reference.length)}`)),
          reference.tempo !== state.song.tempo &&
            callout(
              "warn",
              `The song is at ${state.song.tempo} BPM and the hum at ${reference.tempo}: they will not line up. `,
              button(`Use ${reference.tempo} BPM`, () => {
                setSong({ ...state.song, tempo: reference.tempo })
                changed()
              }, { small: true, variant: "secondary" })
            ),
          h(
            "div",
            { class: "button-row" },
            button("Play the hum", playHum, { small: true, variant: "secondary", icon: "play", disabled: hum === undefined }),
            button("Remove", () => {
              setSong({ ...state.song, reference: undefined })
              hum = undefined
              changed()
            }, { small: true, variant: "ghost", icon: "trash" })
          )
        ]
  )
}

const checkPanel = (): HTMLElement => {
  const errors = report?.issues.filter((issue) => issue.severity === "error") ?? []
  return section(
    {
      id: "music-check",
      title: "Check",
      help: "What can be measured without listening: the same numbers `ritmo-tools music check` gives the agent.",
      onToggle: update,
      closed: true,
      action: report === undefined ? undefined : badge(errors.length > 0 ? "Errors" : report.issues.length > 0 ? "Warnings" : "Clean", errors.length > 0 ? "bad" : report.issues.length > 0 ? "warn" : "good")
    },
    report === undefined
      ? hint("Measuring…")
      : [
          prop("Loudness", h("span", { class: "value" }, `${report.loudness} dBFS`), "Over the whole song: about -18 to -24 sits well under sound effects"),
          prop("Peak", h("span", { class: "value" }, `${report.peak} dBFS`), "The loudest sample: above 0 clips"),
          report.issues.length === 0
            ? callout("good", "Nothing to fix.")
            : h("ul", { class: "issues" }, report.issues.map((issue) => h("li", { class: issue.severity }, icon("alert"), h("span", {}, issue.track === undefined ? issue.message : `${issue.track}: ${issue.message}`))))
        ]
  )
}

const aboutPanel = (): HTMLElement =>
  h(
    "footer",
    { class: "about" },
    h("div", { class: "ruler", attrs: { "aria-hidden": "true" } }),
    h("div", { class: "about-head" }, mark(), "Music lab, by Ritmo"),
    h(
      "p",
      {},
      "Game music as JSON songs. Agents listen, write, and check them from the command line: ",
      h("code", {}, "ritmo-tools music listen"),
      ", ",
      h("code", {}, "ritmo-tools music check"),
      ", ",
      h("code", {}, "ritmo-tools music notes"),
      ". What you edit, record, and say here is saved to ",
      h("code", {}, state.name),
      " and its review.",
      store.demo && [" This demo keeps it in the tab. To open your own song: ", h("code", {}, "npx @typeonce/ritmo-tools music review theme.song.json"), "."]
    )
  )

const renderPanels = (): void => {
  const scroll = panels.scrollTop
  replace(panels, state.loaded && [reviewPanel(), commentsPanel(), trackPanel(), songPanel(), referencePanel(), checkPanel()], aboutPanel())
  panels.scrollTop = scroll
}

// ---------------------------------------------------------------------------
// Editing on the canvases

const handlers = {
  view,
  add: (note: Note): number => {
    const current = track()
    if (current === undefined) return -1
    setTrack(state.track, { ...current, notes: [...current.notes, note] })
    state.chosen = current.notes.length
    mix = undefined
    draw()
    return current.notes.length
  },
  move: (index: number, note: Note, commit: boolean): void => {
    const current = track()
    if (current === undefined) return
    setTrack(state.track, { ...current, notes: current.notes.map((entry, i) => (i === index ? note : entry)) })
    state.chosen = index
    if (commit) changed()
    else draw()
  },
  remove: (index: number): void => {
    const current = track()
    if (current === undefined) return
    setTrack(state.track, { ...current, notes: current.notes.filter((_, i) => i !== index) })
    state.chosen = undefined
    changed()
  },
  choose: (index: number | undefined): void => {
    state.chosen = index
    renderPanels()
    draw()
  },
  audition: (pitch: string, velocity: number): void => {
    const current = track()
    if (current !== undefined) audition(current.instrument, pitch, velocity)
  },
  seek: (beat: number): void => {
    state.selection = undefined
    // On a beat, so the music starts where a beat does.
    const at = Math.floor(beat) * secondsPerBeat(state.song)
    if (player.position() !== undefined) play(at)
    else {
      state.cue = at
      update()
    }
  },
  region: (from: number, to: number): void => {
    state.selection = { from, to }
    state.cue = undefined
    draw()
    renderPanels()
    renderTransport()
  }
}

attachGrid(grid, handlers)
attachArrangement(arrangement, {
  ...handlers,
  pickTrack,
  // While the song plays, picking a track does not move the music.
  cue: (beat) => {
    if (player.position() !== undefined) return
    state.cue = Math.floor(beat) * secondsPerBeat(state.song)
    update()
  }
})

// ---------------------------------------------------------------------------
// Messages

let toastTimer: ReturnType<typeof setTimeout> | undefined

function say(message: string): void {
  state.message = message
  if (toastTimer !== undefined) clearTimeout(toastTimer)
  replace(toast, h("span", {}, message), button("Dismiss", () => toast.classList.remove("on"), { variant: "ghost", icon: "close", iconOnly: true, small: true }))
  toast.classList.add("on")
  toastTimer = setTimeout(() => toast.classList.remove("on"), 6000)
}

function update(): void {
  renderTopbar()
  renderList()
  renderStage()
  renderTransport()
  renderPanels()
}

// Space plays; Delete removes the chosen note; Ctrl/Cmd+Z undoes.
window.addEventListener("keydown", (event) => {
  const target = event.target
  if (target instanceof HTMLInputElement && target.type !== "range" && target.type !== "checkbox") return
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
  const mod = event.metaKey || event.ctrlKey
  if (mod && event.key.toLowerCase() === "z") {
    event.preventDefault()
    if (event.shiftKey) history.redo()
    else history.undo()
  } else if (mod && event.key.toLowerCase() === "y") {
    event.preventDefault()
    history.redo()
  } else if (event.key === " ") {
    event.preventDefault()
    toggle()
  } else if ((event.key === "Delete" || event.key === "Backspace") && state.chosen !== undefined) {
    event.preventDefault()
    handlers.remove(state.chosen)
  } else if (event.key === "Escape") {
    state.chosen = undefined
    state.selection = undefined
    state.cue = undefined
    update()
  }
})

window.addEventListener("resize", () => draw())

// Dropping an audio file anywhere on the stage makes it the reference.
stage.addEventListener("dragover", (event) => {
  event.preventDefault()
  stage.classList.add("dropping")
})
stage.addEventListener("dragleave", () => stage.classList.remove("dropping"))
stage.addEventListener("drop", (event) => {
  event.preventDefault()
  stage.classList.remove("dropping")
  const file = event.dataTransfer?.files[0]
  if (file !== undefined) void file.arrayBuffer().then((bytes) => hear(bytes, file.name))
})

/** Draws the page and loads the song from where `chosen` keeps it; follows the agent's changes when it can make them. */
export const start = (chosen: Store): void => {
  store = chosen
  update()
  void load()
  if (store.follows) setInterval(() => void follow(), 1500)
}
