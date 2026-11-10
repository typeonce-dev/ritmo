import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { monoWav, readWav, stereoWav } from "@typeonce/ritmo-tools/music/core/audio.ts"
import { checkSong } from "@typeonce/ritmo-tools/music/core/check.ts"
import { instrumentIds, instruments } from "@typeonce/ritmo-tools/music/core/instruments.ts"
import { isSparse, listen } from "@typeonce/ritmo-tools/music/core/listen.ts"
import { toMidi } from "@typeonce/ritmo-tools/music/core/midi.ts"
import { loudnessOf, peakOf, renderSong, SAMPLE_RATE } from "@typeonce/ritmo-tools/music/core/render.ts"
import { approvalOf, audioChangedOf, audioReviewSummary, changedSince, decodeAudioReview, decodeAudioReviews, decodeReview, describeEdits, emptyReview, encodeAudioReview, encodeAudioReviews, encodeReview, musicSummary, reviewPath, reviewSummary } from "@typeonce/ritmo-tools/music/core/review.ts"
import { decodeSong, encodeSong, inKey, midiOf, nameOf, parseKey, type Song } from "@typeonce/ritmo-tools/music/core/song.ts"
import { audioReviewPlace, findMusic, hashFile, libraryOf, readAudioReview, writeAudioReview } from "@typeonce/ritmo-tools/music/cli/library.ts"
import { api } from "@typeonce/ritmo-tools/music/cli/serve.ts"
import { textVersion } from "@typeonce/ritmo-tools/internal/save.ts"

const tune = ["A4", "C5", "E5", "D5", "C5", "A4", "G4", "A4"]

const song = (instrument: Song["tracks"][number]["instrument"] = "piano", notes = tune): Song => ({
  tempo: 100,
  key: "A minor",
  beatsPerBar: 4,
  bars: 2,
  loop: false,
  master: 0.8,
  compressor: false,
  tracks: [{ name: "Melody", instrument, volume: 0.8, pan: 0, reverb: 0, notes: notes.map((pitch, i) => ({ at: i, length: 0.9, pitch, velocity: 0.8 })) }]
})

/** A voice-like hum (a buzz through two resonances, slightly off pitch and time), as `music listen` would get from a microphone. */
/** `off` moves each note's pitch, in semitones, by its index: a voice off pitch, by more on some notes than others. */
const hum = (notes: ReadonlyArray<readonly [string, number]>, tempo: number, rate = 22050, off: (index: number) => number = () => 0): Float32Array => {
  const beat = 60 / tempo
  const total = notes.reduce((sum, [, beats]) => sum + beats, 0) * beat + 1
  const out = new Float32Array(Math.ceil(total * rate))
  let at = 0.4
  let phase = 0
  let low1 = 0
  let low2 = 0
  for (const [index, [pitch, beats]] of notes.entries()) {
    const length = beats * beat
    const midi = midiOf(pitch)
    if (midi !== undefined) {
      const held = length * 0.88
      for (let i = 0; i < held * rate; i++) {
        const t = i / rate
        const bend = 0.15 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t * 3) - 0.6 * Math.exp(-t / 0.03) + 0.2 + off(index)
        phase = (phase + 440 * Math.pow(2, (midi + bend - 69) / 12) / rate) % 1
        low1 += 0.08 * (2 * phase - 1 - low1)
        low2 += 0.08 * (low1 - low2)
        out[Math.round((at + t) * rate)]! += low2 * Math.min(1, t / 0.04) * Math.min(1, (held - t) / 0.05)
      }
    }
    at += length
  }
  return out
}

const example = fileURLToPath(new URL("../examples/village.song.json", import.meta.url))
const exampleAudio = fileURLToPath(new URL("../examples/village.song.reference.wav", import.meta.url))
const cli = fileURLToPath(new URL("../bin/ritmo-tools.mjs", import.meta.url))

