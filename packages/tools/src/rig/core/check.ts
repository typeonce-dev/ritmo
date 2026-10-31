/**
 * Measuring a clip for what an agent cannot see by reading its code: parts
 * cut off by the frame or under the floor, feet that slide or float while
 * planted, limbs that cannot reach their goal, joints that never bend or
 * bend the wrong way, sudden changes of speed, loops that jump, parts that
 * change draw order or peek out behind the back, a start or end off the
 * stance it names, and whether it poses the same every time. Each issue
 * names its frames and the bones or parts; the numbers to judge timing by
 * come with it (each joint's bend, the trail bone's spacing, speed, and
 * arc, and the world positions of the bones asked for).
 *
 * Bones whose parts are all hidden on a frame (a put-away prop) are exempt
 * from every check on that frame, and from the trail.
 */
import { partAt, distance } from "./raster.ts"
import { runClip, type Clip, type Frame, type Run, type RunOptions } from "./clip.ts"
import { aimOf, boundsOf, goalPoint, shapeShown, solve } from "./pose.ts"
import { angleOf, apply, invert, tipOf, wrap, type Mat, type Rig, type V } from "./rig.ts"

/** A planted foot may drift this far per frame, in pixels, against the clip's `travel`. */
export const SLIDE = 0.5
/** A planted foot's sole may sit this far off the ground. */
export const GROUND = 1
/** A goal further than this from the chain's end is out of reach. */
export const REACH_GAP = 0.5
/**
 * A pop: a bone tip's speed changing by more than this many pixels per frame
 * from one frame to the next, and by more than half its speed, outside
 * `fast` phases. Speed, not the second difference of position: a fast arc
 * curves, and its second difference is large with no pop in it.
 */
export const JERK = 8
/** A bone tip moving less than this many pixels in a frame is at rest. */
export const REST = 1
/** A bone tip whose speed dips, for one frame, to under this share of the faster frame beside it is at rest there too: an extreme or a hold it slows into and out of. */
export const REST_DIP = 0.5
/** A move's first and last this many frames (leaving or arriving at rest) may change speed sharply: easing out of a hold is not a pop. */
export const REST_FRAMES = 2
/** A far-side part seen more than this many pixels behind the back bone's middle line peeks. */
export const PEEK = 1.5
/** Fewer seen pixels than this is an edge, not a blob. */
export const PEEK_PIXELS = 3
/** A joint whose bend stays within this many degrees over the whole clip never articulates. */
export const LOCKED = 5
/** A joint bending past straight the wrong way by more than this many degrees is hyperextended. */
export const HYPER = 3
/** A bone further than this many pixels from where the clip's stance puts it is off the stance. */
export const STANCE = 1
/** Consecutive frames of a loop whose bones move less than this on average (pixels) are the same pose. */
export const IDENTICAL = 0.02

/** What breaks a rule: an error to fix first, or a warning to weigh (or accept, with why). */
export interface Issue {
  readonly level: "error" | "warning"
  readonly code: string
  readonly message: string
  /** The frames it is on. */
  readonly frames?: ReadonlyArray<number> | undefined
  /** The bones or parts it is about. */
  readonly where?: ReadonlyArray<string> | undefined
}

/** A two-bone chain's middle joint (a knee, an elbow): its bend on each frame in whole degrees, 0 straight and positive the way it bends; `null` where it is hidden. */
export interface Joint {
  readonly joint: string
  readonly bend: ReadonlyArray<number | null>
  readonly min: { readonly deg: number; readonly frames: ReadonlyArray<number> }
  readonly max: { readonly deg: number; readonly frames: ReadonlyArray<number> }
}

/** The trail bone's numbers: how far its tip moves into each frame, its fastest frame, its world angle on each frame, and how far it turns. `null` where it is hidden. */
export interface Trail {
  readonly bone: string
  readonly spacing: ReadonlyArray<number | null>
  readonly peak: { readonly frame: number; readonly pxPerFrame: number; readonly pxPerSecond: number }
  readonly angle: ReadonlyArray<number | null>
  readonly arc: { readonly total: number; readonly swing?: number | undefined; readonly swingFrames?: string | undefined; readonly swingMs?: number | undefined; readonly anticipation?: string | undefined }
  /** For a one-shot: whether the tip ends where it started. */
  readonly endsWhereItStarts?: boolean | undefined
}

