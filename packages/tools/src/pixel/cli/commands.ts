/**
 * The `pixel` commands: the pixel fixer for agents. The same core as the web page (one
 * pipeline, one recipe format), driven from the command line, printing JSON
 * reports and exiting with a code that says what to do next:
 *
 * - 0: clean (or fixed with confidence)
 * - 2: a usage problem, a missing file, a broken sprite source
 * - 3: fixable: rules are broken, `ritmo-tools pixel fix` (or editing the source) fixes them
 * - 4: needs a person: the grid is unsure; look at the preview, or open the recipe in the page
 */
import { Data, Effect, Option, Path, Runtime } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import type { Metric } from "../core/color.ts"
import { toHex } from "../core/color.ts"
import { TRANSPARENT, usedColors, type PixelArt } from "../core/fix.ts"
import { toJson, toRgba, toSvg } from "../core/export.ts"
import type { LintRules } from "../core/lint.ts"
import { presets, proposePalette, type ProposeMethod } from "../core/palette.ts"
import { runRecipe, type Outcome } from "../core/pipeline.ts"
import { atlasClips, detectFrames, proposeForSheet, runSheet, type AnimationCache } from "../core/animation.ts"
import { toGif } from "../core/gif.ts"
import { fitScale, previewArt, previewFix, previewSheet } from "../core/preview.ts"
import { animationOf, defaultSheet, isAnimationName, playOrder, withFrames, type Sheet, type SheetAnimation } from "../core/sheet.ts"
import { atlasOf, spritesheetJson } from "../core/spritesheet.ts"
import { encodeRecipe, type GridChoice, type Recipe } from "../core/recipe.ts"
import { checkImage, compareReports, reportOfArt, reportOfFix, reportOfSheet, type Report, type Verdict } from "../core/report.ts"
import { artOfImage, formatSprite } from "../core/sprite.ts"
import { CliFailure, CONFIG_FILE, decodeOrFail, loadConfig, loadPalette, starterConfig, type Config } from "./config.ts"
import { outputBase, printJson, readPicture, readProjectRecipeOf, readSource, readText, writeBytes, writePng, writeProject, writeText } from "./io.ts"

/** Ends the run with an exit code, already reported on stdout. */
export class Exit extends Data.TaggedError("Exit")<{ readonly code: number }> {
  override get [Runtime.errorExitCode](): number {
    return this.code
  }
  override readonly [Runtime.errorReported] = false
}

const exitCode: Record<Verdict, number> = { clean: 0, fixable: 3, "needs-person": 4 }

const exitWith = (code: number): Effect.Effect<void, Exit> => (code === 0 ? Effect.void : Effect.fail(new Exit({ code })))

// Flags shared by several commands.

const config = Flag.String("config").pipe(Flag.withDescription(`The project config (default: the nearest ${CONFIG_FILE} above the working directory).`), Flag.optional)
const recipeFlag = Flag.String("recipe").pipe(Flag.withDescription("A recipe file (saved by the web page or a previous fix) to start from."), Flag.optional)
const palette = Flag.String("palette").pipe(
  Flag.withAlias("p"),
  Flag.withDescription('The palette: a preset (see `ritmo-tools pixel palettes`), a .hex or .gpl file, or hex colors like "#000,#fff".'),
  Flag.optional
)
const colors = Flag.Int("colors").pipe(Flag.withDescription("Without a palette, propose one of this many colors from the picture itself."), Flag.optional)
const out = Flag.String("out").pipe(Flag.withAlias("o"), Flag.withDescription("Where to write, without extension (default: next to the input)."), Flag.optional)
const scale = Flag.Int("scale").pipe(Flag.withDescription("Also write a PNG enlarged this many times."), Flag.withDefault(1))
const removeBackground = Flag.Boolean("remove-background").pipe(Flag.withDefault(false), Flag.withDescription("Make the background around the subject transparent."))
const crop = Flag.Boolean("crop").pipe(Flag.withDefault(false), Flag.withDescription("Write the art without its transparent margins (with --remove-background: just the subject)."))
const cleanup = Flag.Int("cleanup").pipe(Flag.withDescription("Merge specks up to this many pixels into their surroundings."), Flag.optional)
const metric = Flag.Literals("metric", ["oklab", "ciede2000"]).pipe(Flag.withDescription("How color distance is measured."), Flag.optional)
const dither = Flag.Boolean("dither").pipe(Flag.withDefault(false), Flag.withDescription("Ordered dithering where the palette has no close color."))
const shrink = Flag.Int("shrink-to").pipe(Flag.withDescription("Merge pixels down to this width, keeping outlines."), Flag.optional)