describe("songs", () => {
  it("read pitches and keys", () => {
    expect(midiOf("C4")).toBe(60)
    expect(midiOf("A4")).toBe(69)
    expect(midiOf("Bb2")).toBe(46)
    expect(midiOf("H4")).toBeUndefined()
    expect(nameOf(61)).toBe("C#4")
    const key = parseKey("D minor")
    expect(key?.classes).toEqual([2, 4, 5, 7, 9, 10, 0])
    expect(key !== undefined && inKey(key, midiOf("F4")!)).toBe(true)
    expect(key !== undefined && inKey(key, midiOf("F#4")!)).toBe(false)
  })

  it("round-trip through their JSON", () => {
    const value = song()
    expect(decodeSong(encodeSong(value))).toEqual({ ok: true, value })
    const compressed = { ...song(), compressor: true }
    expect(decodeSong(encodeSong(compressed))).toEqual({ ok: true, value: compressed })
    expect(encodeSong(value)).not.toContain("compressor")
  })

  it("name every problem, with where it is", () => {
    const decoded = decodeSong(JSON.stringify({ tempo: 100, key: "A sad", bars: 2, tracks: [{ instrument: "kazoo", notes: [] }, { instrument: "drums", notes: [{ at: 0, length: 1, pitch: "C4" }] }] }))
    expect(decoded.ok).toBe(false)
    if (decoded.ok) return
    expect(decoded.error).toContain("key")
    expect(decoded.error).toContain("tracks[0].instrument")
    expect(decoded.error).toContain("tracks[1].notes[0].pitch")
    const compressor = decodeSong(JSON.stringify({ tempo: 100, key: "A minor", bars: 2, compressor: "yes", tracks: [] }))
    expect(!compressor.ok && compressor.error).toContain("compressor must be true or false")
  })

  it("keep the example valid", () => {
    expect(decodeSong(readFileSync(example, "utf8")).ok).toBe(true)
  })
})

describe("rendering", () => {
  it("is the same every time", () => {
    const a = renderSong(song("guitar"))
    const b = renderSong(song("guitar"))
    expect(a.left).toEqual(b.left)
  })

  it("makes a loop exactly one pass long", () => {
    const loop = renderSong({ ...song(), loop: true })
    expect(loop.left.length).toBe(Math.round(2 * 4 * (60 / 100) * SAMPLE_RATE))
  })

  it("plays every instrument in tune", () => {
    for (const id of instrumentIds) {
      const instrument = instruments[id]
      // Bells ring inharmonic overtones, and the pad's long swell and release overlap the next note: no one pitch to hear.
      if (instrument.kind === "drums" || id === "bells" || id === "pad") continue
      // The tune an octave down or up, into the instrument's range.
      const shift = instrument.range[0] > 57 ? 12 : instrument.range[0] > 45 ? 0 : -12
      const notes = tune.map((pitch) => nameOf(midiOf(pitch)! + shift))
      const heard = listen(renderSong(song(id, notes)).left, SAMPLE_RATE)
      expect(heard.notes.map((note) => note.pitch), id).toEqual(notes)
    }
  })

  it("plays every drum of every kit", () => {
    const names = ["kick", "snare", "hat", "openHat", "clap", "tomLow", "tomHigh", "crash", "rim", "shaker"]
    for (const kit of ["drums", "breaks"] as const) {
      for (const pitch of names) {
        const hit = renderSong({ ...song(), tracks: [{ name: "Drums", instrument: kit, volume: 0.8, pan: 0, reverb: 0, notes: [{ at: 0, length: 0.5, pitch, velocity: 0.9 }] }] })
        expect(peakOf(hit), `${kit} ${pitch}`).toBeGreaterThan(-30)
      }
    }
  })

  it("squeezes a compressed song louder, its peaks under -1 dBFS", () => {
    // The tune six times over, at the top of master: it clips without the compressor.
    const loud = { ...song("synthLead"), master: 2, tracks: Array.from({ length: 6 }, () => song("synthLead").tracks[0]!) }
    const plain = renderSong(loud)
    const squeezed = renderSong({ ...loud, compressor: true })
    expect(peakOf(plain)).toBeGreaterThan(0)
    expect(peakOf(squeezed)).toBeLessThanOrEqual(-1)
    expect(loudnessOf(renderSong({ ...song("synthLead"), compressor: true }))).toBeGreaterThan(loudnessOf(renderSong(song("synthLead"))))
  })

  it("leaves muted tracks out, unless asked for", () => {
    const muted: Song = { ...song(), tracks: [{ ...song().tracks[0]!, mute: true }] }
    expect(renderSong(muted).left.every((x) => x === 0)).toBe(true)
    expect(renderSong(muted, { tracks: [0] }).left.some((x) => x !== 0)).toBe(true)
  })
})

