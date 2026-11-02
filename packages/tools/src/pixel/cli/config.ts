/**
 * `pixel.config.json`: a project's pixel art rules, found by walking up from
 * the working directory. Every command reads it, so an agent never has to
 * repeat the palette or the sizes on the command line.
 *
 * ```json
 * {
 *   "palette": "sweetie-16",
 *   "sizes": ["16x16", "32x32"],
 *   "maxColors": 16,
 *   "transparentBackground": true,
 *   "recipe": { "cleanup": { "size": 2, "strength": 0.5 } },
 *   "scale": 3,
 *   "backdrops": { "grass": "art/grass-tile.png", "night": "#1a1c2c" },
 *   "standIn": "art/hero.png",
 *   "accept": { "art/torch.png": { "doubles": "the flame's tip is two pixels on purpose" } }
 * }
 * ```
 *
 * The palette is a preset's name, a list of hex colors, or a palette file
 * (`.hex` or `.gpl`) relative to the config. `recipe` holds recipe settings
 * every fix starts from. `scale`, `backdrops`, and `standIn` say how the game
 * shows its art, for `pixel look`: its whole-number scale on the smallest
 * target screen, what art is seen over (a color, or a tile PNG repeated), and
 * its player, to judge size by. `accept` sets apart warnings judged
 * deliberate, per file (relative to the config), each rule with why.
 */
import { Data, Effect, FileSystem, Option, Path, Schema } from "effect"
import type { LintRules } from "../core/lint.ts"
import { parsePalette } from "../core/palette.ts"
import { decodeRecipe, defaultRecipe, presetPalette, type Recipe, type RecipePalette } from "../core/recipe.ts"

export const CONFIG_FILE = "pixel.config.json"

/** A failure the CLI reports and exits on: a missing file, a bad setting. */
export class CliFailure extends Data.TaggedError("CliFailure")<{ readonly message: string; readonly details?: Readonly<Record<string, unknown>> }> {}

const Size = Schema.String.check(Schema.isPattern(/^\d+x\d+$/, { message: 'a size is "WIDTHxHEIGHT", like "16x16"' }))

const ConfigSchema = Schema.Struct({
  palette: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  sizes: Schema.optionalKey(Schema.Array(Size)),
  maxColors: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  transparentBackground: Schema.optionalKey(Schema.Boolean),
  recipe: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  scale: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  backdrops: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  standIn: Schema.optionalKey(Schema.String),
  accept: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String)))
})

export interface Config {
  /** Where the config was read from; undefined when there is none. */
  readonly path: string | undefined
  readonly palette: RecipePalette | undefined
  readonly rules: LintRules
  /** The recipe every fix starts from. */
  readonly recipe: Recipe
  /** How the game shows its art: its scale, its backdrops by name (`#rrggbb`, or a tile PNG's absolute path), and its stand-in sprite's absolute path. */
  readonly look: { readonly scale: number | undefined; readonly backdrops: Readonly<Record<string, string>>; readonly standIn: string | undefined }
  /** Warnings judged deliberate, by file (absolute path), each rule with why. */
  readonly accept: Readonly<Record<string, Readonly<Record<string, string>>>>
}

export const emptyConfig: Config = { path: undefined, palette: undefined, rules: {}, recipe: defaultRecipe, look: { scale: undefined, backdrops: {}, standIn: undefined }, accept: {} }

/** The warnings a file accepts, from the config's `accept`. */
export const acceptFor = Effect.fn("acceptFor")(function* (config: Config, file: string) {
  const path = yield* Path.Path
  return config.accept[path.resolve(file)]
})

