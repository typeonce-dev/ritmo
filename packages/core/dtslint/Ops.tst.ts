import { Ops } from "@typeonce/ritmo"
import { describe, expect, it } from "tstyche"

describe("Ops", () => {
  it("takes and returns plain numbers", () => {
    expect(Ops.sin(1)).type.toBe<number>()
    expect(Ops.atan2(1, 2)).type.toBe<number>()
    expect(Ops.pow(2, 0.5)).type.toBe<number>()
    expect(Ops.hypot(3, 4)).type.toBe<number>()
    // @ts-expect-error Expected 2 arguments, but got 3
    Ops.hypot(1, 2, 3)
  })
})
