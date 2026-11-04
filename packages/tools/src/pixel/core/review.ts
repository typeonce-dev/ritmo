/**
 * The pixel art review: what the person said about each of a game's assets
 * on the review page (`ritmo-tools pixel review`), for the agent to read
 * back (`pixel notes`). One file, `pixel.review.json`, at the game's root
 * (beside the nearest `package.json`), keyed by each asset's path from
 * there: kept beside the art it would ship with the game from `public/`.
 *
 * Each asset has a status (new, approved, changes asked), a note on the
 * whole, and comments pinned to an area of one frame ("these pixels,
 * here"). Once the agent has acted on a comment it is resolved, with a reply
 * (`pixel resolve`); the person can reopen it.
 *
 * Once approved, the review keeps what the person saw: a hash of each
 * frame's pixels and how long each shows. The hash is of the decoded pixels,
 * not the file's bytes, so a re-export that looks the same is no change, and
 * a transparent pixel hashes the same whatever color it hides.
 */
import { makeHash } from "../../internal/hash.ts"
import type { RgbaImage } from "./grid.ts"
import type { Decoded } from "./recipe.ts"

export type Status = "new" | "approved" | "changes"
export const statuses: ReadonlyArray<Status> = ["new", "approved", "changes"]

/** The file every asset's review lives in, at the game's root. */
export const REVIEW_FILE = "pixel.review.json"

/**
 * A comment pinned to an area of one frame. `x` and `y` are its top-left
 * pixel, in the frame's own pixels; `width` and `height` its size (one pixel
 * when unset). Frames count from 0 within their animation; a still has one
 * frame, 0, and no animation.
 */
export interface Comment {
  readonly animation?: string | undefined
  readonly frame: number
  readonly x: number
  readonly y: number
  readonly width?: number | undefined
  readonly height?: number | undefined
  readonly text: string
  readonly resolved?: boolean | undefined
  readonly reply?: string | undefined
}

/** What the person saw when they approved an asset: a hash of each frame's pixels, in the sheet's order, and how long each frame shows (a still has none). */
export interface Approved {
  readonly frames: ReadonlyArray<string>
  readonly durations?: ReadonlyArray<number> | undefined
}

export interface AssetReview {
  readonly status: Status
  readonly note: string
  readonly comments: ReadonlyArray<Comment>
  /** Set when the person approves. */
  readonly approved?: Approved | undefined
}

export interface Review {
  readonly assets: Readonly<Record<string, AssetReview>>
}

export const emptyReview: Review = { assets: {} }
export const newAsset: AssetReview = { status: "new", note: "", comments: [] }

// ---------------------------------------------------------------------------
// What an asset looks like now

/**
 * One frame of an asset as it is now: where it is on the picture, how long
 * it shows, and a hash of its pixels. A still is one frame, the whole
 * picture, named "" with no animation and no duration.
 */
export interface Frame {
  /** Its name in the sheet's JSON ("walk 0"); "" for a still. */
  readonly name: string
  readonly animation?: string | undefined
  /** Its place in its animation, from 0. */
  readonly index: number
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** How long it shows, in milliseconds; none for a still. */
  readonly duration?: number | undefined
  readonly hash: string
}

/** The hash of a frame's size and each pixel's color: a transparent pixel is the same whatever its hidden color. */
export const hashFrame = (image: RgbaImage, x: number, y: number, w: number, h: number): string => {
  const hash = makeHash()
  for (const v of [w, w >> 8, h, h >> 8]) hash.mix(v)
  for (let row = y; row < y + h; row++)
    for (let column = x; column < x + w; column++) {
      const i = (row * image.width + column) * 4
      const alpha = image.data[i + 3] ?? 0
      // A transparent pixel is one byte, any other alpha starts four: the two never read alike.
      hash.mix(alpha)
      if (alpha === 0) continue
      hash.mix(image.data[i]!)
      hash.mix(image.data[i + 1]!)
      hash.mix(image.data[i + 2]!)
    }
  return hash.done()
}

/** What to keep when the person approves an asset, as it looks now. */
export const approvalOf = (frames: ReadonlyArray<Frame>): Approved => {
  const durations = frames.map((frame) => frame.duration)
  return { frames: frames.map((frame) => frame.hash), ...(durations.every((d) => d !== undefined) && durations.length > 0 ? { durations } : {}) }
}

