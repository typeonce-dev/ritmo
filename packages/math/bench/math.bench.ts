/**
 * Runtime benchmark cases for the hot-path helpers.
 *
 * These run inside per-entity systems every frame, so each case does the work
 * of one frame over many entities. The helper cases use the scale of a busy
 * game: 1,000 bodies and 40 walls (see `helpers.ts` for per-call timings). Cases use only the public API and fold
 * their results into a checked sum so the work cannot be optimized away.
 */
import type { BenchCase } from "../../core/bench/harness.ts"
import { Random } from "@typeonce/ritmo"
import { Angle, Box2, Collide2, FlowField, Scalar, Segment2, Vec2 } from "@typeonce/ritmo-math"

const N = 10_000

const check = (total: number): void => {
  if (Number.isNaN(total)) throw new Error("benchmark produced NaN")
}

const points = (count: number): Array<Vec2.Vec2> =>
  Array.from({ length: count }, (_, index) => ({ x: (index % 97) - 48, y: (index % 89) - 44 }))

const vectorOps: BenchCase = {
  name: "math/vec2-steer-10k",
  description: "Steer 10k positions toward their targets: aim, turn the heading at a capped rate, and step along it, as in a movement system",
  setup: () => {
    const positions = points(N)
    const targets = points(N).reverse()
    const headings = new Float64Array(N)
    return {
      run: () => {
        let total = 0
        for (let index = 0; index < N; index++) {
          const position = positions[index]!
          const heading = Angle.turnToward(headings[index]!, Vec2.angle(Vec2.subtract(targets[index]!, position)), 0.1)
          headings[index] = heading
          const next = Vec2.add(position, Vec2.scale(Vec2.fromAngle(heading), 2.5))
          total += Vec2.length(Vec2.decayToward(next, position, 4, 1 / 60))
        }
        check(total)
      }
    }
  }
}




const springs: BenchCase = {
  name: "math/scalar-spring-10k",
  description: "Spring 10k values toward moving targets, one underdamped, one critical, and one overdamped spec in turn, as a squash or wobble in a render step",
  setup: () => {
    const specs: ReadonlyArray<Scalar.SpringSpec> = [
      { frequencyHz: 3, dampingRatio: 0.3 },
      { frequencyHz: 2, dampingRatio: 1 },
      { frequencyHz: 4, dampingRatio: 1.8 }
    ]
    let states: Array<Scalar.Spring> = Array.from({ length: N }, (_, index) => ({ value: index % 7, velocity: 0 }))
    let frame = 0
    return {
      run: () => {
        frame++
        let total = 0
        states = states.map((state, index) => {
          const next = Scalar.spring(state, (index + frame) % 11, specs[index % 3]!, 1 / 60)
          total += next.value
          return next
        })
        check(total)
      }
    }
  }
}

const field = (cellSize: number): FlowField.FlowField => {
  const made = FlowField.make(cellSize)
  if (!made.ok) throw new Error("bench cell size")
  return made.value
}

// A fixed world shared by the helper cases; the seed keeps it identical across runs.
const world = () => {
  const random = Random.make(1)
  const bodies = Array.from({ length: 1_000 }, () => ({ x: random.range(0, 2000), y: random.range(0, 1200), r: random.range(8, 24) }))
  const walls = Array.from({ length: 40 }, () => Box2.around(random.range(0, 2000), random.range(0, 1200), random.range(10, 80), random.range(10, 80)))
  return { bodies, walls }
}


const flowFieldSearch: BenchCase = {
  name: "math/flow-field-search",
  description: "Search a 2,800-cell flow field around 40 walls after the goal moves",
  setup: () => {
    const { walls } = world()
    const paths = field(30)
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
    const paths = field(30)
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
    const boxes = { boxes: walls }
    const delta = { x: 7, y: -5 }
    return {
      run: () => {
        let total = 0
        for (const body of bodies) total += Collide2.moveCircle(body, delta, body.r, boxes).position.x
        check(total)
      }
    }
  }
}

const moveCircleSegments: BenchCase = {
  name: "math/collide-move-circle-segments-1k",
  description: "Move 1,000 circles through 160 segment walls (the edges of 40 boxes), sliding along them",
  setup: () => {
    const { bodies, walls } = world()
    const segments = {
      segments: walls.flatMap((box) => [
        Segment2.between({ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }),
        Segment2.between({ x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }),
        Segment2.between({ x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }),
        Segment2.between({ x: box.minX, y: box.maxY }, { x: box.minX, y: box.minY })
      ])
    }
    const delta = { x: 7, y: -5 }
    return {
      run: () => {
        let total = 0
        for (const body of bodies) total += Collide2.moveCircle(body, delta, body.r, segments).position.x
        check(total)
      }
    }
  }
}




export const cases: ReadonlyArray<BenchCase> = [
  vectorOps,
  springs,
  flowFieldSearch,
  flowFieldWay,
  moveCircle,
  moveCircleSegments
]
