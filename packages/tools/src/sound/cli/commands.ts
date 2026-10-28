/**
 * The `sound` commands: the sound lab for agents. The same core as the
 * review page (one renderer, one recipe format), driven from the command
 * line, printing JSON and exiting with a code that says what to do next:
 *
 * - 0: clean (warnings are listed, and are the agent's call)
 * - 2: a usage problem, a missing file, a broken bank
 * - 3: errors: a sound clips, is silent, or is empty; fix the recipe
 */
import { Data, Effect, Option, Path, Runtime } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { checkBank } from "../core/measure.ts"
import { encodeBank, type Bank } from "../core/recipe.ts"
import { render, renderSequence } from "../core/render.ts"
import { encodeReview, newSound, reviewPath, reviewSummary } from "../core/review.ts"
import { makeTakes, towards } from "../core/takes.ts"
import { toWav } from "../core/wav.ts"
import { CliFailure, printJson, readBank, readReview, readText, writeBytes, writeText } from "./io.ts"
import { serve } from "./serve.ts"

/** Ends the run with an exit code, already reported on stdout. */
export class Exit extends Data.TaggedError("Exit")<{ readonly code: number }> {
  override get [Runtime.errorExitCode](): number {
    return this.code
  }
  override readonly [Runtime.errorReported] = false
}

const exitWith = (code: number): Effect.Effect<void, Exit> => (code === 0 ? Effect.void : Effect.fail(new Exit({ code })))

const bankArgument = Argument.String("bank").pipe(Argument.withDescription("A sound bank: a JSON file of named recipes."))
const names = Argument.String("names").pipe(Argument.withDescription("Only these sounds (default: every sound in the bank)."), Argument.variadic())

