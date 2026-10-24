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
  const dispatch = (type: "keydown" | "keyup", key: string, repeat = false, code?: string, target?: object) => {
    for (const listener of listeners.get(type) ?? []) {
      const event: Keyboard.KeyEvent = {
        key,
        repeat,
        ...(code === undefined ? {} : { code }),
        ...(target === undefined ? {} : { target }),
        preventDefault: () => prevented.push(key)
      }
      listener(event)
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
    /** A key event typed into `target`, such as a form field. */
    downIn: (target: object, key: string, code?: string) => dispatch("keydown", key, false, code, target),
    repeatIn: (target: object, key: string, code?: string) => dispatch("keydown", key, true, code, target),
    upIn: (target: object, key: string, code?: string) => dispatch("keyup", key, false, code, target),
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
    expect(input.snapshot().actions.jump).toEqual({ held: true, pressed: true, released: false })
    expect(input.snapshot().actions.jump).toEqual({ held: true, pressed: false, released: false })
    fake.up("w")
    expect(input.snapshot().actions.jump).toEqual({ held: false, pressed: false, released: true })
    expect(input.snapshot().actions.left).toEqual({ held: false, pressed: false, released: false })
  })

  it("keeps a tap that starts and ends between two snapshots", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { jump: [" "] })

    fake.down(" ")
    fake.up(" ")

    expect(input.snapshot().actions.jump).toEqual({ held: false, pressed: true, released: true })
  })

  it("ignores auto-repeat and keeps an action held while any bound key is down", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { left: ["ArrowLeft", "a"] })

    fake.down("ArrowLeft")
    input.snapshot()
    fake.down("ArrowLeft", true)
    fake.down("a")
    fake.up("ArrowLeft")

    expect(input.snapshot().actions.left).toEqual({ held: true, pressed: true, released: false })
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
    expect(input.snapshot().actions.jump).toEqual({ held: false, pressed: false, released: true })

    input.dispose()
    expect(fake.listenerCount()).toBe(0)
  })
})

