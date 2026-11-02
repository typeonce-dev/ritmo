/**
 * Pixel art drawn from a parts plan, at any size: `pixel parts`.
 *
 * Resampling a detailed reference copies its pixels, and at a game's sizes
 * that is mush: details smaller than a pixel turn into noise, a photo's
 * lighting turns into muddy colors, and the parts that make the thing
 * recognizable get no more pixels than the rest. Pixel artists work the other
 * way round: they decide which parts name the object, block those in first,
 * and drop or hint at the rest. This module is that way of working, with the
 * judgment written down in a plan and the pixel rules applied by code:
 *
 * - The plan names the parts and ranks them: tier 1 names the object (a
 *   motorcycle's wheels, engine, tank, seat), tier 2 supports it (fenders,
 *   exhaust), tier 3 is detail (turn signals, a mirror). Each part has a
 *   simple shape measured on the reference, in the reference's pixels, and a
 *   material. Parts are listed back to front.
 * - The reference is only measured: a part's color is the median inside its
 *   shape, unless the plan gives its real color (a white rocket lit orange by
 *   the dusk is still white).
 * - Each size keeps what it can hold: tier 1 always, tier 2 from 32 pixels,
 *   tier 3 from 64, each only when it is at least a pixel or so wide there.
 *   A tier-1 part that must read gets the pixels it needs: a wheel at least
 *   a ring with a hole, a light at least two pixels, taking the parts
 *   attached to it along.
 * - The drawing follows pixel rules: circles from whole-pixel diameters, lines
 *   a clean pixel wide, light from one side (a part is in shadow where a copy
 *   shifted away from the light leaves it), ramps whose values come from the
 *   material and whose hue comes from the part, an outline on the outside
 *   only, and a darker edge where two parts of one color meet.
 *
 * The size is the longest side; the other side follows the subject. A side
 * the plan marks `cut` (a bust cut off at the chest) gets no margin and no
 * outline: the shapes run to the sprite's edge there.
 */
import { makeMatcher, parseHex, toHex, toOklab, fromOklab, type Lab, type Rgb } from "./color.ts"
import { TRANSPARENT, type PixelArt } from "./fix.ts"
import type { RgbaImage } from "./grid.ts"
import type { Decoded } from "./recipe.ts"

export type Point = readonly [x: number, y: number]

/** A part's shape, in the reference's pixels. */
export type PartShape =
  | { readonly kind: "ellipse"; readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number }
  /** An ellipse with a hole: `thick` is the band's width (a tire, a rim, a cup's rim). */
  | { readonly kind: "ring"; readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number; readonly thick: number }
  | { readonly kind: "poly"; readonly points: ReadonlyArray<Point> }
  | { readonly kind: "line"; readonly a: Point; readonly b: Point; readonly width: number }
  | { readonly kind: "path"; readonly points: ReadonlyArray<Point>; readonly width: number }

/**
 * What a part is made of: it sets how far its shadow and light step from its color, and, for a color measured on the reference, the
 * lightness and saturation too (a photo's muddy lighting is replaced by the material's). A part that gives its own `color` keeps
 * that color's lightness and hue, whatever the material.
 *
 * - `plain`: the color as it is, soft steps (skin, cloth, fur, porcelain, concrete).
 * - `paint`: saturated, mid-light, with a highlight (a car's body, a tank).
 * - `matte`: dark and greyed, no highlight (cast iron, a dark plastic).
 * - `leather`: dark and greyed, with a soft highlight (a seat, a boot).
 * - `rubber`: the darkest, nearly grey, no highlight (a tire).
 * - `chrome`: light and nearly grey, wide steps and a hard highlight (a pipe, a rim).
 * - `glass`: very light, with a highlight (a lens, a visor, a window).
 * - `glow`: light and very saturated (a lamp, an eye that glows, fire).
 */
export type Material = "plain" | "paint" | "matte" | "leather" | "rubber" | "chrome" | "glass" | "glow"

export const MATERIALS: ReadonlyArray<Material> = ["plain", "paint", "matte", "leather", "rubber", "chrome", "glass", "glow"]

/** 1: names the object; 2: supports it; 3: detail. */
export type Tier = 1 | 2 | 3

export interface Part {
  /** A name for the part, unique in the plan. */
  readonly id: string
  readonly tier: Tier
  readonly material: Material
  readonly shape: PartShape
  /** The part's own color, when the reference's lighting would mislead (a white rocket at dusk). Default: measured on the reference. */
  readonly color?: Rgb | undefined
  /** A tier-1 ring or ellipse this part sits on (a wheel's rim and hub): when that part is enlarged to read, this one follows it. */
  readonly attach?: string | undefined
  /** `stripes`: alternating rows of dark (an engine's fins, a grille). */
  readonly pattern?: "stripes" | undefined
  /** `hollow`: seen into (the inside of a cup), so the shadow falls on the side toward the light. Default: convex. */
  readonly form?: "convex" | "hollow" | undefined
}

