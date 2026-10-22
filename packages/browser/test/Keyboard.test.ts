import { describe, expect, it } from "vitest"

import { Keyboard } from "@typeonce/ritmo-browser"

const makeHost = () => {
  const listeners = new Map<string, Set<(event?: any) => void>>()
  const prevented: Array<string> = []
  const host: Keyboard.KeyboardHost = {
    addEventListener(type: string, listener: (event?: any) => void) {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener(type: string, listener: (event?: any) => void) {
      listeners.get(type)?.delete(listener)
    }
  }
  const dispatch = (type: "keydown" | "keyup", key: string, repeat = false, code?: string) => {
    for (const listener of listeners.get(type) ?? []) {
      listener({ key, repeat, ...(code === undefined ? {} : { code }), preventDefault: () => prevented.push(key) })
    }
  }
  return {
    host,
    prevented,
    down: (key: string, repeat = false) => dispatch("keydown", key, repeat),
    up: (key: string) => dispatch("keyup", key),
    /** A key event with its physical `code`, as browsers send it. */
    downCode: (key: string, code: string) => dispatch("keydown", key, false, code),
    upCode: (key: string, code: string) => dispatch("keyup", key, false, code),
    blur: () => {
      for (const listener of listeners.get("blur") ?? []) listener()
    },
    listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0)
  }
}

describe("Keyboard.actions", () => {
  it("reports held state and press edges per snapshot", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { jump: [" ", "w"], left: ["ArrowLeft", "a"] })

    fake.down("W")
    expect(input.snapshot().jump).toEqual({ held: true, pressed: true, released: false })
    expect(input.snapshot().jump).toEqual({ held: true, pressed: false, released: false })
    fake.up("w")
    expect(input.snapshot().jump).toEqual({ held: false, pressed: false, released: true })
    expect(input.snapshot().left).toEqual({ held: false, pressed: false, released: false })
  })

  it("keeps a tap that starts and ends between two snapshots", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { jump: [" "] })

    fake.down(" ")
    fake.up(" ")

    expect(input.snapshot().jump).toEqual({ held: false, pressed: true, released: true })
  })

  it("ignores auto-repeat and keeps an action held while any bound key is down", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { left: ["ArrowLeft", "a"] })

    fake.down("ArrowLeft")
    input.snapshot()
    fake.down("ArrowLeft", true)
    fake.down("a")
    fake.up("ArrowLeft")

    expect(input.snapshot().left).toEqual({ held: true, pressed: true, released: false })
  })

  it("prevents default only for bound keys unless disabled", () => {
    const fake = makeHost()
    Keyboard.actions(fake.host, { jump: [" "] })
    fake.down(" ")
    fake.down("q")
    expect(fake.prevented).toEqual([" "])

    const quiet = makeHost()
    Keyboard.actions(quiet.host, { jump: [" "] }, { preventDefault: false })
    quiet.down(" ")
    expect(quiet.prevented).toEqual([])
  })

  it("releases held actions on blur and removes listeners on dispose", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { jump: [" "] })

    fake.down(" ")
    input.snapshot()
    fake.blur()
    expect(input.snapshot().jump).toEqual({ held: false, pressed: false, released: true })

    input.dispose()
    expect(fake.listenerCount()).toBe(0)
  })
})

describe("Keyboard timelines", () => {
  const bindings = { jump: [" "], left: ["a"] } as const

  it("plays presses and releases per snapshot, including sub-frame taps", () => {
    const input = Keyboard.scripted(bindings, [
      { frame: 0, press: ["left"] },
      { frame: 2, release: ["left"], press: ["jump"] },
      { frame: 2, release: ["jump"] }
    ])
    expect(input.snapshot().left).toEqual({ held: true, pressed: true, released: false })
    expect(input.snapshot().left).toEqual({ held: true, pressed: false, released: false })
    const third = input.snapshot()
    expect(third.left).toEqual({ held: false, pressed: false, released: true })
    expect(third.jump).toEqual({ held: false, pressed: true, released: true })
    expect(input.snapshot()).toEqual(Keyboard.idle(bindings))
    expect(input.frames()).toBe(4)
  })

  it("does not report a press of an action already held as a new press", () => {
    const input = Keyboard.scripted(bindings, [{ frame: 0, press: ["jump"] }, { frame: 1, press: ["jump"] }])
    expect(input.snapshot().jump).toEqual({ held: true, pressed: true, released: false })
    expect(input.snapshot().jump).toEqual({ held: true, pressed: false, released: false })
  })

  it("records a live session that replays to the same snapshots", () => {
    const fake = makeHost()
    const recorder = Keyboard.recording(Keyboard.actions(fake.host, bindings))
    const live: Array<Keyboard.Snapshot<typeof bindings>> = []
    fake.down("a")
    live.push(recorder.snapshot())
    live.push(recorder.snapshot())
    fake.down(" ")
    fake.up(" ")
    fake.up("a")
    live.push(recorder.snapshot())
    fake.down("a")
    live.push(recorder.snapshot())

    const parsed = Keyboard.parseTimeline(bindings, JSON.parse(JSON.stringify(recorder.timeline())))
    expect(parsed._tag).toBe("Success")
    if (parsed._tag === "Failure") return
    const replay = Keyboard.scripted(bindings, parsed.success)
    expect(live.map(() => replay.snapshot())).toEqual(live)
  })

  it("rejects malformed timelines with the offending path", () => {
    expect(Keyboard.parseTimeline(bindings, {})).toMatchObject({ _tag: "Failure", failure: { path: "" } })
    expect(Keyboard.parseTimeline(bindings, [{ frame: -1 }])).toMatchObject({ _tag: "Failure", failure: { path: "[0].frame" } })
    expect(Keyboard.parseTimeline(bindings, [{ frame: 0, press: ["fly"] }])).toMatchObject({
      _tag: "Failure",
      failure: { path: "[0].press[0]" }
    })
  })
})

