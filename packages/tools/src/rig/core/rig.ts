/**
 * A character as code: a rig module the agent writes, with no imports,
 * whose default export is a bone tree with its setup pose, the parts
 * (shapes) bound to the bones, the two-bone IK chains, the props, and the
 * named stances clips start and end on:
 *
 *   export default {
 *     size: [96, 112], anchor: [48, 104],
 *     bones: { hips: { y: 40, rotation: 90, length: 6 }, torso: { parent: "hips", length: 26 }, ... },
 *     parts: { torso: { bone: "torso", z: 10, fill: "#3f7fb8", shape: { kind: "capsule", r: 7 } }, ... },
 *     chains: { legNear: { upper: "thighNear", lower: "shinNear", end: "footNear", bend: 1, foot: true } },
 *     props: { sword: ["blade", "grip"] },
 *     stances: { ready: { bones: { torso: -6 }, reach: { legNear: { x: 8, y: 3 } } } }
 *   }
 *
 * Coordinates: y up, the origin on the ground under the character, angles
 * in degrees, counter-clockwise positive, 0 pointing along +x (Spine's
 * convention). Parts are drawn in the setup pose's world coordinates ("draw
 * the character standing, then bind each shape to a bone") and follow their
 * bone from there; a point can also be given on a bone (`{ bone, along,
 * across }`), so a shape that hangs on a bone is written along it.
 *
 * This module decodes a rig module and a pose, naming every field that is
 * wrong; `pose.ts` solves poses, `keys.ts` keyframes them, and `clip.ts`
 * runs clips.
 */
import type { Decoded } from "../../fx/core/effect.ts"

export type { Decoded }

/** A point or a vector: `[x, y]`. */
export type V = readonly [number, number]

/** A 2D affine transform: maps (u, v) to (a u + c v + x, b u + d v + y). */
export interface Mat {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
  readonly x: number
  readonly y: number
}

const RAD = Math.PI / 180
export const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, x: 0, y: 0 }

/** `m` after `n`: a point goes through `n` first. */
export const mul = (m: Mat, n: Mat): Mat => ({
  a: m.a * n.a + m.c * n.b,
  b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d,
  d: m.b * n.c + m.d * n.d,
  x: m.a * n.x + m.c * n.y + m.x,
  y: m.b * n.x + m.d * n.y + m.y
})

/** A bone's transform in its parent's frame: moved to (x, y), turned by `rotation` degrees, scaled. */
export const localMat = (x: number, y: number, rotation: number, sx: number, sy: number): Mat => {
  const cs = Math.cos(rotation * RAD)
  const sn = Math.sin(rotation * RAD)
  return { a: cs * sx, b: sn * sx, c: -sn * sy, d: cs * sy, x, y }
}

export const apply = (m: Mat, p: V): V => [m.a * p[0] + m.c * p[1] + m.x, m.b * p[0] + m.d * p[1] + m.y]

export const invert = (m: Mat): Mat => {
  const det = m.a * m.d - m.b * m.c
  const a = m.d / det
  const b = -m.b / det
  const c = -m.c / det
  const d = m.a / det
  return { a, b, c, d, x: -(a * m.x + c * m.y), y: -(b * m.x + d * m.y) }
}

/** A transform's rotation, in degrees. */
export const angleOf = (m: Mat): number => Math.atan2(m.b, m.a) / RAD

/** A transform's uniform scale (the square root of its area's change). */
export const scaleOf = (m: Mat): number => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c))

/** `deg` wrapped into -180 to 180. */
export const wrap = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180

// ---------------------------------------------------------------------------
// The rig

export interface Bone {
  readonly name: string
  readonly parent: string | undefined
  /** Where the bone starts, in its parent's frame (along the parent, then across it). */
  readonly x: number
  readonly y: number
  /** Its turn from the parent's direction in the setup pose. */
  readonly rotation: number
  readonly length: number
  readonly scaleX: number
  readonly scaleY: number
}

