/**
 * The `pixel` commands: the pixel fixer for agents. The same core as the web page (one
 * pipeline, one recipe format), driven from the command line, printing JSON
 * reports and exiting with a code that says what to do next:
 *
 * - 0: clean (or fixed with confidence)
 * - 2: a usage problem, a missing file, a broken sprite source
 * - 3: fixable: rules are broken, `ritmo-tools pixel fix` (or editing the source) fixes them
 * - 4: needs a person: the grid is unsure; look at the preview, or open the recipe in the page
 *
 * `review`, `notes`, and `resolve` are about what a person said, not the
 * art's rules: they exit 0, or 2 on a usage problem. Their lint results are
 * warnings to read, never a failure.
 */
import { Console, Data, Effect, FileSystem, Option, Path, Runtime } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import type { Metric } from "../core/color.ts"
import { toHex } from "../core/color.ts"
import { TRANSPARENT, usedColors, type PixelArt } from "../core/fix.ts"
import { toJson, toRgba, toSvg } from "../core/export.ts"
import type { Issue, LintRules } from "../core/lint.ts"
import { presets, proposePalette, type ProposeMethod } from "../core/palette.ts"
import { runRecipe, type Outcome } from "../core/pipeline.ts"
import { bake as bakeModel, parseBakeModel, type BakedClip } from "../core/bake.ts"
import { atlasClips, detectFrames, proposeForSheet, runSheet, type AnimationCache } from "../core/animation.ts"
import { toGif } from "../core/gif.ts"
import { decodeNormals, encodeNormals, flickerOf, isNormalPreset, makeNormals, NORMAL_CONVENTION, normalIssues, normalPresets, type NormalPreset } from "../core/normals.ts"
import { fitScale, LIT_ROWS, previewArt, previewFix, previewLit, previewOnion, previewSheet, previewTile } from "../core/preview.ts"
import { animationOf, defaultSheet, frameOf, isAnimationName, withFrames, type Sheet, type SheetAnimation } from "../core/sheet.ts"
import { atlasOf, played, spritesheetJson } from "../core/spritesheet.ts"
import { encodeRecipe, type GridChoice, type Outlines, type Recipe } from "../core/recipe.ts"
import { checkImage, compareReports, reportOfArt, reportOfFix, reportOfSheet, type Report, type Verdict } from "../core/report.ts"
import { pixelSummary, resolveComments, reviewSummary } from "../core/review.ts"
import { artOfImage, formatSprite } from "../core/sprite.ts"
import { CliFailure, CONFIG_FILE, decodeOrFail, loadConfig, loadPalette, starterConfig, type Config } from "./config.ts"
import { decodePicture } from "./png.ts"
import { outputBase, printJson, readPicture, readProjectRecipeOf, readSource, readText, writeBytes, writePng, writeProject, writeText } from "./io.ts"
import { findAssets, goneOf, normalFilesOf, pictureOf, readAsset, readReviewFile, reviewPlace, reviewsOf, writeReview, type PixelAsset } from "./library.ts"
import { serve } from "./serve.ts"

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
const outlines = Flag.Literals("outlines", ["auto", "on", "off"]).pipe(
  Flag.withDescription("One-pixel dark outlines: grid lines kept off dark strokes, and a stroke split between two pixels given back to one (auto: when the picture's dark strokes are about one cell wide)."),
  Flag.optional
)

/** Settings given on the command line, over the recipe. */
interface Overrides {
  readonly palette: Option.Option<string>
  readonly removeBackground: boolean
  readonly crop: boolean
  readonly cleanup: Option.Option<number>
  readonly metric: Option.Option<Metric>
  readonly dither: boolean
  readonly shrink: Option.Option<number>
  readonly outlines: Option.Option<Outlines>
}

const overrides = { palette, removeBackground, crop, cleanup, metric, dither, shrink, outlines }

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
  if (Option.isSome(flags.outlines)) recipe = { ...recipe, outlines: flags.outlines.value }
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
    follow: Flag.Literals("follow", ["off", "straight", "bend"]).pipe(
      Flag.withDescription("Move each grid line onto its edges: as a straight line, for cells that drift or are uneven, or bent along the picture, for a warped grid."),
      Flag.optional
    ),
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
    if (Option.isSome(flags.follow)) recipe = { ...recipe, follow: flags.follow.value }
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

const tileFlag = Flag.Literals("tile", ["both", "x", "y"]).pipe(
  Flag.withDescription('The art is a tile that repeats this way: "x" side by side, "y" one over another, "both" to fill an area.'),
  Flag.optional
)

const promised = <A>(what: string, run: () => Promise<A>): Effect.Effect<A, CliFailure> =>
  Effect.tryPromise({ try: run, catch: (error) => new CliFailure({ message: `${what}: ${error instanceof Error ? error.message : String(error)}` }) })

