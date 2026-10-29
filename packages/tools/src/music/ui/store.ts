/**
 * Where the review page reads and writes a song, its review, and the audio
 * next to it: the CLI's server (`serverStore`, the files the agent reads
 * back), or the tab itself (`memoryStore`, the website's demo).
 */

/** A song and its review as the page opens them. */
export interface Session {
  /** The song's path, shown when pointing at its name. */
  readonly song: string
  readonly name: string
  readonly songText: string
  readonly reviewText: string | null
  /** Changes when either file does, so the page can follow the agent's edits. */
  readonly version: string
}

export interface Store {
  /** The song and its review, or `undefined` when there is none to open. */
  readonly session: () => Promise<Session | undefined>
  /** The files' version now, or `undefined` when it cannot be read (the CLI was stopped). */
  readonly version: () => Promise<string | undefined>
  /** Writes the song or the review; resolves with the new version. */
  readonly save: (file: "song" | "review", text: string) => Promise<string>
  /** An audio file next to the song (the hum), or `undefined` when there is none. */
  readonly readAudio: (name: string) => Promise<ArrayBuffer | undefined>
  /** Keeps an audio file next to the song; fails with `SERVER_GONE` when the server cannot be reached. */
  readonly writeAudio: (name: string, bytes: Uint8Array<ArrayBuffer>) => Promise<void>
  /** Whether someone else (the agent) can change the files while the page is open. */
  readonly follows: boolean
  /** A demo: nothing is written anywhere, and the page says so. */
  readonly demo: boolean
}

/** What a save failure says when the server cannot be reached at all. */
export const SERVER_GONE = "the review server is not running. Start `ritmo-tools music review` again, then reload this page"

const isSession = (value: unknown): value is Session =>
  typeof value === "object" && value !== null && "songText" in value && typeof value.songText === "string" && "version" in value && typeof value.version === "string"

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

/** The API `ritmo-tools music review` serves beside the page (`cli/serve.ts`). */
export const serverStore: Store = {
  session: async () => {
    const answer: unknown = await (await fetch("/api/session")).json()
    return isSession(answer) ? answer : undefined
  },
  version: async () => {
    try {
      return versionOf(await (await fetch("/api/version")).json())
    } catch {
      return undefined
    }
  },
  save: async (file, text) => versionOf(await put(file, text)) ?? "",
  readAudio: async (name) => {
    try {
      const response = await fetch(`/api/audio/${encodeURIComponent(name)}`)
      return response.ok ? await response.arrayBuffer() : undefined
    } catch {
      return undefined
    }
  },
  writeAudio: async (name, bytes) => {
    await put(`audio/${encodeURIComponent(name)}`, bytes)
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
    session: async () => ({ song: name, name, songText: song, reviewText: review, version: String(version) }),
    version: async () => String(version),
    save: async (file, text) => {
      if (file === "song") song = text
      else review = text
      version += 1
      return String(version)
    },
    readAudio: async (file) => {
      const found = kept.get(file)
      if (found !== undefined) return found.slice(0)
      const load = audio.get(file)
      if (load === undefined) return undefined
      const bytes = await load()
      kept.set(file, bytes)
      return bytes.slice(0)
    },
    writeAudio: async (file, bytes) => {
      kept.set(file, bytes.slice().buffer)
    },
    follows: false,
    demo: true
  }
}
