import { describe, expect, it } from "vitest"

import { Descriptor, Result, Schema } from "@typeonce/ritmo"
import { Random } from "@typeonce/ritmo-math"

const Rng = Descriptor.ConstructedResource(Random)("RandomResource/Rng")
const Game = Schema.bind(Schema.fragment({ resources: { Rng } }))
const State = Game.Inspector("RandomResource/State", { resources: { rng: Game.System.readResource(Rng) } }, ({ resources }) => resources.rng.get())

const makeRuntime = () => {
  const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Rng: Random.seed(42) } })
  if (made._tag === "Failure") throw new Error("expected a runtime")
  return made.success
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
      return Result.fail("nope")
    })
    runtime.tick(Game.Schedule(Fail))
    expect(runtime.inspect(State)).toBe(42)
    const saved = JSON.parse(JSON.stringify(runtime.snapshot()))
    expect(runtime.restore(saved)._tag).toBe("Success")
    expect(runtime.restore({ ...saved, resources: { "RandomResource/Rng": -1 } })._tag).toBe("Failure")
    expect(Random.seed(-1)).toBe(0xffffffff)
  })
})
