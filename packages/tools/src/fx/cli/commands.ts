/**
 * The `fx` commands: the effects lab for agents. Pixel art effects are code
 * (each draft a small JavaScript module), and the same runner draws them
 * here and on the review page. Every command prints JSON and exits with a
 * code that says what to do next:
 *
 * - 0: clean (warnings are listed, and are the agent's call)
 * - 2: a usage problem, a missing file, a broken bank
 * - 3: errors: a draft does not load, throws, draws nothing, or is not repeatable; fix its module
 */
import { Effect, Option, Path } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { toGif } from "../../pixel/core/gif.ts"
import { atlasOf, spritesheetJson } from "../../pixel/core/spritesheet.ts"
import { encodePng } from "../../pixel/cli/png.ts"
import { Exit } from "../../pixel/cli/commands.ts"
import { encodeBank, encodeReview, resolveComments, reviewPath, reviewSummary, usedDraft, type Bank } from "../core/bank.ts"
import { toHex } from "../../pixel/core/color.ts"
import { checkEffect, paletteIssues } from "../core/check.ts"
import { doubles, flicker, holes, jaggies } from "../core/craft.ts"
import { runEffect } from "../core/effect.ts"
import { contactSheet, framesOf } from "../core/export.ts"
import { CliFailure, loadDraft, printJson, readBank, readReview, readRules, readText, writeBytes, writeText } from "./io.ts"
import { serve } from "./serve.ts"

const exitWith = (code: number): Effect.Effect<void, Exit> => (code === 0 ? Effect.void : Effect.fail(new Exit({ code })))

const configFlag = Flag.String("config").pipe(
  Flag.withDescription("The project's pixel.config.json (default: the nearest at or above the bank's folder): its palette and maxColors apply to effects too."),
  Flag.optional
)

const bankArgument = Argument.String("bank").pipe(Argument.withDescription("An effects bank: a JSON file of the palette and each effect's drafts."))
const names = Argument.String("names").pipe(Argument.withDescription("Only these effects (default: every effect in the bank)."), Argument.variadic())

