import { describe, expect, it } from "vitest"

import { Descriptor, Random, Result, Schema } from "@typeonce/ritmo"
import { worldOf } from "./saved.ts"

const Rng = Descriptor.ConstructedResource(Random.codec)("RandomResource/Rng")
const Game = Schema.bind(Schema.fragment({ resources: { Rng } }))
const State = Game.Inspector("RandomResource/State", { resources: { rng: Game.System.readResource(Rng) } }, ({ resources }) => resources.rng.get())

const makeRuntime = () => {
  const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Rng: Random.seed(42) } })
  if (!made.ok) throw new Error("expected a runtime")
  return made.value
}

describe("Random as a resource", () => {
  it("draws the same sequence as make, writing each draw back", () => {
    const runtime = makeRuntime()
    const rolls: Array<number> = []
    const Roll = Game.System("RandomResource/Roll", { resources: { rng: Game.System.writeResource(Rng) } }, ({ resources }) => {
      const first = Random.draw(resources.rng)
      const second = Random.draw(resources.rng)
      rolls.push(first.next(), second.next(), first.next())
    })
    runtime.tick(Game.Schedule(Roll))
    const reference = Random.make(42)
    expect(rolls).toEqual([reference.next(), reference.next(), reference.next()])
    expect(runtime.inspect(State)).toBe(reference.state)
  })

  it("rolls draws back with a failed system, and saves and validates the state", () => {
    const runtime = makeRuntime()
    const Fail = Game.System("RandomResource/Fail", { resources: { rng: Game.System.writeResource(Rng) } }, ({ resources }) => {
      Random.draw(resources.rng).next()
      return Result.failure("nope")
    })
    runtime.tick(Game.Schedule(Fail))
    expect(runtime.inspect(State)).toBe(42)
    const saved = JSON.parse(JSON.stringify(worldOf(runtime.snapshot())))
    expect(runtime.restore(saved).ok).toBe(true)
    expect(runtime.restore({ ...saved, resources: { "RandomResource/Rng": -1 } }).ok).toBe(false)
    expect(Random.seed(-1)).toBe(0xffffffff)
  })

  it("validates untrusted input of any shape through the codec and the guard", () => {
    const validate = (raw: unknown) => Random.codec["~standard"].validate(raw)
    expect(validate(7)).toEqual({ value: 7 })
    for (const raw of [2 ** 32, -1, 1.5, "1", null]) {
      expect(Random.is(raw)).toBe(false)
      expect(validate(raw)).toEqual({ issues: [{ message: "Expected a generator state: an unsigned 32-bit integer" }] })
    }
    expect(Random.result(-1)).toEqual(Result.failure({ _tag: "InvalidRandomState", value: -1 }))
  })
})