describe("listening", () => {
  const notes = [["D4", 1], ["F4", 0.5], ["A4", 0.5], ["G4", 1], ["F4", 1], ["E4", 0.5], ["F4", 0.5], ["D4", 2], ["-", 1], ["A3", 0.5], ["D4", 0.5], ["F4", 1], ["E4", 0.5], ["D4", 0.5], ["C4", 1], ["D4", 2]] as const

  it("hears a hum's tune, tempo, and key", () => {
    const heard = listen(hum(notes, 92), 22050)
    expect(Math.abs(heard.tempo - 92)).toBeLessThanOrEqual(2)
    expect(heard.key).toBe("D minor")
    expect(heard.notes.map((note) => note.pitch)).toEqual(notes.filter(([pitch]) => pitch !== "-").map(([pitch]) => pitch))
    expect(heard.notes.map((note) => note.at)).toEqual([0, 1, 1.5, 2, 3, 4, 4.5, 5, 8, 8.5, 9, 10, 10.5, 11, 12])
  })

  it("hears a voice that is off pitch the whole way in tune", () => {
    const tune = notes.filter(([pitch]) => pitch !== "-").map(([pitch]) => pitch)
    // The hum sits 18 cents sharp by itself: these put it 40 cents flat, then 40 sharp, each note 15 cents either side, so half the notes are nearer the next one.
    for (const center of [-0.58, 0.22]) {
      const heard = listen(hum(notes, 92, 22050, (index) => center + (index % 2 === 0 ? 0.15 : -0.15)), 22050)
      expect(heard.notes.map((note) => note.pitch), `${center}`).toEqual(tune)
      expect(Math.abs(heard.found.tuning - Math.round((center + 0.18) * 100)), `${center}`).toBeLessThanOrEqual(10)
      expect(heard.key).toBe("D minor")
    }
  })

  it("says when it heard too few notes to be one voice", () => {
    expect(isSparse(listen(hum(notes, 92), 22050))).toBe(false)
    // Three notes in twelve seconds: what a full song played in the room gives.
    expect(isSparse(listen(hum([["D4", 0.5], ["-", 7.5], ["A4", 0.5], ["-", 7.5], ["F4", 0.5], ["-", 7.5]], 120), 22050))).toBe(true)
  })

  it("takes a tempo it is given", () => {
    expect(listen(hum(notes, 92), 22050, { tempo: 90 }).tempo).toBe(90)
  })

  it("hears nothing in silence", () => {
    const heard = listen(new Float32Array(22050 * 2), 22050)
    expect(heard.notes).toEqual([])
    expect(heard.found.tempoConfidence).toBe(0)
  })
})

describe("checks", () => {
  it("call a clipping song an error, and say by how much", () => {
    const report = checkSong({ ...song(), master: 2, tracks: [{ ...song().tracks[0]!, volume: 1.5 }] })
    expect(report.verdict).toBe("errors")
    expect(report.issues.map((issue) => issue.rule)).toContain("clipping")
  })

  it("list notes outside the key and the instrument's range", () => {
    const report = checkSong(song("flute", ["A4", "F#4", "C2"]))
    const rules = report.issues.map((issue) => issue.rule)
    expect(rules).toContain("out-of-key")
    expect(rules).toContain("range")
  })

  it("say how closely the melody follows the reference", () => {
    const reference = { tempo: 100, key: "A minor", length: 8, notes: tune.map((pitch, i) => ({ at: i, length: 1, pitch })), contour: [], offset: 0, start: 0 }
    expect(checkSong({ ...song(), reference }).follows).toEqual({ track: "Melody", share: 1 })
    // An octave up still follows; another tune does not.
    expect(checkSong({ ...song("piano", tune.map((pitch) => nameOf(midiOf(pitch)! + 12))), reference }).follows?.share).toBe(1)
    const other = checkSong({ ...song("piano", ["B4", "B4", "B4", "B4", "B4", "B4", "B4", "B4"]), reference })
    expect(other.follows?.share).toBe(0)
    expect(other.issues.map((issue) => issue.rule)).toContain("off-reference")
  })
})

