/**
 * Where the review page reads and writes the music: the CLI's server
 * (`serverStore`, the files the agent reads back), or the tab itself
 * (`memoryStore`, the website's demo, one song).
 */
import { changedOf, decodeReview, emptyReview, type Status } from "../core/review.ts"
import { decodeSong } from "../core/song.ts"

/** One song or plain audio file on the page's list. */
export interface Entry {
  readonly id: string
  readonly kind: "song" | "audio"
  /** Its name on the list. */
  readonly name: string
  /** The folder it is in, from where the review was started. */
  readonly folder: string
  readonly status: Status
  /** What changed since the person approved it, when something has. */
  readonly changed: string | undefined
  /** A few words under its name. */
  readonly meta: string
  /** Why it cannot be opened, when it cannot. */
  readonly problem: string | undefined
  /** Changes when its files do, so the page can follow the agent's edits. */
  readonly version: string
}

/** A song and its review as the page opens them. */
export interface SongSession {
  readonly kind: "song"
  readonly id: string
  /** The song's path, shown when pointing at its name. */
  readonly song: string
  readonly name: string
  readonly songText: string
  readonly reviewText: string | null
  readonly version: string
}

/** A plain audio file's review as the page opens it; the sound itself comes from `readFile`. */
export interface AudioSession {
  readonly kind: "audio"
  readonly id: string
  /** The file's path, shown when pointing at its name. */
  readonly file: string
  readonly name: string
  readonly reviewText: string
  /** A hash of the file now, kept in the review when the person approves it. */
  readonly hash: string
  readonly version: string
}

export type Session = SongSession | AudioSession

export interface Store {
  /** Everything to review now, or `undefined` when it cannot be read (the CLI was stopped). */
  readonly library: () => Promise<ReadonlyArray<Entry> | undefined>
  /** One entry and its review, or `undefined` when it is gone. */
  readonly session: (id: string) => Promise<Session | undefined>
  /** Writes an entry's song or review; resolves with the entry's new version. */
  readonly save: (id: string, file: "song" | "review", text: string) => Promise<string>
  /** A plain audio file's bytes, or `undefined` when it cannot be read. */
  readonly readFile: (id: string) => Promise<ArrayBuffer | undefined>
  /** An audio file next to a song (the hum), or `undefined` when there is none. */
  readonly readAudio: (id: string, name: string) => Promise<ArrayBuffer | undefined>
  /** Keeps an audio file next to a song; fails with `SERVER_GONE` when the server cannot be reached. */
  readonly writeAudio: (id: string, name: string, bytes: Uint8Array<ArrayBuffer>) => Promise<void>
  /** Whether someone else (the agent) can change the files while the page is open. */
  readonly follows: boolean
  /** A demo: nothing is written anywhere, and the page says so. */
  readonly demo: boolean
}

/** What a save failure says when the server cannot be reached at all. */
export const SERVER_GONE = "the review server is not running. Start `ritmo-tools music review` again, then reload this page"

const isSession = (value: unknown): value is Session => typeof value === "object" && value !== null && "kind" in value && "version" in value && typeof value.version === "string"

const isEntries = (value: unknown): value is { readonly entries: ReadonlyArray<Entry> } => typeof value === "object" && value !== null && "entries" in value && Array.isArray(value.entries)

const versionOf = (answer: unknown): string | undefined =>
  typeof answer === "object" && answer !== null && "version" in answer && typeof answer.version === "string" ? answer.version : undefined

const put = async (path: string, body: BodyInit): Promise<unknown> => {
  const response = await fetch(`/api/${path}`, { method: "PUT", body }).catch(() => {
    throw new Error(SERVER_GONE)
  })
  const answer: unknown = await response.json()
  if (!response.ok) throw new Error(typeof answer === "object" && answer !== null && "error" in answer ? String(answer.error) : response.statusText)
  return answer
}

const query = (id: string): string => `?id=${encodeURIComponent(id)}`

const bytesOf = async (url: string): Promise<ArrayBuffer | undefined> => {
  try {
    const response = await fetch(url)
    return response.ok ? await response.arrayBuffer() : undefined
  } catch {
    return undefined
  }
}

/** The API `ritmo-tools music review` serves beside the page (`cli/serve.ts`). */
export const serverStore: Store = {
  library: async () => {
    try {
      const answer: unknown = await (await fetch("/api/library")).json()
      return isEntries(answer) ? answer.entries : undefined
    } catch {
      return undefined
    }
  },
  session: async (id) => {
    const answer: unknown = await (await fetch(`/api/session${query(id)}`)).json()
    return isSession(answer) ? answer : undefined
  },
  save: async (id, file, text) => versionOf(await put(`${file}${query(id)}`, text)) ?? "",
  readFile: (id) => bytesOf(`/api/file${query(id)}`),
  readAudio: (id, name) => bytesOf(`/api/audio/${encodeURIComponent(name)}${query(id)}`),
  writeAudio: async (id, name, bytes) => {
    await put(`audio/${encodeURIComponent(name)}${query(id)}`, bytes)
  },
  follows: true,
  demo: false
}

/** A song kept in the tab, with its audio files by name: what the person changes lasts until the page closes. */
export const memoryStore = (name: string, songText: string, audio: ReadonlyMap<string, () => Promise<ArrayBuffer>>): Store => {
  let song = songText
  let review: string | null = null
  let version = 0
  const kept = new Map<string, ArrayBuffer>()
  return {
    library: async () => {
      const decoded = decodeSong(song)
      const said = review === null ? undefined : decodeReview(review)
      const value = said?.ok === true ? said.value : emptyReview
      return [
        {
          id: name,
          kind: "song",
          name,
          folder: ".",
          status: value.status,
          changed: decoded.ok ? changedOf(value, decoded.value) : undefined,
          meta: "",
          problem: decoded.ok ? undefined : decoded.error,
          version: String(version)
        }
      ]
    },
    session: async () => ({ kind: "song", id: name, song: name, name, songText: song, reviewText: review, version: String(version) }),
    save: async (_, file, text) => {
      if (file === "song") song = text
      else review = text
      version += 1
      return String(version)
    },
    readFile: async () => undefined,
    readAudio: async (_, file) => {
      const found = kept.get(file)
      if (found !== undefined) return found.slice(0)
      const load = audio.get(file)
      if (load === undefined) return undefined
      const bytes = await load()
      kept.set(file, bytes)
      return bytes.slice(0)
    },
    writeAudio: async (_, file, bytes) => {
      kept.set(file, bytes.slice().buffer)
    },
    follows: false,
    demo: true
  }
}