/** Settings given on the command line, over the recipe. */
interface Overrides {
  readonly palette: Option.Option<string>
  readonly removeBackground: boolean
  readonly crop: boolean
  readonly cleanup: Option.Option<number>
  readonly metric: Option.Option<Metric>
  readonly dither: boolean
  readonly shrink: Option.Option<number>
}

const overrides = { palette, removeBackground, crop, cleanup, metric, dither, shrink }

/**
 * The recipe a command runs: the config's, then the recipe file (or, without
 * one, the recipe stored in the input when it is a project PNG), then the flags.
 * `stored` says whether the input's own recipe was used, for the report.
 */
const recipeOf = Effect.fn("recipeOf")(function* (project: Config, file: Option.Option<string>, flags: Overrides, input?: string) {
  let recipe = project.recipe
  const inside = Option.isNone(file) && input !== undefined ? yield* readProjectRecipeOf(input) : Option.none<string>()
  const text = Option.isSome(file) ? Option.some(yield* readText(file.value)) : inside
  if (Option.isSome(text)) {
    const fromFile = yield* decodeOrFail(text.value, Option.isSome(file) ? file.value : `${input} (its stored recipe)`)
    recipe = { ...fromFile, palette: fromFile.palette ?? recipe.palette }
  }
  if (Option.isSome(flags.palette)) recipe = { ...recipe, palette: yield* loadPalette(flags.palette.value, ".") }
  if (flags.removeBackground) recipe = { ...recipe, removeBackground: true }
  if (flags.crop) recipe = { ...recipe, crop: true }
  if (Option.isSome(flags.cleanup)) recipe = { ...recipe, cleanup: { ...recipe.cleanup, size: flags.cleanup.value } }
  if (Option.isSome(flags.metric)) recipe = { ...recipe, metric: flags.metric.value }
  if (flags.dither) recipe = { ...recipe, dither: "ordered" }
  if (Option.isSome(flags.shrink)) recipe = { ...recipe, targetWidth: flags.shrink.value }
  return { recipe, stored: Option.isSome(inside) }
})

/** What a report says about where its recipe came from: only when the input's own stored recipe ran. */
const storedNote = (stored: boolean): { readonly storedRecipe?: true } => (stored ? { storedRecipe: true } : {})

/** The project's rules, with the recipe's palette when the config names none. */
const rulesOf = (project: Config, recipe: Recipe): LintRules => ({ ...project.rules, palette: project.rules.palette ?? recipe.palette?.colors })

