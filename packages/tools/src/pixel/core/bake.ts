/**
 * Baking: pixel art drawn from a model of 3D shapes, through one camera and
 * one light. An agent places geometry far better than it places pixels, so the
 * model holds the design and this holds what has to stay the same from sprite
 * to sprite: the angle, the light, shading on the palette's ramps, clean
 * edges, and one outline.
 *
 * Nothing here decides what a thing looks like. A model can be any shapes, in
 * any colors, with hand-placed pixels on top for what geometry cannot say. What
 * is odd about a model comes back as a report, never as a refusal: a part too
 * small to show, or a frame that cuts the art.
 *
 * Coordinates are the screen's: at `yaw` 0, +x runs right, +y runs toward the
 * viewer, and +z runs up. A yaw of 45 shows a corner: +x runs down-right and +y
 * down-left. The sun is given the same way, and stays put as a model turns.
 */
import { parseHex, toHex, type Rgb } from "./color.ts"
import { TRANSPARENT, type PixelArt } from "./fix.ts"
import type { RgbaImage } from "./grid.ts"
import { strayPixels } from "./lint.ts"
import type { Loop } from "./sheet.ts"

export type Vec3 = readonly [number, number, number]

// ---------------------------------------------------------------------------
// The project's setup: `bake` in `pixel.config.json`

export interface BakeSetup {
  readonly camera: {
    /** Degrees the view is turned on the ground; 45 shows a corner. */
    readonly yaw: number
    /** Degrees above the ground: 30 makes ground 2:1, 90 looks straight down. */
    readonly elevation: number
    /** Art pixels per model unit. */
    readonly scale: number
    /** Heights are multiplied by this, for a game whose view is not a true projection. */
    readonly heightScale: number
  }
  readonly light: {
    /** Toward the sun, in the screen's axes. */
    readonly sun: Vec3
    /** The light below which a surface takes a ramp's darkest color. */
    readonly dark: number
    /** The light from which a surface takes a ramp's lightest color. */
    readonly bright: number
    /** Parts darken what they shade. Lively at large sizes, noisy at small ones. */
    readonly castShadows: boolean
  }
  /** The outline's color, or false for none. Unset: the darkest color of the palette, or else of the art. */
  readonly outline: string | false | undefined
  /** A surface this many art pixels behind its neighbour goes one step darker, which separates parts. False for never. */
  readonly edges: number | false
  /** Materials every model can use: one color, or a ramp from dark to light. */
  readonly materials: Readonly<Record<string, ReadonlyArray<string>>>
}

export const defaultBakeSetup: BakeSetup = {
  camera: { yaw: 45, elevation: 30, scale: 1, heightScale: 1 },
  light: { sun: [-0.7, 0.05, 0.7], dark: 0, bright: 0.6, castShadows: false },
  outline: undefined,
  edges: 4,
  materials: {}
}

// ---------------------------------------------------------------------------
// The model: `<name>.bake.json`

export interface Rotation {
  readonly axis: "x" | "y" | "z"
  readonly degrees: number
  readonly about: Vec3
}

export interface BakeAnimation {
  readonly name: string
  readonly frames: number
  readonly fps: number
  readonly loop: Loop
}

/** How a part moves through an animation: a whole turn of the frames, or there and back with `wave`. */
export interface PartMotion {
  readonly rotate: Rotation | undefined
  readonly move: Vec3 | undefined
  readonly wave: boolean
}

interface NodeBase {
  /** Where it is in the file, for the report. */
  readonly path: string
  readonly name: string | undefined
  readonly material: string | undefined
  readonly detail: boolean
  readonly step: number | undefined
  readonly move: Vec3 | undefined
  readonly rotate: Rotation | undefined
  readonly repeat: { readonly count: number; readonly move: Vec3 | undefined; readonly rotate: Rotation | undefined; readonly materials: ReadonlyArray<string> | undefined } | undefined
  readonly animate: Readonly<Record<string, PartMotion>>
}

export type BakeNode =
  | (NodeBase & { readonly kind: "group"; readonly parts: ReadonlyArray<BakeNode> })
  | (NodeBase & { readonly kind: "box"; readonly from: Vec3; readonly to: Vec3; readonly top: readonly [number, number]; readonly lean: readonly [number, number] })
  | (NodeBase & { readonly kind: "cylinder"; readonly from: Vec3; readonly to: Vec3; readonly axis: "x" | "y" | "z"; readonly sides: number; readonly taper: number })
  | (NodeBase & { readonly kind: "sphere"; readonly from: Vec3; readonly to: Vec3 })
  | (NodeBase & { readonly kind: "mesh"; readonly points: ReadonlyArray<Vec3>; readonly faces: ReadonlyArray<ReadonlyArray<number>>; readonly lifted: boolean })

export interface BakePaint {
  /** Art pixels from the anchor to its first row's first pixel, x right and y down. */
  readonly at: readonly [number, number]
  readonly rows: ReadonlyArray<string>
  readonly headings: ReadonlyArray<number> | undefined
  readonly animation: string | undefined
  readonly frames: ReadonlyArray<number> | undefined
  /** Over the outline, instead of inside it. */
  readonly after: boolean
}

export interface BakeModel {
  readonly headings: number
  readonly animations: ReadonlyArray<BakeAnimation>
  readonly frame: { readonly width: number | undefined; readonly up: number | undefined; readonly below: number | undefined }
  readonly materials: Readonly<Record<string, ReadonlyArray<string>>>
  readonly outline: string | false | undefined
  readonly cleanup: boolean
  readonly normals: boolean
  readonly shadow: boolean
  readonly parts: ReadonlyArray<BakeNode>
  readonly paint: ReadonlyArray<BakePaint>
}

export interface BakeProblem {
  readonly path: string
  readonly message: string
}

export type Parsed<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly problems: ReadonlyArray<BakeProblem> }

type Fields = Readonly<Record<string, unknown>>

const isFields = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value)
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const isCount = (value: unknown): value is number => isNumber(value) && Number.isInteger(value) && value >= 1

/** Reads one file, gathering every problem rather than stopping at the first. */
class Reader {
  readonly problems: Array<BakeProblem> = []

  fail(path: string, message: string): void {
    this.problems.push({ path, message })
  }

  fields(raw: unknown, path: string, allowed: ReadonlyArray<string>, hints: Readonly<Record<string, string>> = {}): Fields {
    if (!isFields(raw)) {
      this.fail(path, `must be an object with ${allowed.join(", ")}`)
      return {}
    }
    for (const key of Object.keys(raw)) {
      if (!allowed.includes(key)) this.fail(`${path}.${key}`, hints[key] ?? `is not a field here, which takes ${allowed.join(", ")}`)
    }
    return raw
  }

  number(value: unknown, path: string, fallback: number, check?: (n: number) => string | undefined): number {
    if (value === undefined) return fallback
    if (!isNumber(value)) {
      this.fail(path, "must be a number")
      return fallback
    }
    const wrong = check?.(value)
    if (wrong !== undefined) this.fail(path, wrong)
    return value
  }

  boolean(value: unknown, path: string, fallback: boolean): boolean {
    if (value === undefined) return fallback
    if (typeof value !== "boolean") {
      this.fail(path, "must be true or false")
      return fallback
    }
    return value
  }

