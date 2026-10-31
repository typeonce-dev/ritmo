/**
 * Keyframes: the one way to key a clip. A key is a pose on a frame, with
 * how it moves to the next key (`curve`) and whether the motion comes to
 * rest on it (`rest`):
 *
 *   pose(rig) {
 *     return rig.keys([
 *       { at: 0, ...rig.stances.ready },
 *       { at: 6, rest: true, aim: { sword: 190 }, bones: { torso: 12 } },
 *       { at: 8, curve: "linear", aim: { sword: 100 } },
 *       { at: 12, ...rig.stances.ready }
 *     ])
 *   }
 *
 * Every value a key sets is its own timeline, a channel (`bones.torso`,
 * `aim.sword`, `reach.legFar.x`, `slots.smear`), made of the keys that set
 * it: a key may move a few bones only, and the sword can arrive a frame
 * after the arm. Every channel starts on frame 0 from the clip's stance (or
 * the setup pose, for a clip with none) and holds its last key's value
 * after it; an aim or reach the stance does not have mixes in from 0 on
 * frame 0. Slots, props, draw order, and a goal's bone step: they hold
 * until the next key that sets them.
 *
 * Mistakes that would key the wrong motion are errors (`KeysError`), each
 * naming the frame and channel: two keys on one frame for one channel, a
 * key past the clip's frames, and turns an aim or reach always wins over
 * (they would never show).
 */
import type { Pose } from "./rig.ts"

/**
 * How a key moves to the next one: `smooth` flows through the keys on either
 * side (Catmull-Rom; at rest on a channel's first and last key and on a key
 * marked `rest`), cubic ease `in` (speeds up), `out` (slows down), `linear`
 * (constant speed: a swing's frames), or `stepped` (holds, then jumps).
 */
export type Curve = "smooth" | "linear" | "stepped" | "in" | "out"
/** Every curve a key takes. */
export const curves: ReadonlyArray<Curve> = ["smooth", "linear", "stepped", "in", "out"]

/** A pose on a frame: what `rig.keys` takes. */
export type Key = Pose & {
  /** The frame this key is on, from 0. */
  readonly at: number
  /** How this key moves to the next (the curve belongs to the key a segment leaves). Default `smooth`. */
  readonly curve?: Curve | undefined
  /** The motion comes to rest on this key (an extreme, a hold): smooth segments ease into and out of it. */
  readonly rest?: boolean | undefined
}

/** A key list that would key the wrong motion: the message names the frame and channel, and the fix. */
export class KeysError extends Error {
  override readonly name = "KeysError"
}

type Value = number | string | null
interface Point {
  readonly at: number
  readonly curve: Curve
  readonly rest: boolean
  readonly value: Value
}

