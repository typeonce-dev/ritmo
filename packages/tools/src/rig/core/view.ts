/**
 * What the review page draws a draft from, and what it asks about a pixel:
 * the same runner and rasterizer as the CLI, with no platform imports, so
 * the CLI's server bakes it (`rig review`) and the website's demo bakes it
 * in the tab.
 *
 * A draft's view is its frames drawn on transparency at `scale` (the page
 * lays its backdrop, ground line, onion skin, bones, and rings over them),
 * each frame's bone transforms and part boxes, the image parts' pivots,
 * the frames a key is on, and its check. Coordinates are the world's (y
 * up, the origin on the ground under the character), except where a field
 * says pixels.
 */
import type { RgbaImage } from "../../pixel/core/grid.ts"
import type { Draft } from "./bank.ts"
import { checkClip, type Issue } from "./check.ts"
import { phaseAt, runClip, type Clip, type Param } from "./clip.ts"
import { apply, invert, type Rig, type V } from "./rig.ts"
import { boundsOf } from "./pose.ts"
import { partAt, renderArt } from "./raster.ts"

/** A bone transform as six numbers: `[a, b, c, d, x, y]` (see `Mat`). */
export type Mat6 = readonly [number, number, number, number, number, number]

export interface DraftView<Image> {
  readonly id: string
  readonly file: string
  readonly label: string
  readonly frames: number
  readonly fps: number
  readonly loop: boolean
  readonly params: Readonly<Record<string, Param>>
  /** The params as the bank tunes them. */
  readonly tuned: Readonly<Record<string, number>>
  /** Each frame's phase name, `""` outside phases. */
  readonly phases: ReadonlyArray<string>
  readonly fast: ReadonlyArray<number>
  /** The frames a key is on. */
  readonly keys: ReadonlyArray<number>
  /** Pixels per world unit in `art`. */
  readonly scale: number
  /** Each frame, the character alone on transparency, `scale` times its size. */
  readonly art: ReadonlyArray<Image>
  /** Each frame's bone transforms, for bones the frame shows. */
  readonly bones: ReadonlyArray<Readonly<Record<string, Mat6>>>
  readonly lengths: Readonly<Record<string, number>>
  /** Each frame's drawn parts: their bone and their box (`[minX, minY, maxX, maxY]`). */
  readonly parts: ReadonlyArray<ReadonlyArray<{ readonly part: string; readonly bone: string; readonly box: readonly [number, number, number, number] }>>
  /** Each frame's image parts' pivots, where they sit. */
  readonly pivots: ReadonlyArray<Readonly<Record<string, V>>>
  /** The trail bone's tip on each frame it shows. */
  readonly trail: ReadonlyArray<V | null>
  readonly check: {
    readonly duration: number
    readonly issues: ReadonlyArray<Issue>
    readonly accepted: ReadonlyArray<Issue & { readonly why: string }>
    readonly joints: Readonly<Record<string, { readonly joint: string; readonly min: number; readonly max: number; readonly bend: ReadonlyArray<number | null> }>>
    readonly trail?: { readonly bone: string; readonly peak: { readonly frame: number; readonly pxPerFrame: number }; readonly arc: number } | undefined
  }
}

/** A draft's view, or why there is none (its module does not load, or it poses with errors). */
export type DraftResult<Image> = { readonly ok: true; readonly view: DraftView<Image> } | { readonly ok: false; readonly id: string; readonly file: string; readonly error: string }

const r2 = (n: number): number => Math.round(n * 100) / 100 + 0

