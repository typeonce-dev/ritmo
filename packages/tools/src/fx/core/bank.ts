/**
 * An effects bank: one JSON file per game (`game.fx.json`) naming the
 * palette every effect draws with, and each effect's drafts, the modules the
 * agent wrote (paths from the bank's folder), each with its seed and the
 * person's tune:
 *
 *   {
 *     "version": 1,
 *     "palette": { "white": "#ffffff", "yellow": "#fee761", "orange": "#f77622" },
 *     "ramps": { "fire": ["white", "yellow", "orange"] },
 *     "backdrops": { "cave": "#1a1c2c", "snow": "#e8e4d8" },
 *     "standIn": { "file": "art/hero.png", "anchor": [10, 45] },
 *     "effects": {
 *       "hit": {
 *         "about": "A blow lands on an enemy.",
 *         "standIn": [0, 24],
 *         "drafts": { "a": { "file": "fx/hit.a.js" }, "b": { "file": "fx/hit.b.js", "seed": 3, "recolor": { "fire": "frost" } } },
 *         "use": "a"
 *       }
 *     }
 *   }
 *
 * `ramps` (optional) are fades through palette colors by name, hot to cold:
 * drafts draw with `fx.ramp("fire", v)`, and a draft's `recolor` draws one
 * ramp with another's colors, so a blue fire is a line in the bank.
 *
 * `backdrops` (optional) are the game's own backgrounds: `fx check` warns
 * when an effect barely shows on one, and the review page plays effects on
 * them.
 *
 * `standIn` (optional) is one of the game's sprites (a PNG, its `anchor` the
 * pixel at its feet), drawn behind every effect on the page and in `fx look`
 * so its size reads against a body. It stands with its anchor on the
 * effect's anchor, moved by the effect's own `standIn` (`[0, 24]`: a hit's
 * target stands 24 pixels below where the blow lands), or not at all when
 * that is `false` (a torch on a wall).
 *
 * `use` is the draft the game gets; the review page sets it when the person
 * picks one, and writes their slider moves to that draft's `tune`.
 *
 * Next to it, the review (`game.fx.review.json`) keeps what the person said
 * about each effect: a status, a note, and comments pinned to one pixel of
 * one frame of a draft ("this pixel, here").
 */
import type { Decoded, Palette, Ramps } from "./effect.ts"

export interface Draft {
  readonly file: string
  readonly seed?: number | undefined
  /** The person's slider values, over the module's own. */
  readonly tune?: Readonly<Record<string, number>> | undefined
  /** Warnings judged deliberate, by code, each with why ("the lumpy edge where puffs overlap is the look"): `fx check` lists them apart and does not count them. Errors cannot be accepted. */
  readonly accept?: Readonly<Record<string, string>> | undefined
  /** Ramps drawn with another ramp's colors, by name (`{"fire": "frost"}`): a recolored copy of the draft. */
  readonly recolor?: Readonly<Record<string, string>> | undefined
}

export interface EffectEntry {
  /** What the effect is for, in a few words; the person reads it. */
  readonly about?: string | undefined
  /** How far from the effect's anchor the stand-in's anchor stands, `[dx, dy]`, or `false` for no stand-in; on the anchor when unset. */
  readonly standIn?: readonly [number, number] | false | undefined
  readonly drafts: Readonly<Record<string, Draft>>
  /** The draft the game gets; the first one when unset. */
  readonly use?: string | undefined
}

/** One of the game's sprites, drawn behind effects to show their size. */
export interface StandIn {
  /** A PNG, from the bank's folder. */
  readonly file: string
  /** The sprite's pixel that stands on the spot (its feet). */
  readonly anchor: readonly [number, number]
}

export interface Bank {
  readonly palette: Palette
  /** Fades through the palette by name, each from `v` 0 to 1. */
  readonly ramps?: Ramps | undefined
  readonly standIn?: StandIn | undefined
  /** The game's backgrounds by name, each a `#rrggbb`. */
  readonly backdrops?: Readonly<Record<string, string>> | undefined
  readonly effects: Readonly<Record<string, EffectEntry>>
}

export type Status = "new" | "approved" | "changes"
export const statuses: ReadonlyArray<Status> = ["new", "approved", "changes"]

/**
 * A comment the person pinned to one pixel of one frame of a draft. Frames
 * count from 0, as `fx.frame` does. Once the agent has acted on it, it is
 * `resolved`, with a `reply` saying what changed (`fx resolve`); the person
 * can reopen it.
 */