describe("Keyboard form fields", () => {
  const input = { tagName: "INPUT", isContentEditable: false }
  const textarea = { tagName: "TEXTAREA", isContentEditable: false }
  const select = { tagName: "SELECT", isContentEditable: false }
  const editable = { tagName: "DIV", isContentEditable: true }
  const canvas = { tagName: "CANVAS", isContentEditable: false }

  it("leaves a bound key typed into a field to the field: no action, no preventDefault", () => {
    for (const field of [input, textarea, select, editable]) {
      const fake = makeHost()
      const keys = Keyboard.actions(fake.host, { up: ["w"], jump: [Keyboard.code("Space")] })
      fake.downIn(field, "w", "KeyW")
      fake.downIn(field, " ", "Space")
      fake.upIn(field, "w", "KeyW")
      fake.upIn(field, " ", "Space")
      const snapshot = keys.snapshot()
      expect(snapshot.actions.up).toEqual({ held: false, pressed: false, released: false })
      expect(snapshot.actions.jump).toEqual({ held: false, pressed: false, released: false })
      expect(snapshot.used).toBe(false)
      expect(fake.prevented).toEqual([])
    }
  })

  it("releases a key held before focus moved into a field on a keyup from the field", () => {
    const fake = makeHost()
    const keys = Keyboard.actions(fake.host, { up: ["w"], right: [Keyboard.code("KeyD")] })
    fake.downIn(canvas, "w", "KeyW")
    fake.downIn(canvas, "d", "KeyD")
    expect(keys.snapshot().actions.up.held).toBe(true)
    // Focus moves into a text field; auto-repeat arrives there, then the release.
    fake.repeatIn(input, "w", "KeyW")
    fake.upIn(input, "w", "KeyW")
    fake.upIn(editable, "d", "KeyD")
    const snapshot = keys.snapshot()
    expect(snapshot.actions.up).toEqual({ held: false, pressed: false, released: true })
    expect(snapshot.actions.right).toEqual({ held: false, pressed: false, released: true })
  })

  it("plays a key typed outside a field as before", () => {
    const fake = makeHost()
    const keys = Keyboard.actions(fake.host, { up: ["w"] })
    fake.downIn(canvas, "w", "KeyW")
    expect(keys.snapshot().actions.up).toEqual({ held: true, pressed: true, released: false })
    expect(fake.prevented).toEqual(["w"])
  })

  it("does not capture a key typed into a field on a settings screen", () => {
    const fake = makeHost()
    const presses = Keyboard.presses(fake.host)
    fake.downIn(input, "j", "KeyJ")
    fake.downIn(editable, "k", "KeyK")
    fake.downIn(canvas, "l", "KeyL")
    expect(presses.snapshot()).toEqual([{ key: "l", code: "KeyL" }])
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
    expect(input.snapshot().actions.left).toEqual({ held: true, pressed: true, released: false })
    expect(input.snapshot().actions.left).toEqual({ held: true, pressed: false, released: false })
    const third = input.snapshot()
    expect(third.actions.left).toEqual({ held: false, pressed: false, released: true })
    expect(third.actions.jump).toEqual({ held: false, pressed: true, released: true })
    expect(input.snapshot()).toEqual(Keyboard.idle(bindings))
    expect(input.frames()).toBe(4)
  })

  it("does not report a press of an action already held as a new press", () => {
    const input = Keyboard.scripted(bindings, [{ frame: 0, press: ["jump"] }, { frame: 1, press: ["jump"] }])
    expect(input.snapshot().actions.jump).toEqual({ held: true, pressed: true, released: false })
    expect(input.snapshot().actions.jump).toEqual({ held: true, pressed: false, released: false })
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
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const replay = Keyboard.scripted(bindings, parsed.value)
    expect(live.map(() => replay.snapshot())).toEqual(live)
  })

  it("rejects malformed timelines with the offending path", () => {
    expect(Keyboard.parseTimeline(bindings, {})).toMatchObject({ ok: false, error: { path: "" } })
    expect(Keyboard.parseTimeline(bindings, [{ frame: -1 }])).toMatchObject({ ok: false, error: { path: "[0].frame" } })
    expect(Keyboard.parseTimeline(bindings, [{ frame: 0, press: ["fly"] }])).toMatchObject({
      ok: false,
      error: { path: "[0].press[0]" }
    })
  })
})

describe("Keyboard physical keys", () => {
  it("matches a physical binding whatever character the key types", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { up: [Keyboard.code("KeyW")] })
    // On AZERTY the key in W's position types "z".
    fake.downCode("z", "KeyW")
    expect(input.snapshot().actions.up).toEqual({ held: true, pressed: true, released: false })
    fake.upCode("z", "KeyW")
    expect(input.snapshot().actions.up).toEqual({ held: false, pressed: false, released: true })
  })

  it("is not fooled by modifiers that change the character", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { up: [Keyboard.code("KeyW")], one: [Keyboard.code("Digit1")] })
    fake.downCode("∑", "KeyW") // Option+W on macOS
    fake.downCode("!", "Digit1") // Shift+1
    const snapshot = input.snapshot()
    expect(snapshot.actions.up.held).toBe(true)
    expect(snapshot.actions.one.held).toBe(true)
  })

  it("releases a character binding even when a modifier changed its character meanwhile", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { up: ["w"] })
    fake.downCode("w", "KeyW")
    input.snapshot()
    // Option pressed while W is down: W's release arrives as "∑".
    fake.upCode("∑", "KeyW")
    expect(input.snapshot().actions.up).toEqual({ held: false, pressed: false, released: true })
  })

  it("mixes character and physical bindings on one action, and prevents defaults for both", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { jump: [" ", Keyboard.code("KeyK")] })
    fake.downCode("k", "KeyK")
    expect(input.snapshot().actions.jump.pressed).toBe(true)
    fake.upCode("k", "KeyK")
    fake.downCode(" ", "Space")
    expect(input.snapshot().actions.jump.held).toBe(true)
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
    expect(snapshot.actions.jump).toEqual({ held: true, pressed: true, released: false })
    expect(snapshot.actions.dash).toEqual({ held: true, pressed: true, released: false })
  })

  it("releases an action held only through keys it lost, and holds a newly bound one only after a fresh press", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { jump: [" "], crouch: ["c"] })
    const idle = { held: false, pressed: false, released: false }

    fake.down(" ")
    input.snapshot()
    input.rebind({ jump: ["w"], crouch: [" "] })
    const snapshot = input.snapshot()
    expect(snapshot.actions.jump).toEqual({ held: false, pressed: false, released: true })
    expect(snapshot.actions.crouch).toEqual(idle)
    fake.up(" ")
    expect(input.snapshot().actions.crouch).toEqual(idle)
    fake.down(" ")
    expect(input.snapshot().actions.crouch).toEqual({ held: true, pressed: true, released: false })
  })

  it("keeps an action held through a key it kept", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { jump: [" "], crouch: ["c"] })

    fake.down(" ")
    input.snapshot()
    input.rebind({ jump: [" ", "w"], crouch: ["x"] })
    expect(input.snapshot().actions.jump).toEqual({ held: true, pressed: false, released: false })
    fake.up(" ")
    expect(input.snapshot().actions.jump).toEqual({ held: false, pressed: false, released: true })
  })

  it("ignores actions a rebinding adds at runtime", () => {
    const fake = makeHost()
    const input = Keyboard.actions(fake.host, { jump: [" "] })
    const next = { jump: ["w"], extra: ["x"] } as const

    // The types reject it; the runtime ignores it too, for untyped callers.
    // @ts-expect-error is not an action of these bindings
    input.rebind(next)
    expect(Object.keys(input.snapshot().actions)).toEqual(["jump"])
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
    expect(replay.snapshot().actions.jump.pressed).toBe(true)
  })
})