/**
 * A shape as the rig module writes it, in the setup pose's world
 * coordinates. Every kind draws with the part's fill and outline. An
 * image part (a PNG with its pivot) is a later kind of the same union:
 * clips name parts, never shapes, so they do not change with it.
 */
export type Shape =
  /** A tapered capsule from `a` (radius `r`) to `b` (radius `r2`): a limb. */
  | { readonly kind: "capsule"; readonly a: V; readonly b: V; readonly r: number; readonly r2: number }
  | { readonly kind: "ellipse"; readonly c: V; readonly rx: number; readonly ry: number; readonly angle: number }
  /** A polygon whose corners are rounded by `round` (which also grows it by `round`). */
  | { readonly kind: "poly"; readonly points: ReadonlyArray<V>; readonly round: number }
  /**
   * The area the bone's segment from `from` to `to` (along it) swept over
   * the last `frames` frames, narrowing toward the oldest edge: a smear.
   * The tool works it out from the clip's own poses, so it always matches
   * the motion.
   */
  | { readonly kind: "sweep"; readonly from: number; readonly to: number; readonly frames: number }

export interface Part {
  readonly name: string
  readonly bone: string
  /** Draw order: higher draws over lower; equal keeps the order the parts are declared in. */
  readonly z: number
  /** `#rrggbb` or `#rrggbbaa`. */
  readonly fill: string
  /** The outline's color, or `null` for none. */
  readonly outline: string | null
  /** The outline's width in pixels. */
  readonly line: number
  readonly shape: Shape
  /** Other shapes the part can take by name: a pose's `slots`, or its prop's look. */
  readonly alt: Readonly<Record<string, Shape>>
  /** Not drawn unless a pose shows it (`slots: { smear: "default" }`). */
  readonly hidden: boolean
  /** On the far side of the body: the `peek` check warns when it shows behind the back. */
  readonly far: boolean
  /** The prop it belongs to: hidden or swapped with the rest of it (`props: { sword: null }`). */
  readonly prop: string | undefined
}

export interface Chain {
  readonly name: string
  readonly upper: string
  /** Starts at the end of `upper`. */
  readonly lower: string
  /** The bone at the end (a foot, a hand), a child of `lower`. */
  readonly end: string
  /** Which way the middle joint bends: 1 counter-clockwise from the line to the goal (a knee facing +x), -1 the other way. */
  readonly bend: 1 | -1
  /** The chain ends in a foot: the checks measure its ground contact. */
  readonly foot: boolean
}

/** What the backdrop of pictures is drawn in: above the ground, the ground line, and below it. */
export interface Look {
  readonly background: string
  readonly ground: string
  readonly floor: string
}

/** A rig module, checked: every name resolved and every shape in setup-pose world coordinates. */
export interface Rig {
  /** The frame's size in pixels. */
  readonly width: number
  readonly height: number
  /** The pixel the world origin (the ground under the character) sits on. */
  readonly anchor: V
  /** Which way the character faces: 1 toward +x (right), -1 toward -x. */
  readonly facing: 1 | -1
  /** The bone the body's back runs along, for the `peek` check; none skips it. */
  readonly back: string | undefined
  readonly look: Look
  readonly bones: Readonly<Record<string, Bone>>
  /** Parents before children, in the order the bones are declared otherwise. */
  readonly order: ReadonlyArray<string>
  /** Each bone's setup-pose world transform. */
  readonly setup: Readonly<Record<string, Mat>>
  /** In the order they are declared. */
  readonly parts: ReadonlyArray<Part>
  readonly part: Readonly<Record<string, Part>>
  /** Each bone's parts. */
  readonly partsOf: Readonly<Record<string, ReadonlyArray<string>>>
  readonly chains: Readonly<Record<string, Chain>>
  readonly props: Readonly<Record<string, ReadonlyArray<string>>>
  readonly stances: Readonly<Record<string, Pose>>
  /** Each part's setup bone transform, inverted: setup world -> the bone's frame. */
  readonly bind: Readonly<Record<string, Mat>>
}

/** A bone's tip in a set of world transforms. */
export const tipOf = (rig: Rig, world: Readonly<Record<string, Mat>>, bone: string): V => apply(world[bone]!, [rig.bones[bone]!.length, 0])