/** Reads "8" or "8x6" as a cell size, and "2,3" as an offset. */
const parseCell = (cell: string, offset: Option.Option<string>): Effect.Effect<GridChoice, CliFailure> => {
  const size = /^(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?$/.exec(cell)
  const shift = Option.isSome(offset) ? /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(offset.value) : ["", "0", "0"]
  if (size === null || shift === null || Number(size[1]) < 1) {
    return Effect.fail(new CliFailure({ message: 'a cell is "8" or "8x6" (pixels, at least 1) and an offset is "2,3"' }))
  }
  const cellWidth = Number(size[1])
  return Effect.succeed({
    kind: "cells",
    spec: { cellWidth, cellHeight: size[2] === undefined ? cellWidth : Number(size[2]), offsetX: Number(shift[1]), offsetY: Number(shift[2]) }
  })
}

/** A palette proposed from the fixed cells' own colors, for a fix without a palette. */
const withProposedPalette = (recipe: Recipe, art: PixelArt, count: number, method: ProposeMethod): Recipe => {
  const cells = [...art.indices].filter((index) => index !== TRANSPARENT).map((index) => art.palette[index]!)
  const proposed = proposePalette(cells, count, method).map((proposal) => proposal.color)
  return { ...recipe, palette: { name: `Proposed (${proposed.length})`, colors: proposed, locked: [] } }
}

interface Fixed {
  readonly recipe: Recipe
  readonly outcome: Outcome | undefined
  readonly report: Report
}

/** Fixes a picture: the grid found (or given), the palette proposed when asked, judged as `check` does. */
const fixImage = (image: Parameters<typeof checkImage>[0], start: Recipe, rules: LintRules, propose: Option.Option<number>, method: ProposeMethod): Fixed => {
  const run = (recipe: Recipe): Fixed => {
    if (recipe.grid.kind === "auto") {
      const checked = checkImage(image, recipe, rules)
      if (checked.outcome === undefined) return checked
      if (checked.report.kind === "pixel-art") return { ...checked, report: reportOfArt(checked.outcome.art, rules, 0, image) }
      return { ...checked, report: reportOfFix(image, checked.recipe, checked.outcome, rules) }
    }
    const outcome = runRecipe(image, recipe)
    if (outcome === undefined) return checkImage(image, recipe, rules)
    return { recipe, outcome, report: reportOfFix(image, recipe, outcome, rules) }
  }
  const first = run(start)
  if (Option.isNone(propose) || start.palette !== undefined || first.outcome === undefined) return first
  // Propose from the first run's cells, then run again with that palette.
  const recipe = withProposedPalette(first.recipe, first.outcome.art, propose.value, method)
  const second = run(recipe)
  return { ...second, report: reportOfFix(image, second.recipe, second.outcome ?? first.outcome, { ...rules, palette: rules.palette ?? recipe.palette?.colors }) }
}

/** Writes the fixed art in every format, and the recipe and preview, returning the files written. */
const writeOutputs = Effect.fn("writeOutputs")(function* (
  base: string,
  art: PixelArt,
  factor: number,
  extra: { readonly recipe?: Recipe; readonly preview?: Parameters<typeof writePng>[1] }
) {
  const files: Record<string, string> = {}
  files.png = yield* writePng(`${base}.png`, toRgba(art))
  if (factor > 1) files.scaled = yield* writePng(`${base}@${factor}x.png`, toRgba(art, factor))
  files.svg = yield* writeText(`${base}.svg`, toSvg(art))
  files.map = yield* writeText(`${base}.json`, toJson(art))
  if (usedColors(art).length <= 70) files.sprite = yield* writeText(`${base}.sprite.txt`, formatSprite(art))
  if (extra.recipe !== undefined) files.recipe = yield* writeText(`${base}.recipe.json`, encodeRecipe(extra.recipe))
  if (extra.preview !== undefined) files.preview = yield* writePng(`${base}.preview.png`, extra.preview)
  return files
})

const preview = (image: Parameters<typeof checkImage>[0], fixed: Fixed): Parameters<typeof writePng>[1] | undefined => {
  if (fixed.outcome === undefined) return undefined
  return fixed.report.kind === "pixel-art" ? previewArt(fixed.outcome.art, fitScale(fixed.outcome.art)) : previewFix(image, fixed.outcome.grid, fixed.outcome.art)
}

// Commands.

const check = Command.make(
  "check",
  { input: Argument.String("input").pipe(Argument.withDescription("A PNG or JPEG, a sprite source, or a JSON map.")), config, recipe: recipeFlag, ...overrides },
  Effect.fn("check")(function* (flags) {
    const project = yield* loadConfig(flags.config)
    const { recipe, stored } = yield* recipeOf(project, flags.recipe, flags, flags.input)
    const source = yield* readSource(flags.input)
    const report = source.kind === "art" ? reportOfArt(source.art, rulesOf(project, recipe)) : checkImage(source.image, recipe, rulesOf(project, recipe)).report
    yield* printJson({ file: flags.input, ...storedNote(stored), ...report })
    yield* exitWith(exitCode[report.verdict])
  })
).pipe(Command.withDescription("Is this clean pixel art, can it be fixed with confidence, or does a person need to look? Writes nothing."))

const fix = Command.make(
  "fix",
  {
    input: Argument.String("input").pipe(Argument.withDescription("The picture to fix (PNG or JPEG): upscaled or blurry pixel art, or pixel art breaking the project's rules.")),
    config,
    recipe: recipeFlag,
    ...overrides,
    colors,
    cell: Flag.String("cell").pipe(Flag.withDescription('The grid\'s cell size in source pixels, "8" or "8x6", instead of finding it.'), Flag.optional),
    offset: Flag.String("offset").pipe(Flag.withDescription('Where the grid starts, "x,y" in source pixels (with --cell).'), Flag.optional),
    follow: Flag.Boolean("follow").pipe(Flag.withDefault(false), Flag.withDescription("Move each grid line onto its nearest edge, for cells that drift.")),
    project: Flag.Boolean("project").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Also write a project PNG: the input with this fix's recipe stored inside, to open in the web page and finish by hand. Not a game asset.")
    ),
    out,
    scale
  },
  Effect.fn("fix")(function* (flags) {
    const project = yield* loadConfig(flags.config)
    const start = yield* recipeOf(project, flags.recipe, flags, flags.input)
    const stored = start.stored
    let recipe = start.recipe
    if (Option.isSome(flags.cell)) recipe = { ...recipe, grid: yield* parseCell(flags.cell.value, flags.offset) }
    if (flags.follow) recipe = { ...recipe, follow: true }
    const image = yield* readPicture(flags.input)
    const fixed = fixImage(image, recipe, rulesOf(project, recipe), flags.colors, "dominant")
    const base = yield* outputBase(flags.input, Option.getOrUndefined(flags.out), "fixed")
    const extra = { recipe: fixed.recipe, ...(fixed.outcome === undefined ? {} : { preview: preview(image, fixed)! }) }
    const files: Record<string, string> = fixed.outcome === undefined ? {} : yield* writeOutputs(base, fixed.outcome.exported, flags.scale, extra)
    if (flags.project) {
      // Beside the input as <name>.project.png; with --out, beside the other outputs.
      const file = Option.isSome(flags.out) ? `${base}.project.png` : `${yield* outputBase(flags.input, undefined, "project")}.png`
      files.project = yield* writeProject(flags.input, image, file, encodeRecipe(fixed.recipe))
    }
    yield* printJson({ file: flags.input, ...storedNote(stored), ...fixed.report, files })
    yield* exitWith(fixed.report.verdict === "needs-person" ? 4 : fixed.report.issues.some((issue) => issue.severity === "error") ? 3 : 0)
  })
).pipe(Command.withDescription("Fixes a picture into crisp pixel art, and writes it as PNG, SVG, a JSON map, a sprite source, its recipe, and a preview."))

