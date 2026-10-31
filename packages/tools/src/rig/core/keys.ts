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
 * after the arm. A number holds its first value before its first key and
 * its last after its last, so a stance keyed on frame 0 should set every
 * bone the later keys move. Slots, props, and draw order are the rig's own
 * until a key sets them, and then hold until the next key that does; a
 * goal's bone steps like them.
 *
 * Mistakes that would key the wrong motion are errors (`KeysError`), each
 * naming the frame and channel: two keys on one frame for one channel, a
 * key past the clip's frames, an aim or reach that would hold back over a
 * bone's own turns from frame 0 (key its `mix: 0` there), and turns an aim
 * or reach always wins over (they would never show).
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

/**
 * A channel's value can only start later than a bone's own turns when it
 * is mixed in from 0: an aim or reach holds its first value back to frame
 * 0, where it would win over the turns. `bones` maps each aim or reach
 * channel prefix (`aim.sword`, `reach.armFar`) to the bones it moves.
 */
const holdBack = (channels: Map<string, Array<Point>>, owner: string, moved: ReadonlyArray<string>): void => {
  const first = (id: string): number | undefined => channels.get(id)?.[0]?.at
  const starts = [...channels.keys()].filter((id) => id === owner || id.startsWith(`${owner}.`)).map(first).filter((at): at is number => at !== undefined)
  if (starts.length === 0) return
  const start = Math.min(...starts)
  for (const bone of moved) {
    const turned = first(`bones.${bone}`)
    if (turned === undefined || turned >= start) continue
    const mix = first(`${owner}.mix`)
    if (mix !== undefined && mix <= turned) continue
    throw new KeysError(
      `${owner} starts on frame ${start}, but bones.${bone} is keyed from frame ${turned}: ${owner} holds its first value back to frame ${turned} and wins over the turn there; add mix 0 to ${owner} on frame ${turned} (and mix 1 where it takes over)`
    )
  }
}

/** A bone's turns under an aim or reach that never mixes out are never seen: an error, so the agent does not tune dead keys. */
const overruled = (channels: Map<string, Array<Point>>, owner: string, moved: ReadonlyArray<string>): void => {
  if (channels.has(`${owner}.mix`)) return
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

/** Which bones each chain moves, for the hold-back guard. */
export interface ChainBones {
  readonly [chain: string]: ReadonlyArray<string>
}

/**
 * The pose a key list gives on `frame` (fractional between frames). `last`
 * is the clip's last frame a key may be on (its frame count for a loop,
 * which may key the frame it wraps to). Throws `KeysError` on a list that
 * would key the wrong motion; the clip runner reports it with the clip's
 * name. Clips call it as `rig.keys(list)`, the one keyframe helper; for a
 * pose made of layers, use `rig.add`.
 */
export const keysAt = (list: unknown, frame: number, last: number, chains: ChainBones): Pose => {
  const channels = channelsOf(list, last)
  const aimed = new Set([...channels.keys()].filter((id) => id.startsWith("aim.")).map((id) => id.split(".")[1]!))
  for (const bone of aimed) {
    holdBack(channels, `aim.${bone}`, [bone])
    overruled(channels, `aim.${bone}`, [bone])
  }
  const reached = new Set([...channels.keys()].filter((id) => id.startsWith("reach.")).map((id) => id.split(".")[1]!))
  for (const chain of reached) {
    const moved = chains[chain] ?? []
    holdBack(channels, `reach.${chain}`, moved)
    // The end bone keeps its own turn unless the goal says an angle, so only the two bones IK always sets are overruled.
    overruled(channels, `reach.${chain}`, moved.slice(0, 2))
  }
  const bones: Record<string, Record<string, Value>> = {}
  const aim: Record<string, Record<string, Value>> = {}
  const reach: Record<string, Record<string, Value>> = {}
  const slots: Record<string, Value> = {}
  const props: Record<string, Value> = {}
  const z: Record<string, Value> = {}
  for (const [id, points] of channels) {
    const [kind, name, field] = id.split(".") as [string, string, string | undefined]
    // A slot, prop, or draw order before its first key is the rig's own: the smear a key shows on frame 8 is not there on frame 0.
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
