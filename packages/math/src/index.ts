/**
 * Math for game code.
 *
 * Validated values (`Scalar`, `Vector2`, `Size2`, `Aabb`) expose
 * Result-returning constructors, a guard (`is`), and one `codec` each, so
 * they plug into `Descriptor.ConstructedComponent(Vector2.codec)` /
 * `ConstructedResource(Random.codec)` and are validated once at the boundary. `InputAxis` normalizes directional input.
 *
 * Hot-path helpers work on plain numbers every frame: `Vec2` arithmetic,
 * `Box2` edges, `Segment2` walls at any angle, `Collide2` swept circle
 * collision against both, a `SpatialGrid` broad
 * phase, a `FlowField` for finding the way around walls, and a deterministic
 * `Random` whose state is one integer.
 *
 * `Ops` holds the math functions engines are allowed to approximate (`sin`,
 * `cos`, `atan2`, `exp`, `pow`, `hypot`, ...) as ports that return the same
 * bits everywhere: use them in simulation code instead of `Math`'s.
 */
export * as Aabb from "./Aabb.ts"
export * as Box2 from "./Box2.ts"
export * as Collide2 from "./Collide2.ts"
export * as FlowField from "./FlowField.ts"
export * as InputAxis from "./InputAxis.ts"
export * as Scalar from "./Scalar.ts"
export * as Segment2 from "./Segment2.ts"
export * as Size2 from "./Size2.ts"
export * as SpatialGrid from "./SpatialGrid.ts"
export * as Vec2 from "./Vec2.ts"
export * as Vector2 from "./Vector2.ts"