/** What is wrong with the normal map beside an asset, or none. */
const normalLint = Effect.fn("normalLint")(function* (input: string) {
  const [asset] = yield* promised(`cannot read ${input}`, () => findAssets([input]))
  if (asset === undefined) return []
  const got = yield* promised(`cannot read ${input}`, () => readAsset(asset))
  return got.ok ? (got.normal?.issues ?? []) : []
})

/** A normal map named outright is checked against the art of its name, not by the rules for art, which its colors would all break. */
const lintNormalMap = Effect.fn("lintNormalMap")(function* (input: string) {
  const fs = yield* FileSystem.FileSystem
  const stem = input.replace(/\.normal\.png$/i, "")
  const candidates = [`${stem}.png`, `${stem}.txt`, `${stem}.json`]
  let art: string | undefined
  for (const candidate of candidates) {
    if (art === undefined && (yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false)))) art = candidate
  }
  if (art === undefined) return yield* new CliFailure({ message: `${input} is a normal map with no art beside it: it needs ${stem}.png or a sprite source of that name` })
  const issues = yield* normalLint(art)
  const errors = issues.filter((issue) => issue.severity === "error").length
  const verdict: Verdict = errors > 0 ? "fixable" : "clean"
  yield* printJson({ file: input, art, verdict, summary: issues.length === 0 ? `It lines up with ${art}.` : `${issues.length} issue${issues.length === 1 ? "" : "s"} against ${art}.`, issues })
  yield* exitWith(exitCode[verdict])
})

const lint = Command.make(
  "lint",
  {
    input: Argument.String("input").pipe(Argument.withDescription("A PNG taken as pixel art at its own size, a sprite source, or a JSON map.")),
    config,
    palette,
    tile: tileFlag
  },
  Effect.fn("lint")(function* (flags) {
    if (/\.normal\.png$/i.test(flags.input)) return yield* lintNormalMap(flags.input)
    const project = yield* loadConfig(flags.config)
    const rules: LintRules = Option.isSome(flags.palette) ? { ...project.rules, palette: (yield* loadPalette(flags.palette.value, ".")).colors } : project.rules
    const source = yield* readSource(flags.input)
    const { art, partial } = source.kind === "art" ? { art: source.art, partial: 0 } : artOfImage(source.image)
    const report = reportOfArt(art, { ...rules, tile: Option.getOrUndefined(flags.tile) }, partial)
    // The normal map beside it, if it has one, has to match it.
    const normal = yield* normalLint(flags.input)
    const issues = [...report.issues, ...normal]
    const verdict = report.verdict === "clean" && normal.some((issue) => issue.severity === "error") ? "fixable" : report.verdict
    const summary = normal.length === 0 ? report.summary : `${report.summary} Its normal map: ${normal.length} issue${normal.length === 1 ? "" : "s"}.`
    yield* printJson({ file: flags.input, verdict, summary, issues })
    yield* exitWith(exitCode[verdict])
  })
).pipe(Command.withDescription("Checks pixel art against the project's rules (size, palette, colors, transparency, stray pixels), as it is; with --tile, also that its edges meet."))

const previewCommand = Command.make(
  "preview",
  { input: Argument.String("input").pipe(Argument.withDescription("A PNG or JPEG, a sprite source, or a JSON map.")), config, recipe: recipeFlag, ...overrides, tile: tileFlag, out },
  Effect.fn("preview")(function* (flags) {
    const project = yield* loadConfig(flags.config)
    const { recipe } = yield* recipeOf(project, flags.recipe, flags, flags.input)
    const source = yield* readSource(flags.input)
    const base = yield* outputBase(flags.input, Option.getOrUndefined(flags.out), "preview")
    const picture = Option.isSome(flags.tile)
      ? previewTile(source.kind === "art" ? source.art : artOfImage(source.image).art, flags.tile.value)
      : source.kind === "art" ? previewArt(source.art, fitScale(source.art)) : preview(source.image, fixImage(source.image, recipe, rulesOf(project, recipe), Option.none(), "dominant"))
    if (picture === undefined) return yield* new CliFailure({ message: "no grid found to preview: give one with `ritmo-tools pixel fix --cell`" })
    yield* printJson({ file: flags.input, preview: yield* writePng(`${base}.png`, picture) })
  })
).pipe(Command.withDescription("Writes a picture to look at: the art enlarged, the source with its grid beside the fix, or with --tile the art at its own size repeated."))

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
  return Effect.succeed(boxes.map(([x, y, width, height]) => frameOf({ x: x!, y: y!, width: width!, height: height! })))
}

