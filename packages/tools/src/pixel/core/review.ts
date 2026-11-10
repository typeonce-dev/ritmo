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
import { approvedSaid, goneSaid, isUnrecorded, statuses, UNRECORDED_NEXT, type Status } from "../../internal/review.ts"
import type { RgbaImage } from "./grid.ts"
import { facings, isFacing, type Facing } from "./normals.ts"
import type { Decoded } from "./recipe.ts"


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
  /** Set when the comment is about the normal map, not the art: the agent corrects the map and leaves the art as it is. */
  readonly about?: "map" | undefined
  /** Which way the surface here should face, on a comment about the normal map: exact where the words are not. */
  readonly facing?: Facing | undefined
  readonly resolved?: boolean | undefined
  readonly reply?: string | undefined
}

/** What the person saw when they approved a part of an asset: a hash of each frame's pixels, in the sheet's order, how long each frame shows (a still has none), and, for a normal map, a hash of the map under each frame, since a map is judged on the art it lights. */
export interface Approved {
  readonly frames: ReadonlyArray<string>
  readonly durations?: ReadonlyArray<number> | undefined
  readonly normal?: ReadonlyArray<string> | undefined
}

/** What the person said about one part of an asset. */
export interface PartReview {
  readonly status: Status
  readonly note: string
  /** Set when the person approves. */
  readonly approved?: Approved | undefined
}

/**
 * One asset's review. Its own status and note are a still's. On a sheet they
 * stand in for each animation with no review of its own, which is what a
 * review from before animations had their own says.
 */
export interface AssetReview extends PartReview {
  readonly comments: ReadonlyArray<Comment>
  /** A sheet's animations, by name, each reviewed apart. */
  readonly animations?: Readonly<Record<string, PartReview>> | undefined
  /** A still's normal map, reviewed apart from it. On a sheet it stands in for each animation's map with no review of its own. */
  readonly map?: PartReview | undefined
  /** A sheet's normal map, by animation, each judged on that animation in motion. */
  readonly maps?: Readonly<Record<string, PartReview>> | undefined
}

export interface Review {
  readonly assets: Readonly<Record<string, AssetReview>>
}

export const emptyReview: Review = { assets: {} }
export const newAsset: AssetReview = { status: "new", note: "", comments: [] }
const newPart: PartReview = { status: "new", note: "" }

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
  /** A hash of the normal map under it, when the art has a map. */
  readonly normal?: string | undefined
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
  const remapped = approved.normal === undefined ? [] : frames.filter((frame, i) => frame.normal !== approved.normal?.[i])
  if (remapped.length > 0) parts.push(remapped.length === frames.length ? "its normal map changed" : `the normal map of ${framesNamed(remapped)} changed`)
  return parts.length === 0 ? undefined : parts.join("; ")
}

// ---------------------------------------------------------------------------
// The parts of an asset, each reviewed apart

/** What the person reviews on its own: a still's sprite or its normal map, or one animation of a sheet or that animation's normal map. */
export type Part = { readonly kind: "sprite" } | { readonly kind: "animation"; readonly name: string } | { readonly kind: "map"; readonly name?: string | undefined }

/** What an asset has to review, as it is now. */
export interface ArtShape {
  readonly frames: ReadonlyArray<Frame>
  /** A sheet's animations, each its frames as indices into `frames`; none for a still. */
  readonly animations: ReadonlyArray<{ readonly name: string; readonly frames: ReadonlyArray<number> }>
  /** A hash of the normal map beside it, when there is one. */
  readonly normal: string | undefined
}

/** An asset's parts, art first. */
export const partsOf = (shape: ArtShape): ReadonlyArray<Part> => [
  ...(shape.animations.length > 0 ? shape.animations.map((animation): Part => ({ kind: "animation", name: animation.name })) : [{ kind: "sprite" } as const]),
  ...(shape.normal === undefined ? [] : shape.animations.length > 0 ? shape.animations.map((animation): Part => ({ kind: "map", name: animation.name })) : [{ kind: "map" } as const])
]

export const samePart = (a: Part, b: Part): boolean => a.kind === b.kind && (a.kind === "sprite" || b.kind === "sprite" || a.name === b.name)

/** A part in words. */
export const partName = (part: Part): string => (part.kind === "animation" ? part.name : part.kind === "sprite" ? "sprite" : part.name === undefined ? "normal map" : `${part.name} normal map`)

