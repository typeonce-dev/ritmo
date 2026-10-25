import { Descriptor, Result } from "@typeonce/ritmo"
import type { StandardSchema } from "@typeonce/ritmo/Descriptor"
import { Aabb, InputAxis, Scalar, Size2, Vector2 } from "@typeonce/ritmo-math"
import { describe, expect, it } from "tstyche"

describe("helpers", () => {
  it("result helpers preserve tuple and record shapes", () => {
    const tuple = Result.all([
      Result.success(1),
      Result.failure("invalid" as const),
      Result.success(true)
    ] as const)

    expect(tuple).type.toBe<Result.Result<readonly [number, never, boolean], "invalid">>()

    const record = Result.all({
      position: Vector2.result({ x: 1, y: 2 }),
      size: Size2.result({ width: 3, height: 4 })
    })

    expect(record).type.toBe<Result.Result<{
      readonly position: Vector2.Vector2
      readonly size: Size2.Size2
    }, Vector2.Error | Size2.Error>>()
  })

  it("result match infers handler inputs", () => {
    const matched = Result.match(Vector2.result({ x: 1, y: 2 }), {
      onSuccess: (value) => Vector2.length(value),
      onFailure: (error) => error.tag
    })

    expect(matched).type.toBe<Scalar.NonNegative | Vector2.Error["tag"]>()
  })

  it("constructors accept raw structural values", () => {
    const vector = Vector2.result({ x: 1, y: 2 })
    const size = Size2.result({ width: 3, height: 4 })
    const finite = Scalar.Finite.result(1)

    expect(vector).type.toBe<Result.Result<Vector2.Vector2, Vector2.Error>>()
    expect(size).type.toBe<Result.Result<Size2.Size2, Size2.Error>>()
    expect(finite).type.toBe<Result.Result<Scalar.Finite, Scalar.Error>>()
  })

  it("scalar interpolation helpers preserve branded results", () => {
    const start = Scalar.Finite.result(0)
    const end = Scalar.Finite.result(10)
    const value = Scalar.Finite.result(5)

    if (!start.ok || !end.ok || !value.ok) {
      return
    }

    expect(Scalar.lerp(start.value, end.value, value.value)).type.toBe<Scalar.Finite>()
    expect(Scalar.inverseLerp(start.value, end.value, value.value)).type.toBe<
      Result.Result<Scalar.Finite, Scalar.InterpolationError>
    >()
    expect(Scalar.remap(value.value, start.value, end.value, start.value, end.value)).type.toBe<
      Result.Result<Scalar.Finite, Scalar.InterpolationError>
    >()
  })

  it("non-constructor helpers require branded values", () => {
    const vector = Vector2.option({ x: 1, y: 2 })
    const size = Size2.option({ width: 3, height: 4 })

    if (!vector || !size) {
      return
    }

    expect(Vector2.length(vector)).type.toBe<Scalar.NonNegative>()
    expect(Aabb.option({ position: vector, size })).type.toBe<Aabb.Aabb | null>()

    // @ts-expect-error Type 'number' is not assignable to type 'PublicBrand<"Scalar/Finite">'.
    Vector2.length({ x: 1, y: vector.y })

    // @ts-expect-error Property '__publicBrand' is missing in type '{ position: Vector2.Vector2; size: Size2.Size2; }' but required
    Aabb.translate({ position: vector, size }, vector)
  })

  it("axis helpers preserve the narrow axis union", () => {
    const horizontal = InputAxis.axis(true, false)
    expect(horizontal).type.toBe<InputAxis.Axis>()
  })
})

describe("codecs and guards", () => {
  it("gives each validated type one schema and a guard over unknown", () => {
    expect(Vector2.codec).type.toBe<StandardSchema<Vector2.Raw, Vector2.Vector2>>()
    expect(Scalar.Finite.codec).type.toBe<StandardSchema<number, Scalar.Finite>>()
    expect(Vector2.is).type.toBe<(raw: unknown) => raw is Vector2.Vector2>()
    expect(Scalar.Positive.is).type.toBe<(raw: unknown) => raw is Scalar.Positive>()
    expect(Descriptor.ConstructedComponent(Aabb.codec)("Math/Bounds")).type.toBe<
      Descriptor.ConstructedDescriptor<"component", "Math/Bounds", Aabb.Aabb, Aabb.Raw, Descriptor.SchemaIssues>
    >()
  })
})
