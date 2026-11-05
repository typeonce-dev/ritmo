/**
 * The pixel art a review covers: the pictures and text sprites under the
 * paths the agent names, each read as the game would draw it (a still, or a
 * sheet of animations), hashed, and linted against its nearest
 * `pixel.config.json`, with what the person said about it. The page and
 * `pixel notes` both read it here, so they agree on what there is.
 *
 * A folder's files are found by name, and what the pixel tools write beside
 * an asset is left out: previews, project PNGs, onion skins, enlarged copies
 * (`@4x`), and a sheet's frames. Where a tool's output sits beside what it
 * was made from (`pic.png` and `pic.fixed.png`, `x.sprite.txt` and
 * `x.sprite.render.png`), the review shows the output, the file the game
 * uses, and names the other as its source. A text file is an asset only
 * when it reads as a sprite: prompts and notes sit beside sprites too. A
 * file named outright is always taken.
 */
import { existsSync, statSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { basename, dirname, extname, join, relative, resolve } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { Effect, Option } from "effect"
import { idOf, posix, rootOf, walk } from "../../internal/files.ts"
import { hashText } from "../../internal/hash.ts"
import { mtime } from "../../internal/serve.ts"
import { toRgba } from "../core/export.ts"
import type { RgbaImage } from "../core/grid.ts"
import type { Severity } from "../core/lint.ts"
import { reportOfArt } from "../core/report.ts"
import { decodeReview, emptyReview, encodeReview, hashFrame, REVIEW_FILE, type AssetReview, type Frame, type Review } from "../core/review.ts"
import { artOfImage, parseJsonMap, parseSprite } from "../core/sprite.ts"
import { readSpritesheet, type SheetAnimationRead } from "../core/spritesheet.ts"
import type { Detail, Entry, FrameIssue } from "../review/store.ts"
import { CONFIG_FILE, loadConfig } from "./config.ts"
import { decodePicture, encodePng } from "./png.ts"

export interface PixelAsset {
  /** How the page names it: its path from the working directory, with `/` between folders. */
  readonly id: string
  /** A picture (PNG), or pixel art written as text (a sprite source, or a JSON map named outright). */
  readonly kind: "picture" | "text"
  readonly file: string
  /** What it was made from, when that sits beside it (`pic.png` for `pic.fixed.png`). */
  readonly source: string | undefined
}

const PICTURE = /\.(png|jpe?g)$/i
/** What the pixel tools write beside an asset that is not an asset: a preview, a project PNG, an onion skin, an enlarged copy and its JSON. */
const TOOL_OUTPUT = /(\.(preview|project|onion)\.png|@\d+x\.(png|json))$/i
/** A sheet's frames, written one PNG each. */
const isFrames = (name: string): boolean => name.endsWith(".frames")
/** The outputs named after what they were made from: `pixel fix`, `sheet`, and `pixelate` (from a picture), `render` (from text). */
const MADE = /^(.*)\.(fixed|sheet|pixel|render)\.png$/i

const stemOf = (file: string): string => file.slice(0, file.length - extname(file).length)

/** Text files that read as sprites, by their mtime: a folder's text is read once until it changes. */
const sprites = new Map<string, { readonly time: number; readonly sprite: boolean }>()
const isSprite = async (file: string): Promise<boolean> => {
  const time = await mtime(file)
  const known = sprites.get(file)
  if (known?.time === time) return known.sprite
  const sprite = parseSprite(await readFile(file, "utf8").catch(() => "")).ok
  sprites.set(file, { time, sprite })
  return sprite
}

/** The assets in a folder: its PNGs and text sprites, each output in place of what it was made from. */
const inFolder = async (folder: string): Promise<Array<PixelAsset>> => {
  const all = await walk(folder, isFrames)
  const names = new Set(all)
  const pictures = all.filter((file) => /\.png$/i.test(file) && !TOOL_OUTPUT.test(file))
  const texts = all.filter((file) => /\.txt$/i.test(file))
  const sources = new Map<string, string>()
  const covered = new Set<string>()
  for (const picture of pictures) {
    const made = MADE.exec(picture)
    if (made === null) continue
    const from = (made[2]!.toLowerCase() === "render" ? [".txt", ".json"] : [".png", ".jpg", ".jpeg"]).map((extension) => made[1]! + extension).find((file) => names.has(file))
    if (from === undefined) continue
    sources.set(picture, from)
    covered.add(from)
  }
  // A text sprite beside a PNG of its name (`hero.txt` or `hero.sprite.txt` by `hero.png`) is that PNG again, as text.
  const shown = new Set(pictures.filter((picture) => !covered.has(picture)))
  for (const text of texts) {
    const stem = stemOf(text)
    const picture = [`${stem}.png`, `${stem.replace(/\.sprite$/i, "")}.png`].find((file) => shown.has(file))
    if (picture === undefined) continue
    covered.add(text)
    if (!sources.has(picture)) sources.set(picture, text)
  }
  const found: Array<PixelAsset> = [...shown].map((file) => ({ id: idOf(file), kind: "picture", file, source: sources.get(file) }))
  for (const text of texts) if (!covered.has(text) && (await isSprite(text))) found.push({ id: idOf(text), kind: "text", file: text, source: undefined })
  return found
}

/** Every asset under `paths` (files or folders), in path order; a path that is gone is passed over. */
export const findAssets = async (paths: ReadonlyArray<string>): Promise<ReadonlyArray<PixelAsset>> => {
  const assets = new Map<string, PixelAsset>()
  for (const path of paths) {
    const absolute = resolve(path)
    if (!existsSync(absolute)) continue
    if (statSync(absolute).isDirectory()) for (const asset of await inFolder(absolute)) assets.set(asset.file, asset)
    else assets.set(absolute, { id: idOf(absolute), kind: PICTURE.test(absolute) ? "picture" : "text", file: absolute, source: undefined })
  }
  return [...assets.values()].sort((a, b) => a.id.localeCompare(b.id))
}

// ---------------------------------------------------------------------------
// Reading an asset as the game draws it

export type Lint =
  | { readonly ok: true; readonly issues: ReadonlyArray<FrameIssue>; readonly errors: number; readonly warnings: number; readonly config: string | undefined }
  | { readonly ok: false; readonly problem: string }

export type AssetRead =
  | {
      readonly ok: true
      /** Its size: the pixels are not kept, so a game's worth of reads stays small. */
      readonly width: number
      readonly height: number
      readonly frames: ReadonlyArray<Frame>
      readonly animations: ReadonlyArray<SheetAnimationRead>
      /** The sheet's JSON, when it is a sheet. */
      readonly sheet: string | undefined
      readonly lint: Lint
    }
  | { readonly ok: false; readonly problem: string }

/** The nearest `pixel.config.json` at or above the asset's folder. */
const configOf = (file: string): string | undefined => {
  let folder = dirname(file)
  for (;;) {
    const config = join(folder, CONFIG_FILE)
    if (existsSync(config)) return config
    const parent = dirname(folder)
    if (parent === folder) return undefined
    folder = parent
  }
}

/** Where a picture's sheet JSON would be: beside it, by its name. */
const sheetFileOf = (asset: PixelAsset): string | undefined => (asset.kind === "picture" ? `${stemOf(asset.file)}.json` : undefined)

/** Changes when what the asset draws or how it is linted does: its file, its sheet JSON, its config. */
export const assetVersion = async (asset: PixelAsset): Promise<string> => {
  const config = configOf(asset.file)
  const sheet = sheetFileOf(asset)
  return hashText(`${await mtime(asset.file)}:${sheet === undefined ? 0 : await mtime(sheet)}:${config ?? ""}:${config === undefined ? 0 : await mtime(config)}`)
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const configs = new Map<string, { readonly time: number; readonly rules: Promise<{ readonly ok: true; readonly rules: Parameters<typeof reportOfArt>[1] } | { readonly ok: false; readonly problem: string }> }>()
const rulesOf = async (config: string) => {
  const time = await mtime(config)
  const known = configs.get(config)
  if (known?.time === time) return known.rules
  const rules = Effect.runPromise(
    loadConfig(Option.some(config)).pipe(
      Effect.map((loaded) => ({ ok: true as const, rules: loaded.rules })),
      Effect.catch((failure) => Effect.succeed({ ok: false as const, problem: failure.message })),
      Effect.provide(NodeServices.layer)
    )
  )
  configs.set(config, { time, rules })
  return rules
}

/** The part of a picture one frame covers. */
const crop = (image: RgbaImage, frame: Frame): RgbaImage => {
  const data = new Uint8ClampedArray(frame.w * frame.h * 4)
  for (let y = 0; y < frame.h; y++) data.set(image.data.subarray(((frame.y + y) * image.width + frame.x) * 4, ((frame.y + y) * image.width + frame.x + frame.w) * 4), y * frame.w * 4)
  return { width: frame.w, height: frame.h, data }
}

const lintOf = async (asset: PixelAsset, image: RgbaImage, frames: ReadonlyArray<Frame>, art: Parameters<typeof reportOfArt>[0] | undefined): Promise<Lint> => {
  const config = configOf(asset.file)
  const loaded = config === undefined ? { ok: true as const, rules: {} } : await rulesOf(config)
  if (!loaded.ok) return { ok: false, problem: loaded.problem }
  const issues: Array<FrameIssue> = []
  if (frames.length === 1 && frames[0]!.animation === undefined) {
    // A still: the art as written (a text sprite), or the picture taken at its own size.
    const read = art === undefined ? artOfImage(image) : { art, partial: 0 }
    issues.push(...reportOfArt(read.art, loaded.rules, read.partial).issues)
  } else
    for (const [index, frame] of frames.entries()) {
      const cropped = crop(image, frame)
      // A frame with nothing drawn shows as a blink when it plays: a box that missed its art.
      if (!cropped.data.some((value, i) => i % 4 === 3 && value > 0)) {
        issues.push({ rule: "empty-frame", severity: "error", message: "Nothing is drawn in this frame: its box missed the art, or the frame is left over", count: 0, at: [], frame: index })
        continue
      }
      const read = artOfImage(cropped)
      issues.push(...reportOfArt(read.art, loaded.rules, read.partial).issues.map((issue) => ({ ...issue, frame: index })))
    }
  const count = (severity: Severity): number => issues.filter((issue) => issue.severity === severity).length
  return { ok: true, issues, errors: count("error"), warnings: count("warning"), config: config === undefined ? undefined : idOf(config) }
}

const read = async (asset: PixelAsset): Promise<AssetRead> => {
  try {
    if (asset.kind === "text") {
      const text = await readFile(asset.file, "utf8")
      const parsed = /\.json$/i.test(asset.file) ? parseJsonMap(text) : parseSprite(text)
      if (!parsed.ok) return { ok: false, problem: parsed.problems.map((problem) => (problem.line === undefined ? problem.message : `line ${problem.line}: ${problem.message}`)).join("; ") }
      const image = toRgba(parsed.art)
      const frames: ReadonlyArray<Frame> = [{ name: "", index: 0, x: 0, y: 0, w: image.width, h: image.height, hash: hashFrame(image, 0, 0, image.width, image.height) }]
      return { ok: true, width: image.width, height: image.height, frames, animations: [], sheet: undefined, lint: await lintOf(asset, image, frames, parsed.art) }
    }
    const bytes = await readFile(asset.file)
    let image: RgbaImage
    try {
      image = decodePicture(bytes)
    } catch (error) {
      // Said as the other pixel commands say it: the decoder's words alone ("unrecognised content at end of stream") name no file.
      return { ok: false, problem: `it is not a PNG or a JPEG that decodes: ${message(error)}` }
    }
    const sheetFile = sheetFileOf(asset)
    const json: unknown = sheetFile === undefined ? undefined : await readFile(sheetFile, "utf8").then((text): unknown => JSON.parse(text)).catch(() => undefined)
    const sheet = readSpritesheet(json, image)
    if (sheet?.ok === false) return { ok: false, problem: `${basename(sheetFile ?? "")}: ${sheet.error}` }
    const animations = sheet?.sheet.animations ?? []
    const frames: ReadonlyArray<Frame> =
      sheet === undefined
        ? [{ name: "", index: 0, x: 0, y: 0, w: image.width, h: image.height, hash: hashFrame(image, 0, 0, image.width, image.height) }]
        : sheet.sheet.frames.map((rect, i) => {
            // A frame belongs to the first animation that plays it, at its first place there.
            const animation = animations.find((entry) => entry.frames.includes(i))
            return { name: rect.name, animation: animation?.name ?? "frames", index: animation?.frames.indexOf(i) ?? i, x: rect.x, y: rect.y, w: rect.w, h: rect.h, duration: rect.duration, hash: hashFrame(image, rect.x, rect.y, rect.w, rect.h) }
          })
    return { ok: true, width: image.width, height: image.height, frames, animations, sheet: sheet === undefined ? undefined : sheetFile, lint: await lintOf(asset, image, frames, undefined) }
  } catch (error) {
    return { ok: false, problem: message(error) }
  }
}

let turns: Promise<unknown> = Promise.resolve()

/** One read at a time, letting the server answer between them: decoding and linting a picture block it, and a large folder holds thousands. */
const inTurn = <A>(run: () => Promise<A>): Promise<A> => {
  const turn = turns.then(() => new Promise((next) => setImmediate(next))).then(run)
  turns = turn.catch(() => undefined)
  return turn
}

/** Each asset's read, by its version: the page's poll reads nothing again until a file changes, and two polls at once share one read. */
const reads = new Map<string, { readonly version: string; readonly read: Promise<AssetRead>; done: boolean }>()
export const readAsset = async (asset: PixelAsset): Promise<AssetRead> => {
  const version = await assetVersion(asset)
  const known = reads.get(asset.file)
  if (known?.version === version) return known.read
  const fresh = inTurn(() => read(asset))
  const entry = { version, read: fresh, done: false }
  reads.set(asset.file, entry)
  void fresh.finally(() => {
    entry.done = true
  })
  return fresh
}

/**
 * The picture the page draws: a PNG or JPEG file as it is, which a browser
 * reads the way the game's does, and a text sprite rendered. Made when asked
 * for and not kept: a page opening the whole set asks for them all, and its
 * saves wait behind them for a connection if each takes long.
 */
export const pictureOf = async (asset: PixelAsset): Promise<{ readonly bytes: Uint8Array; readonly type: string }> => {
  if (asset.kind === "picture") return { bytes: await readFile(asset.file), type: /\.png$/i.test(asset.file) ? "image/png" : "image/jpeg" }
  const text = await readFile(asset.file, "utf8")
  const parsed = /\.json$/i.test(asset.file) ? parseJsonMap(text) : parseSprite(text)
  if (!parsed.ok) throw new Error(`${asset.id} no longer reads as a sprite`)
  return { bytes: encodePng(toRgba(parsed.art)), type: "image/png" }
}

// ---------------------------------------------------------------------------
// The review file

/** Where an asset's review is kept: the shared file at the game's root, and the asset's key in it. */
export const reviewPlace = (file: string): { readonly reviews: string; readonly key: string } => {
  const root = rootOf(file)
  return { reviews: join(root, REVIEW_FILE), key: posix(relative(root, file)) }
}

/** A review file's text, `null` when there is none yet. */
const textOf = (reviews: string): Promise<string | null> => readFile(reviews, "utf8").catch(() => null)

export const readReviewFile = async (reviews: string): Promise<Review> => {
  const text = await textOf(reviews)
  if (text === null) return { assets: {} }
  const decoded = decodeReview(text)
  if (!decoded.ok) throw new Error(`${reviews}: ${decoded.error}`)
  return decoded.value
}

/** The review files the assets' reviews live in, each with the assets in it. */
const filesOf = (assets: ReadonlyArray<PixelAsset>): Map<string, Array<PixelAsset>> => {
  const files = new Map<string, Array<PixelAsset>>()
  for (const asset of assets) {
    const { reviews } = reviewPlace(asset.file)
    files.set(reviews, [...(files.get(reviews) ?? []), asset])
  }
  return files
}

/**
 * Changes when what the page holds would: the reviews of these assets as their
 * files say them, so the page knows its own write from another. An asset going
 * away or coming back changes it too: a page that has not heard must not write
 * over a review it cannot see.
 */
export const reviewVersion = async (assets: ReadonlyArray<PixelAsset>): Promise<string> => {
  const parts: Array<string> = []
  for (const [reviews, inside] of [...filesOf(assets).entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const text = await textOf(reviews)
    const file = text === null ? ({ ok: true, value: emptyReview } as const) : decodeReview(text)
    parts.push(reviews, file.ok ? JSON.stringify(inside.map((asset) => [asset.id, file.value.assets[reviewPlace(asset.file).key] ?? null])) : (text ?? ""))
  }
  return hashText(parts.join("\u0000"))
}

/** The assets' reviews by their ids, as the page holds them; throws when a review file is broken. */
export const reviewsOf = async (assets: ReadonlyArray<PixelAsset>): Promise<Review> => {
  const byId: Record<string, AssetReview> = {}
  for (const [reviews, inside] of filesOf(assets)) {
    const file = await readReviewFile(reviews)
    for (const asset of inside) {
      const said = file.assets[reviewPlace(asset.file).key]
      if (said !== undefined) byId[asset.id] = said
    }
  }
  return { assets: byId }
}

let writing: Promise<unknown> = Promise.resolve()

/**
 * Writes the page's reviews (by id) of `assets` into their review files, one
 * write at a time: each file keeps every review of an asset not on the page
 * (one under another path, one whose file is gone).
 */
export const writeReviews = (assets: ReadonlyArray<PixelAsset>, review: Review): Promise<void> => {
  const write = writing.then(async () => {
    for (const [reviews, inside] of filesOf(assets)) {
      const file = await readReviewFile(reviews)
      const kept = { ...file.assets }
      for (const asset of inside) {
        const key = reviewPlace(asset.file).key
        const said = review.assets[asset.id]
        if (said === undefined) delete kept[key]
        else kept[key] = said
      }
      const text = encodeReview({ assets: kept })
      const now = await textOf(reviews)
      // Nothing said yet makes no file.
      if (text !== now && !(now === null && text === encodeReview(emptyReview))) await writeFile(reviews, text)
    }
  })
  writing = write.catch(() => undefined)
  return write
}

/** Writes one asset's review into its file, as `pixel resolve` does. */
export const writeReview = (asset: PixelAsset, said: AssetReview): Promise<void> => writeReviews([asset], { assets: { [asset.id]: said } })

/** Reviews in the assets' files whose asset is no longer found: renamed or deleted, so the agent can move them. */
export const goneOf = async (assets: ReadonlyArray<PixelAsset>, paths: ReadonlyArray<string>) => {
  const found = new Set(assets.map((asset) => asset.file))
  const folders = paths.map((path) => resolve(path)).filter((path) => existsSync(path) && statSync(path).isDirectory())
  const gone: Array<{ readonly file: string; readonly review: string; readonly key: string; readonly status: AssetReview["status"]; readonly note: string | undefined; readonly comments: number }> = []
  for (const reviews of filesOf(assets).keys()) {
    const root = dirname(reviews)
    for (const [key, said] of Object.entries((await readReviewFile(reviews)).assets)) {
      const file = join(root, key)
      if (found.has(file)) continue
      // Gone: deleted, or no longer an asset inside a folder under review. A review of art elsewhere is not this review's.
      if (existsSync(file) && !folders.some((folder) => !relative(folder, file).startsWith(".."))) continue
      gone.push({ file: idOf(file), review: idOf(reviews), key, status: said.status, note: said.note === "" ? undefined : said.note, comments: said.comments.filter((comment) => comment.resolved !== true).length })
    }
  }
  return gone
}

// ---------------------------------------------------------------------------
// The page's list

export const entryOf = async (asset: PixelAsset): Promise<Entry> => {
  const version = await assetVersion(asset)
  const got = await readAsset(asset)
  const base = { id: asset.id, name: basename(asset.file), folder: posix(dirname(asset.id)), source: asset.source === undefined ? undefined : idOf(asset.source), version }
  if (!got.ok) return { ...base, kind: "still", width: 0, height: 0, frames: [], animations: [], errors: 0, warnings: 0, lintProblem: undefined, problem: got.problem }
  return {
    ...base,
    kind: got.sheet === undefined ? "still" : "sheet",
    width: got.width,
    height: got.height,
    frames: got.frames,
    animations: got.animations,
    errors: got.lint.ok ? got.lint.errors : 0,
    warnings: got.lint.ok ? got.lint.warnings : 0,
    lintProblem: got.lint.ok ? undefined : got.lint.problem,
    problem: undefined
  }
}

/** The page's list, read again only where files changed. */
export const libraryOf = (assets: ReadonlyArray<PixelAsset>): Promise<ReadonlyArray<Entry>> => Promise.all(assets.map(entryOf))

/** How many of the assets have been read so far: what a page waiting for its list shows. */
export const readingOf = (assets: ReadonlyArray<PixelAsset>): { readonly done: number; readonly total: number } => ({
  done: assets.filter((asset) => reads.get(asset.file)?.done === true).length,
  total: assets.length
})

/** What the page shows beside one asset: its lint issues, and the files it comes from. */
export const detailOf = async (asset: PixelAsset): Promise<Detail> => {
  const got = await readAsset(asset)
  const config = configOf(asset.file)
  return {
    id: asset.id,
    file: asset.file,
    source: asset.source === undefined ? undefined : idOf(asset.source),
    sheet: got.ok && got.sheet !== undefined ? idOf(got.sheet) : undefined,
    // The rules it would be linted against, even while it cannot be read.
    config: config === undefined ? undefined : idOf(config),
    issues: got.ok && got.lint.ok ? got.lint.issues : [],
    version: await assetVersion(asset)
  }
}