/** Reads "walk=1-4;throw=5,6x3,7;9-12" as animations, every frame (numbered from 1) in exactly one, and the beats of each held frame ("6x3" holds frame 6 for 3). */
const parseAnimations = (text: string, count: number): Effect.Effect<{ readonly animations: Array<SheetAnimation>; readonly holds: ReadonlyMap<number, number> }, CliFailure> => {
  const fail = (message: string) => Effect.fail(new CliFailure({ message }))
  const parts = text.split(";").map((part) => part.trim()).filter((part) => part !== "")
  const seen = new Set<number>()
  const holds = new Map<number, number>()
  const animations: Array<SheetAnimation> = []
  for (const [a, part] of parts.entries()) {
    const named = /^([^=]+)=(.+)$/.exec(part)
    const name = named === null ? `animation-${a + 1}` : named[1]!.trim()
    if (!isAnimationName(name)) return fail(`"${name}" cannot name an animation: use letters, digits, "-", "_", and "."`)
    if (animations.some((animation) => animation.name === name)) return fail(`two animations are named "${name}"`)
    const frames: Array<number> = []
    for (const range of (named === null ? part : named[2]!).split(",")) {
      const bounds = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?(?:x\s*(\d+)\s*)?$/.exec(range)
      if (bounds === null) return fail(`"${range.trim()}" is not a frame number, a range like "1-4", or a held frame like "6x3" (whole beats)`)
      const from = Number(bounds[1])
      const to = bounds[2] === undefined ? from : Number(bounds[2])
      const beats = bounds[3] === undefined ? 1 : Number(bounds[3])
      if (beats < 1) return fail(`"${range.trim()}" holds for no beats: "6x3" shows frame 6 for 3 beats, and a frame shows for 1 without "x"`)
      for (let n = from; from <= to ? n <= to : n >= to; n += from <= to ? 1 : -1) {
        if (n < 1 || n > count) return fail(`frame ${n} is not on the sheet: its frames are 1 to ${count}`)
        if (seen.has(n)) return fail(`frame ${n} is in more than one animation`)
        seen.add(n)
        holds.set(n - 1, beats)
        frames.push(n - 1)
      }
    }
    animations.push(animationOf(name, frames))
  }
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !seen.has(n))
  if (missing.length > 0) return fail(`frames ${missing.join(", ")} are in no animation: every frame must be in one`)
  return Effect.succeed({ animations, holds })
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
        'How the frames make animations, by frame number from 1: "walk=1-4;throw=5,6x3,7,8;explode=9-18" (a name is optional: "1-4;5-8"; "6x3" holds frame 6 for 3 beats). Every frame must be in one. Default: one per row of frames, as the report lists them.'
      ),
      Flag.optional
    ),
    only: Flag.String("only").pipe(Flag.withDescription('The animations to write, by name: "walk,explode" (the others stay in the recipe, left out).'), Flag.optional),
    keepBackground: Flag.Boolean("keep-background").pipe(Flag.withDefault(false), Flag.withDescription("Keep the sheet's background (by default it is cleared, with any painted grid and labels).")),
    anchor: Flag.Literals("anchor", ["ground", "feet", "center", "box"]).pipe(Flag.withDescription("What lines frames up: the ground (default: each frame at its height as drawn, hops kept, sideways drift removed), the feet (pinned to one row), the body's center, or nothing (frames as in their boxes)."), Flag.optional),
    fps: Flag.Finite("fps").pipe(Flag.withDescription("Beats per second, for every animation (default 8): a frame shows for one beat, or as many as --animations holds it for."), Flag.optional),
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
    if (Option.isSome(flags.animations)) {
      const { animations, holds } = yield* parseAnimations(flags.animations.value, sheet.frames.length)
      sheet = { ...sheet, animations, frames: sheet.frames.map((frame, i) => ({ ...frame, beats: holds.get(i) ?? 1 })) }
    }
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
      const onions: Array<string> = []
      const written: Array<string> = []
      for (const clip of clips) {
        const { frames, delays } = played(clip)
        gifs.push(yield* writeBytes(`${base}.${clip.name}.gif`, toGif(frames, { scale: Math.max(flags.scale, fitScale(clip.frames[0]!, 256)), delays })))
        if (clip.frames.length > 1) onions.push(yield* writePng(`${base}.${clip.name}.onion.png`, previewOnion(clip)))
        for (const [i, frame] of clip.frames.entries()) written.push(yield* writePng(path.join(`${base}.frames`, clip.name, `${i}.png`), toRgba(frame, flags.scale)))
      }
      files.gifs = gifs
      files.onions = onions
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

/** A model's outputs share a sheet's layout: each clip from a new row. */
const bakedClips = (clips: ReadonlyArray<BakedClip>, anchor: { readonly x: number; readonly y: number }, pick: (frame: BakedClip["frames"][number]) => PixelArt) =>
  clips.map((clip) => ({
    name: clip.name ?? "still",
    frames: clip.frames.map(pick),
    // `spritesheetJson` reads an anchor as a pixel, and takes its middle and its foot. A model's is the corner between pixels.
    anchor: { x: anchor.x - 0.5, y: anchor.y - 1 },
    fps: clip.fps,
    beats: clip.frames.map(() => 1),
    loop: clip.loop
  }))

