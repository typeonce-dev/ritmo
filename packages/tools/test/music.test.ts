import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { monoWav, readWav, stereoWav } from "@typeonce/ritmo-tools/music/core/audio.ts"
import { checkSong } from "@typeonce/ritmo-tools/music/core/check.ts"
import { instrumentIds, instruments } from "@typeonce/ritmo-tools/music/core/instruments.ts"
import { listen } from "@typeonce/ritmo-tools/music/core/listen.ts"
import { toMidi } from "@typeonce/ritmo-tools/music/core/midi.ts"
import { loudnessOf, peakOf, renderSong, SAMPLE_RATE } from "@typeonce/ritmo-tools/music/core/render.ts"
import { describeEdits, reviewSummary } from "@typeonce/ritmo-tools/music/core/review.ts"
import { decodeSong, encodeSong, inKey, midiOf, nameOf, parseKey, type Song } from "@typeonce/ritmo-tools/music/core/song.ts"

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
const hum = (notes: ReadonlyArray<readonly [string, number]>, tempo: number, rate = 22050): Float32Array => {
  const beat = 60 / tempo
  const total = notes.reduce((sum, [, beats]) => sum + beats, 0) * beat + 1
  const out = new Float32Array(Math.ceil(total * rate))
  let at = 0.4
  let phase = 0
  let low1 = 0
  let low2 = 0
  for (const [pitch, beats] of notes) {
    const length = beats * beat
    const midi = midiOf(pitch)
    if (midi !== undefined) {
      const held = length * 0.88
      for (let i = 0; i < held * rate; i++) {
        const t = i / rate
        const bend = 0.15 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t * 3) - 0.6 * Math.exp(-t / 0.03) + 0.2
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
})