/** Reads a palette given as a preset's name, a palette file, or hex colors separated by commas or spaces. */
export const loadPalette = Effect.fn("loadPalette")(function* (value: string | ReadonlyArray<string>, base: string) {
  if (typeof value !== "string") return fromHex(value.join(" "), "Custom")
  const preset = presetPalette(value)
  if (preset !== undefined) return preset
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = path.resolve(base, value)
  if (yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))) {
    const text = yield* fs.readFileString(file).pipe(Effect.mapError(() => new CliFailure({ message: `cannot read the palette file ${file}` })))
    const palette = parsePalette(text, path.basename(file, path.extname(file)))
    if (palette.colors.length === 0) return yield* new CliFailure({ message: `the palette file ${file} holds no colors` })
    return { name: palette.name, colors: palette.colors, locked: [] }
  }
  if (/#?[0-9a-f]{3,6}/i.test(value) && !/[\\/]/.test(value)) return fromHex(value.replace(/,/g, " "), "Custom")
  return yield* new CliFailure({ message: `"${value}" is not a preset palette (see \`ritmo-tools pixel palettes\`), a palette file, or hex colors` })
})

const fromHex = (text: string, name: string): RecipePalette => {
  const palette = parsePalette(text, name)
  return { name: palette.name, colors: palette.colors, locked: [] }
}

/** The nearest pixel.config.json at or above `from`. */
const findConfig = Effect.fn("findConfig")(function* (from: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  let dir = path.resolve(from)
  for (;;) {
    const file = path.join(dir, CONFIG_FILE)
    if (yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))) return Option.some(file)
    const parent = path.dirname(dir)
    if (parent === dir) return Option.none<string>()
    dir = parent
  }
})

/** Reads the config at `explicit`, or the nearest one at or above `from` (the working directory by default). */
export const loadConfig = Effect.fn("loadConfig")(function* (explicit: Option.Option<string>, from = ".") {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = Option.isSome(explicit) ? Option.some(path.resolve(explicit.value)) : yield* findConfig(from)
  if (Option.isNone(file)) return emptyConfig
  const text = yield* fs.readFileString(file.value).pipe(Effect.mapError(() => new CliFailure({ message: `cannot read ${file.value}` })))
  const raw = yield* Effect.try({
    try: (): unknown => JSON.parse(text),
    catch: (error) => new CliFailure({ message: `${file.value} is not JSON: ${String(error)}` })
  })
  const config = yield* Schema.decodeUnknownEffect(ConfigSchema)(raw).pipe(
    Effect.mapError((error) => new CliFailure({ message: `${file.value}: ${error.message}` }))
  )
  const base = path.dirname(file.value)
  const palette = config.palette === undefined ? undefined : yield* loadPalette(config.palette, base)
  const recipe = config.recipe === undefined ? defaultRecipe : yield* decodeOrFail(JSON.stringify(config.recipe), `${file.value} (recipe)`)
  return {
    path: file.value,
    palette,
    rules: {
      palette: palette?.colors,
      sizes: config.sizes?.map((size) => {
        const [width, height] = size.split("x").map(Number)
        return { width: width!, height: height! }
      }),
      maxColors: config.maxColors,
      transparentBackground: config.transparentBackground
    },
    recipe: { ...recipe, palette: recipe.palette ?? palette, removeBackground: recipe.removeBackground || config.transparentBackground === true },
    look: {
      scale: config.scale,
      backdrops: Object.fromEntries(Object.entries(config.backdrops ?? {}).map(([name, value]) => [name, /^#[0-9a-f]{6}$/i.test(value) ? value : path.resolve(base, value)])),
      standIn: config.standIn === undefined ? undefined : path.resolve(base, config.standIn)
    },
    accept: Object.fromEntries(Object.entries(config.accept ?? {}).map(([file, rules]) => [path.resolve(base, file), rules]))
  } satisfies Config
})

/** Decodes a recipe, failing with every problem found. */
export const decodeOrFail = (text: string, where: string): Effect.Effect<Recipe, CliFailure> => {
  const decoded = decodeRecipe(text)
  return decoded.ok ? Effect.succeed(decoded.value) : Effect.fail(new CliFailure({ message: `${where}: ${decoded.error}` }))
}

/** A starting config for `ritmo-tools pixel init`. */
export const starterConfig = (palette: string): string =>
  JSON.stringify(
    {
      palette,
      sizes: ["16x16", "32x32"],
      maxColors: 16,
      transparentBackground: true,
      recipe: { cleanup: { size: 1, strength: 0.5 } }
    },
    null,
    2
  ) + "\n"
