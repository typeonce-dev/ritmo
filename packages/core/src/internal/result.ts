export type Success<out Value> = {
  readonly _tag: "Success"
  readonly success: Value
}

export type Failure<out Error> = {
  readonly _tag: "Failure"
  readonly failure: Error
}

export type Result<Value, Error> = Success<Value> | Failure<Error>

type MatchHandlers<Value, Error, SuccessReturn, FailureReturn> = {
  readonly onSuccess: (value: Value) => SuccessReturn
  readonly onFailure: (error: Error) => FailureReturn
}

type ResultCollection = ReadonlyArray<Result<any, any>> | Readonly<Record<string, Result<any, any>>>

type SuccessValue<Input> = Input extends Success<infer Value> ? Value : never

type FailureError<Input> = Input extends Failure<infer Error> ? Error : never

export type MatchReturn<
  Value,
  Error,
  SuccessReturn,
  FailureReturn
> = SuccessReturn | FailureReturn

export type AllSuccess<Input extends ResultCollection> = {
  readonly [Key in keyof Input]: SuccessValue<Input[Key]>
}

export type AllError<Input extends ResultCollection> = FailureError<Input[keyof Input]>

export const succeed = <Value>(success: Value): Success<Value> => ({
  _tag: "Success",
  success
})

export const fail = <Error>(failure: Error): Failure<Error> => ({
  _tag: "Failure",
  failure
})

export const isSuccess = <Value, Error>(result: Result<Value, Error>): result is Success<Value> => result._tag === "Success"

export const isFailure = <Value, Error>(result: Result<Value, Error>): result is Failure<Error> => result._tag === "Failure"

export const match = <Value, Error, SuccessReturn, FailureReturn>(
  result: Result<Value, Error>,
  handlers: MatchHandlers<Value, Error, SuccessReturn, FailureReturn>
): MatchReturn<Value, Error, SuccessReturn, FailureReturn> =>
  result._tag === "Success" ? handlers.onSuccess(result.success) : handlers.onFailure(result.failure)

export const all = <const Input extends ResultCollection>(
  input: Input
): Result<AllSuccess<Input>, AllError<Input>> => {
  if (Array.isArray(input)) {
    const values: unknown[] = []
    for (const result of input) {
      if (result._tag === "Failure") {
        return fail(result.failure as AllError<Input>)
      }
      values.push(result.success)
    }
    return succeed(values as AllSuccess<Input>)
  }

  const recordInput = input as Readonly<Record<string, Result<any, any>>>
  const values: Record<string, unknown> = {}
  for (const key of Object.keys(recordInput)) {
    const result = recordInput[key]
    if (result === undefined) {
      continue
    }
    if (result._tag === "Failure") {
      return fail(result.failure as AllError<Input>)
    }
    values[key] = result.success
  }

  return succeed(values as AllSuccess<Input>)
}