export interface Comment {
  readonly draft: string
  readonly frame: number
  readonly x: number
  readonly y: number
  readonly text: string
  readonly resolved?: boolean | undefined
  readonly reply?: string | undefined
}

export interface EffectReview {
  readonly status: Status
  readonly note: string
  readonly comments: ReadonlyArray<Comment>
}

export interface Review {
  readonly effects: Readonly<Record<string, EffectReview>>
}

export const emptyReview: Review = { effects: {} }
export const newEffect: EffectReview = { status: "new", note: "", comments: [] }

/** Where a bank's review lives. */
export const reviewPath = (bankPath: string): string => (bankPath.endsWith(".json") ? bankPath.slice(0, -".json".length) : bankPath) + ".review.json"

/** The pixel of a draft's canvas the stand-in's anchor goes on (its anchor, moved by the effect's `standIn`), or `undefined` for none. */
export const standInSpot = (bank: Bank, entry: EffectEntry, anchor: { readonly x: number; readonly y: number }): readonly [number, number] | undefined => {
  if (bank.standIn === undefined || entry.standIn === false) return undefined
  const [dx, dy] = entry.standIn ?? [0, 0]
  return [anchor.x + dx, anchor.y + dy]
}

/** The draft the game gets: `use`, or the first. */
export const usedDraft = (entry: EffectEntry): string | undefined => (entry.use !== undefined && entry.use in entry.drafts ? entry.use : Object.keys(entry.drafts)[0])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const parse = (text: string): Decoded<unknown> => {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: `not JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export const decodeBank = (text: string): Decoded<Bank> => {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  const raw = parsed.value
  if (!isRecord(raw) || !isRecord(raw.palette) || !isRecord(raw.effects))
    return { ok: false, error: 'an effects bank is {"version": 1, "palette": {"name": "#rrggbb"}, "effects": {"name": {"drafts": {"a": {"file": "..."}}}}}' }
  const errors: Array<string> = []
  const palette: Record<string, string> = {}
  for (const [name, hex] of Object.entries(raw.palette)) {
    if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) errors.push(`palette.${name} must be a #rrggbb color`)
    else palette[name] = hex.toLowerCase()
  }
  if (Object.keys(palette).length === 0 && errors.length === 0) errors.push("palette needs at least one color")
  if (Object.keys(palette).length > 255) errors.push("palette holds at most 255 colors")
  const backdrops: Record<string, string> = {}
  if (raw.backdrops !== undefined && !isRecord(raw.backdrops)) errors.push('backdrops must be {"name": "#rrggbb"}')
  for (const [name, hex] of Object.entries(isRecord(raw.backdrops) ? raw.backdrops : {})) {
    if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) errors.push(`backdrops.${name} must be a #rrggbb color`)
    else backdrops[name] = hex.toLowerCase()
  }
  const ramps: Record<string, ReadonlyArray<string>> = {}
  if (raw.ramps !== undefined && !isRecord(raw.ramps)) errors.push('ramps must be {"name": ["color", ...]}')
  for (const [name, colors] of Object.entries(isRecord(raw.ramps) ? raw.ramps : {})) {
    if (!Array.isArray(colors) || colors.length < 2 || !colors.every((color) => typeof color === "string")) {
      errors.push(`ramps.${name} must be a list of at least two palette color names`)
      continue
    }
    const unknown = colors.filter((color) => !(color in palette))
    if (unknown.length > 0) errors.push(`ramps.${name} names ${unknown.join(", ")}, not in the palette`)
    else ramps[name] = colors
  }
  const pixel = (value: unknown): value is readonly [number, number] =>
    Array.isArray(value) && value.length === 2 && value.every((v) => Number.isInteger(v))
  let standIn: StandIn | undefined
  if (raw.standIn !== undefined) {
    if (!isRecord(raw.standIn) || typeof raw.standIn.file !== "string" || raw.standIn.file === "" || !pixel(raw.standIn.anchor))
      errors.push('standIn must be {"file": "a PNG of one of the game\'s sprites", "anchor": [x, y] (its feet)}')
    else standIn = { file: raw.standIn.file, anchor: [raw.standIn.anchor[0], raw.standIn.anchor[1]] }
  }
  const effects: Record<string, EffectEntry> = {}
  for (const [name, value] of Object.entries(raw.effects)) {
    if (!isRecord(value) || !isRecord(value.drafts)) {
      errors.push(`effects.${name} needs drafts: {"a": {"file": "..."}}`)
      continue
    }
    const drafts: Record<string, Draft> = {}
    for (const [id, draft] of Object.entries(value.drafts)) {
      if (!isRecord(draft) || typeof draft.file !== "string" || draft.file === "") {
        errors.push(`effects.${name}.drafts.${id} needs a file`)
        continue
      }
      if (draft.seed !== undefined && !Number.isInteger(draft.seed)) errors.push(`effects.${name}.drafts.${id}.seed must be a whole number`)
      const tune: Record<string, number> = {}
      if (draft.tune !== undefined && !isRecord(draft.tune)) errors.push(`effects.${name}.drafts.${id}.tune must be an object of numbers`)
      for (const [param, v] of Object.entries(isRecord(draft.tune) ? draft.tune : {})) {
        if (typeof v === "number" && Number.isFinite(v)) tune[param] = v
        else errors.push(`effects.${name}.drafts.${id}.tune.${param} must be a number`)
      }
      const accept: Record<string, string> = {}
      if (draft.accept !== undefined && !isRecord(draft.accept)) errors.push(`effects.${name}.drafts.${id}.accept must be {"code": "why"}`)
      for (const [code, why] of Object.entries(isRecord(draft.accept) ? draft.accept : {})) {
        if (typeof why === "string" && why.trim() !== "") accept[code] = why
        else errors.push(`effects.${name}.drafts.${id}.accept.${code} must say why the warning is deliberate`)
      }
      const recolor: Record<string, string> = {}
      if (draft.recolor !== undefined && !isRecord(draft.recolor)) errors.push(`effects.${name}.drafts.${id}.recolor must be {"ramp": "another ramp"}`)
      for (const [from, to] of Object.entries(isRecord(draft.recolor) ? draft.recolor : {})) {
        if (typeof to === "string" && from in ramps && to in ramps) recolor[from] = to
        else errors.push(`effects.${name}.drafts.${id}.recolor.${from} must map one of the bank's ramps to another (${Object.keys(ramps).join(", ") || "it has none"})`)
      }
      drafts[id] = {
        file: draft.file,
        seed: Number.isInteger(draft.seed) ? (draft.seed as number) : undefined,
        tune: Object.keys(tune).length > 0 ? tune : undefined,
        accept: Object.keys(accept).length > 0 ? accept : undefined,
        recolor: Object.keys(recolor).length > 0 ? recolor : undefined
      }
    }
    if (Object.keys(value.drafts).length === 0) errors.push(`effects.${name} needs at least one draft`)
    if (value.use !== undefined && (typeof value.use !== "string" || !(value.use in value.drafts))) errors.push(`effects.${name}.use must name one of its drafts`)
    if (value.standIn !== undefined && value.standIn !== false && !pixel(value.standIn)) errors.push(`effects.${name}.standIn must be [dx, dy], how far from the effect's anchor the stand-in stands, or false for none`)
    effects[name] = {
      about: typeof value.about === "string" ? value.about : undefined,
      standIn: value.standIn === false ? false : pixel(value.standIn) ? [value.standIn[0], value.standIn[1]] : undefined,
      drafts,
      use: typeof value.use === "string" ? value.use : undefined
    }
  }
  return errors.length > 0
    ? { ok: false, error: errors.join("; ") }
    : { ok: true, value: { palette, ...(raw.ramps === undefined ? {} : { ramps }), ...(raw.backdrops === undefined ? {} : { backdrops }), ...(standIn === undefined ? {} : { standIn }), effects } }
}

