/**
 * The top-down game's whole fixed update, as a shipped page runs it: no
 * debug handle, and live devices on stand-in hosts, with keys pressed
 * between frames and no mouse button or gamepad in use. The world is small, so this measures what every frame of
 * a game pays for the schedule itself: input capture, queries, change
 * tracking, deferred commands, and state transitions.
 */
import { Gamepad, Keyboard, Pointer } from "@typeonce/ritmo-browser"

import type { BenchCase } from "../../../packages/core/bench/harness.ts"
import { FIXED_STEP_SECONDS } from "../constants.ts"
import { initialMachines, initialResources } from "../runtime.ts"
import { ControlsInput, FrameContext, Game } from "../schema.ts"
import { setupWorldSchedule, simulationSchedule } from "../schedules.ts"
import { inputBindings, makeControls, mouseBindings, padBindings } from "../types.ts"

const FRAMES = 60

/** A window that only holds the keyboard's listeners, so the bench can type between frames. */
const keyboardHost = () => {
  const listeners = { keydown: new Set<(event: Keyboard.KeyEvent) => void>(), keyup: new Set<(event: Keyboard.KeyEvent) => void>() }
  const host: Keyboard.KeyboardHost = {
    addEventListener: (type: string, listener: (event: Keyboard.KeyEvent) => void) => {
      if (type === "keydown" || type === "keyup") listeners[type].add(listener)
    },
    removeEventListener: (type: string, listener: (event: Keyboard.KeyEvent) => void) => {
      if (type === "keydown" || type === "keyup") listeners[type].delete(listener)
    }
  }
  const dispatch = (type: "keydown" | "keyup", key: string): void => {
    const event: Keyboard.KeyEvent = { key, repeat: false, preventDefault: () => {} }
    for (const listener of listeners[type]) listener(event)
  }
  return { host, dispatch }
}

/** A window or canvas whose events never fire: the mouse and the gamepad stay idle. */
const silentHost = {
  addEventListener: () => {},
  removeEventListener: () => {},
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  getBoundingClientRect: () => ({ left: 0, top: 0 }),
  navigator: { getGamepads: () => [] }
}

export const cases: ReadonlyArray<BenchCase> = [{
  name: "top-down/frame-x60",
  description: "One second of the top-down game: 60 fixed updates, walking right then left with live devices and no debug handle",
  critical: true,
  setup: () => {
    const keyboard = keyboardHost()
    const frame = { deltaSeconds: FIXED_STEP_SECONDS }
    const controls = makeControls({
      keyboard: Keyboard.actions(keyboard.host, inputBindings),
      mouse: Pointer.actions(silentHost, silentHost, mouseBindings),
      gamepad: Gamepad.actions(silentHost, padBindings)
    })
    const made = Game.Runtime.make({
      services: Game.Runtime.services(
        Game.Runtime.service(ControlsInput, controls),
        Game.Runtime.service(FrameContext, frame)
      ),
      resources: initialResources(frame),
      machines: initialMachines()
    })
    if (!made.ok) throw new Error("Invalid top-down runtime resources.")
    const runtime = made.value
    if (!runtime.tick(setupWorldSchedule).ok) throw new Error("top-down setup failed")
    const update = (): void => {
      if (!runtime.tick(simulationSchedule).ok) throw new Error("top-down update failed")
    }
    return {
      run: () => {
        keyboard.dispatch("keydown", "ArrowRight")
        for (let index = 0; index < FRAMES / 2; index++) update()
        keyboard.dispatch("keyup", "ArrowRight")
        keyboard.dispatch("keydown", "ArrowLeft")
        for (let index = 0; index < FRAMES / 2; index++) update()
        keyboard.dispatch("keyup", "ArrowLeft")
      }
    }
  }
}]
