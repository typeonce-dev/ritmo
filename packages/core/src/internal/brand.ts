/**
 * Creates a nominal type from an otherwise structural value.
 *
 * This utility is used for opaque ids such as `EntityId`, where two values may
 * have the same runtime shape but should not be considered interchangeable by
 * the type system.
 */
export type Brand<Token, Value> = Value & {
  readonly __brand: Token
}

export type PublicBrand<Key> = {
  readonly __publicBrand: Key
}

export type Branded<Value, Key> = Value & PublicBrand<Key>

type Constructor<Value, Raw, Error> = {
  readonly result: (raw: Raw) => import("../Result.ts").Result<Value, Error>
  readonly option: (raw: Raw) => Value | null
  readonly is: (raw: Raw) => raw is Raw & Value
}

export const refine = <Value, Raw, Error>(
  validate: (raw: Raw) => import("../Result.ts").Result<Value, Error>
): Constructor<Value, Raw, Error> => ({
  result: validate,
  option: (raw) => {
    const result = validate(raw)
    return result._tag === "Success" ? result.success : null
  },
  is: (raw): raw is Raw & Value => validate(raw)._tag === "Success"
})

export const all = <Value, Raw, ErrorA, ErrorB>(
  left: Constructor<Value, Raw, ErrorA>,
  right: Constructor<Value, Raw, ErrorB>
): Constructor<Value, Raw, readonly [ErrorA, ErrorB]> =>
  refine((raw) => {
    const leftResult = left.result(raw)
    const rightResult = right.result(raw)
    if (leftResult._tag === "Failure" || rightResult._tag === "Failure") {
      return {
        _tag: "Failure",
        failure: [
          leftResult._tag === "Success" ? undefined as never : leftResult.failure,
          rightResult._tag === "Success" ? undefined as never : rightResult.failure
        ] as const
      }
    }

    return {
      _tag: "Success",
      success: leftResult.success
    }
  })