export const encodeBank = (bank: Bank): string => {
  const effects: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(bank.effects)) {
    const drafts: Record<string, unknown> = {}
    for (const [id, draft] of Object.entries(entry.drafts)) {
      drafts[id] = {
        file: draft.file,
        ...(draft.seed === undefined ? {} : { seed: draft.seed }),
        ...(draft.tune === undefined || Object.keys(draft.tune).length === 0 ? {} : { tune: draft.tune }),
        ...(draft.accept === undefined || Object.keys(draft.accept).length === 0 ? {} : { accept: draft.accept }),
        ...(draft.recolor === undefined || Object.keys(draft.recolor).length === 0 ? {} : { recolor: draft.recolor })
      }
    }
    effects[name] = {
      ...(entry.about === undefined ? {} : { about: entry.about }),
      ...(entry.standIn === undefined ? {} : { standIn: entry.standIn }),
      drafts,
      ...(entry.use === undefined ? {} : { use: entry.use })
    }
  }
  return (
    JSON.stringify(
      {
        version: 1,
        palette: bank.palette,
        ...(bank.ramps === undefined ? {} : { ramps: bank.ramps }),
        ...(bank.backdrops === undefined ? {} : { backdrops: bank.backdrops }),
        ...(bank.standIn === undefined ? {} : { standIn: bank.standIn }),
        effects
      },
      null,
      2
    ) + "\n"
  )
}