describe("files", () => {
  it("read back the WAV they write", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 0.25])
    const read = readWav(monoWav(samples, 8000))
    expect(read.ok && read.value.sampleRate).toBe(8000)
    expect(read.ok && Array.from(read.value.samples).map((x) => Math.round(x * 100) / 100)).toEqual([0, 0.5, -0.5, 0.25])
    const stereo = readWav(stereoWav({ sampleRate: 8000, left: new Float32Array([0.5]), right: new Float32Array([0]) }))
    expect(stereo.ok && Math.round(stereo.value.samples[0]! * 100) / 100).toBe(0.25)
    expect(readWav(new TextEncoder().encode("not audio")).ok).toBe(false)
  })

  it("write MIDI with a track per song track", () => {
    const bytes = toMidi({ ...song(), tracks: [...song().tracks, { name: "Drums", instrument: "drums", volume: 0.8, pan: 0, reverb: 0, notes: [{ at: 0, length: 0.5, pitch: "kick", velocity: 0.9 }] }] })
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("MThd")
    // The tempo and key track, then one per song track.
    expect((bytes[10]! << 8) | bytes[11]!).toBe(3)
    // The kick on channel 10 (9 from 0), General MIDI note 36.
    expect(Array.from(bytes).join(",")).toContain([0x99, 36].join(","))
  })
})

describe("reviews", () => {
  it("tell the person's edits in words", () => {
    const before = song()
    const after: Song = { ...before, tempo: 90, tracks: [{ ...before.tracks[0]!, instrument: "guitar", notes: [...before.tracks[0]!.notes.slice(1), { at: 6, length: 1, pitch: "E5", velocity: 0.8 }] }] }
    const lines = describeEdits(before, after)
    expect(lines).toContain("Tempo 100 → 90 BPM.")
    expect(lines).toContain("Melody: changed the instrument from Piano to Acoustic guitar.")
    expect(lines.some((line) => line.startsWith("Melody: rewrote notes in bars 1–2"))).toBe(true)
  })

  it("list comments in song order, with their bars", () => {
    const summary = reviewSummary(song(), {
      status: "changes",
      note: "",
      edits: [],
      comments: [
        { id: "b", from: 4, to: 8, text: "softer" },
        { id: "a", from: 0, to: 4, track: "Melody", text: "higher" }
      ]
    })
    expect(summary.comments.map((comment) => comment.where)).toEqual(["bar 1, Melody", "bar 2"])
  })

  it("keep what the person approved through a round trip", () => {
    const review = { ...emptyReview, status: "approved" as const, approved: approvalOf(song()) }
    expect(decodeReview(encodeReview(review))).toEqual({ ok: true, value: review })
    expect(decodeReview(JSON.stringify({ approved: { song: 1 } })).ok).toBe(false)
    expect(decodeReview(encodeReview(emptyReview))).toEqual({ ok: true, value: emptyReview })
  })

  it("see a change to what the person heard, and say where", () => {
    const approved = approvalOf(song())
    expect(changedSince(approved, song())).toBeUndefined()
    const melody = song().tracks[0]!
    expect(changedSince(approved, { ...song(), tracks: [{ ...melody, volume: 0.5 }] })).toBe("Melody changed")
    expect(changedSince(approved, { ...song(), tracks: [{ ...melody, notes: melody.notes.slice(1) }] })).toBe("Melody changed")
    expect(changedSince(approved, { ...song(), tempo: 90 })).toBe("its tempo, length, loop, or master changed")
    expect(changedSince(approved, { ...song(), tracks: [melody, melody] })).toBe("2 tracks, 1 when approved")
  })

  it("take no change from what is not heard, or what the file rounds away", () => {
    const approved = approvalOf(song())
    const melody = song().tracks[0]!
    expect(changedSince(approved, { ...song(), about: "Another line." })).toBeUndefined()
    expect(changedSince(approved, { ...song(), key: "C major" })).toBeUndefined()
    expect(changedSince(approved, { ...song(), tracks: [{ ...melody, name: "Lead" }] })).toBeUndefined()
    expect(changedSince(approved, { ...song(), reference: { tempo: 100, key: "A minor", length: 8, notes: [], contour: [], offset: 0, start: 0 } })).toBeUndefined()
    // A slider's value before and after the song is saved.
    expect(changedSince(approved, { ...song(), tracks: [{ ...melody, volume: 0.80000000001 }] })).toBeUndefined()
    // Notes in another order are the same notes.
    expect(changedSince(approved, { ...song(), tracks: [{ ...melody, notes: [...melody.notes].reverse() }] })).toBeUndefined()
  })

  it("tell the agent to ask again when an approved song changed, and leave an older approval alone", () => {
    const review = { ...emptyReview, status: "approved" as const, approved: approvalOf(song()) }
    expect(reviewSummary(song(), review).changedSinceApproved).toBeUndefined()
    expect(reviewSummary(song(), review).next).toContain("Render it")
    const changed = reviewSummary({ ...song(), tempo: 90 }, review)
    expect(changed.changedSinceApproved).toBe("its tempo, length, loop, or master changed")
    expect(changed.next).toContain("listen again")
    // Approved before approvals kept anything: nothing to compare with.
    expect(reviewSummary({ ...song(), tempo: 90 }, { ...emptyReview, status: "approved" }).changedSinceApproved).toBeUndefined()
    // Asked for changes: what they approved before does not count.
    expect(reviewSummary({ ...song(), tempo: 90 }, { ...review, status: "changes" }).changedSinceApproved).toBeUndefined()
  })

  it("of a plain audio file round-trip, and see the file change", () => {
    const review = { status: "approved" as const, note: "Good.", comments: [{ id: "a", from: 1.5, to: 3, text: "softer" }], approved: "abc" }
    expect(decodeAudioReview(encodeAudioReview(review))).toEqual({ ok: true, value: review })
    expect(decodeAudioReviews(encodeAudioReviews({ "public/day.flac": review }))).toEqual({ ok: true, value: { "public/day.flac": review } })
    expect(decodeAudioReviews("{}").ok).toBe(false)
    expect(decodeAudioReview(JSON.stringify({ comments: [{ id: "a" }] })).ok).toBe(false)
    expect(audioChangedOf(review, "abc")).toBeUndefined()
    expect(audioChangedOf(review, "def")).toBe("the file changed")
    expect(audioReviewSummary(review, "def").next).toContain("listen again")
    expect(audioReviewSummary(review, "abc").comments[0]?.where).toBe("0:01.5 to 0:03.0")
  })

  it("sum up all the music, the changes first", () => {
    const summary = musicSummary([
      { file: "a", status: "approved" as const },
      { file: "b", status: "new" as const },
      { file: "c", status: "approved" as const, changedSinceApproved: "Melody changed" },
      { file: "d", status: "changes" as const }
    ])
    expect(summary.summary).toBe("2 approved (1 changed since: ask the person to listen again), 1 with changes asked, 1 not reviewed yet (of 4).")
    expect(summary.music.map((entry) => entry.file)).toEqual(["d", "c", "b", "a"])
  })
})