export type Light = "top-left" | "top-right" | "top"

export type Side = "top" | "bottom" | "left" | "right"

export interface PartsPlan {
  /** What the subject is, and its view: "motorcycle, side view, facing right". */
  readonly subject: string
  /** The sides where the subject is cut off (a bust at the chest): no margin and no outline there. Default: none. */
  readonly cut: ReadonlyArray<Side>
  /** The reference picture the shapes were measured on, relative to the plan. */
  readonly reference?: string | undefined
  /** Where the light comes from. Default: top-left. */
  readonly light: Light
  /** Back to front: a later part covers an earlier one. */
  readonly parts: ReadonlyArray<Part>
}

// Each tier joins at a size (the longest side, in pixels), and only when its smallest measure there is at least this many pixels.
const TIER_FROM: Readonly<Record<Tier, number>> = { 1: 0, 2: 32, 3: 64 }
const TIER_MIN: Readonly<Record<Tier, number>> = { 1: 0, 2: 0.6, 3: 1.5 }
// What a tier-1 part needs to read: a ring needs a band and a hole on each side of it; an ellipse (a light, an eye) two pixels.
const RING_MIN = 7
const DOT_MIN = 2
// Below this size, one outline color for the whole sprite: there is no room for colored outlines to read.
const COLORED_OUTLINE_FROM = 32
// Parts of one material whose hues are this close share one ramp, so the palette stays small (OKLab chroma distance).
const SAME_HUE = 0.06
// Two touching parts this close in color get a dark edge where they meet (squared OKLab distance).
const SAME_COLOR = 0.012

/** Values per material, in OKLab lightness; `chroma` scales the part's own chroma. `plain` steps from the part's own lightness instead. */
const VALUES: Readonly<Record<Material, { readonly base: number; readonly dark: number; readonly light: number; readonly chroma: number }>> = {
  plain: { base: 0, dark: -0.13, light: 0.08, chroma: 1 },
  paint: { base: 0.55, dark: 0.4, light: 0.7, chroma: 1.35 },
  matte: { base: 0.3, dark: 0.22, light: 0.4, chroma: 0.3 },
  leather: { base: 0.27, dark: 0.2, light: 0.4, chroma: 0.2 },
  rubber: { base: 0.27, dark: 0.19, light: 0.36, chroma: 0.15 },
  chrome: { base: 0.7, dark: 0.45, light: 0.93, chroma: 0.25 },
  glass: { base: 0.82, dark: 0.62, light: 0.97, chroma: 0.6 },
  glow: { base: 0.8, dark: 0.65, light: 0.92, chroma: 1.4 }
}
const SHINY: ReadonlySet<Material> = new Set(["paint", "leather", "chrome", "glass"])

// ---- The plan, decoded

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