/**
 * What an earlier bake of the same model wrote that this one did not: a sheet's
 * JSON when it is now a still, a still's text when it is now a sheet, an
 * animation's GIF and onion picture once it is gone, and a map or shadow the
 * model no longer asks for. Only files that are the bake's own: a sheet JSON
 * for this PNG, text baked from this model, and a normal map with no
 * `.normals.json` beside it (`pixel normals` makes that one).
 */
const staleBakeFiles = Effect.fn("staleBakeFiles")(function* (base: string, model: string, writtenFiles: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const name = path.basename(base)
  const written = new Set(writtenFiles.map((file) => path.resolve(file)))
  const isWritten = (file: string) => written.has(path.resolve(file))
  const exists = (file: string) => fs.exists(file).pipe(Effect.orElseSucceed(() => false))
  const text = (file: string) => fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))
  const stale: Array<string> = []
  const json = `${base}.json`
  if (!isWritten(json) && (yield* exists(json))) {
    const raw = yield* text(json)
    const image = yield* Effect.try((): unknown => (JSON.parse(raw) as { meta?: { image?: unknown } } | null)?.meta?.image).pipe(Effect.orElseSucceed(() => undefined))
    if (image === `${name}.png`) stale.push(json)
  }
  const sprite = `${base}.sprite.txt`
  if (!isWritten(sprite) && (yield* exists(sprite)) && (yield* text(sprite)).includes(`Baked from ${model}:`)) stale.push(sprite)
  const shadow = `${base}.shadow.png`
  if (!isWritten(shadow) && (yield* exists(shadow))) stale.push(shadow)
  const normal = `${base}.normal.png`
  if (!isWritten(normal) && (yield* exists(normal)) && !(yield* exists(`${base}.normals.json`))) stale.push(normal)
  const dir = path.dirname(base)
  const entries = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []))
  // `<name>.<animation>.gif` and `.onion.png`, and not another model's (`<name>.big.turn.gif`).
  for (const entry of entries) {
    if (!entry.startsWith(`${name}.`) || !/^[^.]+\.(gif|onion\.png)$/.test(entry.slice(name.length + 1))) continue
    const file = path.join(dir, entry)
    if (!isWritten(file)) stale.push(file)
  }
  for (const file of stale) yield* fs.remove(file).pipe(Effect.mapError(() => new CliFailure({ message: `cannot remove ${file}, left from an earlier bake` })))
  return stale
})

