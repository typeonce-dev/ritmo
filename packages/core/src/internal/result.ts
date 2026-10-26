export type Success<out Value> = {
  readonly ok: true
  readonly value: Value
}

export type Failure<out Error> = {
  readonly ok: false
  readonly error: Error
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
  _Value,
  _Error,
  SuccessReturn,
  FailureReturn
> = SuccessReturn | FailureReturn

export type AllSuccess<Input extends ResultCollection> = {
  readonly [Key in keyof Input]: SuccessValue<Input[Key]>
}

export type AllError<Input extends ResultCollection> = FailureError<Input[keyof Input]>

export const success = <Value>(value: Value): Success<Value> => ({
  ok: true,
  value
})

export const failure = <Error>(error: Error): Failure<Error> => ({
  ok: false,
  error
})

export const isSuccess = <Value, Error>(result: Result<Value, Error>): result is Success<Value> => result.ok

export const isFailure = <Value, Error>(result: Result<Value, Error>): result is Failure<Error> => !result.ok

export const match = <Value, Error, SuccessReturn, FailureReturn>(
  result: Result<Value, Error>,
  handlers: MatchHandlers<Value, Error, SuccessReturn, FailureReturn>
): MatchReturn<Value, Error, SuccessReturn, FailureReturn> =>
  result.ok ? handlers.onSuccess(result.value) : handlers.onFailure(result.error)

export const all = <const Input extends ResultCollection>(
  input: Input
): Result<AllSuccess<Input>, AllError<Input>> => {
  if (Array.isArray(input)) {
    const values: unknown[] = []
    for (const result of input) {
      if (!result.ok) {
        return failure(result.error as AllError<Input>)
      }
      values.push(result.value)
    }
    return success(values as AllSuccess<Input>)
  }

  const recordInput = input as Readonly<Record<string, Result<any, any>>>
  const values: Record<string, unknown> = {}
  for (const key of Object.keys(recordInput)) {
    const result = recordInput[key]
    if (result === undefined) {
      continue
    }
    if (!result.ok) {
      return failure(result.error as AllError<Input>)
    }
    values[key] = result.value
  }

  return success(values as AllSuccess<Input>)
}