/** "3-5, 7": frame numbers as runs. */
const spans = (numbers: ReadonlyArray<number>): string => {
  const parts: Array<string> = []
  let start: number | undefined
  let last: number | undefined
  for (const n of [...numbers, undefined]) {
    if (n !== undefined && last !== undefined && n === last + 1) {
      last = n
      continue
    }
    if (start !== undefined) parts.push(start === last ? `${start}` : `${start}-${last}`)
    start = n
    last = n
  }
  return parts.join(", ")
}

/** "walk frames 3-5 and idle frame 0": some frames, by animation. */
const framesNamed = (frames: ReadonlyArray<Frame>): string => {
  const by = new Map<string, Array<number>>()
  for (const frame of frames) by.set(frame.animation ?? "", [...(by.get(frame.animation ?? "") ?? []), frame.index])
  return [...by.entries()].map(([animation, indices]) => `${animation === "" ? "" : `${animation} `}frame${indices.length === 1 ? "" : "s"} ${spans(indices)}`).join(" and ")
}

/** What is different from what the person approved, in a few words; `undefined` when nothing is. */
export const changedSince = (approved: Approved, frames: ReadonlyArray<Frame>): string | undefined => {
  if (frames.length !== approved.frames.length) return `${frames.length} frame${frames.length === 1 ? "" : "s"}, ${approved.frames.length} when approved`
  const parts: Array<string> = []
  const looks = frames.filter((frame, i) => frame.hash !== approved.frames[i])
  if (looks.length > 0) parts.push(frames.length === 1 && frames[0]!.animation === undefined ? "it looks different" : `${framesNamed(looks)} look${looks.length === 1 ? "s" : ""} different`)
  const timed = approved.durations === undefined ? [] : frames.filter((frame, i) => frame.duration !== approved.durations?.[i])
  if (timed.length === 1) parts.push(`${framesNamed(timed)} shows for ${timed[0]!.duration ?? 0} ms, ${approved.durations?.[frames.indexOf(timed[0]!)]} when approved`)
  else if (timed.length > 1) parts.push(`the timing of ${framesNamed(timed)} changed`)
  return parts.length === 0 ? undefined : parts.join("; ")
}

/** What changed since the person approved this asset, when they did and something has. A review with no hashes has nothing to compare. */
export const changedOf = (review: AssetReview, frames: ReadonlyArray<Frame>): string | undefined =>
  review.status === "approved" && review.approved !== undefined ? changedSince(review.approved, frames) : undefined

// ---------------------------------------------------------------------------
// The file

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const whole = (value: unknown, least = 0): value is number => typeof value === "number" && Number.isInteger(value) && value >= least

const commentOf = (raw: unknown, where: string, errors: Array<string>): Comment | undefined => {
  if (!isRecord(raw) || !whole(raw.frame) || !whole(raw.x) || !whole(raw.y) || typeof raw.text !== "string") {
    errors.push(`${where} must be {"frame", "x", "y", "text"}, whole numbers from 0`)
    return undefined
  }
  if ((raw.width !== undefined && !whole(raw.width, 1)) || (raw.height !== undefined && !whole(raw.height, 1))) {
    errors.push(`${where}.width and .height are whole numbers from 1`)
    return undefined
  }
  if (raw.animation !== undefined && typeof raw.animation !== "string") {
    errors.push(`${where}.animation must be a name`)
    return undefined
  }
  return commentJson({
    animation: raw.animation,
    frame: raw.frame,
    x: raw.x,
    y: raw.y,
    width: raw.width,
    height: raw.height,
    text: raw.text,
    resolved: raw.resolved === true,
    reply: typeof raw.reply === "string" ? raw.reply : undefined
  })
}

const approvedOf = (raw: unknown): Approved | undefined => {
  if (!isRecord(raw) || !Array.isArray(raw.frames) || !raw.frames.every((hash) => typeof hash === "string")) return undefined
  const frames: ReadonlyArray<string> = raw.frames
  if (raw.durations === undefined) return { frames }
  if (!Array.isArray(raw.durations) || raw.durations.length !== frames.length || !raw.durations.every((d) => typeof d === "number")) return undefined
  const durations: ReadonlyArray<number> = raw.durations
  return { frames, durations }
}