/** A bone's world place on each frame (y up, the origin on the ground under the character): where it starts, its tip, and its world angle; `null` where it is hidden. */
export interface Position {
  readonly start: ReadonlyArray<V | null>
  readonly tip: ReadonlyArray<V | null>
  readonly angle: ReadonlyArray<number | null>
}

/** A draft's numbers, as `rig check` reports them. */
export interface Measures {
  readonly frames: number
  readonly fps: number
  readonly loop: boolean
  /** How long one play lasts, in milliseconds. */
  readonly duration: number
  readonly stance: string | undefined
  /** Every pixel any frame draws, as one box on the frame (x right, y down). */
  readonly bounds: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | undefined
}

/** What `checkClip` found: the run it checked, its numbers, and its issues. */
export interface Checked {
  readonly run: Run
  readonly measures: Measures
  /** What is still to fix or weigh. */
  readonly issues: ReadonlyArray<Issue>
  /** Warnings the draft accepts as deliberate, each with its reason. */
  readonly accepted: ReadonlyArray<Issue & { readonly why: string }>
  readonly joints: Readonly<Record<string, Joint>>
  readonly trail: Trail | undefined
  /** The mean step of the shown bone tips into each frame from the one before (pixels): the body's spacing. */
  readonly motion: ReadonlyArray<number>
  /** The bones asked for in `positions`, by name. */
  readonly positions: Readonly<Record<string, Position>>
}

/** How `checkClip` runs a draft: the bank's seed and tune, its accepted warnings, and what to report. */
export interface CheckOptions extends RunOptions {
  /** Warnings judged deliberate: code -> why. */
  readonly accept?: Readonly<Record<string, string>> | undefined
  /** How errors name the clip ("attack (draft a)"). */
  readonly name?: string | undefined
  /** Bones to report the world positions of, on every frame. */
  readonly positions?: ReadonlyArray<string> | undefined
}

const r1 = (n: number): number => Math.round(n * 10) / 10
const dist = (a: V, b: V): number => Math.hypot(a[0] - b[0], a[1] - b[1])
const inSpans = (f: number, spans: ReadonlyArray<readonly [number, number]>): boolean => spans.some(([a, b]) => f >= a && f <= b)

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

/** Whether two runs posed the same: every bone's transform and every part drawn. */
const samePoses = (a: Run, b: Run): boolean =>
  a.frames.every((frame, f) => {
    const other = b.frames[f]
    if (other === undefined) return false
    const close = (m: Mat, n: Mat | undefined): boolean => n !== undefined && Math.abs(m.a - n.a) + Math.abs(m.b - n.b) + Math.abs(m.x - n.x) + Math.abs(m.y - n.y) < 1e-9
    return Object.entries(frame.world).every(([bone, m]) => close(m, other.world[bone])) && frame.drawn.map((d) => d.part).join() === other.drawn.map((d) => d.part).join()
  })