// ---------------------------------------------------------------------------
// Poses

/** A bone's change from its setup pose: a number turns it; an object can also move it (in its parent's frame) and scale it. */
export type BoneOffset = number | { readonly r?: number | undefined; readonly x?: number | undefined; readonly y?: number | undefined; readonly sx?: number | undefined; readonly sy?: number | undefined }

/** A bone's world angle (degrees), or that with a `mix` (0 to 1) blending from what the bone would do without it. */
export type Aim = number | { readonly angle: number; readonly mix?: number | undefined }

/**
 * An IK chain's goal: where its end bone starts (an ankle, a wrist), and
 * how much of the chain it moves (`mix`, 0 to 1, default 1: at 0 the bones
 * keep their own turns, so a hand takes hold over a few frames).
 *
 * - `{ x, y }`: a world point.
 * - `{ bone, along, across, dx, dy }`: a point on another bone (`along` it and
 *   `across` it, to its left), moved by `(dx, dy)` in world axes: a hand on
 *   a sword's grip, or a fist a little in front of the shoulder
 *   (`{ bone: "torso", along: 35, dx: 24 }`). The bone must be declared
 *   before the chain's upper bone.
 *
 * The end bone keeps its setup world angle unless the goal says `angle`
 * (world) or, on a bone goal, `turn` (from that bone's angle).
 */
export type Goal =
  | { readonly x: number; readonly y: number; readonly angle?: number | undefined; readonly mix?: number | undefined }
  | {
      readonly bone: string
      readonly along?: number | undefined
      readonly across?: number | undefined
      readonly dx?: number | undefined
      readonly dy?: number | undefined
      readonly angle?: number | undefined
      readonly turn?: number | undefined
      readonly mix?: number | undefined
    }

/**
 * A pose: what changes from the setup pose. Bones are solved parent first;
 * on each bone an `aim` wins over a `reach` (IK), and a reach over the
 * bone's own turn, each by its `mix`.
 */
export interface Pose {
  /** Turns (and moves and scales) from the setup pose, each relative to the parent. */
  readonly bones?: Readonly<Record<string, BoneOffset>> | undefined
  /** World angles: "the blade at 245°", "the thigh at -40° and the shin hanging (-90°)". */
  readonly aim?: Readonly<Record<string, Aim>> | undefined
  /** Goals for IK chains. */
  readonly reach?: Readonly<Record<string, Goal>> | undefined
  /** A part's shape by `alt` name, `"default"`, or `null` to hide it. A prop's parts hide only with their prop. */
  readonly slots?: Readonly<Record<string, string | null>> | undefined
  /** A prop shown (`"default"`), swapped to a look its parts have in `alt` (parts without it hide), or hidden (`null`), as one. */
  readonly props?: Readonly<Record<string, string | null>> | undefined
  /** A part's draw order, replacing its `z`. */
  readonly z?: Readonly<Record<string, number>> | undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const isColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)
const isPair = (value: unknown): value is V => Array.isArray(value) && value.length === 2 && value.every(isNumber)
const list = (names: Iterable<string>): string => [...names].join(", ") || "none"

const BONE_FIELDS = ["r", "x", "y", "sx", "sy"] as const
const GOAL_FIELDS = ["x", "y", "bone", "along", "across", "dx", "dy", "angle", "turn", "mix"] as const

/**
 * What is wrong with a pose for a rig, each problem in words: names the rig
 * does not have, values that are not numbers, a prop part hidden alone, a
 * goal on a bone that is solved after the chain. Empty when it is fine.
 */