const pixelate = Command.make(
  "pixelate",
  {
    input: Argument.String("input").pipe(Argument.withDescription("A reference picture that is not pixel art (a drawing, a render, a photo).")),
    width: Flag.Int("width").pipe(Flag.withAlias("w"), Flag.withDescription("How many pixels wide the pixel art is.")),
    height: Flag.Int("height").pipe(Flag.withDescription("How many pixels high (default: keeps the picture's proportions)."), Flag.optional),
    colors: Flag.Int("colors").pipe(Flag.withDescription("Without a palette, how many colors to propose from the picture."), Flag.withDefault(16)),
    config,
    recipe: recipeFlag,
    ...overrides,
    out,
    scale
  },
  Effect.fn("pixelate")(function* (flags) {
    const project = yield* loadConfig(flags.config)
    const { recipe: start } = yield* recipeOf(project, flags.recipe, flags)
    if (flags.width < 1) return yield* new CliFailure({ message: "--width must be at least 1" })
    const recipe: Recipe = {
      ...start,
      grid: { kind: "size", width: flags.width, height: Option.getOrUndefined(flags.height) },
      // A reference picture has no flat cells: read most of each one.
      sample: { ...start.sample, inset: Math.min(start.sample.inset, 0.15) }
    }
    const image = yield* readPicture(flags.input)
    const fixed = fixImage(image, recipe, rulesOf(project, recipe), Option.some(flags.colors), "balanced")
    const base = yield* outputBase(flags.input, Option.getOrUndefined(flags.out), "pixel")
    if (fixed.outcome === undefined) return yield* new CliFailure({ message: "the picture could not be cut into pixels" })
    const files = yield* writeOutputs(base, fixed.outcome.exported, flags.scale, { recipe: fixed.recipe, preview: previewFix(image, fixed.outcome.grid, fixed.outcome.art) })
    yield* printJson({ file: flags.input, ...fixed.report, files })
    yield* exitWith(fixed.report.verdict === "needs-person" ? 3 : 0)
  })
).pipe(Command.withDescription("Turns a reference picture into pixel art of a given width, on the project's palette (or one proposed from the picture)."))

