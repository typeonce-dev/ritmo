/**
 * The `music` commands: the music lab for agents. The same core as the
 * review page (one renderer, one song format), driven from the command
 * line, printing JSON and exiting with a code that says what to do next:
 *
 * - 0: clean (warnings are listed, and are the agent's call)
 * - 2: a usage problem, a missing file, a broken song
 * - 3: errors: the song clips or is silent; fix it
 */
import { Effect, FileSystem, Option, Path } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { intFlag, numberFlag } from "../../internal/flags.ts"
import { untilStopped } from "../../internal/serve.ts"
import { Exit } from "../../sound/cli/commands.ts"
import { CliFailure, printJson, readText, writeBytes, writeText } from "../../sound/cli/io.ts"
import { monoWav, readWav, stereoWav } from "../core/audio.ts"
import { checkSong } from "../core/check.ts"
import { drums, instrumentIds, instruments } from "../core/instruments.ts"
import { isSparse, listen, referenceOf } from "../core/listen.ts"
import { toMidi } from "../core/midi.ts"
import { renderSong } from "../core/render.ts"
import { audioReviewSummary, changedOf, musicSummary, reviewPath, reviewSummary } from "../core/review.ts"
import { encodeSong, nameOf, scaleNames, type Song } from "../core/song.ts"
import { readBytes, readReview, readSong } from "./io.ts"
import { audioReviewPlace, AUDIO_FILES, findMusic, goneOf, readMusic, type MusicFile } from "./library.ts"
import { serve } from "./serve.ts"

const exitWith = (code: number): Effect.Effect<void, Exit> => (code === 0 ? Effect.void : Effect.fail(new Exit({ code })))

const songArgument = Argument.String("song").pipe(Argument.withDescription("A song: a JSON file of tracks and notes (`theme.song.json`)."))
const stem = (file: string): string => file.replace(/\.json$/, "")

const pathsArgument = Argument.String("paths").pipe(
  Argument.withDescription(`Songs (\`theme.song.json\`), audio files (${AUDIO_FILES.join(", ")}), or folders to look through for \`*.song.json\` and audio files. Name the folders the game's music is in: a whole game holds much that is not music.`),
  Argument.variadic({ min: 1 })
)