/** The named effects, failing on a name the bank does not have. */
const pick = (bank: Bank, chosen: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, CliFailure> => {
  const all = Object.keys(bank.effects)
  if (chosen.length === 0) return Effect.succeed(all)
  const missing = chosen.filter((name) => !all.includes(name))
  return missing.length === 0 ? Effect.succeed(chosen) : Effect.fail(new CliFailure({ message: `no effect named ${missing.join(", ")}`, details: { effects: all } }))
}

const check = Command.make(
  "check",
  { bank: bankArgument, names, config: configFlag },
  Effect.fn("check")(function* (flags) {
    const bank = yield* readBank(flags.bank)
    const { config, rules } = yield* readRules(flags.bank, flags.config)
    const context = { rules, backdrops: bank.backdrops }
    const palette = paletteIssues(bank.palette, rules)
    const results: Array<Record<string, unknown>> = []
    let errors = palette.filter((issue) => issue.level === "error").length
    let warnings = palette.length - errors
    for (const name of yield* pick(bank, flags.names)) {
      const entry = bank.effects[name]!
      const use = usedDraft(entry)
      for (const [id, draft] of Object.entries(entry.drafts)) {
        const loaded = yield* loadDraft(flags.bank, draft)
        if (!loaded.ok) {
          errors++
          results.push({ effect: name, draft: id, file: draft.file, used: id === use, issues: [{ level: "error", code: "load", message: loaded.error }] })
          continue
        }
        const checked = checkEffect(loaded.effect, bank.palette, { seed: draft.seed, tune: draft.tune, accept: draft.accept }, context)
        errors += checked.issues.filter((issue) => issue.level === "error").length
        warnings += checked.issues.filter((issue) => issue.level === "warning").length
        results.push({
          effect: name,
          draft: id,
          label: loaded.effect.label,
          file: draft.file,
          used: id === use,
          ...checked.measures,
          issues: checked.issues,
          ...(checked.accepted.length === 0 ? {} : { accepted: checked.accepted.map((issue) => ({ code: issue.code, why: issue.why })) })
        })
      }
    }
    const verdict = errors > 0 ? "errors" : warnings > 0 ? "warnings" : "clean"
    yield* printJson({ file: flags.bank, config: config ?? null, verdict, palette, drafts: results })
    yield* exitWith(errors > 0 ? 3 : 0)
  })
).pipe(
  Command.withDescription(
    "Runs every draft of every effect (or the named ones) twice and measures it: frames, length, the box it fills, the colors it uses. Lists what breaks the rules, with the frames and pixels where: a module that does not load, throws, or draws nothing, randomness that is not the seed's, pixels past the canvas edge, a one-shot that starts late or does not end empty, a loop that jumps, blinking, lone-pixel noise; the craft (jaggies, doubles, pinholes, flicker, too faint on one of the bank's backdrops); and the project's pixel.config.json (its palette, maxColors)."
  )
)

const look = Command.make(
  "look",
  {
    bank: bankArgument,
    name: Argument.String("name").pipe(Argument.withDescription("The effect to look at.")),
    draft: Flag.String("draft").pipe(Flag.withDescription("Only this draft (default: every draft)."), Flag.optional),
    scale: Flag.Int("scale").pipe(Flag.withDescription("Each pixel drawn this many times."), Flag.withDefault(6)),
    columns: Flag.Int("columns").pipe(Flag.withDescription("Frames per row."), Flag.withDefault(8)),
    backdrop: Flag.String("backdrop").pipe(Flag.withDescription("What the frames are drawn over: dark, light, checker, or one of the bank's backdrops by name."), Flag.withDefault("dark")),
    marks: Flag.Literals("marks", ["comments", "jaggies", "doubles", "holes", "flicker", "none"]).pipe(
      Flag.withDescription("What to ring in orange: the person's comments on the draft (default), or where a craft rule from `fx check` breaks."),
      Flag.withDefault("comments")
    ),
    out: Flag.String("out").pipe(Flag.withAlias("o"), Flag.withDescription("The folder to write to (default: <bank>.look/ next to the bank)."), Flag.optional)
  },
  Effect.fn("look")(function* (flags) {
    const path = yield* Path.Path
    const bank = yield* readBank(flags.bank)
    yield* pick(bank, [flags.name])
    const entry = bank.effects[flags.name]!
    const ids = Option.match(flags.draft, { onNone: () => Object.keys(entry.drafts), onSome: (id) => [id] })
    const folder = Option.getOrElse(flags.out, () => flags.bank.replace(/\.json$/, "") + ".look")
    const backdrop = backdropOf(bank, flags.backdrop)
    if (backdrop === undefined) return yield* new CliFailure({ message: `no backdrop named ${flags.backdrop}`, details: { backdrops: ["dark", "light", "checker", ...Object.keys(bank.backdrops ?? {})] } })
    const review = yield* readReview(flags.bank)
    // Open comments only: resolved ones are done.
    const comments = (review.effects[flags.name]?.comments ?? []).flatMap((comment, index) => (comment.resolved === true ? [] : [{ ...comment, number: index + 1 }]))
    const files: Array<string> = []
    const ringed: Array<Record<string, unknown>> = []
    for (const id of ids) {
      const draft = entry.drafts[id]
      if (draft === undefined) return yield* new CliFailure({ message: `${flags.name} has no draft ${id}`, details: { drafts: Object.keys(entry.drafts) } })
      const loaded = yield* loadDraft(flags.bank, draft)
      if (!loaded.ok) return yield* new CliFailure({ message: loaded.error })
      const run = runEffect(loaded.effect, bank.palette, { seed: draft.seed, tune: draft.tune })
      const mine = comments.filter((comment) => comment.draft === id)
      const marks = flags.marks === "comments" ? mine : flags.marks === "none" ? [] : flags.marks === "flicker" ? flicker(run).spots : { jaggies, doubles, holes }[flags.marks](run)
      if (flags.marks === "comments") for (const comment of mine) ringed.push({ number: comment.number, draft: id, frame: comment.frame, x: comment.x, y: comment.y, text: comment.text })
      else if (marks.length > 0) ringed.push({ draft: id, [flags.marks]: marks.length })
      const sheet = contactSheet(run, bank.palette, { scale: flags.scale, columns: flags.columns, backdrop, marks })
      files.push(yield* writeBytes(path.join(folder, `${flags.name}.${id}.png`), encodePng(sheet)))
    }
    yield* printJson({
      effect: flags.name,
      files,
      marks: flags.marks,
      ringed,
      next: "Read each picture: its frames left to right, top to bottom (frame 0 first). Orange rings mark the person's comments or where a rule breaks. Judge shape, timing, and how it ends before showing the person."
    })
  })
).pipe(
  Command.withDescription(
    "Writes a contact sheet per draft of an effect: every frame side by side, enlarged, on a backdrop, as a PNG to look at, with the person's comments (or where a craft rule breaks) ringed. Use it to see a draft before showing it to the person, and to see the pixel a comment points at."
  )
)

const renderCommand = Command.make(
  "render",
  {
    bank: bankArgument,
    names,
    out: Flag.String("out").pipe(Flag.withAlias("o"), Flag.withDescription("The folder to write to (default: <bank>.out/ next to the bank).")).pipe(Flag.optional),
    scale: Flag.Int("scale").pipe(Flag.withDescription("Each pixel written this many times in the sheet and the GIF."), Flag.withDefault(1))
  },
  Effect.fn("render")(function* (flags) {
    const path = yield* Path.Path
    const bank = yield* readBank(flags.bank)
    const folder = Option.getOrElse(flags.out, () => flags.bank.replace(/\.json$/, "") + ".out")
    const scale = Math.max(1, flags.scale)
    const written: Array<Record<string, unknown>> = []
    for (const name of yield* pick(bank, flags.names)) {
      const entry = bank.effects[name]!
      const id = usedDraft(entry)!
      const draft = entry.drafts[id]!
      const loaded = yield* loadDraft(flags.bank, draft)
      if (!loaded.ok) return yield* new CliFailure({ message: loaded.error })
      const run = runEffect(loaded.effect, bank.palette, { seed: draft.seed, tune: draft.tune })
      if (run.errors.length > 0) return yield* new CliFailure({ message: `${name} (draft ${id}) does not draw cleanly: ${run.errors.join("; ")}` })
      const frames = framesOf(run, bank.palette)
      const clip = { name, frames, anchor: run.anchor, fps: run.fps, loop: "forward" as const }
      const atlas = atlasOf([clip], { columns: frames.length, spacing: 0 })
      const big = scale === 1 ? atlas.art : { ...atlas.art, width: atlas.art.width * scale, height: atlas.art.height * scale, indices: upscale(atlas.art.indices, atlas.art.width, atlas.art.height, scale) }
      const files = [
        yield* writeBytes(path.join(folder, `${name}.png`), encodePng(rgbaOf(big))),
        yield* writeText(path.join(folder, `${name}.json`), withLoop(spritesheetJson({ image: `${name}.png`, clips: [clip], atlas, scale }), name, run.loop)),
        yield* writeBytes(path.join(folder, `${name}.gif`), toGif(frames, { scale: Math.max(scale, 4), delay: 1000 / run.fps }))
      ]
      written.push({ effect: name, draft: id, loop: run.loop, anchor: [run.anchor.x, run.anchor.y], frames: frames.length, fps: run.fps, files })
    }
    yield* printJson({ file: flags.bank, effects: written })
  })
).pipe(
  Command.withDescription(
    "Writes each effect's chosen draft (its `use`, or its first) for the game: a sprite sheet PNG of its frames in one row, its JSON (the hash format Pixi, Phaser, and Aseprite read, with the animation, its fps, each frame's anchor from the draft's `anchor`, and `meta.loop`: whether it loops or plays once), and a GIF to share."
  )
)

/** The sheet's JSON with `meta.loop`: whether each animation plays again from the start (a torch) or once (a hit), which the hash format has no field for. */
const withLoop = (json: string, name: string, loop: boolean): string => {
  const sheet = JSON.parse(json) as { meta: Record<string, unknown> }
  sheet.meta.loop = { [name]: loop }
  return JSON.stringify(sheet, null, 2) + "\n"
}

/** A backdrop for `look`: a built-in one, or one of the bank's by name. */
const backdropOf = (bank: Bank, name: string): "dark" | "light" | "checker" | `#${string}` | undefined => {
  if (name === "dark" || name === "light" || name === "checker") return name
  const hex = bank.backdrops?.[name]
  return hex === undefined ? undefined : (hex as `#${string}`)
}

const upscale = (indices: Int32Array, width: number, height: number, scale: number): Int32Array => {
  const out = new Int32Array(width * scale * height * scale)
  for (let y = 0; y < height * scale; y++) for (let x = 0; x < width * scale; x++) out[y * width * scale + x] = indices[Math.floor(y / scale) * width + Math.floor(x / scale)]!
  return out
}

const rgbaOf = (art: { readonly width: number; readonly height: number; readonly palette: ReadonlyArray<{ r: number; g: number; b: number }>; readonly indices: Int32Array }) => {
  const data = new Uint8ClampedArray(art.width * art.height * 4)
  art.indices.forEach((index, i) => {
    const color = art.palette[index]
    if (index < 0 || color === undefined) return
    data.set([color.r, color.g, color.b, 255], i * 4)
  })
  return { width: art.width, height: art.height, data }
}

const review = Command.make(
  "review",
  {
    bank: bankArgument,
    config: configFlag,
    port: Flag.Int("port").pipe(Flag.withDescription("The port to serve the page on (the next free one if taken)."), Flag.withDefault(5192)),
    host: Flag.Boolean("host").pipe(Flag.withDefault(false), Flag.withDescription("Serve on the network too, to look on a phone."))
  },
  Effect.fn("review")(function* (flags) {
    const path = yield* Path.Path
    const bank = path.resolve(flags.bank)
    yield* readBank(bank)
    yield* readReview(bank)
    const { rules } = yield* readRules(bank, flags.config)
    const address = yield* Effect.tryPromise({
      try: () => serve({ bank, port: flags.port, host: flags.host, rules: { palette: rules.palette?.map(toHex), maxColors: rules.maxColors } }),
      catch: (error) => new CliFailure({ message: `cannot serve the page: ${error instanceof Error ? error.message : String(error)}` })
    })
    yield* printJson({ ...address, bank, review: reviewPath(bank), next: "Send the person the url. What they pick, tune, and note is saved to the bank and the review as they go; read it back with `ritmo-tools fx notes`." })
    return yield* Effect.never
  })
).pipe(
  Command.withDescription(
    "Opens the review page for a bank: the person watches every draft of an effect side by side, slowed down or frame by frame, picks one, tunes its params with sliders, and leaves notes. Runs until stopped; changes are saved to the bank and its review as they happen, and drafts the agent edits reload on the page."
  )
)

const notes = Command.make(
  "notes",
  { bank: bankArgument },
  Effect.fn("notes")(function* (flags) {
    const bank = yield* readBank(flags.bank)
    const review = yield* readReview(flags.bank)
    yield* printJson({ file: flags.bank, review: reviewPath(flags.bank), ...reviewSummary(bank, review) })
  })
).pipe(
  Command.withDescription(
    "What the person said in the review: each effect's status (new, approved, changes asked), note, open comments (each numbered, on a draft, a frame, and a pixel), chosen draft, and tune, the changes first."
  )
)

const resolve = Command.make(
  "resolve",
  {
    bank: bankArgument,
    effect: Argument.String("effect").pipe(Argument.withDescription("The effect the comments are on.")),
    numbers: Argument.Int("numbers").pipe(Argument.withDescription("The comments' numbers, as `fx notes` lists them."), Argument.atLeast(1)),
    reply: Flag.String("reply").pipe(Flag.withDescription("What you changed, in a few words: the person reads it beside their comment."), Flag.withDefault(""))
  },
  Effect.fn("resolve")(function* (flags) {
    const bank = yield* readBank(flags.bank)
    yield* pick(bank, [flags.effect])
    const resolved = resolveComments(yield* readReview(flags.bank), flags.effect, flags.numbers, flags.reply)
    if (!resolved.ok) return yield* new CliFailure({ message: resolved.error })
    const file = yield* writeText(reviewPath(flags.bank), encodeReview(resolved.value))
    yield* printJson({ review: file, effect: flags.effect, resolved: flags.numbers, reply: flags.reply === "" ? undefined : flags.reply })
  })
).pipe(
  Command.withDescription(
    "Marks the person's comments on an effect as resolved, by the numbers `fx notes` gives, with a reply saying what changed. `fx notes` stops listing them; the page shows them done, with the reply, and the person can reopen one."
  )
)

const STARTER_BANK: Bank = {
  palette: { white: "#ffffff", yellow: "#fee761", orange: "#f77622", red: "#e43b44", smoke: "#8b9bb4", dark: "#3a4466" },
  effects: { spark: { about: "A small hit spark: a blow lands.", drafts: { a: { file: "fx/spark.a.js" } } } }
}

const STARTER_DRAFT = `// A draft of the "spark" effect: rays burst out from the middle and burn out.
export default {
  label: "rays",
  size: [24, 24],
  frames: 8,
  fps: 24,
  loop: false,
  // Where the blow lands: the game places this pixel there.
  anchor: [12, 12],
  params: {
    rays: { min: 3, max: 10, value: 6, step: 1 },
    reach: { min: 4, max: 11, value: 9 }
  },
  draw(fx) {
    // The blow lands on frame 0: a flash, before the rays have length.
    if (fx.frame === 0) fx.disc(fx.cx, fx.cy, 2, "white")
    for (let i = 0; i < fx.p.rays; i++) {
      const angle = (i / fx.p.rays) * Math.PI * 2 + fx.range(-0.3, 0.3)
      const far = fx.ease.out(fx.t) * fx.p.reach * fx.range(0.7, 1)
      const near = fx.ease.in(fx.t) * fx.p.reach
      if (far - near < 1) continue
      const color = fx.ramp(["white", "yellow", "orange", "red"], fx.t)
      fx.line(fx.cx + Math.cos(angle) * near, fx.cy + Math.sin(angle) * near, fx.cx + Math.cos(angle) * far, fx.cy + Math.sin(angle) * far, color)
    }
  }
}
`

const init = Command.make(
  "init",
  {
    bank: Argument.String("bank").pipe(Argument.withDescription("Where to write the new bank."), Argument.withDefault("game.fx.json")),
    force: Flag.Boolean("force").pipe(Flag.withDefault(false), Flag.withDescription("Replace existing files."))
  },
  Effect.fn("init")(function* (flags) {
    const path = yield* Path.Path
    const draft = path.join(path.dirname(flags.bank), STARTER_BANK.effects.spark!.drafts.a!.file)
    for (const file of [flags.bank, draft]) {
      const existing = yield* readText(file).pipe(Effect.option)
      if (Option.isSome(existing) && !flags.force) return yield* new CliFailure({ message: `${file} already exists (--force replaces it)` })
    }
    yield* printJson({ bank: yield* writeText(flags.bank, encodeBank(STARTER_BANK)), drafts: [yield* writeText(draft, STARTER_DRAFT)], effects: Object.keys(STARTER_BANK.effects) })
  })
).pipe(Command.withDescription("Writes a starting bank (a six-color palette) with one effect, a hit spark, and its first draft module to build from."))

export const fx = Command.make("fx").pipe(
  Command.withDescription(
    "Ritmo's effects lab: pixel art effects as code, a few drafts each, checked, looked at, reviewed by a person on a local page, and written as sprite sheets. Prints JSON; exit 0 clean, 2 usage error, 3 errors in a draft."
  ),
  Command.withSubcommands([check, look, renderCommand, review, notes, resolve, init])
)
