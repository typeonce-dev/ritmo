/**
 * How a review page writes a file the agent writes too, the same way for
 * every tool: each write carries the version of the file the page read
 * (`?base=`), and the server writes it only when the file is still at that
 * version. When the agent wrote it meanwhile, the server writes nothing and
 * answers 409 with what the file holds now; the page lays the person's
 * change over that (`mergeText`) and sends it again. The server's half is
 * `writeChecked` in `serve.ts`; this half runs in the browser too.
 */
import { hashText } from "./hash.ts"

/** What a stale write is told, with the file's text and version now. */
export const STALE = "the file changed since the page read it"

/** The version of a file as a page reads it: a hash of its text, or `none` when there is no file yet. What a write is based on. */
export const textVersion = (text: string | null): string => (text === null ? "none" : hashText(text))

/** What a file held when the page last read or wrote it: what its next write is based on, and what a merge starts from. */
export interface Base {
  readonly text: string
  readonly version: string
}

/** What a write says: written, with the server's answer, or written meanwhile by someone else, with what the file holds now. */
export type Saved = { readonly ok: true; readonly answer: Readonly<Record<string, unknown>> } | { readonly ok: false; readonly text: string; readonly version: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** Sends a write based on `base`; fails with `gone` when the server cannot be reached, and with the server's error when it refuses. */
export const putChecked = async (url: string, body: BodyInit, base: string, gone: string): Promise<Saved> => {
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}base=${encodeURIComponent(base)}`, { method: "PUT", body }).catch(() => {
    throw new Error(gone)
  })
  const answer: unknown = await response.json()
  if (response.status === 409 && isRecord(answer) && typeof answer.text === "string" && typeof answer.version === "string") return { ok: false, text: answer.text, version: answer.version }
  if (!response.ok || !isRecord(answer)) throw new Error(isRecord(answer) && typeof answer.error === "string" ? answer.error : response.statusText)
  return { ok: true, answer }
}

/** What a write of one file says: written, with the version the page follows and the file's own (what its next write is based on), or written meanwhile by someone else, with what the file holds now. */
export type Written = { readonly ok: true; readonly version: string; readonly base: string } | { readonly ok: false; readonly text: string; readonly version: string }

/** `putChecked` for a server that answers a write with `{ version, base }`: sound, fx, and music. */
export const putFile = async (url: string, body: BodyInit, base: string, gone: string): Promise<Written> => {
  const saved = await putChecked(url, body, base, gone)
  if (!saved.ok) return saved
  const { version, base: next } = saved.answer
  if (typeof version !== "string" || typeof next !== "string") throw new Error("the server answered a save with no version")
  return { ok: true, version, base: next }
}

const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => same(value, b[i]))
  if (!isRecord(a) || !isRecord(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => key in b && same(a[key], b[key]))
}

/**
 * What changed from `base` in `mine`, laid over `theirs`: a field only one
 * side changed takes that side's value, and a field both changed takes
 * mine (the person's). Objects merge field by field; a list or a value is
 * one whole. `undefined` is a field that is not there.
 */
export const mergeJson = (base: unknown, mine: unknown, theirs: unknown): unknown => {
  if (same(mine, base)) return theirs
  if (same(theirs, base)) return mine
  if (!isRecord(mine) || !isRecord(theirs)) return mine
  const was = isRecord(base) ? base : {}
  const merged: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
    const value = mergeJson(was[key], mine[key], theirs[key])
    if (value !== undefined) merged[key] = value
  }
  return merged
}

/** `mergeJson` over files' texts: the person's change since `base` laid over what the file holds now; `undefined` when one of them is not JSON. */
export const mergeText = (base: string, mine: string, theirs: string): string | undefined => {
  try {
    return JSON.stringify(mergeJson(JSON.parse(base), JSON.parse(mine), JSON.parse(theirs)))
  } catch {
    return undefined
  }
}
