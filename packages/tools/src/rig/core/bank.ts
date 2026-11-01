/**
 * A rig bank: one JSON file per character (`hero.rig.json`) naming the rig
 * module and each clip's drafts, the modules the agent wrote (paths from
 * the bank's folder), each with its seed and the person's tune:
 *
 *   {
 *     "version": 1,
 *     "rig": "hero.js",
 *     "clips": {
 *       "attack": {
 *         "about": "Overhead chop from the ready stance and back.",
 *         "drafts": { "a": { "file": "clips/attack.js" }, "b": { "file": "clips/attack.b.js", "tune": { "overshoot": 18 } } },
 *         "use": "a"
 *       }
 *     }
 *   }
 *
 * `use` is the draft the game gets. `accept` on a draft lists warnings
 * judged deliberate, each with why: `rig check` lists them apart and does
 * not count them.
 *
 * Next to it, the review (`hero.rig.review.json`) keeps what the person
 * said about each clip: a status, a note, and comments, each pinned to one
 * pixel of one frame of a draft (with the part under it, the bone near it,
 * and the phase, so the agent knows which line to change) or to a span of
 * frames (timing: "frames 6-9 feel slow").
 *
 * The shapes and names follow the effects lab's bank (`fx/core/bank.ts`).
 */
import type { Decoded } from "./rig.ts"

/** One draft of a clip: its module, and what the bank says about it. */
export interface Draft {
  readonly file: string
  /** Where `rig.random()` starts. */
  readonly seed?: number | undefined
  /** The person's slider values, over the clip's own. */
  readonly tune?: Readonly<Record<string, number>> | undefined
  /** Warnings judged deliberate, by code, each with why: `rig check` lists them apart and does not count them. Errors cannot be accepted. */
  readonly accept?: Readonly<Record<string, string>> | undefined
}

/** A clip in the bank: its drafts, and the one the game gets. */
export interface ClipEntry {
  /** What the clip is for, in a few words; the person reads it. */
  readonly about?: string | undefined
  readonly drafts: Readonly<Record<string, Draft>>
  /** The draft the game gets; the first one when unset. */
  readonly use?: string | undefined
}

/** A bank, decoded by `decodeBank`: the rig module and every clip. */
export interface Bank {
  /** The rig module, from the bank's folder. */
  readonly rig: string
  /**
   * Pivot overrides the person set on the review page by dragging a part's
   * pivot: each image part's pivot, in its picture's pixels, laid over the
   * rig module's (as `tune` lays over params). The one way a person moves a
   * pivot; the agent folds them into the rig module and clears them.
   */
  readonly pivots?: Readonly<Record<string, readonly [number, number]>> | undefined
  readonly clips: Readonly<Record<string, ClipEntry>>
}

/** A clip's review status: not looked at yet, approved, or changes asked. */
export type Status = "new" | "approved" | "changes"
/** Every status, in the order the person sees them. */
export const statuses: ReadonlyArray<Status> = ["new", "approved", "changes"]

interface CommentBase {
  readonly draft: string
  readonly text: string
  readonly resolved?: boolean | undefined
  readonly reply?: string | undefined
}

/**
 * A comment pinned to one pixel of one frame of a draft (frames from 0,
 * pixels of the frame at 1x from its top left). `part` is the part drawn
 * there, `bone` that part's own bone (the line of code to change), and
 * `phase` the clip's phase on that frame: recorded when it is pinned, so
 * the agent reads "frame 3 (swing), pixel (71, 40), on forearmNear (bone
 * forearmNear)" with no picture.
 */
export interface PixelComment extends CommentBase {
  readonly frame: number
  readonly x: number
  readonly y: number
  readonly part?: string | undefined
  readonly bone?: string | undefined
  readonly phase?: string | undefined
  /** The spot in its bone's own frame (`[along, across]`, world units) when it was pinned, so its ring follows the part after an edit. */
  readonly local?: readonly [number, number] | undefined
}

/** A comment on a span of frames of a draft, both ends included (timing), with the phases it covered when it was pinned. */
export interface SpanComment extends CommentBase {
  readonly from: number
  readonly to: number
  readonly phases?: ReadonlyArray<string> | undefined
}

