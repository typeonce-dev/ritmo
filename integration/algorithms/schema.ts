import { Descriptor, Random, Schema } from "@typeonce/ritmo"
import type { Box2, Vec2 } from "@typeonce/ritmo-math"

export const Position = Descriptor.Component<Vec2.Vec2>()("Algorithms/Position")
export const Body = Descriptor.Component<{ readonly radius: number; readonly speed: number }>()("Algorithms/Body")
export const Chaser = Descriptor.Tag("Algorithms/Chaser")
export const Player = Descriptor.Tag("Algorithms/Player")
export const Shot = Descriptor.Component<{ readonly velocity: Vec2.Vec2; readonly radius: number }>()("Algorithms/Shot")

/** The whole random state: one integer, saved with the world so a run replays. */
export const Rng = Descriptor.ConstructedResource(Random.codec)("Algorithms/Rng")
export const Walls = Descriptor.Resource<ReadonlyArray<Box2.Box2>>()("Algorithms/Walls")
export const Hits = Descriptor.Resource<ReadonlyArray<{ readonly shot: number; readonly kind: "wall" | "chaser"; readonly time: number }>>()("Algorithms/Hits")
export const Frame = Descriptor.Service<{ dt: number }>()("Algorithms/Frame")

export const Game = Schema.bind(Schema.fragment({
  components: { Position, Body, Chaser, Player, Shot },
  resources: { Rng, Walls, Hits }
}))
