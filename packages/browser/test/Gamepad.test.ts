import { describe, expect, it } from "vitest"

import { Gamepad } from "@typeonce/ritmo-browser"

const released = { held: false, pressed: false, released: true }
const idle = { held: false, pressed: false, released: false }

/** A pad whose buttons and axes the test sets, read by index as the standard mapping. */
const makePad = (index = 0, id = `pad ${index}`) => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
  const axes = [0, 0, 0, 0]
  const pad = { id, index, connected: true, mapping: "standard", buttons, axes }
  const at = (name: Gamepad.Button) => Gamepad.buttonNames.indexOf(name)
  return {
    pad,
    down: (name: Gamepad.Button) => (buttons[at(name)] = { pressed: true, value: 1 }),
    up: (name: Gamepad.Button) => (buttons[at(name)] = { pressed: false, value: 0 }),
    pull: (name: "leftTrigger" | "rightTrigger", value: number) => (buttons[at(name)] = { pressed: value > 0.1, value }),
    tilt: (stick: "left" | "right", x: number, y: number) => {
      const first = stick === "left" ? 0 : 2
      axes[first] = x
      axes[first + 1] = y
    }
  }
}

const makeHost = (...pads: Array<ReturnType<typeof makePad>>) => {
  const connected: Array<Gamepad.PadReading | null> = pads.map(({ pad }) => pad)
  const host: Gamepad.GamepadHost = { getGamepads: () => connected }
  return { host, connected }
}

const bindings = { attack: ["west"], dash: ["south", "rightBumper"], ultimate: ["rightTrigger"] } as const

describe("Gamepad.actions", () => {
  it("reports held state and press edges per snapshot", () => {
    const pad = makePad()
    const input = Gamepad.actions(makeHost(pad).host, bindings)

    pad.down("west")
    expect(input.snapshot().actions.attack).toEqual({ held: true, pressed: true, released: false })
    expect(input.snapshot().actions.attack).toEqual({ held: true, pressed: false, released: false })
    pad.up("west")
    expect(input.snapshot().actions.attack).toEqual(released)
    expect(input.snapshot().actions.dash).toEqual(idle)
  })

  it("holds an action while any of its buttons is down", () => {
    const pad = makePad()
    const input = Gamepad.actions(makeHost(pad).host, bindings)

    pad.down("south")
    pad.down("rightBumper")
    input.snapshot()
    pad.up("south")
    expect(input.snapshot().actions.dash).toEqual({ held: true, pressed: false, released: false })
    pad.up("rightBumper")
    expect(input.snapshot().actions.dash).toEqual(released)
  })

  it("keeps a tap that starts and ends between two snapshots when polled", () => {
    const pad = makePad()
    const input = Gamepad.actions(makeHost(pad).host, bindings)

    pad.down("west")
    input.poll()
    pad.up("west")

    expect(input.snapshot().actions.attack).toEqual({ held: false, pressed: true, released: true })
  })

  it("reports every button by name, whatever the bindings", () => {
    const pad = makePad()
    const input = Gamepad.actions(makeHost(pad).host, bindings)

    pad.down("dpadDown")
    const snapshot = input.snapshot()
    expect(snapshot.buttons.dpadDown).toEqual({ held: true, pressed: true, released: false })
    expect(snapshot.buttons.start).toEqual(idle)
  })

  it("removes the stick dead zone and rescales the rest", () => {
    const pad = makePad()
    const input = Gamepad.actions(makeHost(pad).host, bindings, { deadZone: 0.2 })

    pad.tilt("left", 0.1, -0.1)
    expect(input.snapshot().left).toEqual({ x: 0, y: 0 })
    pad.tilt("left", 0, 0.6)
    expect(input.snapshot().left.y).toBeCloseTo(0.5)
    pad.tilt("right", 1, 1)
    const right = input.snapshot().right
    expect(Math.hypot(right.x, right.y)).toBeCloseTo(1)
  })

  it("holds a trigger past the threshold and reports how far it is pulled", () => {
    const pad = makePad()
    const input = Gamepad.actions(makeHost(pad).host, bindings, { triggerThreshold: 0.6 })

    pad.pull("rightTrigger", 0.4)
    let snapshot = input.snapshot()
    expect(snapshot.actions.ultimate.held).toBe(false)
    expect(snapshot.rightTrigger).toBeCloseTo(0.4)
    pad.pull("rightTrigger", 0.8)
    snapshot = input.snapshot()
    expect(snapshot.actions.ultimate).toEqual({ held: true, pressed: true, released: false })
  })

  it("reports no pad until one connects, and releases everything when it disconnects", () => {
    const pad = makePad()
    const { host, connected } = makeHost()
    const input = Gamepad.actions(host, bindings)

    expect(input.snapshot()).toEqual(Gamepad.idle(bindings))
    connected.push(pad.pad)
    pad.down("west")
    expect(input.snapshot()).toMatchObject({ connected: true, id: "pad 0", actions: { attack: { held: true, pressed: true } } })
    connected.length = 0
    expect(input.snapshot()).toMatchObject({ connected: false, id: null, actions: { attack: released } })
  })

  it("follows the pad used last", () => {
    const first = makePad(0)
    const second = makePad(1)
    const input = Gamepad.actions(makeHost(first, second).host, bindings)

    first.down("west")
    expect(input.snapshot().id).toBe("pad 0")
    first.up("west")
    second.tilt("left", 1, 0)
    const snapshot = input.snapshot()
    expect(snapshot.id).toBe("pad 1")
    expect(snapshot.left.x).toBeCloseTo(1)
    // While the followed pad is in use, another one does not take over.
    first.down("south")
    expect(input.snapshot().id).toBe("pad 1")
  })

  it("does not take resting trigger axes for use", () => {
    const first = makePad(0)
    const second = makePad(1)
    second.pad.axes.push(-1, -1)
    const input = Gamepad.actions(makeHost(first, second).host, bindings)

    first.down("west")
    input.snapshot()
    first.up("west")
    expect(input.snapshot().id).toBe("pad 0")
  })

  it("treats a host that throws as having no pads", () => {
    const input = Gamepad.actions({ getGamepads: () => { throw new Error("blocked") } }, bindings)
    expect(input.snapshot().connected).toBe(false)
  })

  it("rebinds actions, releasing one held only through buttons it lost", () => {
    const pad = makePad()
    const input = Gamepad.actions(makeHost(pad).host, bindings)

    pad.down("west")
    input.snapshot()
    input.rebind({ attack: ["north"], dash: ["west"], ultimate: ["rightTrigger"] })
    const snapshot = input.snapshot()
    expect(snapshot.actions.attack).toEqual(released)
    expect(snapshot.actions.dash).toEqual({ held: true, pressed: false, released: false })
    pad.down("north")
    expect(input.snapshot().actions.attack).toEqual({ held: true, pressed: true, released: false })
  })

  it("stops reading after dispose", () => {
    const pad = makePad()
    const input = Gamepad.actions(makeHost(pad).host, bindings)

    pad.down("west")
    input.snapshot()
    input.dispose()
    expect(input.snapshot().actions.attack).toEqual(released)
    expect(input.snapshot().connected).toBe(false)
  })
})

