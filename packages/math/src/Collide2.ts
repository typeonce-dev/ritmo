/**
 * Continuous collision for moving circles against static walls (axis-aligned
 * boxes and line segments) and circles.
 *
 * Movement is swept, not sampled: `sweepCircle` finds the first time of
 * contact along the whole displacement, so fast movers (dashes, projectiles)
 * cannot skip over a wall between two steps. `moveCircle` stops at walls and
 * slides along them. Walls are passed as {@link Walls}: `Box2` boxes for a
 * grid of rooms, `Segment2` segments for walls at any angle, or both.
 *
 * Every query returns `undefined` for "no contact", never throws, and
 * allocates only its result. Inputs are expected to be finite.
 *
 * @example
 * ```ts
 * declare const position: Vec2.Vec2, velocity: Vec2.Vec2
 * declare const radius: number, dt: number
 * declare const walls: ReadonlyArray<Box2.Box2>
 * declare const bumpedWall: () => void
 * // ---cut---
 * // Move a body by its velocity this step, sliding along the walls.
 * const moved = Collide2.moveCircle(position, Vec2.scale(velocity, dt), radius, { boxes: walls })
 * if (moved.blocked) bumpedWall()
 * ```
 *
 * @module Collide2
 * @docGroup helpers
 *
 * @categoryDescription Collision Types
 * Contacts and movement results.
 *
 * @categoryDescription Queries
 * First-contact sweeps and overlap tests.
 *
 * @categoryDescription Movement
 * Moving a circle through walls with sliding.
 */
import type { Box2 } from "./Box2.ts"
import * as Ops from "@typeonce/ritmo/Ops"
import type { Segment2 } from "./Segment2.ts"
import type { Vec2 } from "./Vec2.ts"

/**
 * A contact along a sweep.
 *
 * @category Collision Types
 */
export interface Hit {
  /** Fraction of the displacement travelled before contact, in [0, 1]. */
  readonly time: number
  /** Unit contact normal, pointing away from the wall. */
  readonly nx: number
  readonly ny: number
}

/**
 * The static walls a circle collides with: axis-aligned `boxes`, line
 * `segments`, or both. A missing list is no walls of that kind.
 *
 * @category Collision Types
 */
export interface Walls {
  readonly boxes?: ReadonlyArray<Box2>
  readonly segments?: ReadonlyArray<Segment2>
  /** Not a setting: an array of walls is passed by kind. */
  readonly length?: "pass walls by kind: { boxes: walls } or { segments: walls }"
}

const noBoxes: ReadonlyArray<Box2> = []
const noSegments: ReadonlyArray<Segment2> = []

/**
 * Where a moved circle ended up.
 *
 * @category Collision Types
 */
export interface MoveResult {
  readonly position: Vec2
  /**
   * Whether the move touched a wall on the way, not counting the push out of
   * a wall it started in. It does not say which wall, or whether the circle
   * rests on one now: probe for that with `sweepCircle` (see `moveCircle`).
   */
  readonly blocked: boolean
}

/**
 * The distance `pushOut` and `moveCircle` keep from walls after a contact
 * (in world units), so the next sweep starts outside the wall.
 *
 * @category Movement
 */
export const defaultSkin = 0.01

/**
 * Entry time in [0, 1] of the ray from (`ox`, `oy`) along (`dx`, `dy`) into
 * the circle at (`cx`, `cy`) of radius `r`, or `undefined` on a miss (or when
 * the ray starts inside or does not move).
 *
 * @category Queries
 */
export const rayCircle = (ox: number, oy: number, dx: number, dy: number, cx: number, cy: number, r: number): number | undefined => {
  const fx = ox - cx
  const fy = oy - cy
  const a = dx * dx + dy * dy
  const b = fx * dx + fy * dy
  const c = fx * fx + fy * fy - r * r
  if (a < 1e-12) return undefined
  const discriminant = b * b - a * c
  if (discriminant < 0) return undefined
  const t = (-b - Math.sqrt(discriminant)) / a
  return t >= 0 && t <= 1 ? t : undefined
}