/** The issues of a clip's frames that need no second run. */
const frameIssues = (rig: Rig, clip: Clip, frames: ReadonlyArray<Frame>): Array<Issue> => {
  const n = frames.length
  const issues: Array<Issue> = []
  const warn = (code: string, message: string, on: ReadonlyArray<number>, where: ReadonlyArray<string>): void => {
    issues.push({ level: "warning", code, message, frames: [...on].sort((a, b) => a - b), where })
  }
  const fast = new Set<number>()
  for (const phase of clip.phases) if (phase.fast) for (let f = phase.from; f <= phase.to; f++) fast.add(f)
  /** Consecutive frame pairs, with the seam for a loop. */
  const pairs: Array<readonly [number, number]> = []
  for (let f = 0; f + 1 < n; f++) pairs.push([f, f + 1])
  if (clip.loop && n > 1) pairs.push([n - 1, 0])
  const tips = frames.map((fr) => Object.fromEntries(rig.order.map((bone) => [bone, tipOf(rig, fr.world, bone)])) as Record<string, V>)

  // Nothing drawn.
  const blank = frames.flatMap((fr) => (fr.drawn.length === 0 ? [fr.frame] : []))
  if (blank.length > 0) warn("gap", `nothing is drawn on frames ${spans(blank)}: the character blinks out`, blank, [])

  // Off canvas: a part's bounds (with its outline) past the frame's edge.
  const off = new Map<string, Array<number>>()
  for (const fr of frames)
    for (const d of fr.drawn) {
      const b = boundsOf(d.geom)
      const pad = d.outline === null ? 0 : d.line
      if (rig.anchor[0] + b.minX - pad < 0 || rig.anchor[1] - b.maxY - pad < 0 || rig.anchor[0] + b.maxX + pad > rig.width || rig.anchor[1] - b.minY + pad > rig.height)
        off.set(d.part, [...(off.get(d.part) ?? []), fr.frame])
    }
  for (const [part, on] of off) warn("off-canvas", `${part} is cut off by the frame's edge on frames ${spans(on)}: make the rig's size bigger, move its anchor, or keep the pose inside`, on, [part])

  // Below the ground: a part (other than a foot's) reaching under the ground line, a blade into the floor.
  const feet = new Set(Object.values(rig.chains).filter((c) => c.foot).map((c) => c.end))
  const under = new Map<string, { on: Array<number>; depth: number }>()
  for (const fr of frames)
    for (const d of fr.drawn) {
      if (feet.has(d.bone)) continue
      const low = boundsOf(d.geom).minY
      if (low >= -GROUND) continue
      const entry = under.get(d.part) ?? { on: [], depth: 0 }
      entry.on.push(fr.frame)
      entry.depth = Math.max(entry.depth, -low)
      under.set(d.part, entry)
    }
  for (const [part, { on, depth }] of under) warn("below-ground", `${part} goes up to ${r1(depth)} px under the ground line on frames ${spans(on)}`, on, [part])

  // Feet: planted feet move back at the travel speed and sit on the ground.
  const travel = clip.travel / clip.fps
  for (const chain of Object.values(rig.chains)) {
    if (!chain.foot) continue
    const planted = clip.contacts[chain.name] ?? [[0, n - 1]]
    const on = (f: number): boolean => inSpans(f, planted) && frames[f]!.shown.has(chain.end)
    const ankle = (f: number): V => [frames[f]!.world[chain.end]!.x, frames[f]!.world[chain.end]!.y]
    const slides: Array<number> = []
    let worst = 0
    for (const [a, b] of pairs) {
      if (!on(a) || !on(b)) continue
      const drift = Math.hypot(ankle(b)[0] - ankle(a)[0] + travel, ankle(b)[1] - ankle(a)[1])
      if (drift > SLIDE) {
        slides.push(b)
        worst = Math.max(worst, drift)
      }
    }
    if (slides.length > 0)
      warn("slide", `${chain.end} is planted but slides up to ${r1(worst)} px a frame on frames ${spans(slides)} (it should move ${r1(-travel)} px: the clip's travel)`, slides, [chain.end])
    const parts = rig.partsOf[chain.end]!
    const floating: Array<number> = []
    const sinking: Array<number> = []
    let high = 0
    let low = 0
    for (let f = 0; f < n; f++) {
      if (!on(f)) continue
      const soles = frames[f]!.drawn.filter((d) => parts.includes(d.part)).map((d) => boundsOf(d.geom).minY)
      if (soles.length === 0) continue
      const lowest = Math.min(...soles)
      if (lowest > GROUND) floating.push(f), (high = Math.max(high, lowest))
      if (lowest < -GROUND) sinking.push(f), (low = Math.min(low, lowest))
    }
    if (floating.length > 0) warn("floating", `${chain.end} is planted but its sole is up to ${r1(high)} px above the ground on frames ${spans(floating)}`, floating, [chain.end])
    if (sinking.length > 0) warn("sinking", `${chain.end} is planted but its sole is up to ${r1(-low)} px under the ground on frames ${spans(sinking)}`, sinking, [chain.end])
  }

  // Out of reach: a goal the limb cannot get to straightens it and leaves its end short (a foot off its spot, a hand off the grip).
  for (const chain of Object.values(rig.chains)) {
    const short: Array<number> = []
    let worst = 0
    for (const fr of frames) {
      const goal = fr.pose.reach?.[chain.name]
      if (goal === undefined || (goal.mix ?? 1) < 1 || !fr.shown.has(chain.end)) continue
      // An aim on the limb wins over the reach: the goal is not meant to be met there.
      if ([chain.upper, chain.lower].some((bone) => { const aim = fr.pose.aim?.[bone]; return aim !== undefined && aimOf(aim).mix > 0 })) continue
      const target = goalPoint(fr.world, goal)
      const end = fr.world[chain.end]!
      const gap = target === undefined ? 0 : dist([end.x, end.y], target)
      if (gap > REACH_GAP) {
        short.push(fr.frame)
        worst = Math.max(worst, gap)
      }
    }
    if (short.length > 0) warn("unreachable", `${chain.name}'s goal is out of reach on frames ${spans(short)}: the limb is straight and ${chain.end} falls up to ${r1(worst)} px short`, short, [chain.end])
  }

  // Peek: a far-side part seen behind the back's middle line, at the back's height: an elbow poking out behind the back, or a far limb crossing over it.
  if (rig.back !== undefined) {
    const back = rig.back
    const length = rig.bones[back]!.length
    const peeks = new Map<string, { on: Array<number>; most: number }>()
    for (const fr of frames) {
      const toBack = invert(fr.world[back]!)
      for (const d of fr.drawn) {
        if (!d.far) continue
        const b = boundsOf(d.geom)
        let count = 0
        for (let y = Math.floor(b.minY - d.line); y <= Math.ceil(b.maxY + d.line); y++)
          for (let x = Math.floor(b.minX - d.line); x <= Math.ceil(b.maxX + d.line); x++) {
            const px = x + 0.5
            const py = y + 0.5
            if (distance(d.geom, px, py) > d.line) continue
            // In the back bone's frame: x along it, y across it, to its left; behind is the side away from where the character faces.
            const [along, across] = apply(toBack, [px, py])
            const behind = across * (Math.sign(-fr.world[back]!.c * rig.facing) || 1)
            if (behind <= PEEK || along < 6 || along > length + 4) continue
            // Only where it is seen: the topmost part there.
            if (partAt(fr.drawn, px, py) !== d.part) continue
            count++
          }
        // A pixel or two at the edge is anti-aliasing, not a shape anyone sees.
        if (count < PEEK_PIXELS) continue
        const entry = peeks.get(d.part) ?? { on: [], most: 0 }
        entry.on.push(fr.frame)
        entry.most = Math.max(entry.most, count)
        peeks.set(d.part, entry)
      }
    }
    for (const [part, { on, most }] of peeks)
      warn("peek", `${part} (far side) shows behind the middle of ${back} on frames ${spans(on)}, up to ${most} px: a far-side part poking out behind the back, or crossing over it, reads as a stray blob`, on, [part])
  }

  // Jerk: a bone tip's sudden change of speed, outside fast phases and the first and last frames of each move.
  const jerks = new Map<string, { on: Array<number>; worst: number }>()
  for (const bone of rig.order) {
    /** The step into each frame (`undefined` with no step: the first frame of a one-shot, or a hidden frame). */
    const step: Array<number | undefined> = frames.map((fr, f) => {
      const prev = f === 0 ? (clip.loop ? n - 1 : undefined) : f - 1
      if (prev === undefined || !fr.shown.has(bone) || !frames[prev]!.shown.has(bone)) return undefined
      return dist(tips[f]![bone]!, tips[prev]![bone]!)
    })
    const around = (f: number, k: number): number | undefined => (clip.loop ? step[(f + k + n) % n] : step[f + k])
    const moving = step.map((s, f) => {
      if (s === undefined || s < REST) return false
      const before = around(f, -1)
      const after = around(f, 1)
      return !(before !== undefined && after !== undefined && s < before && s < after && s < REST_DIP * Math.max(before, after))
    })
    /** How many moving steps run before and after each step, within its move. */
    const run = (f: number, direction: 1 | -1): number => {
      let count = 0
      for (let k = 1; k < n; k++) {
        const g = f + direction * k
        const i = clip.loop ? ((g % n) + n) % n : g
        if (i < 0 || i >= n || !moving[i]) break
        count++
      }
      return count
    }
    const eased = (f: number): boolean => !moving[f] || run(f, -1) < REST_FRAMES || run(f, 1) < REST_FRAMES
    for (let f = 0; f < n; f++) {
      const next = clip.loop ? (f + 1) % n : f + 1
      const prev = clip.loop ? (f - 1 + n) % n : f - 1
      if (prev < 0 || next >= n || fast.has(prev) || fast.has(f) || fast.has(next)) continue
      const s1 = step[f]
      const s2 = step[next]
      if (s1 === undefined || s2 === undefined || eased(f) || eased(next)) continue
      const j = Math.abs(s2 - s1)
      if (j > JERK && j > 0.5 * Math.max(s1, s2)) {
        const entry = jerks.get(bone) ?? { on: [], worst: 0 }
        entry.on.push(f)
        entry.worst = Math.max(entry.worst, j)
        jerks.set(bone, entry)
      }
    }
  }
  for (const [bone, { on, worst }] of jerks)
    warn(
      "jerk",
      `${bone}'s tip changes speed by up to ${r1(worst)} px a frame from one frame to the next on frames ${spans(on)} (limit ${JERK} and half its speed): ease it, add a frame, or mark the span \`fast\` if it is a deliberate snap`,
      on,
      [bone]
    )

  // Loops: frames that do not move, and a jump from the last frame back to the first.
  const stepOf = (a: number, b: number): number => {
    const shown = rig.order.filter((bone) => frames[a]!.shown.has(bone) && frames[b]!.shown.has(bone))
    return shown.length === 0 ? 0 : shown.reduce((sum, bone) => sum + dist(tips[a]![bone]!, tips[b]![bone]!), 0) / shown.length
  }
  if (clip.loop && n > 1) {
    const still = pairs.filter(([a, b]) => stepOf(a, b) < IDENTICAL).map(([, b]) => b)
    if (still.length > 0) warn("identical", `frames ${spans(still)} repeat the frame before: the loop stops there; give each frame its own pose, or drop a frame`, still, [])
    const steps = pairs.map(([a, b]) => stepOf(a, b))
    const inner = steps.slice(0, -1).sort((a, b) => a - b)
    const median = inner[Math.floor(inner.length / 2)] ?? 0
    const seam = steps[steps.length - 1] ?? 0
    if (n > 2 && seam > 2 * median + 0.5)
      warn("seam", `the loop jumps from its last frame back to its first: ${r1(seam)} px against a median step of ${r1(median)} px; make the pose a function of t that wraps`, [n - 1, 0], [])
  }

  // Draw order: parts that change their place in the order between frames (a pose's `z`), and the parts they pass.
  for (const [a, b] of pairs) {
    const zA = new Map(frames[a]!.drawn.map((d) => [d.part, d.z]))
    const zB = new Map(frames[b]!.drawn.map((d) => [d.part, d.z]))
    const moved = [...zA.keys()].filter((p) => zB.has(p) && zA.get(p) !== zB.get(p))
    if (moved.length === 0) continue
    const passed = [...zA.keys()].filter((q) => !moved.includes(q) && zB.has(q) && moved.some((p) => Math.sign(zA.get(p)! - zA.get(q)!) !== Math.sign(zB.get(p)! - zB.get(q)!)))
    if (passed.length === 0) continue
    warn("draw-order", `${moved.join(", ")} change${moved.length === 1 ? "s" : ""} draw order from frame ${a} to ${b}, passing ${passed.join(", ")}: a part that jumps in front pops; check it reads`, [a, b], moved)
  }

  // The stance: the first frame (and a one-shot's last) where the stance puts the bones, and showing what it shows.
  if (clip.stance !== undefined) {
    const stance = rig.stances[clip.stance]!
    const world = solve(rig, stance)
    const showing = new Set(rig.parts.filter((part) => shapeShown(rig, stance, part.name) !== undefined).map((part) => part.name))
    for (const f of clip.loop || n === 1 ? [0] : [0, n - 1]) {
      const fr = frames[f]!
      const off = rig.order
        .filter((bone) => fr.shown.has(bone))
        .map((bone) => ({ bone, gap: Math.max(dist([fr.world[bone]!.x, fr.world[bone]!.y], [world[bone]!.x, world[bone]!.y]), dist(tips[f]![bone]!, tipOf(rig, world, bone))) }))
        .filter((entry) => entry.gap > STANCE)
        .sort((x, y) => y.gap - x.gap)
      const drawn = new Set(fr.drawn.map((d) => d.part))
      const extra = [...drawn].filter((part) => !showing.has(part))
      const missing = [...showing].filter((part) => !drawn.has(part))
      if (off.length === 0 && extra.length === 0 && missing.length === 0) continue
      const words = [
        ...(off.length === 0 ? [] : [off.slice(0, 6).map((entry) => `${entry.bone} ${r1(entry.gap)} px`).join(", ") + (off.length > 6 ? `, and ${off.length - 6} more` : "")]),
        ...(extra.length === 0 ? [] : [`shows ${extra.join(", ")}, which the stance hides`]),
        ...(missing.length === 0 ? [] : [`hides ${missing.join(", ")}, which the stance shows`])
      ]
      warn(
        "stance",
        `frame ${f} is off the ${clip.stance} stance (${words.join("; ")}): key it as \`{ at: ${f}, ...rig.stances.${clip.stance} }\`, so the game can blend this clip with the others on that stance; a value the stance does not set keeps its nearest key's value there, so give the stance every bone the clip moves`,
        [f],
        [...off.map((entry) => entry.bone), ...extra, ...missing]
      )
    }
  }
  return issues
}