/** A pixel of a frame, or a span of frames; once the agent has acted on it, `resolved`, with a `reply` saying what changed (`rig resolve`). */
export type Comment = PixelComment | SpanComment

/** Whether a comment is on a span of frames (timing) rather than a pixel of one frame. */
export const isSpan = (comment: Comment): comment is SpanComment => "from" in comment

/** Where a comment is, in words: "draft a, frames 6-9 (anticipation)" or "draft a, frame 22 (up), pixel (146, 195), on blade (bone sword)". */
export const whereOf = (c: Comment): string =>
  isSpan(c)
    ? `draft ${c.draft}, frames ${c.from}-${c.to}${c.phases !== undefined && c.phases.length > 0 ? ` (${c.phases.join(", ")})` : ""}`
    : `draft ${c.draft}, frame ${c.frame}${c.phase === undefined ? "" : ` (${c.phase})`}, pixel (${c.x}, ${c.y})${c.part === undefined ? "" : `, on ${c.part}`}${c.bone === undefined ? "" : ` (bone ${c.bone})`}`

/** What the person said about one clip. */
export interface ClipReview {
  readonly status: Status
  readonly note: string
  readonly comments: ReadonlyArray<Comment>
}

/** A bank's review, decoded by `decodeReview`: what the person said about each clip. */
export interface Review {
  readonly clips: Readonly<Record<string, ClipReview>>
}

/** The review of a bank never reviewed. */
export const emptyReview: Review = { clips: {} }
/** The review of a clip the person has not said anything about. */
export const newClip: ClipReview = { status: "new", note: "", comments: [] }

/** Where a bank's review lives. */
export const reviewPath = (bankPath: string): string => (bankPath.endsWith(".json") ? bankPath.slice(0, -".json".length) : bankPath) + ".review.json"

