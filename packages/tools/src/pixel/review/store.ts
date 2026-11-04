/**
 * Where the review page reads the art and reads and writes the review: the
 * API `ritmo-tools pixel review` serves beside the page (`cli/serve.ts`).
 * The server reads, hashes, and lints every asset; the page only draws.
 */
import type { Issue } from "../core/lint.ts"
import type { Frame } from "../core/review.ts"
import type { SheetAnimationRead } from "../core/spritesheet.ts"

/** One asset on the page's list, with what the page needs to draw its row, play it, and approve it. */
export interface Entry {
  readonly id: string
  /** Its file's name. */
  readonly name: string
  /** The folder it is in, from where the review was started. */
  readonly folder: string
  readonly kind: "still" | "sheet"
  /** The picture's size (a sheet's, with every frame). */
  readonly width: number
  readonly height: number
  /** Each frame with where it is on the picture, how long it shows, and its hash: what an approval keeps. */
  readonly frames: ReadonlyArray<Frame>
  /** A sheet's animations, each its frames (indices into `frames`) as listed and in play order; none for a still. */
  readonly animations: ReadonlyArray<SheetAnimationRead>
  /** What it is made from, when that sits beside it. */
  readonly source: string | undefined
  /** The lint's counts; the issues come with the detail. */
  readonly errors: number
  readonly warnings: number
  /** Why it cannot be linted (a broken config), when it cannot. */
  readonly lintProblem: string | undefined
  /** Why it cannot be read, when it cannot. */
  readonly problem: string | undefined
  /** Changes when its files do, so the page can follow the agent's edits. */
  readonly version: string
}

/** A lint issue on one frame of a sheet (its index in `frames`), or on the whole of a still. */
export interface FrameIssue extends Issue {
  readonly frame?: number | undefined
}

/** What the page shows beside the asset open: its lint issues, and the files it comes from. */
export interface Detail {
  readonly id: string
  readonly file: string
  readonly source: string | undefined
  readonly sheet: string | undefined
  readonly config: string | undefined
  readonly issues: ReadonlyArray<FrameIssue>
  readonly version: string
}

export interface Listed {
  /** Changes when any asset does. */
  readonly version: string
  /** The review's version: changes when its file does. */
  readonly review: string
  /** Every asset, unless nothing changed since the version asked about. */
  readonly entries?: ReadonlyArray<Entry> | undefined
}

/** What a save says: written, with the review's new version, or written meanwhile by someone else, with what the file holds now. */
export type Saved = { readonly ok: true; readonly version: string } | { readonly ok: false; readonly text: string; readonly version: string }

export interface Store {
  /** The list, or `undefined` when it cannot be read (the CLI was stopped). */
  readonly library: (since: string) => Promise<Listed | undefined>
  /** The whole review, by asset id; fails when the review file is broken. */
  readonly review: () => Promise<{ readonly text: string; readonly version: string }>
  /** Writes the whole review, when the file is still at `base`; fails with `SERVER_GONE` when the server cannot be reached. */
  readonly save: (text: string, base: string) => Promise<Saved>
  readonly detail: (id: string) => Promise<Detail | undefined>
  /** Where the asset's picture is, as PNG, at this version. */
  readonly picture: (id: string, version: string) => string
}

/** What a save failure says when the server cannot be reached at all. */
export const SERVER_GONE = "the review server is not running. Start `ritmo-tools pixel review` again; the page saves what is owed once it is back"

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const failure = (answer: unknown, fallback: string): string => (isRecord(answer) && typeof answer.error === "string" ? answer.error : fallback)

const isDetail = (value: unknown): value is Detail => isRecord(value) && typeof value.id === "string" && typeof value.version === "string" && Array.isArray(value.issues)

const query = (id: string): string => `id=${encodeURIComponent(id)}`

/** The API `ritmo-tools pixel review` serves beside the page. */
export const serverStore: Store = {
  library: async (since) => {
    try {
      const answer: unknown = await (await fetch(`/api/library?since=${encodeURIComponent(since)}`)).json()
      return isRecord(answer) && typeof answer.version === "string" && typeof answer.review === "string"
        ? { version: answer.version, review: answer.review, entries: Array.isArray(answer.entries) ? answer.entries : undefined }
        : undefined
    } catch {
      return undefined
    }
  },
  review: async () => {
    const response = await fetch("/api/review")
    const answer: unknown = await response.json()
    if (!response.ok || !isRecord(answer) || typeof answer.text !== "string" || typeof answer.version !== "string") throw new Error(failure(answer, response.statusText))
    return { text: answer.text, version: answer.version }
  },
  save: async (text, base) => {
    const response = await fetch(`/api/review?base=${encodeURIComponent(base)}`, { method: "PUT", body: text }).catch(() => {
      throw new Error(SERVER_GONE)
    })
    const answer: unknown = await response.json()
    if (response.status === 409 && isRecord(answer) && typeof answer.text === "string" && typeof answer.version === "string") return { ok: false, text: answer.text, version: answer.version }
    if (!response.ok || !isRecord(answer) || typeof answer.version !== "string") throw new Error(failure(answer, response.statusText))
    return { ok: true, version: answer.version }
  },
  detail: async (id) => {
    try {
      const response = await fetch(`/api/asset?${query(id)}`)
      const answer: unknown = await response.json()
      return response.ok && isDetail(answer) ? answer : undefined
    } catch {
      return undefined
    }
  },
  picture: (id, version) => `/api/png?${query(id)}&v=${encodeURIComponent(version)}`
}
