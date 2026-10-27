import { describe, expect, it } from "vitest"

import { evaluate } from "../src/core/math.ts"

describe("math in number fields", () => {
  it("reads plain numbers", () => {
    expect(evaluate("19.905", 8)).toBe(19.905)
    expect(evaluate(" .5 ", 8)).toBe(0.5)
    expect(evaluate("-1", 8)).toBe(-1)
    expect(evaluate("1e3", undefined)).toBe(1000)
  })

  it("computes expressions, with the usual order and brackets", () => {
    expect(evaluate("1015/51", 8)).toBeCloseTo(19.9020, 4)
    expect(evaluate("2+3*4", 8)).toBe(14)
    expect(evaluate("(2+3)*4", 8)).toBe(20)
    expect(evaluate("20-1", 8)).toBe(19)
    expect(evaluate("-(2+3)", 8)).toBe(-5)
    expect(evaluate("2*-3", 8)).toBe(-6)
  })

  it("applies an operator first to the value already there", () => {
    expect(evaluate("*2", 19.9)).toBe(39.8)
    expect(evaluate("/2", 19.9)).toBe(9.95)
    expect(evaluate("+0.5", 9.55)).toBeCloseTo(10.05, 10)
    expect(evaluate("*2+1", 3)).toBe(7)
    expect(evaluate("*2", undefined)).toBeUndefined()
  })

  it("rejects anything else, and dividing by zero", () => {
    for (const text of ["", "abc", "2+", "(2", "2)", "2**3", "1/0", "/0", "alert(1)", "2 3", "1..2"]) {
      expect(evaluate(text, 4)).toBeUndefined()
    }
  })
})
