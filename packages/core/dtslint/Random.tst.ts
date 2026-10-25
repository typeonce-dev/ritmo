import { Descriptor, Random, Result } from "@typeonce/ritmo"
import type { StandardSchema } from "@typeonce/ritmo/Descriptor"
import { describe, expect, it } from "tstyche"

describe("Random", () => {
  it("makes absence explicit", () => {
    const random = Random.make(1)
    expect(random).type.toBe<Random.Random>()
    expect(random.pick(["a", "b"] as const)).type.toBe<"a" | "b" | undefined>()
    expect(random.weighted([{ weight: 1 }], (item) => item.weight)).type.toBe<{ weight: number } | undefined>()
    expect(random.shuffle([1, 2])).type.toBe<Array<number>>()
    // @ts-expect-error Cannot assign to 'state' because it is a read-only property
    random.state = 3
  })
})

describe("Random resource", () => {
  it("draws only from the cell of a random resource", () => {
    expect(Random.seed(1)).type.toBe<Random.State>()
    const cell = { get: () => Random.seed(1), set: (_: Random.State) => {}, update: () => {} }
    expect(Random.draw(cell)).type.toBe<Random.Random>()
    const score = { get: () => 1, set: (_: number) => {}, update: () => {} }
    // @ts-expect-error Type 'number' is not assignable to type 'State'
    Random.draw(score)
  })

  it("validates a state through result, the guard, or the codec", () => {
    expect(Random.result(1)).type.toBe<Result.Result<Random.State, Random.InvalidState>>()
    expect(Random.is).type.toBe<(raw: unknown) => raw is Random.State>()
    expect(Random.codec).type.toBe<StandardSchema<number, Random.State>>()
    expect(Descriptor.ConstructedResource(Random.codec)("Game/Rng")).type.toBe<
      Descriptor.ConstructedDescriptor<"resource", "Game/Rng", Random.State, number, Descriptor.SchemaIssues>
    >()
  })
})
