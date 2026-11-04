/**
 * The music a review covers: the songs and plain audio files under the paths
 * the agent names, each with what the person said about it. The page and
 * `music notes` both read it here, so they agree on what there is.
 *
 * A folder's files are found by name; a file named outright is always taken,
 * so an unusual name still opens. What a tool writes beside a song is the
 * song again (its render, its stems) or not music at all (the hum it was built
 * around), so it is left out of a folder.
 */
import { existsSync, statSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { basename, dirname, extname, join, relative, resolve } from "node:path"
import { idOf, posix, rootOf, walk } from "../../internal/files.ts"
import { hashBytes } from "../../internal/hash.ts"
import { mtime } from "../../internal/serve.ts"
import { audioChangedOf, AUDIO_REVIEWS, changedOf, decodeAudioReviews, decodeReview, emptyAudioReview, emptyReview, encodeAudioReviews, reviewPath, type AudioReview, type Review, type Status } from "../core/review.ts"
import { decodeSong, lengthInSeconds, type Song } from "../core/song.ts"
import type { Entry } from "../ui/store.ts"

/** The audio files a browser plays and a game ships. */
export const AUDIO_FILES: ReadonlyArray<string> = [".wav", ".flac", ".mp3", ".ogg", ".m4a"]

export interface MusicFile {
  /** How the page names it: its path from the working directory, with `/` between folders. */
  readonly id: string
  readonly kind: "song" | "audio"
  readonly file: string
}

const fileOf = (file: string): MusicFile => ({ id: idOf(file), kind: AUDIO_FILES.includes(extname(file).toLowerCase()) ? "audio" : "song", file })

/** A song's stems are the song again. */
const isStems = (name: string): boolean => name.endsWith(".stems")

/** Whether a file found in a folder is music to review, among the folder's other files. */
const isMusic = (file: string, all: ReadonlySet<string>): boolean => {
  if (file.endsWith(".song.json")) return true
  if (!AUDIO_FILES.includes(extname(file).toLowerCase()) || file.endsWith(".reference.wav")) return false
  // `music render` writes `theme.song.wav` beside `theme.song.json`: the same music.
  return !all.has(`${file.slice(0, -extname(file).length)}.json`)
}

/** Every song and audio file under `paths` (files or folders), in path order; a path that is gone is passed over. */
export const findMusic = async (paths: ReadonlyArray<string>): Promise<ReadonlyArray<MusicFile>> => {
  const files = new Map<string, MusicFile>()
  for (const path of paths) {
    const absolute = resolve(path)
    if (!existsSync(absolute)) continue
    if (statSync(absolute).isDirectory()) {
      const all = await walk(absolute, isStems)
      const names = new Set(all)
      for (const file of all) if (isMusic(file, names)) files.set(file, fileOf(file))
    } else files.set(absolute, fileOf(absolute))
  }
  return [...files.values()].sort((a, b) => a.id.localeCompare(b.id))
}

// ---------------------------------------------------------------------------
// Where a plain audio file's review lives

/** Where a plain audio file's review is kept: the shared file, and the file's key in it. */
export const audioReviewPlace = (file: string): { readonly reviews: string; readonly key: string } => {
  const root = rootOf(file)
  return { reviews: join(root, AUDIO_REVIEWS), key: posix(relative(root, file)) }
}

const readAudioReviews = async (reviews: string): Promise<Readonly<Record<string, AudioReview>>> => {
  const text = await readFile(reviews, "utf8").catch(() => null)
  if (text === null) return {}
  const decoded = decodeAudioReviews(text)
  if (!decoded.ok) throw new Error(`${reviews}: ${decoded.error}`)
  return decoded.value
}

export const readAudioReview = async (file: string): Promise<AudioReview> => {
  const { reviews, key } = audioReviewPlace(file)
  return (await readAudioReviews(reviews))[key] ?? emptyAudioReview
}

let writing: Promise<unknown> = Promise.resolve()

/** Writes one file's review into the shared file, one write at a time: each reads what the last one wrote. */
export const writeAudioReview = (file: string, review: AudioReview): Promise<void> => {
  const { reviews, key } = audioReviewPlace(file)
  const write = writing.then(async () => writeFile(reviews, encodeAudioReviews({ ...(await readAudioReviews(reviews)), [key]: review })))
  writing = write.catch(() => undefined)
  return write
}

/** A hash of the file, kept while the file does not change: a long track takes a moment to hash. */
const hashes = new Map<string, { readonly time: number; readonly hash: string }>()
export const hashFile = async (file: string): Promise<string> => {
  const time = await mtime(file)
  const known = hashes.get(file)
  if (known?.time === time) return known.hash
  const hash = hashBytes(await readFile(file))
  hashes.set(file, { time, hash })
  return hash
}

// ---------------------------------------------------------------------------
// What each one is, for the page's list and `music notes`

/** Changes when the file or its review does, so the page can follow the agent's edits. */
export const versionOf = async (music: MusicFile): Promise<string> => `${await mtime(music.file)}:${await mtime(music.kind === "song" ? reviewPath(music.file) : audioReviewPlace(music.file).reviews)}`

export type Read =
  | { readonly kind: "song"; readonly song: Song; readonly review: Review }
  | { readonly kind: "audio"; readonly hash: string; readonly review: AudioReview }
  | { readonly kind: "broken"; readonly problem: string }

export const readMusic = async (music: MusicFile): Promise<Read> => {
  try {
    if (music.kind === "audio") return { kind: "audio", hash: await hashFile(music.file), review: await readAudioReview(music.file) }
    const song = decodeSong(await readFile(music.file, "utf8"))
    if (!song.ok) return { kind: "broken", problem: song.error }
    const text = await readFile(reviewPath(music.file), "utf8").catch(() => null)
    const review = text === null ? { ok: true as const, value: emptyReview } : decodeReview(text)
    if (!review.ok) return { kind: "broken", problem: `${reviewPath(music.file)}: ${review.error}` }
    return { kind: "song", song: song.value, review: review.value }
  } catch (error) {
    return { kind: "broken", problem: error instanceof Error ? error.message : String(error) }
  }
}

const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`

/** How the page's list names a file: a song without its suffixes, an audio file as it is. */
const nameOf = (music: MusicFile): string => {
  const name = basename(music.file)
  return music.kind === "song" ? name.replace(/\.json$/, "").replace(/\.song$/, "") : name
}

const entryOf = async (music: MusicFile): Promise<Entry> => {
  const read = await readMusic(music)
  const base = { id: music.id, kind: music.kind, name: nameOf(music), folder: posix(dirname(music.id)), version: await versionOf(music) }
  if (read.kind === "broken") return { ...base, status: "new" satisfies Status, changed: undefined, meta: "Cannot be read", problem: read.problem }
  if (read.kind === "song") {
    return { ...base, status: read.review.status, changed: changedOf(read.review, read.song), meta: `${read.song.tempo} BPM · ${clock(lengthInSeconds(read.song))}`, problem: undefined }
  }
  return { ...base, status: read.review.status, changed: audioChangedOf(read.review, read.hash), meta: `${extname(music.file).slice(1).toUpperCase()} file`, problem: undefined }
}

const entries = new Map<string, Entry>()

/** The page's list; an entry is read again only when its files change. */
export const libraryOf = async (files: ReadonlyArray<MusicFile>): Promise<ReadonlyArray<Entry>> =>
  Promise.all(
    files.map(async (music) => {
      const known = entries.get(music.id)
      if (known !== undefined && known.version === (await versionOf(music))) return known
      const entry = await entryOf(music)
      entries.set(music.id, entry)
      return entry
    })
  )