describe("Keyboard.recording release and press within one update", () => {
  it("replays an action released and pressed again between two snapshots", () => {
    const fake = makeHost()
    const bindings = { jump: [" "] } as const
    const recorder = Keyboard.recording(Keyboard.actions(fake.host, bindings))
    const live: Array<Keyboard.Snapshot<typeof bindings>> = []

    fake.down(" ")
    live.push(recorder.snapshot())
    fake.up(" ")
    fake.down(" ")
    live.push(recorder.snapshot())
    expect(live[1]!.actions.jump).toEqual({ held: true, pressed: true, released: false })
    expect(recorder.timeline()).toEqual([{ frame: 0, press: ["jump"] }, { frame: 1, press: ["jump"], release: ["jump"] }])

    const replay = Keyboard.scripted(bindings, recorder.timeline())
    expect(live.map(() => replay.snapshot())).toEqual(live)
  })
})

describe("Keyboard.presses", () => {
  it("collects every key press, bound or not, once per snapshot and without repeats", () => {
    const fake = makeHost()
    const presses = Keyboard.presses(fake.host)

    fake.downCode("j", "KeyJ")
    fake.down("j", true)
    fake.down("Escape")
    expect(presses.snapshot()).toEqual([{ key: "j", code: "KeyJ" }, { key: "Escape", code: null }])
    expect(presses.snapshot()).toEqual([])
    presses.dispose()
    expect(fake.listenerCount()).toBe(0)
  })

  it("does not prevent the browser default", () => {
    const fake = makeHost()
    Keyboard.presses(fake.host)
    fake.down(" ")
    expect(fake.prevented).toEqual([])
  })
})

describe("Keyboard.parseRebinding", () => {
  const bindings = { jump: [" "], left: ["a"] } as const

  it("accepts the same actions bound to characters and physical keys", () => {
    const parsed = Keyboard.parseRebinding(bindings, JSON.parse('{"jump":[{"code":"KeyJ"}],"left":["ArrowLeft","q"]}'))
    expect(parsed).toMatchObject({ ok: true, value: { jump: [{ code: "KeyJ" }], left: ["ArrowLeft", "q"] } })
  })

  it("names the offending value", () => {
    const fail = (data: unknown) => {
      const parsed = Keyboard.parseRebinding(bindings, data)
      return parsed.ok ? null : parsed.error.path
    }
    expect(fail(null)).toBe("")
    expect(fail({ jump: ["j"] })).toBe("left")
    expect(fail({ jump: [], left: ["a"] })).toBe("jump")
    expect(fail({ jump: ["j", { key: "k" }], left: ["a"] })).toBe("jump[1]")
    expect(fail({ jump: [""], left: ["a"] })).toBe("jump[0]")
    expect(fail({ jump: ["j"], left: ["a"], fly: ["f"] })).toBe("fly")
  })
})