  vector(value: unknown, path: string): Vec3 | undefined {
    if (Array.isArray(value) && value.length === 3 && value.every(isNumber)) return [value[0]!, value[1]!, value[2]!]
    this.fail(path, "must be [x, y, z]")
    return undefined
  }

  pair(value: unknown, path: string, fallback: readonly [number, number]): readonly [number, number] {
    if (value === undefined) return fallback
    if (Array.isArray(value) && value.length === 2 && value.every(isNumber)) return [value[0]!, value[1]!]
    this.fail(path, "must be two numbers")
    return fallback
  }

  /** A material's colors, dark to light. */
  colors(raw: unknown, path: string): ReadonlyArray<string> {
    const list = typeof raw === "string" ? [raw] : raw
    if (!Array.isArray(list) || list.length === 0) {
      this.fail(path, 'must be a color like "#ef7d57", or a ramp of them from dark to light')
      return []
    }
    return list.flatMap((color, i) => {
      const rgb = typeof color === "string" ? parseHex(color) : undefined
      if (rgb === undefined) {
        this.fail(typeof raw === "string" ? path : `${path}[${i}]`, `${JSON.stringify(color)} is not a color like "#ef7d57"`)
        return []
      }
      return [toHex(rgb)]
    })
  }

  materials(raw: unknown, path: string): Readonly<Record<string, ReadonlyArray<string>>> {
    if (raw === undefined) return {}
    if (!isFields(raw)) {
      this.fail(path, 'must map names to a color or a ramp, like { "stone": ["#333c57", "#566c86", "#94b0c2"] }')
      return {}
    }
    return Object.fromEntries(Object.entries(raw).map(([name, value]) => [name, this.colors(value, `${path}.${name}`)]))
  }

  outline(value: unknown, path: string): string | false | undefined {
    if (value === undefined || value === false) return value
    const rgb = typeof value === "string" ? parseHex(value) : undefined
    if (rgb !== undefined) return toHex(rgb)
    this.fail(path, 'must be a color like "#1a1c2c", or false for none')
    return undefined
  }

  rotation(raw: unknown, path: string): Rotation | undefined {
    const fields = this.fields(raw, path, ["axis", "degrees", "about"])
    const axis = fields.axis ?? "z"
    if (axis !== "x" && axis !== "y" && axis !== "z") this.fail(`${path}.axis`, 'must be "x", "y", or "z"')
    if (!isNumber(fields.degrees)) this.fail(`${path}.degrees`, "must be a number: how far it turns")
    const about = fields.about === undefined ? ([0, 0, 0] as const) : this.vector(fields.about, `${path}.about`)
    if (axis !== "x" && axis !== "y" && axis !== "z") return undefined
    return isNumber(fields.degrees) && about !== undefined ? { axis, degrees: fields.degrees, about } : undefined
  }
}

/** Reads `bake` in `pixel.config.json`. */
export const parseBakeSetup = (raw: unknown): Parsed<BakeSetup> => {
  if (raw === undefined) return { ok: true, value: defaultBakeSetup }
  const read = new Reader()
  const fields = read.fields(raw, "bake", ["camera", "light", "outline", "edges", "materials"])
  const camera = read.fields(fields.camera ?? {}, "bake.camera", ["yaw", "elevation", "scale", "heightScale"])
  const light = read.fields(fields.light ?? {}, "bake.light", ["sun", "dark", "bright", "castShadows"])
  const base = defaultBakeSetup
  const positive = (n: number) => (n > 0 ? undefined : "must be above 0")
  const sun = light.sun === undefined ? base.light.sun : read.vector(light.sun, "bake.light.sun")
  if (sun !== undefined && sun[2] <= 0) read.fail("bake.light.sun", "must be above the ground: its z above 0")
  const edges = fields.edges === false ? false : read.number(fields.edges, "bake.edges", base.edges as number, positive)
  const value: BakeSetup = {
    camera: {
      yaw: read.number(camera.yaw, "bake.camera.yaw", base.camera.yaw),
      elevation: read.number(camera.elevation, "bake.camera.elevation", base.camera.elevation, (n) => (n > 0 && n <= 90 ? undefined : "must be above 0 and up to 90 degrees")),
      scale: read.number(camera.scale, "bake.camera.scale", base.camera.scale, positive),
      heightScale: read.number(camera.heightScale, "bake.camera.heightScale", base.camera.heightScale, positive)
    },
    light: {
      sun: sun ?? base.light.sun,
      dark: read.number(light.dark, "bake.light.dark", base.light.dark),
      bright: read.number(light.bright, "bake.light.bright", base.light.bright),
      castShadows: read.boolean(light.castShadows, "bake.light.castShadows", base.light.castShadows)
    },
    outline: read.outline(fields.outline, "bake.outline"),
    edges,
    materials: read.materials(fields.materials, "bake.materials")
  }
  if (value.light.bright <= value.light.dark) read.fail("bake.light.bright", "must be above `dark`")
  return read.problems.length > 0 ? { ok: false, problems: read.problems } : { ok: true, value }
}

const SHAPES = ["box", "cylinder", "sphere", "face", "mesh"] as const
const COMMON = ["name", "material", "detail", "step", "move", "rotate", "repeat", "animate"]
const MISTAKES: Readonly<Record<string, string>> = {
  at: "is not a field: give `from` and `to`, two opposite corners",
  size: "is not a field: give `from` and `to`, two opposite corners",
  color: "is not a field: use `material`, a color like \"#ef7d57\" or a material's name",
  flat: "is not a field: use `step`, which keeps a ramp on one of its steps",
  spin: "is not a field: use `animate`, with a motion for each animation's name"
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2])
  return length === 0 ? a : [a[0] / length, a[1] / length, a[2] / length]
}

/** Why a polygon cannot be drawn as one flat fan of triangles, or none. */
const polygonProblem = (points: ReadonlyArray<Vec3>): string | undefined => {
  if (points.length < 3) return "needs at least 3 corners"
  let normal: Vec3 = [0, 0, 0]
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    normal = add(normal, cross(a, b))
  }
  if (Math.hypot(...normal) < 1e-9) return "has no area: its corners are on one line"
  const n = unit(normal)
  const reach = Math.max(...points.map((p) => Math.hypot(...sub(p, points[0]!))))
  if (points.some((p) => Math.abs(dot(sub(p, points[0]!), n)) > reach * 0.01)) return "is not flat: its corners are not on one plane. Split it into triangles"
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    const c = points[(i + 2) % points.length]!
    if (dot(cross(sub(b, a), sub(c, b)), n) < -1e-9) return "is not convex, or its corners are out of order: go around its edge, and split a shape with a dent in it"
  }
  return undefined
}

const parseMotion = (read: Reader, raw: unknown, path: string): PartMotion => {
  const fields = read.fields(raw, path, ["rotate", "move", "wave"])
  return {
    rotate: fields.rotate === undefined ? undefined : read.rotation(fields.rotate, `${path}.rotate`),
    move: fields.move === undefined ? undefined : read.vector(fields.move, `${path}.move`),
    wave: read.boolean(fields.wave, `${path}.wave`, false)
  }
}

interface ModelContext {
  readonly known: Readonly<Record<string, ReadonlyArray<string>>>
  readonly animations: ReadonlyArray<string>
}

