import { describe, expect, it } from "vitest"

import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import { Controls, Gamepad, InputCapture, Keyboard, Pointer, Touch } from "@typeonce/ritmo-browser"
import * as Random from "@typeonce/ritmo/Random"

const idle = { held: false, pressed: false, released: false }
const keyBindings = { jump: [" "], pause: ["Escape"] } as const
const padBindings = { jump: ["south"], pause: ["start"] } as const
const Actions = Controls.actions({ buttons: ["jump", "pause"] })

const merged = (keys: Keyboard.Timeline<typeof keyBindings>, pad: Gamepad.Timeline) =>
  Actions.merge({ keyboard: Keyboard.scripted(keyBindings, keys), gamepad: Gamepad.scripted(padBindings, pad) })

describe("Controls", () => {
  it("merges an action like one device with every binding", () => {
    const controls = merged(
      [{ frame: 0, press: ["jump"] }, { frame: 2, release: ["jump"] }, { frame: 4, press: ["jump"], release: ["jump"] }],
      [{ frame: 1, press: ["south"] }, { frame: 3, release: ["south"] }]
    )
    const jump = () => controls.snapshot().actions.jump
    expect(jump()).toEqual({ held: true, pressed: true, released: false }) // Space down
    expect(jump()).toEqual({ held: true, pressed: true, released: false }) // South down while Space is held: a second press
    expect(jump()).toEqual({ held: true, pressed: false, released: false }) // Space up, South still holds it
    expect(jump()).toEqual({ held: false, pressed: false, released: true }) // South up: nothing holds it
    expect(jump()).toEqual({ held: false, pressed: true, released: true }) // a tap inside one window
    expect(jump()).toEqual(idle)
  })

  it("hands an action from one device to another without a release", () => {
    const controls = merged([{ frame: 0, press: ["jump"] }, { frame: 1, release: ["jump"] }], [{ frame: 1, press: ["south"] }])
    controls.snapshot()
    expect(controls.snapshot().actions.jump).toEqual({ held: true, pressed: true, released: false })
  })

  it("keeps an action held through another device's disconnect", () => {
    const controls = merged([{ frame: 0, press: ["jump"] }], [{ frame: 0, press: ["south"] }, { frame: 1, connected: false }])
    controls.snapshot()
    expect(controls.snapshot().actions.jump).toEqual({ held: true, pressed: false, released: false })
  })

  it("keeps each device's own snapshot under its merge name", () => {
    const controls = merged([], [{ frame: 0, left: { x: 1, y: 0 }, press: ["east"] }])
    const input = controls.snapshot()
    expect(input.devices.gamepad.left).toEqual({ x: 1, y: 0 })
    expect(input.devices.gamepad.buttons.east.pressed).toBe(true)
    expect(input.devices.keyboard.actions.jump).toEqual(idle)
  })

  it("follows the device used last, staying on the current one while it is still in use", () => {
    const controls = merged(
      [{ frame: 1, press: ["jump"] }, { frame: 3, release: ["jump"] }],
      [{ frame: 2, left: { x: 0.5, y: 0 } }, { frame: 5, left: { x: 0, y: 0 } }]
    )
    const lastUsed = () => controls.snapshot().lastUsed
    expect(lastUsed()).toBe(null)
    expect(lastUsed()).toBe("keyboard")
    expect(lastUsed()).toBe("keyboard") // both in use: stays on the current one
    expect(lastUsed()).toBe("gamepad") // keys released (a release is not use), the stick still tilted
    expect(lastUsed()).toBe("gamepad")
    expect(lastUsed()).toBe("gamepad") // nothing in use: unchanged
  })

  it("reports which actions the last used device has", () => {
    const controls = Actions.merge({
      keyboard: Keyboard.scripted(keyBindings, [{ frame: 2, press: ["pause"] }]),
      touch: Actions.lacking(Touch.scripted({ buttons: ["jump"], sticks: [] }, [{ frame: 1, press: ["jump"], release: ["jump"] }]), ["pause"])
    })
    expect(controls.snapshot().available).toEqual({ jump: true, pause: true })
    expect(controls.snapshot().available).toEqual({ jump: true, pause: false })
    const input = controls.snapshot()
    expect(input.lastUsed).toBe("keyboard")
    expect(input.available).toEqual({ jump: true, pause: true })
    expect(input.actions.pause.pressed).toBe(true)
  })

  it("forwards rebind to each device and disposes every device", () => {
    const rebinds: Array<unknown> = []
    const disposed: Array<string> = []
    const keyboard = { ...Keyboard.scripted(keyBindings, []), rebind: (next: unknown) => rebinds.push(next), dispose: () => disposed.push("keyboard") }
    const touch = { ...Touch.scripted({ buttons: ["jump"], sticks: [] }, []), dispose: () => disposed.push("touch") }
    const controls = Actions.merge({ keyboard, touch: Actions.lacking(touch, ["pause"]) })
    controls.rebind.keyboard({ jump: ["j"], pause: ["p"] })
    expect(rebinds).toEqual([{ jump: ["j"], pause: ["p"] }])
    expect(Object.keys(controls.rebind)).toEqual(["keyboard"])
    controls.dispose()
    expect(disposed).toEqual(["keyboard", "touch"])
  })

  it("starts from an idle snapshot with every action available", () => {
    expect(Actions.idle({ keyboard: Keyboard.idle(keyBindings) })).toEqual({
      actions: { jump: idle, pause: idle },
      vectors: {},
      available: { jump: true, pause: true },
      devices: { keyboard: { actions: { jump: idle, pause: idle }, vectors: {}, used: false } },
      lastUsed: null
    })
  })

  it("lists every gap and every second capture in describe()", () => {
    const makeControls = (devices: { readonly keyboard: Keyboard.Actions<typeof keyBindings>; readonly touch: Touch.Actions<"jump"> }) =>
      Actions.merge({ keyboard: devices.keyboard, touch: Actions.lacking(devices.touch, ["pause"]) })
    const ControlsInput = Descriptor.Service<ReturnType<typeof makeControls>>()("ControlsTest/Controls")
    const Input = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof ControlsInput>>()("ControlsTest/Input")
    const Game = Schema.bind(Schema.fragment({ resources: { Input } }))
    const Capture = InputCapture.system(Game, { name: "ControlsTest/Capture", source: ControlsInput, resource: Input })
    const CaptureAgain = InputCapture.system(Game, { name: "ControlsTest/CaptureAgain", source: ControlsInput, resource: Input })
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(ControlsInput, makeControls({
        keyboard: Keyboard.scripted(keyBindings, []),
        touch: Touch.scripted({ buttons: ["jump"], sticks: [] }, [])
      }))),
      resources: { Input: Actions.idle({ keyboard: Keyboard.idle(keyBindings), touch: Touch.idle({ buttons: ["jump"], sticks: [] }) }) },
      debug: { hostClock: HostClock.test() }
    }).value
    runtime.debug.nameSchedules({ fixed: Game.Schedule(Capture), render: Game.Schedule(CaptureAgain) })
    const lints = runtime.debug.describe().lints.filter((lint) => lint.code === "service-lint" || lint.code === "service-consumed-twice")
    expect(lints).toEqual([
      {
        severity: "warning",
        code: "service-consumed-twice",
        subject: "ControlsTest/Controls",
        message: "ControlsTest/Controls is consumed by ControlsTest/Capture (fixed#0) and ControlsTest/CaptureAgain (render#0): each run takes what arrived since the previous one, so each sees only what the others left (an input press reaches one of them)",
        fix: "consume ControlsTest/Controls in one system placed once (InputCapture.system for an input source), write what it takes to a resource, and read the resource everywhere else"
      },
      {
        severity: "info",
        code: "service-lint",
        subject: "ControlsTest/Controls",
        message: "touch lacks pause, so while touch is the last used device the player cannot pause",
        fix: "fine if the game offers pause another way while touch is in use (read available.pause from the input); otherwise bind pause on touch"
      }
    ])
  })

  it("reads use from each device: presses and holds, sticks and swipes, never a release", () => {
    const keys = Keyboard.scripted(keyBindings, [{ frame: 0, press: ["jump"] }, { frame: 2, release: ["jump"] }])
    expect([keys.snapshot().used, keys.snapshot().used, keys.snapshot().used]).toEqual([true, true, false])

    const pad = Gamepad.scripted(padBindings, [{ frame: 0, left: { x: 0.5, y: 0 } }, { frame: 1, press: ["east"] }, { frame: 2, connected: false }])
    expect([pad.snapshot().used, pad.snapshot().used, pad.snapshot().used]).toEqual([true, true, false])

    const touch = Touch.scripted({ buttons: ["jump"], sticks: ["move"] }, [{ frame: 0, sticks: { move: { x: 1, y: 0 } } }, { frame: 1, sticks: { move: null }, swipe: { x: 4, y: 0 } }, { frame: 2, press: ["jump"], release: ["jump"] }])
    expect([touch.snapshot().used, touch.snapshot().used, touch.snapshot().used, touch.snapshot().used]).toEqual([true, true, true, false])
  })

  it("does not switch to a device that only released everything", () => {
    const controls = merged([{ frame: 1, press: ["jump"] }], [{ frame: 0, press: ["south"] }, { frame: 1, connected: false }])
    expect(controls.snapshot().lastUsed).toBe("gamepad")
    expect(controls.snapshot().lastUsed).toBe("keyboard")
  })
})

