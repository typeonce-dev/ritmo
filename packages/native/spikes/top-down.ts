import { HostClock } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { createTopDownSimulation } from "../../../examples/top-down/simulation.ts"
import { inputBindings } from "../../../examples/top-down/types.ts"

const made = createTopDownSimulation({
  hostClock: HostClock.test(),
  keyboard: Keyboard.scripted(inputBindings, [
    { frame: 0, press: ["left"] },
    { frame: 85, release: ["left"] },
    { frame: 88, press: ["interact"], release: ["interact"] },
    { frame: 120, press: ["right", "down"] },
    { frame: 240, release: ["right", "down"] }
  ])
})
if (!made.ok) throw new Error(made.error.message)
const { runtime, setup, update } = made.value
if (!runtime.tick(setup).ok) throw new Error("setup failed")
for (let frame = 0; frame < 600; frame++) {
  const result = runtime.tick(update)
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  console.log(JSON.stringify(runtime.debug.dump()))
}