const render = Command.make(
  "render",
  {
    input: Argument.String("input").pipe(Argument.withDescription("A sprite source (text) or a JSON map.")),
    config,
    out,
    scale
  },
  Effect.fn("render")(function* (flags) {
    const project = yield* loadConfig(flags.config)
    const source = yield* readSource(flags.input)
    const art = source.kind === "art" ? source.art : artOfImage(source.image).art
    const base = yield* outputBase(flags.input, Option.getOrUndefined(flags.out), "render")
    const files: Record<string, string> = {}
    files.png = yield* writePng(`${base}.png`, toRgba(art))
    if (flags.scale > 1) files.scaled = yield* writePng(`${base}@${flags.scale}x.png`, toRgba(art, flags.scale))
    files.svg = yield* writeText(`${base}.svg`, toSvg(art))
    files.preview = yield* writePng(`${base}.preview.png`, previewArt(art, fitScale(art)))
    const report = reportOfArt(art, project.rules)
    yield* printJson({ file: flags.input, ...report, files })
    yield* exitWith(exitCode[report.verdict])
  })
).pipe(Command.withDescription("Renders a sprite source to PNG and SVG, and lints it against the project's rules."))

const lint = Command.make(
  "lint",
  {
    input: Argument.String("input").pipe(Argument.withDescription("A PNG taken as pixel art at its own size, a sprite source, or a JSON map.")),
    config,
    palette
  },
  Effect.fn("lint")(function* (flags) {
    const project = yield* loadConfig(flags.config)
    const rules: LintRules = Option.isSome(flags.palette) ? { ...project.rules, palette: (yield* loadPalette(flags.palette.value, ".")).colors } : project.rules
    const source = yield* readSource(flags.input)
    const { art, partial } = source.kind === "art" ? { art: source.art, partial: 0 } : artOfImage(source.image)
    const report = reportOfArt(art, rules, partial)
    yield* printJson({ file: flags.input, verdict: report.verdict, summary: report.summary, issues: report.issues })
    yield* exitWith(exitCode[report.verdict])
  })
).pipe(Command.withDescription("Checks pixel art against the project's rules (size, palette, colors, transparency, stray pixels), as it is."))

const previewCommand = Command.make(
  "preview",
  { input: Argument.String("input").pipe(Argument.withDescription("A PNG or JPEG, a sprite source, or a JSON map.")), config, recipe: recipeFlag, ...overrides, out },
  Effect.fn("preview")(function* (flags) {
    const project = yield* loadConfig(flags.config)
    const { recipe } = yield* recipeOf(project, flags.recipe, flags, flags.input)
    const source = yield* readSource(flags.input)
    const base = yield* outputBase(flags.input, Option.getOrUndefined(flags.out), "preview")
    const picture =
      source.kind === "art" ? previewArt(source.art, fitScale(source.art)) : preview(source.image, fixImage(source.image, recipe, rulesOf(project, recipe), Option.none(), "dominant"))
    if (picture === undefined) return yield* new CliFailure({ message: "no grid found to preview: give one with `ritmo-tools pixel fix --cell`" })
    yield* printJson({ file: flags.input, preview: yield* writePng(`${base}.png`, picture) })
  })
).pipe(Command.withDescription("Writes a picture to look at: the art enlarged, or the source with its grid beside the fix."))

const compare = Command.make(
  "compare",
  { a: Argument.String("a"), b: Argument.String("b"), config, recipe: recipeFlag, ...overrides },
  Effect.fn("compare")(function* (flags) {
    const project = yield* loadConfig(flags.config)
    const { recipe } = yield* recipeOf(project, flags.recipe, flags)
    const reportOf = Effect.fn("reportOf")(function* (file: string) {
      const source = yield* readSource(file)
      return source.kind === "art" ? reportOfArt(source.art, rulesOf(project, recipe)) : checkImage(source.image, recipe, rulesOf(project, recipe)).report
    })
    const a = yield* reportOf(flags.a)
    const b = yield* reportOf(flags.b)
    yield* printJson({ ...compareReports(a, b), a: { file: flags.a, ...a }, b: { file: flags.b, ...b } })
  })
).pipe(Command.withDescription("Checks two versions of an asset and says which is better, and why."))