/** Reads a parts plan from JSON, checking every part; the error lists every problem found. */
export const decodePlan = (text: string): Decoded<PartsPlan> => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `not JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!isRecord(raw)) return { ok: false, error: "a parts plan is a JSON object with subject and parts" }
  const problems: Array<string> = []
  const subject = typeof raw.subject === "string" && raw.subject.length > 0 ? raw.subject : (problems.push('"subject" says what the subject is and its view'), "")
  const reference = raw.reference === undefined ? undefined : typeof raw.reference === "string" ? raw.reference : (problems.push('"reference" is the path of the picture the shapes were measured on'), undefined)
  const light: Light = raw.light === undefined ? "top-left" : raw.light === "top-left" || raw.light === "top-right" || raw.light === "top" ? raw.light : (problems.push('"light" is top-left, top-right, or top'), "top-left")
  const SIDES: ReadonlyArray<Side> = ["top", "bottom", "left", "right"]
  const cut: Array<Side> = []
  if (raw.cut !== undefined) {
    const given: unknown = raw.cut
    if (Array.isArray(given) && given.every((side: unknown) => SIDES.some((s) => s === side))) cut.push(...SIDES.filter((side) => given.includes(side)))
    else problems.push('"cut" lists sides where the subject is cut off: top, bottom, left, right')
  }
  if (!Array.isArray(raw.parts) || raw.parts.length === 0) return { ok: false, error: [...problems, '"parts" lists the parts, back to front'].join("; ") }
  const point = (value: unknown): value is Point => Array.isArray(value) && value.length === 2 && isNumber(value[0]) && isNumber(value[1])
  const parts: Array<Part> = []
  const seen = new Set<string>()
  raw.parts.forEach((entry: unknown, i) => {
    const where = `parts[${i}]`
    if (!isRecord(entry)) return problems.push(`${where} is not an object`)
    const id = typeof entry.id === "string" && entry.id.length > 0 ? entry.id : `#${i}`
    const at = `part "${id}"`
    if (typeof entry.id !== "string" || entry.id.length === 0) problems.push(`${where} needs an "id"`)
    else if (seen.has(id)) problems.push(`${at}: the id is used twice`)
    seen.add(id)
    const tier = entry.tier === 1 || entry.tier === 2 || entry.tier === 3 ? entry.tier : (problems.push(`${at}: "tier" is 1 (names the object), 2 (supports it), or 3 (detail)`), 1)
    const material = MATERIALS.find((m) => m === entry.material) ?? (problems.push(`${at}: "material" is one of ${MATERIALS.join(", ")}`), "plain")
    const s = entry.shape
    let shape: PartShape | undefined
    if (!isRecord(s)) problems.push(`${at}: "shape" is an object with a kind`)
    else if ((s.kind === "ellipse" || s.kind === "ring") && isNumber(s.cx) && isNumber(s.cy) && isNumber(s.rx) && isNumber(s.ry) && s.rx > 0 && s.ry > 0) {
      if (s.kind === "ellipse") shape = { kind: "ellipse", cx: s.cx, cy: s.cy, rx: s.rx, ry: s.ry }
      else if (isNumber(s.thick) && s.thick > 0 && s.thick < Math.min(s.rx, s.ry)) shape = { kind: "ring", cx: s.cx, cy: s.cy, rx: s.rx, ry: s.ry, thick: s.thick }
      else problems.push(`${at}: a ring's "thick" is more than 0 and less than its smaller radius`)
    } else if (s.kind === "poly" && Array.isArray(s.points) && s.points.length >= 3 && s.points.every(point)) shape = { kind: "poly", points: s.points }
    else if (s.kind === "line" && point(s.a) && point(s.b) && isNumber(s.width) && s.width > 0) shape = { kind: "line", a: s.a, b: s.b, width: s.width }
    else if (s.kind === "path" && Array.isArray(s.points) && s.points.length >= 2 && s.points.every(point) && isNumber(s.width) && s.width > 0) shape = { kind: "path", points: s.points, width: s.width }
    else
      problems.push(
        `${at}: a shape is {kind:"ellipse",cx,cy,rx,ry}, {kind:"ring",cx,cy,rx,ry,thick}, {kind:"poly",points:[[x,y],...3 or more]}, {kind:"line",a:[x,y],b:[x,y],width}, or {kind:"path",points:[[x,y],...],width}`
      )
    const color = entry.color === undefined ? undefined : typeof entry.color === "string" ? parseHex(entry.color) : undefined
    if (entry.color !== undefined && color === undefined) problems.push(`${at}: "color" is a #rrggbb color`)
    const attach = typeof entry.attach === "string" ? entry.attach : undefined
    if (attach !== undefined) {
      const host = parts.find((p) => p.id === attach)
      if (host === undefined || host.tier !== 1 || (host.shape.kind !== "ring" && host.shape.kind !== "ellipse")) problems.push(`${at}: "attach" names an earlier tier-1 ring or ellipse`)
    }
    const pattern = entry.pattern === undefined ? undefined : entry.pattern === "stripes" ? "stripes" : (problems.push(`${at}: "pattern" is stripes`), undefined)
    const form = entry.form === undefined ? undefined : entry.form === "convex" || entry.form === "hollow" ? entry.form : (problems.push(`${at}: "form" is convex or hollow`), undefined)
    if (shape !== undefined) parts.push({ id, tier, material, shape, color, attach, pattern, form })
    return undefined
  })
  if (!parts.some((p) => p.tier === 1)) problems.push("at least one part is tier 1: the parts that name the object")
  return problems.length > 0 ? { ok: false, error: problems.join("; ") } : { ok: true, value: { subject, reference, light, cut, parts } }
}

// ---- Geometry

