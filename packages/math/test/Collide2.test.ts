import { describe, expect, it } from "vitest"

import { Random } from "@typeonce/ritmo"
import { Box2, Collide2, Segment2, type Vec2 } from "@typeonce/ritmo-math"

describe("Collide2", () => {
  const thin: Box2.Box2 = { minX: 100, minY: -1000, maxX: 102, maxY: 1000 }

  it("stops a fast circle at a thin wall instead of tunneling through", () => {
    // 5000 units in one step against a 2-unit wall.
    const moved = Collide2.moveCircle({ x: 0, y: 0 }, { x: 5000, y: 0 }, 10, { boxes: [thin] })
    expect(moved.blocked).toBe(true)
    expect(moved.position.x).toBeCloseTo(90, 1)
    expect(moved.position.x).toBeLessThan(90)
  })

  it("slides along a wall, keeping the tangential motion", () => {
    const moved = Collide2.moveCircle({ x: 80, y: 0 }, { x: 40, y: 30 }, 10, { boxes: [thin] })
    expect(moved.position.x).toBeCloseTo(90, 1)
    expect(moved.position.y).toBeCloseTo(30, 5)
  })

  it("goes around a corner it meets dead-on instead of stopping against it", () => {
    const box = Box2.around(100, -100, 30, 30)
    let position = { x: 0, y: 0 }
    // Exactly along the diagonal at the box's corner (70, -70).
    for (let step = 0; step < 40; step++) position = Collide2.moveCircle(position, { x: 5, y: -5 }, 10, { boxes: [box] }).position
    expect(position.x - position.y).toBeGreaterThan(200)
    expect(Box2.overlapsCircle(box, position, 10 - 1e-6)).toBe(false)
  })

  it("stops a circle that starts exactly touching a wall and moves into it", () => {
    // Centre at 90 with radius 10 touches the face at 100: a snapped spawn point.
    const into = Collide2.moveCircle({ x: 90, y: 0 }, { x: 50, y: 0 }, 10, { boxes: [thin] })
    expect(into.blocked).toBe(true)
    expect(into.position.x).toBeLessThanOrEqual(90)
    // From the right face, moving left.
    const back = Collide2.moveCircle({ x: 112, y: 0 }, { x: -50, y: 0 }, 10, { boxes: [thin] })
    expect(back.blocked).toBe(true)
    expect(back.position.x).toBeGreaterThanOrEqual(112)
    expect(Collide2.sweepCircleBox({ x: 90, y: 0 }, { x: 50, y: 0 }, 10, thin)).toEqual({ time: 0, nx: -1, ny: 0 })
  })

  it("lets a circle touching a wall move away from it or slide along it", () => {
    expect(Collide2.moveCircle({ x: 90, y: 0 }, { x: -50, y: 0 }, 10, { boxes: [thin] })).toEqual({ position: { x: 40, y: 0 }, blocked: false })
    expect(Collide2.moveCircle({ x: 90, y: 0 }, { x: 0, y: 50 }, 10, { boxes: [thin] })).toEqual({ position: { x: 90, y: 50 }, blocked: false })
    const sliding = Collide2.moveCircle({ x: 90, y: 0 }, { x: 30, y: 40 }, 10, { boxes: [thin] })
    expect(sliding.position.x).toBeLessThanOrEqual(90)
    expect(sliding.position.y).toBeCloseTo(40, 5)
  })

  it("moves freely when nothing is in the way", () => {
    expect(Collide2.moveCircle({ x: 0, y: 0 }, { x: 50, y: 20 }, 10, { boxes: [thin] })).toEqual({ position: { x: 50, y: 20 }, blocked: false })
  })

  it("hits rounded corners, not the square expanded box", () => {
    const box = Box2.around(0, 0, 10, 10)
    // Passes the corner diagonally, inside the square expansion but outside the rounded one.
    expect(Collide2.sweepCircleBox({ x: -30, y: 20 }, { x: 60, y: -0.0001 }, 9.5, box)).toBeUndefined()
    expect(Collide2.sweepCircleBox({ x: 18, y: 18 }, { x: 1, y: 1 }, 5, box)).toBeUndefined()
    expect(Collide2.sweepCircleBox({ x: 25, y: 25 }, { x: -20, y: -20 }, 5, box)?.nx).toBeCloseTo(Math.SQRT1_2, 5)
  })

  it("does not report a circle that starts overlapping, and pushes it out through the nearest side", () => {
    const box = Box2.around(0, 0, 50, 10)
    expect(Collide2.sweepCircleBox({ x: 5, y: 2 }, { x: 100, y: 0 }, 4, box)).toBeUndefined()
    const out = Collide2.pushOut({ x: 5, y: 2 }, 4, { boxes: [box] })
    expect(out.y).toBeCloseTo(14, 1)
    expect(out.x).toBe(5)
  })

  it("answers line of sight with a radius of 0", () => {
    const wall = Box2.around(0, 0, 10, 10)
    const sees = (eye: { x: number; y: number }, target: { x: number; y: number }) =>
      Collide2.sweepCircle(eye, { x: target.x - eye.x, y: target.y - eye.y }, 0, { boxes: [wall] }) === undefined
    expect(sees({ x: -50, y: 0 }, { x: 50, y: 0 })).toBe(false)
    expect(sees({ x: -50, y: 11 }, { x: 50, y: 11 })).toBe(true)
    expect(sees({ x: -50, y: 0 }, { x: -20, y: 0 })).toBe(true)
    // Diagonally past the corner (10, 10), just outside it.
    expect(sees({ x: 0, y: 30 }, { x: 30, y: 0 })).toBe(true)
    // Diagonally through the box, clipping its corner.
    expect(sees({ x: 0, y: 15 }, { x: 15, y: 0 })).toBe(false)
    // An eye inside the wall sees out of it.
    expect(sees({ x: 0, y: 0 }, { x: 50, y: 0 })).toBe(true)
  })

  it("finds the first of several walls", () => {
    const near = Box2.around(50, 0, 5, 50)
    const far = Box2.around(150, 0, 5, 50)
    expect(Collide2.sweepCircle({ x: 0, y: 0 }, { x: 200, y: 0 }, 5, { boxes: [far, near] })?.time).toBeCloseTo(40 / 200, 9)
  })

  it("sweeps circles against circles, touching at 0 when they start overlapping", () => {
    expect(Collide2.sweepCircleCircle({ x: 0, y: 0 }, { x: 100, y: 0 }, 5, { x: 50, y: 0 }, 5)).toBeCloseTo(0.4, 9)
    expect(Collide2.sweepCircleCircle({ x: 0, y: 0 }, { x: 100, y: 0 }, 5, { x: 50, y: 20 }, 5)).toBeUndefined()
    expect(Collide2.sweepCircleCircle({ x: 0, y: 0 }, { x: -100, y: 0 }, 5, { x: 8, y: 0 }, 5)).toBe(0)
  })

  it("finds a contact starting near a corner, inside the square expansion but outside the rounded one", () => {
    // Moving into the corner from beside it, where only the rounded corner is in the way.
    const box: Box2.Box2 = { minX: -12.86, minY: -41.08, maxX: 19.99, maxY: 27.18 }
    const hit = Collide2.sweepCircleBox({ x: -20.68, y: -47.87 }, { x: 76.46, y: -17.05 }, 9.55, box)
    expect(hit).toBeDefined()
    expect(hit!.nx).toBeLessThan(0)
    expect(hit!.ny).toBeLessThan(0)
  })

  it("agrees with a fine-stepped reference on the first contact time and normal", () => {
    // The reference walks the path in tiny steps and reports the first step
    // whose circle overlaps the box: the sweep's time must fall within one
    // step of it, and its normal must point from the box to that circle.
    const random = Random.make(2024)
    const steps = 4000
    let contacts = 0
    for (let sample = 0; sample < 3000; sample++) {
      const box = Box2.around(random.range(-50, 50), random.range(-50, 50), random.range(1, 40), random.range(1, 40))
      const radius = random.range(0.5, 20)
      const origin = { x: random.range(-150, 150), y: random.range(-150, 150) }
      const delta = { x: random.range(-300, 300), y: random.range(-300, 300) }
      if (Box2.overlapsCircle(box, origin, radius)) continue
      let reference: number | undefined
      for (let step = 1; step <= steps; step++) {
        const t = step / steps
        if (Box2.overlapsCircle(box, { x: origin.x + delta.x * t, y: origin.y + delta.y * t }, radius)) {
          reference = t
          break
        }
      }
      const hit = Collide2.sweepCircleBox(origin, delta, radius, box)
      if (reference === undefined) {
        // A graze shorter than one reference step may be found by the sweep only.
        if (hit !== undefined) expect(hit.time).toBeGreaterThan(0)
        continue
      }
      contacts++
      expect(hit).toBeDefined()
      expect(hit!.time).toBeLessThanOrEqual(reference + 1e-9)
      expect(hit!.time).toBeGreaterThanOrEqual(reference - 1 / steps - 1e-9)
      expect(Math.hypot(hit!.nx, hit!.ny)).toBeCloseTo(1, 9)
      const at = { x: origin.x + delta.x * hit!.time, y: origin.y + delta.y * hit!.time }
      const nearest = { x: Math.max(box.minX, Math.min(at.x, box.maxX)), y: Math.max(box.minY, Math.min(at.y, box.maxY)) }
      expect(Math.hypot(at.x - nearest.x, at.y - nearest.y)).toBeCloseTo(radius, 6)
      expect((at.x - nearest.x) * hit!.nx + (at.y - nearest.y) * hit!.ny).toBeGreaterThan(0)
    }
    expect(contacts).toBeGreaterThan(250)
  })

  it("never lets a moved circle end inside a wall", () => {
    const random = Random.make(7)
    const walls = Array.from({ length: 12 }, () => Box2.around(random.range(-300, 300), random.range(-300, 300), random.range(5, 60), random.range(5, 60)))
    let position = { x: 0, y: 0 }
    const radius = 8
    for (let step = 0; step < 2000; step++) {
      const moved = Collide2.moveCircle(position, { x: random.range(-120, 120), y: random.range(-120, 120) }, radius, { boxes: walls })
      position = moved.position
      // Contacts leave a skin; walls the circle was pushed out of earlier may
      // still touch when two overlap, so allow a hair of slack.
      for (const wall of walls) expect(Box2.overlapsCircle(wall, position, radius - 1e-6)).toBe(false)
    }
  })

  it("finds the floor with a sweepCircle probe past the skin, which blocked does not tell", () => {
    const floor = Box2.around(0, 100, 200, 10)
    const walls = { boxes: [floor] }
    const probe = (center: { x: number; y: number }) => Collide2.sweepCircle(center, { x: 0, y: 2 * Collide2.defaultSkin }, 10, walls)
    // Landing: the move is blocked, and the probe finds a floor facing up
    const landed = Collide2.moveCircle({ x: 0, y: 0 }, { x: 0, y: 200 }, 10, walls)
    expect(landed.blocked).toBe(true)
    expect(probe(landed.position)?.ny).toBe(-1)
    // Sliding along the floor touches nothing, yet the circle stands on it
    const slid = Collide2.moveCircle(landed.position, { x: 50, y: 0 }, 10, walls)
    expect(slid.blocked).toBe(false)
    expect(probe(slid.position)?.ny).toBe(-1)
    // Off the edge, the probe finds nothing
    expect(probe({ x: 400, y: landed.position.y })).toBeUndefined()
  })

  describe("segments", () => {
    // A wall at 30°, from (0, 0) to (200, 115.47).
    const slanted = Segment2.between({ x: 0, y: 0 }, { x: 200, y: 200 * Math.tan(Math.PI / 6) })
    const vertical = Segment2.between({ x: 100, y: -1000 }, { x: 100, y: 1000 })

    it("stops a fast circle at a segment instead of tunneling through", () => {
      const moved = Collide2.moveCircle({ x: 0, y: 0 }, { x: 5000, y: 0 }, 10, { segments: [vertical] })
      expect(moved.blocked).toBe(true)
      expect(moved.position.x).toBeCloseTo(90, 1)
      expect(moved.position.x).toBeLessThan(90)
    })

    it("keeps a circle off both sides of a segment", () => {
      const back = Collide2.moveCircle({ x: 200, y: 0 }, { x: -500, y: 0 }, 10, { segments: [vertical] })
      expect(back.blocked).toBe(true)
      expect(back.position.x).toBeCloseTo(110, 1)
      expect(back.position.x).toBeGreaterThan(110)
    })

    it("slides along a slanted segment, keeping the tangential motion", () => {
      // Start 20 below the wall's middle and push straight up: the wall turns the push along it.
      const middle = { x: 100, y: 100 * Math.tan(Math.PI / 6) }
      const normal = { x: Math.sin(Math.PI / 6), y: -Math.cos(Math.PI / 6) }
      const start = { x: middle.x + normal.x * 20, y: middle.y + normal.y * 20 }
      const moved = Collide2.moveCircle(start, { x: 0, y: 40 }, 10, { segments: [slanted] })
      expect(moved.blocked).toBe(true)
      expect(Segment2.overlapsCircle(slanted, moved.position, 10 - 1e-6)).toBe(false)
      // Only the push along the wall is left: 40 · sin 30° = 20 along it.
      const along = (moved.position.x - start.x) * Math.cos(Math.PI / 6) + (moved.position.y - start.y) * Math.sin(Math.PI / 6)
      expect(along).toBeCloseTo(20, 1)
    })

    it("stops a circle that meets a slanted segment's flat side dead-on", () => {
      const middle = { x: 100, y: 100 * Math.tan(Math.PI / 6) }
      const normal = { x: Math.sin(Math.PI / 6), y: -Math.cos(Math.PI / 6) }
      const start = { x: middle.x + normal.x * 30, y: middle.y + normal.y * 30 }
      const moved = Collide2.moveCircle(start, { x: -normal.x * 50, y: -normal.y * 50 }, 10, { segments: [slanted] })
      expect(moved.blocked).toBe(true)
      expect(Math.hypot(moved.position.x - middle.x, moved.position.y - middle.y)).toBeCloseTo(10, 1)
    })

    it("goes around a segment's end it meets dead-on instead of stopping against it", () => {
      const post = Segment2.between({ x: 100, y: 0 }, { x: 100, y: 0 })
      let position = { x: 0, y: 0 }
      for (let step = 0; step < 40; step++) position = Collide2.moveCircle(position, { x: 5, y: 0 }, 10, { segments: [post] }).position
      expect(position.x).toBeGreaterThan(150)
      expect(Segment2.overlapsCircle(post, position, 10 - 1e-6)).toBe(false)
    })

    it("hits a segment's round ends, not a square end", () => {
      const short = Segment2.between({ x: 0, y: 0 }, { x: 100, y: 0 })
      // Diagonally past the end at (100, 0), inside the square thickening but 11.3 from the end.
      expect(Collide2.sweepCircleSegment({ x: 98, y: 18 }, { x: 20, y: -20 }, 10, short)).toBeUndefined()
      const hit = Collide2.sweepCircleSegment({ x: 130, y: 0 }, { x: -60, y: 0 }, 10, short)
      expect(hit?.time).toBeCloseTo(20 / 60, 9)
      expect(hit?.nx).toBeCloseTo(1, 9)
    })

    it("stops a circle that starts touching a segment and moves into it, and lets it move away", () => {
      expect(Collide2.sweepCircleSegment({ x: 90, y: 0 }, { x: 50, y: 0 }, 10, vertical)).toEqual({ time: 0, nx: -1, ny: 0 })
      expect(Collide2.moveCircle({ x: 90, y: 0 }, { x: -50, y: 0 }, 10, { segments: [vertical] })).toEqual({ position: { x: 40, y: 0 }, blocked: false })
    })

    it("does not report a circle that starts overlapping, and pushes it out", () => {
      expect(Collide2.sweepCircleSegment({ x: 95, y: 0 }, { x: -100, y: 0 }, 10, vertical)).toBeUndefined()
      expect(Collide2.pushOut({ x: 95, y: 3 }, 10, { segments: [vertical] }).x).toBeCloseTo(89.99, 6)
      // A center exactly on the wall leaves along its left normal, (-1, 0) for a wall going up.
      expect(Collide2.pushOut({ x: 100, y: 3 }, 10, { segments: [vertical] }).x).toBeCloseTo(89.99, 6)
    })

    it("answers line of sight through segments with a radius of 0", () => {
      const sees = (eye: { x: number; y: number }, target: { x: number; y: number }) =>
        Collide2.sweepCircle(eye, { x: target.x - eye.x, y: target.y - eye.y }, 0, { segments: [slanted] }) === undefined
      expect(sees({ x: 100, y: -50 }, { x: 100, y: 200 })).toBe(false)
      expect(sees({ x: 250, y: -50 }, { x: 250, y: 200 })).toBe(true)
    })

    it("finds the first contact across boxes and segments", () => {
      const box = Box2.around(150, 0, 5, 50)
      const hit = Collide2.sweepCircle({ x: 0, y: 0 }, { x: 200, y: 0 }, 5, { boxes: [box], segments: [vertical] })
      expect(hit?.time).toBeCloseTo(95 / 200, 9)
      expect(Collide2.sweepCircle({ x: 0, y: 0 }, { x: 200, y: 0 }, 5, {})).toBeUndefined()
    })

    it("agrees with a fine-stepped reference on the first contact time and normal", () => {
      const random = Random.make(2025)
      const steps = 4000
      let contacts = 0
      for (let sample = 0; sample < 3000; sample++) {
        const segment = Segment2.between(
          { x: random.range(-80, 80), y: random.range(-80, 80) },
          sample % 10 === 0 ? { x: 0, y: 0 } : { x: random.range(-80, 80), y: random.range(-80, 80) }
        )
        const radius = random.range(0.5, 20)
        const origin = { x: random.range(-150, 150), y: random.range(-150, 150) }
        const delta = { x: random.range(-300, 300), y: random.range(-300, 300) }
        if (Segment2.overlapsCircle(segment, origin, radius)) continue
        let reference: number | undefined
        for (let step = 1; step <= steps; step++) {
          const t = step / steps
          if (Segment2.overlapsCircle(segment, { x: origin.x + delta.x * t, y: origin.y + delta.y * t }, radius)) {
            reference = t
            break
          }
        }
        const hit = Collide2.sweepCircleSegment(origin, delta, radius, segment)
        if (reference === undefined) {
          if (hit !== undefined) expect(hit.time).toBeGreaterThan(0)
          continue
        }
        contacts++
        expect(hit).toBeDefined()
        expect(hit!.time).toBeLessThanOrEqual(reference + 1e-9)
        expect(hit!.time).toBeGreaterThanOrEqual(reference - 1 / steps - 1e-9)
        expect(Math.hypot(hit!.nx, hit!.ny)).toBeCloseTo(1, 9)
        const at = { x: origin.x + delta.x * hit!.time, y: origin.y + delta.y * hit!.time }
        const nearest = Segment2.closestPoint(segment, at)
        expect(Math.hypot(at.x - nearest.x, at.y - nearest.y)).toBeCloseTo(radius, 6)
        expect((at.x - nearest.x) * hit!.nx + (at.y - nearest.y) * hit!.ny).toBeGreaterThan(0)
      }
      expect(contacts).toBeGreaterThan(250)
    })

    it("never lets a moved circle end inside a wall of boxes and segments", () => {
      const random = Random.make(11)
      const boxes = Array.from({ length: 6 }, () => Box2.around(random.range(-300, 300), random.range(-300, 300), random.range(5, 60), random.range(5, 60)))
      const segments = Array.from({ length: 12 }, () => {
        const a = { x: random.range(-300, 300), y: random.range(-300, 300) }
        return Segment2.between(a, { x: a.x + random.range(-120, 120), y: a.y + random.range(-120, 120) })
      })
      let position = { x: 0, y: 0 }
      const radius = 8
      for (let step = 0; step < 2000; step++) {
        const delta = { x: random.range(-120, 120), y: random.range(-120, 120) }
        position = Collide2.moveCircle(position, delta, radius, { boxes, segments }).position
        for (const segment of segments) expect(Segment2.overlapsCircle(segment, position, radius - 1e-6)).toBe(false)
        for (const box of boxes) expect(Box2.overlapsCircle(box, position, radius - 1e-6)).toBe(false)
      }
    })
  })

  describe("walls closing in", () => {
    // A crate 9 from a wall, with a circle 12 wide: no room between them.
    const wall: Box2.Box2 = { minX: -20, minY: -1000, maxX: 0, maxY: 1000 } // the room is x > 0
    const crate: Box2.Box2 = { minX: 9, minY: 70, maxX: 60, maxY: 120 }

    it("does not pass through a wall after a slide brings it beside a neighbouring one", () => {
      const boxes = [wall, crate]
      const start = { x: 6.01, y: 64.79 } // resting on the wall, not overlapping
      expect(boxes.some((box) => Box2.overlapsCircle(box, start, 6))).toBe(false)
      const slid = Collide2.moveCircle(start, { x: -10, y: 10 }, 6, { boxes })
      for (const box of boxes) expect(Box2.overlapsCircle(box, slid.position, 6 - 1e-6)).toBe(false)
      const pushed = Collide2.moveCircle(slid.position, { x: -30, y: 0 }, 6, { boxes })
      expect(pushed.position.x).toBeGreaterThan(0)
    })

    it("does not pass through a wall when it starts inside the gap, with no room to push it out", () => {
      // Overlapping the crate: pushed out of it, it lands in the wall.
      const moved = Collide2.moveCircle({ x: 6.01, y: 74.79 }, { x: -30, y: 0 }, 6, { boxes: [wall, crate] })
      expect(moved.position.x).toBeGreaterThan(0)
      expect(moved.blocked).toBe(true)
    })

    it("stays inside an acute wedge, stopping where it no longer fits", () => {
      const angle = (20 * Math.PI) / 180
      const floor = Segment2.between({ x: 0, y: 0 }, { x: 400, y: 0 })
      const slope = Segment2.between({ x: 0, y: 0 }, { x: 400 * Math.cos(angle), y: 400 * Math.sin(angle) })
      // Above the floor and below the slope, at least the radius from both.
      const inside = (at: Vec2.Vec2) => at.y >= 5 - 1e-6 && at.x * Math.sin(angle) - at.y * Math.cos(angle) >= 5 - 1e-6
      let position: Vec2.Vec2 = { x: 200, y: 30 }
      let moved: Collide2.MoveResult | undefined
      for (let step = 0; step < 20; step++) {
        moved = Collide2.moveCircle(position, { x: -20, y: -3 }, 5, { segments: [floor, slope] })
        position = moved.position
        expect(inside(position)).toBe(true)
      }
      // Wedged where the walls are 10 apart: 5 / sin(10°) from the apex, along the middle.
      expect(moved!.blocked).toBe(true)
      expect(Math.hypot(position.x, position.y)).toBeCloseTo(5 / Math.sin(angle / 2), 1)
    })

    it("pushes a circle out of both walls of an acute corner", () => {
      const angle = (30 * Math.PI) / 180
      const segments = [
        Segment2.between({ x: 0, y: 0 }, { x: 400, y: 0 }),
        Segment2.between({ x: 0, y: 0 }, { x: 400 * Math.cos(angle), y: 400 * Math.sin(angle) })
      ]
      // Overlapping both: out of the floor is deeper into the slope, and back.
      const out = Collide2.pushOut({ x: 12, y: 2 }, 5, { segments })
      for (const segment of segments) expect(Segment2.overlapsCircle(segment, out, 5 - 1e-6)).toBe(false)
      // Still between them, where the walls are 10 apart.
      expect(out.y).toBeGreaterThan(0)
      expect(out.x * Math.sin(angle) - out.y * Math.cos(angle)).toBeGreaterThan(0)
      expect(Math.hypot(out.x, out.y)).toBeCloseTo(5.01 / Math.sin(angle / 2), 6)
    })

    it("pushes a center inside a crate against a wall out through a side with room", () => {
      const flush: Box2.Box2 = { minX: 0, minY: 100, maxX: 40, maxY: 140 }
      // The nearest side is the one against the wall: leave through the next nearest.
      const out = Collide2.pushOut({ x: 8, y: 125 }, 6, { boxes: [wall, flush] })
      expect(out).toEqual({ x: 8, y: 146.01 })
    })

    it("never lets a moved circle overlap or cross a wall where walls close in", () => {
      // Each trial starts a circle clear of every wall and moves it 300
      // times. Half the moves are shorter than the radius: a move that short
      // cannot cross a wall without ending inside it, so checking the end
      // checks the whole path. The rest are long (up to dashes of 200).
      const random = Random.make(42)
      const tolerance = 1e-6
      const deltaOf = (radius: number): Vec2.Vec2 => {
        const pick = random.next()
        const length = pick < 0.5 ? random.range(0, radius * 0.99) : pick < 0.9 ? random.range(0, 30) : random.range(0, 200)
        const angle = random.range(0, 2 * Math.PI)
        return { x: length * Math.cos(angle), y: length * Math.sin(angle) }
      }
      const clearOf = (walls: Collide2.Walls, at: Vec2.Vec2, radius: number) =>
        (walls.boxes ?? []).every((box) => !Box2.overlapsCircle(box, at, radius)) &&
        (walls.segments ?? []).every((segment) => !Segment2.overlapsCircle(segment, at, radius))
      const distanceTo = (closest: Vec2.Vec2, at: Vec2.Vec2) => Math.hypot(at.x - closest.x, at.y - closest.y)
      /** Crates in a 400 by 300 room, half of them a gap narrower than the circle from a wall or each other. */
      const crates = (count: number, radius: number): Array<Box2.Box2> =>
        Array.from({ length: count }, () => {
          const width = random.range(5, 80)
          const height = random.range(5, 80)
          let minX = random.range(0, 400 - width)
          let minY = random.range(0, 300 - height)
          if (random.next() < 0.5) {
            const gap = random.range(0.5, 2 * radius - 0.5)
            if (random.next() < 0.5) minX = gap
            else minY = 300 - height - gap
          }
          return { minX, minY, maxX: minX + width, maxY: minY + height }
        })

      interface Scene {
        readonly walls: Collide2.Walls
        readonly radius: number
        readonly start: () => Vec2.Vec2
        readonly delta: (at: Vec2.Vec2) => Vec2.Vec2
        /** How far `at` is past a wall (0 or less when it is clear of all). */
        readonly past: (at: Vec2.Vec2) => number
      }
      const room = (): Scene => {
        const radius = 6
        const boxes = [
          { minX: -20, minY: -20, maxX: 420, maxY: 0 },
          { minX: -20, minY: 300, maxX: 420, maxY: 320 },
          { minX: -20, minY: 0, maxX: 0, maxY: 300 },
          { minX: 400, minY: 0, maxX: 420, maxY: 300 },
          ...crates(8, radius)
        ]
        return {
          walls: { boxes },
          radius,
          start: () => ({ x: random.range(0, 400), y: random.range(0, 300) }),
          delta: () => deltaOf(radius),
          past: (at) =>
            at.x <= 0 || at.x >= 400 || at.y <= 0 || at.y >= 300 ? Infinity : Math.max(...boxes.map((box) => radius - distanceTo(Box2.closestPoint(box, at), at)))
        }
      }
      const triangle = (): Scene => {
        // Two sides of 400 from an apex of 5° to 65°, pushed toward the apex half the time.
        const radius = 5
        const apexAngle = (random.range(5, 65) * Math.PI) / 180
        const turn = random.range(0, 2 * Math.PI)
        const a = { x: random.range(-50, 50), y: random.range(-50, 50) }
        const b = { x: a.x + 400 * Math.cos(turn), y: a.y + 400 * Math.sin(turn) }
        const c = { x: a.x + 400 * Math.cos(turn + apexAngle), y: a.y + 400 * Math.sin(turn + apexAngle) }
        const segments = [Segment2.between(a, b), Segment2.between(b, c), Segment2.between(c, a)]
        const middle = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 }
        const side = (segment: Segment2.Segment2, at: Vec2.Vec2) =>
          ((segment.bx - segment.ax) * (at.y - segment.ay) - (segment.by - segment.ay) * (at.x - segment.ax)) / Math.hypot(segment.bx - segment.ax, segment.by - segment.ay)
        // The distance inside each edge's line: every triangle here is acute, so it is the distance to the edge.
        const inward = (at: Vec2.Vec2) => Math.min(...segments.map((segment) => side(segment, at) * Math.sign(side(segment, middle))))
        return {
          walls: { segments },
          radius,
          start: () => {
            const u = random.next()
            const v = random.next() * (1 - u)
            const at = { x: a.x + (b.x - a.x) * u + (c.x - a.x) * v, y: a.y + (b.y - a.y) * u + (c.y - a.y) * v }
            return inward(at) > radius + 0.02 ? at : { x: Infinity, y: Infinity }
          },
          delta: (at) => {
            if (random.next() < 0.5) return deltaOf(radius)
            const speed = random.range(1, 40)
            const length = Math.hypot(a.x - at.x, a.y - at.y) || 1
            return { x: ((a.x - at.x) / length) * speed + random.range(-3, 3), y: ((a.y - at.y) / length) * speed + random.range(-3, 3) }
          },
          past: (at) => radius - inward(at)
        }
      }
      const mixed = (): Scene => {
        // A room of segments, with crates and loose segment walls inside.
        const radius = 6
        const inner = Array.from({ length: 4 }, () => {
          const from = { x: random.range(0, 400), y: random.range(0, 300) }
          const angle = random.range(0, 2 * Math.PI)
          const length = random.range(20, 150)
          return Segment2.between(from, { x: from.x + length * Math.cos(angle), y: from.y + length * Math.sin(angle) })
        })
        const boxes = crates(6, radius)
        const corners = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }]
        const segments = [...corners.map((corner, index) => Segment2.between(corner, corners[(index + 1) % 4]!)), ...inner]
        return {
          walls: { boxes, segments },
          radius,
          start: () => ({ x: random.range(0, 400), y: random.range(0, 300) }),
          delta: () => deltaOf(radius),
          past: (at) =>
            Math.max(
              radius - Math.min(at.x, 400 - at.x, at.y, 300 - at.y),
              ...boxes.map((box) => radius - distanceTo(Box2.closestPoint(box, at), at)),
              ...inner.map((segment) => radius - distanceTo(Segment2.closestPoint(segment, at), at))
            )
        }
      }

      for (const make of [room, triangle, mixed]) {
        let trials = 0
        for (let trial = 0; trial < 300; trial++) {
          const scene = make()
          let start: Vec2.Vec2 | undefined
          for (let tries = 0; tries < 200 && start === undefined; tries++) {
            const at = scene.start()
            if (clearOf(scene.walls, at, scene.radius + Collide2.defaultSkin)) start = at
          }
          if (start === undefined) continue
          trials++
          let position = start
          for (let move = 0; move < 300; move++) {
            const delta = scene.delta(position)
            const moved = Collide2.moveCircle(position, delta, scene.radius, scene.walls).position
            const past = scene.past(moved)
            if (past > tolerance) expect({ scene: make.name, trial, from: position, delta, to: moved, past }).toBeUndefined()
            position = moved
          }
        }
        expect(trials).toBeGreaterThan(250)
      }
    })
  })
})