/** Every chain's middle joint, its bend on each frame. */
export const jointsOf = (rig: Rig, frames: ReadonlyArray<Frame>): Record<string, Joint> => {
  const joints: Record<string, Joint> = {}
  for (const chain of Object.values(rig.chains)) {
    const bend = frames.map((fr) => {
      if (!fr.shown.has(chain.upper) || !fr.shown.has(chain.lower)) return null
      const rel = wrap(angleOf(fr.world[chain.lower]!) - angleOf(fr.world[chain.upper]!))
      // The chain bends its middle joint to `bend`'s side, so the lower bone turns the other way: that turn is a positive bend.
      return Math.round(-rel * chain.bend)
    })
    const seen = bend.filter((b): b is number => b !== null)
    if (seen.length === 0) continue
    const lo = Math.min(...seen)
    const hi = Math.max(...seen)
    const at = (v: number): Array<number> => bend.flatMap((b, f) => (b === v ? [f] : []))
    joints[chain.name] = { joint: chain.lower, bend, min: { deg: lo, frames: at(lo) }, max: { deg: hi, frames: at(hi) } }
  }
  return joints
}

const jointIssues = (joints: Readonly<Record<string, Joint>>, frames: number): Array<Issue> => {
  const issues: Array<Issue> = []
  for (const [name, joint] of Object.entries(joints)) {
    const where = [joint.joint]
    if (frames > 1 && joint.max.deg - joint.min.deg < LOCKED)
      issues.push({ level: "warning", code: "locked", message: `${name} (${joint.joint}) stays between ${joint.min.deg}° and ${joint.max.deg}° the whole clip: the limb never articulates`, frames: [], where })
    const hyper = joint.bend.flatMap((b, f) => (b !== null && b < -HYPER ? [f] : []))
    if (hyper.length > 0)
      issues.push({ level: "warning", code: "hyperextended", message: `${name} (${joint.joint}) bends past straight the wrong way, to ${joint.min.deg}°, on frames ${spans(hyper)}: flip its turn, or check the chain's bend`, frames: hyper, where })
  }
  return issues
}