const knownMaterial = (read: Reader, name: unknown, path: string, context: ModelContext): void => {
  if (typeof name === "string" && (context.known[name] !== undefined || parseHex(name) !== undefined)) return
  const names = Object.keys(context.known)
  read.fail(path, `${JSON.stringify(name)} is not a color like "#ef7d57" or a material${names.length === 0 ? "" : `: there are ${names.join(", ")}`}. Add it to \`materials\` in this model, or to \`bake.materials\` in pixel.config.json`)
}

const parseNode = (read: Reader, raw: unknown, path: string, material: boolean, context: ModelContext): BakeNode | undefined => {
  if (!isFields(raw)) {
    read.fail(path, `must be a part: an object with \`shape\` (${SHAPES.join(", ")}), or a group with \`parts\``)
    return undefined
  }
  const isGroup = raw.parts !== undefined
  const shape = raw.shape
  if (!isGroup && !SHAPES.some((known) => known === shape)) {
    read.fail(path, `needs \`shape\` (${SHAPES.join(", ")}), or \`parts\` for a group`)
    return undefined
  }
  const own: ReadonlyArray<string> = isGroup
    ? ["parts"]
    : shape === "box"
      ? ["shape", "from", "to", "top", "lean"]
      : shape === "cylinder"
        ? ["shape", "from", "to", "axis", "sides", "taper"]
        : shape === "sphere"
          ? ["shape", "from", "to"]
          : shape === "face"
            ? ["shape", "corners"]
            : ["shape", "points", "faces"]
  const fields = read.fields(raw, path, [...own, ...COMMON], MISTAKES)
  if (fields.material !== undefined) knownMaterial(read, fields.material, `${path}.material`, context)
  if (fields.name !== undefined && typeof fields.name !== "string") read.fail(`${path}.name`, "must be text")
  if (fields.step !== undefined && !(isNumber(fields.step) && Number.isInteger(fields.step) && fields.step >= 0)) read.fail(`${path}.step`, "must be a ramp's step: 0 is its darkest")
  let repeat: NodeBase["repeat"]
  if (fields.repeat !== undefined) {
    const r = read.fields(fields.repeat, `${path}.repeat`, ["count", "move", "rotate", "materials"])
    if (!isCount(r.count)) read.fail(`${path}.repeat.count`, "must be how many copies, 1 or more")
    let materials: ReadonlyArray<string> | undefined
    if (r.materials !== undefined) {
      if (Array.isArray(r.materials) && r.materials.length > 0) {
        r.materials.forEach((name, i) => knownMaterial(read, name, `${path}.repeat.materials[${i}]`, context))
        materials = r.materials.filter((name): name is string => typeof name === "string")
      } else read.fail(`${path}.repeat.materials`, "must list materials, which the copies take in turn")
    }
    repeat = {
      count: isCount(r.count) ? r.count : 1,
      move: r.move === undefined ? undefined : read.vector(r.move, `${path}.repeat.move`),
      rotate: r.rotate === undefined ? undefined : read.rotation(r.rotate, `${path}.repeat.rotate`),
      materials
    }
  }
  const animate: Record<string, PartMotion> = {}
  if (fields.animate !== undefined) {
    if (isFields(fields.animate)) {
      for (const [name, motion] of Object.entries(fields.animate)) {
        if (!context.animations.includes(name)) read.fail(`${path}.animate.${name}`, `is not an animation: \`animations\` has ${context.animations.join(", ") || "none"}`)
        animate[name] = parseMotion(read, motion, `${path}.animate.${name}`)
      }
    } else read.fail(`${path}.animate`, "must map an animation's name to how this part moves in it")
  }
  const base: NodeBase = {
    path,
    name: typeof fields.name === "string" ? fields.name : undefined,
    material: typeof fields.material === "string" ? fields.material : undefined,
    detail: read.boolean(fields.detail, `${path}.detail`, false),
    step: isNumber(fields.step) ? fields.step : undefined,
    move: fields.move === undefined ? undefined : read.vector(fields.move, `${path}.move`),
    rotate: fields.rotate === undefined ? undefined : read.rotation(fields.rotate, `${path}.rotate`),
    repeat,
    animate
  }
  const painted = material || base.material !== undefined || base.repeat?.materials !== undefined
  if (isGroup) {
    if (!Array.isArray(fields.parts)) {
      read.fail(`${path}.parts`, "must be a list of parts")
      return undefined
    }
    const parts = fields.parts.flatMap((part, i) => parseNode(read, part, `${path}.parts[${i}]`, painted, context) ?? [])
    return { ...base, kind: "group", parts }
  }
  if (!painted) read.fail(`${path}.material`, 'is missing: a color like "#ef7d57", a material\'s name, or one set on its group')
  if (shape === "face" || shape === "mesh") {
    const list = shape === "face" ? fields.corners : fields.points
    const name = shape === "face" ? "corners" : "points"
    if (!Array.isArray(list)) {
      read.fail(`${path}.${name}`, "must be a list of [x, y, z]")
      return undefined
    }
    const read3 = list.map((point, i) => read.vector(point, `${path}.${name}[${i}]`))
    const points = read3.filter((point) => point !== undefined)
    if (points.length !== read3.length) return undefined
    if (shape === "face") {
      const wrong = polygonProblem(points)
      if (wrong !== undefined) read.fail(`${path}.corners`, wrong)
      return { ...base, kind: "mesh", points, faces: [points.map((_, i) => i)], lifted: true }
    }
    if (!Array.isArray(fields.faces)) {
      read.fail(`${path}.faces`, "must be a list of faces, each a list of positions in `points`")
      return undefined
    }
    const faces: Array<ReadonlyArray<number>> = []
    fields.faces.forEach((face: unknown, i) => {
      if (!Array.isArray(face) || !face.every((at: unknown) => isNumber(at) && Number.isInteger(at) && at >= 0 && at < points.length)) {
        read.fail(`${path}.faces[${i}]`, `must list positions in \`points\`, from 0 to ${points.length - 1}`)
        return
      }
      const wrong = polygonProblem(face.map((at: number) => points[at]!))
      if (wrong !== undefined) read.fail(`${path}.faces[${i}]`, wrong)
      faces.push(face)
    })
    return { ...base, kind: "mesh", points, faces, lifted: false }
  }
  const from = read.vector(fields.from, `${path}.from`)
  const to = read.vector(fields.to, `${path}.to`)
  if (from === undefined || to === undefined) return undefined
  const low: Vec3 = [Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.min(from[2], to[2])]
  const high: Vec3 = [Math.max(from[0], to[0]), Math.max(from[1], to[1]), Math.max(from[2], to[2])]
  if (low[0] === high[0] || low[1] === high[1] || low[2] === high[2]) read.fail(path, "has no thickness on one axis: `from` and `to` must differ on all three. For something flat, use a `face`")
  if (shape === "box") return { ...base, kind: "box", from: low, to: high, top: read.pair(fields.top, `${path}.top`, [1, 1]), lean: read.pair(fields.lean, `${path}.lean`, [0, 0]) }
  if (shape === "sphere") return { ...base, kind: "sphere", from: low, to: high }
  const axis = fields.axis ?? "z"
  if (axis !== "x" && axis !== "y" && axis !== "z") {
    read.fail(`${path}.axis`, 'must be "x", "y", or "z"')
    return undefined
  }
  return {
    ...base,
    kind: "cylinder",
    from: low,
    to: high,
    axis,
    sides: read.number(fields.sides, `${path}.sides`, 20, (n) => (Number.isInteger(n) && n >= 3 ? undefined : "must be 3 or more")),
    taper: read.number(fields.taper, `${path}.taper`, 1, (n) => (n >= 0 ? undefined : "must be 0 or more: how much the far end is scaled"))
  }
}