/** Reads "x,y,w,h;x,y,w,h" as frame boxes, in source pixels. */
const parseBoxes = (text: string): Effect.Effect<Sheet["frames"], CliFailure> => {
  const boxes = text.split(/[;\s]+/).filter((part) => part !== "").map((part) => part.split(",").map(Number))
  if (boxes.length === 0 || boxes.some((box) => box.length !== 4 || box.some((value) => !Number.isFinite(value)) || box[2]! < 1 || box[3]! < 1)) {
    return Effect.fail(new CliFailure({ message: 'frame boxes are "x,y,w,h" in source pixels, separated by ";"' }))
  }
  return Effect.succeed(boxes.map(([x, y, width, height]) => ({ box: { x: x!, y: y!, width: width!, height: height! }, include: true, nudge: { x: 0, y: 0 } })))
}

/** Reads "walk=1-4;throw=5,6,7;9-12" as animations: every frame (numbered from 1) in exactly one. */
const parseAnimations = (text: string, count: number): Effect.Effect<Array<SheetAnimation>, CliFailure> => {
  const fail = (message: string) => Effect.fail(new CliFailure({ message }))
  const parts = text.split(";").map((part) => part.trim()).filter((part) => part !== "")
  const seen = new Set<number>()
  const animations: Array<SheetAnimation> = []
  for (const [a, part] of parts.entries()) {
    const named = /^([^=]+)=(.+)$/.exec(part)
    const name = named === null ? `animation-${a + 1}` : named[1]!.trim()
    if (!isAnimationName(name)) return fail(`"${name}" cannot name an animation: use letters, digits, "-", "_", and "."`)
    if (animations.some((animation) => animation.name === name)) return fail(`two animations are named "${name}"`)
    const frames: Array<number> = []
    for (const range of (named === null ? part : named[2]!).split(",")) {
      const bounds = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(range)
      if (bounds === null) return fail(`"${range.trim()}" is not a frame number or a range like "1-4"`)
      const from = Number(bounds[1])
      const to = bounds[2] === undefined ? from : Number(bounds[2])
      for (let n = from; from <= to ? n <= to : n >= to; n += from <= to ? 1 : -1) {
        if (n < 1 || n > count) return fail(`frame ${n} is not on the sheet: its frames are 1 to ${count}`)
        if (seen.has(n)) return fail(`frame ${n} is in more than one animation`)
        seen.add(n)
        frames.push(n - 1)
      }
    }
    animations.push(animationOf(name, frames))
  }
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !seen.has(n))
  if (missing.length > 0) return fail(`frames ${missing.join(", ")} are in no animation: every frame must be in one`)
  return Effect.succeed(animations)
}

