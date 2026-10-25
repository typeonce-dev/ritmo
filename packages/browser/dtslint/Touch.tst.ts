import { Controls, Keyboard, Touch } from "@typeonce/ritmo-browser"
import { describe, expect, it } from "tstyche"

declare const target: Touch.TouchTarget
declare const blurHost: Touch.BlurHost
declare const host: Keyboard.KeyboardHost

const touch = Touch.actions(target, blurHost, ({ width, height }) => ({
  sticks: {
    move: { region: { left: 0, top: 0, width: width / 2, height }, radius: 56 },
    aim: { region: { left: width / 2, top: 0, width: width / 2, height }, radius: 56 }
  },
  buttons: { dash: { center: { x: width - 84, y: height - 150 }, radius: 36 } }
}))

describe("Touch", () => {
  it("infers the button and stick names from the layout", () => {
    expect(touch).type.toBe<Touch.Actions<"dash", "move" | "aim", never>>()
    expect(touch.snapshot().actions.dash).type.toBe<Touch.ButtonState>()
    expect(touch.snapshot().vectors.aim).type.toBe<Touch.StickState>()
    expect(touch.snapshot().vectors.aim.active).type.toBe<boolean>()
    expect(touch.view().sticks).type.toBe<{ readonly move: Touch.StickView | null; readonly aim: Touch.StickView | null }>()
    // The layout function never hides a control, so no zone is null
    expect(touch.view().layout.sticks.move).type.toBe<Touch.StickZone>()
    expect(touch.view().layout.buttons.dash).type.toBe<Touch.ButtonZone>()
    expect(touch.view().layout.sticks.move.radius).type.toBe<number>()
    // @ts-expect-error Property 'jump' does not exist on type
    touch.snapshot().actions.jump
    // @ts-expect-error Property 'look' does not exist on type
    touch.snapshot().vectors.look
  })

  it("has no single stick: each one is a vector by name", () => {
    // @ts-expect-error Property 'stick' does not exist on type 'Snapshot<"dash", "move" | "aim">'
    touch.snapshot().stick
    // @ts-expect-error Property 'stick' does not exist on type 'View<"dash", "move" | "aim", never>'
    touch.view().stick
  })

  it("hides a control with a null zone, keeping its name", () => {
    let driving = false
    const hidden = Touch.actions(target, blurHost, ({ width, height }) => ({
      sticks: { move: driving ? null : { region: { left: 0, top: 0, width: width / 2, height }, radius: 56 } },
      buttons: { steer: driving ? { center: { x: 60, y: height - 60 }, radius: 40 } : null }
    }))
    driving = true
    expect(hidden).type.toBe<Touch.Actions<"steer", "move", "steer" | "move">>()
    expect(hidden.snapshot().vectors.move).type.toBe<Touch.StickState>()
    expect(hidden.view().layout.buttons.steer).type.toBe<Touch.ButtonZone | null>()
    // @ts-expect-error Object is possibly 'null'
    hidden.view().layout.sticks.move.radius
    Touch.actions(target, blurHost, () => ({
      // @ts-expect-error dash names both a stick and a button: give them different names
      sticks: { dash: null },
      buttons: { dash: null }
    }))
  })

  it("takes a buttons-only layout as sticks: {}", () => {
    const buttons = Touch.actions(target, blurHost, () => ({ sticks: {}, buttons: { jump: { center: { x: 0, y: 0 }, radius: 30 } } }))
    expect(buttons).type.toBe<Touch.Actions<"jump", never, never>>()
    expect(buttons.snapshot().vectors).type.toBe<{}>()
  })

  it("rejects a stick and a button with the same name", () => {
    Touch.actions(target, blurHost, () => ({
      sticks: {
        // @ts-expect-error dash names both a stick and a button: give them different names
        dash: { region: { left: 0, top: 0, width: 100, height: 100 }, radius: 50 }
      },
      buttons: { dash: { center: { x: 0, y: 0 }, radius: 30 } }
    }))
    // @ts-expect-error dash names both a stick and a button: give them different names
    Touch.idle({ buttons: ["dash"], sticks: ["dash"] })
    // @ts-expect-error dash names both a stick and a button: give them different names
    Touch.scripted({ buttons: ["dash"], sticks: ["move", "dash"] }, [])
  })

  it("rejects the removed vector field: a stick's key is its vector", () => {
    Touch.actions(target, blurHost, () => ({
      sticks: {
        // @ts-expect-error a stick drives the vector named by its key in sticks: remove vector
        move: { region: { left: 0, top: 0, width: 100, height: 100 }, radius: 50, vector: "move" }
      },
      buttons: {}
    }))
    // @ts-expect-error Property 'sticks' is missing
    Touch.actions(target, blurHost, () => ({ stick: { region: { left: 0, top: 0, width: 100, height: 100 }, radius: 50 }, buttons: {} }))
  })

  it("types idle and scripted by the button and stick names", () => {
    expect(Touch.idle({ buttons: ["dash"], sticks: ["move", "aim"] })).type.toBe<Touch.Snapshot<"dash", "move" | "aim">>()
    expect(Touch.idle({ buttons: ["attack"], sticks: [] })).type.toBe<Touch.Snapshot<"attack">>()
    const scripted = Touch.scripted({ buttons: ["dash"], sticks: ["move", "aim"] }, [
      { frame: 0, sticks: { move: { x: 1, y: 0 }, aim: null }, press: ["dash"] }
    ])
    expect(scripted).type.toBe<Touch.Scripted<"dash", "move" | "aim">>()
    expect(scripted.snapshot().vectors.move).type.toBe<Touch.StickState>()
    // @ts-expect-error Property 'sticks' is missing
    Touch.idle({ buttons: ["dash"] })
    // @ts-expect-error Object literal may only specify known properties, and 'vector' does not exist
    Touch.idle({ buttons: ["dash"], sticks: [], vector: "move" })
  })

  it("rejects a timeline naming an undeclared button or stick", () => {
    // @ts-expect-error Type '"jump"' is not assignable to type
    Touch.scripted({ buttons: ["attack", "dash"], sticks: [] }, [{ frame: 0, press: ["jump"] }])
    // @ts-expect-error Object literal may only specify known properties, and 'look' does not exist
    Touch.scripted({ buttons: ["dash"], sticks: ["move", "aim"] }, [{ frame: 0, sticks: { look: { x: 1, y: 0 } } }])
    // @ts-expect-error 'stick' does not exist in type 'TimelineEntry<"dash", "move">'. Did you mean to write 'sticks'?
    Touch.scripted({ buttons: ["dash"], sticks: ["move"] }, [{ frame: 0, stick: { x: 1, y: 0 } }])
  })
})

describe("Touch in Controls", () => {
  it("merges a twin-stick device as plain vectors, with the aim lacking on the keyboard", () => {
    const Twin = Controls.actions({ buttons: ["dash"], vectors: ["move", "aim"] })
    const keyboard = Keyboard.actions(host, { move: Keyboard.vector({ up: ["w"], down: ["s"], left: ["a"], right: ["d"] }), dash: [" "] })
    const input = Twin.merge({ keyboard: Twin.lacking(keyboard, ["aim"]), touch }).snapshot()
    expect(input.vectors.aim).type.toBe<Controls.Vector>()
    expect(input.devices.touch).type.toBe<Touch.Snapshot<"dash", "move" | "aim">>()
    expect(input.devices.touch.vectors.aim.active).type.toBe<boolean>()
    // @ts-expect-error Property 'active' does not exist on type 'Vector'
    input.vectors.aim.active
    // @ts-expect-error keyboard has no action aim
    Twin.merge({ keyboard, touch })
  })
})
