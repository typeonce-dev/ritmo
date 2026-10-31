/**
 * A clip as code: a module the agent writes, whose default export says the
 * clip's frames, speed, and tunable params, and poses the rig on each frame:
 *
 *   export default {
 *     label: "overhead chop",
 *     frames: 26, fps: 24, loop: false,
 *     stance: "ready", // starts (and, playing once, ends) on the rig's stance
 *     params: { lean: { min: 10, max: 40, value: 28 } },
 *     phases: [{ name: "swing", from: 12, to: 14, fast: true }],
 *     trail: "sword",
 *     pose(rig, t, p) {
 *       return rig.keys([{ at: 0, ...rig.stances.ready }, { at: 14, bones: { torso: -p.lean } }, { at: 25, ...rig.stances.ready }])
 *     }
 *   }
 *
 * `pose(rig, t, p)` runs once per frame, from nothing, like an effect's
 * `draw(fx)`: a clip is a function of time. `rig` is what the pose gets
 * (`rig.keys`, the one keyframe helper; `rig.add`, `rig.stances`, seeded
 * `rig.random`); `t` is how far through the clip the frame is; `p` the
 * params, tuned. Clip modules may import each other and the rig module
 * (shared stances and constants), and nothing else.
 */
import { add } from "./pose.ts"
import { keysAt, KeysError } from "./keys.ts"
import { drawnOf, solve, type Drawn } from "./pose.ts"
import { poseProblems, type Decoded, type Mat, type Pose, type Rig } from "./rig.ts"
import type { Key } from "./keys.ts"

/** A param the person tunes with a slider; `value` is the clip's own. */
export interface Param {
  readonly min: number
  readonly max: number
  readonly value: number
  readonly step?: number | undefined
}

/** A span of frames (both ends included) with a name the checks and the person read; `fast` frames are exempt from the jerk check (a deliberate snap). */
export interface Phase {
  readonly name: string
  readonly from: number
  readonly to: number
  readonly fast: boolean
}

/** The easing curves `rig.ease` offers, each from 0 to 1. */
export interface Ease {
  readonly in: (t: number) => number
  readonly out: (t: number) => number
  readonly inOut: (t: number) => number
}

/** What `pose` gets as its first argument. */
export interface RigContext {
  /** This frame's number, from 0; fractional while a smear samples between frames. */
  readonly frame: number
  readonly frames: number
  /** The pose a key list gives on this frame: the one keyframe helper. */
  readonly keys: (list: ReadonlyArray<Key>) => Pose
  /** `over` laid on `base`: turns, moves, and aim angles add up; goals, slots, props, and draw order in `over` win. */
  readonly add: (base: Pose, over: Pose) => Pose
  /** The rig's stances by name. */
  readonly stances: Readonly<Record<string, Pose>>
  /** A bone's length in the setup pose. */
  readonly length: (bone: string) => number
  /** A number from 0 to 1, from the draft's seed; the n-th call gives the same number on every frame. */
  readonly random: () => number
  /** A number from `min` to `max`, from `random`. */
  readonly range: (min: number, max: number) => number
  readonly ease: Ease
  readonly lerp: (a: number, b: number, t: number) => number
  readonly clamp: (v: number, min: number, max: number) => number
}

