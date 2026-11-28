import { describe, expect, it } from "vitest"

import { Controls, Gamepad, Keyboard } from "@typeonce/ritmo-browser"
import * as Random from "@typeonce/ritmo/Random"

/** A standard pad whose buttons the test sets, read by index. */
const makePad = (mapping = "standard") => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
  const pad = { id: "pad", index: 0, connected: true, mapping, buttons, axes: [0, 0, 0, 0] }
  const at = (name: Gamepad.Button) => Gamepad.buttonNames.indexOf(name)
  const host: Gamepad.GamepadHost = {
    navigator: { getGamepads: () => [pad] },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {}
  }
  return {
    host,
    down: (name: Gamepad.Button) => (buttons[at(name)] = { pressed: true, value: 1 }),
    up: (name: Gamepad.Button) => (buttons[at(name)] = { pressed: false, value: 0 }),
    pull: (name: "leftTrigger" | "rightTrigger", value: number) => (buttons[at(name)] = { pressed: value > 0.1, value })
  }
}

const makeKeyboard = () => {
  const listeners = new Map<string, Set<(event?: any) => void>>()
  const host: Keyboard.KeyboardHost = {
    addEventListener(type: string, listener: (event?: any) => void) {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener))
    },
    removeEventListener(type: string, listener: (event?: any) => void) {
      listeners.get(type)?.delete(listener)
    }
  }
  const dispatch = (type: "keydown" | "keyup", key: string) => {
    for (const listener of listeners.get(type) ?? []) listener({ key, repeat: false, defaultPrevented: false, preventDefault() {} })
  }
  return { host, down: (key: string) => dispatch("keydown", key), up: (key: string) => dispatch("keyup", key) }
}

const padBindings = {
  gas: Gamepad.analog(["rightTrigger", "south"]),
  brake: Gamepad.analog(["leftTrigger"]),
  boost: ["rightTrigger"],
  steer: Gamepad.vector({ stick: "left" })
} as const
const keyBindings = { gas: Keyboard.analog(["w", "ArrowUp"]), brake: Keyboard.analog(["s"]), boost: [" "], steer: Keyboard.vector({ up: ["i"], down: ["k"], left: ["a"], right: ["d"] }) } as const

describe("Gamepad.analog", () => {
  it("reads a trigger's pull, and 1 for any other held button", () => {
    const pad = makePad()
    const input = Gamepad.actions(pad.host, padBindings)
    expect(input.snapshot().analogs).toEqual({ gas: 0, brake: 0 })
    pad.pull("rightTrigger", 0.3)
    const half = input.snapshot()
    expect(half.analogs.gas).toBe(0.3)
    // The button action on the same trigger keeps its threshold.
    expect(half.actions.boost.held).toBe(false)
    pad.pull("rightTrigger", 0.7)
    expect(input.snapshot().analogs.gas).toBe(0.7)
    pad.down("south")
    expect(input.snapshot().analogs.gas).toBe(1)
    pad.up("south")
    pad.pull("rightTrigger", 0)
    pad.pull("leftTrigger", 0.25)
    expect(input.snapshot().analogs).toEqual({ gas: 0, brake: 0.25 })
  })

  it("reads 1 for a pressed trigger on a pad without the standard mapping, whose pull is unknown", () => {
    const pad = makePad("")
    const input = Gamepad.actions(pad.host, padBindings)
    pad.down("rightTrigger")
    expect(input.snapshot().analogs.gas).toBe(1)
  })

  it("rebinds an analog action to other buttons", () => {
    const pad = makePad()
    const input = Gamepad.actions(pad.host, padBindings)
    input.rebind({ ...padBindings, gas: Gamepad.analog(["leftTrigger"]) })
    pad.pull("leftTrigger", 0.5)
    pad.pull("rightTrigger", 0.9)
    expect(input.snapshot().analogs).toEqual({ gas: 0.5, brake: 0.5 })
  })

  it("plays a timeline's trigger pulls, and a trigger it only presses as 1", () => {
    const input = Gamepad.scripted(padBindings, [
      { frame: 0, rightTrigger: 0.4 },
      { frame: 1, rightTrigger: 0, press: ["rightTrigger"] },
      { frame: 2, release: ["rightTrigger"] }
    ])
    expect(input.snapshot().analogs.gas).toBe(0.4)
    expect(input.snapshot().analogs.gas).toBe(1)
    expect(input.snapshot().analogs.gas).toBe(0)
  })

  it("replays a recording with the same values", () => {
    const pad = makePad()
    const recorded = Gamepad.recording(Gamepad.actions(pad.host, padBindings))
    const live: Array<number> = []
    for (const pull of [0, 0.2, 0.6, 0.6, 0]) {
      pad.pull("rightTrigger", pull)
      live.push(recorded.snapshot().analogs.gas)
    }
    const replay = Gamepad.scripted(padBindings, recorded.timeline())
    expect(live.map(() => replay.snapshot().analogs.gas)).toEqual(live)
  })

  it("validates a saved analog rebinding", () => {
    const saved = Gamepad.parseRebinding(padBindings, JSON.parse(JSON.stringify({ ...padBindings, gas: Gamepad.analog(["east"]) })))
    expect(saved.ok && saved.value.gas).toEqual({ _tag: "Analog", buttons: ["east"] })
    expect(Gamepad.parseRebinding(padBindings, { ...padBindings, gas: ["east"] })).toEqual({
      ok: false,
      error: { _tag: "InvalidRebinding", path: "gas", message: "expected { buttons } for an analog action" }
    })
    expect(Gamepad.parseRebinding(padBindings, { ...padBindings, gas: { buttons: ["pedal"] } })).toMatchObject({ ok: false, error: { path: "gas.buttons[0]" } })
  })

  it("starts idle at 0", () => {
    expect(Gamepad.idle(padBindings).analogs).toEqual({ gas: 0, brake: 0 })
  })
})

