/** Reading songs, reviews, and audio through Effect's FileSystem; writing goes through the sound lab's helpers. */
import { Effect, FileSystem } from "effect"
import { CliFailure, readText } from "../../sound/cli/io.ts"
import { decodeReview, emptyReview, reviewPath, type Review } from "../core/review.ts"
import { decodeSong, type Song } from "../core/song.ts"

export const readBytes = Effect.fn("readBytes")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem
  return yield* fs.readFile(file).pipe(Effect.mapError(() => new CliFailure({ message: `cannot read ${file}` })))
})

/** Reads a song, failing with every problem in it. */
export const readSong = Effect.fn("readSong")(function* (file: string) {
  const decoded = decodeSong(yield* readText(file))
  if (!decoded.ok) return yield* new CliFailure({ message: `${file} is not a song`, details: { file, problems: decoded.error.split("; ") } })
  return decoded.value satisfies Song
})

/** Reads a song's review; a song never reviewed has an empty one. */
export const readReview = Effect.fn("readReview")(function* (songFile: string) {
  const fs = yield* FileSystem.FileSystem
  const file = reviewPath(songFile)
  if (!(yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false)))) return emptyReview satisfies Review
  const decoded = decodeReview(yield* readText(file))
  if (!decoded.ok) return yield* new CliFailure({ message: `${file} is not a review`, details: { file, problems: decoded.error.split("; ") } })
  return decoded.value satisfies Review
})
