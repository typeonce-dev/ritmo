import * as Ritmo from "@typeonce/ritmo"
import type { StandardSchema } from "@typeonce/ritmo/Descriptor"
import * as RitmoMath from "@typeonce/ritmo-math"
import { describe, expect, it } from "tstyche"

// The exports of a module (and of the namespaces it re-exports) that are
// functions building a schema. Ritmo takes the game's schemas; it never
// grows a schema library of its own.
type Builders<Module, Path extends string = ""> = {
  [K in keyof Module & string]: Module[K] extends (...args: ReadonlyArray<any>) => infer Built
    ? Built extends StandardSchema<any, any> ? `${Path}${K}` : never
    : Path extends "" ? Module[K] extends object ? Builders<Module[K], `${K}.`> : never
    : never
}[keyof Module & string]

describe("Ritmo exports no codec builders", () => {
  it("has no function that returns a schema in the core or the math package", () => {
    expect<Builders<typeof Ritmo>>().type.toBe<never>()
    expect<Builders<typeof RitmoMath>>().type.toBe<never>()
  })

  it("would name a builder if one were exported", () => {
    const Module = { Values: { number: (): StandardSchema<number, Ritmo.Random.State> => Ritmo.Random.codec } }
    expect<Builders<typeof Module>>().type.toBe<"Values.number">()
  })
})
