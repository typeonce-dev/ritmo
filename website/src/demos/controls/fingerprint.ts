// One scripted minute of the controls demo, reduced to a fingerprint of
// every position it passed through. The site computes it twice: in Node when
// the page is built, and in the reader's browser when the page opens. The
// two match bit for bit, on any engine and CPU, because the rules read time
// from the clock and trigonometry from `Ops`.
import * as Ops from "@typeonce/ritmo/Ops"
import { Gamepad, Keyboard, Pointer, Touch } from "@typeonce/ritmo-browser"

import { createControlsSimulation, keyBindings, makeControls, mouseBindings, padBindings, ReadLab, setupSchedule, touchNames, updateSchedule } from "./sim.ts"

export const FRAMES = 3600

/** Keys first, then a stick tilted at odd angles, dashing all along. */
const keys: Keyboard.Timeline<typeof keyBindings> = [
  { frame: 0, press: ["move.right"] },
  { frame: 30, press: ["dash"], release: ["dash"] },
  { frame: 90, press: ["move.up"] },
  { frame: 120, press: ["dash"], release: ["dash"] },
  { frame: 200, release: ["move.right", "move.up"] },
  { frame: 240, press: ["pause"], release: ["pause"] },
  { frame: 300, press: ["pause"], release: ["pause"] }
]

const pad: Gamepad.Timeline = Array.from({ length: 50 }, (_, index) => {
  const angle = 0.7 + index * 2.3
  const tilt = 0.35 + (index % 5) * 0.15
  return {
    frame: 360 + index * 64,
    left: { x: Ops.cos(angle) * tilt, y: Ops.sin(angle) * tilt },
    ...(index % 2 === 0 ? { press: ["south" as const], release: ["south" as const] } : {})
  }
})

/** FNV-1a over the bits of every number, as 16 hex digits (two 32-bit lanes). */
const hashNumbers = (values: Float64Array): string => {
  const bytes = new Uint8Array(values.buffer)
  let low = 0x811c9dc5
  let high = 0x01000193
  for (const byte of bytes) {
    low = Math.imul(low ^ byte, 0x01000193) >>> 0
    high = Math.imul(high ^ byte ^ (low & 0xff), 0x01000193) >>> 0
  }
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0")
}

export interface Fingerprint {
  readonly frames: number
  readonly hash: string
  /** Where the ball ends, rounded for people to read. */
  readonly end: { readonly x: number; readonly y: number }
}

/** Plays the script and hashes the ball's position after every update. */
export const fingerprint = (): Fingerprint => {
  const made = createControlsSimulation(makeControls({
    keyboard: Keyboard.scripted(keyBindings, keys),
    mouse: Pointer.scripted(mouseBindings, []),
    gamepad: Gamepad.scripted(padBindings, pad),
    touch: Touch.scripted(touchNames, [])
  }))
  if (!made.ok) throw new Error("The controls demo could not start.")
  const runtime = made.value
  const setup = runtime.tick(setupSchedule)
  if (!setup.ok) throw new Error("The controls demo's setup failed.")
  const positions = new Float64Array(FRAMES * 2)
  for (let frame = 0; frame < FRAMES; frame++) {
    const ticked = runtime.tick(updateSchedule)
    if (!ticked.ok) throw new Error(`Update ${frame} failed.`)
    const { position } = runtime.inspect(ReadLab)
    positions[frame * 2] = position.x
    positions[frame * 2 + 1] = position.y
  }
  const last = runtime.inspect(ReadLab).position
  return { frames: FRAMES, hash: hashNumbers(positions), end: { x: Math.round(last.x * 100) / 100, y: Math.round(last.y * 100) / 100 } }
}

/**
 * The same kind of sum done with `Math` instead: engines may round these
 * functions differently in the last bit, so this one can differ between
 * browsers, where the `Ops` one never does.
 */
export const trigonometry = (): { readonly ops: string; readonly math: string } => {
  const ops = new Float64Array(2000)
  const math = new Float64Array(2000)
  for (let index = 0; index < 1000; index++) {
    const x = 0.1 + index * 7.77
    ops[index * 2] = Ops.sin(x)
    ops[index * 2 + 1] = Ops.atan2(Ops.cos(x), x)
    math[index * 2] = Math.sin(x)
    math[index * 2 + 1] = Math.atan2(Math.cos(x), x)
  }
  return { ops: hashNumbers(ops), math: hashNumbers(math) }
}
