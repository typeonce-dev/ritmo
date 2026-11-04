/**
 * `checkSong` away from the page: it renders the whole song, every track on
 * its own too, which takes seconds on a long one. The person moves through the
 * music meanwhile, and keeps typing.
 */
import { checkSong } from "../core/check.ts"
import type { NoteCache } from "../core/render.ts"
import { decodeSong } from "../core/song.ts"

const cache: NoteCache = new Map()

addEventListener("message", (event: MessageEvent<{ readonly ticket: number; readonly songText: string }>) => {
  const song = decodeSong(event.data.songText)
  if (song.ok) postMessage({ ticket: event.data.ticket, report: checkSong(song.value, cache) })
})