const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
const inPoly = (x: number, y: number, points: ReadonlyArray<Point>): boolean => {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!
    const [xj, yj] = points[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const segmentDistance = (x: number, y: number, a: Point, b: Point): number => {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)
}
const inShape = (x: number, y: number, shape: PartShape): boolean => {
  switch (shape.kind) {
    case "ellipse":
      return inEllipse(x, y, shape.cx, shape.cy, shape.rx, shape.ry)
    case "ring":
      return inEllipse(x, y, shape.cx, shape.cy, shape.rx, shape.ry) && !inEllipse(x, y, shape.cx, shape.cy, shape.rx - shape.thick, shape.ry - shape.thick)
    case "poly":
      return inPoly(x, y, shape.points)
    case "line":
      return segmentDistance(x, y, shape.a, shape.b) <= shape.width / 2
    case "path":
      return shape.points.slice(1).some((p, i) => segmentDistance(x, y, shape.points[i]!, p) <= shape.width / 2)
  }
}

type Box = readonly [x0: number, y0: number, x1: number, y1: number]

const boxOf = (shape: PartShape): Box => {
  if (shape.kind === "ellipse" || shape.kind === "ring") return [shape.cx - shape.rx, shape.cy - shape.ry, shape.cx + shape.rx, shape.cy + shape.ry]
  const points = shape.kind === "line" ? [shape.a, shape.b] : shape.points
  const pad = shape.kind === "poly" ? 0 : shape.width / 2
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]
}

/** The box around every part: the subject, in the reference's pixels. */
export const subjectOf = (plan: PartsPlan): Box =>
  plan.parts.map((part) => boxOf(part.shape)).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])])

// ---- Colors

/**
 * Each part's color: its own `color`, or the median (per OKLab channel) of the reference where the part shows (later parts cover
 * earlier ones). Without a reference every part needs a `color`.
 */
export const partColors = (plan: PartsPlan, reference: RgbaImage | undefined): Decoded<ReadonlyArray<Rgb>> => {
  const missing = plan.parts.filter((part) => part.color === undefined).map((part) => part.id)
  if (reference === undefined) return missing.length === 0 ? { ok: true, value: plan.parts.map((part) => part.color!) } : { ok: false, error: `without a reference, every part needs a "color": ${missing.join(", ")}` }
  const { width, height, data } = reference
  const owner = new Int16Array(width * height).fill(-1)
  plan.parts.forEach((part, k) => {
    const [x0, y0, x1, y1] = boxOf(part.shape)
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(height - 1, y1); y++)
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(width - 1, x1); x++) if (inShape(x + 0.5, y + 0.5, part.shape)) owner[y * width + x] = k
  })
  const channels = plan.parts.map(() => ({ l: [] as Array<number>, a: [] as Array<number>, b: [] as Array<number> }))
  for (let i = 0; i < owner.length; i++) {
    const k = owner[i]!
    if (k < 0 || plan.parts[k]!.color !== undefined || data[i * 4 + 3]! < 128) continue
    const lab = toOklab({ r: data[i * 4]!, g: data[i * 4 + 1]!, b: data[i * 4 + 2]! })
    channels[k]!.l.push(lab.l)
    channels[k]!.a.push(lab.a)
    channels[k]!.b.push(lab.b)
  }
  const median = (values: Array<number>): number => values.sort((p, q) => p - q)[values.length >> 1] ?? 0
  const hidden: Array<string> = []
  const colors = plan.parts.map((part, k) => {
    if (part.color !== undefined) return part.color
    const c = channels[k]!
    if (c.l.length === 0) hidden.push(part.id)
    return fromOklab({ l: median(c.l), a: median(c.a), b: median(c.b) })
  })
  return hidden.length > 0 ? { ok: false, error: `these parts show nowhere on the reference (outside it, or covered by later parts); give each a "color" or fix its shape: ${hidden.join(", ")}` } : { ok: true, value: colors }
}

interface Ramp {
  readonly base: Lab
  readonly dark: Lab
  readonly light: Lab
  readonly line: Lab
}

/**
 * A ramp per part, its steps from the material. A measured color takes the material's lightness and saturation too (`plain` keeps its
 * own); a given color keeps its lightness and hue. Parts of one material, hue, and lightness share a ramp, so the palette stays small,
 * but two parts given different colors never do. Shadows cooler, lights warmer.
 */