describe("Keyboard vector actions", () => {
  const bindings = { move: Keyboard.vector({ up: ["w"], down: ["s"], left: ["a"], right: ["d"] }), jump: [" "] } as const

  it("reports a direction of length 1, cancelling opposite keys and normalizing diagonals", () => {
    const fake = makeHost()
    const keys = Keyboard.actions(fake.host, bindings)
    expect(keys.snapshot()).toEqual(Keyboard.idle(bindings))
    fake.down("d")
    const right = keys.snapshot()
    expect(right.vectors.move).toEqual({ x: 1, y: 0 })
    expect(right.actions).toEqual({ jump: { held: false, pressed: false, released: false } })
    expect(right.used).toBe(true)
    fake.down("s")
    expect(keys.snapshot().vectors.move).toEqual({ x: Math.SQRT1_2, y: Math.SQRT1_2 })
    fake.down("a")
    expect(keys.snapshot().vectors.move).toEqual({ x: 0, y: 1 })
    fake.up("s")
    const cancelled = keys.snapshot()
    expect(cancelled.vectors.move).toEqual({ x: 0, y: 0 })
    expect(cancelled.used).toBe(true)
  })

  it("rebinds a vector's keys", () => {
    const fake = makeHost()
    const keys = Keyboard.actions(fake.host, bindings)
    keys.rebind({ move: Keyboard.vector({ up: ["i"], down: ["k"], left: ["j"], right: ["l"] }), jump: [" "] })
    fake.down("d")
    expect(keys.snapshot().vectors.move).toEqual({ x: 0, y: 0 })
    fake.down("l")
    expect(keys.snapshot().vectors.move).toEqual({ x: 1, y: 0 })
  })

  it("scripts and records a vector by direction, and replays it", () => {
    const scripted = Keyboard.scripted(bindings, [{ frame: 0, press: ["move.up", "jump"] }, { frame: 1, release: ["move.up"] }])
    expect(scripted.snapshot().vectors.move).toEqual({ x: 0, y: -1 })
    expect(scripted.snapshot().vectors.move).toEqual({ x: 0, y: 0 })

    const fake = makeHost()
    const recorder = Keyboard.recording(Keyboard.actions(fake.host, bindings))
    fake.down("a")
    fake.down("d")
    const live = [recorder.snapshot()]
    fake.up("a")
    live.push(recorder.snapshot())
    expect(recorder.timeline()).toEqual([{ frame: 0, press: ["move.left", "move.right"] }, { frame: 1, release: ["move.left"] }])
    const parsed = Keyboard.parseTimeline(bindings, JSON.parse(JSON.stringify(recorder.timeline())))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const replay = Keyboard.scripted(bindings, parsed.value)
    expect(live.map(() => replay.snapshot())).toEqual(live)
    expect(Keyboard.parseTimeline(bindings, [{ frame: 0, press: ["move"] }])).toMatchObject({ ok: false, error: { path: "[0].press[0]" } })
  })

  it("parses a saved vector binding", () => {
    const saved = JSON.parse(JSON.stringify({ move: Keyboard.vector({ up: ["i"], down: ["k"], left: ["j"], right: [Keyboard.code("KeyL")] }), jump: ["x"] }))
    expect(Keyboard.parseRebinding(bindings, saved)).toEqual({
      ok: true,
      value: { move: { _tag: "Vector", up: ["i"], down: ["k"], left: ["j"], right: [{ code: "KeyL" }] }, jump: ["x"] }
    })
    expect(Keyboard.parseRebinding(bindings, { move: ["w"], jump: [" "] })).toMatchObject({ ok: false, error: { path: "move" } })
    expect(Keyboard.parseRebinding(bindings, { move: { up: ["i"], down: ["k"], left: ["j"] }, jump: [" "] })).toMatchObject({ ok: false, error: { path: "move.right" } })
  })
})