const MODEL_FIELDS = ["headings", "animations", "frame", "materials", "outline", "cleanup", "normals", "shadow", "parts", "paint"]

/** Reads a model, with every problem found. `setup` holds the materials it can name. */
export const parseBakeModel = (text: string, setup: BakeSetup): Parsed<BakeModel> => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ok: false, problems: [{ path: "$", message: `is not JSON: ${error instanceof Error ? error.message : String(error)}` }] }
  }
  const read = new Reader()
  const fields = read.fields(raw, "$", MODEL_FIELDS)
  const headings = read.number(fields.headings, "$.headings", 1, (n) => (Number.isInteger(n) && n >= 1 ? undefined : "must be how many directions to draw, 1 or more"))
  const animations: Array<BakeAnimation> = []
  if (fields.animations !== undefined) {
    if (isFields(fields.animations)) {
      for (const [name, value] of Object.entries(fields.animations)) {
        const a = read.fields(value, `$.animations.${name}`, ["frames", "fps", "loop"])
        if (!isCount(a.frames)) read.fail(`$.animations.${name}.frames`, "must be how many frames, 1 or more")
        const loop = a.loop ?? "forward"
        if (loop !== "forward" && loop !== "pingpong") read.fail(`$.animations.${name}.loop`, 'must be "forward" or "pingpong"')
        animations.push({ name, frames: isCount(a.frames) ? a.frames : 1, fps: read.number(a.fps, `$.animations.${name}.fps`, 8, (n) => (n > 0 ? undefined : "must be above 0")), loop: loop === "pingpong" ? "pingpong" : "forward" })
      }
    } else read.fail("$.animations", 'must map names to { "frames": 6, "fps": 8 }')
  }
  const frame = read.fields(fields.frame ?? {}, "$.frame", ["width", "up", "below"])
  const rows = (n: number) => (Number.isInteger(n) && n >= 0 ? undefined : "must be a whole number of art pixels")
  const materials = read.materials(fields.materials, "$.materials")
  const context: ModelContext = { known: { ...setup.materials, ...materials }, animations: animations.map((animation) => animation.name) }
  let parts: ReadonlyArray<BakeNode> = []
  if (Array.isArray(fields.parts) && fields.parts.length > 0) parts = fields.parts.flatMap((part, i) => parseNode(read, part, `$.parts[${i}]`, false, context) ?? [])
  else read.fail("$.parts", 'must list at least one part, like { "shape": "box", "material": "#ef7d57", "from": [-4, -4, 0], "to": [4, 4, 8] }')
  const paint: Array<BakePaint> = []
  if (fields.paint !== undefined) {
    if (Array.isArray(fields.paint)) {
      fields.paint.forEach((value: unknown, i) => {
        const path = `$.paint[${i}]`
        const p = read.fields(value, path, ["at", "rows", "headings", "animation", "frames", "after"])
        const at = read.pair(p.at, `${path}.at`, [0, 0])
        if (p.at === undefined) read.fail(`${path}.at`, "must be [x, y]: art pixels from the anchor to the first row's first pixel")
        const lines = Array.isArray(p.rows) && p.rows.every((row: unknown) => typeof row === "string") ? (p.rows as ReadonlyArray<string>) : undefined
        if (lines === undefined) read.fail(`${path}.rows`, 'must be rows of text, one letter per pixel: "." leaves what is there, "_" clears it, and any other letter is a one-color material of that name')
        for (const letter of new Set((lines ?? []).join(""))) {
          if (letter !== "." && letter !== "_" && context.known[letter]?.length !== 1) read.fail(`${path}.rows`, `uses "${letter}", which needs a one-color material of that name in \`materials\`, like { "${letter}": "#ffcd75" }`)
        }
        const indices = (list: unknown, name: string): ReadonlyArray<number> | undefined => {
          if (list === undefined) return undefined
          if (Array.isArray(list) && list.every((n: unknown) => isNumber(n) && Number.isInteger(n) && n >= 0)) return list as ReadonlyArray<number>
          read.fail(`${path}.${name}`, "must list positions, counting from 0")
          return undefined
        }
        if (p.animation !== undefined && !context.animations.includes(String(p.animation))) read.fail(`${path}.animation`, `is not an animation: \`animations\` has ${context.animations.join(", ") || "none"}`)
        paint.push({
          at,
          rows: lines ?? [],
          headings: indices(p.headings, "headings"),
          animation: typeof p.animation === "string" ? p.animation : undefined,
          frames: indices(p.frames, "frames"),
          after: read.boolean(p.after, `${path}.after`, false)
        })
      })
    } else read.fail("$.paint", "must be a list of painted pixels")
  }
  const value: BakeModel = {
    headings,
    animations,
    frame: {
      width: frame.width === undefined ? undefined : read.number(frame.width, "$.frame.width", 0, (n) => (Number.isInteger(n) && n > 0 ? undefined : "must be a whole number of art pixels, above 0")),
      up: frame.up === undefined ? undefined : read.number(frame.up, "$.frame.up", 0, rows),
      below: frame.below === undefined ? undefined : read.number(frame.below, "$.frame.below", 0, rows)
    },
    materials,
    outline: read.outline(fields.outline, "$.outline"),
    cleanup: read.boolean(fields.cleanup, "$.cleanup", true),
    normals: read.boolean(fields.normals, "$.normals", false),
    shadow: read.boolean(fields.shadow, "$.shadow", false),
    parts,
    paint
  }
  return read.problems.length > 0 ? { ok: false, problems: read.problems } : { ok: true, value }
}

// ---------------------------------------------------------------------------
// Geometry

/** An affine transform: three rows of four. */
type Matrix = readonly [number, number, number, number, number, number, number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]

const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[4] + a[2] * b[8],
  a[0] * b[1] + a[1] * b[5] + a[2] * b[9],
  a[0] * b[2] + a[1] * b[6] + a[2] * b[10],
  a[0] * b[3] + a[1] * b[7] + a[2] * b[11] + a[3],
  a[4] * b[0] + a[5] * b[4] + a[6] * b[8],
  a[4] * b[1] + a[5] * b[5] + a[6] * b[9],
  a[4] * b[2] + a[5] * b[6] + a[6] * b[10],
  a[4] * b[3] + a[5] * b[7] + a[6] * b[11] + a[7],
  a[8] * b[0] + a[9] * b[4] + a[10] * b[8],
  a[8] * b[1] + a[9] * b[5] + a[10] * b[9],
  a[8] * b[2] + a[9] * b[6] + a[10] * b[10],
  a[8] * b[3] + a[9] * b[7] + a[10] * b[11] + a[11]
]

const apply = (m: Matrix, p: Vec3): Vec3 => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]]

