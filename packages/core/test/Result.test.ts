import { describe, expect, it } from "vitest"
import { Result } from "@typeonce/ritmo"

describe("Result", () => {
  it("is plain data with Effect's field names", () => {
    expect(Result.succeed(1)).toEqual({ _tag: "Success", success: 1 })
    expect(Result.fail("no")).toEqual({ _tag: "Failure", failure: "no" })
    expect(JSON.parse(JSON.stringify(Result.succeed({ x: 1 })))).toEqual({ _tag: "Success", success: { x: 1 } })
  })

  it("narrows with isSuccess and isFailure", () => {
    expect(Result.isSuccess(Result.succeed(1))).toBe(true)
    expect(Result.isFailure(Result.succeed(1))).toBe(false)
    expect(Result.isFailure(Result.fail(1))).toBe(true)
  })

  it("folds both branches with match", () => {
    const fold = (result: Result.Result<number, string>) =>
      Result.match(result, { onSuccess: (n) => `ok ${n}`, onFailure: (e) => `failed ${e}` })
    expect(fold(Result.succeed(2))).toBe("ok 2")
    expect(fold(Result.fail("boom"))).toBe("failed boom")
  })

  it("aggregates tuples and records with all, stopping at the first failure", () => {
    expect(Result.all([Result.succeed(1), Result.succeed("a")])).toEqual(Result.succeed([1, "a"]))
    expect(Result.all({ x: Result.succeed(1), y: Result.succeed(2) })).toEqual(Result.succeed({ x: 1, y: 2 }))
    expect(Result.all([Result.succeed(1), Result.fail("first"), Result.fail("second")])).toEqual(Result.fail("first"))
  })

  it("accepts a result built elsewhere with the same fields", () => {
    // What an Effect `Result` carries, extra members included.
    const foreign = { _tag: "Success" as const, _op: "Success", success: 3, pipe: () => undefined }
    expect(Result.match(foreign, { onSuccess: (n) => n * 2, onFailure: () => 0 })).toBe(6)
  })
})