const ease: Record<Exclude<Curve, "smooth">, (u: number) => number> = {
  linear: (u) => u,
  stepped: () => 0,
  in: (u) => u ** 3,
  out: (u) => 1 - (1 - u) ** 3
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The channels a key list sets, each its keys in frame order; throws `KeysError` on a list that would key the wrong motion. */
const channelsOf = (list: unknown, last: number): Map<string, Array<Point>> => {
  if (!Array.isArray(list) || list.length === 0) throw new KeysError("rig.keys takes a list of keys: [{ at: 0, ...pose }, ...]")
  const channels = new Map<string, Array<Point>>()
  const keys = list.map((key: unknown, i) => {
    if (!isRecord(key) || typeof key.at !== "number" || !Number.isFinite(key.at)) throw new KeysError(`key ${i} needs a frame: { at: 0, ... }`)
    if (key.at < 0 || key.at > last) throw new KeysError(`a key on frame ${key.at} is outside the clip's frames (0 to ${last})`)
    if (key.curve !== undefined && !curves.includes(key.curve as Curve)) throw new KeysError(`the key on frame ${key.at} has curve ${String(key.curve)}; it takes ${curves.join(", ")}`)
    return key
  })
  const sorted = [...keys].sort((a, b) => (a.at as number) - (b.at as number))
  for (const key of sorted) {
    const at = key.at as number
    const curve = (key.curve as Curve | undefined) ?? "smooth"
    const rest = key.rest === true
    const push = (id: string, value: Value, stepped = false): void => {
      const points = channels.get(id) ?? []
      if (points.some((point) => point.at === at)) throw new KeysError(`two keys on frame ${at} set ${id}: merge them into one key`)
      points.push({ at, curve: stepped ? "stepped" : curve, rest, value })
      channels.set(id, points)
    }
    const section = (name: string): Record<string, unknown> => (isRecord(key[name]) ? key[name] : {})
    for (const [bone, offset] of Object.entries(section("bones"))) {
      if (typeof offset === "number") push(`bones.${bone}`, offset)
      else if (isRecord(offset)) for (const [field, v] of Object.entries(offset)) push(field === "r" ? `bones.${bone}` : `bones.${bone}.${field}`, v as Value)
      else push(`bones.${bone}`, offset as Value)
    }
    for (const [bone, aim] of Object.entries(section("aim"))) {
      if (typeof aim === "number") push(`aim.${bone}`, aim)
      else if (isRecord(aim)) for (const [field, v] of Object.entries(aim)) push(field === "angle" ? `aim.${bone}` : `aim.${bone}.${field}`, v as Value)
      else push(`aim.${bone}`, aim as Value)
    }
    for (const [chain, goal] of Object.entries(section("reach"))) {
      if (!isRecord(goal)) push(`reach.${chain}.x`, goal as Value)
      else for (const [field, v] of Object.entries(goal)) push(`reach.${chain}.${field}`, v as Value, field === "bone")
    }
    for (const [part, v] of Object.entries(section("slots"))) push(`slots.${part}`, v as Value, true)
    for (const [prop, v] of Object.entries(section("props"))) push(`props.${prop}`, v as Value, true)
    for (const [part, v] of Object.entries(section("z"))) push(`z.${part}`, v as Value, true)
  }
  return channels
}

/** A pose as channels, the way keys write them: what a clip's channels start from on frame 0. */
const channelsOfPose = (pose: Pose): Map<string, Value> => {
  const values = new Map<string, Value>()
  for (const [bone, offset] of Object.entries(pose.bones ?? {})) {
    if (typeof offset === "number") values.set(`bones.${bone}`, offset)
    else for (const [field, v] of Object.entries(offset)) if (v !== undefined) values.set(field === "r" ? `bones.${bone}` : `bones.${bone}.${field}`, v)
  }
  for (const [bone, aim] of Object.entries(pose.aim ?? {})) {
    if (typeof aim === "number") values.set(`aim.${bone}`, aim)
    else {
      values.set(`aim.${bone}`, aim.angle)
      if (aim.mix !== undefined) values.set(`aim.${bone}.mix`, aim.mix)
    }
  }
  for (const [chain, goal] of Object.entries(pose.reach ?? {})) for (const [field, v] of Object.entries(goal)) if (v !== undefined) values.set(`reach.${chain}.${field}`, v)
  for (const [part, v] of Object.entries(pose.slots ?? {})) values.set(`slots.${part}`, v)
  for (const [prop, v] of Object.entries(pose.props ?? {})) values.set(`props.${prop}`, v)
  for (const [part, v] of Object.entries(pose.z ?? {})) values.set(`z.${part}`, v)
  return values
}

/** A bone's turns under an aim or reach that is at mix 1 on every frame are never seen: an error, so the agent does not tune dead keys. */
const overruled = (channels: Map<string, Array<Point>>, owner: string, active: boolean, moved: ReadonlyArray<string>): void => {
  if (!active || channels.has(`${owner}.mix`)) return
  for (const bone of moved)
    if (channels.has(`bones.${bone}`))
      throw new KeysError(`bones.${bone} is keyed, but ${owner} (mix 1 on every frame) wins over it, so the turns never show: drop them, or key ${owner}'s mix (0 where the turns should rule)`)
}

const sample = (points: ReadonlyArray<Point>, f: number): Value => {
  const first = points[0]!
  if (f <= first.at) return first.value
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    if (f >= b.at) continue
    if (typeof a.value !== "number" || typeof b.value !== "number") return a.value
    const u = (f - a.at) / (b.at - a.at)
    if (a.curve !== "smooth") return a.value + (b.value - a.value) * ease[a.curve](u)
    // Cubic Hermite with Catmull-Rom tangents; at rest on the channel's ends and on rest keys.
    const before = points[i - 1]
    const after = points[i + 2]
    const h = b.at - a.at
    const ma = !a.rest && before !== undefined && typeof before.value === "number" ? ((b.value - before.value) / (b.at - before.at)) * h : 0
    const mb = !b.rest && after !== undefined && typeof after.value === "number" ? ((after.value - a.value) / (after.at - a.at)) * h : 0
    const u2 = u * u
    const u3 = u2 * u
    return (2 * u3 - 3 * u2 + 1) * a.value + (u3 - 2 * u2 + u) * ma + (-2 * u3 + 3 * u2) * b.value + (u3 - u2) * mb
  }
  return points[points.length - 1]!.value
}