/** The part a comment is on: an animation that is gone still names its animation. */
export const partOfComment = (comment: Comment): Part =>
  comment.about === "map" ? (comment.animation === undefined ? { kind: "map" } : { kind: "map", name: comment.animation }) : comment.animation !== undefined ? { kind: "animation", name: comment.animation } : { kind: "sprite" }

/** What was said about a part. */
export const partReview = (review: AssetReview, part: Part): PartReview =>
  part.kind === "map" ? ((part.name === undefined ? undefined : review.maps?.[part.name]) ?? review.map ?? newPart) : part.kind === "sprite" ? review : (review.animations?.[part.name] ?? review)

/** The review with a change to one part: an animation, or its map, that took its review from elsewhere gets its own. */
export const withPart = (review: AssetReview, part: Part, change: Partial<PartReview>): AssetReview =>
  part.kind === "map"
    ? part.name === undefined
      ? { ...review, map: { ...partReview(review, part), ...change } }
      : { ...review, maps: { ...review.maps, [part.name]: { ...partOwn(partReview(review, part)), ...change } } }
    : part.kind === "sprite"
      ? { ...review, ...change }
      : { ...review, animations: { ...review.animations, [part.name]: { ...partOwn(partReview(review, part)), ...change } } }

/** A part's status, note, and approval alone, whatever else the review it came from holds. */
const partOwn = (said: PartReview): PartReview => ({ status: said.status, note: said.note, ...(said.approved === undefined ? {} : { approved: said.approved }) })

/** The frames a part is judged on. */
export const partFrames = (shape: ArtShape, part: Part): ReadonlyArray<Frame> => {
  if (part.kind === "sprite" || part.name === undefined) return shape.frames
  const animation = shape.animations.find((entry) => entry.name === part.name)
  return animation === undefined ? [] : animation.frames.flatMap((index) => shape.frames[index] ?? [])
}

/** What to keep when the person approves a part, as it looks now. */
export const approvalOfPart = (shape: ArtShape, part: Part): Approved => {
  const frames = partFrames(shape, part)
  return part.kind === "map" ? { ...approvalOf(frames), normal: frames.map((frame) => frame.normal ?? "") } : approvalOf(frames)
}

/** What changed since the person approved this part, when they did and something has. A review with no hashes has nothing to compare. */
export const changedOfPart = (review: AssetReview, shape: ArtShape, part: Part): string | undefined => {
  const said = partReview(review, part)
  const approved = said.approved
  if (said.status !== "approved" || approved === undefined) return undefined
  const frames = partFrames(shape, part)
  if (part.kind !== "animation" || review.animations?.[part.name] !== undefined) return changedSince(approved, frames)
  // Approved as a whole sheet: its hashes are in the sheet's order, so only the frames of this animation count.
  if (approved.frames.length !== shape.frames.length) return `${shape.frames.length} frame${shape.frames.length === 1 ? "" : "s"} on the sheet, ${approved.frames.length} when approved`
  const places = frames.map((frame) => shape.frames.indexOf(frame))
  const durations = approved.durations
  return changedSince({ frames: places.map((i) => approved.frames[i]!), ...(durations === undefined ? {} : { durations: places.map((i) => durations[i]!) }) }, frames)
}

/** One status for some parts: changes asked if any part has them, approved once all are, else not reviewed yet. */
const statusOfAll = (statuses: ReadonlyArray<Status>): Status => (statuses.includes("changes") ? "changes" : statuses.length > 0 && statuses.every((status) => status === "approved") ? "approved" : "new")

/** The one status of some of an asset's parts. */
export const partsStatus = (review: AssetReview, parts: ReadonlyArray<Part>): Status => statusOfAll(parts.map((part) => partReview(review, part).status))

/** The asset's one status, for the list and its counts. */
export const assetStatus = (review: AssetReview, shape: ArtShape): Status => partsStatus(review, partsOf(shape))

/** The asset's one status from the review alone, for art that is gone or cannot be read. */
export const statusSaid = (review: AssetReview): Status => statusOfAll([...Object.values(review.animations ?? {}).map((part) => part.status), ...Object.values(review.maps ?? {}).map((part) => part.status), ...(review.map === undefined ? [] : [review.map.status]), ...(review.animations === undefined ? [review.status] : [])])

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
  if (raw.facing !== undefined && !isFacing(raw.facing)) {
    errors.push(`${where}.facing must be one of ${facings.join(", ")}`)
    return undefined
  }
  if (raw.about !== undefined && raw.about !== "map") {
    errors.push(`${where}.about must be "map", or left out for the art`)
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
    // A direction is only ever about the map.
    about: raw.about === "map" || raw.facing !== undefined ? "map" : undefined,
    facing: raw.facing,
    resolved: raw.resolved === true,
    reply: typeof raw.reply === "string" ? raw.reply : undefined
  })
}