/** What a clip's module exports, checked. */
export interface Clip {
  readonly label: string
  readonly frames: number
  readonly fps: number
  /** Plays again from the start (an idle, a walk); otherwise once (an attack). */
  readonly loop: boolean
  /** The rig's stance it starts on (and, playing once, ends on), so the game can blend between clips. */
  readonly stance: string | undefined
  readonly params: Readonly<Record<string, Param>>
  /** How fast the game moves the character while the clip plays, in pixels per second (a walk's speed). Planted feet move back at this speed. */
  readonly travel: number
  readonly phases: ReadonlyArray<Phase>
  /** Frame spans (both ends included) where each foot chain is planted; every frame when a foot chain is not listed. */
  readonly contacts: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>>
  /** A bone whose tip the checks measure for speed and arc (a sword, a fist). */
  readonly trail: string | undefined
  readonly pose: (rig: RigContext, t: number, p: Readonly<Record<string, number>>) => unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const isSpan = (value: unknown, frames: number): value is readonly [number, number] =>
  Array.isArray(value) && value.length === 2 && value.every((v) => Number.isInteger(v)) && value[0] >= 0 && value[0] <= value[1] && value[1] < frames

/** Checks a clip module's default export against its rig, naming every field that is wrong. */
export const decodeClip = (module: unknown, rig: Rig): Decoded<Clip> => {
  const value = isRecord(module) && "default" in module ? module.default : module
  if (!isRecord(value)) return { ok: false, error: "the clip module must `export default { frames, fps, loop, pose(rig, t, p) { ... } }`" }
  const errors: Array<string> = []
  const frames = value.frames
  const framesOk = Number.isInteger(frames) && (frames as number) >= 1 && (frames as number) <= 240
  if (!framesOk) errors.push("frames must be a whole number from 1 to 240")
  const n = framesOk ? (frames as number) : 1
  if (!isNumber(value.fps) || value.fps < 1 || value.fps > 60) errors.push("fps must be from 1 to 60")
  if (value.loop !== undefined && typeof value.loop !== "boolean") errors.push("loop must be true or false")
  if (typeof value.pose !== "function") errors.push("pose must be a function: pose(rig, t, p) { return rig.keys([...]) }")
  if (value.label !== undefined && typeof value.label !== "string") errors.push("label must be a string")
  if (value.stance !== undefined && (typeof value.stance !== "string" || !(value.stance in rig.stances)))
    errors.push(`stance must name one of the rig's stances (${Object.keys(rig.stances).join(", ") || "it has none"})`)
  if (value.travel !== undefined && (!isNumber(value.travel) || value.travel < 0)) errors.push("travel must be a speed of 0 or more, in pixels per second")
  if (value.trail !== undefined && (typeof value.trail !== "string" || !(value.trail in rig.bones))) errors.push(`trail must name a bone (the rig has ${Object.keys(rig.bones).join(", ")})`)
  const params: Record<string, Param> = {}
  if (value.params !== undefined && !isRecord(value.params)) errors.push("params must be an object of { min, max, value }")
  for (const [name, param] of Object.entries(isRecord(value.params) ? value.params : {})) {
    if (!isRecord(param) || !isNumber(param.min) || !isNumber(param.max) || !isNumber(param.value) || param.min >= param.max) {
      errors.push(`params.${name} must be { min, max, value } with min below max`)
      continue
    }
    if (param.value < param.min || param.value > param.max) errors.push(`params.${name}.value must be from ${param.min} to ${param.max}`)
    if (param.step !== undefined && (!isNumber(param.step) || param.step <= 0)) errors.push(`params.${name}.step must be above 0`)
    params[name] = { min: param.min, max: param.max, value: param.value, step: isNumber(param.step) ? param.step : undefined }
  }
  const phases: Array<Phase> = []
  if (value.phases !== undefined && !Array.isArray(value.phases)) errors.push("phases must be a list of { name, from, to, fast? }")
  for (const [i, phase] of (Array.isArray(value.phases) ? value.phases : []).entries()) {
    if (!isRecord(phase) || typeof phase.name !== "string" || phase.name === "" || !isSpan([phase.from, phase.to], n) || (phase.fast !== undefined && typeof phase.fast !== "boolean")) {
      errors.push(`phases[${i}] must be { name, from, to, fast? }, whole frames with from <= to inside the clip (0 to ${n - 1})`)
      continue
    }
    phases.push({ name: phase.name, from: phase.from as number, to: phase.to as number, fast: phase.fast === true })
  }
  const sorted = [...phases].sort((a, b) => a.from - b.from)
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.from <= sorted[i - 1]!.to) errors.push(`phases ${sorted[i - 1]!.name} and ${sorted[i]!.name} overlap: a frame is in one phase at most`)
  const contacts: Record<string, ReadonlyArray<readonly [number, number]>> = {}
  if (value.contacts !== undefined && !isRecord(value.contacts)) errors.push("contacts must be { chain: [[from, to], ...] }")
  for (const [chain, spans] of Object.entries(isRecord(value.contacts) ? value.contacts : {})) {
    if (rig.chains[chain]?.foot !== true) {
      errors.push(`contacts.${chain}: no foot chain named ${chain} (the rig's foot chains: ${Object.values(rig.chains).filter((c) => c.foot).map((c) => c.name).join(", ") || "none"})`)
      continue
    }
    if (!Array.isArray(spans) || !spans.every((span) => isSpan(span, n))) {
      errors.push(`contacts.${chain} must be [[from, to], ...]: whole frames inside the clip (0 to ${n - 1})`)
      continue
    }
    contacts[chain] = spans
  }
  if (errors.length > 0) return { ok: false, error: errors.join("; ") }
  return {
    ok: true,
    value: {
      label: typeof value.label === "string" ? value.label : "",
      frames: n,
      fps: value.fps as number,
      loop: value.loop === true,
      stance: typeof value.stance === "string" ? value.stance : undefined,
      params,
      travel: isNumber(value.travel) ? value.travel : 0,
      phases,
      contacts,
      trail: typeof value.trail === "string" ? value.trail : undefined,
      pose: value.pose as Clip["pose"]
    }
  }
}

