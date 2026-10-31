import { Clock, Descriptor, Schema } from "@typeonce/ritmo"
import type { Vec2 } from "@typeonce/ritmo-math"
import type { Clips } from "./clips.ts"

/** The simulation's step: 60 a second; a clip at 24 fps shows each frame for 2 or 3 steps. */
export const step = Clock.hz(60)
export const Time = Clock.resource("Brawler/Time", step)

/** Where an entity stands, in pixels with y down: the baked clips' axes, so a clip's points add to it. */
export const Position = Descriptor.Component<Vec2.Vec2>()("Brawler/Position")
/** A target's body: the circle a hit segment must cross. */
export const Body = Descriptor.Component<{ readonly radius: number }>()("Brawler/Body")
export const Attacker = Descriptor.Tag("Brawler/Attacker")
export const Target = Descriptor.Tag("Brawler/Target")

/**
 * The attacker's animation: the clip it plays, the step it started on, the
 * clip frame that step shows (worked out from `Time`, never counted down),
 * and whether this play's hit has landed (a swing hits once).
 */
export interface Playing {
  readonly clip: string | null
  readonly started: number
  readonly frame: number
  readonly landed: boolean
}
export const Animation = Descriptor.Resource<Playing>()("Brawler/Animation")

/** A swing's hit landing on a target, on the clip frame it landed. */
export const Hit = Descriptor.Event<{ readonly target: number; readonly clip: string; readonly frame: number }>()("Brawler/Hit")
/** Every hit so far: what the tests and a HUD read. */
export const Hits = Descriptor.Resource<ReadonlyArray<{ readonly target: number; readonly clip: string; readonly frame: number; readonly step: number }>>()("Brawler/Hits")

/** The baked clips, decoded once at the boundary (`decodeClips`) and provided by the host. */
export const ClipBook = Descriptor.Service<Clips>()("Brawler/ClipBook")

export const Game = Schema.bind(Schema.fragment({
  components: { Position, Body, Attacker, Target },
  resources: { Time, Animation, Hits },
  events: { Hit }
}))