/**
 * First contact of a circle of `radius` at `origin` moving by `delta` with
 * `box`, or `undefined`. Contact is computed against the box expanded by the
 * radius with rounded corners (the exact Minkowski sum), so sliding around
 * corners is smooth. A circle that starts exactly touching a face and moves
 * into it hits at time 0. A circle that starts overlapping the box is not
 * reported; resolve it with `pushOut` first.
 *
 * @category Queries
 */
export const sweepCircleBox = (origin: Vec2, delta: Vec2, radius: number, box: Box2): Hit | undefined => {
  const minX = box.minX - radius
  const minY = box.minY - radius
  const maxX = box.maxX + radius
  const maxY = box.maxY + radius
  // Slab test against the expanded box.
  let enter = 0
  let exit = 1
  let nx = 0
  let ny = 0
  if (Math.abs(delta.x) < 1e-12) {
    if (origin.x <= minX || origin.x >= maxX) return undefined
  } else {
    const inv = 1 / delta.x
    let t1 = (minX - origin.x) * inv
    let t2 = (maxX - origin.x) * inv
    let normal = -1
    if (t1 > t2) {
      const swap = t1
      t1 = t2
      t2 = swap
      normal = 1
    }
    // Entering at exactly 0 is a contact: a circle touching the face and
    // moving into it (a negative entry time means it is moving away).
    if (t1 > enter || (t1 === 0 && enter === 0)) {
      enter = 0 + t1
      nx = normal
      ny = 0
    }
    exit = Math.min(exit, t2)
    if (enter > exit) return undefined
  }
  if (Math.abs(delta.y) < 1e-12) {
    if (origin.y <= minY || origin.y >= maxY) return undefined
  } else {
    const inv = 1 / delta.y
    let t1 = (minY - origin.y) * inv
    let t2 = (maxY - origin.y) * inv
    let normal = -1
    if (t1 > t2) {
      const swap = t1
      t1 = t2
      t2 = swap
      normal = 1
    }
    if (t1 > enter || (t1 === 0 && enter === 0)) {
      enter = 0 + t1
      nx = 0
      ny = normal
    }
    exit = Math.min(exit, t2)
    if (enter > exit) return undefined
  }
  // Contact point on the expanded box (the start, when it begins inside the
  // square expansion). In a corner region the real surface is the rounded
  // corner, so test the corner circle instead: a circle starting in a corner
  // region is still outside the box, and can only reach it through that
  // corner.
  const hx = origin.x + delta.x * enter
  const hy = origin.y + delta.y * enter
  const cornerX = hx < box.minX ? box.minX : hx > box.maxX ? box.maxX : undefined
  const cornerY = hy < box.minY ? box.minY : hy > box.maxY ? box.maxY : undefined
  if (cornerX !== undefined && cornerY !== undefined) {
    const t = rayCircle(origin.x, origin.y, delta.x, delta.y, cornerX, cornerY, radius)
    if (t === undefined) return undefined
    const cx = origin.x + delta.x * t - cornerX
    const cy = origin.y + delta.y * t - cornerY
    const len = Ops.hypot(cx, cy) || 1
    return { time: t, nx: cx / len, ny: cy / len }
  }
  if (nx === 0 && ny === 0) return undefined // Started overlapping the box.
  return { time: enter, nx, ny }
}

/**
 * First contact of a circle of `radius` at `origin` moving by `delta` with
 * `segment`, or `undefined`. Contact is computed against the segment
 * thickened by the radius with round ends (the exact Minkowski sum), so the
 * circle slides along it and around its ends. A circle that starts exactly
 * touching it and moves into it hits at time 0. A circle that starts
 * overlapping the segment is not reported; resolve it with `pushOut` first.
 *
 * @category Queries
 */