const rampsOf = (plan: PartsPlan, colors: ReadonlyArray<Rgb>): ReadonlyArray<Ramp> => {
  const labs = colors.map(toOklab)
  const own = (part: Part): boolean => part.color !== undefined || part.material === "plain"
  const group: Array<number> = []
  plan.parts.forEach((part, k) => {
    const lab = labs[k]!
    const same = plan.parts.findIndex(
      (other, j) =>
        j < k &&
        other.material === part.material &&
        own(other) === own(part) &&
        (other.color === undefined || part.color === undefined || toHex(other.color) === toHex(part.color)) &&
        Math.hypot(labs[j]!.a - lab.a, labs[j]!.b - lab.b) < SAME_HUE &&
        (!own(part) || Math.abs(labs[j]!.l - lab.l) < 0.08)
    )
    group.push(same < 0 ? k : group[same]!)
  })
  return plan.parts.map((part, k) => {
    const lab = labs[group[k]!]!
    const values = VALUES[part.material]
    if (own(part)) {
      // The part's own lightness and hue, with the material's steps around it.
      const chroma = part.material === "plain" ? 1 : Math.max(1, Math.min(values.chroma, 1.2))
      const at = (l: number, warm: number): Lab => ({ l: Math.min(0.97, Math.max(0.06, l)), a: lab.a * chroma, b: lab.b * chroma + warm })
      const down = part.material === "plain" ? values.dark : values.dark - values.base
      const up = part.material === "plain" ? values.light : values.light - values.base
      return { base: at(lab.l, 0), dark: at(lab.l + down, -0.03), light: at(lab.l + up, 0.02), line: at(Math.max(0.12, Math.min(0.32, lab.l + down - 0.3)), -0.03) }
    }
    const at = (l: number, warm: number): Lab => ({ l: Math.min(0.97, Math.max(0.06, l)), a: lab.a * values.chroma, b: lab.b * values.chroma + warm })
    return { base: at(values.base, 0), dark: at(values.dark, -0.03), light: at(values.light, 0.02), line: at(Math.max(0.12, values.dark - 0.14), -0.03) }
  })
}

// ---- Drawing

export interface PartsArt {
  readonly art: PixelArt
  /** The parts drawn at this size, the parts left out (too small for it), and the parts enlarged to read. */
  readonly kept: ReadonlyArray<string>
  readonly dropped: ReadonlyArray<string>
  readonly grown: ReadonlyArray<string>
  /** Why each part in `dropped` was left out. */
  readonly why: Readonly<Record<string, string>>
}

export interface PartsOptions {
  /** The project's palette: every color is snapped to its nearest entry. */
  readonly palette?: ReadonlyArray<Rgb> | undefined
}