export const poseProblems = (rig: Rig, pose: unknown): Array<string> => {
  if (!isRecord(pose)) return ["a pose must be an object of { bones, aim, reach, slots, props, z }"]
  const problems: Array<string> = []
  const known = new Set(["bones", "aim", "reach", "slots", "props", "z"])
  for (const key of Object.keys(pose)) if (!known.has(key)) problems.push(`a pose has no field ${key} (it takes ${list(known)})`)
  const section = (name: string): Record<string, unknown> => {
    const value = pose[name]
    if (value === undefined) return {}
    if (isRecord(value)) return value
    problems.push(`${name} must be an object`)
    return {}
  }
  const bones = (where: string, name: string): boolean => {
    if (name in rig.bones) return true
    problems.push(`${where}: no bone named ${name} (the rig has ${list(Object.keys(rig.bones))})`)
    return false
  }
  for (const [name, value] of Object.entries(section("bones"))) {
    if (!bones("bones", name)) continue
    if (isNumber(value)) continue
    if (!isRecord(value)) {
      problems.push(`bones.${name} must be a turn (a number) or { r, x, y, sx, sy }`)
      continue
    }
    for (const [field, v] of Object.entries(value)) {
      if (!(BONE_FIELDS as ReadonlyArray<string>).includes(field)) problems.push(`bones.${name}.${field} is not a field (it takes ${BONE_FIELDS.join(", ")})`)
      else if (!isNumber(v)) problems.push(`bones.${name}.${field} must be a number`)
    }
  }
  for (const [name, value] of Object.entries(section("aim"))) {
    if (!bones("aim", name)) continue
    if (isNumber(value)) continue
    if (!isRecord(value) || !isNumber(value.angle) || (value.mix !== undefined && !isNumber(value.mix)) || Object.keys(value).some((k) => k !== "angle" && k !== "mix"))
      problems.push(`aim.${name} must be a world angle (a number) or { angle, mix }`)
  }
  for (const [name, value] of Object.entries(section("reach"))) {
    const chain = rig.chains[name]
    if (chain === undefined) {
      problems.push(`reach: no chain named ${name} (the rig has ${list(Object.keys(rig.chains))})`)
      continue
    }
    if (!isRecord(value)) {
      problems.push(`reach.${name} must be a goal: { x, y } or { bone, along, across, dx, dy }`)
      continue
    }
    for (const [field, v] of Object.entries(value)) {
      if (!(GOAL_FIELDS as ReadonlyArray<string>).includes(field)) problems.push(`reach.${name}.${field} is not a field (a goal takes ${GOAL_FIELDS.join(", ")})`)
      else if (field !== "bone" && !isNumber(v)) problems.push(`reach.${name}.${field} must be a number`)
    }
    if (value.bone === undefined) {
      if (!isNumber(value.x) || !isNumber(value.y)) problems.push(`reach.${name} needs x and y (a world point), or a bone to be on`)
      for (const field of ["along", "across", "dx", "dy", "turn"]) if (value[field] !== undefined) problems.push(`reach.${name}.${field} needs a bone: { bone, ${field} }`)
    } else {
      if (typeof value.bone !== "string" || !(value.bone in rig.bones)) problems.push(`reach.${name}.bone: no bone named ${String(value.bone)}`)
      else if (rig.order.indexOf(value.bone) > rig.order.indexOf(chain.upper))
        problems.push(`reach.${name} is on ${value.bone}, which is solved after ${chain.upper}: declare ${value.bone} before ${chain.upper} in bones`)
      if (value.x !== undefined || value.y !== undefined) problems.push(`reach.${name} is on a bone, so it takes along, across, dx, dy, not x and y`)
      if (value.angle !== undefined && value.turn !== undefined) problems.push(`reach.${name} takes angle (world) or turn (from ${String(value.bone)}), not both`)
    }
  }
  for (const [name, value] of Object.entries(section("slots"))) {
    const part = rig.part[name]
    if (part === undefined) {
      problems.push(`slots: no part named ${name}`)
      continue
    }
    if (value === null) {
      if (part.prop !== undefined && !part.hidden) problems.push(`slots.${name}: ${name} belongs to the prop ${part.prop}; hide the whole prop with props: { ${part.prop}: null }`)
      continue
    }
    if (value !== "default" && (typeof value !== "string" || !(value in part.alt))) problems.push(`slots.${name} must be "default", null, or one of its alt shapes (${list(Object.keys(part.alt))})`)
  }
  for (const [name, value] of Object.entries(section("props"))) {
    const parts = rig.props[name]
    if (parts === undefined) {
      problems.push(`props: no prop named ${name} (the rig has ${list(Object.keys(rig.props))})`)
      continue
    }
    if (value === null || value === "default") continue
    const looks = new Set(parts.flatMap((part) => Object.keys(rig.part[part]!.alt)))
    if (typeof value !== "string" || !looks.has(value)) problems.push(`props.${name} must be "default", null, or a look its parts have in alt (${list(looks)})`)
  }
  for (const [name, value] of Object.entries(section("z"))) {
    if (!(name in rig.part)) problems.push(`z: no part named ${name}`)
    else if (!isNumber(value)) problems.push(`z.${name} must be a number`)
  }
  return problems
}