describe("Keyboard physical keys", () => {
  it("matches a physical binding whatever character the key types", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { up: [Keyboard.code("KeyW")] })
    // On AZERTY the key in W's position types "z".
    fake.downCode("z", "KeyW")
    expect(input.snapshot().up).toEqual({ held: true, pressed: true, released: false })
    fake.upCode("z", "KeyW")
    expect(input.snapshot().up).toEqual({ held: false, pressed: false, released: true })
  })

  it("is not fooled by modifiers that change the character", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { up: [Keyboard.code("KeyW")], one: [Keyboard.code("Digit1")] })
    fake.downCode("∑", "KeyW") // Option+W on macOS
    fake.downCode("!", "Digit1") // Shift+1
    const snapshot = input.snapshot()
    expect(snapshot.up.held).toBe(true)
    expect(snapshot.one.held).toBe(true)
  })

  it("releases a character binding even when a modifier changed its character meanwhile", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { up: ["w"] })
    fake.downCode("w", "KeyW")
    input.snapshot()
    // Option pressed while W is down: W's release arrives as "∑".
    fake.upCode("∑", "KeyW")
    expect(input.snapshot().up).toEqual({ held: false, pressed: false, released: true })
  })

  it("mixes character and physical bindings on one action, and prevents defaults for both", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { jump: [" ", Keyboard.code("KeyK")] })
    fake.downCode("k", "KeyK")
    expect(input.snapshot().jump.pressed).toBe(true)
    fake.upCode("k", "KeyK")
    fake.downCode(" ", "Space")
    expect(input.snapshot().jump.held).toBe(true)
    expect(fake.prevented).toEqual(["k", " "])
  })
})

describe("Keyboard.rebind", () => {
  it("binds the same actions to new keys from the next snapshot", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { jump: [" "], dash: ["Shift"] })

    input.rebind({ jump: [Keyboard.code("KeyJ")], dash: [" "] })
    fake.downCode("j", "KeyJ")
    fake.down(" ")
    const snapshot = input.snapshot()
    expect(snapshot.jump).toEqual({ held: true, pressed: true, released: false })
    expect(snapshot.dash).toEqual({ held: true, pressed: true, released: false })
  })

  it("releases an action held only through keys it lost, and still sees the old key go up", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { jump: [" "], crouch: ["c"] })

    fake.down(" ")
    input.snapshot()
    input.rebind({ jump: ["w"], crouch: [" "] })
    const snapshot = input.snapshot()
    expect(snapshot.jump).toEqual({ held: false, pressed: false, released: true })
    expect(snapshot.crouch).toEqual({ held: true, pressed: false, released: false })
    fake.up(" ")
    expect(input.snapshot().crouch).toEqual({ held: false, pressed: false, released: true })
  })

  it("keeps a recording's timeline by action, so a rebind does not change a replay", () => {
    const fake = makeHost()
    const bindings = { jump: [" "] } as const
    const recorder = Keyboard.recording(Keyboard.actions(fake.host, bindings))

    recorder.rebind({ jump: ["w"] })
    fake.down("w")
    recorder.snapshot()
    const replay = Keyboard.scripted(bindings, recorder.timeline())
    replay.rebind({ jump: ["x"] })
    expect(replay.snapshot().jump.pressed).toBe(true)
  })
})
