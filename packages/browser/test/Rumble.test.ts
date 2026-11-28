import { describe, expect, it } from "vitest"

import { Controls, Gamepad, Keyboard } from "@typeonce/ritmo-browser"

type Played = { readonly type: string; readonly params: unknown }

/** A standard pad with dual-rumble motors that record what they play, or none. */
const makePad = (index: number, id: string, motors: "dual-rumble" | "haptic" | "listed-without-rumble" | "none" | "throws" | "rejects" = "dual-rumble") => {
  const played: Array<Played> = []
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
  const vibrationActuator: Gamepad.VibrationActuator | null =
    motors === "dual-rumble" || motors === "rejects"
      ? {
        playEffect: (type, params) => {
          played.push({ type, params })
          return motors === "rejects" ? Promise.reject(new Error("preempted")) : Promise.resolve("complete")
        }
      }
      : motors === "listed-without-rumble"
      ? { effects: ["trigger-rumble"], playEffect: () => Promise.resolve("complete") }
      : motors === "throws"
      ? { playEffect: () => { throw new Error("NotSupportedError") } }
      : null
  const hapticActuators: ReadonlyArray<Gamepad.HapticActuator> | null = motors === "haptic"
    ? [{ pulse: (value, duration) => {
      played.push({ type: "pulse", params: { value, duration } })
      return Promise.resolve(true)
    } }]
    : null
  const pad = { id, index, connected: true, mapping: "standard", buttons, axes: [0, 0, 0, 0], vibrationActuator, hapticActuators }
  return {
    pad,
    played,
    down: (name: Gamepad.Button) => (buttons[Gamepad.buttonNames.indexOf(name)] = { pressed: true, value: 1 }),
    up: (name: Gamepad.Button) => (buttons[Gamepad.buttonNames.indexOf(name)] = { pressed: false, value: 0 })
  }
}

const makeHost = (...pads: Array<ReturnType<typeof makePad>>) => {
  const connected: Array<Gamepad.PadReading | null> = pads.map(({ pad }) => pad)
  const host: Gamepad.GamepadHost = {
    navigator: { getGamepads: () => connected },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {}
  }
  return { host, connected }
}

const bindings = { join: ["south"], gas: Gamepad.analog(["rightTrigger"]) } as const
const shake = { duration: 200, strong: 1, weak: 0.5 }
const dualRumble = (duration: number, strong: number, weak: number): Played => ({
  type: "dual-rumble",
  params: { startDelay: 0, duration, strongMagnitude: strong, weakMagnitude: weak }
})

describe("Gamepad rumble", () => {
  it("rumbles the followed pad and reports the rumble it sent", () => {
    const pad = makePad(0, "pad")
    const input = Gamepad.actions(makeHost(pad).host, bindings)
    expect(input.rumble(shake)).toEqual({ ok: false, error: { _tag: "RumbleFailure", reason: "no-pad" } })
    input.snapshot()
    expect(input.rumble(shake)).toEqual({ ok: true, value: shake })
    expect(pad.played).toEqual([dualRumble(200, 1, 0.5)])
  })

  it("clamps the rumble at the boundary", () => {
    const pad = makePad(0, "pad")
    const input = Gamepad.actions(makeHost(pad).host, bindings)
    input.snapshot()
    expect(input.rumble({ duration: 9000, strong: 2, weak: Number.NaN })).toEqual({ ok: true, value: { duration: 5000, strong: 1, weak: 0 } })
    expect(input.rumble({ duration: -5, strong: -1, weak: 0.25 })).toEqual({ ok: true, value: { duration: 0, strong: 0, weak: 0.25 } })
    expect(pad.played).toEqual([dualRumble(5000, 1, 0), dualRumble(0, 0, 0.25)])
  })

  it("reports no-motor, without throwing, for a pad or browser that cannot rumble", () => {
    for (const motors of ["none", "listed-without-rumble", "throws"] as const) {
      const input = Gamepad.actions(makeHost(makePad(0, "pad", motors)).host, bindings)
      input.snapshot()
      expect(input.rumble(shake)).toEqual({ ok: false, error: { _tag: "RumbleFailure", reason: "no-motor" } })
    }
  })

  it("falls back to the older haptics API, at the stronger motor's strength", () => {
    const pad = makePad(0, "pad", "haptic")
    const input = Gamepad.actions(makeHost(pad).host, bindings)
    input.snapshot()
    expect(input.rumble({ duration: 100, strong: 0.3, weak: 0.8 }).ok).toBe(true)
    expect(pad.played).toEqual([{ type: "pulse", params: { value: 0.8, duration: 100 } }])
  })

  it("swallows a rejected rumble", async () => {
    const pad = makePad(0, "pad", "rejects")
    const input = Gamepad.actions(makeHost(pad).host, bindings)
    input.snapshot()
    expect(input.rumble(shake).ok).toBe(true)
    // An unhandled rejection would fail the test run.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it("fails with no-pad once the followed pad is unplugged", () => {
    const pad = makePad(0, "pad")
    const { host, connected } = makeHost(pad)
    const input = Gamepad.actions(host, bindings)
    input.snapshot()
    connected[0] = null
    expect(input.rumble(shake)).toMatchObject({ ok: false, error: { reason: "no-pad" } })
  })

  it("rumbles each place of pads on its own motors, two pads of the same model included", () => {
    const first = makePad(0, "Xbox Wireless Controller")
    const second = makePad(1, "Xbox Wireless Controller")
    const pads = Gamepad.pads(makeHost(first, second).host, bindings, 4)
    pads.snapshot()
    expect(pads.rumble(1, shake).ok).toBe(true)
    expect(first.played).toEqual([])
    expect(second.played).toEqual([dualRumble(200, 1, 0.5)])
    expect(pads.rumble(0, { duration: 50, strong: 0, weak: 1 }).ok).toBe(true)
    expect(first.played).toEqual([dualRumble(50, 0, 1)])
    expect(pads.rumble(2, shake)).toMatchObject({ ok: false, error: { reason: "no-pad" } })
  })

  it("records the rumbles a scripted pad played, and none while it is unplugged", () => {
    const pad = Gamepad.scripted(bindings, [{ frame: 1 }, { frame: 3, connected: false }])
    pad.snapshot()
    expect(pad.rumble(shake)).toMatchObject({ ok: false, error: { reason: "no-pad" } })
    pad.snapshot()
    expect(pad.rumble({ duration: 80, strong: 3, weak: 0 })).toEqual({ ok: true, value: { duration: 80, strong: 1, weak: 0 } })
    pad.snapshot()
    pad.snapshot()
    expect(pad.rumble(shake).ok).toBe(false)
    expect(pad.rumbles()).toEqual([{ frame: 2, rumble: { duration: 80, strong: 1, weak: 0 } }])

    const pads = Gamepad.scriptedPads(bindings, [[{ frame: 0 }], [{ frame: 0 }]])
    pads.snapshot()
    pads.rumble(1, shake)
    expect(pads.rumbles(0)).toEqual([])
    expect(pads.rumbles(1)).toEqual([{ frame: 1, rumble: shake }])
    expect(pads.rumble(5, shake).ok).toBe(false)
  })

  it("passes rumbles through a recording", () => {
    const pad = makePad(0, "pad")
    const recorded = Gamepad.recording(Gamepad.actions(makeHost(pad).host, bindings))
    recorded.snapshot()
    expect(recorded.rumble(shake).ok).toBe(true)
    expect(pad.played).toHaveLength(1)
  })
})