/** Which bones each chain moves, for the overruled-turns guard. */
export interface ChainBones {
  readonly [chain: string]: ReadonlyArray<string>
}

/** A channel's first point is on frame 0: `value` there, unless a key already is. */
const startAt = (points: Array<Point>, value: Value): void => {
  if (points[0]!.at > 0) points.unshift({ at: 0, curve: "smooth", rest: false, value })
}

/**
 * The pose a key list gives on `frame` (fractional between frames), laid
 * over `base`: the clip's stance, or the setup pose (`{}`) for a clip with
 * none. Every channel starts from the base on frame 0: a bone's turn or
 * move from the base's (or the setup pose's 0, and scale 1); an aim or a
 * reach from the base's, or, when the base has none, mixed in from 0 on
 * frame 0 to its keys; a slot, prop, or draw order is the base's (or the
 * rig's own) until a key sets it. So a clip keyed from its stance is the
 * stance until its keys change it, and its first key need not repeat it.
 *
 * `last` is the clip's last frame a key may be on (its frame count for a
 * loop, which may key the frame it wraps to). Throws `KeysError` on a list
 * that would key the wrong motion; the clip runner reports it with the
 * clip's name. Clips call it as `rig.keys(list)`, the one keyframe helper;
 * for a pose made of layers, use `rig.add`.
 */