/** The trail bone's spacing, speed, and arc, over the frames it shows. */
export const trailOf = (rig: Rig, clip: Clip, frames: ReadonlyArray<Frame>): Trail | undefined => {
  const bone = clip.trail
  if (bone === undefined) return undefined
  const n = frames.length
  const shown = frames.map((fr) => fr.shown.has(bone))
  if (!shown.some(Boolean)) return undefined
  const points = frames.map((fr) => tipOf(rig, fr.world, bone))
  const spacing = points.map((p, f) => {
    const prev = f === 0 ? (clip.loop ? n - 1 : undefined) : f - 1
    if (!shown[f] || prev === undefined || !shown[prev]) return f === 0 && !clip.loop && shown[f] ? 0 : null
    return dist(p, points[prev]!)
  })
  const angles: Array<number | null> = []
  let previous: number | undefined
  for (const fr of frames) {
    if (!fr.shown.has(bone)) {
      angles.push(null)
      continue
    }
    const raw = angleOf(fr.world[bone]!)
    const unwrapped = previous === undefined ? raw : previous + wrap(raw - previous)
    angles.push(unwrapped)
    previous = unwrapped
  }
  let peak = spacing.findIndex((s) => s !== null)
  spacing.forEach((s, f) => {
    if (s !== null && s > (spacing[peak] ?? 0)) peak = f
  })
  const fastFrames = clip.phases.filter((p) => p.fast).flatMap((p) => Array.from({ length: p.to - p.from + 1 }, (_, i) => p.from + i))
  const swing = fastFrames.length > 0 ? { from: Math.max(0, fastFrames[0]! - 1), to: fastFrames[fastFrames.length - 1]! } : undefined
  const span = (a: number, b: number): number => {
    const slice = angles.slice(a, b + 1).filter((v): v is number => v !== null)
    return slice.length === 0 ? 0 : r1(Math.max(...slice) - Math.min(...slice))
  }
  const top = spacing[peak] ?? 0
  return {
    bone,
    spacing: spacing.map((s) => (s === null ? null : r1(s))),
    peak: { frame: peak, pxPerFrame: r1(top), pxPerSecond: Math.round(top * clip.fps) },
    angle: angles.map((a) => (a === null ? null : Math.round(a))),
    arc: {
      total: span(0, n - 1),
      ...(swing === undefined
        ? {}
        : {
            swing: span(swing.from, swing.to),
            swingFrames: `${swing.from}-${swing.to}`,
            swingMs: Math.round(((swing.to - swing.from) / clip.fps) * 1000),
            anticipation: `${r1((fastFrames[0]! / n) * 100)}%`
          })
    },
    ...(clip.loop || !shown[0] || !shown[n - 1] ? {} : { endsWhereItStarts: dist(points[0]!, points[n - 1]!) < 0.5 })
  }
}