describe("Keyboard.analog", () => {
  it("reads 1 while one of its keys is held", () => {
    const keys = makeKeyboard()
    const input = Keyboard.actions(keys.host, keyBindings)
    expect(input.snapshot().analogs).toEqual({ gas: 0, brake: 0 })
    keys.down("w")
    keys.down("ArrowUp")
    expect(input.snapshot().analogs.gas).toBe(1)
    keys.up("w")
    expect(input.snapshot().analogs.gas).toBe(1)
    keys.up("ArrowUp")
    const after = input.snapshot()
    expect(after.analogs.gas).toBe(0)
    expect(after.used).toBe(false)
  })

  it("plays and records a timeline that names the analog action", () => {
    const scripted = Keyboard.scripted(keyBindings, [{ frame: 0, press: ["gas"] }, { frame: 2, release: ["gas"] }])
    expect([0, 1, 2].map(() => scripted.snapshot().analogs.gas)).toEqual([1, 1, 0])
    const keys = makeKeyboard()
    const recorded = Keyboard.recording(Keyboard.actions(keys.host, keyBindings))
    recorded.snapshot()
    keys.down("s")
    recorded.snapshot()
    keys.up("s")
    recorded.snapshot()
    expect(recorded.timeline()).toEqual([{ frame: 1, press: ["brake"] }, { frame: 2, release: ["brake"] }])
    expect(Keyboard.parseTimeline(keyBindings, recorded.timeline()).ok).toBe(true)
  })

  it("rebinds and validates saved analog keys", () => {
    const keys = makeKeyboard()
    const input = Keyboard.actions(keys.host, keyBindings)
    const saved = Keyboard.parseRebinding(keyBindings, JSON.parse(JSON.stringify({ ...keyBindings, gas: Keyboard.analog([Keyboard.code("KeyG")]) })))
    expect(saved.ok && saved.value.gas).toEqual({ _tag: "Analog", keys: [{ code: "KeyG" }] })
    expect(Keyboard.parseRebinding(keyBindings, { ...keyBindings, gas: ["g"] })).toMatchObject({ ok: false, error: { path: "gas", message: "expected { keys } for an analog action" } })
    input.rebind({ ...keyBindings, gas: Keyboard.analog(["g"]) })
    keys.down("w")
    expect(input.snapshot().analogs.gas).toBe(0)
    keys.down("g")
    expect(input.snapshot().analogs.gas).toBe(1)
  })
})

const Driving = Controls.actions({ buttons: ["boost"], vectors: ["steer"], analogs: ["gas", "brake"] })

describe("Controls analogs", () => {
  it("merges an analog action as the highest value any device reports", () => {
    const controls = Driving.merge({
      keyboard: Keyboard.scripted(keyBindings, [{ frame: 1, press: ["gas"] }]),
      gamepad: Gamepad.scripted(padBindings, [{ frame: 0, rightTrigger: 0.5, leftTrigger: 0.2 }])
    })
    expect(controls.snapshot().analogs).toEqual({ gas: 0.5, brake: 0.2 })
    expect(controls.snapshot().analogs).toEqual({ gas: 1, brake: 0.2 })
  })

  it("reports an analog a device lacks as unavailable while that device is in use", () => {
    const controls = Driving.merge({
      keyboard: Driving.lacking(Keyboard.scripted({ boost: [" "], steer: Keyboard.vector({ up: ["i"], down: ["k"], left: ["a"], right: ["d"] }) }, [{ frame: 0, press: ["boost"] }]), ["gas", "brake"]),
      gamepad: Gamepad.scripted(padBindings, [])
    })
    const input = controls.snapshot()
    expect(input.analogs).toEqual({ gas: 0, brake: 0 })
    expect(input.available).toEqual({ boost: true, steer: true, gas: false, brake: false })
  })

  it("starts idle at 0 and draws analogs from 0 to 1", () => {
    const devices = { keyboard: Keyboard.idle(keyBindings) }
    expect(Driving.idle(devices).analogs).toEqual({ gas: 0, brake: 0 })
    expect(Driving.analogs).toEqual(["gas", "brake"])
    const random = Random.make(7)
    const values = Array.from({ length: 200 }, () => Driving.random(random, devices).analogs.gas)
    expect(values.every((value) => value >= 0 && value <= 1)).toBe(true)
    expect(values.some((value) => value === 0)).toBe(true)
    expect(values.some((value) => value === 1)).toBe(true)
    expect(values.some((value) => value > 0 && value < 1)).toBe(true)
  })

  it("passes a player's analogs through a pool, and joins on any analog pushed past half way", () => {
    const Players = Controls.players(Driving, { slots: ["p1", "p2"], join: "any" })
    const pool = Players.pool({
      pads: Gamepad.scriptedPads(padBindings, [
        [{ frame: 0, rightTrigger: 0.4 }, { frame: 1, rightTrigger: 0.8 }, { frame: 2, rightTrigger: 0.3 }],
        [{ frame: 0, leftTrigger: 0.2 }]
      ])
    })
    pool.setJoining(true)
    const first = pool.snapshot()
    expect(first.p1.joined).toBe(false)
    const joined = pool.snapshot()
    expect(joined.p1).toMatchObject({ joined: true, event: "joined", analogs: { gas: 0, brake: 0 } })
    expect(pool.snapshot().p1.analogs).toEqual({ gas: 0.3, brake: 0 })
    expect(pool.snapshot().p2.joined).toBe(false)
  })
})