describe("Controls groups", () => {
  const Desktop = Controls.actions({ buttons: ["moveRight", "fire", "pause"] })
  const moveKeys = { moveRight: ["d"], fire: [" "], pause: ["Escape"] } as const
  const mouseFire = { fire: ["primary"] } as const
  const padKeys = { moveRight: ["dpadRight"], fire: ["south"], pause: ["start"] } as const

  it("stays on the group while the player walks with the keyboard and aims with the mouse", () => {
    const controls = Desktop.merge({
      desktop: Desktop.group({
        keyboard: Keyboard.scripted(moveKeys, [{ frame: 0, press: ["moveRight"] }, { frame: 2, release: ["moveRight"] }, { frame: 3, press: ["moveRight"] }]),
        mouse: Pointer.scripted(mouseFire, [{ frame: 1, move: { x: 10, y: 0 } }, { frame: 2, move: { x: 20, y: 0 } }, { frame: 3, move: { x: 30, y: 0 } }])
      }),
      gamepad: Gamepad.scripted(padKeys, [])
    })
    const frames = [0, 1, 2, 3].map(() => controls.snapshot())
    expect(frames.map((input) => input.lastUsed)).toEqual(["desktop", "desktop", "desktop", "desktop"])
    expect(frames.map((input) => input.available.pause)).toEqual([true, true, true, true])
    expect(frames[3]!.devices.mouse.position).toEqual({ x: 30, y: 0 })
    expect(frames[3]!.devices.keyboard.actions.moveRight.pressed).toBe(true)
  })

  it("merges actions across the group and the other devices", () => {
    const controls = Desktop.merge({
      desktop: Desktop.group({
        keyboard: Keyboard.scripted(moveKeys, []),
        mouse: Pointer.scripted(mouseFire, [{ frame: 0, press: ["primary"] }, { frame: 1, release: ["primary"] }])
      }),
      // South goes down as the click ends: fire stays held, a second press.
      gamepad: Gamepad.scripted(padKeys, [{ frame: 1, press: ["south"] }])
    })
    expect(controls.snapshot().actions.fire).toEqual({ held: true, pressed: true, released: false })
    const second = controls.snapshot()
    expect(second.actions.fire).toEqual({ held: true, pressed: true, released: false })
    expect(second.lastUsed).toBe("gamepad")
  })

  it("reports what a lacking group has, and lints it under the group name", () => {
    const keysOnly = { moveRight: ["d"], fire: [" "] } as const
    const controls = Desktop.merge({
      desktop: Desktop.lacking(Desktop.group({ keyboard: Keyboard.scripted(keysOnly, [{ frame: 0, press: ["fire"] }]), mouse: Pointer.scripted(mouseFire, []) }), ["pause"]),
      gamepad: Gamepad.scripted(padKeys, [])
    })
    expect(controls.snapshot().available).toEqual({ moveRight: true, fire: true, pause: false })
    const Lints = Descriptor.Service<typeof controls>()("ControlsGroups/Controls")
    const Game = Schema.bind(Schema.fragment({}))
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(Lints, controls)),
      resources: {},
      debug: { hostClock: HostClock.test() }
    })
    if (!runtime.ok) throw new Error("runtime")
    expect(runtime.value.debug.describe().lints.filter((lint) => lint.code === "service-lint").map((lint) => lint.message)).toEqual([
      "desktop lacks pause, so while desktop is the last used device the player cannot pause"
    ])
  })

  it("forwards rebind to grouped devices by their own names and disposes them", () => {
    const disposed: Array<string> = []
    const keyboard = Keyboard.scripted(moveKeys, [])
    const mouse = Pointer.scripted(mouseFire, [{ frame: 0, press: ["middle"] }])
    const controls = Desktop.merge({
      desktop: Desktop.group({ keyboard: { ...keyboard, dispose: () => disposed.push("keyboard") }, mouse: { ...mouse, dispose: () => disposed.push("mouse") } }),
      gamepad: { ...Gamepad.scripted(padKeys, []), dispose: () => disposed.push("gamepad") }
    })
    controls.rebind.mouse({ fire: ["middle"] })
    expect(controls.snapshot().actions.fire.pressed).toBe(true)
    controls.dispose()
    expect(disposed).toEqual(["keyboard", "mouse", "gamepad"])
  })
})