export const sweepCircleSegment = (origin: Vec2, delta: Vec2, radius: number, segment: Segment2): Hit | undefined => {
  const ex = segment.bx - segment.ax
  const ey = segment.by - segment.ay
  const lengthSquared = ex * ex + ey * ey
  if (lengthSquared > 1e-12) {
    // The flat side facing the circle, `radius` away from the segment's line.
    const length = Math.sqrt(lengthSquared)
    let nx = -ey / length
    let ny = ex / length
    let side = (origin.x - segment.ax) * nx + (origin.y - segment.ay) * ny
    if (side < 0) {
      nx = -nx
      ny = -ny
      side = -side
    }
    if (side < radius) {
      // Beside the line: overlapping when level with the segment, otherwise
      // only its ends are in the way.
      const along = ((origin.x - segment.ax) * ex + (origin.y - segment.ay) * ey) / lengthSquared
      if (along >= 0 && along <= 1) return undefined
    } else {
      const into = delta.x * nx + delta.y * ny
      if (into < 0) {
        // `0 +` turns a -0 (touching at the start) into 0.
        const time = 0 + (radius - side) / into
        if (time <= 1) {
          const along = ((origin.x + delta.x * time - segment.ax) * ex + (origin.y + delta.y * time - segment.ay) * ey) / lengthSquared
          // The thickened segment is convex, so entering through its flat side is the first contact.
          if (along >= 0 && along <= 1) return { time, nx, ny }
        }
      }
    }
  }
  const atA = rayCircle(origin.x, origin.y, delta.x, delta.y, segment.ax, segment.ay, radius)
  const atB = lengthSquared > 1e-12 ? rayCircle(origin.x, origin.y, delta.x, delta.y, segment.bx, segment.by, radius) : undefined
  if (atA === undefined && atB === undefined) return undefined
  const fromA = atB === undefined || (atA !== undefined && atA <= atB)
  const time = fromA ? atA! : atB
  const cx = origin.x + delta.x * time - (fromA ? segment.ax : segment.bx)
  const cy = origin.y + delta.y * time - (fromA ? segment.ay : segment.by)
  const length = Ops.hypot(cx, cy) || 1
  return { time, nx: cx / length, ny: cy / length }
}

/**
 * First contact of a moving circle with any of `walls`, or `undefined`.
 *
 * With a `radius` of 0 the circle is a point and the sweep is a segment, so
 * this is also line of sight: `undefined` means nothing blocks the line from
 * `origin` to `origin + delta`. A box that already holds `origin` is not
 * reported, so an eye inside a wall sees out of it.
 *
 * @example
 * ```ts
 * declare const eye: Vec2.Vec2, target: Vec2.Vec2
 * declare const walls: ReadonlyArray<Box2.Box2>
 * // ---cut---
 * const sees = Collide2.sweepCircle(eye, Vec2.subtract(target, eye), 0, { boxes: walls }) === undefined
 * ```
 *
 * @category Queries
 */
export const sweepCircle = (origin: Vec2, delta: Vec2, radius: number, walls: Walls): Hit | undefined => {
  let first: Hit | undefined
  for (const box of walls.boxes ?? noBoxes) {
    const hit = sweepCircleBox(origin, delta, radius, box)
    if (hit !== undefined && (first === undefined || hit.time < first.time)) first = hit
  }
  for (const segment of walls.segments ?? noSegments) {
    const hit = sweepCircleSegment(origin, delta, radius, segment)
    if (hit !== undefined && (first === undefined || hit.time < first.time)) first = hit
  }
  return first
}

/**
 * First time in [0, 1] at which a circle of `radius` moving from `origin` by
 * `delta` touches a circle of `targetRadius` at `target`, or `undefined`. A
 * circle that starts overlapping touches at time 0.
 *
 * @category Queries
 */