describe("the library", () => {
  const game = (): string => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "music-")))
    writeFileSync(join(folder, "package.json"), "{}")
    for (const dir of ["assets/audio", "assets/audio/theme.song.stems", "public/music", "node_modules/some", ".cache"]) mkdirSync(join(folder, dir), { recursive: true })
    const write = (name: string, text: string): void => writeFileSync(join(folder, name), text)
    write("assets/audio/theme.song.json", encodeSong(song()))
    write("assets/audio/theme.song.review.json", encodeReview(emptyReview))
    write("assets/audio/theme.song.wav", "a render of the song above")
    write("assets/audio/theme.song.mid", "its notes")
    write("assets/audio/theme.song.reference.wav", "the hum it was built around")
    write("assets/audio/theme.song.stems/01-melody.wav", "a stem")
    write("assets/audio/other.json", "{}")
    write("public/music/day.flac", "bytes of the day")
    write("public/music/night.mp3", "bytes of the night")
    write("public/music/rendered.sha256", "not music")
    write("node_modules/some/tone.wav", "a dependency's")
    write(".cache/old.wav", "a cache's")
    return folder
  }
  const ids = async (folder: string, paths: ReadonlyArray<string>) => (await findMusic(paths.map((path) => join(folder, path)))).map((music) => relative(folder, music.file))

  it("finds songs and audio files in a folder, and leaves out what a tool wrote beside them", async () => {
    const folder = game()
    expect(await ids(folder, ["."])).toEqual(["assets/audio/theme.song.json", "public/music/day.flac", "public/music/night.mp3"])
  })

  it("takes a file named outright, whatever its name, once", async () => {
    const folder = game()
    expect(await ids(folder, ["assets/audio/other.json", "assets/audio/other.json", "assets/audio/theme.song.wav"])).toEqual(["assets/audio/other.json", "assets/audio/theme.song.wav"])
    expect((await findMusic([join(folder, "public/music/day.flac")]))[0]?.kind).toBe("audio")
    expect((await findMusic([join(folder, "assets/audio/other.json")]))[0]?.kind).toBe("song")
  })

  it("passes over a path that is gone", async () => {
    expect(await findMusic([join(game(), "nothing")])).toEqual([])
  })

  it("keeps a plain audio file's review out of a folder that ships, at the game's root", async () => {
    const folder = game()
    const file = join(folder, "public/music/day.flac")
    expect(audioReviewPlace(file)).toEqual({ reviews: join(folder, "music.review.json"), key: "public/music/day.flac" })
    const review = { status: "changes" as const, note: "Too busy.", comments: [] }
    await writeAudioReview(file, review)
    expect(await readAudioReview(file)).toEqual(review)
    expect(existsSync(join(folder, "public/music/music.review.json"))).toBe(false)
  })

  it("keeps every review when several are written at once", async () => {
    const folder = game()
    const review = { status: "changes" as const, note: "", comments: [] }
    await Promise.all(["day.flac", "night.mp3"].map((name, i) => writeAudioReview(join(folder, "public/music", name), { ...review, note: String(i) })))
    expect((await readAudioReview(join(folder, "public/music/day.flac"))).note).toBe("0")
    expect((await readAudioReview(join(folder, "public/music/night.mp3"))).note).toBe("1")
  })

  it("keeps a review beside the file when there is no game around it", () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "music-")))
    expect(audioReviewPlace(join(folder, "day.flac")).reviews).toBe(join(folder, "music.review.json"))
  })

  it("lists each entry's status, and what changed since it was approved", async () => {
    const folder = game()
    const songFile = join(folder, "assets/audio/theme.song.json")
    writeFileSync(reviewPath(songFile), encodeReview({ ...emptyReview, status: "approved", approved: approvalOf({ ...song(), tempo: 90 }) }))
    const flac = join(folder, "public/music/day.flac")
    await writeAudioReview(flac, { status: "approved", note: "", comments: [], approved: await hashFile(flac) })
    const entries = await libraryOf(await findMusic([folder]))
    expect(entries.map((entry) => [entry.name, entry.status, entry.changed])).toEqual([
      ["theme", "approved", "its tempo, length, loop, or master changed"],
      ["day.flac", "approved", undefined],
      ["night.mp3", "new", undefined]
    ])
    // The file changes, and the page's next look sees it.
    writeFileSync(flac, "bytes of another day")
    const later = await libraryOf(await findMusic([folder]))
    expect(later.find((entry) => entry.name === "day.flac")?.changed).toBe("the file changed")
  })

  it("lists a broken song with its problem, and goes on", async () => {
    const folder = game()
    writeFileSync(join(folder, "assets/audio/broken.song.json"), JSON.stringify({ tempo: 100, key: "C major", bars: 1, tracks: [{ instrument: "kazoo", notes: [] }] }))
    const entries = await libraryOf(await findMusic([folder]))
    expect(entries.find((entry) => entry.name === "broken")?.problem).toContain("tracks[0].instrument")
    expect(entries.find((entry) => entry.name === "theme")?.problem).toBeUndefined()
  })
})

