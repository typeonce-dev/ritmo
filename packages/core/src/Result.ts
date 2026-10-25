/**
 * Minimal explicit success/failure values used across the public API.
 *
 * `Result` is intentionally small in this library:
 *
 * - construction failures stay explicit in the return type
 * - no helper ever throws to surface ordinary validation failure
 * - the public surface stops at simple creation, refinement, folding, and
 *   structural aggregation helpers
 *
 * Use this when an operation can fail because of runtime data, but that
 * failure should remain visible and typed instead of being hidden behind
 * exceptions or implicit coercion.
 *
 * In practical ECS code this is the shared language for construction-time
 * validation and fallible lookups. It keeps ordinary failure in the type
 * surface instead of pushing it into exceptions.
 *
 * @example
 * ```ts
 * declare const seed: number
 * declare const cellSize: number
 * // ---cut---
 * // Validate several authored inputs and keep every failure explicit.
 * const built = Result.all({
 *   rng: Random.result(seed),
 *   paths: FlowField.make(cellSize)
 * })
 * ```
 *
 * @module Result
 * @docGroup helpers
 *
 * @categoryDescription Result Types
 * The structural success and failure shapes used by non-throwing public APIs.
 *
 * @categoryDescription Constructors
 * Small helpers that create explicit success or failure values.
 *
 * @categoryDescription Refinements
 * Type guards that narrow one result to its successful or failed branch.
 *
 * @categoryDescription Operations
 * Pure helpers that fold or aggregate explicit result values.
 */
import * as internal from "./internal/result.ts"

/**
 * Successful branch of a {@link Result}.
 *
 * @category Result Types
 */
export type Success<out Value> = internal.Success<Value>
/**
 * Failed branch of a {@link Result}.
 *
 * @category Result Types
 */
export type Failure<out Error> = internal.Failure<Error>
/**
 * Explicit success/failure value used by non-throwing public APIs.
 *
 * @category Result Types
 */
export type Result<Value, Error> = internal.Result<Value, Error>
/**
 * Return type produced by {@link match}.
 *
 * @category Result Types
 */
export type MatchReturn<
  Value,
  Error,
  SuccessReturn,
  FailureReturn
> = internal.MatchReturn<Value, Error, SuccessReturn, FailureReturn>
/**
 * Success shape produced by {@link all}.
 *
 * @category Result Types
 */
export type AllSuccess<Input extends ReadonlyArray<Result<any, any>> | Readonly<Record<string, Result<any, any>>>> =
  internal.AllSuccess<Input>
/**
 * Failure shape produced by {@link all}.
 *
 * @category Result Types
 */
export type AllError<Input extends ReadonlyArray<Result<any, any>> | Readonly<Record<string, Result<any, any>>>> =
  internal.AllError<Input>

/**
 * Creates the successful branch of a {@link Result}.
 *
 * @category Constructors
 */
export const success: <Value>(value: Value) => Success<Value> = internal.success
/**
 * Creates the failed branch of a {@link Result}.
 *
 * @category Constructors
 */
export const failure: <Error>(error: Error) => Failure<Error> = internal.failure
/**
 * Narrows one {@link Result} to its successful branch.
 *
 * @category Refinements
 */
export const isSuccess: <Value, Error>(result: Result<Value, Error>) => result is Success<Value> = internal.isSuccess
/**
 * Narrows one {@link Result} to its failed branch.
 *
 * @category Refinements
 */
export const isFailure: <Value, Error>(result: Result<Value, Error>) => result is Failure<Error> = internal.isFailure
/**
 * Folds one {@link Result} into a plain value.
 *
 * Use this when you are leaving the `Result` shape and want one explicit place
 * to handle both branches.
 *
 * @example
 * ```ts
 * declare const seed: number
 * // ---cut---
 * const label = Result.match(Random.result(seed), {
 *   onSuccess: () => "ok",
 *   onFailure: () => "invalid"
 * })
 * ```
 *
 * @category Operations
 */
export const match: <Value, Error, SuccessReturn, FailureReturn>(
  result: Result<Value, Error>,
  handlers: {
    readonly onSuccess: (value: Value) => SuccessReturn
    readonly onFailure: (error: Error) => FailureReturn
  }
) => MatchReturn<Value, Error, SuccessReturn, FailureReturn> = internal.match
/**
 * Aggregates several independent results into one explicit result.
 *
 * Tuple input preserves tuple ordering in both success and failure shapes.
 * Record input preserves the original keys.
 *
 * The first failure stays explicit in the returned error structure rather than
 * throwing or silently dropping invalid entries.
 *
 * @example
 * ```ts
 * declare const seed: number
 * // ---cut---
 * const setup = Result.all({
 *   rng: Random.result(seed),
 *   paths: FlowField.make(30)
 * })
 * ```
 *
 * @category Operations
 */
export const all: <const Input extends ReadonlyArray<Result<any, any>> | Readonly<Record<string, Result<any, any>>>>(
  input: Input
) => Result<AllSuccess<Input>, AllError<Input>> = internal.all