export const sweepCircleCircle = (
  origin: Vec2,
  delta: Vec2,
  radius: number,
  target: Vec2,
  targetRadius: number
): number | undefined => {
  const r = radius + targetRadius
  const dx = origin.x - target.x
  const dy = origin.y - target.y
  if (dx * dx + dy * dy <= r * r) return 0
  return rayCircle(origin.x, origin.y, delta.x, delta.y, target.x, target.y, r)
}

/**
 * Whether a circle of `radius` at `center` overlaps (or touches) a circle of
 * `otherRadius` at `other`, without a square root. Touching counts, as in
 * `Box2.overlapsCircle` and `Segment2.overlapsCircle`. For a pickup or a hit
 * between bodies that have already moved; when one moves fast enough to pass
 * through the other in one step, use {@link sweepCircleCircle}.
 *
 * @category Queries
 */
export const overlapsCircleCircle = (center: Vec2, radius: number, other: Vec2, otherRadius: number): boolean => {
  const r = radius + otherRadius
  const dx = center.x - other.x
  const dy = center.y - other.y
  return dx * dx + dy * dy <= r * r
}

/**
 * Pushes a circle out of every wall it overlaps, boxes first and then
 * segments, each in order, leaving `skin` between it and each wall. Returns
 * the corrected center. A center inside a box leaves through the nearest
 * side; a center exactly on a segment leaves along the segment's left normal.
 *
 * @category Movement
 */
export const pushOut = (center: Vec2, radius: number, walls: Walls, skin: number = defaultSkin): Vec2 => {
  let x = center.x
  let y = center.y
  for (const box of walls.boxes ?? noBoxes) {
    const closestX = Math.max(box.minX, Math.min(x, box.maxX))
    const closestY = Math.max(box.minY, Math.min(y, box.maxY))
    const dx = x - closestX
    const dy = y - closestY
    const distanceSquared = dx * dx + dy * dy
    if (distanceSquared >= radius * radius) continue
    if (distanceSquared > 1e-12) {
      const distance = Math.sqrt(distanceSquared)
      x = closestX + (dx / distance) * (radius + skin)
      y = closestY + (dy / distance) * (radius + skin)
    } else {
      // Center inside the box: leave through the nearest side.
      const left = x - box.minX
      const right = box.maxX - x
      const top = y - box.minY
      const bottom = box.maxY - y
      const nearest = Math.min(left, right, top, bottom)
      if (nearest === left) x = box.minX - radius - skin
      else if (nearest === right) x = box.maxX + radius + skin
      else if (nearest === top) y = box.minY - radius - skin
      else y = box.maxY + radius + skin
    }
  }
  for (const segment of walls.segments ?? noSegments) {
    const ex = segment.bx - segment.ax
    const ey = segment.by - segment.ay
    const lengthSquared = ex * ex + ey * ey
    const along = lengthSquared > 1e-12 ? Math.max(0, Math.min(1, ((x - segment.ax) * ex + (y - segment.ay) * ey) / lengthSquared)) : 0
    const closestX = segment.ax + ex * along
    const closestY = segment.ay + ey * along
    const dx = x - closestX
    const dy = y - closestY
    const distanceSquared = dx * dx + dy * dy
    if (distanceSquared >= radius * radius) continue
    if (distanceSquared > 1e-12) {
      const distance = Math.sqrt(distanceSquared)
      x = closestX + (dx / distance) * (radius + skin)
      y = closestY + (dy / distance) * (radius + skin)
    } else if (lengthSquared > 1e-12) {
      // Center on the segment: leave along its left normal.
      const length = Math.sqrt(lengthSquared)
      x = closestX - (ey / length) * (radius + skin)
      y = closestY + (ex / length) * (radius + skin)
    } else {
      // Center on a round post: leave along +x.
      x = closestX + radius + skin
    }
  }
  return { x, y }
}