const translation = (v: Vec3): Matrix => [1, 0, 0, v[0], 0, 1, 0, v[1], 0, 0, 1, v[2]]

/** A positive turn takes x toward y around z, y toward z around x, and z toward x around y. */
const rotationMatrix = (rotation: Rotation, scale = 1): Matrix => {
  const radians = (rotation.degrees * scale * Math.PI) / 180
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  const turn: Matrix =
    rotation.axis === "z"
      ? [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]
      : rotation.axis === "x"
        ? [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]
        : [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]
  return multiply(multiply(translation(rotation.about), turn), translation(mul(rotation.about, -1)))
}

/** A shape's flat polygons, in its own coordinates. */
const polygonsOf = (node: Exclude<BakeNode, { kind: "group" }>): ReadonlyArray<ReadonlyArray<Vec3>> => {
  if (node.kind === "mesh") return node.faces.map((face) => face.map((at) => node.points[at]!))
  const [x0, y0, z0] = node.from
  const [x1, y1, z1] = node.to
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const cz = (z0 + z1) / 2
  if (node.kind === "box") {
    const hx = ((x1 - x0) / 2) * node.top[0]
    const hy = ((y1 - y0) / 2) * node.top[1]
    const tx = cx + node.lean[0]
    const ty = cy + node.lean[1]
    const a: Vec3 = [x0, y0, z0]
    const b: Vec3 = [x1, y0, z0]
    const c: Vec3 = [x1, y1, z0]
    const d: Vec3 = [x0, y1, z0]
    const e: Vec3 = [tx - hx, ty - hy, z1]
    const f: Vec3 = [tx + hx, ty - hy, z1]
    const g: Vec3 = [tx + hx, ty + hy, z1]
    const h: Vec3 = [tx - hx, ty + hy, z1]
    return [[a, b, c, d], [e, f, g, h], [a, b, f, e], [b, c, g, f], [c, d, h, g], [d, a, e, h]]
  }
  if (node.kind === "cylinder") {
    const ring = (t: number, k: number): Array<Vec3> =>
      Array.from({ length: node.sides }, (_, i) => {
        // Few sides stand on a flat, which reads better than on a point.
        const angle = (i / node.sides) * Math.PI * 2 + (node.sides <= 8 ? Math.PI / node.sides : 0)
        const cos = Math.cos(angle) * k
        const sin = Math.sin(angle) * k
        if (node.axis === "z") return [cx + (cos * (x1 - x0)) / 2, cy + (sin * (y1 - y0)) / 2, z0 + t * (z1 - z0)]
        if (node.axis === "y") return [cx + (cos * (x1 - x0)) / 2, y0 + t * (y1 - y0), cz + (sin * (z1 - z0)) / 2]
        return [x0 + t * (x1 - x0), cy + (cos * (y1 - y0)) / 2, cz + (sin * (z1 - z0)) / 2]
      })
    const near = ring(0, 1)
    const far = ring(1, node.taper)
    return [near, far, ...near.map((point, i) => [point, near[(i + 1) % node.sides]!, far[(i + 1) % node.sides]!, far[i]!])]
  }
  const rows = 12
  const columns = 18
  const point = (r: number, c: number): Vec3 => {
    const phi = (r / rows) * Math.PI
    const theta = (c / columns) * Math.PI * 2
    return [cx + (Math.sin(phi) * Math.cos(theta) * (x1 - x0)) / 2, cy + (Math.sin(phi) * Math.sin(theta) * (y1 - y0)) / 2, cz + (Math.cos(phi) * (z1 - z0)) / 2]
  }
  const faces: Array<ReadonlyArray<Vec3>> = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) faces.push([point(r, c), point(r, c + 1), point(r + 1, c + 1), point(r + 1, c)])
  return faces
}

/** One triangle in the camera's frame, with what it belongs to. */
interface Triangle {
  readonly a: Vec3
  readonly b: Vec3
  readonly c: Vec3
  readonly part: number
}

/** One drawn copy of a part. */
interface Piece {
  readonly source: string
  readonly name: string | undefined
  readonly ramp: ReadonlyArray<string>
  readonly detail: boolean
  readonly step: number | undefined
  readonly lifted: boolean
}

interface Moment {
  readonly animation: string | undefined
  /** How far through the animation: 0 up to, not including, 1. */
  readonly time: number
}

const motionMatrix = (node: BakeNode, moment: Moment): Matrix => {
  const motion = moment.animation === undefined ? undefined : node.animate[moment.animation]
  if (motion === undefined) return IDENTITY
  const amount = motion.wave ? Math.sin(moment.time * Math.PI * 2) : moment.time
  let matrix = IDENTITY
  if (motion.move !== undefined) matrix = multiply(matrix, translation(mul(motion.move, amount)))
  if (motion.rotate !== undefined) matrix = multiply(matrix, rotationMatrix(motion.rotate, amount))
  return matrix
}

const nodeMatrix = (node: BakeNode, moment: Moment): Matrix => {
  let matrix = IDENTITY
  if (node.move !== undefined) matrix = multiply(matrix, translation(node.move))
  if (node.rotate !== undefined) matrix = multiply(matrix, rotationMatrix(node.rotate))
  return multiply(matrix, motionMatrix(node, moment))
}

interface View {
  readonly triangles: ReadonlyArray<Triangle>
  readonly pieces: ReadonlyArray<Piece>
}

/** Every triangle of a model at one moment, in model coordinates with heights scaled. */
const flatten = (model: BakeModel, moment: Moment, resolve: (name: string) => ReadonlyArray<string>, heightScale: number): View => {
  const triangles: Array<Triangle> = []
  const pieces: Array<Piece> = []
  const visit = (node: BakeNode, parent: Matrix, material: string | undefined): void => {
    const count = node.repeat?.count ?? 1
    for (let copy = 0; copy < count; copy++) {
      let placed = parent
      if (node.repeat?.move !== undefined) placed = multiply(placed, translation(mul(node.repeat.move, copy)))
      if (node.repeat?.rotate !== undefined) placed = multiply(placed, rotationMatrix(node.repeat.rotate, copy))
      placed = multiply(placed, nodeMatrix(node, moment))
      const chosen = node.repeat?.materials?.[copy % node.repeat.materials.length] ?? node.material ?? material
      if (node.kind === "group") {
        for (const part of node.parts) visit(part, placed, chosen)
        continue
      }
      const part = pieces.length
      pieces.push({ source: node.path, name: node.name, ramp: resolve(chosen!), detail: node.detail, step: node.step, lifted: node.kind === "mesh" && node.lifted })
      for (const polygon of polygonsOf(node)) {
        const points = polygon.map((point) => {
          const p = apply(placed, point)
          return [p[0], p[1], p[2] * heightScale] as Vec3
        })
        for (let i = 1; i + 1 < points.length; i++) triangles.push({ a: points[0]!, b: points[i]!, c: points[i + 1]!, part })
      }
    }
  }
  for (const node of model.parts) visit(node, IDENTITY, undefined)
  return { triangles, pieces }
}

// ---------------------------------------------------------------------------
// Drawing

export interface BakedFrame {
  readonly art: PixelArt
  /** The directions, as `pixel normals` writes them: x right, y up, z to the viewer. */
  readonly normal: RgbaImage
  readonly shadow: PixelArt
}