describe("Controls vector actions", () => {
  const Moving = Controls.actions({ buttons: ["jump"], vectors: ["move"] })
  const keys = { move: Keyboard.vector({ up: ["w"], down: ["s"], left: ["a"], right: ["d"] }), jump: [" "] } as const
  const pad = { move: Gamepad.vector({ stick: "left" }), jump: ["south"] } as const

  it("takes the longest vector any device reports, so devices never add up or cancel", () => {
    const controls = Moving.merge({
      keyboard: Keyboard.scripted(keys, [{ frame: 0, press: ["move.right"] }, { frame: 1, release: ["move.right"] }]),
      gamepad: Gamepad.scripted(pad, [{ frame: 0, left: { x: -0.3, y: 0 } }])
    })
    expect(controls.snapshot().vectors.move).toEqual({ x: 1, y: 0 })
    const second = controls.snapshot()
    expect(second.vectors.move).toEqual({ x: -0.3, y: 0 })
    expect(second.devices.keyboard.vectors.move).toEqual({ x: 0, y: 0 })
    expect(second.lastUsed).toBe("gamepad")
  })

  it("reports a lacking vector as unavailable, and starts idle at rest", () => {
    const controls = Moving.merge({
      keyboard: Keyboard.scripted(keys, []),
      touch: Moving.lacking(Touch.scripted({ buttons: ["jump"], sticks: [] }, [{ frame: 0, press: ["jump"] }]), ["move"])
    })
    expect(controls.snapshot().available).toEqual({ jump: true, move: false })
    expect(Moving.idle({ keyboard: Keyboard.idle(keys) })).toMatchObject({ vectors: { move: { x: 0, y: 0 } }, available: { jump: true, move: true } })
    expect(Moving.vectors).toEqual(["move"])
    expect(Moving.buttons).toEqual(["jump"])
  })

  it("merges the touch stick named like the vector, as a plain vector", () => {
    const controls = Moving.merge({
      keyboard: Keyboard.scripted(keys, []),
      touch: Touch.scripted({ buttons: ["jump"], sticks: ["move"] }, [{ frame: 0, sticks: { move: { x: 0, y: 0.6 } } }])
    })
    const snapshot = controls.snapshot()
    expect(snapshot.vectors.move).toEqual({ x: 0, y: 0.6 })
    expect(snapshot.devices.touch.vectors.move).toEqual({ x: 0, y: 0.6, active: true })
  })

  it("merges a twin-stick touch device, with the aim stick lacking on the keyboard", () => {
    const Twin = Controls.actions({ buttons: ["jump"], vectors: ["move", "aim"] })
    const controls = Twin.merge({
      keyboard: Twin.lacking(Keyboard.scripted(keys, []), ["aim"]),
      touch: Touch.scripted({ buttons: ["jump"], sticks: ["move", "aim"] }, [{ frame: 0, sticks: { move: { x: 0.6, y: 0 }, aim: { x: 0, y: -1 } } }])
    })
    const snapshot = controls.snapshot()
    expect(snapshot.vectors).toEqual({ move: { x: 0.6, y: 0 }, aim: { x: 0, y: -1 } })
    expect(snapshot.available).toEqual({ jump: true, move: true, aim: true })
    expect(snapshot.lastUsed).toBe("touch")
  })

  it("draws a fuzzed snapshot with the states a merge reports, keeping device data idle", () => {
    const Moving = Controls.actions({ buttons: ["jump"], vectors: ["move"] })
    const moveKeys = { move: Keyboard.vector({ up: ["w"], down: ["s"], left: ["a"], right: ["d"] }), jump: [" "] } as const
    const devices = { keyboard: Keyboard.idle(moveKeys) }
    const random = Random.make(1)
    const draws = Array.from({ length: 300 }, () => Moving.random(random, devices))
    const states = new Set(draws.map(({ actions }) => JSON.stringify(actions.jump)))
    expect([...states].sort()).toEqual([
      { held: false, pressed: false, released: false },
      { held: true, pressed: false, released: false },
      { held: true, pressed: true, released: false },
      { held: false, pressed: true, released: true },
      { held: false, pressed: false, released: true }
    ].map((state) => JSON.stringify(state)).sort())
    for (const draw of draws) {
      expect(Math.hypot(draw.vectors.move.x, draw.vectors.move.y)).toBeLessThanOrEqual(1 + 1e-9)
      expect(draw.devices).toBe(devices)
      expect(draw.available).toEqual({ jump: true, move: true })
      expect(draw.lastUsed).toBe(null)
    }
    // Zero, full directions, and shorter tilts all come up.
    const lengths = draws.map(({ vectors }) => Math.hypot(vectors.move.x, vectors.move.y))
    expect(lengths.some((length) => length === 0)).toBe(true)
    expect(lengths.some((length) => Math.abs(length - 1) < 1e-9)).toBe(true)
    expect(lengths.some((length) => length > 0 && length < 0.99)).toBe(true)
    // The same seed draws the same input.
    const again = Random.make(1)
    expect(Array.from({ length: 300 }, () => Moving.random(again, devices))).toEqual(draws)
  })
})
