/**
 * Solving a pose: every bone's world transform, parent first. On each bone,
 * in this order, each laid over the one before by its `mix`:
 *
 * 1. its own turn (`bones`), relative to its parent;
 * 2. a reach (`reach`): two-bone IK puts the chain's end on its goal,
 *    bending the middle joint to the chain's `bend` side;
 * 3. an aim (`aim`): the bone's world angle, so "the blade at 245°" or "the
 *    thigh at -40°, the shin hanging" needs no arithmetic over the parents.
 *
 * Then the parts are placed on their bones, in draw order, as the pose's
 * slots and props say.
 */
import { angleOf, apply, IDENTITY, localMat, mul, scaleOf, wrap, type Aim, type BoneOffset, type Goal, type Mat, type Pose, type Rig, type Shape, type V } from "./rig.ts"

const RAD = Math.PI / 180

interface Offset {
  readonly r: number
  readonly x: number
  readonly y: number
  readonly sx: number
  readonly sy: number
}

const offsetOf = (o: BoneOffset | undefined): Offset =>
  typeof o === "number" ? { r: o, x: 0, y: 0, sx: 1, sy: 1 } : { r: o?.r ?? 0, x: o?.x ?? 0, y: o?.y ?? 0, sx: o?.sx ?? 1, sy: o?.sy ?? 1 }

const mixOf = (value: number | undefined): number => Math.min(1, Math.max(0, value ?? 1))

/** An aim's world angle and mix. */
export const aimOf = (aim: Aim): { readonly angle: number; readonly mix: number } => (typeof aim === "number" ? { angle: aim, mix: 1 } : { angle: aim.angle, mix: mixOf(aim.mix) })

/** From angle `a` toward `b` (degrees) by `k`, the short way round. */
const turnToward = (a: number, b: number, k: number): number => a + wrap(b - a) * k

/** The world point a goal asks for, given the bones placed so far; `undefined` when its bone is not placed yet. */
export const goalPoint = (world: Readonly<Record<string, Mat>>, goal: Goal): V | undefined => {
  if (!("bone" in goal)) return [goal.x, goal.y]
  const m = world[goal.bone]
  if (m === undefined) return undefined
  const [x, y] = apply(m, [goal.along ?? 0, goal.across ?? 0])
  return [x + (goal.dx ?? 0), y + (goal.dy ?? 0)]
}

/** Every bone's world transform under a pose. The pose must have passed `poseProblems`. */
export const solve = (rig: Rig, pose: Pose): Record<string, Mat> => {
  const world: Record<string, Mat> = {}
  /** Local rotations set by IK on an earlier bone (the lower bone of a chain whose upper was just solved). */
  const solved = new Map<string, number>()
  const chains = Object.values(rig.chains)
  for (const name of rig.order) {
    const bone = rig.bones[name]!
    const parent = bone.parent === undefined ? IDENTITY : world[bone.parent]!
    const off = offsetOf(pose.bones?.[name])
    const x = bone.x + off.x
    const y = bone.y + off.y
    let rotation = solved.get(name) ?? bone.rotation + off.r
    for (const chain of chains) {
      const goal = pose.reach?.[chain.name]
      if (goal === undefined) continue
      const mix = mixOf(goal.mix)
      if (chain.upper === name) {
        const target = goalPoint(world, goal)
        if (target === undefined) continue
        const lower = rig.bones[chain.lower]!
        const lowerOwn = lower.rotation + offsetOf(pose.bones?.[chain.lower]).r
        const origin = apply(parent, [x, y])
        const l1 = bone.length * bone.scaleX * off.sx * scaleOf(parent)
        const l2 = lower.length * scaleOf(parent)
        const dx = target[0] - origin[0]
        const dy = target[1] - origin[1]
        const dist = Math.min(l1 + l2 - 1e-6, Math.max(Math.abs(l1 - l2) + 1e-6, Math.hypot(dx, dy)))
        const toGoal = Math.atan2(dy, dx) / RAD
        const inner = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)))) / RAD
        const upperWorld = toGoal + chain.bend * inner
        const elbow: V = [origin[0] + l1 * Math.cos(upperWorld * RAD), origin[1] + l1 * Math.sin(upperWorld * RAD)]
        const lowerWorld = Math.atan2(target[1] - elbow[1], target[0] - elbow[0]) / RAD
        rotation = turnToward(rotation, upperWorld - angleOf(parent), mix)
        solved.set(chain.lower, turnToward(lowerOwn, lowerWorld - upperWorld, mix))
      }
      if (chain.end === name) {
        const want =
          goal.angle !== undefined ? goal.angle : "bone" in goal && goal.turn !== undefined && world[goal.bone] !== undefined ? angleOf(world[goal.bone]!) + goal.turn : angleOf(rig.setup[name]!)
        rotation = turnToward(rotation, want - angleOf(parent), mix)
      }
    }
    const aim = pose.aim?.[name]
    if (aim !== undefined) {
      const { angle, mix } = aimOf(aim)
      rotation = turnToward(rotation, angle - angleOf(parent), mix)
    }
    world[name] = mul(parent, localMat(x, y, rotation, bone.scaleX * off.sx, bone.scaleY * off.sy))
  }
  return world
}

