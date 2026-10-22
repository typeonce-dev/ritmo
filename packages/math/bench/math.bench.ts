/**
 * Runtime benchmark cases for validated math values and hot-path helpers.
 *
 * These run inside per-entity systems every frame, so each case does the work
 * of one frame over many entities. The helper cases use the scale of a busy
 * game: 1,000 bodies and 40 walls (see `helpers.ts` for per-call timings). Cases use only the public API and fold
 * their results into a checked sum so the work cannot be optimized away.
 */
import type { BenchCase } from "../../core/bench/harness.ts"
import { Descriptor, Schema } from "@typeonce/ritmo"
import { Aabb, Box2, Collide2, FlowField, InputAxis, Ops, Random, Scalar, SpatialGrid, Vec2, Vector2 } from "@typeonce/ritmo-math"

const N = 10_000

const check = (total: number): void => {
  if (Number.isNaN(total)) throw new Error("benchmark produced NaN")
}

const vectors = (count: number): Array<Vector2.Vector2> =>
  Array.from({ length: count }, (_, index) => Vector2.option({ x: (index % 97) - 48, y: (index % 89) - 44 })!)

const vectorOps: BenchCase = {
  name: "math/vector2-move-10k",
  description: "Steer, normalize, scale, and integrate 10k positions, as in a movement system",
  setup: () => {
    const positions = vectors(N)
    const targets = vectors(N).reverse()
    const speed = Scalar.Finite.option(2.5)!
    return {
      run: () => {
        let total = 0
        for (let index = 0; index < N; index++) {
          const position = positions[index]!
          const direction = Vector2.normalizeOrZero(Vector2.subtract(targets[index]!, position))
          const next = Vector2.add(position, Vector2.scale(direction, speed))
          total += Vector2.length(next)
        }
        check(total)
      }
    }
  }
}

const vectorValidate: BenchCase = {
  name: "math/vector2-validate-10k",
  description: "Validate 10k raw vectors (1 in 100 invalid) through the result constructor",
  setup: () => {
    const raws = Array.from({ length: N }, (_, index) => ({
      x: index % 100 === 0 ? Number.NaN : index,
      y: index * 0.5
    }))
    return {
      run: () => {
        let total = 0
        for (let index = 0; index < N; index++) {
          const vector = Vector2.result(raws[index]!)
          total += vector._tag === "Success" ? vector.success.y : -1
        }
        check(total)
      }
    }
  }
}

const scalarOps: BenchCase = {
  name: "math/scalar-approach-clamp-10k",
  description: "Approach a target speed and clamp it for 10k values, as in acceleration code",
  setup: () => {
    const speeds = Array.from({ length: N }, (_, index) => Scalar.Finite.option(index % 13)!)
    const target = Scalar.Finite.option(6)!
    const step = Scalar.NonNegative.option(0.75)!
    const min = Scalar.Finite.option(0)!
    const max = Scalar.Finite.option(10)!
    return {
      run: () => {
        let total = 0
        for (let index = 0; index < N; index++) {
          total += Scalar.clamp(Scalar.approach(speeds[index]!, target, step), min, max)
        }
        check(total)
      }
    }
  }
}

const aabbOverlap: BenchCase = {
  name: "math/aabb-intersects-200x200",
  description: "All-pairs intersection tests between 200 movers and 200 obstacles, plus translation",
  setup: () => {
    const boxes = (count: number, offset: number) => Array.from({ length: count }, (_, index) => Aabb.option({
      position: { x: (index % 20) * 16 + offset, y: Math.floor(index / 20) * 16 + offset },
      size: { width: 12, height: 12 }
    })!)
    const movers = boxes(200, 0)
    const obstacles = boxes(200, 6)
    const delta = Vector2.option({ x: 0.5, y: -0.5 })!
    return {
      run: () => {
        let hits = 0
        for (let index = 0; index < movers.length; index++) {
          const moved = Aabb.translate(movers[index]!, delta)
          for (let other = 0; other < obstacles.length; other++) {
            if (Aabb.intersects(moved, obstacles[other]!)) hits++
          }
        }
        check(hits)
      }
    }
  }
}

const inputAxis: BenchCase = {
  name: "math/input-axis-10k",
  description: "Turn 10k directional key states into normalized movement vectors",
  setup: () => {
    const inputs = Array.from({ length: N }, (_, index) => ({
      left: (index & 1) !== 0,
      right: (index & 2) !== 0,
      up: (index & 4) !== 0,
      down: (index & 8) !== 0
    }))
    return {
      run: () => {
        let total = 0
        for (let index = 0; index < N; index++) {
          const direction = InputAxis.vectorFromAxes(inputs[index]!)
          total += direction.x + direction.y
        }
        check(total)
      }
    }
  }
}

