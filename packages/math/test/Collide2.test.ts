import { describe, expect, it } from "vitest"

import { Random } from "@typeonce/ritmo"
import { Box2, Collide2, Segment2 } from "@typeonce/ritmo-math"

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
})