/**
 * `over` laid on `base`, for a pose made of layers (an idle's breathing on
 * a stance): bone turns and moves add up and scales multiply; aim angles
 * add up (the over's is a turn of the base's world angle) and its mix, when
 * set, wins; reach goals, slots, props, and draw order in `over` win.
 */
export const add = (base: Pose, over: Pose): Pose => {
  const bones: Record<string, BoneOffset> = { ...base.bones }
  for (const [name, value] of Object.entries(over.bones ?? {})) {
    const a = offsetOf(base.bones?.[name])
    const b = offsetOf(value)
    bones[name] = { r: a.r + b.r, x: a.x + b.x, y: a.y + b.y, sx: a.sx * b.sx, sy: a.sy * b.sy }
  }
  const aim: Record<string, Aim> = { ...base.aim }
  for (const [name, value] of Object.entries(over.aim ?? {})) {
    const under = base.aim?.[name]
    if (under === undefined) {
      aim[name] = value
      continue
    }
    const a = aimOf(under)
    const b = typeof value === "number" ? { angle: value, mix: undefined } : value
    aim[name] = { angle: a.angle + b.angle, mix: b.mix ?? a.mix }
  }
  return { bones, aim, reach: { ...base.reach, ...over.reach }, slots: { ...base.slots, ...over.slots }, props: { ...base.props, ...over.props }, z: { ...base.z, ...over.z } }
}

// ---------------------------------------------------------------------------
// Placing parts

/** A part placed in the world, ready to draw (y up, world units). */
export type Geom =
  | { readonly kind: "capsule"; readonly a: V; readonly b: V; readonly ra: number; readonly rb: number }
  | { readonly kind: "ellipse"; readonly c: V; readonly rx: number; readonly ry: number; readonly angle: number }
  | { readonly kind: "poly"; readonly points: ReadonlyArray<V>; readonly round: number }

export interface Drawn {
  readonly part: string
  readonly bone: string
  readonly z: number
  readonly fill: string
  readonly outline: string | null
  readonly line: number
  readonly far: boolean
  readonly geom: Geom
}

const place = (shape: Exclude<Shape, { kind: "sweep" }>, m: Mat): Geom => {
  switch (shape.kind) {
    case "capsule":
      return { kind: "capsule", a: apply(m, shape.a), b: apply(m, shape.b), ra: shape.r * scaleOf(m), rb: shape.r2 * scaleOf(m) }
    case "ellipse": {
      const angle = shape.angle * RAD
      const linear = { ...m, x: 0, y: 0 }
      const ax = apply(linear, [Math.cos(angle) * shape.rx, Math.sin(angle) * shape.rx])
      const ay = apply(linear, [-Math.sin(angle) * shape.ry, Math.cos(angle) * shape.ry])
      return { kind: "ellipse", c: apply(m, shape.c), rx: Math.hypot(ax[0], ax[1]), ry: Math.hypot(ay[0], ay[1]), angle: Math.atan2(ax[1], ax[0]) / RAD }
    }
    case "poly":
      return { kind: "poly", points: shape.points.map((p) => apply(m, p)), round: shape.round * scaleOf(m) }
  }
}