export interface BakedClip {
  /** `spin`, `heading-2`, `spin-heading-2`, or undefined for a still. */
  readonly name: string | undefined
  readonly frames: ReadonlyArray<BakedFrame>
  readonly fps: number
  readonly loop: Loop
}

export interface BakeResult {
  readonly width: number
  readonly height: number
  /** Where the model's origin lands on the frame: the corner between pixels, in art pixels from its top left. */
  readonly anchor: { readonly x: number; readonly y: number }
  readonly clips: ReadonlyArray<BakedClip>
  /** Parts that show no pixel in any frame. */
  readonly hidden: ReadonlyArray<{ readonly path: string; readonly name: string | undefined }>
  /** How many art pixels the art reaches past a frame the model set. */
  readonly cut: { readonly left: number; readonly right: number; readonly up: number; readonly below: number }
  readonly parts: number
}

/** Samples per art pixel across. Enough that a part's edge lands within a pixel's vote. */
const SAMPLES = 8
/** How many samples a `detail` part's one counts as. */
const DETAIL_WEIGHT = 3
const CLEANUP_PASSES = 4
/** How far, in art pixels of depth, a `face` draws in front of what it lies on. */
const FACE_LIFT = 0.12

const fillTriangle = (a: Vec3, b: Vec3, c: Vec3, width: number, height: number, put: (x: number, y: number, depth: number) => void): void => {
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  if (Math.abs(area) < 1e-9) return
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])))
  const x1 = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])))
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])))
  const y1 = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area
      const w2 = 1 - w0 - w1
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue
      put(x, y, w0 * a[2] + w1 * b[2] + w2 * c[2])
    }
  }
}

/** Which step of a ramp a surface takes from the light on it. Steps fall evenly from `dark` to `bright`. */
const stepOfLight = (light: number, length: number, dark: number, bright: number): number => {
  if (length <= 1) return 0
  if (length === 2) return light >= (dark + bright) / 2 ? 1 : 0
  let step = 0
  for (let i = 0; i < length - 1; i++) if (light >= dark + ((bright - dark) * i) / (length - 2)) step++
  return step
}

interface Camera {
  readonly toRotated: (p: Vec3) => Vec3
  readonly project: (p: Vec3) => { readonly x: number; readonly y: number; readonly depth: number }
  readonly toView: (n: Vec3) => Vec3
  /** The point in rotated coordinates under art pixels from the anchor, at a depth. */
  readonly fromScreen: (x: number, y: number, depth: number) => Vec3
}

const cameraOf = (setup: BakeSetup, heading: number, headings: number): Camera => {
  const yaw = ((setup.camera.yaw + (360 * heading) / headings) * Math.PI) / 180
  const elevation = (setup.camera.elevation * Math.PI) / 180
  const cosYaw = Math.cos(yaw)
  const sinYaw = Math.sin(yaw)
  const sinE = Math.sin(elevation)
  const cosE = Math.cos(elevation)
  const scale = setup.camera.scale
  return {
    toRotated: (p) => [p[0] * cosYaw - p[1] * sinYaw, p[0] * sinYaw + p[1] * cosYaw, p[2]],
    project: (p) => ({ x: p[0] * scale, y: (p[1] * sinE - p[2] * cosE) * scale, depth: p[1] * cosE + p[2] * sinE }),
    toView: (n) => [n[0], n[2] * cosE - n[1] * sinE, n[1] * cosE + n[2] * sinE],
    fromScreen: (x, y, depth) => [x / scale, (y / scale) * sinE + depth * cosE, depth * sinE - (y / scale) * cosE]
  }
}

/** What stands between a point and the sun: a map of the nearest part along the light. */
const castMap = (triangles: ReadonlyArray<Triangle>, sun: Vec3, scale: number): ((point: Vec3, part: number) => boolean) => {
  const right = unit(cross([0, 0, 1], sun))
  const up = cross(sun, right)
  const resolution = 4 * scale
  let a0 = Infinity
  let b0 = Infinity
  let a1 = -Infinity
  let b1 = -Infinity
  for (const t of triangles) {
    for (const p of [t.a, t.b, t.c]) {
      const a = dot(p, right)
      const b = dot(p, up)
      a0 = Math.min(a0, a)
      a1 = Math.max(a1, a)
      b0 = Math.min(b0, b)
      b1 = Math.max(b1, b)
    }
  }
  const width = Math.ceil((a1 - a0) * resolution) + 4
  const height = Math.ceil((b1 - b0) * resolution) + 4
  const nearest = new Float32Array(width * height).fill(-Infinity)
  const who = new Int32Array(width * height).fill(-1)
  const place = (p: Vec3): Vec3 => [(dot(p, right) - a0) * resolution + 1, (dot(p, up) - b0) * resolution + 1, dot(p, sun)]
  for (const t of triangles) {
    fillTriangle(place(t.a), place(t.b), place(t.c), width, height, (x, y, depth) => {
      const i = y * width + x
      if (depth > nearest[i]!) {
        nearest[i] = depth
        who[i] = t.part
      }
    })
  }
  const bias = 2 / resolution
  return (point, part) => {
    const x = Math.floor((dot(point, right) - a0) * resolution + 1)
    const y = Math.floor((dot(point, up) - b0) * resolution + 1)
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const i = y * width + x
    return who[i] !== part && nearest[i]! > dot(point, sun) + bias
  }
}

