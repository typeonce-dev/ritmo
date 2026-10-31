/** Reading banks, reviews, and the rig's and clips' modules, and writing what the CLI makes, through Effect's FileSystem. */
import { pathToFileURL } from "node:url"
import { Effect, FileSystem, Path } from "effect"
import { decodeBank, decodeReview, emptyReview, reviewPath, type Bank, type Draft, type Review } from "../core/bank.ts"
import { decodeClip, type Clip } from "../core/clip.ts"
import { decodeRig, imageFiles, type Rig } from "../core/rig.ts"
import { decodePng } from "../../pixel/cli/png.ts"
import type { RgbaImage } from "../../pixel/core/grid.ts"
import { CliFailure, readText } from "../../sound/cli/io.ts"

export { CliFailure, printJson, readText, writeBytes, writeText } from "../../sound/cli/io.ts"

/** Reads a bank, failing with every problem in it. */
export const readBank = Effect.fn("readBank")(function* (file: string) {
  const decoded = decodeBank(yield* readText(file))
  if (!decoded.ok) return yield* new CliFailure({ message: `${file} is not a rig bank`, details: { file, problems: decoded.error.split("; ") } })
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

/**
 * Imports a module from the bank's folder as a file, so its imports of the
 * rig module and of other clips resolve. A broken module is a message, not a
 * failure, so `check` can report every draft.
 *
 * Node keeps an imported module for the life of the process, keyed by its
 * URL. Each command imports once, so that is fine here; the review server
 * (which rebakes as files change) must add a cache-busting query to the URL
 * on each rebake (`?v=<n>`), as the scratch experiment did, rather than
 * start a process per bake.
 */
const importModule = Effect.fn("importModule")(function* (bankFile: string, relative: string) {
  const path = yield* Path.Path
  const fs = yield* FileSystem.FileSystem
  const file = path.resolve(path.dirname(bankFile), relative)
  if (!(yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false)))) return { ok: false as const, error: `cannot read ${relative}`, file }
  return yield* Effect.promise(() =>
    import(pathToFileURL(file).href).then(
      (module: unknown) => ({ ok: true as const, module, file }),
      (error: unknown) => ({ ok: false as const, error: `${relative} does not load: ${error instanceof Error ? error.message : String(error)}`, file })
    )
  )
})

/** The rig module, loaded and checked; a broken one is a list of problems. */
export type LoadedRig = { readonly ok: true; readonly rig: Rig; readonly file: string } | { readonly ok: false; readonly error: string; readonly file: string }

/** The bank's rig module, imported as a file and decoded; a broken one is a message, so `rig check` can report it (the other commands fail on it). */
export const loadRig = Effect.fn("loadRig")(function* (bankFile: string, bank: Bank) {
  const imported = yield* importModule(bankFile, bank.rig)
  if (!imported.ok) return imported satisfies LoadedRig
  // The pictures its image parts name, from the rig module's folder; one that does not read is left out, and the decode names it.
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const images = new Map<string, RgbaImage>()
  for (const file of imageFiles(imported.module)) {
    const bytes = yield* fs.readFile(path.resolve(path.dirname(imported.file), file)).pipe(Effect.option)
    if (bytes._tag === "None") continue
    const picture = yield* Effect.try(() => decodePng(bytes.value)).pipe(Effect.option)
    if (picture._tag === "Some") images.set(file, picture.value)
  }
  const decoded = decodeRig(imported.module, images)
  return (decoded.ok ? { ok: true, rig: decoded.value, file: imported.file } : { ok: false, error: `${bank.rig}: ${decoded.error}`, file: imported.file }) satisfies LoadedRig
})

/** A clip's module, loaded and checked against its rig. */
export type LoadedClip = { readonly ok: true; readonly clip: Clip; readonly file: string } | { readonly ok: false; readonly error: string; readonly file: string }

/** A draft's clip module, imported as a file (its imports of the rig module and other clips resolve) and decoded against the rig. */
export const loadClip = Effect.fn("loadClip")(function* (bankFile: string, draft: Draft, rig: Rig) {
  const imported = yield* importModule(bankFile, draft.file)
  if (!imported.ok) return imported satisfies LoadedClip
  const decoded = decodeClip(imported.module, rig)
  return (decoded.ok ? { ok: true, clip: decoded.value, file: imported.file } : { ok: false, error: `${draft.file}: ${decoded.error}`, file: imported.file }) satisfies LoadedClip
})
