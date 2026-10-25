/**
 * Timings of the hot-path helpers at a busy game's scale:
 *
 *   pnpm bench:math
 *
 * Each line is the median of several runs, per call of what a game does
 * every step: follow a flow field and move bodies through walls.
 */
import { Random } from "@typeonce/ritmo"
import { Box2, Collide2, FlowField } from "@typeonce/ritmo-math"

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

const made = FlowField.make(30)
if (!made.ok) throw new Error("bench cell size")
const paths = made.value
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
  for (const body of bodies) sum += Collide2.moveCircle(body, { x: 7, y: -5 }, body.r, { boxes: walls }).position.x
  return sum
})