/** The music under `paths`, failing on a path that is not there, a folder with no music, and a song named outright that is broken. */
const musicUnder = Effect.fn("musicUnder")(function* (paths: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem
  const find = (chosen: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<MusicFile>, CliFailure> =>
    Effect.tryPromise({ try: () => findMusic(chosen), catch: (error) => new CliFailure({ message: `cannot look through ${chosen.join(", ")}: ${error instanceof Error ? error.message : String(error)}` }) })
  for (const path of paths) {
    const info = yield* fs.stat(path).pipe(Effect.mapError(() => new CliFailure({ message: `cannot read ${path}` })))
    if (info.type === "Directory") {
      if ((yield* find([path])).length === 0) return yield* new CliFailure({ message: `no songs or audio files in ${path}` })
    } else if (!AUDIO_FILES.some((extension) => path.toLowerCase().endsWith(extension))) {
      yield* readSong(path)
      yield* readReview(path)
    }
  }
  return yield* find(paths)
})

const check = Command.make(
  "check",
  { song: songArgument },
  Effect.fn("check")(function* (flags) {
    const song = yield* readSong(flags.song)
    const report = checkSong(song)
    yield* printJson({ file: flags.song, ...report })
    yield* exitWith(report.verdict === "errors" ? 3 : 0)
  })
).pipe(
  Command.withDescription(
    "Renders the song and measures it (length, peak, loudness, each track's loudness and range), and lists what usually sounds wrong: clipping, silence, notes outside the key or the instrument's range, a buried track, a note doubled; with a reference, how closely the melody follows it."
  )
)

const renderCommand = Command.make(
  "render",
  {
    song: songArgument,
    out: Flag.String("out").pipe(Flag.withAlias("o"), Flag.withDescription("The WAV file to write (default: the song's name, .wav). The MIDI file goes beside it."), Flag.optional),
    stems: Flag.Boolean("stems").pipe(Flag.withDefault(false), Flag.withDescription("Also write each track alone (a stem), for a game that layers them (calm, then the drums join in a fight)."))
  },
  Effect.fn("render")(function* (flags) {
    const path = yield* Path.Path
    const song = yield* readSong(flags.song)
    const wav = Option.getOrElse(flags.out, () => `${stem(flags.song)}.wav`)
    const files = [yield* writeBytes(wav, stereoWav(renderSong(song))), yield* writeBytes(wav.replace(/\.wav$/, "") + ".mid", toMidi(song))]
    if (flags.stems) {
      const folder = wav.replace(/\.wav$/, "") + ".stems"
      for (const [index, track] of song.tracks.entries()) {
        const name = `${String(index + 1).padStart(2, "0")}-${track.name.replace(/[^\w-]+/g, "-").toLowerCase()}.wav`
        // Stems stay uncompressed: the game mixes them, and a compressor on each alone would pump on its own.
        files.push(yield* writeBytes(path.join(folder, name), stereoWav(renderSong({ ...song, compressor: false }, { tracks: [index] }))))
      }
    }
    yield* printJson({ file: flags.song, loop: song.loop, seconds: Math.round(song.bars * song.beatsPerBar * (60 / song.tempo) * 100) / 100, files, changedSinceApproved: changedOf(yield* readReview(flags.song), song) })
  })
).pipe(
  Command.withDescription(
    "Writes the song as a stereo WAV file (a looping song is one pass long and loops without a seam) and a MIDI file of its notes; with --stems, each track alone too. Lists `changedSinceApproved` when the song differs from what the person approved."
  )
)

const listenCommand = Command.make(
  "listen",
  {
    song: songArgument,
    audio: Argument.String("audio").pipe(Argument.withDescription("A WAV file of one voice: the person humming, whistling, tapping a beat, or a recorded lead line (a full song gives a tempo and a key, not its tune).")),
    tempo: numberFlag("tempo", 30, 300).pipe(Flag.withDescription("The tempo, when it is known: only the melody and key are listened for."), Flag.optional)
  },
  Effect.fn("listen")(function* (flags) {
    const path = yield* Path.Path
    const wav = readWav(yield* readBytes(flags.audio))
    if (!wav.ok) return yield* new CliFailure({ message: `${flags.audio}: ${wav.error}` })
    // The audio is kept next to the song, so the page can play it beside the song.
    const audio = `${path.basename(stem(flags.song))}.reference.wav`
    yield* writeBytes(path.join(path.dirname(flags.song), audio), monoWav(wav.value.samples, wav.value.sampleRate))
    const heard = listen(wav.value.samples, wav.value.sampleRate, { tempo: Option.getOrUndefined(flags.tempo), audio })
    const existing = yield* readText(flags.song).pipe(Effect.option)
    const reference = referenceOf(heard)
    let song: Song
    let created = false
    if (Option.isSome(existing)) {
      song = { ...(yield* readSong(flags.song)), reference }
    } else {
      // No song yet: one at the reference's tempo and key, long enough to hold it, with no tracks.
      created = true
      song = { tempo: heard.tempo, key: heard.key, beatsPerBar: 4, bars: Math.max(4, Math.ceil(heard.length / 16) * 4), loop: true, master: 0.8, compressor: false, tracks: [], reference }
    }
    yield* writeText(flags.song, encodeSong(song))
    yield* printJson({
      song: flags.song,
      created,
      heard: { tempo: heard.tempo, key: heard.key, beats: heard.length, notes: heard.notes.map((note) => `${note.pitch}@${note.at}/${note.length}`), ...heard.found },
      next: [
        isSparse(heard)
          ? `Only ${heard.notes.length} notes in ${heard.found.seconds} seconds: this is not one voice (a full recording, or a noisy room), and its notes are not its tune. Use its tempo and key at most; ask the person to hum the part alone, close to the microphone.`
          : undefined,
        created
          ? `A new song at ${heard.tempo} BPM in ${heard.key}, with the reference and no tracks. Write tracks around the reference's notes (keep its melody, cleaned up and in key), then \`music check\`.`
          : `The reference is in the song. Build or adjust the tracks around it${
              song.tempo === heard.tempo || Option.isSome(flags.tempo)
                ? ""
                : ` (the song is at ${song.tempo} BPM, the reference at ${heard.tempo}: if the person hummed along to this song, listen again with \`--tempo ${song.tempo}\`; otherwise set the song's tempo to match, or the reference sits off the grid)`
            }, then \`music check\`.`
      ]
        .filter((line) => line !== undefined)
        .join(" ")
    })
  })
).pipe(
  Command.withDescription(
    "Listens to a hum, a whistle, a tapped beat, or a recorded lead line and writes what it heard into the song as its reference: the tempo, the key, and the melody as notes on the song's grid. Makes the song if it does not exist yet."
  )
)

const instrumentsCommand = Command.make(
  "instruments",
  {},
  Effect.fn("instruments")(function* () {
    yield* printJson({
      instruments: instrumentIds.map((id) => {
        const instrument = instruments[id]
        return instrument.kind === "drums"
          ? { id, label: instrument.label, kind: instrument.kind, about: instrument.about, drums: drums.map((drum) => drum.name) }
          : { id, label: instrument.label, kind: instrument.kind, about: instrument.about, range: [nameOf(instrument.range[0]), nameOf(instrument.range[1])] }
      }),
      scales: scaleNames,
      pitches: 'Note names: a letter, an optional # or b, an octave ("C4" is middle C, "A4" 440 Hz, "F#3", "Bb2").'
    })
  })
).pipe(Command.withDescription("Lists the instruments a track can use (what each sounds like and its range), the drum kit's drums, and the scales a key can name."))

const review = Command.make(
  "review",
  {
    paths: pathsArgument,
    port: intFlag("port", 1, 65535).pipe(Flag.withDescription("The port to serve the page on."), Flag.withDefault(5191)),
    host: Flag.Boolean("host").pipe(Flag.withDefault(false), Flag.withDescription("Serve on the network too, to listen on a phone (recording needs localhost or HTTPS)."))
  },
  Effect.fn("review")(function* (flags) {
    const found = yield* musicUnder(flags.paths)
    const address = yield* Effect.tryPromise({
      try: () => serve({ paths: flags.paths, port: flags.port, host: flags.host }),
      catch: (error) => new CliFailure({ message: `cannot serve the page: ${error instanceof Error ? error.message : String(error)}` })
    })
    yield* printJson({
      url: address.url,
      network: address.network,
      music: found.map((music) => music.id),
      next: "Send the person the url. What they edit, record, approve, and comment is saved as they go; read it back with `ritmo-tools music notes`, with the same paths."
    })
    return yield* untilStopped
  })
).pipe(
  Command.withDescription(
    "Opens the review page for all the music under the paths: the person goes through it on a list, approves each piece or asks for changes, and comments on bars or a stretch of time. On a song they also edit notes on a grid, swap instruments, and record a hum as the reference; a plain audio file is played and judged as it is. Runs until stopped; changes are saved as they happen."
  )
)

const notes = Command.make(
  "notes",
  { paths: pathsArgument },
  Effect.fn("notes")(function* (flags) {
    const path = yield* Path.Path
    const found = yield* musicUnder(flags.paths)
    const entries = []
    for (const music of found) {
      const read = yield* Effect.promise(() => readMusic(music))
      if (read.kind === "broken") entries.push({ file: music.id, kind: music.kind, status: "new" as const, problem: read.problem, next: "Fix it: the person cannot open it." })
      else if (read.kind === "song") entries.push({ file: music.id, kind: music.kind, review: reviewPath(music.id), ...reviewSummary(read.song, read.review) })
      else entries.push({ file: music.id, kind: music.kind, review: path.relative(process.cwd(), audioReviewPlace(music.file).reviews), ...audioReviewSummary(read.review, read.hash) })
    }
    const gone = yield* Effect.tryPromise({ try: () => goneOf(found, flags.paths), catch: (error) => new CliFailure({ message: `cannot read the reviews: ${error instanceof Error ? error.message : String(error)}` }) })
    yield* printJson({ ...musicSummary(entries, gone.length), gone })
  })
).pipe(
  Command.withDescription(
    "What the person said in the review of the music under the paths: a summary of what is left, then each piece's status, note, comments (on bars and tracks of a song, on times of an audio file), the edits they made by hand on a song, and, for an approved piece that no longer matches what the person heard, `changedSinceApproved` (`unrecorded` when nothing of what they heard was kept). Changes asked come first. `gone` lists reviews whose music is no longer found."
  )
)

/** A first song to build from: four bars of chords, a bass line, and a beat. */
const STARTER: Song = {
  about: "A starting loop: chords, bass, and a beat to build on.",
  tempo: 96,
  key: "C major",
  beatsPerBar: 4,
  bars: 4,
  loop: true,
  master: 0.8,
  compressor: false,
  tracks: [
    {
      name: "Chords",
      instrument: "piano",
      volume: 0.7,
      pan: -0.15,
      reverb: 0.3,
      notes: [
        ["C4", "E4", "G4"],
        ["A3", "C4", "E4"],
        ["F3", "A3", "C4"],
        ["G3", "B3", "D4"]
      ].flatMap((chord, bar) => chord.map((pitch) => ({ at: bar * 4, length: 4, pitch, velocity: 0.7 })))
    },
    { name: "Bass", instrument: "bass", volume: 0.8, pan: 0, reverb: 0.05, notes: ["C2", "A1", "F1", "G1"].flatMap((pitch, bar) => [0, 2.5].map((beat) => ({ at: bar * 4 + beat, length: beat === 0 ? 2 : 1.5, pitch, velocity: 0.8 }))) },
    {
      name: "Drums",
      instrument: "drums",
      volume: 0.7,
      pan: 0,
      reverb: 0.1,
      notes: Array.from({ length: 4 }, (_, bar) => [
        { at: bar * 4, length: 0.5, pitch: "kick", velocity: 0.9 },
        { at: bar * 4 + 2, length: 0.5, pitch: "kick", velocity: 0.8 },
        { at: bar * 4 + 1, length: 0.5, pitch: "snare", velocity: 0.7 },
        { at: bar * 4 + 3, length: 0.5, pitch: "snare", velocity: 0.7 },
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((eighth) => ({ at: bar * 4 + eighth / 2, length: 0.25, pitch: "hat", velocity: eighth % 2 === 0 ? 0.6 : 0.4 }))
      ]).flat()
    }
  ]
}

const init = Command.make(
  "init",
  {
    song: Argument.String("song").pipe(Argument.withDescription("Where to write the new song."), Argument.withDefault("theme.song.json")),
    force: Flag.Boolean("force").pipe(Flag.withDefault(false), Flag.withDescription("Replace an existing file."))
  },
  Effect.fn("init")(function* (flags) {
    const existing = yield* readText(flags.song).pipe(Effect.option)
    if (Option.isSome(existing) && !flags.force) return yield* new CliFailure({ message: `${flags.song} already exists (--force replaces it)` })
    yield* printJson({ song: yield* writeText(flags.song, encodeSong(STARTER)), tracks: STARTER.tracks.map((track) => track.name) })
  })
).pipe(Command.withDescription("Writes a starting song: four bars of piano chords, a bass line, and a drum beat, to build from."))

export const music = Command.make("music").pipe(
  Command.withDescription(
    "Ritmo's music lab: game music as JSON songs (tracks of notes), built around a hum or a reference, measured, and reviewed by a person on a local page, all of a game's music on one list, songs with a note grid and plain audio files as they are. Prints JSON; exit 0 clean, 2 usage error, 3 errors in the song."
  ),
  Command.withSubcommands([listenCommand, instrumentsCommand, check, renderCommand, review, notes, init])
)