const sheetCommand = Command.make(
  "sheet",
  {
    input: Argument.String("input").pipe(Argument.withDescription("An animation sheet (PNG or JPEG): frames in rows of boxes, as image generators make them.")),
    config,
    recipe: recipeFlag,
    ...overrides,
    colors: Flag.Int("colors").pipe(Flag.withDescription("Without a palette, how many colors to propose from all the frames together."), Flag.withDefault(16)),
    cell: Flag.String("cell").pipe(Flag.withDescription('The cell size in source pixels, "11.5", instead of finding it (each frame finds its own offset).'), Flag.optional),
    boxes: Flag.String("boxes").pipe(Flag.withDescription('The frames\' boxes, "x,y,w,h;x,y,w,h" in source pixels, instead of finding them.'), Flag.optional),
    skip: Flag.String("skip").pipe(Flag.withDescription('Frames to leave out of their animation, by number from 1: "1,6".'), Flag.optional),
    animations: Flag.String("animations").pipe(
      Flag.withDescription(
        'How the frames make animations, by frame number from 1: "walk=1-4;throw=5-8;explode=9-18" (a name is optional: "1-4;5-8"). Every frame must be in one. Default: one per row of frames, as the report lists them.'
      ),
      Flag.optional
    ),
    only: Flag.String("only").pipe(Flag.withDescription('The animations to write, by name: "walk,explode" (the others stay in the recipe, left out).'), Flag.optional),
    keepBackground: Flag.Boolean("keep-background").pipe(Flag.withDefault(false), Flag.withDescription("Keep the sheet's background (by default it is cleared, with any painted grid and labels).")),
    anchor: Flag.Literals("anchor", ["ground", "feet", "center", "box"]).pipe(Flag.withDescription("What lines frames up: the ground (default: each frame at its height as drawn, hops kept, sideways drift removed), the feet (pinned to one row), the body's center, or nothing (frames as in their boxes)."), Flag.optional),
    fps: Flag.Finite("fps").pipe(Flag.withDescription("Frames per second, for every animation (default 8)."), Flag.optional),
    pingpong: Flag.Boolean("pingpong").pipe(Flag.withDefault(false), Flag.withDescription("Every animation plays there and back instead of looping from the start.")),
    columns: Flag.Int("columns").pipe(Flag.withDescription("Frames per row on the sheet written; each animation starts a new row (default: one row per animation)."), Flag.optional),
    spacing: Flag.Int("spacing").pipe(Flag.withDescription("Empty pixels between frames, and between animations, on the sheet written."), Flag.withDefault(0)),
    out,
    scale
  },
  Effect.fn("sheet")(function* (flags) {
    const project = yield* loadConfig(flags.config)
    const resolved = yield* recipeOf(project, flags.recipe, flags, flags.input)
    let recipe = resolved.recipe
    if (Option.isSome(flags.cell)) recipe = { ...recipe, grid: yield* parseCell(flags.cell.value, Option.none()) }
    if (!flags.keepBackground) recipe = { ...recipe, removeBackground: true }
    else recipe = { ...recipe, removeBackground: false }
    const image = yield* readPicture(flags.input)
    const cache: AnimationCache = {}
    const start = recipe.sheet ?? defaultSheet
    let sheet: Sheet = Option.isSome(flags.boxes)
      ? withFrames(start, yield* parseBoxes(flags.boxes.value))
      : start.frames.length > 0
        ? start
        : withFrames(start, detectFrames(image, recipe, cache))
    if (sheet.frames.length === 0) return yield* new CliFailure({ message: "no frames found in the sheet: give them with --boxes" })
    if (Option.isSome(flags.skip)) {
      const skipped = new Set(flags.skip.value.split(",").map((part) => Number(part.trim()) - 1))
      sheet = { ...sheet, frames: sheet.frames.map((frame, i) => ({ ...frame, include: !skipped.has(i) })) }
    }
    if (Option.isSome(flags.animations)) sheet = { ...sheet, animations: yield* parseAnimations(flags.animations.value, sheet.frames.length) }
    if (Option.isSome(flags.only)) {
      const wanted = flags.only.value.split(",").map((part) => part.trim()).filter((part) => part !== "")
      const unknown = wanted.filter((name) => !sheet.animations.some((animation) => animation.name === name))
      if (unknown.length > 0) {
        return yield* new CliFailure({ message: `no animation named ${unknown.join(", ")}: the sheet has ${sheet.animations.map((animation) => animation.name).join(", ")}` })
      }
      sheet = { ...sheet, animations: sheet.animations.map((animation) => ({ ...animation, include: wanted.includes(animation.name) })) }
    }
    sheet = {
      ...sheet,
      anchor: Option.getOrElse(flags.anchor, () => sheet.anchor),
      animations: sheet.animations.map((animation) => ({
        ...animation,
        fps: Option.getOrElse(flags.fps, () => animation.fps),
        loop: flags.pingpong ? "pingpong" : animation.loop
      }))
    }
    recipe = { ...recipe, sheet }
    if (recipe.palette === undefined && flags.colors > 0) {
      const proposed = proposeForSheet(image, recipe, sheet, flags.colors, "dominant", cache).map((proposal) => proposal.color)
      recipe = { ...recipe, palette: { name: `Proposed (${proposed.length})`, colors: proposed, locked: [] } }
    }
    const outcome = runSheet(image, recipe, sheet, cache)
    const report = reportOfSheet(image, recipe, outcome, rulesOf(project, recipe))
    const base = yield* outputBase(flags.input, Option.getOrUndefined(flags.out), "sheet")
    const path = yield* Path.Path
    const name = path.basename(base)
    const clips = atlasClips(outcome, sheet)
    const layout = { columns: Option.getOrElse(flags.columns, () => Number.MAX_SAFE_INTEGER), spacing: flags.spacing }
    const atlas = atlasOf(clips, layout)
    const info = (image: string, scale: number) => spritesheetJson({ image, clips, atlas, scale })
    const files: Record<string, string | ReadonlyArray<string>> = {}
    if (clips.length > 0) {
      files.png = yield* writePng(`${base}.png`, toRgba(atlas.art))
      files.json = yield* writeText(`${base}.json`, info(`${name}.png`, 1))
      if (flags.scale > 1) {
        files.scaled = yield* writePng(`${base}@${flags.scale}x.png`, toRgba(atlas.art, flags.scale))
        files.scaledJson = yield* writeText(`${base}@${flags.scale}x.json`, info(`${name}@${flags.scale}x.png`, flags.scale))
      }
      // One GIF and one folder of frames per animation.
      const gifs: Array<string> = []
      const written: Array<string> = []
      for (const clip of clips) {
        const order = playOrder(clip.frames.length, clip.loop).map((i) => clip.frames[i]!)
        gifs.push(yield* writeBytes(`${base}.${clip.name}.gif`, toGif(order, { scale: Math.max(flags.scale, fitScale(clip.frames[0]!, 256)), delay: 1000 / clip.fps })))
        for (const [i, frame] of clip.frames.entries()) written.push(yield* writePng(path.join(`${base}.frames`, clip.name, `${i}.png`), toRgba(frame, flags.scale)))
      }
      files.gifs = gifs
      files.frames = written
    }
    files.recipe = yield* writeText(`${base}.recipe.json`, encodeRecipe(recipe))
    const groupOf = new Map(sheet.animations.flatMap((animation, a) => animation.frames.map((i) => [i, a] as const)))
    files.preview = yield* writePng(
      `${base}.preview.png`,
      previewSheet(
        image,
        sheet.frames.map((frame, i) => ({ ...frame.box, include: frame.include && sheet.animations[groupOf.get(i) ?? 0]?.include === true, group: groupOf.get(i) ?? 0 })),
        clips.map((clip) => ({ frames: clip.frames, anchorY: sheet.anchor === "feet" || sheet.anchor === "ground" ? clip.anchor.y : undefined }))
      )
    )
    yield* printJson({ file: flags.input, ...storedNote(resolved.stored), ...report, files })
    yield* exitWith(report.verdict === "needs-person" ? 4 : report.issues.some((issue) => issue.severity === "error") ? 3 : 0)
  })
).pipe(
  Command.withDescription(
    "Fixes an animation sheet: finds its frames, clears its background and labels, fixes every frame on one grid and one palette, lines them up, and writes a sprite sheet with its JSON, a GIF, each frame, its recipe, and a preview."
  )
)

