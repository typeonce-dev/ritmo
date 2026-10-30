/** Reading banks, reviews, and the drafts' modules, and writing what the CLI makes, through Effect's FileSystem. */
import { Effect, FileSystem, Option, Path } from "effect"
import { loadConfig } from "../../pixel/cli/config.ts"
import { decodePng } from "../../pixel/cli/png.ts"
import { decodeBank, decodeReview, emptyReview, reviewPath, type Bank, type Draft, type Review } from "../core/bank.ts"
import type { Rules } from "../core/check.ts"
import { decodeEffect, type Effect as FxEffect } from "../core/effect.ts"
import { CliFailure, readText } from "../../sound/cli/io.ts"

export { CliFailure, printJson, readText, writeBytes, writeText } from "../../sound/cli/io.ts"

/** Reads a bank, failing with every problem in it. */
export const readBank = Effect.fn("readBank")(function* (file: string) {
  const decoded = decodeBank(yield* readText(file))
  if (!decoded.ok) return yield* new CliFailure({ message: `${file} is not an effects bank`, details: { file, problems: decoded.error.split("; ") } })
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

/** A draft's module, loaded and checked; a broken one is a list of problems, not a failure, so `check` can report every draft. */
export type Loaded = { readonly ok: true; readonly effect: FxEffect; readonly file: string } | { readonly ok: false; readonly error: string; readonly file: string }

/**
 * Loads a draft's module from its source as a `data:` URL, as the review
 * page does with a `blob:` URL: the same in any project (whatever its
 * package type), fresh on every read, and with no imports to resolve.
 */
export const loadDraft = Effect.fn("loadDraft")(function* (bankFile: string, draft: Draft) {
  const path = yield* Path.Path
  const file = path.resolve(path.dirname(bankFile), draft.file)
  const source = yield* readText(file).pipe(Effect.option)
  if (source._tag === "None") return { ok: false, error: `cannot read ${draft.file}`, file } satisfies Loaded
  const loaded = yield* Effect.promise(() =>
    import(`data:text/javascript;base64,${Buffer.from(source.value).toString("base64")}`).then(
      (module: unknown) => ({ ok: true as const, module }),
      (error: unknown) => ({ ok: false as const, error: `${draft.file} does not load: ${error instanceof Error ? error.message : String(error)}` })
    )
  )
  if (!loaded.ok) return { ok: false, error: loaded.error, file } satisfies Loaded
  const decoded = decodeEffect(loaded.module)
  return (decoded.ok ? { ok: true, effect: decoded.value, file } : { ok: false, error: `${draft.file}: ${decoded.error}`, file }) satisfies Loaded
})

/** The project's rules for effects, from `pixel.config.json` (at `explicit`, or the nearest at or above the bank's folder). */
export const readRules = Effect.fn("readRules")(function* (bankFile: string, explicit: Option.Option<string>) {
  const path = yield* Path.Path
  const config = yield* loadConfig(explicit, path.dirname(path.resolve(bankFile)))
  return { config: config.path, rules: { palette: config.rules.palette, maxColors: config.rules.maxColors } satisfies Rules }
})

/** The bank's stand-in sprite, decoded; none when the bank has none. */
export const readStandIn = Effect.fn("readStandIn")(function* (bankFile: string, bank: Bank) {
  if (bank.standIn === undefined) return undefined
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = path.resolve(path.dirname(bankFile), bank.standIn.file)
  const bytes = yield* fs.readFile(file).pipe(Effect.mapError(() => new CliFailure({ message: `cannot read the stand-in ${bank.standIn?.file}`, details: { file } })))
  return yield* Effect.try({
    try: () => decodePng(bytes),
    catch: (error) => new CliFailure({ message: `the stand-in ${bank.standIn?.file} is not a PNG: ${error instanceof Error ? error.message : String(error)}` })
  })
})