/** The world places of the named bones on every frame, to a tenth of a pixel; `null` where a bone is hidden. */
export const positionsOf = (rig: Rig, frames: ReadonlyArray<Frame>, bones: ReadonlyArray<string>): Record<string, Position> =>
  Object.fromEntries(
    bones
      .filter((bone) => bone in rig.bones)
      .map((bone) => [
        bone,
        {
          start: frames.map((fr): V | null => (fr.shown.has(bone) ? [r1(fr.world[bone]!.x), r1(fr.world[bone]!.y)] : null)),
          tip: frames.map((fr): V | null => {
            if (!fr.shown.has(bone)) return null
            const [x, y] = tipOf(rig, fr.world, bone)
            return [r1(x), r1(y)]
          }),
          angle: frames.map((fr) => (fr.shown.has(bone) ? Math.round(angleOf(fr.world[bone]!)) : null))
        }
      ])
  )

/** Every pixel any frame draws, as one box on the frame (x right, y down). */
const boundsOfRun = (rig: Rig, frames: ReadonlyArray<Frame>): Measures["bounds"] => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const fr of frames)
    for (const d of fr.drawn) {
      const b = boundsOf(d.geom)
      const pad = d.outline === null ? 0 : d.line
      minX = Math.min(minX, rig.anchor[0] + b.minX - pad)
      maxX = Math.max(maxX, rig.anchor[0] + b.maxX + pad)
      minY = Math.min(minY, rig.anchor[1] - b.maxY - pad)
      maxY = Math.max(maxY, rig.anchor[1] - b.minY + pad)
    }
  if (maxX < minX) return undefined
  const x = Math.max(0, Math.floor(minX))
  const y = Math.max(0, Math.floor(minY))
  return { x, y, w: Math.min(rig.width, Math.ceil(maxX)) - x, h: Math.min(rig.height, Math.ceil(maxY)) - y }
}

