import * as Brand from "@typeonce/ritmo/Brand"
import * as Result from "@typeonce/ritmo/Result"
import type * as Scalar from "../Scalar.ts"

const finiteBrand = Brand.refine<Scalar.Finite, number, Scalar.Error>((value) =>
  Number.isFinite(value)
    ? Result.succeed(value as Scalar.Finite)
    : Result.fail({
        _tag: "Scalar/NotFinite",
        value
      })
)

const nonNegativeBrand = Brand.refine<Scalar.NonNegative, number, Scalar.Error>((value) => {
  const finite = finiteBrand.result(value)
  if (finite._tag === "Failure") {
    return finite
  }

  return value >= 0
    ? Result.succeed(value as Scalar.NonNegative)
    : Result.fail({
        _tag: "Scalar/Negative",
        value
      })
})

const positiveBrand = Brand.refine<Scalar.Positive, number, Scalar.Error>((value) => {
  const finite = finiteBrand.result(value)
  if (finite._tag === "Failure") {
    return finite
  }

  return value > 0
    ? Result.succeed(value as Scalar.Positive)
    : Result.fail({
        _tag: "Scalar/NonPositive",
        value
      })
})

export const Finite = finiteBrand
export const NonNegative = nonNegativeBrand
export const Positive = positiveBrand

export const clamp = (value: number, min: number, max: number): Scalar.Finite =>
  Math.min(Math.max(value, min), max) as Scalar.Finite

export const lerp = (start: number, end: number, amount: number): Scalar.Finite =>
  (start + (end - start) * amount) as Scalar.Finite

export const approach = (
  current: Scalar.Finite,
  target: Scalar.Finite,
  maxDelta: Scalar.NonNegative
): Scalar.Finite => {
  if (current < target) {
    return Math.min(current + maxDelta, target) as Scalar.Finite
  }

  return Math.max(current - maxDelta, target) as Scalar.Finite
}

export const inverseLerp = (
  start: number,
  end: number,
  value: number
): Result.Result<Scalar.Finite, Scalar.InterpolationError> => {
  if (start === end) {
    return Result.fail({
      _tag: "Scalar/ZeroRange",
      start,
      end
    })
  }

  return Result.succeed(((value - start) / (end - start)) as Scalar.Finite)
}

export const remap = (
  value: number,
  inputStart: number,
  inputEnd: number,
  outputStart: number,
  outputEnd: number
): Result.Result<Scalar.Finite, Scalar.InterpolationError> => {
  const amount = inverseLerp(inputStart, inputEnd, value)
  if (amount._tag === "Failure") {
    return amount
  }

  return Result.succeed(lerp(outputStart, outputEnd, amount.success))
}
