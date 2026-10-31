/**
 * A headless brawl: one attacker plays a clip baked by `ritmo-tools rig
 * bake`, and its hits come from the clip's sidecar, not from numbers typed
 * into the game. Which clip plays and the step it started on are saved
 * state; the clip frame is worked out from the clock on every step. On each
 * frame the sidecar gives a hit for, the hit's capsule sweeps from where
 * the previous frame left it to where this one puts it, and the first
 * target it touches publishes one `Hit`.
 *
 * ```ts
 * const clips = decodeClips(JSON.parse(readFileSync("hero.rig.clips.json", "utf8")))
 * if (clips.ok) {
 *   const brawl = makeBrawl({ clips: clips.value, attacker: { x: 100, y: 300 }, target: { x: 205, y: 230 } })
 *   brawl.play("attack")
 *   for (let i = 0; i < 60; i++) brawl.step()
 * }
 * ```
 */
import { Clock } from "@typeonce/ritmo"
import { Segment2, Vec2 } from "@typeonce/ritmo-math"
import type { ClipData, Clips } from "./clips.ts"
import { Animation, Attacker, Body, ClipBook, Game, Hit, Hits, Position, step, Target, Time, type Playing } from "./schema.ts"

const AdvanceTime = Clock.system(Game, { name: "Brawler/AdvanceTime", resource: Time })

/** The clip frame a step shows: whole steps since the clip started, at the clip's fps; `undefined` before it starts and once a one-shot has ended. */
export const frameAt = (clip: ClipData, started: number, now: number, hz: number): number | undefined => {
  if (now < started) return undefined
  const frame = Math.floor(((now - started) * clip.fps) / hz)
  if (clip.loop) return frame % clip.frames.length
  return frame < clip.frames.length ? frame : undefined
}

/** A one-shot that has played to its end stops: the attacker plays nothing until the next `play`. */
const EndClip = Game.System("Brawler/EndClip", {
  resources: { time: Game.System.thisTick(Game.System.readResource(Time)), animation: Game.System.writeResource(Animation) },
  services: { clips: Game.System.service(ClipBook) }
}, ({ resources, services }) => {
  const playing = resources.animation.get()
  if (playing.clip === null) return
  const clip = services.clips.clips[playing.clip]
  const time = resources.time.get()
  if (clip === undefined || (time.step >= playing.started && frameAt(clip, playing.started, time.step, time.hz) === undefined))
    resources.animation.set({ clip: null, started: playing.started, landed: playing.landed })
})

type SidecarHit = NonNullable<ClipData["frames"][number]["hit"]>

/** A hit segment placed on its entity: the sidecar's points are from the clip's anchor, which stands on the entity's position. */
const placed = (at: Vec2.Vec2, hit: SidecarHit): Segment2.Segment2 =>
  Segment2.between(Vec2.add(at, { x: hit.from[0], y: hit.from[1] }), Vec2.add(at, { x: hit.to[0], y: hit.to[1] }))

/** The segment `k` of the way from `a` to `b` (both ends moving straight). */
const between = (a: Segment2.Segment2, b: Segment2.Segment2, k: number): Segment2.Segment2 => ({
  ax: a.ax + (b.ax - a.ax) * k,
  ay: a.ay + (b.ay - a.ay) * k,
  bx: a.bx + (b.bx - a.bx) * k,
  by: a.by + (b.by - a.by) * k
})

/** How many in-between segments a sweep tests: enough that no end moves more than this many pixels between two of them. */
const SWEEP_STEP = 4
const MAX_STEPS = 32

/**
 * Whether a hit's capsule touches a circle anywhere on its way from the
 * previous frame's segment to this frame's: the move is cut into
 * in-between segments a few pixels apart, each tested against the circle
 * grown by the hit's radius, so a fast swing cannot pass through a target
 * between two frames.
 */
const sweeps = (from: Segment2.Segment2 | undefined, to: Segment2.Segment2, radius: number, center: Vec2.Vec2, targetRadius: number): boolean => {
  const reach = radius + targetRadius
  if (from === undefined) return Segment2.overlapsCircle(to, center, reach)
  const move = Math.max(Vec2.length({ x: to.ax - from.ax, y: to.ay - from.ay }), Vec2.length({ x: to.bx - from.bx, y: to.by - from.by }))
  const steps = Math.min(MAX_STEPS, Math.max(1, Math.ceil(move / SWEEP_STEP)))
  for (let i = 1; i <= steps; i++) if (Segment2.overlapsCircle(between(from, to, i / steps), center, reach)) return true
  return false
}