/** The shape a part shows under a pose, or `undefined` when it is hidden. */
export const shapeShown = (rig: Rig, pose: Pose, name: string): Shape | undefined => {
  const part = rig.part[name]!
  const prop = part.prop === undefined ? undefined : pose.props?.[part.prop]
  if (prop === null) return undefined
  const slot = pose.slots?.[name]
  const shown = slot === undefined ? (part.hidden ? null : "default") : slot
  if (shown === null) return undefined
  if (prop !== undefined && prop !== "default") return part.alt[prop]
  return shown === "default" ? part.shape : part.alt[shown]
}

const SWEEP_STEPS = 10

/**
 * Every shown part placed on its bone, back to front. `earlier(k)` gives the
 * world transforms `k` frames before this one, for smears.
 */
export const drawnOf = (rig: Rig, pose: Pose, world: Readonly<Record<string, Mat>>, earlier: (k: number) => Readonly<Record<string, Mat>>): Array<Drawn> => {
  const drawn: Array<Drawn> = []
  for (const part of rig.parts) {
    const shape = shapeShown(rig, pose, part.name)
    if (shape === undefined) continue
    const base = { part: part.name, bone: part.bone, z: pose.z?.[part.name] ?? part.z, fill: part.fill, outline: part.outline, line: part.line, far: part.far }
    if (shape.kind === "sweep") {
      // The segment's place at earlier moments of the same clip: the smear is exactly the motion.
      const outer: Array<V> = []
      const inner: Array<V> = []
      for (let i = 0; i <= SWEEP_STEPS; i++) {
        const k = i / SWEEP_STEPS
        const m = i === 0 ? world[part.bone]! : earlier(k * shape.frames)[part.bone]!
        outer.push(apply(m, [shape.to, 0]))
        inner.push(apply(m, [shape.from + (shape.to - shape.from) * k * 0.9, 0]))
      }
      drawn.push({ ...base, geom: { kind: "poly", points: [...outer, ...inner.reverse()], round: 0 } })
      continue
    }
    drawn.push({ ...base, geom: place(shape, mul(world[part.bone]!, rig.bind[part.name]!)) })
  }
  // Stable: equal z keeps the order the parts are declared in.
  return drawn.sort((a, b) => a.z - b.z)
}

/** A placed shape's bounds, in world units (y up). */
export const boundsOf = (g: Geom): { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } => {
  if (g.kind === "capsule")
    return { minX: Math.min(g.a[0] - g.ra, g.b[0] - g.rb), maxX: Math.max(g.a[0] + g.ra, g.b[0] + g.rb), minY: Math.min(g.a[1] - g.ra, g.b[1] - g.rb), maxY: Math.max(g.a[1] + g.ra, g.b[1] + g.rb) }
  if (g.kind === "ellipse") {
    const t = g.angle * RAD
    const hx = Math.hypot(g.rx * Math.cos(t), g.ry * Math.sin(t))
    const hy = Math.hypot(g.rx * Math.sin(t), g.ry * Math.cos(t))
    return { minX: g.c[0] - hx, maxX: g.c[0] + hx, minY: g.c[1] - hy, maxY: g.c[1] + hy }
  }
  const xs = g.points.map((p) => p[0])
  const ys = g.points.map((p) => p[1])
  return { minX: Math.min(...xs) - g.round, maxX: Math.max(...xs) + g.round, minY: Math.min(...ys) - g.round, maxY: Math.max(...ys) + g.round }
}