/**
 * Moves a circle by `delta`, stopping at walls and sliding along them (up to
 * four contacts per call). The whole path is swept, so no displacement can
 * tunnel through a wall. A circle that starts inside a wall is pushed out
 * first. A circle meeting a box's corner or a segment's end dead-on goes
 * around it rather than stopping against it.
 *
 * `blocked` says the move touched a wall, not which one, nor whether the
 * circle stands on one now (a circle resting on a floor and not moving into
 * it touches nothing). For a grounded or wall check, probe from the returned
 * position with `sweepCircle` a little farther than `skin`, and read the
 * hit's normal.
 *
 * @example
 * ```ts
 * declare const position: Vec2.Vec2, velocity: Vec2.Vec2
 * declare const radius: number, dt: number
 * declare const ledges: ReadonlyArray<Box2.Box2>
 * // ---cut---
 * // Fall, then look for a floor just under the moved circle (y points down).
 * const moved = Collide2.moveCircle(position, Vec2.scale(velocity, dt), radius, { boxes: ledges })
 * const below = Collide2.sweepCircle(moved.position, { x: 0, y: 2 * Collide2.defaultSkin }, radius, { boxes: ledges })
 * const grounded = below !== undefined && below.ny < -0.5
 * ```
 *
 * @example
 * ```ts
 * declare const position: Vec2.Vec2, delta: Vec2.Vec2
 * declare const radius: number
 * declare const nearbyWalls: ReadonlyArray<Segment2.Segment2>
 * // ---cut---
 * // A map traced from survey data: every wall is a segment.
 * const moved = Collide2.moveCircle(position, delta, radius, { segments: nearbyWalls })
 * ```
 *
 * @category Movement
 */
export const moveCircle = (start: Vec2, delta: Vec2, radius: number, walls: Walls, skin: number = defaultSkin): MoveResult => {
  let position = pushOut(start, radius, walls, skin)
  let rx = delta.x
  let ry = delta.y
  let blocked = false
  for (let iteration = 0; iteration < 4; iteration++) {
    if (rx * rx + ry * ry < 1e-12) break
    const step = { x: rx, y: ry }
    // The first contact, and whether it is round (a box's corner or a
    // segment's end) rather than a flat side.
    let hit: Hit | undefined
    let round = false
    for (const box of walls.boxes ?? noBoxes) {
      const found = sweepCircleBox(position, step, radius, box)
      if (found === undefined || (hit !== undefined && found.time >= hit.time)) continue
      hit = found
      round = found.nx !== 0 && found.ny !== 0
    }
    for (const segment of walls.segments ?? noSegments) {
      const found = sweepCircleSegment(position, step, radius, segment)
      if (found === undefined || (hit !== undefined && found.time >= hit.time)) continue
      hit = found
      const ex = segment.bx - segment.ax
      const ey = segment.by - segment.ay
      const lengthSquared = ex * ex + ey * ey
      const along = found.nx * ex + found.ny * ey
      // A flat side's normal is perpendicular to the segment.
      round = lengthSquared < 1e-12 || along * along > 1e-18 * lengthSquared
    }
    if (hit === undefined) {
      position = { x: position.x + rx, y: position.y + ry }
      break
    }
    blocked = true
    position = {
      x: position.x + rx * hit.time + hit.nx * skin,
      y: position.y + ry * hit.time + hit.ny * skin
    }
    // Slide: keep the remaining movement tangent to the contact.
    const remaining = 1 - hit.time
    rx *= remaining
    ry *= remaining
    const into = rx * hit.nx + ry * hit.ny
    if (into < 0) {
      rx -= into * hit.nx
      ry -= into * hit.ny
      // Dead-on into a rounded corner or end (as an exact diagonal meets an
      // axis-aligned box) nothing is left to slide along: go around it
      // instead of stopping against it.
      if (round && rx * rx + ry * ry < 1e-12 * into * into) {
        const side = rx * -hit.ny + ry * hit.nx < 0 ? -1 : 1
        rx = -hit.ny * -into * side
        ry = hit.nx * -into * side
      }
    }
  }
  return { position, blocked }
}