const bake = Command.make(
  "bake",
  {
    input: Argument.String("input").pipe(Argument.withDescription("A model: `<name>.bake.json`.")),
    config,
    out
  },
  Effect.fn("bake")(function* (flags) {
    if (!/\.bake\.json$/i.test(flags.input)) return yield* new CliFailure({ message: `${flags.input}: name a model \`<name>.bake.json\`, so what it makes sits beside it as \`<name>.png\`` })
    const project = yield* loadConfig(flags.config)
    const parsed = parseBakeModel(yield* readText(flags.input), project.bake)
    if (!parsed.ok) return yield* new CliFailure({ message: `${flags.input} has ${parsed.problems.length} problem${parsed.problems.length === 1 ? "" : "s"}`, details: { file: flags.input, problems: parsed.problems } })
    const model = parsed.value
    const result = bakeModel(model, project.bake, project.palette?.colors)
    const path = yield* Path.Path
    const base = Option.isSome(flags.out) ? flags.out.value.replace(/\.(png|json)$/i, "") : flags.input.replace(/\.bake\.json$/i, "")
    const name = path.basename(base)
    const clips = bakedClips(result.clips, result.anchor, (frame) => frame.art)
    const everyFrame = clips.flatMap((clip) => clip.frames)
    const still = result.clips.length === 1 && result.clips[0]!.name === undefined
    const atlas = atlasOf(clips, { columns: Number.MAX_SAFE_INTEGER, spacing: 0 })
    const atlasPick = (pick: (frame: BakedClip["frames"][number]) => PixelArt) => atlasOf(bakedClips(result.clips, result.anchor, pick), { columns: Number.MAX_SAFE_INTEGER, spacing: 0 })
    const files: Record<string, string | ReadonlyArray<string>> = {}
    files.png = yield* writePng(`${base}.png`, toRgba(atlas.art))
    if (still) files.sprite = yield* writeText(`${base}.sprite.txt`, formatSprite(atlas.art, `Baked from ${path.basename(flags.input)}: change the model, and bake again.`))
    else files.json = yield* writeText(`${base}.json`, spritesheetJson({ image: `${name}.png`, clips, atlas, scale: 1 }))
    if (model.normals) {
      const data = new Uint8ClampedArray(atlas.art.width * atlas.art.height * 4)
      const placed = result.clips.flatMap((clip) => clip.frames)
      atlas.rects.forEach((rect, i) => {
        const normal = placed[i]!.normal
        for (let y = 0; y < rect.h; y++) data.set(normal.data.subarray(y * rect.w * 4, (y + 1) * rect.w * 4), ((rect.y + y) * atlas.art.width + rect.x) * 4)
      })
      files.normal = yield* writePng(`${base}.normal.png`, { width: atlas.art.width, height: atlas.art.height, data })
    }
    if (model.shadow) files.shadow = yield* writePng(`${base}.shadow.png`, toRgba(atlasPick((frame) => frame.shadow).art))
    const moving = clips.filter((clip) => clip.frames.length > 1)
    if (moving.length > 0) {
      const gifs: Array<string> = []
      const onions: Array<string> = []
      for (const clip of moving) {
        const { frames, delays } = played(clip)
        gifs.push(yield* writeBytes(`${base}.${clip.name}.gif`, toGif(frames, { scale: fitScale(frames[0]!, 256), delays })))
        onions.push(yield* writePng(`${base}.${clip.name}.onion.png`, previewOnion(clip)))
      }
      files.gifs = gifs
      files.onions = onions
    }
    const contact = atlasOf(
      [{ name: "all", frames: everyFrame, anchor: { x: 0, y: 0 }, fps: 8, beats: everyFrame.map(() => 1), loop: "forward" as const }],
      { columns: Math.ceil(Math.sqrt(everyFrame.length)), spacing: 2 }
    )
    files.preview = yield* writePng(`${base}.preview.png`, previewArt(contact.art, fitScale(contact.art)))
    const removed = yield* staleBakeFiles(base, path.basename(flags.input), Object.values(files).flat())
    if (removed.length > 0) files.removed = removed
    // The project's rules on every frame, and what is odd about the model.
    const frameIssues = clips.flatMap((clip) =>
      clip.frames.flatMap((art, i) => {
        const report = reportOfArt(art, project.rules)
        return report.issues.map((issue) => (still ? issue : { ...issue, frame: `${clip.name} ${i}` }))
      })
    )
    const { cut } = result
    const cutBy = cut.left + cut.right + cut.up + cut.below
    const modelIssues: ReadonlyArray<Issue> = [
      ...(cutBy === 0
        ? []
        : [{ rule: "bake-cut" as const, severity: "error" as const, message: `The frame cuts the art: it reaches ${[cut.up > 0 ? `${cut.up} up` : "", cut.below > 0 ? `${cut.below} below` : "", cut.left > 0 ? `${cut.left} left` : "", cut.right > 0 ? `${cut.right} right` : ""].filter((part) => part !== "").join(", ")} past it. Grow \`frame\`, or leave a side out to fit`, count: cutBy, at: [] }]),
      ...result.hidden.map((part) => ({ rule: "bake-hidden" as const, severity: "warning" as const, message: `${part.name === undefined ? part.path : `${part.name} (${part.path})`} shows no pixel in any frame: too small, behind another part, or facing away. If it should show, make it bigger, mark it \`detail\`, or paint it`, count: 1, at: [] }))
    ]
    const issues = [...modelIssues, ...frameIssues]
    const errors = issues.filter((issue) => issue.severity === "error").length
    const verdict: Verdict = errors > 0 ? "fixable" : "clean"
    yield* printJson({
      file: flags.input,
      verdict,
      summary: `Baked ${result.parts} part${result.parts === 1 ? "" : "s"} into ${everyFrame.length} frame${everyFrame.length === 1 ? "" : "s"} of ${result.width}×${result.height}${errors === 0 ? "" : `, with ${errors} rule${errors === 1 ? "" : "s"} broken: see issues`}.`,
      frame: { width: result.width, height: result.height, anchor: result.anchor },
      ...(still ? {} : { animations: clips.map((clip) => clip.name) }),
      issues,
      files,
      next: "Open the preview, then judge it in the game at its display size. To change it, change the model and bake again: the PNG is rewritten every time."
    })
    yield* exitWith(exitCode[verdict])
  })
).pipe(
  Command.withDescription(
    "Draws a model of 3D shapes (`<name>.bake.json`) through the project's one camera and light: `.png`, `.sprite.txt` for a still or `.json` for a sheet, and `.preview.png`, with `.normal.png` and `.shadow.png` when the model asks for them. For things with a solid shape, seen from any angle; the design is the model's."
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


// The review: a person goes through the art on a page, and the agent reads back what they said.

const pathsArgument = Argument.String("paths").pipe(
  Argument.withDescription(
    "PNGs, text sprites, or folders to look through for them. Name the folders the game's art is in (`public/art`, `assets/sprites`): a whole game holds much that is not art, and the tools' own outputs are left out."
  ),
  Argument.variadic({ min: 1 })
)

/** The assets under `paths`, failing on a path that is not there, a folder with no art, and a file named outright that cannot be read. */
const assetsUnder = Effect.fn("assetsUnder")(function* (paths: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem
  for (const path of paths) {
    const info = yield* fs.stat(path).pipe(Effect.mapError(() => new CliFailure({ message: `cannot read ${path}` })))
    if (info.type === "Directory") {
      if ((yield* promised(`cannot look through ${path}`, () => findAssets([path]))).length === 0) return yield* new CliFailure({ message: `no PNGs or text sprites in ${path}` })
      continue
    }
    const [asset] = yield* promised(`cannot read ${path}`, () => findAssets([path]))
    const got = asset === undefined ? undefined : yield* promised(`cannot read ${path}`, () => readAsset(asset))
    if (got?.ok === false) return yield* new CliFailure({ message: `${path} cannot be read as pixel art: ${got.problem}` })
  }
  return yield* promised("cannot look through the paths", () => findAssets(paths))
})

/** Past this many a review takes minutes to read, and a person cannot go through it: most likely the paths hold much that is not art. */
const MANY_ASSETS = 500

const tooMany = (found: ReadonlyArray<PixelAsset>): string | undefined =>
  found.length <= MANY_ASSETS ? undefined : `${found.length} assets under these paths, which take minutes to read. Name the folders the game's art is in (\`public/art\`, \`assets/sprites\`), not ones holding renders or captures.`

const normals = Command.make(
  "normals",
  {
    input: Argument.String("input").pipe(Argument.withDescription("The art: a PNG at its true size (a sheet when its JSON sits beside it), or a sprite source.")),
    preset: Flag.Literals("preset", normalPresets).pipe(Flag.withDescription("What the art is of, which sets how the shape is guessed (default: the last run's; else character for a sheet, object for a still)."), Flag.optional),
    strength: Flag.Int("strength").pipe(Flag.withDescription("How steep the shape is, in percent (default: the last run's; else the preset's own)."), Flag.optional),
    force: Flag.Boolean("force").pipe(Flag.withDefault(false), Flag.withDescription("Replace a normal map with no `.normals.json` beside it: one painted by hand."))
  },
  Effect.fn("normals")(function* (flags) {
    const fs = yield* FileSystem.FileSystem
    if (/\.(normal|lit)\.png$/i.test(flags.input)) return yield* new CliFailure({ message: `${flags.input} is what this command writes: name the art it is made from` })
    if (/\.jpe?g$/i.test(flags.input)) return yield* new CliFailure({ message: `${flags.input} is a JPEG, whose colors are too noisy to read surfaces from: run \`ritmo-tools pixel fix\` on it first and name the PNG that writes` })
    const info = yield* fs.stat(flags.input).pipe(Effect.mapError(() => new CliFailure({ message: `cannot read ${flags.input}` })))
    if (info.type === "Directory") return yield* new CliFailure({ message: `${flags.input} is a folder: name one picture, a sheet, or a sprite source. Each has its own map, chosen on purpose` })
    const [asset]: ReadonlyArray<PixelAsset> = yield* assetsUnder([flags.input])
    if (asset === undefined) return yield* new CliFailure({ message: `${flags.input} is not pixel art` })
    const got = yield* promised(`cannot read ${flags.input}`, () => readAsset(asset))
    if (!got.ok) return yield* new CliFailure({ message: `${flags.input} cannot be read: ${got.problem}` })
    const picture = yield* promised(`cannot read ${flags.input}`, () => pictureOf(asset))
    const image = decodePicture(picture.bytes)
    const project = yield* loadConfig(Option.none())
    if (got.sheet === undefined && checkImage(image, project.recipe).report.kind === "upscaled") {
      yield* printJson({ file: flags.input, verdict: "fixable", summary: "This is fake pixels, each many real ones, so there are no surfaces to read.", issues: [], next: `Run \`ritmo-tools pixel fix ${flags.input}\` and name the true-size PNG it writes.` })
      return yield* exitWith(exitCode.fixable)
    }
    const files = normalFilesOf(asset.file)
    const before = yield* fs.readFileString(files.data).pipe(Effect.option)
    const hasMap = yield* fs.exists(files.map).pipe(Effect.orElseSucceed(() => false))
    if (hasMap && Option.isNone(before) && !flags.force) {
      return yield* new CliFailure({ message: `${files.map} has no .normals.json beside it, so it was not made here: it may be painted by hand. --force replaces it` })
    }
    const kept = Option.isSome(before) ? decodeNormals(before.value) : undefined
    if (kept?.ok === false) return yield* new CliFailure({ message: `${files.data}: ${kept.error}` })
    const preset: NormalPreset = Option.getOrElse(flags.preset, () => kept?.value.preset ?? (got.sheet === undefined ? "object" : "character"))
    if (!isNormalPreset(preset)) return yield* new CliFailure({ message: `--preset is one of ${normalPresets.join(", ")}` })
    const strength = Option.isSome(flags.strength) ? flags.strength.value : kept?.value.strength
    if (strength !== undefined && (strength <= 0 || strength > 400)) return yield* new CliFailure({ message: "--strength is in percent, above 0 and up to 400" })
    const corrections = kept?.value.corrections ?? []
    const made = makeNormals(image, got.frames, { preset, strength, corrections })
    const problems = made.corrections.flatMap((result, i) => (result.problem === undefined ? [] : [{ rule: "normal-correction" as const, severity: "error" as const, message: `corrections[${i}] did nothing: ${result.problem}`, count: 1, at: [] }]))
    const issues = [...problems, ...normalIssues(image, made.image, got.frames, undefined)]
    const written = {
      normal: yield* writePng(files.map, made.image),
      data: yield* writeText(files.data, encodeNormals({ preset, strength, corrections, frames: got.frames.map((frame) => frame.hash) })),
      lit: yield* writePng(files.map.replace(/\.normal\.png$/, ".lit.png"), previewLit(image, made.image, got.frames))
    }
    const flicker = flickerOf(image, made.image, got.frames).map((entry) => ({ animation: entry.animation, pixels: entry.pixels, share: Math.round(entry.share * 1000) / 1000 }))
    const verdict: Verdict = problems.length > 0 ? "fixable" : "clean"
    yield* printJson({
      file: flags.input,
      verdict,
      summary: `Made its normal map (${preset}): ${Math.round(made.front * 100)}% of it faces the viewer${flicker.length === 0 ? "" : `, ${flicker.length} animation${flicker.length === 1 ? "" : "s"} measured`}${corrections.length === 0 ? "" : `, ${corrections.length} correction${corrections.length === 1 ? "" : "s"} applied`}.`,
      preset,
      strength,
      convention: NORMAL_CONVENTION,
      front: Math.round(made.front * 1000) / 1000,
      ...(flicker.length === 0 ? {} : { flicker }),
      ...(corrections.length === 0 ? {} : { corrections: corrections.map((correction, i) => ({ ...correction, ...made.corrections[i] })) }),
      issues,
      files: written,
      litShows: got.frames.length === 1 && got.frames[0]!.animation === undefined ? LIT_ROWS.still : LIT_ROWS.sheet,
      next: "The map is an estimate. Open the `lit` picture, then `ritmo-tools pixel review` so the person judges it under a light: comments with a direction come back through `pixel notes`, and go into `corrections` in the `data` file."
    })
    yield* exitWith(exitCode[verdict])
  })
).pipe(
  Command.withDescription(
    "Makes a normal map for pixel art, for a game that lights its sprites: a PNG the art's size beside it, a `.normals.json` with what it was made from and any corrections, and a picture of it lit from each side. A sheet keeps each surface's direction through its animation, and the report says how much still flickers. Corrections live in the `.normals.json`, so they survive running it again. Only for a game that has chosen dynamic light: painted shading needs none of this."
  )
)

const review = Command.make(
  "review",
  {
    paths: pathsArgument,
    port: Flag.Int("port").pipe(Flag.withDescription("The port to serve the page on."), Flag.withDefault(5193)),
    host: Flag.Boolean("host").pipe(Flag.withDefault(false), Flag.withDescription("Serve on the network too, to look on a phone."))
  },
  Effect.fn("review")(function* (flags) {
    const path = yield* Path.Path
    const found = yield* assetsUnder(flags.paths)
    const warning = tooMany(found)
    // A broken review file is said now, not when the page cannot save.
    yield* promised("cannot read the review", () => reviewsOf(found))
    const address = yield* promised("cannot serve the page", () => serve({ paths: flags.paths, port: flags.port, host: flags.host }))
    yield* printJson({
      url: address.url,
      network: address.network,
      assets: found.length,
      warning,
      reviews: [...new Set(found.map((asset) => path.relative(process.cwd(), reviewPlace(asset.file).reviews)))],
      next: "Send the person the url. What they approve and comment is saved as they go; read it back with `ritmo-tools pixel notes`, with the same paths, and `pixel resolve` the comments you act on."
    })
    return yield* Effect.never
  })
).pipe(
  Command.withDescription(
    "Opens the review page for all the pixel art under the paths: the person goes through it by folder, at whole-number zooms over a choice of backdrops, plays sheets by animation, sees the whole set side by side at one scale, approves each asset or asks for changes, and pins comments to an area of pixels on a frame. The lint against each asset's nearest pixel.config.json shows beside it. Runs until stopped; changes are saved as they happen."
  )
)

const notes = Command.make(
  "notes",
  { paths: pathsArgument },
  Effect.fn("notes")(function* (flags) {
    const path = yield* Path.Path
    const found = yield* assetsUnder(flags.paths)
    // Said before the reading, since it takes minutes: an agent that gives up on them still sees why.
    const warning = tooMany(found)
    if (warning !== undefined) yield* Console.error(`ritmo-tools: ${warning}`)
    const reviews = yield* promised("cannot read the review", () => reviewsOf(found))
    const entries = []
    for (const asset of found) {
      const got = yield* promised(`cannot read ${asset.id}`, () => readAsset(asset))
      const said = reviews.assets[asset.id] ?? { status: "new" as const, note: "", comments: [] }
      const source = asset.source === undefined ? {} : { source: path.relative(process.cwd(), asset.source) }
      if (!got.ok) {
        entries.push({ file: asset.id, ...source, ...reviewSummary(said, undefined), problem: got.problem, next: "Fix it: the person cannot see it." })
        continue
      }
      // The lint as warnings to read, each on its frame: never a failure of the notes.
      const lint = got.lint.ok
        ? got.lint.issues.length === 0
          ? {}
          : {
              lint: got.lint.issues.map((issue) => {
                const frame = issue.frame === undefined ? undefined : got.frames[issue.frame]
                return `${frame === undefined ? "" : `${frame.animation ?? ""} frame ${frame.index}: `}${issue.severity}: ${issue.message}`
              })
            }
        : { lint: [`cannot lint: ${got.lint.problem}`] }
      entries.push({ file: asset.id, ...source, ...reviewSummary(said, { frames: got.frames, animations: got.animations, normal: got.normal?.hash }), ...lint })
    }
    const gone = yield* promised("cannot read the review", () => goneOf(found, flags.paths))
    yield* printJson({
      ...pixelSummary(entries),
      gone: gone.map((entry) => ({ ...entry, next: `Its file is gone. If it was renamed, move its review to the new name's key in ${entry.review}; if it was deleted, remove it there.` }))
    })
  })
).pipe(
  Command.withDescription(
    "What the person said in the review of the art under the paths: a summary of what is left, then each asset's status, note, open comments (numbered, each on an area of one frame, with `about: \"map\"` on those about its normal map), how many are resolved, and, for an approved asset that no longer looks as the person saw it, `changedSinceApproved`. An asset with several parts (a sheet's animations, a normal map) also lists `parts`, each with its own status and note, and `goneParts` for reviewed parts it no longer has. Changes asked come first. `gone` lists reviews whose file is no longer found. Exit 0 whatever the art's lint says."
  )
)

const resolve = Command.make(
  "resolve",
  {
    asset: Argument.String("asset").pipe(Argument.withDescription("The asset the comments are on, as `pixel notes` names it.")),
    numbers: Argument.Int("numbers").pipe(Argument.withDescription("The comments' numbers, as `pixel notes` lists them."), Argument.atLeast(1)),
    reply: Flag.String("reply").pipe(Flag.withDescription("What you changed, in a few words: the person reads it beside their comment."), Flag.withDefault(""))
  },
  Effect.fn("resolve")(function* (flags) {
    const path = yield* Path.Path
    const [asset]: ReadonlyArray<PixelAsset> = yield* assetsUnder([flags.asset])
    if (asset === undefined) return yield* new CliFailure({ message: `${flags.asset} is not pixel art` })
    const { reviews, key } = reviewPlace(asset.file)
    const file = yield* promised("cannot read the review", () => readReviewFile(reviews))
    const resolved = resolveComments(file, key, flags.numbers, flags.reply)
    if (!resolved.ok) return yield* new CliFailure({ message: resolved.error })
    const said = resolved.value.assets[key]
    if (said !== undefined) yield* promised("cannot write the review", () => writeReview(asset, said))
    yield* printJson({ review: path.relative(process.cwd(), reviews), asset: asset.id, resolved: flags.numbers, reply: flags.reply === "" ? undefined : flags.reply })
  })
).pipe(
  Command.withDescription(
    "Marks the person's comments on an asset as resolved, by the numbers `pixel notes` gives, with a reply saying what changed. `pixel notes` stops listing them; the page shows them done, with the reply, even while it is open, and the person can reopen one."
  )
)

export const pixel = Command.make("pixel").pipe(
  Command.withDescription(
    "Ritmo's pixel fixer: checks, fixes, and makes pixel art, and opens a review page where a person approves a game's art or pins comments to it. Prints JSON; exit 0 clean, 2 usage error, 3 fixable, 4 needs a person (review, notes, and resolve exit 0 or 2)."
  ),
  Command.withSubcommands([check, fix, sheetCommand, pixelate, render, bake, lint, previewCommand, compare, palettes, init, normals, review, notes, resolve])
)

