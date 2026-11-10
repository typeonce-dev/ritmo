/**
 * The review: what a person said about each sound, kept in a file next to
 * the bank (`game.sounds.json` → `game.sounds.review.json`) so the agent can
 * read it. Each sound has a status (new, approved, or changes asked), a
 * note in the person's words, and the takes the agent offered.
 *
 * The page writes picks straight into the bank (the chosen take becomes the
 * sound), so the bank is always what the person last chose; the review
 * holds only what words and choices can say about it, and, once a sound is
 * approved, what they heard, so a later change to it shows.
 */
import { hashText } from "../../internal/hash.ts"
import { approvedSaid, goneEntry, goneSaid, statuses, unrecordedOf, type Status } from "../../internal/review.ts"
import { decodeRecipeValue, recipeValue, type Bank, type Decoded, type Recipe } from "./recipe.ts"
import { towards, type Take, type Toward } from "./takes.ts"

/** What the person heard when they approved a sound: a hash of its recipe, and the bank's master volume. */
export interface Approved {
  readonly recipe: string
  readonly master: number
}

export interface SoundReview {
  readonly status: Status
  /** The person's words: what to change, or why it is right. */
  readonly note: string
  /** The takes offered, and what they were made toward. */
  readonly takes: ReadonlyArray<Take>
  readonly toward?: Toward | undefined
  /** The take the person chose (it is now the sound in the bank). */
  readonly picked?: string | undefined
  readonly approved?: Approved | undefined
}

export interface Review {
  readonly sounds: Readonly<Record<string, SoundReview>>
}

export const emptyReview: Review = { sounds: {} }
export const newSound: SoundReview = { status: "new", note: "", takes: [] }

/** Where a bank's review lives. */
export const reviewPath = (bankPath: string): string => (bankPath.endsWith(".json") ? bankPath.slice(0, -".json".length) : bankPath) + ".review.json"

/** What the recipe makes the person hear: not its `about`, nor `heavy` and `interval`, which the game's own audio code carries. */
const heardOf = (recipe: Recipe): string => {
  const { about: _about, heavy: _heavy, interval: _interval, ...heard } = recipeValue(recipe)
  return hashText(JSON.stringify(heard))
}

/** What to keep when the person approves a sound, as it plays now. */
export const approvalOf = (recipe: Recipe, master: number | undefined): Approved => ({ recipe: heardOf(recipe), master: master ?? 1 })

/** What is different from what the person approved, in a few words; `undefined` when nothing is. */
export const changedSince = (approved: Approved, recipe: Recipe, master: number | undefined): string | undefined => {
  const parts: Array<string> = []
  if (heardOf(recipe) !== approved.recipe) parts.push("its recipe changed")
  if ((master ?? 1) !== approved.master) parts.push(`the bank's master volume is ${master ?? 1}, it was ${approved.master} when approved`)
  return parts.length === 0 ? undefined : parts.join("; ")
}

/** What changed since the person approved this sound, when they did and something has. */
export const changedOf = (entry: SoundReview, recipe: Recipe, master: number | undefined): string | undefined =>
  entry.status === "approved" && entry.approved !== undefined ? changedSince(entry.approved, recipe, master) : undefined

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

export const decodeReview = (text: string): Decoded<Review> => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `not JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!isRecord(raw) || !isRecord(raw.sounds)) return { ok: false, error: 'a review is {"version": 1, "sounds": {"name": {"status": ..., "note": ...}}}' }
  const errors: Array<string> = []
  const sounds: Record<string, SoundReview> = {}
  for (const [name, value] of Object.entries(raw.sounds)) {
    if (!isRecord(value)) {
      errors.push(`${name} must be an object`)
      continue
    }
    const status = statuses.find((entry) => entry === value.status)
    if (value.status !== undefined && status === undefined) errors.push(`${name}.status must be one of ${statuses.join(", ")}`)
    const takes: Array<Take> = []
    if (value.takes !== undefined && !Array.isArray(value.takes)) errors.push(`${name}.takes must be a list`)
    for (const [i, take] of (Array.isArray(value.takes) ? value.takes : []).entries()) {
      if (!isRecord(take) || typeof take.id !== "string") {
        errors.push(`${name}.takes[${i}] needs an id`)
        continue
      }
      const recipe = decodeRecipeValue(take.recipe, `${name}.takes[${i}].recipe`, errors)
      if (recipe !== undefined) takes.push({ id: take.id, label: typeof take.label === "string" ? take.label : "", recipe })
    }
    const toward = towards.find((entry) => entry.id === value.toward)?.id
    const approved = isRecord(value.approved) && typeof value.approved.recipe === "string" && typeof value.approved.master === "number" ? { recipe: value.approved.recipe, master: value.approved.master } : undefined
    if (value.approved !== undefined && approved === undefined) errors.push(`${name}.approved must be {"recipe", "master"}`)
    sounds[name] = {
      status: status ?? "new",
      note: typeof value.note === "string" ? value.note : "",
      takes,
      toward,
      picked: typeof value.picked === "string" ? value.picked : undefined,
      approved
    }
  }
  return errors.length > 0 ? { ok: false, error: errors.join("; ") } : { ok: true, value: { sounds } }
}

export const encodeReview = (review: Review): string => {
  const sounds: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(review.sounds)) {
    sounds[name] = {
      status: entry.status,
      ...(entry.note === "" ? {} : { note: entry.note }),
      ...(entry.picked === undefined ? {} : { picked: entry.picked }),
      ...(entry.toward === undefined ? {} : { toward: entry.toward }),
      ...(entry.takes.length === 0 ? {} : { takes: entry.takes.map((take) => ({ id: take.id, label: take.label, recipe: recipeValue(take.recipe) })) }),
      ...(entry.approved === undefined ? {} : { approved: entry.approved })
    }
  }
  return JSON.stringify({ version: 1, sounds }, null, 2) + "\n"
}

/**
 * What the agent needs from a review: every sound's status and note, what
 * changed since it was approved (or that nothing of what was heard was
 * kept), what is still to do, and under `gone` what was said about sounds
 * the bank no longer has. `where` is the review's path, as `notes` names it.
 */
export const reviewSummary = (bank: Bank, review: Review, where = "the review") => {
  const names = Object.keys(bank.sounds)
  const of = (name: string): SoundReview => review.sounds[name] ?? newSound
  const sounds = names.map((name) => {
    const entry = of(name)
    return { name, status: entry.status, note: entry.note === "" ? undefined : entry.note, picked: entry.picked, takes: entry.takes.length, changedSinceApproved: changedOf(entry, bank.sounds[name]!, bank.master), ...unrecordedOf(entry.status, entry.approved) }
  })
  const gone = Object.entries(review.sounds)
    .filter(([name, entry]) => !(name in bank.sounds) && (entry.status !== "new" || entry.note !== ""))
    .map(([name, entry]) => ({ name, ...goneEntry(entry, "sound", where) }))
  const count = (status: Status): number => sounds.filter((sound) => sound.status === status).length
  return {
    summary: `${approvedSaid(sounds, "listen")}, ${count("changes")} with changes asked, ${count("new")} not reviewed yet (of ${names.length}).${goneSaid(gone.length)}`,
    changes: sounds.filter((sound) => sound.status === "changes"),
    sounds,
    gone
  }
}