/** Bakes a draft's view for the page at `scale`; a draft that poses with errors is its errors. */
export const draftView = (rig: Rig, clip: Clip, draft: Draft, id: string, name: string, scale = 2): DraftResult<RgbaImage> => {
  const checked = checkClip(rig, clip, { seed: draft.seed, tune: draft.tune, accept: draft.accept, name: `${name} (draft ${id})` })
  const errors = checked.issues.filter((issue) => issue.level === "error")
  if (errors.length > 0) return { ok: false, id, file: draft.file, error: errors.map((issue) => issue.message).join("; ") }
  const frames = checked.run.frames
  const trailBone = clip.trail
  return {
    ok: true,
    view: {
      id,
      file: draft.file,
      label: clip.label,
      frames: clip.frames,
      fps: clip.fps,
      loop: clip.loop,
      params: clip.params,
      tuned: checked.run.params,
      phases: frames.map((fr) => phaseAt(clip, fr.frame)?.name ?? ""),
      fast: frames.flatMap((fr) => (phaseAt(clip, fr.frame)?.fast === true ? [fr.frame] : [])),
      keys: checked.run.keys,
      scale,
      art: frames.map((fr) => renderArt(rig, fr, scale)),
      bones: frames.map((fr) => Object.fromEntries(rig.order.filter((bone) => fr.shown.has(bone)).map((bone) => [bone, [fr.world[bone]!.a, fr.world[bone]!.b, fr.world[bone]!.c, fr.world[bone]!.d, r2(fr.world[bone]!.x), r2(fr.world[bone]!.y)] as Mat6]))),
      lengths: Object.fromEntries(rig.order.map((bone) => [bone, rig.bones[bone]!.length])),
      parts: frames.map((fr) =>
        fr.drawn.map((d) => {
          const b = boundsOf(d.geom)
          return { part: d.part, bone: d.bone, box: [r2(b.minX), r2(b.minY), r2(b.maxX), r2(b.maxY)] as const }
        })
      ),
      pivots: frames.map((fr) =>
        Object.fromEntries(
          fr.drawn.flatMap((d) => {
            const shape = rig.part[d.part]?.shape
            if (d.geom.kind !== "image" || shape?.kind !== "image") return []
            const [x, y] = apply(d.geom.m, shape.pivot)
            return [[d.part, [r2(x), r2(y)] as V]]
          })
        )
      ),
      trail: frames.map((fr) => (trailBone !== undefined && fr.shown.has(trailBone) ? apply(fr.world[trailBone]!, [rig.bones[trailBone]!.length, 0]) : null)),
      check: {
        duration: checked.measures.duration,
        issues: checked.issues,
        accepted: checked.accepted,
        joints: Object.fromEntries(Object.entries(checked.joints).map(([chain, joint]) => [chain, { joint: joint.joint, min: joint.min.deg, max: joint.max.deg, bend: joint.bend }])),
        ...(checked.trail === undefined ? {} : { trail: { bone: checked.trail.bone, peak: { frame: checked.trail.peak.frame, pxPerFrame: checked.trail.peak.pxPerFrame }, arc: checked.trail.arc.total } })
      }
    }
  }
}

/** A frame pixel (1x, from the frame's top left) as a world point at its middle. */
const worldOf = (rig: Rig, x: number, y: number): V => [x + 0.5 - rig.anchor[0], rig.anchor[1] - (y + 0.5)]

/**
 * What is at a pixel of a draft's frame, for a pinned comment: the part
 * drawn there (or the nearest within 3 px), that part's own bone, the spot
 * in that bone's frame (`[along, across]`), so the ring follows the part
 * after an edit, and the frame's phase.
 */
export const spotAt = (rig: Rig, clip: Clip, draft: Draft, frame: number, x: number, y: number): { readonly part?: string; readonly bone?: string; readonly local?: V; readonly phase?: string } => {
  const run = runClip(rig, clip, { seed: draft.seed, tune: draft.tune })
  const fr = run.frames[frame]
  if (fr === undefined) return {}
  const [wx, wy] = worldOf(rig, x, y)
  const part = partAt(fr.drawn, wx, wy, 3)
  const bone = part === undefined ? undefined : rig.part[part]?.bone
  const local = bone === undefined ? undefined : apply(invert(fr.world[bone]!), [wx, wy])
  const phase = phaseAt(clip, frame)?.name
  return {
    ...(part === undefined ? {} : { part }),
    ...(bone === undefined ? {} : { bone }),
    ...(local === undefined ? {} : { local: [r2(local[0]), r2(local[1])] as V }),
    ...(phase === undefined ? {} : { phase })
  }
}

/**
 * The pixel of an image part's picture under a frame pixel (1x, fractional
 * allowed): its new pivot when the person drags the pivot there. `undefined`
 * when the part is not a picture drawn on that frame.
 */
export const pivotAt = (rig: Rig, clip: Clip, draft: Draft, frame: number, part: string, x: number, y: number): V | undefined => {
  const run = runClip(rig, clip, { seed: draft.seed, tune: draft.tune })
  const drawn = run.frames[frame]?.drawn.find((d) => d.part === part)
  if (drawn === undefined || drawn.geom.kind !== "image") return undefined
  const [u, v] = apply(invert(drawn.geom.m), [x - rig.anchor[0], rig.anchor[1] - y])
  return [Math.round(u * 10) / 10 + 0, Math.round(v * 10) / 10 + 0]
}