const Strike = Game.System("Brawler/Strike", {
  queries: {
    attacker: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Attacker] }),
    targets: Game.Query({ selection: { position: Game.Query.read(Position), body: Game.Query.read(Body) }, with: [Target] })
  },
  resources: { time: Game.System.thisTick(Game.System.readResource(Time)), animation: Game.System.writeResource(Animation) },
  services: { clips: Game.System.service(ClipBook) },
  events: { hit: Game.System.writeEvent(Hit) }
}, ({ queries, resources, services, events }) => {
  const playing = resources.animation.get()
  if (playing.clip === null || playing.landed) return
  const clip = services.clips.clips[playing.clip]
  const time = resources.time.get()
  const frame = clip === undefined ? undefined : frameAt(clip, playing.started, time.step, time.hz)
  const hit = frame === undefined ? undefined : clip?.frames[frame]?.hit
  const at = queries.attacker.each()[0]?.data.position.get()
  if (frame === undefined || hit === undefined || hit === null || at === undefined) return
  const segment = placed(at, hit)
  const previous = clip?.frames[frame - 1]?.hit
  const before = previous === undefined || previous === null ? undefined : placed(at, previous)
  for (const target of queries.targets.each()) {
    if (!sweeps(before, segment, hit.radius, target.data.position.get(), target.data.body.get().radius)) continue
    events.hit.emit({ target: target.entity.id, clip: playing.clip, frame })
    resources.animation.set({ clip: playing.clip, started: playing.started, landed: true })
    return
  }
})

const RecordHits = Game.System("Brawler/RecordHits", {
  events: { hit: Game.System.readEvent(Hit) },
  resources: { time: Game.System.readResource(Time), hits: Game.System.writeResource(Hits) }
}, ({ events, resources }) => {
  const now = resources.time.get().step
  for (const hit of events.hit.all()) resources.hits.update((hits) => [...hits, { ...hit, step: now }])
})

const ReadBrawl = Game.Inspector("Brawler/ReadBrawl", {
  resources: { animation: Game.System.readResource(Animation), hits: Game.System.readResource(Hits), time: Game.System.readResource(Time) }
}, ({ resources }) => ({ animation: resources.animation.get(), hits: resources.hits.get(), step: resources.time.get().step }))

export interface BrawlOptions {
  /** The baked clips, decoded with `decodeClips`. */
  readonly clips: Clips
  readonly attacker: Vec2.Vec2
  readonly target: Vec2.Vec2
  /** The target's body radius, in pixels. */
  readonly radius?: number
}

const resting: Playing = { clip: null, started: 0, landed: false }

/** One attacker facing one target, ready to play a clip and step. */
export const makeBrawl = (options: BrawlOptions) => {
  const made = Game.Runtime.make({
    resources: { Time: Clock.start(step), Animation: resting, Hits: [] },
    services: Game.Runtime.services(Game.Runtime.service(ClipBook, options.clips))
  })
  // The clock's first value always validates; the Result covers validated resources in general.
  if (!made.ok) throw new Error("the brawl's resources did not validate")
  const runtime = made.value
  const Spawn = Game.System("Brawler/Spawn", { commands: Game.System.commands(Game.System.spawns(Position, Attacker, Body, Target)) }, ({ commands }) => {
    commands.spawn(Game.Command.spawn([Position, options.attacker], [Attacker, {}]))
    commands.spawn(Game.Command.spawn([Position, options.target], [Body, { radius: options.radius ?? 12 }], [Target, {}]))
  })
  const spawned = runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
  if (!spawned.ok) throw new Error("spawning failed")
  const update = Game.Schedule(AdvanceTime, Strike, EndClip, RecordHits)
  return {
    runtime,
    /** Starts a clip from the next step, its hit not landed yet. */
    play: (clip: string) => {
      const Play = Game.System("Brawler/Play", {
        resources: { time: Game.System.readResource(Time), animation: Game.System.writeResource(Animation) }
      }, ({ resources }) => {
        resources.animation.set({ clip, started: resources.time.get().step + 1, landed: false })
      })
      return runtime.tick(Game.Schedule(Play))
    },
    step: () => runtime.tick(update),
    read: () => runtime.inspect(ReadBrawl)
  }
}