describe("the review page's server", () => {
  const withServer = async (paths: ReadonlyArray<string>, run: (url: string) => Promise<void>): Promise<void> => {
    const server: Server = createServer((request, response) => void api(paths)(request, response))
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
    try {
      await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    } finally {
      server.close()
    }
  }
  const setup = (): { readonly folder: string; readonly songFile: string; readonly flac: string } => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "music-")))
    const songFile = join(folder, "theme.song.json")
    const flac = join(folder, "day.flac")
    writeFileSync(songFile, encodeSong(song()))
    writeFileSync(flac, "bytes of the day")
    writeFileSync(join(folder, "secret.txt"), "not music")
    return { folder, songFile, flac }
  }
  const idOf = (file: string): string => relative(process.cwd(), file)

  it("lists the music, and opens each by its id", async () => {
    const { folder, songFile, flac } = setup()
    await withServer([folder], async (url) => {
      const { entries } = (await (await fetch(`${url}/library`)).json()) as { entries: ReadonlyArray<{ id: string; kind: string }> }
      expect(entries.map((entry) => [entry.id, entry.kind])).toEqual([[idOf(flac), "audio"], [idOf(songFile), "song"]])
      const session = (await (await fetch(`${url}/session?id=${encodeURIComponent(idOf(songFile))}`)).json()) as { kind: string; songText: string; reviewText: null }
      expect(session).toMatchObject({ kind: "song", reviewText: null })
      expect(decodeSong(session.songText).ok).toBe(true)
      const audio = (await (await fetch(`${url}/session?id=${encodeURIComponent(idOf(flac))}`)).json()) as { kind: string; hash: string }
      expect(audio.kind).toBe("audio")
      expect(audio.hash).toBe(await hashFile(flac))
      expect(await (await fetch(`${url}/file?id=${encodeURIComponent(idOf(flac))}`)).text()).toBe("bytes of the day")
    })
  })

  it("serves nothing but the music it found", async () => {
    const { folder } = setup()
    await withServer([folder], async (url) => {
      for (const id of [idOf(join(folder, "secret.txt")), "../../etc/passwd", ""]) {
        expect((await fetch(`${url}/file?id=${encodeURIComponent(id)}`)).status, id).toBe(404)
        expect((await fetch(`${url}/session?id=${encodeURIComponent(id)}`)).status, id).toBe(404)
      }
    })
  })

  it("saves a song and its review beside it, and a plain file's review apart, each with a new version", async () => {
    const { folder, songFile, flac } = setup()
    await withServer([folder], async (url) => {
      const id = encodeURIComponent(idOf(songFile))
      const saved = await fetch(`${url}/song?id=${id}&base=${textVersion(readFileSync(songFile, "utf8"))}`, { method: "PUT", body: encodeSong({ ...song(), tempo: 90 }) })
      expect(saved.status).toBe(200)
      const songNow = decodeSong(readFileSync(songFile, "utf8"))
      expect(songNow.ok && songNow.value.tempo).toBe(90)
      const review = { ...emptyReview, status: "changes" as const, note: "Calmer." }
      const answer = (await (await fetch(`${url}/review?id=${id}&base=${textVersion(null)}`, { method: "PUT", body: encodeReview(review) })).json()) as { version: string }
      expect(decodeReview(readFileSync(reviewPath(songFile), "utf8"))).toEqual({ ok: true, value: review })
      const { entries } = (await (await fetch(`${url}/library`)).json()) as { entries: ReadonlyArray<{ id: string; version: string }> }
      // What the page keeps after a save is what the list shows, so the page does not read its own save as the agent's.
      expect(entries.find((entry) => entry.id === idOf(songFile))?.version).toBe(answer.version)
      const flacReview = { status: "approved" as const, note: "", comments: [], approved: await hashFile(flac) }
      const flacBase = textVersion(encodeAudioReview(await readAudioReview(flac)))
      expect((await fetch(`${url}/review?id=${encodeURIComponent(idOf(flac))}&base=${flacBase}`, { method: "PUT", body: encodeAudioReview(flacReview) })).status).toBe(200)
      expect(await readAudioReview(flac)).toEqual(flacReview)
      expect(existsSync(`${flac}.review.json`)).toBe(false)
    })
  })

  it("refuses a broken song and review, and writes nothing", async () => {
    const { folder, songFile } = setup()
    const before = readFileSync(songFile, "utf8")
    await withServer([folder], async (url) => {
      const id = encodeURIComponent(idOf(songFile))
      expect((await fetch(`${url}/song?id=${id}`, { method: "PUT", body: "{}" })).status).toBe(400)
      expect((await fetch(`${url}/review?id=${id}`, { method: "PUT", body: "not json" })).status).toBe(400)
      expect(readFileSync(songFile, "utf8")).toBe(before)
      expect(existsSync(reviewPath(songFile))).toBe(false)
    })
  })

  it("keeps a hum next to its song, by a plain name only", async () => {
    const { folder, songFile, flac } = setup()
    await withServer([folder], async (url) => {
      const id = encodeURIComponent(idOf(songFile))
      const hum = "RIFF\u0000\u0000\u0000\u0000WAVEhummm"
      expect((await fetch(`${url}/audio/theme.song.reference.wav?id=${id}`, { method: "PUT", body: hum })).status).toBe(200)
      expect(await (await fetch(`${url}/audio/theme.song.reference.wav?id=${id}`)).text()).toBe(hum)
      expect(readFileSync(join(folder, "theme.song.reference.wav"), "utf8")).toBe(hum)
      expect((await fetch(`${url}/audio/${encodeURIComponent("../theme.song.reference.wav")}?id=${id}`, { method: "PUT", body: hum })).status).toBe(400)
      // A plain audio file has no hum beside it.
      expect((await fetch(`${url}/audio/theme.song.reference.wav?id=${encodeURIComponent(idOf(flac))}`)).status).toBe(404)
    })
  })
})

