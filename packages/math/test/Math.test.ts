import { describe, expect, it } from "vitest"

import { Result } from "@typeonce/ritmo"
import { Aabb, InputAxis, Scalar, Size2, Vector2 } from "@typeonce/ritmo-math"

describe("helpers", () => {
  it("matches explicit success and failure branches", () => {
    expect(Result.match(Result.success(3), {
      onSuccess: (value) => value + 1,
      onFailure: () => 0
    })).toBe(4)

    expect(Result.match(Result.failure("invalid"), {
      onSuccess: () => 0,
      onFailure: (error) => error
    })).toBe("invalid")
  })

  it("aggregates tuple and record results", () => {
    expect(Result.all([
      Result.success(1),
      Result.success("two")
    ] as const)).toEqual(Result.success([1, "two"]))

    expect(Result.all({
      x: Result.success(1),
      y: Result.success("two")
    })).toEqual(Result.success({
      x: 1,
      y: "two"
    }))
  })

  it("returns the first failure while aggregating results", () => {
    expect(Result.all([
      Result.success(1),
      Result.failure("boom"),
      Result.failure("later")
    ] as const)).toEqual(Result.failure("boom"))

    expect(Result.all({
      ok: Result.success(1),
      fail: Result.failure("boom")
    })).toEqual(Result.failure("boom"))
  })

  it("rejects invalid scalar and geometry inputs", () => {
    expect(Scalar.Finite.result(Number.NaN).ok).toBe(false)
    expect(Size2.result({ width: -1, height: 2 }).ok).toBe(false)
    expect(Vector2.result({ x: Number.POSITIVE_INFINITY, y: 0 }).ok).toBe(false)
    expect(Aabb.result({
      position: { x: 0, y: 0 },
      size: { width: -1, height: 1 }
    }).ok).toBe(false)
  })

  it("interpolates finite scalar values", () => {
    const start = Scalar.Finite.result(10)
    const end = Scalar.Finite.result(20)
    const amount = Scalar.Finite.result(0.25)
    expect(start.ok && end.ok && amount.ok).toBe(true)
    if (!start.ok || !end.ok || !amount.ok) {
      return
    }

    expect(Scalar.lerp(start.value, end.value, amount.value)).toBe(12.5)
  })

  it("computes inverse interpolation and remap explicitly", () => {
    const zero = Scalar.Finite.result(0)
    const ten = Scalar.Finite.result(10)
    const five = Scalar.Finite.result(5)
    const hundred = Scalar.Finite.result(100)
    const twoHundred = Scalar.Finite.result(200)
    expect(zero.ok && ten.ok && five.ok && hundred.ok && twoHundred.ok).toBe(true)
    if (!zero.ok || !ten.ok || !five.ok || !hundred.ok || !twoHundred.ok) {
      return
    }

    expect(Scalar.inverseLerp(zero.value, ten.value, five.value)).toEqual(Result.success(0.5))
    expect(
      Scalar.remap(five.value, zero.value, ten.value, hundred.value, twoHundred.value)
    ).toEqual(Result.success(150))
  })

  it("fails inverse interpolation and remap for zero-sized input ranges", () => {
    const zero = Scalar.Finite.result(0)
    const five = Scalar.Finite.result(5)
    const ten = Scalar.Finite.result(10)
    expect(zero.ok && five.ok && ten.ok).toBe(true)
    if (!zero.ok || !five.ok || !ten.ok) {
      return
    }

    const error = {
      tag: "Scalar/ZeroRange" as const,
      start: 5,
      end: 5
    }

    expect(Scalar.inverseLerp(five.value, five.value, ten.value)).toEqual(Result.failure(error))
    expect(Scalar.remap(ten.value, five.value, five.value, zero.value, ten.value)).toEqual(Result.failure(error))
  })

  it("normalizes movement explicitly and without mutating the source", () => {
    const raw = { x: 3, y: 4 } as const
    const vector = Vector2.result(raw)
    expect(vector.ok).toBe(true)
    if (!vector.ok) {
      return
    }

    const normalized = Vector2.normalize(vector.value)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) {
      return
    }

    expect(raw).toEqual({ x: 3, y: 4 })
    expect(Vector2.toRaw(vector.value)).toEqual({ x: 3, y: 4 })
    expect(Vector2.length(normalized.value)).toBeCloseTo(1)
  })

  it("returns an explicit failure for zero-length normalization", () => {
    const zero = Vector2.zero()
    const normalized = Vector2.normalize(zero)

    expect(normalized).toEqual(Result.failure({
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

  it("validates untrusted input of any shape through each type's codec and guard", () => {
    const validate = (codec: { readonly "~standard": { readonly validate: (raw: unknown) => unknown } }, raw: unknown) => codec["~standard"].validate(raw)
    expect(validate(Vector2.codec, { x: 1, y: 2 })).toEqual({ value: { x: 1, y: 2 } })
    expect(validate(Size2.codec, { width: 1, height: 2 })).toEqual({ value: { width: 1, height: 2 } })
    expect(Aabb.is({ position: { x: 0, y: 0 }, size: { width: 1, height: 1 } })).toBe(true)
    for (const raw of [null, 3, "x", [], { x: "1", y: 2 }, { x: Number.NaN, y: 0 }]) {
      expect(Vector2.is(raw)).toBe(false)
      expect(validate(Vector2.codec, raw)).toEqual({ issues: [{ message: "Expected a vector { x, y } of finite numbers" }] })
    }
    expect(Aabb.is({ position: null, size: { width: 1, height: 1 } })).toBe(false)
    expect(Size2.is({ width: 1 })).toBe(false)
    expect(validate(Scalar.Positive.codec, 0)).toEqual({ issues: [{ message: "Expected a finite number above 0" }] })
  })
})