/** The named sounds, failing on a name the bank does not have. */
const pick = (bank: Bank, chosen: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, CliFailure> => {
  const all = Object.keys(bank.sounds)
  if (chosen.length === 0) return Effect.succeed(all)
  const missing = chosen.filter((name) => !all.includes(name))
  return missing.length === 0 ? Effect.succeed(chosen) : Effect.fail(new CliFailure({ message: `no sound named ${missing.join(", ")}`, details: { sounds: all } }))
}

const check = Command.make(
  "check",
  { bank: bankArgument, names },
  Effect.fn("check")(function* (flags) {
    const bank = yield* readBank(flags.bank)
    const report = checkBank(bank, yield* pick(bank, flags.names))
    yield* printJson({ file: flags.bank, ...report })
    yield* exitWith(report.verdict === "errors" ? 3 : 0)
  })
).pipe(
  Command.withDescription(
    "Measures every sound (or the named ones): length, peak, loudness, attack, brightness, and how it ends, and lists what breaks the rules (clipping, silence, a late start, a click at the end, much louder or quieter than its kind)."
  )
)

const renderCommand = Command.make(
  "render",
  {
    bank: bankArgument,
    names,
    out: Flag.String("out").pipe(Flag.withAlias("o"), Flag.withDescription("The folder to write the WAV files to (default: <bank>.wav/ next to the bank).")).pipe(Flag.optional),
    sequence: Flag.Finite("sequence").pipe(
      Flag.withDescription("Also write the named sounds played one after another, this many seconds apart, as sequence.wav: a combo heard in context."),
      Flag.optional
    )
  },
  Effect.fn("render")(function* (flags) {
    const path = yield* Path.Path
    const bank = yield* readBank(flags.bank)
    const chosen = yield* pick(bank, flags.names)
    const folder = Option.getOrElse(flags.out, () => flags.bank.replace(/\.json$/, "") + ".wav")
    const files: Array<string> = []
    for (const name of chosen) files.push(yield* writeBytes(path.join(folder, `${name}.wav`), toWav(render(bank.sounds[name]!, { master: bank.master }))))
    if (Option.isSome(flags.sequence)) {
      const gap = flags.sequence.value
      const parts = chosen.map((name, i) => ({ recipe: bank.sounds[name]!, at: i * gap }))
      files.push(yield* writeBytes(path.join(folder, "sequence.wav"), toWav(renderSequence(parts, { master: bank.master }))))
    }
    yield* printJson({ file: flags.bank, files })
  })
).pipe(Command.withDescription("Writes each sound (or the named ones) as a WAV file, at the bank's master volume, exactly as the page plays it."))

const vary = Command.make(
  "vary",
  {
    bank: bankArgument,
    name: Argument.String("name").pipe(Argument.withDescription("The sound to make takes of.")),
    toward: Flag.Literals(
      "toward",
      towards.map((entry) => entry.id)
    ).pipe(Flag.withDescription(`Which way to push the takes: ${towards.map((entry) => `${entry.id} (${entry.hint.toLowerCase().replace(/\.$/, "")})`).join("; ")}.`), Flag.withDefault("wider")),
    count: Flag.Int("count").pipe(Flag.withDescription("How many takes, 1 to 12."), Flag.withDefault(4)),
    seed: Flag.Int("seed").pipe(Flag.withDescription("Another seed makes other takes; the same seed, the same takes."), Flag.withDefault(1))
  },
  Effect.fn("vary")(function* (flags) {
    const bank = yield* readBank(flags.bank)
    yield* pick(bank, [flags.name])
    const review = yield* readReview(flags.bank)
    const takes = makeTakes(bank.sounds[flags.name]!, flags.toward, flags.count, flags.seed)
    const entry = review.sounds[flags.name] ?? newSound
    const file = yield* writeText(
      reviewPath(flags.bank),
      encodeReview({ sounds: { ...review.sounds, [flags.name]: { ...entry, takes, toward: flags.toward, picked: undefined } } })
    )
    yield* printJson({ review: file, sound: flags.name, toward: flags.toward, takes: takes.map((take) => ({ id: take.id, label: take.label })) })
  })
).pipe(
  Command.withDescription(
    "Makes takes of a sound, pushed toward a direction, and offers them in the review: the person hears them side by side on the page and picks one, which becomes the sound."
  )
)

const review = Command.make(
  "review",
  {
    bank: bankArgument,
    port: Flag.Int("port").pipe(Flag.withDescription("The port to serve the page on (the next free one if taken)."), Flag.withDefault(5190)),
    host: Flag.Boolean("host").pipe(Flag.withDefault(false), Flag.withDescription("Serve on the network too, to listen on a phone."))
  },
  Effect.fn("review")(function* (flags) {
    const path = yield* Path.Path
    const bank = path.resolve(flags.bank)
    yield* readBank(bank)
    yield* readReview(bank)
    const address = yield* Effect.tryPromise({
      try: () => serve({ bank, port: flags.port, host: flags.host }),
      catch: (error) => new CliFailure({ message: `cannot serve the page: ${error instanceof Error ? error.message : String(error)}` })
    })
    yield* printJson({ ...address, bank, review: reviewPath(bank), next: "Send the person the url. What they pick, tune, and note is saved to the bank and the review as they go; read it back with `ritmo-tools sound notes`." })
    return yield* Effect.never
  })
).pipe(
  Command.withDescription(
    "Opens the review page for a bank: the person listens to each sound, compares takes, tunes with sliders, and leaves notes. Runs until stopped; changes are saved to the bank and its review as they happen."
  )
)

const notes = Command.make(
  "notes",
  { bank: bankArgument },
  Effect.fn("notes")(function* (flags) {
    const bank = yield* readBank(flags.bank)
    const review = yield* readReview(flags.bank)
    yield* printJson({ file: flags.bank, review: reviewPath(flags.bank), ...reviewSummary(Object.keys(bank.sounds), review) })
  })
).pipe(Command.withDescription("What the person said in the review: each sound's status (new, approved, changes asked) and note, the changes first."))

const STARTER: Bank = {
  master: 0.6,
  sounds: {
    hit: {
      about: "A blow lands: a short thud and a crack.",
      reverb: 0.12,
      layers: [
        { type: "click", delay: 0, gain: 0.45 },
        { type: "tone", wave: "sine", from: 160, to: 55, duration: 0.12, attack: 0.002, delay: 0, gain: 0.65 },
        { type: "crunch", from: 1500, to: 500, duration: 0.07, delay: 0, gain: 0.3 }
      ]
    },
    swing: {
      about: "A blade cuts the air.",
      reverb: 0.1,
      layers: [{ type: "swish", low: 500, peak: 2400, peakAt: 0.6, q: 1.2, duration: 0.18, delay: 0, gain: 0.5 }]
    },
    pickup: {
      about: "Something good is picked up: two quick rising notes.",
      reverb: 0.2,
      layers: [
        { type: "tone", wave: "triangle", from: 880, to: 880, duration: 0.08, attack: 0.003, delay: 0, gain: 0.3 },
        { type: "tone", wave: "triangle", from: 1320, to: 1320, duration: 0.14, attack: 0.003, delay: 0.07, gain: 0.3 }
      ]
    }
  }
}

const init = Command.make(
  "init",
  {
    bank: Argument.String("bank").pipe(Argument.withDescription("Where to write the new bank."), Argument.withDefault("game.sounds.json")),
    force: Flag.Boolean("force").pipe(Flag.withDefault(false), Flag.withDescription("Replace an existing file."))
  },
  Effect.fn("init")(function* (flags) {
    const existing = yield* readText(flags.bank).pipe(Effect.option)
    if (Option.isSome(existing) && !flags.force) return yield* new CliFailure({ message: `${flags.bank} already exists (--force replaces it)` })
    yield* printJson({ bank: yield* writeText(flags.bank, encodeBank(STARTER)), sounds: Object.keys(STARTER.sounds) })
  })
).pipe(Command.withDescription("Writes a starting bank of three sounds (a hit, a swing, a pickup) to build from."))

export const sound = Command.make("sound").pipe(
  Command.withDescription("Ritmo's sound lab: game sounds as JSON recipes, measured, varied, and reviewed by a person on a local page. Prints JSON; exit 0 clean, 2 usage error, 3 errors in a sound."),
  Command.withSubcommands([check, renderCommand, vary, review, notes, init])
)
