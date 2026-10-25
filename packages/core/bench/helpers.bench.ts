/**
 * Benchmark cases for `Ops` and `Random`, the helpers simulation code calls
 * per entity every frame. Cases use only the public API and fold their
 * results into a checked sum so the work cannot be optimized away.
 */
import { Descriptor, Ops, Random, Schema } from "@typeonce/ritmo"
import type { BenchCase } from "./harness.ts"

const N = 10_000

const check = (total: number): void => {
  if (Number.isNaN(total)) throw new Error("benchmark produced NaN")
}

const points = (count: number): Array<{ readonly x: number; readonly y: number }> =>
  Array.from({ length: count }, (_, index) => ({ x: (index % 97) - 48, y: (index % 89) - 44 }))

const randomNext: BenchCase = {
  name: "random/next-100k",
  description: "Draw 100,000 random numbers",
  setup: () => {
    const random = Random.make(1)
    return {
      run: () => {
        let total = 0
        for (let draw = 0; draw < 100_000; draw++) total += random.next()
        check(total)
      }
    }
  }
}

const randomDraw: BenchCase = {
  name: "random/draw-resource-100k",
  description: "Draw 100,000 random numbers from a resource in one system",
  setup: () => {
    const Rng = Descriptor.ConstructedResource(Random.codec)("Bench/Rng")
    const Game = Schema.bind(Schema.fragment({ resources: { Rng } }))
    const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Rng: Random.seed(1) } })
    if (!made.ok) throw new Error("bench runtime")
    const runtime = made.value
    const schedule = Game.Schedule(Game.System("Bench/Draw", { resources: { rng: Game.System.writeResource(Rng) } }, ({ resources }) => {
      const random = Random.draw(resources.rng)
      let total = 0
      for (let draw = 0; draw < 100_000; draw++) total += random.next()
      check(total)
    }))
    return { run: () => { runtime.tick(schedule) } }
  }
}

const opsSteer: BenchCase = {
  name: "ops/steer-10k",
  description: "Aim 10k bodies with Ops.atan2, step along the heading with Ops.cos/sin, and measure with Ops.hypot",
  setup: () => {
    const positions = points(N)
    const targets = points(N).reverse()
    return {
      run: () => {
        let total = 0
        for (let index = 0; index < N; index++) {
          const position = positions[index]!
          const target = targets[index]!
          const heading = Ops.atan2(target.y - position.y, target.x - position.x)
          const next = { x: position.x + Ops.cos(heading) * 2.5, y: position.y + Ops.sin(heading) * 2.5 }
          total += Ops.hypot(next.x, next.y) * Ops.exp(-0.1)
        }
        check(total)
      }
    }
  }
}

export const cases: ReadonlyArray<BenchCase> = [randomNext, randomDraw, opsSteer]