/** The params with a tune laid over them, each kept in its range; names the clip does not have are ignored. */
export const tuned = (clip: Clip, tune: Readonly<Record<string, number>> = {}): Record<string, number> => {
  const values: Record<string, number> = {}
  for (const [name, param] of Object.entries(clip.params)) {
    const value = tune[name]
    values[name] = value === undefined ? param.value : Math.min(param.max, Math.max(param.min, value))
  }
  return values
}

/** The phase a frame is in, or `undefined`. */
export const phaseAt = (clip: Clip, frame: number): Phase | undefined => clip.phases.find((phase) => frame >= phase.from && frame <= phase.to)

/** How far through the clip a frame is: 0 on the first, 1 on the last (a loop never reaches 1). */
export const timeAt = (clip: Clip, frame: number): number => (clip.loop ? frame / clip.frames : clip.frames === 1 ? 0 : frame / (clip.frames - 1))

/** splitmix32: each number a strong hash of a counter, as the effects lab draws them. */
const mix = (value: number): number => {
  let z = value >>> 0
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad)
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97)
  return (z ^ (z >>> 15)) >>> 0
}
const generator = (seed: number): (() => number) => {
  let state = mix(seed ^ 0x5bd1e995)
  return () => {
    state = (state + 0x9e3779b9) >>> 0
    return mix(state) / 4294967296
  }
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))
const ease: Ease = {
  in: (t) => clamp(t, 0, 1) ** 3,
  out: (t) => 1 - (1 - clamp(t, 0, 1)) ** 3,
  inOut: (t) => {
    const x = clamp(t, 0, 1)
    return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2
  }
}

/** One frame of a clip: its pose, bone transforms, the parts in draw order, and which bones show. */
export interface Frame {
  readonly frame: number
  readonly pose: Pose
  readonly world: Readonly<Record<string, Mat>>
  /** Back to front. */
  readonly drawn: ReadonlyArray<Drawn>
  /** Bones that show on this frame: a bone with parts, none drawn (a hidden prop), is exempt from every check. */
  readonly shown: ReadonlySet<string>
}

/** What went wrong while posing: `keys` a key list that keys the wrong motion, `pose` a pose that throws or names what the rig does not have. */
export interface RunError {
  readonly code: "keys" | "pose"
  readonly message: string
}