export const decodeReview = (text: string): Decoded<Review> => {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  const raw = parsed.value
  if (!isRecord(raw) || !isRecord(raw.effects)) return { ok: false, error: 'a review is {"version": 1, "effects": {"name": {"status": ..., "note": ...}}}' }
  const errors: Array<string> = []
  const effects: Record<string, EffectReview> = {}
  for (const [name, value] of Object.entries(raw.effects)) {
    if (!isRecord(value)) {
      errors.push(`${name} must be an object`)
      continue
    }
    const status = statuses.find((entry) => entry === value.status)
    if (value.status !== undefined && status === undefined) errors.push(`${name}.status must be one of ${statuses.join(", ")}`)
    const comments: Array<Comment> = []
    if (value.comments !== undefined && !Array.isArray(value.comments)) errors.push(`${name}.comments must be a list`)
    for (const [i, comment] of (Array.isArray(value.comments) ? value.comments : []).entries()) {
      const whole = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0
      if (!isRecord(comment) || typeof comment.draft !== "string" || !whole(comment.frame) || !whole(comment.x) || !whole(comment.y) || typeof comment.text !== "string") {
        errors.push(`${name}.comments[${i}] must be {"draft", "frame", "x", "y", "text"}`)
        continue
      }
      comments.push({
        draft: comment.draft,
        frame: comment.frame,
        x: comment.x,
        y: comment.y,
        text: comment.text,
        ...(comment.resolved === true ? { resolved: true } : {}),
        ...(typeof comment.reply === "string" && comment.reply !== "" ? { reply: comment.reply } : {})
      })
    }
    effects[name] = { status: status ?? "new", note: typeof value.note === "string" ? value.note : "", comments }
  }
  return errors.length > 0 ? { ok: false, error: errors.join("; ") } : { ok: true, value: { effects } }
}

export const encodeReview = (review: Review): string => {
  const effects: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(review.effects))
    effects[name] = { status: entry.status, ...(entry.note === "" ? {} : { note: entry.note }), ...(entry.comments.length === 0 ? {} : { comments: entry.comments }) }
  return JSON.stringify({ version: 1, effects }, null, 2) + "\n"
}

/** Marks comments (by number, from 1) as resolved with the agent's reply; fails on a number the effect has no comment for. */
export const resolveComments = (review: Review, effect: string, numbers: ReadonlyArray<number>, reply: string): Decoded<Review> => {
  const said = review.effects[effect] ?? newEffect
  const missing = numbers.filter((n) => !Number.isInteger(n) || n < 1 || n > said.comments.length)
  if (missing.length > 0) return { ok: false, error: `${effect} has no comment ${missing.join(", ")} (it has ${said.comments.length})` }
  const comments = said.comments.map((comment, index) => (numbers.includes(index + 1) ? { ...comment, resolved: true, ...(reply === "" ? {} : { reply }) } : comment))
  return { ok: true, value: { effects: { ...review.effects, [effect]: { ...said, comments } } } }
}

/** What the agent needs from a review: every effect's status, note, open comments, and chosen draft, the changes first. */
export const reviewSummary = (bank: Bank, review: Review) => {
  const effects = Object.entries(bank.effects).map(([name, entry]) => {
    const said = review.effects[name] ?? newEffect
    const use = usedDraft(entry)
    const tune = use === undefined ? undefined : entry.drafts[use]?.tune
    // Open comments only, each with its number (what `fx resolve` takes): resolved ones are done.
    const open = said.comments.flatMap((comment, index) => (comment.resolved === true ? [] : [{ number: index + 1, ...comment }]))
    const resolved = said.comments.length - open.length
    return {
      name,
      status: said.status,
      note: said.note === "" ? undefined : said.note,
      comments: open.length === 0 ? undefined : open,
      resolved: resolved === 0 ? undefined : resolved,
      use,
      tune,
      drafts: Object.keys(entry.drafts).length
    }
  })
  const count = (status: Status): number => effects.filter((effect) => effect.status === status).length
  return {
    summary: `${count("approved")} approved, ${count("changes")} with changes asked, ${count("new")} not reviewed yet (of ${effects.length}).`,
    changes: effects.filter((effect) => effect.status === "changes"),
    effects
  }
}