/** Codes that are always errors: a key list that keys the wrong motion, a pose that fails, a pose that is not the same twice. */
export const ERROR_CODES: ReadonlyArray<string> = ["load", "keys", "pose", "random"]

/**
 * Runs a clip twice (the second to catch randomness that is not the seed's),
 * measures it, and lists its issues; warnings in `accept` (code -> why) are
 * set apart. Errors are never accepted, and a clip with errors gets no
 * warnings: fix the errors first. To pose a clip without measuring it (to
 * draw it), use `runClip`.
 */
export const checkClip = (rig: Rig, clip: Clip, options: CheckOptions = {}): Checked => {
  const run = runClip(rig, clip, options)
  const again = runClip(rig, clip, options)
  const named = (message: string): string => (options.name === undefined ? message : `${options.name}: ${message}`)
  const errors: Array<Issue> = run.errors.map((error) => ({ level: "error", code: error.code, message: named(error.message) }))
  if (errors.length === 0 && !samePoses(run, again))
    errors.push({ level: "error", code: "random", message: named("a second run poses other bones: use rig.random() (it starts from the draft's seed), never Math.random() or the time") })
  const joints = jointsOf(rig, run.frames)
  const all = errors.length > 0 ? errors : [...frameIssues(rig, clip, run.frames), ...jointIssues(joints, run.frames.length)]
  const why = (issue: Issue): string | undefined => (issue.level === "warning" ? options.accept?.[issue.code] : undefined)
  const n = run.frames.length
  const tips = run.frames.map((fr) => Object.fromEntries(rig.order.map((bone) => [bone, tipOf(rig, fr.world, bone)])) as Record<string, V>)
  const stepOf = (a: number, b: number): number => {
    const shown = rig.order.filter((bone) => run.frames[a]!.shown.has(bone) && run.frames[b]!.shown.has(bone))
    return shown.length === 0 ? 0 : shown.reduce((sum, bone) => sum + dist(tips[a]![bone]!, tips[b]![bone]!), 0) / shown.length
  }
  return {
    run,
    measures: { frames: n, fps: clip.fps, loop: clip.loop, duration: Math.round((n / clip.fps) * 1000), stance: clip.stance, bounds: boundsOfRun(rig, run.frames) },
    issues: all.filter((issue) => why(issue) === undefined),
    accepted: all.flatMap((issue) => {
      const reason = why(issue)
      return reason === undefined ? [] : [{ ...issue, why: reason }]
    }),
    joints,
    trail: trailOf(rig, clip, run.frames),
    motion: run.frames.map((_, f) => r1(f === 0 ? (clip.loop && n > 1 ? stepOf(n - 1, 0) : 0) : stepOf(f - 1, f))),
    positions: positionsOf(rig, run.frames, options.positions ?? [])
  }
}