/** Every frame a clip posed. */
export interface Run {
  readonly frames: ReadonlyArray<Frame>
  readonly params: Readonly<Record<string, number>>
  /** Each problem once, with the frames it is on. */
  readonly errors: ReadonlyArray<RunError>
}

/** What the bank gives a draft's run: its seed, and the person's tune of its params. */
export interface RunOptions {
  readonly seed?: number | undefined
  readonly tune?: Readonly<Record<string, number>> | undefined
}

/** The bones a frame shows: every bone with no parts, and every bone with a part drawn. */
const shownBones = (rig: Rig, drawn: ReadonlyArray<Drawn>): Set<string> => {
  const shown = new Set(drawn.map((d) => d.bone))
  for (const name of rig.order) if (rig.partsOf[name]!.length === 0) shown.add(name)
  return shown
}

const spans = (frames: ReadonlyArray<number>): string => {
  const parts: Array<string> = []
  let start = frames[0]
  let last = frames[0]
  for (const f of [...frames.slice(1), undefined]) {
    if (f !== undefined && last !== undefined && f === last + 1) {
      last = f
      continue
    }
    if (start !== undefined) parts.push(start === last ? `${start}` : `${start}-${last}`)
    start = f
    last = f
  }
  return parts.join(", ")
}

/** Poses every frame of a clip on a rig. Never throws: what goes wrong is in `errors`, and that frame shows the setup pose. To measure the motion too, use `checkClip`. */
export const runClip = (rig: Rig, clip: Clip, options: RunOptions = {}): Run => {
  const p = tuned(clip, options.tune)
  const seed = options.seed ?? 1
  const last = clip.loop ? clip.frames : clip.frames - 1
  const chainBones = Object.fromEntries(Object.values(rig.chains).map((chain) => [chain.name, [chain.upper, chain.lower, chain.end]]))
  const problems = new Map<string, { code: RunError["code"]; frames: Array<number> }>()
  const report = (code: RunError["code"], message: string, frame: number): void => {
    const known = problems.get(message) ?? { code, frames: [] }
    if (!known.frames.includes(frame)) known.frames.push(frame)
    problems.set(message, known)
  }
  /** The clip's pose at a frame (fractional for smears), checked; `undefined` when it fails. */
  const poseAt = (frame: number, at: number): Pose | undefined => {
    const wrapped = clip.loop ? ((frame % clip.frames) + clip.frames) % clip.frames : Math.min(clip.frames - 1, Math.max(0, frame))
    const random = generator(seed)
    const context: RigContext = {
      frame: wrapped,
      frames: clip.frames,
      keys: (list) => keysAt(list, wrapped, last, chainBones),
      add,
      stances: rig.stances,
      length: (bone) => rig.bones[bone]?.length ?? Number.NaN,
      random,
      range: (min, max) => min + random() * (max - min),
      ease,
      lerp: (a, b, t) => a + (b - a) * t,
      clamp
    }
    let pose: unknown
    try {
      pose = clip.pose(context, timeAt(clip, wrapped), p)
    } catch (error) {
      if (error instanceof KeysError) report("keys", error.message, at)
      else report("pose", `pose threw: ${error instanceof Error ? error.message : String(error)}`, at)
      return undefined
    }
    const wrong = poseProblems(rig, pose)
    for (const problem of wrong) report("pose", problem, at)
    return wrong.length === 0 ? (pose as Pose) : undefined
  }
  const frames: Array<Frame> = []
  for (let f = 0; f < clip.frames; f++) {
    const pose = poseAt(f, f) ?? {}
    const world = solve(rig, pose)
    const drawn = drawnOf(rig, pose, world, (k) => solve(rig, poseAt(f - k, f) ?? {}))
    frames.push({ frame: f, pose, world, drawn, shown: shownBones(rig, drawn) })
  }
  const errors = [...problems].map(([message, { code, frames: on }]): RunError => ({ code, message: on.length === clip.frames ? message : `${message} (frame${on.length === 1 ? "" : "s"} ${spans(on)})` }))
  return { frames, params: p, errors }
}