describe("Gamepad.scripted", () => {
  it("plays presses, releases, and sticks by frame", () => {
    const input = Gamepad.scripted(bindings, [
      { frame: 1, press: ["west"], left: { x: 1, y: 0 } },
      { frame: 2, release: ["west"] },
      { frame: 3, press: ["south"], release: ["south"] }
    ])

    expect(input.snapshot().connected).toBe(false)
    let snapshot = input.snapshot()
    expect(snapshot).toMatchObject({ connected: true, left: { x: 1, y: 0 }, actions: { attack: { held: true, pressed: true } } })
    snapshot = input.snapshot()
    expect(snapshot.actions.attack).toEqual(released)
    expect(snapshot.left).toEqual({ x: 1, y: 0 })
    expect(input.snapshot().actions.dash).toEqual({ held: false, pressed: true, released: true })
    expect(input.frames()).toBe(4)
  })

  it("follows the bindings, so a rebind changes what a replay does", () => {
    const input = Gamepad.scripted(bindings, [{ frame: 0, press: ["north"] }])
    input.rebind({ attack: ["north"], dash: ["south"], ultimate: ["rightTrigger"] })
    expect(input.snapshot().actions.attack.pressed).toBe(true)
  })
})

describe("Gamepad.recording", () => {
  it("records a timeline that replays the same snapshots", () => {
    const pad = makePad()
    const live = Gamepad.recording(Gamepad.actions(makeHost(pad).host, bindings))
    const seen: Array<Gamepad.Snapshot<typeof bindings>> = []

    seen.push(live.snapshot())
    pad.down("west")
    pad.tilt("left", 0, 1)
    seen.push(live.snapshot())
    pad.up("west")
    pad.pull("rightTrigger", 1)
    seen.push(live.snapshot())

    const parsed = Gamepad.parseTimeline(JSON.parse(JSON.stringify(live.timeline())))
    expect(parsed._tag).toBe("Success")
    if (parsed._tag === "Failure") return
    const replay = Gamepad.scripted(bindings, parsed.success)
    for (const snapshot of seen) {
      const { id: _, ...rest } = replay.snapshot()
      const { id: __, ...expected } = snapshot
      expect(rest).toEqual(expected)
    }
  })
})

describe("Gamepad.parseTimeline", () => {
  it("names the offending value", () => {
    expect(Gamepad.parseTimeline([{ frame: 0, press: ["jump"] }])).toMatchObject({ _tag: "Failure", failure: { path: "[0].press[0]" } })
    expect(Gamepad.parseTimeline([{ frame: -1 }])).toMatchObject({ _tag: "Failure", failure: { path: "[0].frame" } })
    expect(Gamepad.parseTimeline([{ frame: 0, left: { x: 2, y: 0 } }])).toMatchObject({ _tag: "Failure", failure: { path: "[0].left" } })
    expect(Gamepad.parseTimeline([{ frame: 0, rightTrigger: 2 }])).toMatchObject({ _tag: "Failure", failure: { path: "[0].rightTrigger" } })
    expect(Gamepad.parseTimeline({})).toMatchObject({ _tag: "Failure", failure: { path: "" } })
  })
})

describe("Gamepad.isButton", () => {
  it("accepts standard mapping names only", () => {
    expect(Gamepad.isButton("south")).toBe(true)
    expect(Gamepad.isButton("A")).toBe(false)
  })
})