/** Draws every view of a model. */
export const bake = (model: BakeModel, setup: BakeSetup, paletteColors?: ReadonlyArray<Rgb>): BakeResult => {
  const materials = { ...setup.materials, ...model.materials }
  const resolve = (name: string): ReadonlyArray<string> => materials[name] ?? [toHex(parseHex(name)!)]
  const heightScale = setup.camera.heightScale
  const sun = unit(setup.light.sun)
  const moments: ReadonlyArray<{ readonly clip: BakeAnimation | undefined; readonly frame: number; readonly moment: Moment }> =
    model.animations.length === 0
      ? [{ clip: undefined, frame: 0, moment: { animation: undefined, time: 0 } }]
      : model.animations.flatMap((clip) => Array.from({ length: clip.frames }, (_, frame) => ({ clip, frame, moment: { animation: clip.name, time: frame / clip.frames } })))
  const views = new Map<string, View>()
  const viewOf = (moment: Moment): View => {
    const key = `${moment.animation}/${moment.time}`
    let view = views.get(key)
    if (view === undefined) {
      view = flatten(model, moment, resolve, heightScale)
      views.set(key, view)
    }
    return view
  }

  // The frame: what every view reaches, one anchor for them all.
  const shadowOf = (p: Vec3): Vec3 => sub(p, mul(sun, p[2] / sun[2]))
  let minX = 0
  let maxX = 0
  let minY = 0
  let maxY = 0
  const reach = (x: number, y: number): void => {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  let shadowReach = { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  for (let heading = 0; heading < model.headings; heading++) {
    const camera = cameraOf(setup, heading, model.headings)
    for (const { moment } of moments) {
      for (const t of viewOf(moment).triangles) {
        for (const point of [t.a, t.b, t.c]) {
          const rotated = camera.toRotated(point)
          const p = camera.project(rotated)
          reach(p.x, p.y)
          if (model.shadow) {
            const s = camera.project(shadowOf(rotated))
            shadowReach = { minX: Math.min(shadowReach.minX, s.x), maxX: Math.max(shadowReach.maxX, s.x), minY: Math.min(shadowReach.minY, s.y), maxY: Math.max(shadowReach.maxY, s.y) }
          }
        }
      }
    }
  }
  for (const paint of model.paint) {
    reach(paint.at[0], paint.at[1])
    reach(paint.at[0] + Math.max(0, ...paint.rows.map((row) => row.length)), paint.at[1] + paint.rows.length)
  }
  // Room for the outline, and for a shape's edge to round up.
  const margin = 2
  const auto = {
    left: Math.ceil(-Math.min(minX, shadowReach.minX)) + margin,
    right: Math.ceil(Math.max(maxX, shadowReach.maxX)) + margin,
    up: Math.ceil(-Math.min(minY, shadowReach.minY)) + margin,
    below: Math.ceil(Math.max(maxY, shadowReach.maxY)) + margin
  }
  const halfWidth = model.frame.width === undefined ? undefined : model.frame.width / 2
  const left = halfWidth ?? auto.left
  const right = halfWidth ?? auto.right
  const up = model.frame.up ?? auto.up
  const below = model.frame.below ?? auto.below
  const width = Math.ceil(left + right)
  const height = up + below
  const cut = {
    left: Math.max(0, Math.ceil(-minX - left)),
    right: Math.max(0, Math.ceil(maxX - right)),
    up: Math.max(0, Math.ceil(-minY - up)),
    below: Math.max(0, Math.ceil(maxY - below))
  }

  // One palette for every frame, so a sheet is one picture.
  const palette: Array<Rgb> = []
  const places = new Map<string, number>()
  const indexOf = (hex: string): number => {
    let index = places.get(hex)
    if (index === undefined) {
      index = palette.length
      palette.push(parseHex(hex)!)
      places.set(hex, index)
    }
    return index
  }
  const lightness = (c: Rgb): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  const darkestOf = (colors: ReadonlyArray<Rgb>): number => {
    const darkest = colors.reduce((best, c) => (lightness(c) < lightness(best) ? c : best))
    return indexOf(toHex(darkest))
  }
  const outlineSetting = model.outline !== undefined ? model.outline : setup.outline
  // Every color first, so the darkest is settled and is the same in every frame.
  for (const { moment } of moments) for (const piece of viewOf(moment).pieces) for (const color of piece.ramp) indexOf(color)
  const outlineColor = outlineSetting === false ? undefined : outlineSetting !== undefined ? indexOf(outlineSetting) : darkestOf(paletteColors !== undefined && paletteColors.length > 0 ? paletteColors : palette)
  const sampleWidth = width * SAMPLES
  const sampleHeight = height * SAMPLES
  const shown = new Map<string, number>()

  const draw = (heading: number, clip: BakeAnimation | undefined, frame: number, moment: Moment): BakedFrame => {
    const camera = cameraOf(setup, heading, model.headings)
    const view = viewOf(moment)
    const rotated = view.triangles.map((t) => ({ a: camera.toRotated(t.a), b: camera.toRotated(t.b), c: camera.toRotated(t.c), part: t.part }))
    const casts = setup.light.castShadows ? castMap(rotated, sun, setup.camera.scale) : undefined
    const depth = new Float32Array(sampleWidth * sampleHeight).fill(-Infinity)
    const owner = new Int32Array(sampleWidth * sampleHeight).fill(-1)
    const stepAt = new Uint8Array(sampleWidth * sampleHeight)
    const normalAt = new Float32Array(sampleWidth * sampleHeight * 3)
    const toSample = (p: Vec3): Vec3 => {
      const q = camera.project(p)
      return [(q.x + left) * SAMPLES, (q.y + up) * SAMPLES, q.depth]
    }
    for (const t of rotated) {
      let world = unit(cross(sub(t.b, t.a), sub(t.c, t.a)))
      let facing = camera.toView(world)
      // Whichever side faces the viewer is the side seen, so an open shape or a lone face shades right too.
      if (facing[2] < 0) {
        world = mul(world, -1)
        facing = mul(facing, -1)
      }
      const piece = view.pieces[t.part]!
      const light = dot(world, sun)
      const shade = Math.min(piece.ramp.length - 1, piece.step ?? stepOfLight(light, piece.ramp.length, setup.light.dark, setup.light.bright))
      // A face on a surface shows over it: a door drawn exactly on its wall needs no gap.
      const lift = piece.lifted ? FACE_LIFT / setup.camera.scale : 0
      fillTriangle(toSample(t.a), toSample(t.b), toSample(t.c), sampleWidth, sampleHeight, (x, y, d) => {
        const i = y * sampleWidth + x
        if (d + lift <= depth[i]!) return
        depth[i] = d + lift
        owner[i] = t.part
        let step = shade
        if (casts !== undefined && piece.step === undefined && light > 0.02 && casts(camera.fromScreen((x + 0.5) / SAMPLES - left, (y + 0.5) / SAMPLES - up, d), t.part)) step = Math.max(0, step - 1)
        stepAt[i] = step
        normalAt[i * 3] = facing[0]
        normalAt[i * 3 + 1] = facing[1]
        normalAt[i * 3 + 2] = facing[2]
      })
    }

    // Each art pixel takes the surface most of its samples show.
    const pixels = width * height
    const pixelOwner = new Int32Array(pixels).fill(-1)
    const pixelStep = new Uint8Array(pixels)
    const pixelDepth = new Float32Array(pixels)
    const pixelNormal = new Float32Array(pixels * 3)
    const votes = new Map<number, { weight: number; count: number; depth: number; x: number; y: number; z: number }>()
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        votes.clear()
        let covered = 0
        for (let j = 0; j < SAMPLES; j++) {
          for (let k = 0; k < SAMPLES; k++) {
            const s = (y * SAMPLES + j) * sampleWidth + x * SAMPLES + k
            const part = owner[s]!
            if (part < 0) continue
            const weight = view.pieces[part]!.detail ? DETAIL_WEIGHT : 1
            covered += weight
            const key = part * 256 + stepAt[s]!
            let vote = votes.get(key)
            if (vote === undefined) {
              vote = { weight: 0, count: 0, depth: 0, x: 0, y: 0, z: 0 }
              votes.set(key, vote)
            }
            vote.weight += weight
            vote.count++
            vote.depth += depth[s]!
            vote.x += normalAt[s * 3]!
            vote.y += normalAt[s * 3 + 1]!
            vote.z += normalAt[s * 3 + 2]!
          }
        }
        if (covered * 2 < SAMPLES * SAMPLES) continue
        let best = -1
        let bestWeight = -1
        for (const [key, vote] of votes) {
          if (vote.weight > bestWeight) {
            bestWeight = vote.weight
            best = key
          }
        }
        const vote = votes.get(best)!
        const i = y * width + x
        pixelOwner[i] = Math.floor(best / 256)
        pixelStep[i] = best % 256
        pixelDepth[i] = vote.depth / vote.count
        const n = unit([vote.x, vote.y, vote.z])
        pixelNormal[i * 3] = n[0]
        pixelNormal[i * 3 + 1] = n[1]
        pixelNormal[i * 3 + 2] = n[2]
      }
    }

    const neighbours = (i: number): ReadonlyArray<number> => {
      const x = i % width
      const list: Array<number> = []
      if (x > 0) list.push(i - 1)
      if (x < width - 1) list.push(i + 1)
      if (i >= width) list.push(i - width)
      if (i < pixels - width) list.push(i + width)
      return list
    }

    // A surface behind a jump in depth goes a step darker, which separates parts without a line around each.
    const edges = setup.edges
    const finalStep = pixelStep.slice()
    if (edges !== false) {
      for (let i = 0; i < pixels; i++) {
        const part = pixelOwner[i]!
        if (part < 0 || view.pieces[part]!.step !== undefined) continue
        if (neighbours(i).some((n) => pixelOwner[n]! >= 0 && (pixelDepth[n]! - pixelDepth[i]!) * setup.camera.scale > edges)) finalStep[i] = Math.max(0, pixelStep[i]! - 1)
      }
    }

    const indices = new Int32Array(pixels).fill(TRANSPARENT)
    const protectedPixel = new Uint8Array(pixels)
    for (let i = 0; i < pixels; i++) {
      const part = pixelOwner[i]!
      if (part < 0) continue
      const piece = view.pieces[part]!
      indices[i] = indexOf(piece.ramp[Math.min(piece.ramp.length - 1, finalStep[i]!)]!)
      if (piece.detail) protectedPixel[i] = 1
      shown.set(piece.source, (shown.get(piece.source) ?? 0) + 1)
    }

    // Hand-placed pixels: always the last word on what they cover.
    const painted = (after: boolean): void => {
      for (const paint of model.paint) {
        if (paint.after !== after) continue
        if (paint.headings !== undefined && !paint.headings.includes(heading)) continue
        if (paint.animation !== undefined && paint.animation !== clip?.name) continue
        if (paint.frames !== undefined && !paint.frames.includes(frame)) continue
        const originX = Math.round(left + paint.at[0])
        const originY = Math.round(up + paint.at[1])
        paint.rows.forEach((row, dy) => {
          ;[...row].forEach((letter, dx) => {
            if (letter === ".") return
            const x = originX + dx
            const y = originY + dy
            if (x < 0 || y < 0 || x >= width || y >= height) return
            const i = y * width + x
            indices[i] = letter === "_" ? TRANSPARENT : indexOf(materials[letter]![0]!)
            protectedPixel[i] = letter === "_" ? 0 : 1
            if (letter !== "_" && pixelOwner[i]! < 0) {
              pixelNormal[i * 3] = 0
              pixelNormal[i * 3 + 1] = 0
              pixelNormal[i * 3 + 2] = 1
            }
          })
        })
      }
    }
    painted(false)

    // One outline around whatever now stands there.
    if (outlineColor !== undefined) {
      const before = indices.slice()
      for (let i = 0; i < pixels; i++) {
        if (before[i] !== TRANSPARENT) continue
        const near = neighbours(i).filter((n) => before[n] !== TRANSPARENT)
        if (near.length === 0) continue
        indices[i] = outlineColor
        const n = unit(near.reduce<Vec3>((sum, at) => add(sum, [pixelNormal[at * 3]!, pixelNormal[at * 3 + 1]!, pixelNormal[at * 3 + 2]!]), [0, 0, 0]))
        pixelNormal[i * 3] = n[0]
        pixelNormal[i * 3 + 1] = n[1]
        pixelNormal[i * 3 + 2] = n[2]
      }
    }
    painted(true)

    // The lint's lone pixels go, by the rule it reads them by, except what was placed on purpose.
    if (model.cleanup) {
      for (let pass = 0; pass < CLEANUP_PASSES; pass++) {
        const strays = strayPixels(indices, width, height).filter((i) => protectedPixel[i] === 0)
        if (strays.length === 0) break
        for (const i of strays) {
          const x = i % width
          const y = Math.floor(i / width)
          const counts = new Map<number, number>()
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
              const value = indices[ny * width + nx]!
              if (value !== indices[i]) counts.set(value, (counts.get(value) ?? 0) + 1)
            }
          }
          const top = [...counts].sort((a, b) => b[1] - a[1])[0]
          if (top !== undefined) indices[i] = top[0]
        }
      }
    }

    const normal = new Uint8ClampedArray(pixels * 4)
    for (let i = 0; i < pixels; i++) {
      if (indices[i] === TRANSPARENT) continue
      normal[i * 4] = Math.round((pixelNormal[i * 3]! * 0.5 + 0.5) * 255)
      normal[i * 4 + 1] = Math.round((pixelNormal[i * 3 + 1]! * 0.5 + 0.5) * 255)
      normal[i * 4 + 2] = Math.round((pixelNormal[i * 3 + 2]! * 0.5 + 0.5) * 255)
      normal[i * 4 + 3] = 255
    }

    const shadowIndices = new Int32Array(pixels).fill(TRANSPARENT)
    if (model.shadow) {
      const covered = new Uint8Array(sampleWidth * sampleHeight)
      const flat = (p: Vec3): Vec3 => {
        const q = camera.project(shadowOf(p))
        return [(q.x + left) * SAMPLES, (q.y + up) * SAMPLES, 0]
      }
      for (const t of rotated) {
        fillTriangle(flat(t.a), flat(t.b), flat(t.c), sampleWidth, sampleHeight, (x, y) => {
          covered[y * sampleWidth + x] = 1
        })
      }
      const color = outlineColor ?? darkestOf(palette)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let count = 0
          for (let j = 0; j < SAMPLES; j++) for (let k = 0; k < SAMPLES; k++) count += covered[(y * SAMPLES + j) * sampleWidth + x * SAMPLES + k]!
          if (count * 2 >= SAMPLES * SAMPLES) shadowIndices[y * width + x] = color
        }
      }
    }

    return {
      art: { width, height, palette, indices },
      normal: { width, height, data: normal },
      shadow: { width, height, palette, indices: shadowIndices }
    }
  }

  const clips: Array<BakedClip> = []
  const animated = model.animations.length > 0
  for (let heading = 0; heading < model.headings; heading++) {
    const suffix = model.headings > 1 ? `heading-${heading}` : undefined
    if (!animated) {
      clips.push({ name: suffix, frames: [draw(heading, undefined, 0, { animation: undefined, time: 0 })], fps: 8, loop: "forward" })
      continue
    }
    for (const clip of model.animations) {
      clips.push({
        name: suffix === undefined ? clip.name : `${clip.name}-${suffix}`,
        frames: Array.from({ length: clip.frames }, (_, frame) => draw(heading, clip, frame, { animation: clip.name, time: frame / clip.frames })),
        fps: clip.fps,
        loop: clip.loop
      })
    }
  }

  const sources = new Map<string, string | undefined>()
  for (const { moment } of moments) for (const piece of viewOf(moment).pieces) sources.set(piece.source, piece.name)
  return {
    width,
    height,
    anchor: { x: left, y: up },
    clips,
    hidden: [...sources].filter(([path]) => (shown.get(path) ?? 0) === 0).map(([path, name]) => ({ path, name })),
    cut,
    parts: sources.size
  }
}
