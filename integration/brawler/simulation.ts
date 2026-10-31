/**
 * A headless brawl: one attacker plays a clip baked by `ritmo-tools rig
 * bake`, and its hits come from the clip's sidecar, not from numbers typed
 * into the game. The swing's frame comes from the clock; on each frame the
 * sidecar gives a hit segment for, the segment sweeps against every
 * target's circle, and the first contact publishes one `Hit`.
 *
 * ```ts
 * const clips = decodeClips(JSON.parse(readFileSync("hero.rig.clips.json", "utf8")))
 * if (clips.ok) {
 *   const brawl = makeBrawl({ clips: clips.value, attacker: { x: 100, y: 300 }, target: { x: 205, y: 228 } })
 *   brawl.play("attack")
 *   for (let i = 0; i < 60; i++) brawl.step()
 * }
 * ```
 */
import { Clock } from "@typeonce/ritmo"
import { Collide2, Segment2, Vec2 } from "@typeonce/ritmo-math"
import type { ClipData, Clips } from "./clips.ts"
import { Animation, Attacker, Body, ClipBook, Game, Hit, Hits, Position, step, Target, Time } from "./schema.ts"

const AdvanceTime = Clock.system(Game, { name: "Brawler/AdvanceTime", resource: Time })

/** The clip frame a step shows: whole steps since the clip started, at the clip's fps; a one-shot past its last frame has ended. */
const frameAt = (clip: ClipData, started: number, now: number, hz: number): number | undefined => {
  const frame = Math.floor(((now - started) * clip.fps) / hz)
  if (clip.loop) return frame % clip.frames.length
  return frame < clip.frames.length ? frame : undefined
}

const Animate = Game.System("Brawler/Animate", {
  resources: { time: Game.System.thisTick(Game.System.readResource(Time)), animation: Game.System.writeResource(Animation) },
  services: { clips: Game.System.service(ClipBook) }
}, ({ resources, services }) => {
  const playing = resources.animation.get()
  if (playing.clip === null) return
  const clip = services.clips.clips[playing.clip]
  const time = resources.time.get()
  const frame = clip === undefined ? undefined : frameAt(clip, playing.started, time.step, time.hz)
  resources.animation.set(frame === undefined ? { clip: null, started: playing.started, frame: 0, landed: playing.landed } : { ...playing, frame })
})

/** A hit segment placed on its entity: the sidecar's points are from the clip's anchor, which stands on the entity's position. */
const placed = (at: Vec2.Vec2, hit: { readonly from: readonly [number, number]; readonly to: readonly [number, number] }): Segment2.Segment2 =>
  Segment2.between(Vec2.add(at, { x: hit.from[0], y: hit.from[1] }), Vec2.add(at, { x: hit.to[0], y: hit.to[1] }))

const middle = (segment: Segment2.Segment2): Vec2.Vec2 => ({ x: (segment.ax + segment.bx) / 2, y: (segment.ay + segment.by) / 2 })

/**
 * Sweeps this frame's hit segment against every target: the segment's move
 * since the frame before (as the move of its middle, when that frame had a
 * segment too) seen from the target, so a fast swing does not pass through
 * a target between two frames. The first hit of a play publishes `Hit` once.
 */
const Strike = Game.System("Brawler/Strike", {
  queries: {
    attacker: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Attacker] }),
    targets: Game.Query({ selection: { position: Game.Query.read(Position), body: Game.Query.read(Body) }, with: [Target] })
  },
  resources: { animation: Game.System.writeResource(Animation) },
  services: { clips: Game.System.service(ClipBook) },
  events: { hit: Game.System.writeEvent(Hit) }
}, ({ queries, resources, services, events }) => {
  const playing = resources.animation.get()
  if (playing.clip === null || playing.landed) return
  const frames = services.clips.clips[playing.clip]?.frames
  const hit = frames?.[playing.frame]?.hit
  const at = queries.attacker.each()[0]?.data.position.get()
  if (hit === undefined || hit === null || at === undefined) return
  const segment = placed(at, hit)
  const before = frames?.[playing.frame - 1]?.hit
  const moved = before === undefined || before === null ? Vec2.zero : Vec2.subtract(middle(segment), middle(placed(at, before)))
  for (const target of queries.targets.each()) {
    const center = target.data.position.get()
    const radius = target.data.body.get().radius
    // Seen from the segment, the target moved back along the segment's move, so it is the circle that sweeps.
    const swept = Vec2.length(moved) > 0 && Collide2.sweepCircleSegment(Vec2.add(center, moved), Vec2.scale(moved, -1), radius, segment) !== undefined
    if (!swept && !Segment2.overlapsCircle(segment, center, radius)) continue
    events.hit.emit({ target: target.entity.id, clip: playing.clip, frame: playing.frame })
    resources.animation.set({ ...playing, landed: true })
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

/** One attacker facing one target, ready to play a clip and step. */
export const makeBrawl = (options: BrawlOptions) => {
  const made = Game.Runtime.make({
    resources: { Time: Clock.start(step), Animation: { clip: null, started: 0, frame: 0, landed: false }, Hits: [] },
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
  const update = Game.Schedule(AdvanceTime, Animate, Strike, RecordHits)
  return {
    runtime,
    /** Starts a clip from the next step, its hit not landed yet. */
    play: (clip: string) => {
      const Play = Game.System("Brawler/Play", {
        resources: { time: Game.System.readResource(Time), animation: Game.System.writeResource(Animation) }
      }, ({ resources }) => {
        resources.animation.set({ clip, started: resources.time.get().step + 1, frame: 0, landed: false })
      })
      return runtime.tick(Game.Schedule(Play))
    },
    step: () => runtime.tick(update),
    read: () => runtime.inspect(ReadBrawl)
  }
}