export const keysAt = (list: unknown, frame: number, last: number, chains: ChainBones, base: Pose = {}): Pose => {
  const channels = channelsOf(list, last)
  const baseValues = channelsOfPose(base)
  const ownerOf = (id: string): string | undefined => (id.startsWith("aim.") || id.startsWith("reach.") ? id.split(".").slice(0, 2).join(".") : undefined)
  const owners = new Set([...channels.keys()].flatMap((id) => ownerOf(id) ?? []))
  // A reach keyed in another form than the base's (a goal on a bone over a world point) cannot blend from it: it mixes in as if the base had none.
  const formless = new Set<string>()
  for (const chain of Object.keys(base.reach ?? {})) {
    const keyedBone = channels.has(`reach.${chain}.bone`)
    const keyedWorld = channels.has(`reach.${chain}.x`) || channels.has(`reach.${chain}.y`)
    if ((keyedBone || keyedWorld) && keyedBone !== "bone" in base.reach![chain]!) formless.add(chain)
  }
  const inBase = (owner: string): boolean => {
    const [kind, name] = owner.split(".") as [string, string]
    return kind === "aim" ? base.aim?.[name] !== undefined : base.reach?.[name] !== undefined && !formless.has(name)
  }
  for (const owner of owners) {
    const ids = [...channels.keys()].filter((id) => ownerOf(id) === owner)
    const start = Math.min(...ids.map((id) => channels.get(id)![0]!.at))
    if (inBase(owner)) {
      // From the base's angle or goal, and its mix (1 unless it says).
      for (const id of ids) {
        const value = baseValues.get(id) ?? (id === `${owner}.mix` ? 1 : undefined)
        if (value !== undefined) startAt(channels.get(id)!, value)
      }
    } else if (start > 0) {
      // None in the base: mixed in from 0 on frame 0 to 1 on its first key, unless its mix is keyed.
      const mix = channels.get(`${owner}.mix`)
      if (mix === undefined) channels.set(`${owner}.mix`, [{ at: 0, curve: "smooth", rest: false, value: 0 }, { at: start, curve: "smooth", rest: false, value: 1 }])
      else startAt(mix, 0)
    }
  }
  for (const [id, points] of channels) {
    if (!id.startsWith("bones.")) continue
    const field = id.split(".")[2]
    startAt(points, baseValues.get(id) ?? (field === "sx" || field === "sy" ? 1 : 0))
  }
  // Dead turns: under an aim or reach at mix 1 on every frame, from the keys or from the base.
  for (const bone of new Set([...owners].filter((o) => o.startsWith("aim.")).map((o) => o.split(".")[1]!).concat(Object.keys(base.aim ?? {})))) {
    const fromBase = base.aim?.[bone]
    const active = channels.has(`aim.${bone}`) ? channels.get(`aim.${bone}`)![0]!.at === 0 : fromBase !== undefined && (typeof fromBase === "number" || (fromBase.mix ?? 1) === 1)
    overruled(channels, `aim.${bone}`, active, [bone])
  }
  for (const chain of new Set([...owners].filter((o) => o.startsWith("reach.")).map((o) => o.split(".")[1]!).concat(Object.keys(base.reach ?? {})))) {
    const fromBase = base.reach?.[chain]
    const keyed = [...channels.keys()].filter((id) => ownerOf(id) === `reach.${chain}`)
    const active = keyed.length > 0 ? keyed.some((id) => channels.get(id)![0]!.at === 0) : fromBase !== undefined && (fromBase.mix ?? 1) === 1
    // The end bone keeps its own turn unless the goal says an angle, so only the two bones IK always sets are overruled.
    overruled(channels, `reach.${chain}`, active, (chains[chain] ?? []).slice(0, 2))
  }

  // The base, with every channel laid over it.
  const bones: Record<string, Record<string, Value | undefined>> = {}
  for (const [bone, offset] of Object.entries(base.bones ?? {})) bones[bone] = typeof offset === "number" ? { r: offset } : { ...offset }
  const aim: Record<string, Record<string, Value | undefined>> = {}
  for (const [bone, value] of Object.entries(base.aim ?? {})) aim[bone] = typeof value === "number" ? { angle: value } : { ...value }
  const reach: Record<string, Record<string, Value | undefined>> = {}
  for (const [chain, goal] of Object.entries(base.reach ?? {})) if (!formless.has(chain)) reach[chain] = { ...goal }
  const slots: Record<string, Value> = { ...base.slots }
  const props: Record<string, Value> = { ...base.props }
  const z: Record<string, Value> = { ...base.z }
  for (const [id, points] of channels) {
    const [kind, name, field] = id.split(".") as [string, string, string | undefined]
    // A slot, prop, or draw order before its first key is the base's, or the rig's own.
    if ((kind === "slots" || kind === "props" || kind === "z") && frame < points[0]!.at) continue
    const v = sample(points, frame)
    if (kind === "bones") (bones[name] ??= {})[field ?? "r"] = v
    else if (kind === "aim") (aim[name] ??= {})[field ?? "angle"] = v
    else if (kind === "reach") (reach[name] ??= {})[field!] = v
    else if (kind === "slots") slots[name] = v
    else if (kind === "props") props[name] = v
    else z[name] = v
  }
  // The pose is checked by the runner like any other (names, numbers): the key list's values went in as they were written.
  return { bones, aim, reach, slots, props, z } as Pose
}