/** Draws the plan with its longest side `size` pixels long (see the module's comment for the rules). `colors` comes from `partColors`. */
export const drawParts = (plan: PartsPlan, colors: ReadonlyArray<Rgb>, size: number, options: PartsOptions = {}): PartsArt => {
  const subject = subjectOf(plan)
  const sw = subject[2] - subject[0]
  const sh = subject[3] - subject[1]
  // One pixel of margin on each side, for the outline, except where the subject is cut off.
  const margin = (side: Side): number => (plan.cut.includes(side) ? 0 : 1)
  const mx = margin("left") + margin("right")
  const my = margin("top") + margin("bottom")
  const side = Math.max(3, Math.round(size))
  const scale = Math.min((side - mx) / Math.max(sw, 1), (side - my) / Math.max(sh, 1))
  const W = Math.round(sw * scale) + mx
  const H = Math.round(sh * scale) + my
  const tx = (x: number): number => (x - subject[0]) * scale + margin("left")
  const ty = (y: number): number => (y - subject[1]) * scale + margin("top")

  // What this size holds.
  const smallest = (shape: PartShape): number => {
    switch (shape.kind) {
      case "ellipse":
        return 2 * Math.min(shape.rx, shape.ry) * scale
      case "ring":
        return shape.thick * scale
      case "line":
      case "path":
        return shape.width * scale
      case "poly": {
        const [x0, y0, x1, y1] = boxOf(shape)
        return Math.min(x1 - x0, y1 - y0) * scale
      }
    }
  }
  const kept = plan.parts.map((part) => size >= TIER_FROM[part.tier] && smallest(part.shape) >= TIER_MIN[part.tier])
  const why: Record<string, string> = {}
  plan.parts.forEach((part, k) => {
    if (kept[k]) return
    why[part.id] =
      size < TIER_FROM[part.tier]
        ? `tier ${part.tier} joins at ${TIER_FROM[part.tier]} pixels`
        : `its narrowest measure is ${smallest(part.shape).toFixed(2)} pixels here, under tier ${part.tier}'s ${TIER_MIN[part.tier]}`
  })

  // What must read gets the pixels it needs, and takes what is attached to it along, around its own middle.
  const grow = new Map<string, number>()
  for (const part of plan.parts) {
    const s = part.shape
    if (part.tier !== 1 || (s.kind !== "ring" && s.kind !== "ellipse")) continue
    const need = s.kind === "ring" ? RING_MIN : DOT_MIN
    const has = 2 * Math.min(s.rx, s.ry) * scale
    if (has < need) grow.set(part.id, need / has)
  }
  const shapeOf = (part: Part): PartShape => {
    const host = part.attach === undefined ? part : plan.parts.find((p) => p.id === part.attach)
    const factor = host === undefined ? undefined : grow.get(host.id)
    const s = part.shape
    if (factor === undefined || host === undefined || (host.shape.kind !== "ring" && host.shape.kind !== "ellipse")) return s
    const { cx: hx, cy: hy } = host.shape
    const move = ([x, y]: Point): Point => [hx + (x - hx) * factor, hy + (y - hy) * factor]
    switch (s.kind) {
      case "ellipse":
      case "ring": {
        const moved = { cx: hx + (s.cx - hx) * factor, cy: hy + (s.cy - hy) * factor, rx: s.rx * factor, ry: s.ry * factor }
        return s.kind === "ring" ? { ...s, ...moved, thick: s.thick * factor } : { ...s, ...moved }
      }
      case "poly":
        return { ...s, points: s.points.map(move) }
      case "line":
        return { ...s, a: move(s.a), b: move(s.b), width: s.width * factor }
      case "path":
        return { ...s, points: s.points.map(move), width: s.width * factor }
    }
  }

  // Each part's own shape at this size (before later parts cover it: shading follows the shape), and which part shows where.
  const masks = plan.parts.map(() => new Uint8Array(W * H))
  const who = new Int16Array(W * H).fill(-1)
  const put = (x: number, y: number, k: number): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    who[y * W + x] = k
    masks[k]![y * W + x] = 1
  }
  /** A disc from whole-pixel sizes, without the corner pixels that make small circles look square. */
  const disc = (cx: number, cy: number, dw: number, dh: number): Array<readonly [number, number]> => {
    const x0 = Math.round(cx - dw / 2)
    const y0 = Math.round(cy - dh / 2)
    const out: Array<readonly [number, number]> = []
    for (let j = 0; j < dh; j++)
      for (let i = 0; i < dw; i++) {
        const nx = (i + 0.5 - dw / 2) / (dw / 2)
        const ny = (j + 0.5 - dh / 2) / (dh / 2)
        if (dw <= 2 || dh <= 2 || nx * nx + ny * ny <= 1.08 - 1.2 / (dw * dh)) out.push([x0 + i, y0 + j])
      }
    return out
  }
  plan.parts.forEach((part, k) => {
    if (!kept[k]) return
    const s = shapeOf(part)
    if (s.kind === "ellipse") {
      for (const [x, y] of disc(tx(s.cx), ty(s.cy), Math.max(1, Math.round(2 * s.rx * scale)), Math.max(1, Math.round(2 * s.ry * scale)))) put(x, y, k)
    } else if (s.kind === "ring") {
      const dw = Math.max(3, Math.round(2 * s.rx * scale))
      const dh = Math.max(3, Math.round(2 * s.ry * scale))
      const band = Math.max(1, Math.round(s.thick * scale))
      const hole = new Set(dw - 2 * band >= 1 && dh - 2 * band >= 1 ? disc(tx(s.cx), ty(s.cy), dw - 2 * band, dh - 2 * band).map(([x, y]) => y * W + x) : [])
      for (const [x, y] of disc(tx(s.cx), ty(s.cy), dw, dh)) if (!hole.has(y * W + x)) put(x, y, k)
    } else if (s.kind === "poly") {
      const points = s.points.map(([x, y]): Point => [tx(x), ty(y)])
      let any = false
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          if (inPoly(x + 0.5, y + 0.5, points)) {
            put(x, y, k)
            any = true
          }
      // A kept part never vanishes: smaller than a pixel, it is one pixel at its middle.
      if (!any) put(Math.floor(points.reduce((sum, p) => sum + p[0], 0) / points.length), Math.floor(points.reduce((sum, p) => sum + p[1], 0) / points.length), k)
    } else {
      // A whole-pixel brush walked along each segment (Bresenham), so a thin part stays one clean pixel wide.
      const brush = Math.max(1, Math.round(s.width * scale))
      const points = s.kind === "line" ? [s.a, s.b] : s.points
      for (let i = 1; i < points.length; i++) {
        let x0 = Math.round(tx(points[i - 1]![0]) - brush / 2 + 0.5)
        let y0 = Math.round(ty(points[i - 1]![1]) - brush / 2 + 0.5)
        const x1 = Math.round(tx(points[i]![0]) - brush / 2 + 0.5)
        const y1 = Math.round(ty(points[i]![1]) - brush / 2 + 0.5)
        const dx = Math.abs(x1 - x0)
        const dy = -Math.abs(y1 - y0)
        const sx = x0 < x1 ? 1 : -1
        const sy = y0 < y1 ? 1 : -1
        let err = dx + dy
        for (;;) {
          for (let a = 0; a < brush; a++) for (let b = 0; b < brush; b++) put(x0 + a, y0 + b, k)
          if (x0 === x1 && y0 === y1) break
          const e2 = 2 * err
          if (e2 >= dy) {
            err += dy
            x0 += sx
          }
          if (e2 <= dx) {
            err += dx
            y0 += sy
          }
        }
      }
    }
  })

  // Light. A part is in shadow where a copy of it shifted away from the light leaves it (its far rim), and catches the light on
  // its near rim when it is shiny; a hollow is the other way round. Rings, and round chrome or rubber, shade by angle instead.
  const [lx, ly] = plan.light === "top-left" ? [-1, -1] : plan.light === "top-right" ? [1, -1] : [0, -1]
  const tone = new Int8Array(W * H) // -1 dark, 0 base, 1 light
  const boxes = masks.map((mask) => {
    let x0 = W, y0 = H, x1 = -1, y1 = -1
    for (let i = 0; i < mask.length; i++)
      if (mask[i]) {
        const x = i % W
        const y = (i - x) / W
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
    return { w: x1 - x0 + 1, h: y1 - y0 + 1 }
  })
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = who[y * W + x]!
      if (k < 0) continue
      const part = plan.parts[k]!
      const s = shapeOf(part)
      const mask = masks[k]!
      const inMask = (xx: number, yy: number): boolean => xx >= 0 && yy >= 0 && xx < W && yy < H && mask[yy * W + xx] === 1
      if (part.material === "glow") continue
      if (part.pattern === "stripes") {
        let top = y
        while (inMask(x, top - 1)) top--
        tone[y * W + x] = (y - top) % 2 === 1 ? -1 : y === top ? 1 : 0
        continue
      }
      if (s.kind === "ring" || (s.kind === "ellipse" && (part.material === "chrome" || part.material === "rubber"))) {
        const ox = x + 0.5 - tx(s.cx)
        const oy = y + 0.5 - ty(s.cy)
        const length = Math.hypot(ox, oy) * Math.hypot(lx, ly) || 1
        const facing = -(ox * lx + oy * ly) / length // 1 = away from the light
        if (facing > 0.35) tone[y * W + x] = -1
        else if (facing < -0.7 && part.material !== "rubber") tone[y * W + x] = 1
        continue
      }
      const { w, h } = boxes[k]!
      if (Math.min(w, h) < 2) continue
      const step = Math.max(1, Math.round(Math.min(w, h) * 0.18))
      const sign = part.form === "hollow" ? -1 : 1
      if (!inMask(x - sign * lx * step, y - sign * ly * step)) tone[y * W + x] = -1
      else if ((SHINY.has(part.material) || part.form === "hollow") && Math.min(w, h) >= 3 && !inMask(x + sign * lx, y + sign * ly)) tone[y * W + x] = 1
    }

  // Colors, on the project's palette when it has one.
  const ramps = rampsOf(plan, colors)
  const matcher = options.palette === undefined || options.palette.length === 0 ? undefined : makeMatcher(options.palette, "oklab")
  const palette: Array<Rgb> = []
  const indexOf = new Map<string, number>()
  const index = (lab: Lab): number => {
    const raw = fromOklab(lab)
    const rgb = matcher === undefined ? raw : options.palette![matcher.nearest(raw)]!
    const key = toHex(rgb)
    let i = indexOf.get(key)
    if (i === undefined) {
      i = palette.length
      palette.push(rgb)
      indexOf.set(key, i)
    }
    return i
  }
  const out = new Int32Array(W * H).fill(TRANSPARENT)
  for (let i = 0; i < W * H; i++) {
    const k = who[i]!
    if (k < 0) continue
    const ramp = ramps[k]!
    out[i] = index(tone[i] === 1 ? ramp.light : tone[i] === -1 ? ramp.dark : ramp.base)
  }
  // Where two parts of one color meet, the front one (listed later) takes its line color along the edge, or they would merge.
  const labs = colors.map(toOklab)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = who[y * W + x]!
      if (k < 0) continue
      for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
        const xx = x + dx
        const yy = y + dy
        const n = xx >= 0 && yy >= 0 && xx < W && yy < H ? who[yy * W + xx]! : -1
        if (n < 0 || n >= k) continue
        const a = labs[k]!
        const b = labs[n]!
        if ((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2 < SAME_COLOR) {
          out[y * W + x] = index(ramps[k]!.line)
          break
        }
      }
    }
  // The outline, on the outside only: holes you see through (inside a wheel) stay open. Small sprites get one outline color.
  const outside = new Uint8Array(W * H)
  const stack: Array<number> = []
  for (let i = 0; i < W * H; i++) {
    const x = i % W
    const y = (i - x) / W
    if ((x === 0 || y === 0 || x === W - 1 || y === H - 1) && who[i]! < 0) {
      outside[i] = 1
      stack.push(i)
    }
  }
  while (stack.length > 0) {
    const i = stack.pop()!
    const x = i % W
    const y = (i - x) / W
    for (const [q, ok] of [[i - 1, x > 0], [i + 1, x < W - 1], [i - W, y > 0], [i + W, y < H - 1]] as const)
      if (ok && outside[q] === 0 && who[q]! < 0) {
        outside[q] = 1
        stack.push(q)
      }
  }
  const darkest = ramps.reduce((a, b) => (b.line.l < a.line.l ? b : a)).line
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (who[y * W + x]! >= 0 || outside[y * W + x] === 0) continue
      let touch = -1
      for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
        const xx = x + dx
        const yy = y + dy
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) touch = Math.max(touch, who[yy * W + xx]!)
      }
      if (touch >= 0) out[y * W + x] = index(size < COLORED_OUTLINE_FROM ? darkest : ramps[touch]!.line)
    }

  return {
    art: { width: W, height: H, palette, indices: out },
    kept: plan.parts.filter((_, k) => kept[k]).map((part) => part.id),
    dropped: plan.parts.filter((_, k) => !kept[k]).map((part) => part.id),
    grown: [...grow.keys()].filter((id) => kept[plan.parts.findIndex((part) => part.id === id)]),
    why
  }
}