const approvedOf = (raw: unknown): Approved | undefined => {
  if (!isRecord(raw) || !Array.isArray(raw.frames) || !raw.frames.every((hash) => typeof hash === "string")) return undefined
  const frames: ReadonlyArray<string> = raw.frames
  const hashes = raw.normal
  if (hashes !== undefined && (!Array.isArray(hashes) || !hashes.every((hash) => typeof hash === "string"))) return undefined
  const normal = hashes === undefined ? {} : { normal: hashes }
  if (raw.durations === undefined) return { frames, ...normal }
  if (!Array.isArray(raw.durations) || raw.durations.length !== frames.length || !raw.durations.every((d) => typeof d === "number")) return undefined
  const durations: ReadonlyArray<number> = raw.durations
  return { frames, durations, ...normal }
}

const partOf = (raw: Record<string, unknown>, where: string, errors: Array<string>): PartReview => {
  const status = statuses.find((entry) => entry === raw.status)
  if (raw.status !== undefined && status === undefined) errors.push(`${where}.status must be one of ${statuses.join(", ")}`)
  const approved = approvedOf(raw.approved)
  if (raw.approved !== undefined && approved === undefined) errors.push(`${where}.approved must be {"frames": ["hash", ...], "durations": [ms, ...]}`)
  return { status: status ?? "new", note: typeof raw.note === "string" ? raw.note : "", ...(approved === undefined ? {} : { approved }) }
}

/** Parts reviewed by an animation's name. */
const namedPartsOf = (raw: unknown, where: string, errors: Array<string>): Record<string, PartReview> => {
  if (raw !== undefined && !isRecord(raw)) errors.push(`${where} must be {"name": {"status", "note"}}`)
  const parts: Record<string, PartReview> = {}
  for (const [name, part] of Object.entries(isRecord(raw) ? raw : {})) {
    if (isRecord(part)) parts[name] = partOf(part, `${where}.${name}`, errors)
    else errors.push(`${where}.${name} must be {"status", "note"}`)
  }
  return parts
}