describe("Controls rumble", () => {
  const Actions = Controls.actions({ buttons: ["join"], analogs: ["gas"] })
  const keys = { join: [" "], gas: Keyboard.analog(["w"]) } as const

  it("lists each merged device's rumble by its name", () => {
    const controls = Actions.merge({ keyboard: Keyboard.scripted(keys, []), gamepad: Gamepad.scripted(bindings, [{ frame: 0 }]) })
    controls.snapshot()
    expect(Object.keys(controls.rumble)).toEqual(["gamepad"])
    expect(controls.rumble.gamepad(shake).ok).toBe(true)
  })

  it("rumbles the pad a player joined with, each pad of one model on its own", () => {
    const first = makePad(0, "Xbox Wireless Controller")
    const second = makePad(1, "Xbox Wireless Controller")
    const Racers = Controls.players(Actions, { slots: ["p1", "p2", "p3"], join: "join" })
    const pool = Racers.pool({
      keys: Keyboard.scripted(keys, [{ frame: 0, press: ["join"] }]),
      pads: Gamepad.pads(makeHost(first, second).host, bindings, 4)
    })
    pool.setJoining(true)
    // Keyboard joins first (p1), then the second pad (p2), then the first (p3).
    pool.snapshot()
    second.down("south")
    pool.snapshot()
    second.up("south")
    first.down("south")
    pool.snapshot()
    expect(pool.rumble("p2", shake).ok).toBe(true)
    expect(second.played).toHaveLength(1)
    expect(first.played).toHaveLength(0)
    expect(pool.rumble("p3", shake).ok).toBe(true)
    expect(first.played).toHaveLength(1)
    expect(pool.rumble("p1", shake)).toEqual({ ok: false, error: { _tag: "RumbleFailure", reason: "no-pad" } })
    pool.leave("p3")
    expect(pool.rumble("p3", shake)).toMatchObject({ ok: false, error: { reason: "no-pad" } })
  })

  it("rumbles a player on a followed pad, and reports scripted pads' rumbles", () => {
    const Racers = Controls.players(Actions, { slots: ["p1"], join: "join" })
    const pads = Gamepad.scriptedPads(bindings, [[{ frame: 0 }]])
    const pool = Racers.pool({ pads })
    expect(pool.seat("p1", { pads: 0 }).ok).toBe(true)
    pool.snapshot()
    expect(pool.rumble("p1", shake).ok).toBe(true)
    expect(pads.rumbles(0)).toEqual([{ frame: 1, rumble: shake }])

    const single = Controls.players(Actions, { slots: ["p1"], join: "join" }).pool({ pad: Gamepad.scripted(bindings, [{ frame: 0 }]) })
    single.seat("p1", "pad")
    single.snapshot()
    expect(single.rumble("p1", shake).ok).toBe(true)
  })
})
