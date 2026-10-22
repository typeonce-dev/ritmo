import { Result } from "@typeonce/ritmo"
import { describe, expect, it } from "tstyche"

// A result shaped like Effect's `Result`: the same fields plus members of its
// own (Ritmo never imports Effect; this stands in for it).
declare const effectTypeId: unique symbol
interface EffectSuccess<A, E> {
  readonly _tag: "Success"
  readonly _op: "Success"
  readonly success: A
  readonly [effectTypeId]: { readonly _A: A; readonly _E: E }
  pipe(): unknown
}
interface EffectFailure<A, E> {
  readonly _tag: "Failure"
  readonly _op: "Failure"
  readonly failure: E
  readonly [effectTypeId]: { readonly _A: A; readonly _E: E }
  pipe(): unknown
}
type EffectResult<A, E> = EffectSuccess<A, E> | EffectFailure<A, E>

describe("Result", () => {
  it("types the constructors as their branch", () => {
    expect(Result.succeed(1)).type.toBe<Result.Success<number>>()
    expect(Result.fail({ _tag: "Boom" as const })).type.toBe<Result.Failure<{ _tag: "Boom" }>>()
    expect(Result.succeed(1)).type.toBeAssignableTo<Result.Result<number, never>>()
  })

  it("narrows on _tag to the branch's field", () => {
    const result = {} as Result.Result<number, string>
    if (result._tag === "Success") expect(result.success).type.toBe<number>()
    else expect(result.failure).type.toBe<string>()
    // @ts-expect-error Property 'success' does not exist on type 'Failure<string>'
    result.success
  })

  it("accepts a result shaped like Effect's, so its decode and encode functions plug in", () => {
    expect<EffectResult<number, string>>().type.toBeAssignableTo<Result.Result<number, string>>()
    const decode = (_: unknown): EffectResult<number, string> => ({} as never)
    const codec: { readonly decode: (raw: unknown) => Result.Result<number, string> } = { decode }
    expect(codec.decode).type.toBe<(raw: unknown) => Result.Result<number, string>>()
    expect<EffectResult<number, string>>().type.not.toBeAssignableTo<Result.Result<string, string>>()
  })

  it("folds and aggregates", () => {
    const result = {} as Result.Result<number, string>
    expect(Result.match(result, { onSuccess: (n) => n + 1, onFailure: (e) => e.length })).type.toBe<number>()
    expect(Result.all([Result.succeed(1), Result.fail("no" as const)])).type.toBe<Result.Result<readonly [number, never], "no">>()
  })
})
