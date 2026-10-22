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
 * A result is plain data, `{ _tag: "Success", success }` or
 * `{ _tag: "Failure", failure }`: narrow it on `_tag` (or with
 * `isSuccess`/`isFailure`). It has the same fields as Effect's `Result`, so an
 * Effect `Result` (from `Schema.decodeUnknownResult`, say) is a Ritmo result
 * as it is, and a Ritmo result becomes an Effect with
 * `r._tag === "Success" ? Effect.succeed(r.success) : Effect.fail(r.failure)`.
 *
 * In practical ECS code this is the shared language for construction-time
 * validation and fallible lookups. It keeps ordinary failure in the type
 * surface instead of pushing it into exceptions.
 *
 * @example
 * ```ts
 * // Validate several authored inputs and keep every failure explicit.
 * const built = Result.all({
 *   position: Vector2.result({ x: 4, y: 8 }),
 *   size: Size2.result({ width: 16, height: 16 })
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
 * @example
 * ```ts
 * const ok = Result.succeed(42) // { _tag: "Success", success: 42 }
 * ```
 *
 * @category Constructors
 */
export const succeed: <Value>(success: Value) => Success<Value> = internal.succeed
/**
 * Creates the failed branch of a {@link Result}. Give the error a `_tag` so
 * callers can narrow it.
 *
 * @example
 * ```ts
 * const failed = Result.fail({ _tag: "OutOfRange", value: -1 }) // { _tag: "Failure", failure: { ... } }
 * ```
 *
 * @category Constructors
 */
export const fail: <Error>(failure: Error) => Failure<Error> = internal.fail
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
 * const label = Result.match(Vector2.result({ x: 0, y: 0 }), {
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
 * const geometry = Result.all({
 *   position: Vector2.result({ x: 10, y: 20 }),
 *   size: Size2.result({ width: 32, height: 16 })
 * })
 * ```
 *
 * @category Operations
 */
export const all: <const Input extends ReadonlyArray<Result<any, any>> | Readonly<Record<string, Result<any, any>>>>(
  input: Input
) => Result<AllSuccess<Input>, AllError<Input>> = internal.all
