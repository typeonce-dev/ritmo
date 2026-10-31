/**
 * The bake's sidecar: what a game needs from a bank's clips besides their
 * pixels, as one versioned JSON file per bank (`hero.rig.json` bakes
 * `hero.rig.clips.json`, next to each clip's sheet and atlas JSON). Per
 * clip: the draft in use, its timing, its stance, its phases, and the name
 * of each frame in the clip's atlas; per frame: the feet on the ground,
 * the sockets, the hit segment, and the drawn box.
 *
 * Coordinates are the baked frame's pixels (times the bake's `scale`),
 * with y down and the origin on the atlas anchor (the ground under the
 * character), so the game adds its entity's position. Angles are degrees
 * from +x, clockwise on screen (y down), as Pixi and Phaser turn sprites.
 * No runtime code in Ritmo reads it: the game decodes it with its own
 * Standard Schema.
 */
import type { Clip, Run } from "./clip.ts"
import { boundsOf } from "./pose.ts"
import { angleOf, apply, wrap, type Rig, type Socket } from "./rig.ts"

/** The sidecar's format version: a change that breaks a reader bumps it. */
export const SIDECAR_VERSION = 1

/** A point on a frame: `[x, y]` pixels from the anchor, y down. */
export type Point = readonly [number, number]

/** A socket on one frame: where it is and the angle its bone points at. */
export interface SocketAt {
  readonly x: number
  readonly y: number
  /** Degrees from +x, clockwise on screen. */
  readonly angle: number
}

export interface SidecarFrame {
  /** The frame's name in the clip's atlas JSON (`"attack 12"`). */
  readonly name: string
  /** The foot bones planted on the ground on this frame (the clip's `contacts`; every frame for a foot chain it does not list). */
  readonly contacts: ReadonlyArray<string>
  /** Every socket whose bone shows on this frame, by name. */
  readonly sockets: Readonly<Record<string, SocketAt>>
  /** The hit segment on a frame the clip hits on, or `null`. */
  readonly hit: { readonly from: Point; readonly to: Point } | null
  /** The box every drawn part fills (outline included), whole pixels from the anchor, or `null` on a frame with nothing drawn. */
  readonly bounds: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null
}

export interface SidecarClip {
  /** The draft baked: the clip's `use`. */
  readonly draft: string
  /** The clip's sprite sheet and its atlas JSON, next to the sidecar. */
  readonly image: string
  readonly atlas: string
  readonly fps: number
  readonly loop: boolean
  /** One play, in milliseconds. */
  readonly duration: number
  /** How fast the game moves the character while it plays, in pixels per second. */
  readonly travel: number
  /** The stance the clip starts on, and the one it ends on (one-shots only; a loop has no end); `null` when it names none. */
  readonly stance: { readonly start: string | null; readonly end: string | null }
  /** Named spans of frames, both ends included; `fast` ones are the snaps (a swing, a strike). */
  readonly phases: ReadonlyArray<{ readonly name: string; readonly from: number; readonly to: number; readonly fast: boolean }>
  /** Every frame, in order: `frames.length` is the clip's frame count. */
  readonly frames: ReadonlyArray<SidecarFrame>
}

export interface Sidecar {
  readonly version: number
  /** The rig module the clips were baked from. */
  readonly rig: string
  /** Pixels per world unit in the sheets, and so in every coordinate here. */
  readonly scale: number
  /** A frame's size in pixels. */
  readonly size: Point
  /** The anchor's pixel in a frame, from its top left: every coordinate here is from it. */
  readonly anchor: Point
  readonly clips: Readonly<Record<string, SidecarClip>>
}

const r2 = (n: number): number => Math.round(n * 100) / 100 + 0
const inSpans = (f: number, spans: ReadonlyArray<readonly [number, number]>): boolean => spans.some(([a, b]) => f >= a && f <= b)

/**
 * One clip's entry in the sidecar, from its run: `name` is the clip's name
 * in the bank (its sheet is `<name>.png`, its atlas `<name>.json`, and its
 * frames `"<name> <i>"`, as `rig bake` writes them).
 */
