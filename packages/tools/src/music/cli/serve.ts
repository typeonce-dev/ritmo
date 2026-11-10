/**
 * The music review page on localhost, and a small API beside it that lists
 * the music and reads and writes each song, each review, and the reference
 * audio next to a song, so what the person edits, records, and says lands in
 * the files the agent reads. The page checks each file's version every moment,
 * so a song the agent rewrites, or adds, while the page is open shows up in it.
 *
 * Only what the library finds under the paths the agent named is served: an
 * `id` names one of those, never a path to read. Every song and review
 * write carries the version the page read (`internal/save.ts`), and the
 * only audio the page writes is a song's hum, under the one name it has.
 */
import { readFile } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { writeWhole } from "../../internal/files.ts"
import { textVersion } from "../../internal/save.ts"
import { body, heldFile, send, servePage, writeChecked, type Address, type Handler } from "../../internal/serve.ts"
import { decodeAudioReview, decodeReview, encodeAudioReview, encodeReview, reviewPath } from "../core/review.ts"
import { decodeSong, encodeSong } from "../core/song.ts"
import { findMusic, hashFile, libraryOf, readAudioReview, versionOf, writeAudioReview, type MusicFile } from "./library.ts"

export interface ServeOptions {
  /** The songs, audio files, and folders to review. */
  readonly paths: ReadonlyArray<string>
  readonly port: number
  readonly host: boolean
}

/** Audio files live next to the song, by a plain name: nothing outside its folder is read. */
const audioName = (name: string): string | undefined => (/^[\w.-]+\.wav$/.test(name) && !name.startsWith(".") ? name : undefined)

/** The one audio file the page writes next to a song: its hum, as `music listen` names it too. */
const humOf = (song: string): string => `${basename(song).replace(/\.json$/, "")}.reference.wav`

/** Whether the bytes are a WAV file (RIFF, WAVE). */
const isWav = (bytes: Uint8Array): boolean => bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WAVE"

/** The API over the music under `paths`. */
export const api = (paths: ReadonlyArray<string>): Handler => {
  const named = async (request: IncomingMessage): Promise<MusicFile | undefined> => {
    const id = new URL(request.url ?? "/", "http://localhost").searchParams.get("id")
    return (await findMusic(paths)).find((music) => music.id === id)
  }
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/")
      const route = `${request.method ?? "GET"} ${path}`
      if (route === "GET /library") return send(response, 200, { entries: await libraryOf(await findMusic(paths)) })
      const music = await named(request)
      if (music === undefined) return send(response, 404, { error: `no such music for ${route}` })
      /** What a write answers: the music's version (what the list shows), and the file's own (what the page's next write is based on). */
      const written = async (text: string) => ({ version: await versionOf(music), base: textVersion(text) })
      if (route === "GET /session") {
        const name = basename(music.file)
        const version = await versionOf(music)
        if (music.kind === "audio") return send(response, 200, { kind: "audio", id: music.id, file: music.file, name, reviewText: encodeAudioReview(await readAudioReview(music.file)), hash: await hashFile(music.file), version })
        const reviewText = await readFile(reviewPath(music.file), "utf8").catch(() => null)
        return send(response, 200, { kind: "song", id: music.id, song: music.file, name, songText: await readFile(music.file, "utf8"), reviewText, version })
      }
      if (route === "PUT /song" && music.kind === "song") {
        const decoded = decodeSong((await body(request)).toString("utf8"))
        if (!decoded.ok) return send(response, 400, { error: decoded.error })
        const text = encodeSong(decoded.value)
        return writeChecked(request, response, heldFile(music.file), async () => {
          await writeWhole(music.file, text)
          return written(text)
        })
      }
      if (route === "PUT /review") {
        const text = (await body(request)).toString("utf8")
        if (music.kind === "audio") {
          const decoded = decodeAudioReview(text)
          if (!decoded.ok) return send(response, 400, { error: decoded.error })
          // The page reads this review as `encodeAudioReview` gives it, from a file shared with other audio: that text is its version.
          const held = async () => {
            const now = encodeAudioReview(await readAudioReview(music.file))
            return { text: now, version: textVersion(now) }
          }
          return writeChecked(request, response, held, async () => {
            await writeAudioReview(music.file, decoded.value)
            return written(encodeAudioReview(decoded.value))
          })
        }
        const decoded = decodeReview(text)
        if (!decoded.ok) return send(response, 400, { error: decoded.error })
        const review = encodeReview(decoded.value)
        return writeChecked(request, response, heldFile(reviewPath(music.file)), async () => {
          await writeWhole(reviewPath(music.file), review)
          return written(review)
        })
      }
      if (route === "GET /file" && music.kind === "audio") {
        response.setHeader("content-type", "application/octet-stream")
        response.setHeader("cache-control", "no-store")
        response.end(await readFile(music.file))
        return
      }
      if (path.startsWith("/audio/") && music.kind === "song") {
        const name = audioName(path.slice("/audio/".length))
        if (name === undefined) return send(response, 400, { error: "audio files are plain names ending in .wav" })
        const file = join(dirname(music.file), name)
        if (request.method === "PUT") {
          if (name !== humOf(music.file)) return send(response, 400, { error: `the page keeps only the song's hum, ${humOf(music.file)}` })
          const bytes = await body(request)
          if (!isWav(bytes)) return send(response, 400, { error: "a hum is a WAV file" })
          await writeWhole(file, bytes)
          return send(response, 200, { audio: name })
        }
        const bytes = await readFile(file).catch(() => null)
        if (bytes === null) return send(response, 404, { error: `no ${name} next to the song` })
        response.setHeader("content-type", "audio/wav")
        response.setHeader("cache-control", "no-store")
        response.end(bytes)
        return
      }
      return send(response, 404, { error: `no ${route}` })
    } catch (error) {
      return send(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/** Starts the page; resolves with its address once it listens. */
export const serve = (options: ServeOptions): Promise<Address> =>
  servePage({ from: dirname(fileURLToPath(import.meta.url)), name: "music-lab-api", port: options.port, host: options.host }, api(options.paths))
