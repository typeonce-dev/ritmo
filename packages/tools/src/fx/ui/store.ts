/**
 * Where the review page reads and writes a bank and its review, and gets the
 * drafts' modules: the CLI's server (`serverStore`, the files the agent reads
 * back), or the tab itself (`memoryStore`, the website's demo).
 */
import { putFile, type Written } from "../../internal/save.ts"

/** The project's rules from pixel.config.json, as the page checks drafts against them. */
export interface PageRules {
  /** The project palette, as `#rrggbb`. */
  readonly palette?: ReadonlyArray<string> | undefined
  readonly maxColors?: number | undefined
}

/** A bank, its review, and its drafts' sources as the page opens them. */
export interface Session {
  readonly bank: string
  readonly name: string
  readonly bankText: string
  readonly reviewText: string | null
  /** Each draft file the bank names, by its path in the bank: its source, or `null` when it cannot be read. */
  readonly sources: Readonly<Record<string, string | null>>
  /** The bank's stand-in sprite as a data URL, `null` when it cannot be read, `undefined` when the bank has none. */
  readonly standIn?: string | null | undefined
  readonly rules: PageRules
  /** Changes when the bank, the review, or a draft does, so the page can follow the agent's edits. */
  readonly version: string
}

export interface Store {
  /** The bank, its review, and its drafts, or `undefined` when there is none to open. */
  readonly session: () => Promise<Session | undefined>
  /** The files' version now, or `undefined` when it cannot be read (the CLI was stopped). */
  readonly version: () => Promise<string | undefined>
  /** Writes the bank or the review when the file is still at `base` (`internal/save.ts`); fails with `SERVER_GONE` when the server cannot be reached. */
  readonly save: (file: "bank" | "review", text: string, base: string) => Promise<Written>
  /** Whether someone else (the agent) can change the files while the page is open. */
  readonly follows: boolean
  /** A demo: nothing is written anywhere, and the page says so. */
  readonly demo: boolean
}

/** What a save failure says when the server cannot be reached at all. */
export const SERVER_GONE = "the review server is not running. Start `ritmo-tools fx review` again; the page saves what is owed once it is back"

const isSession = (value: unknown): value is Session =>
  typeof value === "object" && value !== null && "bankText" in value && typeof value.bankText === "string" && "sources" in value && "version" in value && typeof value.version === "string"

const versionOf = (answer: unknown): string | undefined =>
  typeof answer === "object" && answer !== null && "version" in answer && typeof answer.version === "string" ? answer.version : undefined

/** The API `ritmo-tools fx review` serves beside the page (`cli/serve.ts`). */
export const serverStore: Store = {
  session: async () => {
    const answer: unknown = await (await fetch("/api/session")).json()
    return isSession(answer) ? { ...answer, rules: answer.rules ?? {} } : undefined
  },
  version: async () => {
    try {
      return versionOf(await (await fetch("/api/version")).json())
    } catch {
      return undefined
    }
  },
  save: (file, text, base) => putFile(`/api/${file}`, text, base, SERVER_GONE),
  follows: true,
  demo: false
}

/** A bank kept in the tab, with its drafts' sources: what the person changes lasts until the page closes. */
export const memoryStore = (name: string, bankText: string, sources: Readonly<Record<string, string>>, standIn?: string): Store => {
  let bank = bankText
  let review: string | null = null
  let version = 0
  return {
    session: async () => ({ bank: name, name, bankText: bank, reviewText: review, sources, standIn, rules: {}, version: String(version) }),
    version: async () => String(version),
    save: async (file, text) => {
      if (file === "bank") bank = text
      else review = text
      version += 1
      return { ok: true, version: String(version), base: String(version) }
    },
    follows: false,
    demo: true
  }
}
