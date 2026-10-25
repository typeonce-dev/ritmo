/**
 * The 2D helpers most games would otherwise rewrite, as plain data in and
 * plain data out, built on `Ops` so they replay the same on every engine.
 *
 * `Vec2` arithmetic and angles of vectors, `Angle` for headings, `Scalar` for
 * numbers moving toward a target, `Box2` edge boxes and `Segment2` walls at
 * any angle, `Collide2` swept circle collision against both that slides
 * along walls and never tunnels, and a `FlowField` that leads bodies around
 * walls. Values are validated by the game's own schema when they enter the
 * world; `Ops` and `Random` are in `@typeonce/ritmo`.
 */
export * as Angle from "./Angle.ts"
export * as Box2 from "./Box2.ts"
export * as Collide2 from "./Collide2.ts"
export * as FlowField from "./FlowField.ts"
export * as Scalar from "./Scalar.ts"
export * as Segment2 from "./Segment2.ts"
export * as Vec2 from "./Vec2.ts"
