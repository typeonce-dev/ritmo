/**
 * Reading what the CLI is given (pictures, sprite sources, recipes) and
 * writing what it makes, through Effect's FileSystem.
 */
import { Console, Effect, FileSystem, Path } from "effect"
import type { PixelArt } from "../core/fix.ts"
import type { RgbaImage } from "../core/grid.ts"
import { parseJsonMap, parseSprite } from "../core/sprite.ts"
import { CliFailure } from "./config.ts"
import { decodePicture, encodePng } from "./png.ts"

/** A picture to fix, or pixel art already as data (a sprite source or a JSON map). */
export type Source = { readonly kind: "image"; readonly image: RgbaImage } | { readonly kind: "art"; readonly art: PixelArt }

const isPicture = (file: string): boolean => /\.(png|jpe?g)$/i.test(file)

/** Reads a PNG or a JPEG. */
export const readPicture = Effect.fn("readPicture")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem
  const bytes = yield* fs.readFile(file).pipe(Effect.mapError(() => new CliFailure({ message: `cannot read ${file}` })))
  return yield* Effect.try({
    try: () => decodePicture(bytes),
    catch: (error) => new CliFailure({ message: `${file} is not a PNG or a JPEG: ${error instanceof Error ? error.message : String(error)}` })
  })
})

/** Reads a picture (PNG or JPEG), a sprite source (any other text file), or a JSON map (`.json`). */
export const readSource = Effect.fn("readSource")(function* (file: string) {
  if (isPicture(file)) return { kind: "image", image: yield* readPicture(file) } satisfies Source
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(file).pipe(Effect.mapError(() => new CliFailure({ message: `cannot read ${file}` })))
  const parsed = /\.json$/i.test(file) ? parseJsonMap(text) : parseSprite(text)
  if (!parsed.ok) return yield* new CliFailure({ message: `${file} has ${parsed.problems.length} problem${parsed.problems.length === 1 ? "" : "s"}`, details: { file, problems: parsed.problems } })
  return { kind: "art", art: parsed.art } satisfies Source
})

export const readText = Effect.fn("readText")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem
  return yield* fs.readFileString(file).pipe(Effect.mapError(() => new CliFailure({ message: `cannot read ${file}` })))
})

const ensureDir = Effect.fn("ensureDir")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  yield* fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(Effect.mapError(() => new CliFailure({ message: `cannot make the folder for ${file}` })))
})

export const writeText = Effect.fn("writeText")(function* (file: string, text: string) {
  const fs = yield* FileSystem.FileSystem
  yield* ensureDir(file)
  yield* fs.writeFileString(file, text).pipe(Effect.mapError(() => new CliFailure({ message: `cannot write ${file}` })))
  return file
})

export const writeBytes = Effect.fn("writeBytes")(function* (file: string, bytes: Uint8Array) {
  const fs = yield* FileSystem.FileSystem
  yield* ensureDir(file)
  yield* fs.writeFile(file, bytes).pipe(Effect.mapError(() => new CliFailure({ message: `cannot write ${file}` })))
  return file
})

export const writePng = Effect.fn("writePng")(function* (file: string, image: RgbaImage) {
  const fs = yield* FileSystem.FileSystem
  yield* ensureDir(file)
  yield* fs.writeFile(file, encodePng(image)).pipe(Effect.mapError(() => new CliFailure({ message: `cannot write ${file}` })))
  return file
})

/** Prints a value as JSON on stdout: what agents read. */
export const printJson = (value: unknown): Effect.Effect<void> =>
  // Short lists of numbers and strings (pixel positions, colors) stay on one line.
  Console.log(JSON.stringify(value, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, inner: string) => `[${inner.split(/,\s+/).join(", ")}]`))

/** Where outputs go: `--out` as given, or next to the input with a suffix. */
export const outputBase = Effect.fn("outputBase")(function* (input: string, out: string | undefined, suffix: string) {
  const path = yield* Path.Path
  if (out !== undefined) return out.replace(/\.(png|svg|json|txt|gif)$/i, "")
  const name = path.basename(input, path.extname(input))
  return path.join(path.dirname(input), `${name}.${suffix}`)
})