// A fixed world shared by the helper cases; the seed keeps it identical across runs.
const world = () => {
  const random = Random.make(1)
  const bodies = Array.from({ length: 1_000 }, () => ({ x: random.range(0, 2000), y: random.range(0, 1200), r: random.range(8, 24) }))
  const walls = Array.from({ length: 40 }, () => Box2.around(random.range(0, 2000), random.range(0, 1200), random.range(10, 80), random.range(10, 80)))
  return { bodies, walls }
}

const spatialGrid: BenchCase = {
  name: "math/spatial-grid-1k",
  description: "Rebuild a spatial grid over 1,000 bodies and query a 96 × 96 box around each",
  setup: () => {
    const { bodies } = world()
    const grid = SpatialGrid.make(Scalar.Positive.option(64)!)
    let found = 0
    const visit = () => {
      found++
    }
    return {
      run: () => {
        grid.clear()
        for (let index = 0; index < bodies.length; index++) grid.insert(index, bodies[index]!.x, bodies[index]!.y, bodies[index]!.r)
        found = 0
        for (const body of bodies) grid.forEachIn(body.x - 48, body.y - 48, body.x + 48, body.y + 48, visit)
        check(found)
      }
    }
  }
}

const flowFieldSearch: BenchCase = {
  name: "math/flow-field-search",
  description: "Search a 2,800-cell flow field around 40 walls after the goal moves",
  setup: () => {
    const { walls } = world()
    const paths = FlowField.make(Scalar.Positive.option(30)!)
    paths.setWalls(walls, 12)
    let goal = 0
    return {
      run: () => {
        goal++
        paths.setGoal({ x: 200 + (goal % 40) * 40, y: 600 })
      }
    }
  }
}

const flowFieldWay: BenchCase = {
  name: "math/flow-field-way-1k",
  description: "Read the flow field direction for 1,000 bodies",
  setup: () => {
    const { bodies, walls } = world()
    const paths = FlowField.make(Scalar.Positive.option(30)!)
    paths.setWalls(walls, 12)
    paths.setGoal({ x: 1000, y: 600 })
    return {
      run: () => {
        let total = 0
        for (const body of bodies) total += paths.way(body)?.x ?? 0
        check(total)
      }
    }
  }
}

const moveCircle: BenchCase = {
  name: "math/collide-move-circle-1k",
  description: "Move 1,000 circles through 40 walls, sliding along them",
  setup: () => {
    const { bodies, walls } = world()
    const delta = { x: 7, y: -5 }
    return {
      run: () => {
        let total = 0
        for (const body of bodies) total += Collide2.moveCircle(body, delta, body.r, walls).position.x
        check(total)
      }
    }
  }
}

const randomNext: BenchCase = {
  name: "math/random-next-100k",
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
  name: "math/random-draw-resource-100k",
  description: "Draw 100,000 random numbers from a resource in one system",
  setup: () => {
    const Rng = Descriptor.ConstructedResource(Random)("Bench/Rng")
    const Game = Schema.bind(Schema.fragment({ resources: { Rng } }))
    const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Rng: Random.seed(1) } })
    if (made._tag === "Failure") throw new Error("bench runtime")
    const runtime = made.success
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
  name: "math/ops-steer-10k",
  description: "Aim 10k bodies with Ops.atan2, step along the heading with Ops.cos/sin, and measure with Vec2.length",
  setup: () => {
    const positions = vectors(N)
    const targets = vectors(N).reverse()
    return {
      run: () => {
        let total = 0
        for (let index = 0; index < N; index++) {
          const position = positions[index]!
          const target = targets[index]!
          const heading = Ops.atan2(target.y - position.y, target.x - position.x)
          const next = { x: position.x + Ops.cos(heading) * 2.5, y: position.y + Ops.sin(heading) * 2.5 }
          total += Vec2.length(next) * Ops.exp(-0.1)
        }
        check(total)
      }
    }
  }
}

export const cases: ReadonlyArray<BenchCase> = [
  vectorOps,
  vectorValidate,
  scalarOps,
  aabbOverlap,
  inputAxis,
  spatialGrid,
  flowFieldSearch,
  flowFieldWay,
  moveCircle,
  randomNext,
  randomDraw,
  opsSteer
]
