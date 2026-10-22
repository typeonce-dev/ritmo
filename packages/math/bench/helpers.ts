/**
 * Timings of the hot-path helpers at a busy game's scale:
 *
 *   pnpm bench:math
 *
 * Each line is the median of several runs, per call of what a game does
 * every step: rebuild and query a spatial grid over 1,000 bodies, follow a
 * flow field, move bodies through walls, and draw random numbers.
 */
import { Box2, Collide2, FlowField, Random, Scalar, SpatialGrid } from "@typeonce/ritmo-math"

const positive = (value: number): Scalar.Positive => {
  const checked = Scalar.Positive.result(value)
  if (checked._tag === "Failure") throw new Error(`Not positive: ${value}`)
  return checked.success
}

/** Median nanoseconds per operation of `run`, which does `operations` operations. */
const measure = (label: string, operations: number, run: () => number): void => {
  let sink = 0
  for (let warm = 0; warm < 3; warm++) sink += run()
  const samples: Array<number> = []
  for (let sample = 0; sample < 9; sample++) {
    const start = performance.now()
    sink += run()
    samples.push(((performance.now() - start) * 1e6) / operations)
  }
  samples.sort((a, b) => a - b)
  console.log(`${label.padEnd(52)} ${samples[4]!.toFixed(1).padStart(10)} ns/op${sink === 0.5 ? " " : ""}`)
}

const random = Random.make(1)
const bodies = Array.from({ length: 1000 }, () => ({ x: random.range(0, 2000), y: random.range(0, 1200), r: random.range(8, 24) }))
const walls = Array.from({ length: 40 }, () => Box2.around(random.range(0, 2000), random.range(0, 1200), random.range(10, 80), random.range(10, 80)))

const grid = SpatialGrid.make(positive(64))
measure("SpatialGrid: rebuild over 1,000 bodies (per frame)", 1, () => {
  grid.clear()
  for (let index = 0; index < bodies.length; index++) grid.insert(index, bodies[index]!.x, bodies[index]!.y, bodies[index]!.r)
  return 0
})
measure("SpatialGrid: query a 96 × 96 box (per query)", bodies.length, () => {
  let found = 0
  for (const body of bodies) grid.forEachIn(body.x - 48, body.y - 48, body.x + 48, body.y + 48, () => found++)
  return found
})

const paths = FlowField.make(positive(30))
paths.setWalls(walls, 12)
let goal = 0
measure("FlowField: search after the goal moves (2,800 cells)", 1, () => {
  goal++
  paths.setGoal({ x: 200 + (goal % 40) * 40, y: 600 })
  return 0
})
measure("FlowField: way for one body", bodies.length, () => {
  let sum = 0
  for (const body of bodies) sum += paths.way(body)?.x ?? 0
  return sum
})

measure("Collide2: moveCircle through 40 walls", bodies.length, () => {
  let sum = 0
  for (const body of bodies) sum += Collide2.moveCircle(body, { x: 7, y: -5 }, body.r, walls).position.x
  return sum
})

measure("Random: next", 1_000_000, () => {
  let sum = 0
  for (let draw = 0; draw < 1_000_000; draw++) sum += random.next()
  return sum
})
