import { describe, expect, it } from "vitest"

import { Result } from "@typeonce/ritmo"
import { Aabb, InputAxis, Scalar, Size2, Vector2 } from "@typeonce/ritmo-math"

describe("helpers", () => {
  it("matches explicit success and failure branches", () => {
    expect(Result.match(Result.succeed(3), {
      onSuccess: (value) => value + 1,
      onFailure: () => 0
    })).toBe(4)

    expect(Result.match(Result.fail("invalid"), {
      onSuccess: () => 0,
      onFailure: (error) => error
    })).toBe("invalid")
  })

  it("aggregates tuple and record results", () => {
    expect(Result.all([
      Result.succeed(1),
      Result.succeed("two")
    ] as const)).toEqual(Result.succeed([1, "two"]))

    expect(Result.all({
      x: Result.succeed(1),
      y: Result.succeed("two")
    })).toEqual(Result.succeed({
      x: 1,
      y: "two"
    }))
  })

  it("returns the first failure while aggregating results", () => {
    expect(Result.all([
      Result.succeed(1),
      Result.fail("boom"),
      Result.fail("later")
    ] as const)).toEqual(Result.fail("boom"))

    expect(Result.all({
      ok: Result.succeed(1),
      fail: Result.fail("boom")
    })).toEqual(Result.fail("boom"))
  })

  it("rejects invalid scalar and geometry inputs", () => {
    expect(Scalar.Finite.result(Number.NaN)._tag).toBe("Failure")
    expect(Size2.result({ width: -1, height: 2 })._tag).toBe("Failure")
    expect(Vector2.result({ x: Number.POSITIVE_INFINITY, y: 0 })._tag).toBe("Failure")
    expect(Aabb.result({
      position: { x: 0, y: 0 },
      size: { width: -1, height: 1 }
    })._tag).toBe("Failure")
  })

  it("interpolates finite scalar values", () => {
    const start = Scalar.Finite.result(10)
    const end = Scalar.Finite.result(20)
    const amount = Scalar.Finite.result(0.25)
    expect(start._tag === "Success" && end._tag === "Success" && amount._tag === "Success").toBe(true)
    if (start._tag === "Failure" || end._tag === "Failure" || amount._tag === "Failure") {
      return
    }

    expect(Scalar.lerp(start.success, end.success, amount.success)).toBe(12.5)
  })

  it("computes inverse interpolation and remap explicitly", () => {
    const zero = Scalar.Finite.result(0)
    const ten = Scalar.Finite.result(10)
    const five = Scalar.Finite.result(5)
    const hundred = Scalar.Finite.result(100)
    const twoHundred = Scalar.Finite.result(200)
    expect(zero._tag === "Success" && ten._tag === "Success" && five._tag === "Success" && hundred._tag === "Success" && twoHundred._tag === "Success").toBe(true)
    if (zero._tag === "Failure" || ten._tag === "Failure" || five._tag === "Failure" || hundred._tag === "Failure" || twoHundred._tag === "Failure") {
      return
    }

    expect(Scalar.inverseLerp(zero.success, ten.success, five.success)).toEqual(Result.succeed(0.5))
    expect(
      Scalar.remap(five.success, zero.success, ten.success, hundred.success, twoHundred.success)
    ).toEqual(Result.succeed(150))
  })

  it("fails inverse interpolation and remap for zero-sized input ranges", () => {
    const zero = Scalar.Finite.result(0)
    const five = Scalar.Finite.result(5)
    const ten = Scalar.Finite.result(10)
    expect(zero._tag === "Success" && five._tag === "Success" && ten._tag === "Success").toBe(true)
    if (zero._tag === "Failure" || five._tag === "Failure" || ten._tag === "Failure") {
      return
    }

    const error = {
      tag: "Scalar/ZeroRange" as const,
      start: 5,
      end: 5
    }

    expect(Scalar.inverseLerp(five.success, five.success, ten.success)).toEqual(Result.fail(error))
    expect(Scalar.remap(ten.success, five.success, five.success, zero.success, ten.success)).toEqual(Result.fail(error))
  })

  it("normalizes movement explicitly and without mutating the source", () => {
    const raw = { x: 3, y: 4 } as const
    const vector = Vector2.result(raw)
    expect(vector._tag).toBe("Success")
    if (vector._tag === "Failure") {
      return
    }

    const normalized = Vector2.normalize(vector.success)
    expect(normalized._tag).toBe("Success")
    if (normalized._tag === "Failure") {
      return
    }

    expect(raw).toEqual({ x: 3, y: 4 })
    expect(Vector2.toRaw(vector.success)).toEqual({ x: 3, y: 4 })
    expect(Vector2.length(normalized.success)).toBeCloseTo(1)
  })

  it("returns an explicit failure for zero-length normalization", () => {
    const zero = Vector2.zero()
    const normalized = Vector2.normalize(zero)

    expect(normalized).toEqual(Result.fail({
      tag: "Vector2/ZeroLength"
    }))
    expect(Vector2.normalizeOrZero(zero)).toEqual(zero)
  })

  it("creates immutable raw copies", () => {
    const vector = Vector2.option({ x: 5, y: 7 })
    expect(vector).not.toBeNull()
    if (!vector) {
      return
    }

    const raw = Vector2.toRaw(vector)
    expect(Vector2.toRaw(vector)).toEqual({ x: 5, y: 7 })
    expect(raw).not.toBe(vector)
  })

  it("derives axis-aligned input vectors and AABB intersections", () => {
    const direction = InputAxis.vectorFromAxes({
      left: false,
      right: true,
      up: true,
      down: false
    })
    expect(direction.x).toBeGreaterThan(0)
    expect(direction.y).toBeLessThan(0)

    const first = Aabb.option({
      position: { x: 0, y: 0 },
      size: { width: 10, height: 10 }
    })
    const second = Aabb.option({
      position: { x: 4, y: 0 },
      size: { width: 10, height: 10 }
    })

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    if (!first || !second) {
      return
    }

    expect(Aabb.intersects(first, second)).toBe(true)
    expect(Aabb.intersects(first, Aabb.translate(second, Vector2.option({ x: 20, y: 0 })!))).toBe(false)
  })

  it("decodes untrusted input of any shape", () => {
    expect(Vector2.decode({ x: 1, y: 2 })._tag).toBe("Success")
    expect(Size2.decode({ width: 1, height: 2 })._tag).toBe("Success")
    expect(Aabb.decode({ position: { x: 0, y: 0 }, size: { width: 1, height: 1 } })._tag).toBe("Success")
    for (const raw of [null, 3, "x", [], { x: "1", y: 2 }]) {
      const decoded = Vector2.decode(raw)
      expect(decoded._tag === "Success" ? undefined : decoded.failure.tag).toBe("Vector2/Malformed")
    }
    const invalid = Vector2.decode({ x: Number.NaN, y: 0 })
    expect(invalid._tag === "Success" ? undefined : invalid.failure.tag).toBe("Vector2/Invalid")
    const box = Aabb.decode({ position: null, size: { width: 1, height: 1 } })
    expect(box._tag === "Success" ? undefined : box.failure.tag).toBe("Aabb/Malformed")
    expect(Size2.decode({ width: 1 })._tag).toBe("Failure")
  })
})
