import { Result } from "@typeonce/ritmo"
import { Controls, Keyboard } from "@typeonce/ritmo-browser"
import { describe, expect, it } from "tstyche"

declare const host: Keyboard.KeyboardHost

describe("Keyboard", () => {
  it("types snapshots by the bound action names", () => {
    const input = Keyboard.actions(host, { jump: [" "], left: ["ArrowLeft", "a"] })
    expect(input.snapshot()).type.toBe<Keyboard.Snapshot<{ readonly jump: readonly [" "]; readonly left: readonly ["ArrowLeft", "a"] }>>()
    expect(input.snapshot().actions.jump.pressed).type.toBe<boolean>()
    // @ts-expect-error Property 'crouch' does not exist
    input.snapshot().actions.crouch
  })

  it("accepts physical-key bindings alongside characters", () => {
    const input = Keyboard.actions(host, { up: [Keyboard.code("KeyW"), "ArrowUp"] })
    expect(input.snapshot().actions.up.held).type.toBe<boolean>()
    // @ts-expect-error Object literal may only specify known properties, and 'key' does not exist in type 'PhysicalKey'.
    Keyboard.actions(host, { up: [{ key: "w" }] })
  })

  it("accepts real KeyboardEvent hosts, which carry `code`", () => {
    expect<Window>().type.toBeAssignableTo<Keyboard.KeyboardHost>()
  })

  it("accepts a real KeyboardEvent, with its nullable `target`, without a cast", () => {
    expect<KeyboardEvent>().type.toBeAssignableTo<Keyboard.KeyEvent>()
    expect<KeyboardEvent["target"]>().type.toBeAssignableTo<Keyboard.KeyEvent["target"]>()
    expect<HTMLElement>().type.toBeAssignableTo<Keyboard.KeyboardHost>()
  })

  it("types a key event target as an object, so a test host passes a fake field", () => {
    expect<Keyboard.KeyEvent["target"]>().type.toBe<object | null | undefined>()
    // @ts-expect-error Type 'string' is not assignable to type 'object'
    const typed: Keyboard.KeyEvent = { key: "w", repeat: false, target: "INPUT", preventDefault() {} }
    void typed
  })

  it("requires at least one key per action", () => {
    // @ts-expect-error Type '[]' is not assignable to type 'readonly [KeyBinding, ...KeyBinding[]]'.
    Keyboard.actions(host, { jump: [] })
  })
})

describe("Keyboard.rebind", () => {
  it("rebinds the same actions only", () => {
    const input = Keyboard.actions(host, { jump: [" "], left: ["a"] })
    expect(input.rebind).type.toBeCallableWith({ jump: [Keyboard.code("KeyJ")], left: ["ArrowLeft"] })
    expect(input.rebind).type.not.toBeCallableWith({ jump: ["j"] })
  })

  it("rejects extra actions even from an object that is not written inline", () => {
    const input = Keyboard.actions(host, { jump: [" "], left: ["a"] })
    const next = { jump: ["j"], left: ["q"], extra: ["x"] } as const
    // @ts-expect-error extra is not an action of these bindings
    input.rebind(next)
    const wide: Record<string, readonly ["j"]> = {}
    expect(input.rebind).type.not.toBeCallableWith(wide)
    let current: Keyboard.Rebinding<{ readonly jump: readonly [" "]; readonly left: readonly ["a"] }> = { jump: [" "], left: ["a"] }
    current = { ...current, jump: [Keyboard.code("KeyJ")] }
    expect(input.rebind).type.toBeCallableWith(current)
    expect(Keyboard.recording(input).rebind).type.not.toBeCallableWith(next)
  })
})

describe("Keyboard.presses", () => {
  it("returns the keys pressed since the previous snapshot", () => {
    expect(Keyboard.presses(host).snapshot()).type.toBe<ReadonlyArray<Keyboard.KeyPress>>()
    expect(Keyboard.presses(host).snapshot()[0]?.code).type.toBe<string | null | undefined>()
  })
})

describe("Keyboard.parseRebinding", () => {
  it("parses into a rebinding for the same actions", () => {
    const bindings = { jump: [" "], left: ["a"] } as const
    expect(Keyboard.parseRebinding(bindings, null)).type.toBe<
      Result.Result<Keyboard.Rebinding<{ readonly jump: readonly [" "]; readonly left: readonly ["a"] }>, Keyboard.InvalidRebinding>
    >()
    const parsed = Keyboard.parseRebinding(bindings, null)
    if (parsed.ok) Keyboard.actions(host, bindings).rebind(parsed.value)
  })

  it("rejects a rebinding parsed for other actions", () => {
    const parsed = Keyboard.parseRebinding({ jump: [" "] }, null)
    if (parsed.ok) {
      // @ts-expect-error Property 'left' is missing
      Keyboard.actions(host, { jump: [" "], left: ["a"] }).rebind(parsed.value)
    }
  })

  it("splits button and vector actions, and scripts vectors by direction", () => {
    const bindings = { move: Keyboard.vector({ up: ["w"], down: ["s"], left: ["a"], right: ["d"] }), jump: [" "] } as const
    const input = Keyboard.scripted(bindings, [{ frame: 0, press: ["move.right", "jump"] }]).snapshot()
    expect(input.vectors.move).type.toBe<Controls.Vector>()
    expect(input.actions.jump).type.toBe<Controls.ActionState>()
    // @ts-expect-error Property 'move' does not exist
    input.actions.move
    // @ts-expect-error Type '"move"' is not assignable
    Keyboard.scripted(bindings, [{ frame: 0, press: ["move"] }])
    // @ts-expect-error Property 'right' is missing
    Keyboard.vector({ up: ["w"], down: ["s"], left: ["a"] })
  })
})
