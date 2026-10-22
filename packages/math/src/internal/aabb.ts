import * as Result from "@typeonce/ritmo/Result"
import * as Size2 from "../Size2.ts"
import * as Vector2 from "../Vector2.ts"
import type * as Aabb from "../Aabb.ts"
import type * as Scalar from "../Scalar.ts"
import { isRawShape as isSize2Shape } from "./size2.ts"
import { isRawShape as isVector2Shape } from "./vector2.ts"

const make = (position: Vector2.Vector2, size: Size2.Size2): Aabb.Aabb =>
  ({ position, size }) as Aabb.Aabb

export const result = (raw: Aabb.Raw): Result.Result<Aabb.Aabb, Aabb.Error> => {
  const position = Vector2.result(raw.position)
  if (position._tag === "Failure") {
    return Result.fail({
      _tag: "Aabb/InvalidPosition",
      error: position.failure,
      input: raw
    })
  }

  const size = Size2.result(raw.size)
  if (size._tag === "Failure") {
    return Result.fail({
      _tag: "Aabb/InvalidSize",
      error: size.failure,
      input: raw
    })
  }

  return Result.succeed(make(position.success, size.success))
}

export const option = (raw: Aabb.Raw): Aabb.Aabb | null => {
  const next = result(raw)
  return next._tag === "Success" ? next.success : null
}

export const is = (raw: Aabb.Raw): raw is Aabb.Raw & Aabb.Aabb => result(raw)._tag === "Success"

export const position = (aabb: Aabb.Aabb): Vector2.Vector2 => aabb.position
export const size = (aabb: Aabb.Aabb): Size2.Size2 => aabb.size

export const left = (aabb: Aabb.Aabb): Scalar.Finite =>
  (aabb.position.x - aabb.size.width * 0.5) as Scalar.Finite

export const right = (aabb: Aabb.Aabb): Scalar.Finite =>
  (aabb.position.x + aabb.size.width * 0.5) as Scalar.Finite

export const top = (aabb: Aabb.Aabb): Scalar.Finite =>
  (aabb.position.y - aabb.size.height * 0.5) as Scalar.Finite

export const bottom = (aabb: Aabb.Aabb): Scalar.Finite =>
  (aabb.position.y + aabb.size.height * 0.5) as Scalar.Finite

export const intersects = (first: Aabb.Aabb, second: Aabb.Aabb): boolean =>
  Math.abs(first.position.x - second.position.x) * 2 < first.size.width + second.size.width &&
  Math.abs(first.position.y - second.position.y) * 2 < first.size.height + second.size.height

export const overlapsHorizontally = (first: Aabb.Aabb, second: Aabb.Aabb): boolean =>
  right(first) > left(second) && left(first) < right(second)

export const overlapsVertically = (first: Aabb.Aabb, second: Aabb.Aabb): boolean =>
  bottom(first) > top(second) && top(first) < bottom(second)

export const translate = (aabb: Aabb.Aabb, delta: Vector2.Vector2): Aabb.Aabb =>
  make(Vector2.add(aabb.position, delta), aabb.size)

export const decode = (raw: unknown): Result.Result<Aabb.Aabb, Aabb.Error | Aabb.DecodeError> => {
  if (typeof raw !== "object" || raw === null) return Result.fail({ _tag: "Aabb/Malformed", input: raw })
  const { position, size } = raw as Record<string, unknown>
  return isVector2Shape(position) && isSize2Shape(size)
    ? result({ position, size })
    : Result.fail({ _tag: "Aabb/Malformed", input: raw })
}