/**
 * The art on a canvas of `width`×`height` (a size the project's rules ask for), centered across and standing on the bottom edge; or
 * centered both ways with `align: "center"`. The canvas must hold the art.
 */
export const padArt = (art: PixelArt, width: number, height: number, align: "bottom" | "center" = "bottom"): PixelArt => {
  const left = Math.floor((width - art.width) / 2)
  const top = align === "bottom" ? height - art.height : Math.floor((height - art.height) / 2)
  const indices = new Int32Array(width * height).fill(TRANSPARENT)
  for (let y = 0; y < art.height; y++)
    for (let x = 0; x < art.width; x++) {
      const tx = x + left
      const ty = y + top
      if (tx >= 0 && ty >= 0 && tx < width && ty < height) indices[ty * width + tx] = art.indices[y * art.width + x]!
    }
  return { width, height, palette: art.palette, indices }
}

// ---- The plan over the reference

const TIER_COLORS: Readonly<Record<Tier, readonly [number, number, number]>> = { 1: [0, 255, 102], 2: [255, 204, 0], 3: [255, 43, 214] }

/**
 * The reference, dimmed, with each part's shape outlined in its tier's color (tier 1 green, 2 yellow, 3 magenta), and the subject's
 * box in white: the picture to check a plan's measures against, before drawing.
 */
