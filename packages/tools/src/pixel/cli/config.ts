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
 *   "recipe": { "cleanup": { "size": 2, "strength": 0.5 } }
 * }
 * ```
 *
 * The palette is a preset's name, a list of hex colors, or a palette file
 * (`.hex` or `.gpl`) relative to the config. `recipe` holds recipe settings
 * every fix starts from.
 */
import { Data, Effect, FileSystem, Option, Path } from "effect"
import { unknownKeys } from "../../internal/keys.ts"
import { defaultBakeSetup, parseBakeSetup, type BakeSetup } from "../core/bake.ts"
import type { LintRules } from "../core/lint.ts"
import { parsePalette } from "../core/palette.ts"
import { decodeRecipe, defaultRecipe, presetPalette, type Recipe, type RecipePalette } from "../core/recipe.ts"

export const CONFIG_FILE = "pixel.config.json"

/** A failure the CLI reports and exits on: a missing file, a bad setting. Exits 2 unless `code` says otherwise (3 for an fx draft that does not draw cleanly, as `fx check` exits). */
export class CliFailure extends Data.TaggedError("CliFailure")<{ readonly message: string; readonly details?: Readonly<Record<string, unknown>>; readonly code?: 2 | 3 | undefined }> {}

interface ConfigFile {
  readonly palette?: string | ReadonlyArray<string>
  readonly sizes?: ReadonlyArray<string>
  readonly maxColors?: number
  readonly transparentBackground?: boolean
  readonly recipe?: Readonly<Record<string, unknown>>
  readonly bake?: unknown
}

const CONFIG_KEYS = ["palette", "sizes", "maxColors", "transparentBackground", "recipe", "bake"]

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The config's settings, or every problem in it: a key it does not know (a typo would turn its rule off), or a value of the wrong kind. */
const decodeConfig = (raw: unknown): { readonly ok: true; readonly value: ConfigFile } | { readonly ok: false; readonly problems: ReadonlyArray<string> } => {
  if (!isRecord(raw)) return { ok: false, problems: ['a config is {"palette": ..., "sizes": ["16x16"], "maxColors": 16, ...}'] }
  const problems = unknownKeys(raw, CONFIG_KEYS)
  const { palette, sizes, maxColors, transparentBackground, recipe } = raw
  if (palette !== undefined && typeof palette !== "string" && !(Array.isArray(palette) && palette.every((color) => typeof color === "string")))
    problems.push("palette must be a preset's name, a palette file, or a list of hex colors")
  if (sizes !== undefined && !(Array.isArray(sizes) && sizes.every((size) => typeof size === "string")))
    problems.push('sizes must be a list of sizes, like ["16x16", "32x32"]')
  else for (const size of sizes ?? []) if (!/^\d+x\d+$/.test(size)) problems.push(`sizes: "${size}" is not a size; a size is "WIDTHxHEIGHT", like "16x16"`)
  if (maxColors !== undefined && !(Number.isInteger(maxColors) && (maxColors as number) >= 1)) problems.push("maxColors must be a whole number, 1 or more")
  if (transparentBackground !== undefined && typeof transparentBackground !== "boolean") problems.push("transparentBackground must be true or false")
  if (recipe !== undefined && !isRecord(recipe)) problems.push("recipe must be an object of recipe settings")
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: raw }
}

export interface Config {
  /** Where the config was read from; undefined when there is none. */
  readonly path: string | undefined
  readonly palette: RecipePalette | undefined
  readonly rules: LintRules
  /** The recipe every fix starts from. */
  readonly recipe: Recipe
  /** The camera, light, and materials every model is baked with. */
  readonly bake: BakeSetup
}

export const emptyConfig: Config = { path: undefined, palette: undefined, rules: {}, recipe: defaultRecipe, bake: defaultBakeSetup }

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
  const decoded = decodeConfig(raw)
  if (!decoded.ok) return yield* new CliFailure({ message: `${file.value} has ${decoded.problems.length} problem${decoded.problems.length === 1 ? "" : "s"}`, details: { file: file.value, problems: decoded.problems } })
  const config = decoded.value
  const base = path.dirname(file.value)
  const bake = parseBakeSetup(config.bake)
  if (!bake.ok) return yield* new CliFailure({ message: `${file.value} has ${bake.problems.length} problem${bake.problems.length === 1 ? "" : "s"} in \`bake\``, details: { file: file.value, problems: bake.problems } })
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
    bake: bake.value
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