const palettes = Command.make(
  "palettes",
  { name: Argument.String("name").pipe(Argument.withDescription("A preset to show, or a palette file."), Argument.optional) },
  Effect.fn("palettes")(function* (flags) {
    if (Option.isSome(flags.name)) {
      const found = yield* loadPalette(flags.name.value, ".")
      return yield* printJson({ name: found.name, colors: found.colors.map(toHex) })
    }
    yield* printJson(presets.map((preset) => ({ name: preset.name, colors: preset.colors.length })))
  })
).pipe(Command.withDescription("Lists the preset palettes, or shows one's colors."))

const init = Command.make(
  "init",
  {
    palette: Flag.String("palette").pipe(Flag.withAlias("p"), Flag.withDescription("The project's palette."), Flag.withDefault("sweetie-16")),
    force: Flag.Boolean("force").pipe(Flag.withDefault(false), Flag.withDescription(`Replace an existing ${CONFIG_FILE}.`))
  },
  Effect.fn("init")(function* (flags) {
    const path = yield* Path.Path
    yield* loadPalette(flags.palette, ".")
    const file = path.resolve(CONFIG_FILE)
    const existing = yield* readText(file).pipe(Effect.option)
    if (Option.isSome(existing) && !flags.force) return yield* new CliFailure({ message: `${file} already exists (--force replaces it)` })
    yield* writeText(file, starterConfig(flags.palette))
    yield* printJson({ config: file })
  })
).pipe(Command.withDescription(`Writes a starting ${CONFIG_FILE} (palette, sizes, color limit) in the working directory.`))

export const pixel = Command.make("pixel").pipe(
  Command.withDescription("Ritmo's pixel fixer: checks, fixes, and makes pixel art. Prints JSON; exit 0 clean, 2 usage error, 3 fixable, 4 needs a person."),
  Command.withSubcommands([check, fix, sheetCommand, pixelate, render, lint, previewCommand, compare, palettes, init])
)

