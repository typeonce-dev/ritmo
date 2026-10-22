import * as Result from "@typeonce/ritmo/Result"
import * as Scalar from "../Scalar.ts"
import type * as Vector2 from "../Vector2.ts"
import * as Ops from "../Ops.ts"

const make = (x: Scalar.Finite, y: Scalar.Finite): Vector2.Vector2 => ({ x, y }) as Vector2.Vector2

export const result = (raw: Vector2.Raw): Result.Result<Vector2.Vector2, Vector2.Error> => {
  const x = Scalar.Finite.result(raw.x)
  const y = Scalar.Finite.result(raw.y)
  if (x._tag === "Failure" || y._tag === "Failure") {
    return Result.fail({
      tag: "Vector2/Invalid",
      x: x._tag === "Success" ? null : x.failure,
      y: y._tag === "Success" ? null : y.failure,
      input: {
        x: raw.x,
        y: raw.y
      }
    })
  }

  return Result.succeed(make(x.success, y.success))
}

export const option = (raw: Vector2.Raw): Vector2.Vector2 | null => {
  const next = result(raw)
  return next._tag === "Success" ? next.success : null
}

export const is = (raw: Vector2.Raw): raw is Vector2.Raw & Vector2.Vector2 => result(raw)._tag === "Success"

export const toRaw = (vector: Vector2.Vector2): Vector2.Raw => ({
  x: vector.x,
  y: vector.y
})

export const components = (vector: Vector2.Vector2) => ({
  x: vector.x,
  y: vector.y
})

export const x = (vector: Vector2.Vector2): Scalar.Finite => vector.x
export const y = (vector: Vector2.Vector2): Scalar.Finite => vector.y

export const zero = (): Vector2.Vector2 => make(0 as Scalar.Finite, 0 as Scalar.Finite)

export const add = (left: Vector2.Vector2, right: Vector2.Vector2): Vector2.Vector2 =>
  make((left.x + right.x) as Scalar.Finite, (left.y + right.y) as Scalar.Finite)

export const subtract = (left: Vector2.Vector2, right: Vector2.Vector2): Vector2.Vector2 =>
  make((left.x - right.x) as Scalar.Finite, (left.y - right.y) as Scalar.Finite)

export const scale = (vector: Vector2.Vector2, scalar: Scalar.Finite): Vector2.Vector2 =>
  make((vector.x * scalar) as Scalar.Finite, (vector.y * scalar) as Scalar.Finite)

export const lengthSquared = (vector: Vector2.Vector2): Scalar.NonNegative =>
  (vector.x * vector.x + vector.y * vector.y) as Scalar.NonNegative

export const length = (vector: Vector2.Vector2): Scalar.NonNegative =>
  Math.sqrt(lengthSquared(vector)) as Scalar.NonNegative

export const normalize = (
  vector: Vector2.Vector2
): Result.Result<Vector2.Vector2, Vector2.NormalizeError> => {
  const magnitudeSquared = lengthSquared(vector)
  if (magnitudeSquared === 0) {
    return Result.fail({
      tag: "Vector2/ZeroLength"
    })
  }

  const magnitude = Math.sqrt(magnitudeSquared) as Scalar.NonNegative
  return Result.succeed(
    make(
      (vector.x / magnitude) as Scalar.Finite,
      (vector.y / magnitude) as Scalar.Finite
    )
  )
}

export const normalizeOrZero = (vector: Vector2.Vector2): Vector2.Vector2 => {
  const normalized = normalize(vector)
  return normalized._tag === "Success" ? normalized.success : zero()
}

export const normalizeXYOrZero = (x: number, y: number): {
  readonly x: number
  readonly y: number
  readonly length: number
} => {
  const magnitude = Ops.hypot(x, y)
  if (magnitude <= 0.0001) {
    return {
      x: 0,
      y: 0,
      length: 0
    }
  }

  return {
    x: x / magnitude,
    y: y / magnitude,
    length: magnitude
  }
}

/**
 * Shape check for untrusted input; values are validated by `result`.
 */
export const isRawShape = (raw: unknown): raw is Vector2.Raw =>
  typeof raw === "object" && raw !== null && typeof (raw as Record<string, unknown>)["x"] === "number" && typeof (raw as Record<string, unknown>)["y"] === "number"

export const decode = (raw: unknown): Result.Result<Vector2.Vector2, Vector2.Error | Vector2.DecodeError> =>
  isRawShape(raw) ? result(raw) : Result.fail({ tag: "Vector2/Malformed", input: raw })
