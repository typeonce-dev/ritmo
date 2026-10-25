// Prints the devtools demo's run headless: `node --import tsx src/demos/why/probe.ts`.
import { record } from "./sim.ts"

const run = record()
console.log(run.stop)
console.log()
console.log(run.why)
console.log()
console.log(run.dashes)
console.log()
console.log(run.deeper)
console.log()
console.log(run.frames.length, run.frames.filter((f) => f.dash).map((f) => f.frame), run.frames.at(-1))