/** The draft the game gets: `use`, or the first. */
export const usedDraft = (entry: ClipEntry): string | undefined => (entry.use !== undefined && entry.use in entry.drafts ? entry.use : Object.keys(entry.drafts)[0])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const parse = (text: string): Decoded<unknown> => {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: `not JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Reads a bank's JSON, naming every problem in it; write one back with `encodeBank`. */
export const decodeBank = (text: string): Decoded<Bank> => {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  const raw = parsed.value
  if (!isRecord(raw) || typeof raw.rig !== "string" || raw.rig === "" || !isRecord(raw.clips))
    return { ok: false, error: 'a rig bank is {"version": 1, "rig": "hero.js", "clips": {"name": {"drafts": {"a": {"file": "clips/name.js"}}}}}' }
  const errors: Array<string> = []
  const clips: Record<string, ClipEntry> = {}
  for (const [name, value] of Object.entries(raw.clips)) {
    if (!isRecord(value) || !isRecord(value.drafts)) {
      errors.push(`clips.${name} needs drafts: {"a": {"file": "..."}}`)
      continue
    }
    const drafts: Record<string, Draft> = {}
    for (const [id, draft] of Object.entries(value.drafts)) {
      if (!isRecord(draft) || typeof draft.file !== "string" || draft.file === "") {
        errors.push(`clips.${name}.drafts.${id} needs a file`)
        continue
      }
      if (draft.seed !== undefined && !Number.isInteger(draft.seed)) errors.push(`clips.${name}.drafts.${id}.seed must be a whole number`)
      const tune: Record<string, number> = {}
      if (draft.tune !== undefined && !isRecord(draft.tune)) errors.push(`clips.${name}.drafts.${id}.tune must be an object of numbers`)
      for (const [param, v] of Object.entries(isRecord(draft.tune) ? draft.tune : {})) {
        if (typeof v === "number" && Number.isFinite(v)) tune[param] = v
        else errors.push(`clips.${name}.drafts.${id}.tune.${param} must be a number`)
      }
      const accept: Record<string, string> = {}
      if (draft.accept !== undefined && !isRecord(draft.accept)) errors.push(`clips.${name}.drafts.${id}.accept must be {"code": "why"}`)
      for (const [code, why] of Object.entries(isRecord(draft.accept) ? draft.accept : {})) {
        if (typeof why === "string" && why.trim() !== "") accept[code] = why
        else errors.push(`clips.${name}.drafts.${id}.accept.${code} must say why the warning is deliberate`)
      }
      drafts[id] = {
        file: draft.file,
        seed: Number.isInteger(draft.seed) ? (draft.seed as number) : undefined,
        tune: Object.keys(tune).length > 0 ? tune : undefined,
        accept: Object.keys(accept).length > 0 ? accept : undefined
      }
    }
    if (Object.keys(value.drafts).length === 0) errors.push(`clips.${name} needs at least one draft`)
    if (value.use !== undefined && (typeof value.use !== "string" || !(value.use in value.drafts))) errors.push(`clips.${name}.use must name one of its drafts`)
    clips[name] = { about: typeof value.about === "string" ? value.about : undefined, drafts, use: typeof value.use === "string" ? value.use : undefined }
  }
  const pivots: Record<string, readonly [number, number]> = {}
  if (raw.pivots !== undefined && !isRecord(raw.pivots)) errors.push('pivots must be {"part": [x, y]}')
  for (const [part, at] of Object.entries(isRecord(raw.pivots) ? raw.pivots : {})) {
    if (Array.isArray(at) && at.length === 2 && at.every((v) => typeof v === "number" && Number.isFinite(v))) pivots[part] = [at[0] as number, at[1] as number]
    else errors.push(`pivots.${part} must be [x, y], in the part's picture's pixels`)
  }
  return errors.length > 0 ? { ok: false, error: errors.join("; ") } : { ok: true, value: { rig: raw.rig, ...(Object.keys(pivots).length === 0 ? {} : { pivots }), clips } }
}

/** A bank as JSON, leaving out what is unset; `decodeBank` reads it back. */
export const encodeBank = (bank: Bank): string => {
  const clips: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(bank.clips)) {
    const drafts: Record<string, unknown> = {}
    for (const [id, draft] of Object.entries(entry.drafts))
      drafts[id] = {
        file: draft.file,
        ...(draft.seed === undefined ? {} : { seed: draft.seed }),
        ...(draft.tune === undefined || Object.keys(draft.tune).length === 0 ? {} : { tune: draft.tune }),
        ...(draft.accept === undefined || Object.keys(draft.accept).length === 0 ? {} : { accept: draft.accept })
      }
    clips[name] = { ...(entry.about === undefined ? {} : { about: entry.about }), drafts, ...(entry.use === undefined ? {} : { use: entry.use }) }
  }
  return JSON.stringify({ version: 1, rig: bank.rig, ...(bank.pivots === undefined || Object.keys(bank.pivots).length === 0 ? {} : { pivots: bank.pivots }), clips }, null, 2) + "\n"
}

/** Reads a review's JSON (pixel and span comments), naming every problem in it; write one back with `encodeReview`. */
export const decodeReview = (text: string): Decoded<Review> => {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  const raw = parsed.value
  if (!isRecord(raw) || !isRecord(raw.clips)) return { ok: false, error: 'a review is {"version": 1, "clips": {"name": {"status": ..., "note": ..., "comments": [...]}}}' }
  const errors: Array<string> = []
  const clips: Record<string, ClipReview> = {}
  const whole = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0
  const text_ = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined)
  for (const [name, value] of Object.entries(raw.clips)) {
    if (!isRecord(value)) {
      errors.push(`${name} must be an object`)
      continue
    }
    const status = statuses.find((entry) => entry === value.status)
    if (value.status !== undefined && status === undefined) errors.push(`${name}.status must be one of ${statuses.join(", ")}`)
    const comments: Array<Comment> = []
    if (value.comments !== undefined && !Array.isArray(value.comments)) errors.push(`${name}.comments must be a list`)
    for (const [i, c] of (Array.isArray(value.comments) ? value.comments : []).entries()) {
      const shape = `${name}.comments[${i}] must be {"draft", "frame", "x", "y", "text"} (a pixel) or {"draft", "from", "to", "text"} (a span)`
      if (!isRecord(c) || typeof c.draft !== "string" || typeof c.text !== "string") {
        errors.push(shape)
        continue
      }
      const done = { ...(c.resolved === true ? { resolved: true } : {}), ...(text_(c.reply) === undefined ? {} : { reply: text_(c.reply) }) }
      if (c.from !== undefined || c.to !== undefined) {
        if (!whole(c.from) || !whole(c.to) || c.to < c.from) {
          errors.push(`${name}.comments[${i}]: a span needs whole frames with from <= to`)
          continue
        }
        const phases = Array.isArray(c.phases) ? c.phases.filter((p): p is string => typeof p === "string") : []
        comments.push({ draft: c.draft, from: c.from, to: c.to, ...(phases.length > 0 ? { phases } : {}), text: c.text, ...done })
        continue
      }
      if (!whole(c.frame) || !whole(c.x) || !whole(c.y)) {
        errors.push(shape)
        continue
      }
      comments.push({
        draft: c.draft,
        frame: c.frame,
        x: c.x,
        y: c.y,
        ...(text_(c.part) === undefined ? {} : { part: text_(c.part) }),
        ...(text_(c.bone) === undefined ? {} : { bone: text_(c.bone) }),
        ...(text_(c.phase) === undefined ? {} : { phase: text_(c.phase) }),
        ...(Array.isArray(c.local) && c.local.length === 2 && c.local.every((v) => typeof v === "number" && Number.isFinite(v)) ? { local: [c.local[0] as number, c.local[1] as number] as const } : {}),
        text: c.text,
        ...done
      })
    }
    clips[name] = { status: status ?? "new", note: typeof value.note === "string" ? value.note : "", comments }
  }
  return errors.length > 0 ? { ok: false, error: errors.join("; ") } : { ok: true, value: { clips } }
}

/** A review as JSON; `decodeReview` reads it back. To close comments, use `resolveComments` first. */
export const encodeReview = (review: Review): string => {
  const clips: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(review.clips))
    clips[name] = { status: entry.status, ...(entry.note === "" ? {} : { note: entry.note }), ...(entry.comments.length === 0 ? {} : { comments: entry.comments }) }
  // Version 2 adds a pixel comment's part-local spot; version 1 files read as they are.
  return JSON.stringify({ version: 2, clips }, null, 2) + "\n"
}

/** Marks comments (by number, from 1) as resolved with the agent's reply; fails on a number the clip has no comment for. */
export const resolveComments = (review: Review, clip: string, numbers: ReadonlyArray<number>, reply: string): Decoded<Review> => {
  const said = review.clips[clip] ?? newClip
  const missing = numbers.filter((n) => !Number.isInteger(n) || n < 1 || n > said.comments.length)
  if (missing.length > 0) return { ok: false, error: `${clip} has no comment ${missing.join(", ")} (it has ${said.comments.length})` }
  const comments = said.comments.map((comment, index) => (numbers.includes(index + 1) ? { ...comment, resolved: true, ...(reply === "" ? {} : { reply }) } : comment))
  return { ok: true, value: { clips: { ...review.clips, [clip]: { ...said, comments } } } }
}

/** Open comments on a clip (all drafts, or one), each with its number (what `rig resolve` takes). */
export const openComments = (review: Review, clip: string, draft?: string): Array<Comment & { readonly number: number }> =>
  (review.clips[clip]?.comments ?? []).flatMap((comment, index) => (comment.resolved === true || (draft !== undefined && comment.draft !== draft) ? [] : [{ number: index + 1, ...comment }]))

/** What the agent needs from a review: every clip's status, note, open comments (each with where it is, in words), draft in use, and tune, the changes first. */
export const reviewSummary = (bank: Bank, review: Review) => {
  const clips = Object.entries(bank.clips).map(([name, entry]) => {
    const said = review.clips[name] ?? newClip
    const use = usedDraft(entry)
    const open = openComments(review, name).map((comment) => ({ ...comment, where: whereOf(comment) }))
    const resolved = said.comments.length - open.length
    return {
      name,
      status: said.status,
      note: said.note === "" ? undefined : said.note,
      comments: open.length === 0 ? undefined : open,
      resolved: resolved === 0 ? undefined : resolved,
      use,
      tune: use === undefined ? undefined : entry.drafts[use]?.tune,
      drafts: Object.keys(entry.drafts).length
    }
  })
  const count = (status: Status): number => clips.filter((clip) => clip.status === status).length
  return {
    summary: `${count("approved")} approved, ${count("changes")} with changes asked, ${count("new")} not reviewed yet (of ${clips.length}).`,
    changes: clips.filter((clip) => clip.status === "changes"),
    clips
  }
}