export const partsOverlay = (plan: PartsPlan, reference: RgbaImage): RgbaImage => {
  const { width, height } = reference
  const data = new Uint8ClampedArray(reference.data.length)
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(reference.data[i * 4 + c]! * 0.55)
    data[i * 4 + 3] = 255
  }
  const paint = (x: number, y: number, [r, g, b]: readonly [number, number, number]): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    data.set([r, g, b, 255], (y * width + x) * 4)
  }
  const thickness = Math.max(1, Math.round(Math.max(width, height) / 400))
  for (const part of plan.parts) {
    const [x0, y0, x1, y1] = boxOf(part.shape)
    const inside = (x: number, y: number): boolean => inShape(x + 0.5, y + 0.5, part.shape)
    for (let y = Math.max(0, Math.floor(y0) - 1); y <= Math.min(height - 1, Math.ceil(y1) + 1); y++)
      for (let x = Math.max(0, Math.floor(x0) - 1); x <= Math.min(width - 1, Math.ceil(x1) + 1); x++) {
        if (!inside(x, y)) continue
        let edge = false
        for (let d = 1; d <= thickness && !edge; d++) edge = !inside(x - d, y) || !inside(x + d, y) || !inside(x, y - d) || !inside(x, y + d)
        if (edge) paint(x, y, TIER_COLORS[part.tier])
      }
  }
  const box = subjectOf(plan)
  const [bx0, by0, bx1, by1] = [Math.round(box[0]), Math.round(box[1]), Math.round(box[2]), Math.round(box[3])]
  for (let x = bx0; x <= bx1; x++) {
    paint(x, by0, [255, 255, 255])
    paint(x, by1, [255, 255, 255])
  }
  for (let y = by0; y <= by1; y++) {
    paint(bx0, y, [255, 255, 255])
    paint(bx1, y, [255, 255, 255])
  }
  return { width, height, data }
}