const assetOf = (raw: unknown, where: string, errors: Array<string>): AssetReview | undefined => {
  if (!isRecord(raw)) {
    errors.push(`${where} must be {"status", "note", "comments"}`)
    return undefined
  }
  const own = partOf(raw, where, errors)
  if (raw.comments !== undefined && !Array.isArray(raw.comments)) errors.push(`${where}.comments must be a list`)
  const comments = (Array.isArray(raw.comments) ? raw.comments : []).flatMap((comment, i) => commentOf(comment, `${where}.comments[${i}]`, errors) ?? [])
  const animations = namedPartsOf(raw.animations, `${where}.animations`, errors)
  const maps = namedPartsOf(raw.maps, `${where}.maps`, errors)
  if (raw.map !== undefined && !isRecord(raw.map)) errors.push(`${where}.map must be {"status", "note"}`)
  return { ...own, comments, ...(Object.keys(animations).length === 0 ? {} : { animations }), ...(isRecord(raw.map) ? { map: partOf(raw.map, `${where}.map`, errors) } : {}), ...(Object.keys(maps).length === 0 ? {} : { maps }) }
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

const partSaysNothing = (part: PartReview): boolean => part.status === "new" && part.note === "" && part.approved === undefined

/** Whether a review says nothing: no part reviewed, no note, no comments. */
export const isEmpty = (review: AssetReview): boolean =>
  partSaysNothing(review) && review.comments.length === 0 && Object.values(review.animations ?? {}).every(partSaysNothing) && Object.values(review.maps ?? {}).every(partSaysNothing) && (review.map === undefined || partSaysNothing(review.map))

/** A comment with its fields in one order, as the file writes it. */
const commentJson = (comment: Comment): Comment => ({
  ...(comment.animation === undefined ? {} : { animation: comment.animation }),
  frame: comment.frame,
  x: comment.x,
  y: comment.y,
  ...(comment.width === undefined || comment.width === 1 ? {} : { width: comment.width }),
  ...(comment.height === undefined || comment.height === 1 ? {} : { height: comment.height }),
  text: comment.text,
  ...(comment.about === undefined ? {} : { about: comment.about }),
  ...(comment.facing === undefined ? {} : { facing: comment.facing }),
  ...(comment.resolved === true ? { resolved: true } : {}),
  ...(comment.reply === undefined || comment.reply === "" ? {} : { reply: comment.reply })
})

const approvedJson = (approved: Approved | undefined) =>
  approved === undefined ? {} : { approved: { frames: approved.frames, ...(approved.durations === undefined ? {} : { durations: approved.durations }), ...(approved.normal === undefined ? {} : { normal: approved.normal }) } }

/** A part's review as the file writes it. */
const partJson = (part: PartReview) => ({ status: part.status, ...(part.note === "" ? {} : { note: part.note }), ...approvedJson(part.approved) })

/** Parts by name as the file writes them: those that say nothing left out. */
const namedPartsJson = (parts: Readonly<Record<string, PartReview>> | undefined) => {
  const said = Object.entries(parts ?? {}).filter(([, part]) => !partSaysNothing(part))
  return said.length === 0 ? undefined : Object.fromEntries(said.map(([name, part]) => [name, partJson(part)]))
}

/** An asset's review as the file writes it: what is unset left out. */
const assetJson = (entry: AssetReview) => {
  const animations = namedPartsJson(entry.animations)
  const maps = namedPartsJson(entry.maps)
  return {
    status: entry.status,
    ...(entry.note === "" ? {} : { note: entry.note }),
    ...(entry.comments.length === 0 ? {} : { comments: entry.comments.map(commentJson) }),
    ...approvedJson(entry.approved),
    ...(animations === undefined ? {} : { animations }),
    ...(entry.map === undefined || partSaysNothing(entry.map) ? {} : { map: partJson(entry.map) }),
    ...(maps === undefined ? {} : { maps })
  }
}

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

/** What `pixel notes` says about one asset's review: its one status and what changed, each part apart when it has several, its open comments (numbered, as `pixel resolve` takes them), and what is left of parts that are gone. */
export const reviewSummary = (review: AssetReview, shape: ArtShape | undefined) => {
  const parts = shape === undefined ? [] : partsOf(shape)
  const changedParts = shape === undefined ? [] : parts.flatMap((part) => {
    const changed = changedOfPart(review, shape, part)
    return changed === undefined ? [] : [{ part, changed }]
  })
  const changed = changedParts.length === 0 ? undefined : parts.length === 1 ? changedParts[0]!.changed : changedParts.map((entry) => (entry.changed.startsWith(partName(entry.part)) ? entry.changed : `${partName(entry.part)}: ${entry.changed}`)).join("; ")
  // Open comments only, each with its number: resolved ones are done.
  const open = review.comments.flatMap((comment, index) => (comment.resolved === true ? [] : [{ number: index + 1, where: `${comment.about === "map" ? "normal map, " : ""}${whereOf(comment)}`, ...comment }]))
  const resolved = review.comments.length - open.length
  const status = shape === undefined ? statusSaid(review) : assetStatus(review, shape)
  // A part's own words: the asset's note is said once, on the asset.
  const ownNote = (part: Part): string | undefined => {
    const note = part.kind === "map" ? partReview(review, part).note : part.kind === "animation" ? review.animations?.[part.name]?.note : undefined
    return note === "" ? undefined : note
  }
  const each = parts.length < 2 || shape === undefined
    ? undefined
    : parts.map((part) => {
        const partChanged = changedParts.find((entry) => samePart(entry.part, part))?.changed
        return { part: part.kind, ...(part.kind !== "sprite" && part.name !== undefined ? { animation: part.name } : {}), status: partReview(review, part).status, note: ownNote(part), changedSinceApproved: partChanged }
      })
  const gone = (kind: Part["kind"], name: string | undefined, said: PartReview) => ({ part: kind, animation: name, status: said.status, note: said.note === "" ? undefined : said.note })
  const named = (of: Readonly<Record<string, PartReview>> | undefined, kind: Part["kind"], here: (name: string) => boolean) => Object.entries(of ?? {}).filter(([name, said]) => !here(name) && !partSaysNothing(said)).map(([name, said]) => gone(kind, name, said))
  const goneParts = shape === undefined
    ? undefined
    : [
        ...named(review.animations, "animation", (name) => shape.animations.some((animation) => animation.name === name)),
        ...named(review.maps, "map", (name) => shape.normal !== undefined && shape.animations.some((animation) => animation.name === name)),
        ...(review.map !== undefined && shape.normal === undefined && !partSaysNothing(review.map) ? [gone("map", undefined, review.map)] : [])
      ]
  // Approved with nothing kept of what was seen: nothing to compare it with.
  const unrecorded = shape !== undefined && parts.some((part) => isUnrecorded(partReview(review, part).status, partReview(review, part).approved))
  const worded = open.length > 0 || review.note !== "" || (each?.some((part) => part.note !== undefined) ?? false)
  const partly = status === "new" && parts.some((part) => partReview(review, part).status === "approved")
  // Said once for the asset: how to read what the parts and the comments carry.
  const about = [
    ...(each !== undefined && (worded || changed !== undefined) ? [" Each entry of `parts` is reviewed apart: change only the part that was asked about."] : []),
    ...(open.some((comment) => comment.about === "map") ? [" A comment with `about: \"map\"` is about the normal map: correct the map, not the art."] : []),
    ...(open.some((comment) => comment.facing !== undefined)
      ? [" A comment with `facing` says which way that surface should face: copy its animation, frame, x, y, width, height, and facing into `corrections` in the asset's `.normals.json`, and run `ritmo-tools pixel normals` on the asset again."]
      : [])
  ].join("")
  const withAbout = (next: string): string => `${next}${about}`
  return {
    status,
    note: review.note === "" ? undefined : review.note,
    ...(each === undefined ? {} : { parts: each }),
    comments: open.length === 0 ? undefined : open,
    resolved: resolved === 0 ? undefined : resolved,
    changedSinceApproved: changed,
    ...(goneParts === undefined || goneParts.length === 0 ? {} : { goneParts }),
    ...(unrecorded ? { unrecorded: true as const } : {}),
    next: withAbout(
      changed !== undefined
        ? `It changed since the person approved it. Tell them what changed and ask them to look again; only they approve it.${open.length > 0 ? " Then `pixel resolve` the comments you acted on, with a reply saying what changed." : ""}`
        : unrecorded
          ? UNRECORDED_NEXT
          : status === "approved" && open.length > 0
            ? "The person approved it and left comments too. Read each: change only what it asks for, `pixel resolve` it with a reply saying what changed, and if the art changed, ask them to look again."
            : status === "approved" && worded
              ? "The person approved it and left a note. Read it, and leave the art as it is unless the note asks for a change."
              : status === "approved"
                ? "The person approved it. Leave it as it is."
                : worded
                  ? "Act on the note and each comment where it points, then `pixel resolve` the comments with a reply saying what changed, and tell the person."
                  : status === "changes"
                    ? "The person asked for changes but said nothing yet: ask them what."
                    : partly
                      ? "The person approved some of it and has not judged the rest yet. Wait for them, or ask them to look."
                      : "Nothing said yet. Wait for the person, or ask them to look."
    )
  }
}

interface Summarized {
  readonly status: Status
  readonly note?: string | undefined
  /** Each part, when it has several: a note may be on one of them. */
  readonly parts?: ReadonlyArray<{ readonly note?: string | undefined }> | undefined
  /** The comments still open. */
  readonly comments?: ReadonlyArray<unknown> | undefined
  readonly changedSinceApproved?: string | undefined
  readonly unrecorded?: true | undefined
}

/** Whether the person said something about it without asking for changes: a note or comments, with no status set; or comments on what they approved. */
const leftWords = (entry: Summarized): boolean =>
  entry.status !== "changes" && (entry.comments !== undefined || (entry.status === "new" && (entry.note !== undefined || (entry.parts?.some((part) => part.note !== undefined) ?? false))))

const urgency = (entry: Summarized): number => (entry.status === "changes" || leftWords(entry) ? 0 : entry.changedSinceApproved !== undefined || entry.unrecorded === true ? 1 : entry.status === "new" ? 2 : 3)

/** What is left to do across the assets, with them in the order to act on them: changes asked or words left, changed since approved (or approved with no record), not reviewed yet, approved. `gone` counts the reviews whose art is no longer found. */
export const pixelSummary = <A extends Summarized>(entries: ReadonlyArray<A>, gone = 0) => {
  const total = (status: Status): number => entries.filter((entry) => entry.status === status).length
  const approvedWords = entries.filter((entry) => entry.status === "approved" && leftWords(entry)).length
  const newWords = entries.filter((entry) => entry.status === "new" && leftWords(entry)).length
  return {
    summary: `${approvedSaid(entries, "look", approvedWords === 0 ? [] : [`${approvedWords} with open comments: read them`])}, ${total("changes")} with changes asked, ${newWords === 0 ? "" : `${newWords} with a note or comments but no status set: act on them, `}${total("new") - newWords} not reviewed yet (of ${entries.length}).${goneSaid(gone)}`,
    assets: [...entries].sort((a, b) => urgency(a) - urgency(b))
  }
}
