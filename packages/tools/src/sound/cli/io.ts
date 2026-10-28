/** Reading banks and reviews, and writing what the CLI makes, through Effect's FileSystem. */
import { Console, Data, Effect, FileSystem, Path } from "effect"
import { decodeBank, type Bank } from "../core/recipe.ts"
import { decodeReview, emptyReview, reviewPath, type Review } from "../core/review.ts"

/** A failure the CLI reports and exits on: a missing file, a bad bank. */
export class CliFailure extends Data.TaggedError("CliFailure")<{ readonly message: string; readonly details?: Readonly<Record<string, unknown>> }> {}

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

/** Reads a bank, failing with every problem in it. */
export const readBank = Effect.fn("readBank")(function* (file: string) {
  const decoded = decodeBank(yield* readText(file))
  if (!decoded.ok) return yield* new CliFailure({ message: `${file} is not a sound bank`, details: { file, problems: decoded.error.split("; ") } })
  return decoded.value satisfies Bank
})

/** Reads a bank's review; a bank never reviewed has an empty one. */
export const readReview = Effect.fn("readReview")(function* (bankFile: string) {
  const fs = yield* FileSystem.FileSystem
  const file = reviewPath(bankFile)
  if (!(yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false)))) return emptyReview satisfies Review
  const decoded = decodeReview(yield* readText(file))
  if (!decoded.ok) return yield* new CliFailure({ message: `${file} is not a review`, details: { file, problems: decoded.error.split("; ") } })
  return decoded.value satisfies Review
})

/** Prints a value as JSON on stdout: what agents read. */
export const printJson = (value: unknown): Effect.Effect<void> =>
  // Short lists of numbers and strings stay on one line.
  Console.log(JSON.stringify(value, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, inner: string) => `[${inner.split(/,\s+/).join(", ")}]`))