// ---------------------------------------------------------------------------
// Decoding a rig module

const DEFAULT_LOOK: Look = { background: "#232838", ground: "#59627e", floor: "#1b1f2b" }

/**
 * Checks a rig module's default export, naming every field that is wrong,
 * and resolves it: the bone order and setup pose, every shape's points in
 * setup-pose world coordinates, which prop each part belongs to, and the
 * stances checked as poses.
 */
export const decodeRig = (module: unknown): Decoded<Rig> => {
  const value = isRecord(module) && "default" in module ? module.default : module
  if (!isRecord(value)) return { ok: false, error: "the rig module must `export default { size, anchor, bones, parts, chains, props, stances }`" }
  const errors: Array<string> = []
  const size = value.size
  const width = Array.isArray(size) ? size[0] : undefined
  const height = Array.isArray(size) ? size[1] : undefined
  const sizeOk = Number.isInteger(width) && Number.isInteger(height) && (width as number) >= 8 && (height as number) >= 8 && (width as number) <= 1024 && (height as number) <= 1024
  if (!sizeOk) errors.push("size must be [width, height], whole pixels from 8 to 1024")
  if (!isPair(value.anchor)) errors.push("anchor must be [x, y]: the pixel the ground under the character sits on")
  if (value.outline !== undefined && !isColor(value.outline)) errors.push("outline must be a #rrggbb color")
  if (value.line !== undefined && (!isNumber(value.line) || value.line < 0)) errors.push("line must be an outline width of 0 or more")
  if (value.facing !== undefined && value.facing !== "right" && value.facing !== "left") errors.push('facing must be "right" or "left"')
  const look: Record<string, string> = { ...DEFAULT_LOOK }
  if (value.look !== undefined && !isRecord(value.look)) errors.push("look must be { background, ground, floor }, each a #rrggbb")
  for (const [name, hex] of Object.entries(isRecord(value.look) ? value.look : {})) {
    if (!(name in DEFAULT_LOOK)) errors.push(`look.${name} is not a field (it takes background, ground, floor)`)
    else if (!isColor(hex)) errors.push(`look.${name} must be a #rrggbb color`)
    else look[name] = hex.toLowerCase()
  }

  // Bones
  const bones: Record<string, Bone> = {}
  if (!isRecord(value.bones) || Object.keys(value.bones).length === 0) errors.push("bones must name at least one bone: { hips: { length: 8 } }")
  for (const [name, spec] of Object.entries(isRecord(value.bones) ? value.bones : {})) {
    if (!isRecord(spec) || !isNumber(spec.length) || spec.length <= 0) {
      errors.push(`bones.${name} needs a length above 0`)
      continue
    }
    for (const field of ["x", "y", "rotation", "scaleX", "scaleY"]) if (spec[field] !== undefined && !isNumber(spec[field])) errors.push(`bones.${name}.${field} must be a number`)
    if (spec.parent !== undefined && (typeof spec.parent !== "string" || !isRecord(value.bones) || !(spec.parent in value.bones))) errors.push(`bones.${name}.parent: no bone named ${String(spec.parent)}`)
    bones[name] = {
      name,
      parent: typeof spec.parent === "string" ? spec.parent : undefined,
      x: isNumber(spec.x) ? spec.x : 0,
      y: isNumber(spec.y) ? spec.y : 0,
      rotation: isNumber(spec.rotation) ? spec.rotation : 0,
      length: spec.length,
      scaleX: isNumber(spec.scaleX) ? spec.scaleX : 1,
      scaleY: isNumber(spec.scaleY) ? spec.scaleY : 1
    }
  }
  const order: Array<string> = []
  const visit = (name: string, path: ReadonlyArray<string>): void => {
    if (order.includes(name)) return
    if (path.includes(name)) {
      errors.push(`bones form a cycle: ${[...path, name].join(" > ")}`)
      return
    }
    const parent = bones[name]?.parent
    if (parent !== undefined && parent in bones) visit(parent, [...path, name])
    if (!order.includes(name)) order.push(name)
  }
  for (const name of Object.keys(bones)) visit(name, [])
  if (errors.length > 0) return { ok: false, error: errors.join("; ") }
  const setup: Record<string, Mat> = {}
  for (const name of order) {
    const bone = bones[name]!
    setup[name] = mul(bone.parent === undefined ? IDENTITY : setup[bone.parent]!, localMat(bone.x, bone.y, bone.rotation, bone.scaleX, bone.scaleY))
  }

  // Parts
  const point = (where: string, own: string, raw: unknown): V | undefined => {
    if (isPair(raw)) return [raw[0], raw[1]]
    if (isRecord(raw)) {
      const bone = raw.bone === undefined ? own : raw.bone
      const fields = ["bone", "along", "across", "dx", "dy"]
      const wrongField = Object.keys(raw).find((k) => !fields.includes(k))
      if (typeof bone === "string" && bone in bones && wrongField === undefined && ["along", "across", "dx", "dy"].every((k) => raw[k] === undefined || isNumber(raw[k]))) {
        const [x, y] = apply(setup[bone]!, [isNumber(raw.along) ? raw.along : 0, isNumber(raw.across) ? raw.across : 0])
        return [x + (isNumber(raw.dx) ? raw.dx : 0), y + (isNumber(raw.dy) ? raw.dy : 0)]
      }
    }
    errors.push(`${where} must be [x, y] (setup-pose world) or { bone, along, across, dx, dy } (on a bone in the setup pose; the part's own bone by default)`)
    return undefined
  }
  const shape = (where: string, own: string, raw: unknown): Shape | undefined => {
    if (!isRecord(raw)) {
      errors.push(`${where} must be a shape: { kind: "capsule" | "ellipse" | "poly" | "sweep", ... }`)
      return undefined
    }
    switch (raw.kind) {
      case "capsule": {
        const length = bones[own]?.length ?? 0
        const a = raw.a === undefined ? apply(setup[own]!, [0, 0]) : point(`${where}.a`, own, raw.a)
        const b = raw.b === undefined ? apply(setup[own]!, [length, 0]) : point(`${where}.b`, own, raw.b)
        if (!isNumber(raw.r) || raw.r <= 0) errors.push(`${where}.r must be a radius above 0`)
        if (raw.r2 !== undefined && (!isNumber(raw.r2) || raw.r2 <= 0)) errors.push(`${where}.r2 must be a radius above 0`)
        if (a === undefined || b === undefined || !isNumber(raw.r)) return undefined
        return { kind: "capsule", a, b, r: raw.r, r2: isNumber(raw.r2) ? raw.r2 : raw.r }
      }
      case "ellipse": {
        const c = point(`${where}.c`, own, raw.c ?? { along: 0 })
        if (!isNumber(raw.rx) || raw.rx <= 0) errors.push(`${where}.rx must be a radius above 0`)
        if (raw.ry !== undefined && (!isNumber(raw.ry) || raw.ry <= 0)) errors.push(`${where}.ry must be a radius above 0 (rx by default: a circle)`)
        if (raw.angle !== undefined && !isNumber(raw.angle)) errors.push(`${where}.angle must be a number`)
        if (c === undefined || !isNumber(raw.rx)) return undefined
        return { kind: "ellipse", c, rx: raw.rx, ry: isNumber(raw.ry) ? raw.ry : raw.rx, angle: isNumber(raw.angle) ? raw.angle : 0 }
      }
      case "poly": {
        if (!Array.isArray(raw.points) || raw.points.length < 3) {
          errors.push(`${where}.points must be at least 3 points`)
          return undefined
        }
        if (raw.round !== undefined && (!isNumber(raw.round) || raw.round < 0)) errors.push(`${where}.round must be 0 or more`)
        const points = raw.points.map((p, i) => point(`${where}.points[${i}]`, own, p))
        if (points.some((p) => p === undefined)) return undefined
        return { kind: "poly", points: points as Array<V>, round: isNumber(raw.round) ? raw.round : 0 }
      }
      case "sweep": {
        if (!isNumber(raw.from) || !isNumber(raw.to) || raw.to <= raw.from || !isNumber(raw.frames) || raw.frames <= 0) {
          errors.push(`${where} must be { kind: "sweep", from, to, frames }: the segment from \`from\` to \`to\` along the bone, swept over the last \`frames\` frames`)
          return undefined
        }
        return { kind: "sweep", from: raw.from, to: raw.to, frames: raw.frames }
      }
      default:
        errors.push(`${where}.kind must be "capsule", "ellipse", "poly", or "sweep"`)
        return undefined
    }
  }
  const outline = isColor(value.outline) ? value.outline.toLowerCase() : "#16121d"
  const line = isNumber(value.line) ? value.line : 1.5
  const parts: Array<Part> = []
  if (!isRecord(value.parts) || Object.keys(value.parts).length === 0) errors.push('parts must name at least one part: { torso: { bone: "torso", z: 0, fill: "#3f7fb8", shape: { kind: "capsule", r: 6 } } }')
  for (const [name, spec] of Object.entries(isRecord(value.parts) ? value.parts : {})) {
    if (!isRecord(spec) || typeof spec.bone !== "string" || !(spec.bone in bones)) {
      errors.push(`parts.${name} needs a bone the rig has (${list(Object.keys(bones))})`)
      continue
    }
    if (!isNumber(spec.z)) errors.push(`parts.${name}.z must be a number: its draw order`)
    if (!isColor(spec.fill)) errors.push(`parts.${name}.fill must be a #rrggbb or #rrggbbaa color`)
    if (spec.outline !== undefined && spec.outline !== null && !isColor(spec.outline)) errors.push(`parts.${name}.outline must be a #rrggbb color, or null for none`)
    if (spec.line !== undefined && (!isNumber(spec.line) || spec.line < 0)) errors.push(`parts.${name}.line must be 0 or more`)
    for (const flag of ["hidden", "far"]) if (spec[flag] !== undefined && typeof spec[flag] !== "boolean") errors.push(`parts.${name}.${flag} must be true or false`)
    const main = shape(`parts.${name}.shape`, spec.bone, spec.shape)
    const alt: Record<string, Shape> = {}
    if (spec.alt !== undefined && !isRecord(spec.alt)) errors.push(`parts.${name}.alt must be { name: shape }`)
    for (const [look, raw] of Object.entries(isRecord(spec.alt) ? spec.alt : {})) {
      if (look === "default") errors.push(`parts.${name}.alt cannot be named "default": that is the part's own shape`)
      const decoded = shape(`parts.${name}.alt.${look}`, spec.bone, raw)
      if (decoded !== undefined) alt[look] = decoded
    }
    if (main === undefined || !isNumber(spec.z) || !isColor(spec.fill)) continue
    parts.push({
      name,
      bone: spec.bone,
      z: spec.z,
      fill: spec.fill.toLowerCase(),
      outline: spec.outline === null ? null : isColor(spec.outline) ? spec.outline.toLowerCase() : outline,
      line: isNumber(spec.line) ? spec.line : line,
      shape: main,
      alt,
      hidden: spec.hidden === true,
      far: spec.far === true,
      prop: undefined
    })
  }

  // Props: each a group of parts, hidden or swapped as one.
  const props: Record<string, ReadonlyArray<string>> = {}
  const propOf = new Map<string, string>()
  if (value.props !== undefined && !isRecord(value.props)) errors.push('props must be { name: ["part", ...] }')
  for (const [name, members] of Object.entries(isRecord(value.props) ? value.props : {})) {
    if (!Array.isArray(members) || members.length === 0 || !members.every((m) => typeof m === "string")) {
      errors.push(`props.${name} must list its parts: ["blade", "grip"]`)
      continue
    }
    for (const member of members) {
      if (!parts.some((part) => part.name === member)) errors.push(`props.${name}: no part named ${member}`)
      else if (propOf.has(member)) errors.push(`props.${name}: ${member} is already in the prop ${propOf.get(member)}; a part belongs to one prop`)
      else propOf.set(member, name)
    }
    props[name] = members
  }

  // Chains
  const chains: Record<string, Chain> = {}
  if (value.chains !== undefined && !isRecord(value.chains)) errors.push("chains must be { name: { upper, lower, end, bend } }")
  for (const [name, spec] of Object.entries(isRecord(value.chains) ? value.chains : {})) {
    if (!isRecord(spec) || typeof spec.upper !== "string" || typeof spec.lower !== "string" || typeof spec.end !== "string" || (spec.bend !== 1 && spec.bend !== -1)) {
      errors.push(`chains.${name} must be { upper, lower, end, bend: 1 | -1, foot? }`)
      continue
    }
    const upper = bones[spec.upper]
    const lower = bones[spec.lower]
    const end = bones[spec.end]
    if (upper === undefined || lower === undefined || end === undefined) {
      errors.push(`chains.${name} names a bone the rig does not have`)
      continue
    }
    if (lower.parent !== upper.name || Math.abs(lower.x - upper.length) > 1e-6 || lower.y !== 0) errors.push(`chains.${name}: ${lower.name} must be a child of ${upper.name} starting at its end (x: ${upper.length}, y: 0)`)
    if (end.parent !== lower.name) errors.push(`chains.${name}: ${end.name} must be a child of ${lower.name}`)
    if (spec.foot !== undefined && typeof spec.foot !== "boolean") errors.push(`chains.${name}.foot must be true or false`)
    chains[name] = { name, upper: upper.name, lower: lower.name, end: end.name, bend: spec.bend, foot: spec.foot === true }
  }
  if (value.back !== undefined && (typeof value.back !== "string" || !(value.back in bones))) errors.push(`back must name a bone (the one the body's back runs along, for the peek check)`)
  if (errors.length > 0) return { ok: false, error: errors.join("; ") }

  const withProps = parts.map((part) => ({ ...part, prop: propOf.get(part.name) }))
  const part: Record<string, Part> = Object.fromEntries(withProps.map((p) => [p.name, p]))
  const partsOf: Record<string, Array<string>> = Object.fromEntries(order.map((name) => [name, []]))
  for (const p of withProps) partsOf[p.bone]!.push(p.name)
  const bind: Record<string, Mat> = Object.fromEntries(withProps.map((p) => [p.name, invert(setup[p.bone]!)]))
  const base = {
    width: width as number,
    height: height as number,
    anchor: value.anchor as V,
    facing: value.facing === "left" ? (-1 as const) : (1 as const),
    back: typeof value.back === "string" ? value.back : undefined,
    look: { background: look.background!, ground: look.ground!, floor: look.floor! },
    bones,
    order,
    setup,
    parts: withProps,
    part,
    partsOf,
    chains,
    props,
    stances: {},
    bind
  } satisfies Rig

  // Stances: named poses, checked against the rig itself.
  const stances: Record<string, Pose> = {}
  if (value.stances !== undefined && !isRecord(value.stances)) errors.push("stances must be { name: pose }")
  for (const [name, pose] of Object.entries(isRecord(value.stances) ? value.stances : {})) {
    const problems = poseProblems(base, pose)
    if (problems.length > 0) errors.push(...problems.map((problem) => `stances.${name}: ${problem}`))
    else stances[name] = pose as Pose
  }
  return errors.length > 0 ? { ok: false, error: errors.join("; ") } : { ok: true, value: { ...base, stances } }
}