export const sidecarClip = (rig: Rig, clip: Clip, run: Run, options: { readonly name: string; readonly draft: string; readonly scale: number }): SidecarClip => {
  const s = options.scale
  const toFrame = (x: number, y: number): Point => [r2(x * s), r2(-y * s)]
  const sockets: Record<string, Socket> = { ...rig.sockets, ...clip.sockets }
  const feet = Object.values(rig.chains).filter((chain) => chain.foot)
  const hit = clip.hit
  return {
    draft: options.draft,
    image: `${options.name}.png`,
    atlas: `${options.name}.json`,
    fps: clip.fps,
    loop: clip.loop,
    duration: Math.round((clip.frames / clip.fps) * 1000),
    travel: r2(clip.travel * s),
    stance: { start: clip.stance ?? null, end: clip.loop ? null : (clip.stance ?? null) },
    phases: clip.phases.map((phase) => ({ name: phase.name, from: phase.from, to: phase.to, fast: phase.fast })),
    frames: run.frames.map((fr): SidecarFrame => {
      const f = fr.frame
      const placed: Record<string, SocketAt> = {}
      for (const [name, socket] of Object.entries(sockets)) {
        if (!fr.shown.has(socket.bone)) continue
        const [x, y] = toFrame(...apply(fr.world[socket.bone]!, [socket.along, socket.across]))
        placed[name] = { x, y, angle: Math.round(wrap(-angleOf(fr.world[socket.bone]!)) * 10) / 10 + 0 }
      }
      let box: SidecarFrame["bounds"] = null
      if (fr.drawn.length > 0) {
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const d of fr.drawn) {
          const b = boundsOf(d.geom)
          const pad = d.outline === null ? 0 : d.line
          minX = Math.min(minX, (b.minX - pad) * s)
          maxX = Math.max(maxX, (b.maxX + pad) * s)
          minY = Math.min(minY, -(b.maxY + pad) * s)
          maxY = Math.max(maxY, -(b.minY - pad) * s)
        }
        const x = Math.floor(minX) + 0
        const y = Math.floor(minY) + 0
        box = { x, y, w: Math.ceil(maxX) - x, h: Math.ceil(maxY) - y }
      }
      const hitting = hit !== undefined && inSpans(f, hit.frames) && fr.shown.has(hit.bone)
      return {
        name: `${options.name} ${f}`,
        contacts: feet.filter((chain) => inSpans(f, clip.contacts[chain.name] ?? [[0, clip.frames - 1]]) && fr.shown.has(chain.end)).map((chain) => chain.end),
        sockets: placed,
        hit: hitting ? { from: toFrame(...apply(fr.world[hit.bone]!, [hit.from, 0])), to: toFrame(...apply(fr.world[hit.bone]!, [hit.to, 0])) } : null,
        bounds: box
      }
    })
  }
}

/** The whole sidecar: every clip's entry, and the frame's size and anchor at the bake's scale. */
export const sidecarOf = (rig: Rig, rigFile: string, scale: number, clips: Readonly<Record<string, SidecarClip>>): Sidecar => ({
  version: SIDECAR_VERSION,
  rig: rigFile,
  scale,
  size: [rig.width * scale, rig.height * scale],
  anchor: [rig.anchor[0] * scale, rig.anchor[1] * scale],
  clips
})

/** Where a bank's sidecar goes in the bake's folder: the bank's name with `.clips.json` (`hero.rig.json` -> `hero.rig.clips.json`). */
export const sidecarName = (bankFile: string): string => {
  const base = bankFile.split(/[\\/]/).pop() ?? bankFile
  return (base.endsWith(".json") ? base.slice(0, -".json".length) : base) + ".clips.json"
}

/**
 * The sidecar as JSON: the same sidecar, the same bytes. Each frame is one
 * line, so the file stays small and reads frame by frame in a diff.
 */
export const encodeSidecar = (sidecar: Sidecar): string => {
  const clips = Object.entries(sidecar.clips).map(([name, clip]) => {
    const { frames, ...head } = clip
    const lines = Object.entries(head).map(([key, value]) => `      ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
    const rows = frames.map((frame) => `        ${JSON.stringify(frame)}`)
    return `    ${JSON.stringify(name)}: {\n${lines.join(",\n")},\n      "frames": [\n${rows.join(",\n")}\n      ]\n    }`
  })
  const { clips: _, ...top } = sidecar
  const head = Object.entries(top).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
  return `{\n${head.join(",\n")},\n  "clips": {\n${clips.join(",\n")}\n  }\n}\n`
}