const assetOf = (raw: unknown, where: string, errors: Array<string>): AssetReview | undefined => {
  if (!isRecord(raw)) {
    errors.push(`${where} must be {"status", "note", "comments"}`)
    return undefined
  }
  const status = statuses.find((entry) => entry === raw.status)
  if (raw.status !== undefined && status === undefined) errors.push(`${where}.status must be one of ${statuses.join(", ")}`)
  if (raw.comments !== undefined && !Array.isArray(raw.comments)) errors.push(`${where}.comments must be a list`)
  const comments = (Array.isArray(raw.comments) ? raw.comments : []).flatMap((comment, i) => commentOf(comment, `${where}.comments[${i}]`, errors) ?? [])
  const approved = approvedOf(raw.approved)
  if (raw.approved !== undefined && approved === undefined) errors.push(`${where}.approved must be {"frames": ["hash", ...], "durations": [ms, ...]}`)
  return { status: status ?? "new", note: typeof raw.note === "string" ? raw.note : "", comments, ...(approved === undefined ? {} : { approved }) }
}

/** `pixel.review.json`, or the page's whole review: each asset's review by its path. */
export const decodeReview = (text: string): Decoded<Review> => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `not JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!isRecord(raw) || !isRecord(raw.assets)) return { ok: false, error: 'a review is {"version": 1, "assets": {"path": {"status": ..., "note": ..., "comments": [...]}}}' }
  const errors: Array<string> = []
  const assets: Record<string, AssetReview> = {}
  for (const [path, value] of Object.entries(raw.assets)) {
    const review = assetOf(value, path, errors)
    if (review !== undefined) assets[path] = review
  }
  return errors.length > 0 ? { ok: false, error: errors.join("; ") } : { ok: true, value: { assets } }
}

/** Whether a review says nothing: not reviewed, no note, no comments. */
export const isEmpty = (review: AssetReview): boolean => review.status === "new" && review.note === "" && review.comments.length === 0 && review.approved === undefined

/** A comment with its fields in one order, as the file writes it. */
const commentJson = (comment: Comment): Comment => ({
  ...(comment.animation === undefined ? {} : { animation: comment.animation }),
  frame: comment.frame,
  x: comment.x,
  y: comment.y,
  ...(comment.width === undefined || comment.width === 1 ? {} : { width: comment.width }),
  ...(comment.height === undefined || comment.height === 1 ? {} : { height: comment.height }),
  text: comment.text,
  ...(comment.resolved === true ? { resolved: true } : {}),
  ...(comment.reply === undefined || comment.reply === "" ? {} : { reply: comment.reply })
})

/** An asset's review as the file writes it: what is unset left out. */
const assetJson = (entry: AssetReview) => ({
  status: entry.status,
  ...(entry.note === "" ? {} : { note: entry.note }),
  ...(entry.comments.length === 0 ? {} : { comments: entry.comments.map(commentJson) }),
  ...(entry.approved === undefined ? {} : { approved: entry.approved.durations === undefined ? { frames: entry.approved.frames } : { frames: entry.approved.frames, durations: entry.approved.durations } })
})

/** The file as written: assets in path order, and an asset nothing was said about left out. */
export const encodeReview = (review: Review): string => {
  const assets: Record<string, unknown> = {}
  for (const path of Object.keys(review.assets).sort()) {
    const entry = review.assets[path]!
    if (!isEmpty(entry)) assets[path] = assetJson(entry)
  }
  return JSON.stringify({ version: 1, assets }, null, 2) + "\n"
}

/** Marks comments (by number, from 1) as resolved with the agent's reply; fails on a number the asset has no comment for. */
export const resolveComments = (review: Review, asset: string, numbers: ReadonlyArray<number>, reply: string): Decoded<Review> => {
  const said = review.assets[asset] ?? newAsset
  const missing = numbers.filter((n) => !Number.isInteger(n) || n < 1 || n > said.comments.length)
  if (missing.length > 0) return { ok: false, error: `${asset} has no comment ${missing.join(", ")} (it has ${said.comments.length})` }
  const comments = said.comments.map((comment, index) => (numbers.includes(index + 1) ? { ...comment, resolved: true, ...(reply === "" ? {} : { reply }) } : comment))
  return { ok: true, value: { assets: { ...review.assets, [asset]: { ...said, comments } } } }
}

const same = (a: AssetReview, b: AssetReview): boolean => JSON.stringify(assetJson(a)) === JSON.stringify(assetJson(b))

/** A comment without what the agent sets on it: the same comment, resolved or not. */
const said = (comment: Comment): string => JSON.stringify(commentJson({ ...comment, resolved: undefined, reply: undefined }))

/**
 * Two reviews written apart from one they both started from (`base`): the
 * page's (`mine`) and the file's now (`theirs`, which the agent may have
 * written with `pixel resolve`). An asset only one side changed takes that
 * side; an asset both changed keeps the page's, with any comment the agent
 * resolved meanwhile resolved.
 */
export const mergeReviews = (base: Review, mine: Review, theirs: Review): Review => {
  const assets: Record<string, AssetReview> = {}
  for (const path of new Set([...Object.keys(base.assets), ...Object.keys(mine.assets), ...Object.keys(theirs.assets)])) {
    const was = base.assets[path] ?? newAsset
    const ours = mine.assets[path] ?? newAsset
    const other = theirs.assets[path] ?? newAsset
    const merged = same(ours, was)
      ? other
      : same(other, was)
        ? ours
        : {
            ...ours,
            comments: ours.comments.map((comment) => {
              if (comment.resolved === true || !was.comments.some((entry) => entry.resolved !== true && said(entry) === said(comment))) return comment
              return other.comments.find((entry) => entry.resolved === true && said(entry) === said(comment)) ?? comment
            })
          }
    if (!isEmpty(merged)) assets[path] = merged
  }
  return { assets }
}

// ---------------------------------------------------------------------------
// What the agent reads

/** Where a comment is, in words: "walk frame 2, pixels 3,4 to 6,7". */
export const whereOf = (comment: Comment): string => {
  const width = comment.width ?? 1
  const height = comment.height ?? 1
  const pixels = width === 1 && height === 1 ? `pixel ${comment.x},${comment.y}` : `pixels ${comment.x},${comment.y} to ${comment.x + width - 1},${comment.y + height - 1}`
  return comment.animation === undefined ? (comment.frame === 0 ? pixels : `frame ${comment.frame}, ${pixels}`) : `${comment.animation} frame ${comment.frame}, ${pixels}`
}

/** What `pixel notes` says about one asset's review: its status, note, open comments (numbered, as `pixel resolve` takes them), and what changed since it was approved. */
export const reviewSummary = (review: AssetReview, frames: ReadonlyArray<Frame> | undefined) => {
  const changed = frames === undefined ? undefined : changedOf(review, frames)
  // Open comments only, each with its number: resolved ones are done.
  const open = review.comments.flatMap((comment, index) => (comment.resolved === true ? [] : [{ number: index + 1, where: whereOf(comment), ...comment }]))
  const resolved = review.comments.length - open.length
  return {
    status: review.status,
    note: review.note === "" ? undefined : review.note,
    comments: open.length === 0 ? undefined : open,
    resolved: resolved === 0 ? undefined : resolved,
    changedSinceApproved: changed,
    next:
      changed !== undefined
        ? "It changed since the person approved it. Tell them what changed and ask them to look again; only they approve it."
        : review.status === "approved"
          ? "The person approved it. Leave it as it is."
          : open.length > 0 || review.note !== ""
            ? "Act on the note and each comment where it points, then `pixel resolve` the comments with a reply saying what changed, and tell the person."
            : review.status === "changes"
              ? "The person asked for changes but said nothing yet: ask them what."
              : "Nothing said yet. Wait for the person, or ask them to look."
  }
}

interface Summarized {
  readonly status: Status
  readonly changedSinceApproved?: string | undefined
}

const urgency = (entry: Summarized): number => (entry.status === "changes" ? 0 : entry.changedSinceApproved !== undefined ? 1 : entry.status === "new" ? 2 : 3)

/** What is left to do across the assets, with them in the order to act on them: changes asked, changed since approved, not reviewed yet, approved. */
export const pixelSummary = <A extends Summarized>(entries: ReadonlyArray<A>) => {
  const total = (status: Status): number => entries.filter((entry) => entry.status === status).length
  const stale = entries.filter((entry) => entry.changedSinceApproved !== undefined).length
  return {
    summary: `${total("approved")} approved${stale === 0 ? "" : ` (${stale} changed since: ask the person to look again)`}, ${total("changes")} with changes asked, ${total("new")} not reviewed yet (of ${entries.length}).`,
    assets: [...entries].sort((a, b) => urgency(a) - urgency(b))
  }
}