describe("the command line", () => {
  const run = (...args: Array<string>) => spawnSync(process.execPath, [cli, "music", ...args], { encoding: "utf8" })

  it("makes a song from a hum, then checks and renders it", { timeout: 60_000 }, () => {
    const folder = mkdtempSync(join(tmpdir(), "music-"))
    const file = join(folder, "theme.song.json")
    const listened = run("listen", file, exampleAudio)
    expect(listened.status).toBe(0)
    const answer: unknown = JSON.parse(listened.stdout)
    expect(answer).toMatchObject({ created: true, heard: { key: "D minor" } })
    expect(existsSync(join(folder, "theme.song.reference.wav"))).toBe(true)
    // A song with no tracks is silent: an error until the agent writes some.
    expect(run("check", file).status).toBe(3)
    copyFileSync(example, file)
    expect(run("check", file).status).toBe(0)
    const rendered = run("render", file)
    expect(rendered.status).toBe(0)
    expect(existsSync(join(folder, "theme.song.wav"))).toBe(true)
    expect(existsSync(join(folder, "theme.song.mid"))).toBe(true)
  })

  it("reports a broken song with every problem", { timeout: 30_000 }, () => {
    const file = join(mkdtempSync(join(tmpdir(), "music-")), "broken.song.json")
    writeFileSync(file, JSON.stringify({ tempo: 100, key: "C major", bars: 1, tracks: [{ instrument: "kazoo", notes: [] }] }))
    const result = run("check", file)
    expect(result.status).toBe(2)
    expect(result.stdout).toContain("tracks[0].instrument")
  })

  it("reads back what the person said across a folder of music, the changes first", { timeout: 30_000 }, () => {
    const folder = mkdtempSync(join(tmpdir(), "music-"))
    const write = (name: string, value: Song, review: Parameters<typeof encodeReview>[0]): void => {
      writeFileSync(join(folder, `${name}.song.json`), encodeSong(value))
      writeFileSync(join(folder, `${name}.song.review.json`), encodeReview(review))
    }
    write("approved", song(), { ...emptyReview, status: "approved", approved: approvalOf(song()) })
    write("asked", song(), { ...emptyReview, status: "changes", note: "Calmer." })
    write("rewritten", { ...song(), tempo: 90 }, { ...emptyReview, status: "approved", approved: approvalOf(song()) })
    writeFileSync(join(folder, "day.flac"), "bytes of the day")
    const result = run("notes", folder)
    expect(result.status).toBe(0)
    const answer = JSON.parse(result.stdout) as { summary: string; music: ReadonlyArray<{ file: string; kind: string; status: string; note?: string; changedSinceApproved?: string }> }
    expect(answer.summary).toBe("2 approved (1 changed since: ask the person to listen again), 1 with changes asked, 1 not reviewed yet (of 4).")
    expect(answer.music.map((entry) => [entry.file.split("/").pop(), entry.kind, entry.status])).toEqual([
      ["asked.song.json", "song", "changes"],
      ["rewritten.song.json", "song", "approved"],
      ["day.flac", "audio", "new"],
      ["approved.song.json", "song", "approved"]
    ])
    expect(answer.music[1]?.changedSinceApproved).toBe("its tempo, length, loop, or master changed")
  })

  it("says so when a folder holds no music, and a path is not there", { timeout: 30_000 }, () => {
    const folder = mkdtempSync(join(tmpdir(), "music-"))
    const empty = run("notes", folder)
    expect(empty.status).toBe(2)
    expect(empty.stderr).toContain("no songs or audio files")
    expect(run("notes", join(folder, "nothing")).status).toBe(2)
  })

  it("lists a song that changed since it was approved when it renders", { timeout: 30_000 }, () => {
    const file = join(mkdtempSync(join(tmpdir(), "music-")), "theme.song.json")
    writeFileSync(file, encodeSong({ ...song(), tempo: 90 }))
    writeFileSync(reviewPath(file), encodeReview({ ...emptyReview, status: "approved", approved: approvalOf(song()) }))
    const rendered = run("render", file)
    expect(rendered.status).toBe(0)
    expect(JSON.parse(rendered.stdout)).toMatchObject({ changedSinceApproved: "its tempo, length, loop, or master changed" })
  })
})
