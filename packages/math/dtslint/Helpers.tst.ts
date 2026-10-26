import type { Result } from "@typeonce/ritmo"
import { Angle, Box2, Collide2, FlowField, Scalar, Segment2, Vec2 } from "@typeonce/ritmo-math"
import { describe, expect, it } from "tstyche"

declare const field: FlowField.FlowField

describe("hot-path helpers", () => {
  it("Vec2 works on plain { x, y } values", () => {
    expect(Vec2.add({ x: 1, y: 2 }, { x: 3, y: 4 })).type.toBe<Vec2.Vec2>()
    expect(Vec2.length({ x: 3, y: 4 })).type.toBe<number>()
    expect(Vec2.normalizeOr({ x: 1, y: 2 }, Vec2.zero)).type.toBe<Vec2.Vec2>()
    // @ts-expect-error Property 'y' is missing
    Vec2.add({ x: 1 }, { x: 3, y: 4 })
  })

  it("Vec2 turns, goes to and from angles, and decays toward a target", () => {
    expect(Vec2.perpendicular({ x: 1, y: 2 })).type.toBe<Vec2.Vec2>()
    expect(Vec2.fromAngle(1)).type.toBe<Vec2.Vec2>()
    expect(Vec2.angle({ x: 1, y: 2 })).type.toBe<number>()
    expect(Vec2.decayToward({ x: 1, y: 2 }, Vec2.zero, 4, 1 / 60)).type.toBe<Vec2.Vec2>()
    // @ts-expect-error Property 'y' is missing
    Vec2.angle({ x: 1 })
    // @ts-expect-error Expected 1 arguments, but got 2
    Vec2.fromAngle(1, 10)
    // @ts-expect-error Expected 4 arguments, but got 3
    Vec2.decayToward({ x: 1, y: 2 }, Vec2.zero, 4)
  })

  it("Angle wraps and turns plain numbers", () => {
    expect(Angle.wrap(4)).type.toBe<number>()
    expect(Angle.turnToward(0, 1, 0.1)).type.toBe<number>()
    // @ts-expect-error Argument of type '{ x: number; y: number; }' is not assignable to parameter of type 'number'
    Angle.wrap({ x: 1, y: 0 })
    // @ts-expect-error Expected 3 arguments, but got 2
    Angle.turnToward(0, 1)
  })

  it("Scalar moves plain numbers toward a target", () => {
    expect(Scalar.moveToward(0, 10, 1)).type.toBe<number>()
    expect(Scalar.lerp(0, 10, 0.5)).type.toBe<number>()
    expect(Scalar.decayToward(0, 10, 4, 1 / 60)).type.toBe<number>()
    // @ts-expect-error Expected 4 arguments, but got 3
    Scalar.decayToward(0, 10, 4)
    // @ts-expect-error Argument of type '{ x: number; y: number; }' is not assignable to parameter of type 'number'
    Scalar.moveToward({ x: 0, y: 0 }, 10, 1)
  })

  it("Scalar.spring carries its state as a record and returns the next one", () => {
    const spec = { frequencyHz: 3, dampingRatio: 0.3 }
    expect(Scalar.spring({ value: 0, velocity: 0 }, 1, spec, 1 / 60)).type.toBe<Scalar.Spring>()
    expect(Scalar.spring(Scalar.spring({ value: 0, velocity: 0 }, 1, spec, 1 / 60), 1, spec, 1 / 60)).type.toBe<Scalar.Spring>()
    // @ts-expect-error Argument of type 'number' is not assignable to parameter of type 'Spring'
    Scalar.spring(0, 1, spec, 1 / 60)
    // @ts-expect-error Property 'velocity' is missing
    Scalar.spring({ value: 0 }, 1, spec, 1 / 60)
    // @ts-expect-error 'frequency' does not exist in type 'SpringSpec'
    Scalar.spring({ value: 0, velocity: 0 }, 1, { frequency: 3, damping: 0.3 }, 1 / 60)
    // @ts-expect-error Expected 4 arguments, but got 3
    Scalar.spring({ value: 0, velocity: 0 }, 1, spec)
  })


  it("Box2 and Collide2 report contacts as optional values", () => {
    const box = Box2.around(0, 0, 1, 1)
    expect(box).type.toBe<Box2.Box2>()
    expect(Box2.closestPoint(box, { x: 3, y: 0 })).type.toBe<Vec2.Vec2>()
    expect(Collide2.overlapsCircleCircle({ x: 0, y: 0 }, 1, { x: 3, y: 0 }, 1)).type.toBe<boolean>()
    // @ts-expect-error Property 'maxY' is missing
    Box2.closestPoint({ minX: 0, minY: 0, maxX: 1 }, { x: 3, y: 0 })
    // @ts-expect-error Expected 4 arguments, but got 3
    Collide2.overlapsCircleCircle({ x: 0, y: 0 }, 1, { x: 3, y: 0 })
    expect(Collide2.sweepCircleBox({ x: 0, y: 0 }, { x: 1, y: 0 }, 1, box)).type.toBe<Collide2.Hit | undefined>()
    expect(Collide2.sweepCircleCircle({ x: 0, y: 0 }, { x: 1, y: 0 }, 1, { x: 3, y: 0 }, 1)).type.toBe<number | undefined>()
    expect(Collide2.moveCircle({ x: 0, y: 0 }, { x: 1, y: 0 }, 1, { boxes: [box] })).type.toBe<Collide2.MoveResult>()
    // @ts-expect-error Property 'maxY' is missing
    Collide2.pushOut({ x: 0, y: 0 }, 1, { boxes: [{ minX: 0, minY: 0, maxX: 1 }] })
  })

  it("Segment2 walls collide through the same Walls as boxes", () => {
    const box = Box2.around(0, 0, 1, 1)
    const wall = Segment2.between({ x: 0, y: 0 }, { x: 4, y: 3 })
    expect(wall).type.toBe<Segment2.Segment2>()
    expect(Segment2.closestPoint(wall, { x: 1, y: 1 })).type.toBe<Vec2.Vec2>()
    expect(Segment2.overlapsCircle(wall, { x: 1, y: 1 }, 1)).type.toBe<boolean>()
    expect(Collide2.sweepCircleSegment({ x: 0, y: 0 }, { x: 1, y: 0 }, 1, wall)).type.toBe<Collide2.Hit | undefined>()
    expect(Collide2.sweepCircle({ x: 0, y: 0 }, { x: 1, y: 0 }, 0, { boxes: [box], segments: [wall] })).type.toBe<Collide2.Hit | undefined>()
    expect(Collide2.moveCircle({ x: 0, y: 0 }, { x: 1, y: 0 }, 1, { segments: [wall] })).type.toBe<Collide2.MoveResult>()
    expect(Collide2.pushOut({ x: 0, y: 0 }, 1, {})).type.toBe<Vec2.Vec2>()
    // @ts-expect-error Property 'by' is missing
    Collide2.moveCircle({ x: 0, y: 0 }, { x: 1, y: 0 }, 1, { segments: [{ ax: 0, ay: 0, bx: 1 }] })
    // @ts-expect-error pass walls by kind: { boxes: walls } or { segments: walls }
    Collide2.moveCircle({ x: 0, y: 0 }, { x: 1, y: 0 }, 1, [box])
  })


  it("FlowField.make fails with a typed InvalidCellSize", () => {
    expect(FlowField.make(16)).type.toBe<Result.Result<FlowField.FlowField, FlowField.InvalidCellSize>>()
    expect(field.way({ x: 0, y: 0 })).type.toBe<Vec2.Vec2 | undefined>()
    expect(field.distance({ x: 0, y: 0 })).type.toBe<number | undefined>()
    // @ts-expect-error Property 'setGoal' does not exist on type 'Result<FlowField, InvalidCellSize>'
    FlowField.make(16).setGoal({ x: 0, y: 0 })
  })
})
