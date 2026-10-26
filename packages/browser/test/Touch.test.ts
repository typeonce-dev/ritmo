import { describe, expect, it } from "vitest"

import { Pointer, Touch } from "@typeonce/ritmo-browser"

const size = { width: 800, height: 400 }

/** A move stick on the left half; attack aims (drag 100px), dash does not. */
const layout = ({ width, height }: Touch.Size) => ({
  sticks: { move: { region: { left: 0, top: 0, width: width / 2, height }, radius: 50, deadZone: 0.2 } },
  buttons: {
    attack: { center: { x: width - 100, y: height - 100 }, radius: 50, aimRadius: 100 },
    dash: { center: { x: width - 250, y: height - 60 }, radius: 30 }
  }
})

const makeTarget = (rect = { left: 10, top: 20, ...size }) => {
  const listeners = new Map<string, Set<(event?: any) => void>>()
  const add = (type: string, listener: (event?: any) => void) => {
    const set = listeners.get(type) ?? new Set()
    set.add(listener)
    listeners.set(type, set)
  }
  const remove = (type: string, listener: (event?: any) => void) => {
    listeners.get(type)?.delete(listener)
  }
  const styles = new Map<string, string>([["touch-action", "auto"]])
  const style = {
    getPropertyValue: (property: string) => styles.get(property) ?? "",
    setProperty: (property: string, value: string) => {
      if (value === "") styles.delete(property)
      else styles.set(property, value)
    }
  }
  const target: Touch.TouchTarget & Pointer.PointerTarget = {
    addEventListener: add,
    removeEventListener: remove,
    getBoundingClientRect: () => rect,
    style
  }
  const blurHost = { addEventListener: add, removeEventListener: remove }
  /** Coordinates are element-relative; the fake adds the element's offset. */
  const dispatch = (type: string, pointerId: number, x: number, y: number, pointerType = "touch") => {
    for (const listener of listeners.get(type) ?? []) {
      listener({ clientX: x + rect.left, clientY: y + rect.top, pointerId, pointerType, button: 0, preventDefault: () => {} })
    }
  }
  return {
    target,
    blurHost,
    styles,
    contextMenu: () => {
      let prevented = false
      for (const listener of listeners.get("contextmenu") ?? []) listener({ preventDefault: () => (prevented = true) })
      return prevented
    },
    down: (id: number, x: number, y: number, type?: string) => dispatch("pointerdown", id, x, y, type),
    move: (id: number, x: number, y: number, type?: string) => dispatch("pointermove", id, x, y, type),
    up: (id: number, x: number, y: number, type?: string) => dispatch("pointerup", id, x, y, type),
    cancel: (id: number, x: number, y: number) => dispatch("pointercancel", id, x, y),
    blur: () => {
      for (const listener of listeners.get("blur") ?? []) listener()
    },
    listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0)
  }
}

describe("Touch.actions", () => {
  it("floats the stick where the thumb lands and reports tilt with the dead zone removed", () => {
    const fake = makeTarget()
    const touch = Touch.actions(fake.target, fake.blurHost, layout)
    expect(touch.snapshot()).toEqual(Touch.idle({ buttons: ["attack", "dash"], sticks: ["move"] }))

    fake.down(1, 100, 200)
    expect(touch.snapshot().vectors.move).toEqual({ x: 0, y: 0, active: true })
    // 5px is inside the dead zone (0.2 * 50).
    fake.move(1, 105, 200)
    expect(touch.snapshot().vectors.move).toEqual({ x: 0, y: 0, active: true })
    // Half-way out of the live range: (30/50 - 0.2) / 0.8 = 0.5.
    fake.move(1, 130, 200)
    expect(touch.snapshot().vectors.move.x).toBeCloseTo(0.5, 9)
    // Past the radius is full tilt, and the drawn knob stays on the rim.
    fake.move(1, 100, 400)
    expect(touch.snapshot().vectors.move).toEqual({ x: 0, y: 1, active: true })
    expect(touch.view().sticks).toEqual({ move: { origin: { x: 100, y: 200 }, knob: { x: 100, y: 250 } } })
    fake.up(1, 100, 400)
    expect(touch.snapshot().vectors.move).toEqual({ x: 0, y: 0, active: false })
    expect(touch.snapshot().used).toBe(false)
  })

  it("gives each finger to one control: move and attack at the same time", () => {
    const fake = makeTarget()
    const touch = Touch.actions(fake.target, fake.blurHost, layout)
    fake.down(1, 100, 200)
    fake.move(1, 150, 200)
    fake.down(2, 700, 300)
    const both = touch.snapshot()
    expect(both.vectors.move.x).toBeCloseTo(1, 9)
    expect(both.actions.attack).toEqual({ held: true, pressed: true, released: false, aim: null, cancelled: false })
    // The stick's finger crossing into a button does not press it.
    fake.move(1, 700, 300)
    fake.up(2, 700, 300)
    const after = touch.snapshot()
    expect(after.vectors.move.active).toBe(true)
    expect(after.actions.attack).toMatchObject({ held: false, released: true })
    // A second finger in the stick region while the stick is held is ignored.
    fake.down(3, 50, 50)
    expect(touch.view().sticks.move?.origin).toEqual({ x: 100, y: 200 })
  })

  it("releases what a pointer id held when it comes down again without an up", () => {
    const fake = makeTarget()
    const touch = Touch.actions(fake.target, fake.blurHost, layout)
    fake.down(1, 700, 300)
    expect(touch.snapshot().actions.attack.held).toBe(true)
    // The up was lost; the same id now lands in the stick region.
    fake.down(1, 100, 200)
    const after = touch.snapshot()
    expect(after.actions.attack).toMatchObject({ held: false, released: true, cancelled: true })
    expect(after.vectors.move.active).toBe(true)
    fake.up(1, 100, 200)
    expect(touch.snapshot().vectors.move.active).toBe(false)
  })

  it("aims by dragging from the button and reports the aim on the release, even for a tap shorter than a frame", () => {
    const fake = makeTarget()
    const touch = Touch.actions(fake.target, fake.blurHost, layout)
    fake.down(2, 700, 300)
    fake.move(2, 700, 250)
    expect(touch.snapshot().actions.attack.aim).toEqual({ x: 0, y: -0.5 })
    fake.move(2, 900, 300)
    fake.up(2, 900, 300)
    expect(touch.snapshot().actions.attack).toEqual({ held: false, pressed: false, released: true, aim: { x: 1, y: 0 }, cancelled: false })
    expect(touch.snapshot().actions.attack.aim).toBeNull()

    // Pressed, dragged, and lifted between two snapshots.
    fake.down(4, 700, 300)
    fake.up(4, 640, 300)
    expect(touch.snapshot().actions.attack).toEqual({ held: false, pressed: true, released: true, aim: { x: -0.6, y: 0 }, cancelled: false })

    // A button without aimRadius never aims.
    fake.down(5, 550, 340)
    fake.up(5, 570, 340)
    expect(touch.snapshot().actions.dash).toMatchObject({ pressed: true, released: true, aim: null })
  })

  it("cancels on pointercancel and blur, so games can skip firing", () => {
    const fake = makeTarget()
    const touch = Touch.actions(fake.target, fake.blurHost, layout)
    fake.down(2, 700, 300)
    touch.snapshot()
    fake.cancel(2, 700, 300)
    expect(touch.snapshot().actions.attack).toMatchObject({ released: true, cancelled: true })
    fake.down(1, 100, 200)
    fake.down(2, 700, 300)
    touch.snapshot()
    fake.blur()
    const snapshot = touch.snapshot()
    expect(snapshot.vectors.move.active).toBe(false)
    expect(snapshot.actions.attack).toMatchObject({ held: false, released: true, cancelled: true })
  })

  it("ignores other pointer types unless asked, and cleans up", () => {
    const fake = makeTarget()
    const touch = Touch.actions(fake.target, fake.blurHost, layout)
    expect(Object.fromEntries(fake.styles)).toEqual({
      "touch-action": "none",
      "user-select": "none",
      "-webkit-user-select": "none",
      "-webkit-touch-callout": "none"
    })
    fake.down(1, 700, 300, "mouse")
    expect(touch.snapshot().actions.attack.held).toBe(false)
    touch.dispose()
    expect(fake.listenerCount()).toBe(0)
    expect(Object.fromEntries(fake.styles)).toEqual({ "touch-action": "auto" })

    const withMouse = Touch.actions(fake.target, fake.blurHost, layout, { pointerTypes: ["touch", "mouse"] })
    fake.down(1, 700, 300, "mouse")
    expect(withMouse.snapshot().actions.attack.held).toBe(true)
  })

  it("cancels the long-press context menu only while a tracked finger is down", () => {
    const fake = makeTarget()
    Touch.actions(fake.target, fake.blurHost, layout)
    expect(fake.contextMenu()).toBe(false)
    fake.down(1, 100, 200)
    expect(fake.contextMenu()).toBe(true)
    fake.up(1, 100, 200)
    expect(fake.contextMenu()).toBe(false)
    // A finger off every control still selects nothing, and a mouse right-click keeps its menu.
    fake.down(2, 500, 50)
    expect(fake.contextMenu()).toBe(true)
    fake.blur()
    expect(fake.contextMenu()).toBe(false)
    fake.down(3, 100, 200, "mouse")
    expect(fake.contextMenu()).toBe(false)
  })

  it("leaves touches out of Pointer by default", () => {
    const fake = makeTarget()
    const pointer = Pointer.actions(fake.target, fake.blurHost, {})
    fake.down(1, 700, 300, "touch")
    expect(pointer.snapshot().buttons.primary.held).toBe(false)
    fake.down(1, 700, 300, "mouse")
    expect(pointer.snapshot().buttons.primary.held).toBe(true)
  })
})

describe("Touch.actions swipe", () => {
  /** Stick in the bottom-left quarter, swipe anywhere, buttons on the right. */
  const withSwipe = (size: Touch.Size) => ({
    ...layout(size),
    sticks: { move: { region: { left: 0, top: size.height / 2, width: size.width / 2, height: size.height / 2 }, radius: 50 } },
    swipe: { region: { left: 0, top: 0, width: size.width, height: size.height } }
  })

  it("reports how far a finger outside the buttons and the stick moved since the previous snapshot", () => {
    const fake = makeTarget()
    const touch = Touch.actions(fake.target, fake.blurHost, withSwipe)
    expect(touch.snapshot().swipe).toEqual({ active: false, delta: { x: 0, y: 0 } })
    fake.down(1, 400, 100)
    fake.move(1, 430, 90)
    fake.move(1, 450, 95)
    expect(touch.snapshot().swipe).toEqual({ active: true, delta: { x: 50, y: -5 } })
    expect(touch.snapshot().swipe).toEqual({ active: true, delta: { x: 0, y: 0 } })
    // Movement before the finger lifts is still reported once.
    fake.move(1, 470, 95)
    fake.up(1, 470, 95)
    expect(touch.snapshot().swipe).toEqual({ active: false, delta: { x: 20, y: 0 } })
    expect(touch.snapshot().swipe.delta).toEqual({ x: 0, y: 0 })
  })

  it("leaves buttons and the stick their fingers, and swipes with a second finger while moving and firing", () => {
    const fake = makeTarget()
    const touch = Touch.actions(fake.target, fake.blurHost, withSwipe)
    fake.down(1, 100, 300)
    fake.down(2, 700, 300)
    fake.down(3, 300, 100)
    fake.move(1, 150, 300)
    fake.move(3, 340, 100)
    const snapshot = touch.snapshot()
    expect(snapshot.vectors.move.x).toBeCloseTo(1, 9)
    expect(snapshot.actions.attack.held).toBe(true)
    expect(snapshot.swipe).toEqual({ active: true, delta: { x: 40, y: 0 } })
    // A fourth finger does not take over the swipe.
    fake.down(4, 500, 50)
    fake.move(4, 600, 50)
    expect(touch.snapshot().swipe.delta).toEqual({ x: 0, y: 0 })
    fake.blur()
    expect(touch.snapshot().swipe.active).toBe(false)
  })

  it("ignores touches outside every control when there is no swipe area", () => {
    const fake = makeTarget()
    const touch = Touch.actions(fake.target, fake.blurHost, layout)
    fake.down(1, 500, 50)
    fake.move(1, 600, 50)
    expect(touch.snapshot().swipe).toEqual({ active: false, delta: { x: 0, y: 0 } })
  })
})

describe("Touch.scripted", () => {
  it("releases a held button as a cancel when the layout hides it, and ignores its finger until it lifts", () => {
    const fake = makeTarget()
    let driving = false
    const touch = Touch.actions(fake.target, fake.blurHost, (size) => {
      const base = layout(size)
      return { sticks: base.sticks, buttons: { attack: driving ? null : base.buttons.attack, dash: base.buttons.dash } }
    })
    fake.down(1, 700, 300)
    expect(touch.snapshot().actions.attack.pressed).toBe(true)
    driving = true
    expect(touch.snapshot().actions.attack).toEqual({ held: false, pressed: false, released: true, aim: null, cancelled: true })
    // The finger stays down and moves, but is no control's any more.
    fake.move(1, 710, 300)
    expect(touch.snapshot().actions.attack).toEqual({ held: false, pressed: false, released: false, aim: null, cancelled: false })
    expect(touch.snapshot().used).toBe(false)
    // Shown again under the same finger, the button stays up until a new touch.
    driving = false
    expect(touch.snapshot().actions.attack.held).toBe(false)
    fake.up(1, 710, 300)
    fake.down(2, 700, 300)
    expect(touch.snapshot().actions.attack.pressed).toBe(true)
  })

  it("lets go of a held stick the layout hides, and gives no finger to a hidden control", () => {
    const fake = makeTarget()
    let onFoot = true
    const touch = Touch.actions(fake.target, fake.blurHost, (size) => {
      const base = layout(size)
      return { sticks: { move: onFoot ? base.sticks.move : null }, buttons: { attack: base.buttons.attack, dash: onFoot ? null : base.buttons.dash } }
    })
    // Dash is hidden on foot: a finger on it goes to the stick instead.
    fake.down(1, 550, 340)
    fake.down(2, 100, 200)
    fake.move(2, 100, 300)
    expect(touch.snapshot().vectors.move).toEqual({ x: 0, y: 1, active: true })
    expect(touch.snapshot().actions.dash.held).toBe(false)
    onFoot = false
    expect(touch.snapshot().vectors.move).toEqual({ x: 0, y: 0, active: false })
    expect(touch.view().sticks.move).toBeNull()
    expect(touch.view().layout.sticks.move).toBeNull()
    // The thumb that held the stick keeps moving: nothing walks.
    fake.move(2, 100, 400)
    expect(touch.snapshot().vectors.move.active).toBe(false)
    // Dash is shown while driving and takes a new finger.
    fake.down(3, 550, 340)
    expect(touch.snapshot().actions.dash.pressed).toBe(true)
  })

  it("hides a control that turns null between snapshots when another finger comes down", () => {
    const fake = makeTarget()
    let shown = true
    const touch = Touch.actions(fake.target, fake.blurHost, (size) => {
      const base = layout(size)
      return { sticks: base.sticks, buttons: { attack: shown ? base.buttons.attack : null, dash: base.buttons.dash } }
    })
    touch.snapshot()
    fake.down(1, 700, 300)
    shown = false
    fake.down(2, 550, 340)
    // The aim drag of a finger whose button is hidden is not read.
    fake.move(1, 800, 300)
    const { actions } = touch.snapshot()
    expect(actions.attack).toEqual({ held: false, pressed: true, released: true, aim: null, cancelled: true })
    expect(actions.dash.pressed).toBe(true)
  })

  it("plays stick vectors, presses, aims, releases, and cancels by frame", () => {
    const touch = Touch.scripted({ buttons: ["attack", "skill"], sticks: ["move"] }, [
      { frame: 0, sticks: { move: { x: 3, y: 4 } } },
      { frame: 1, press: ["attack"], aim: { attack: { x: 0, y: -1 } } },
      { frame: 2, release: ["attack"] },
      { frame: 2, press: ["skill"], cancel: ["skill"] },
      { frame: 3, sticks: { move: null } }
    ])
    expect(touch.snapshot().vectors.move).toEqual({ x: 0.6, y: 0.8, active: true })
    expect(touch.snapshot().actions.attack).toEqual({ held: true, pressed: true, released: false, aim: { x: 0, y: -1 }, cancelled: false })
    const lifted = touch.snapshot()
    expect(lifted.actions.attack).toEqual({ held: false, pressed: false, released: true, aim: { x: 0, y: -1 }, cancelled: false })
    expect(lifted.actions.skill).toMatchObject({ pressed: true, released: true, cancelled: true })
    expect(touch.snapshot().vectors.move.active).toBe(false)
    expect(touch.frames()).toBe(4)
  })

  it("reports a scripted swipe on its frame only", () => {
    const touch = Touch.scripted({ buttons: ["attack"], sticks: [] }, [{ frame: 1, swipe: { x: 30, y: 0 } }, { frame: 1, swipe: { x: 5, y: 1 } }])
    expect(touch.snapshot().swipe).toEqual({ active: false, delta: { x: 0, y: 0 } })
    expect(touch.snapshot().swipe).toEqual({ active: true, delta: { x: 35, y: 1 } })
    expect(touch.snapshot().swipe.active).toBe(false)
  })
})

describe("Touch twin sticks", () => {
  /** Move on the left half, aim on the right half, and a dash button inside the aim region. */
  const twin = ({ width, height }: Touch.Size) => ({
    sticks: {
      move: { region: { left: 0, top: 0, width: width / 2, height }, radius: 50, deadZone: 0 },
      aim: { region: { left: width / 2, top: 0, width: width / 2, height }, radius: 40, deadZone: 0 }
    },
    buttons: { dash: { center: { x: width - 60, y: height - 60 }, radius: 30 } }
  })

  it("drives two sticks with two fingers at once, each with its own vector and active", () => {
    const fake = makeTarget()
    const touch = Touch.actions(fake.target, fake.blurHost, twin)
    expect(touch.snapshot().vectors).toEqual({ move: { x: 0, y: 0, active: false }, aim: { x: 0, y: 0, active: false } })

    // A finger in the second stick's region drives it, not the first.
    fake.down(2, 500, 100)
    fake.move(2, 500, 60)
    expect(touch.snapshot().vectors).toEqual({ move: { x: 0, y: 0, active: false }, aim: { x: 0, y: -1, active: true } })

    fake.down(1, 100, 200)
    fake.move(1, 125, 200)
    const both = touch.snapshot()
    expect(both.vectors.move).toEqual({ x: 0.5, y: 0, active: true })
    expect(both.vectors.aim).toEqual({ x: 0, y: -1, active: true })
    expect(both.used).toBe(true)
    expect(touch.view().sticks).toEqual({
      move: { origin: { x: 100, y: 200 }, knob: { x: 125, y: 200 } },
      aim: { origin: { x: 500, y: 100 }, knob: { x: 500, y: 60 } }
    })

    // Each stick keeps its own finger: moving one leaves the other.
    fake.move(1, 100, 250)
    expect(touch.snapshot().vectors).toEqual({ move: { x: 0, y: 1, active: true }, aim: { x: 0, y: -1, active: true } })

    // Lifting one releases only that stick.
    fake.up(2, 500, 60)
    expect(touch.snapshot().vectors).toEqual({ move: { x: 0, y: 1, active: true }, aim: { x: 0, y: 0, active: false } })
    expect(touch.view().sticks.aim).toBeNull()
    fake.up(1, 100, 250)
    const lifted = touch.snapshot()
    expect(lifted.vectors).toEqual({ move: { x: 0, y: 0, active: false }, aim: { x: 0, y: 0, active: false } })
    expect(lifted.used).toBe(false)
  })

  it("gives a finger on a button inside a stick region to the button", () => {
    const fake = makeTarget()
    const touch = Touch.actions(fake.target, fake.blurHost, twin)
    fake.down(3, 740, 340)
    const snapshot = touch.snapshot()
    expect(snapshot.actions.dash).toMatchObject({ held: true, pressed: true })
    expect(snapshot.vectors.aim.active).toBe(false)
  })

  it("gives a finger where regions overlap to the first stick in key order, and the next one while it is held", () => {
    const fake = makeTarget()
    const whole = { left: 0, top: 0, width: size.width, height: size.height }
    const touch = Touch.actions(fake.target, fake.blurHost, () => ({
      sticks: { move: { region: whole, radius: 50 }, aim: { region: whole, radius: 50 } },
      buttons: {}
    }))
    fake.down(1, 600, 200)
    expect(touch.view().sticks).toEqual({ move: { origin: { x: 600, y: 200 }, knob: { x: 600, y: 200 } }, aim: null })
    fake.down(2, 100, 200)
    expect(touch.view().sticks.aim).toEqual({ origin: { x: 100, y: 200 }, knob: { x: 100, y: 200 } })
    // A third finger finds both sticks held and is ignored.
    fake.down(3, 300, 100)
    expect(touch.view().sticks.move?.origin).toEqual({ x: 600, y: 200 })
    expect(touch.view().sticks.aim?.origin).toEqual({ x: 100, y: 200 })
  })

  it("releases each stick on pointercancel, and every stick on blur", () => {
    const fake = makeTarget()
    const touch = Touch.actions(fake.target, fake.blurHost, twin)
    fake.down(1, 100, 200)
    fake.down(2, 500, 100)
    fake.cancel(2, 500, 100)
    const cancelled = touch.snapshot()
    expect(cancelled.vectors.move.active).toBe(true)
    expect(cancelled.vectors.aim.active).toBe(false)
    fake.down(2, 500, 100)
    expect(touch.snapshot().vectors.aim.active).toBe(true)
    fake.blur()
    expect(touch.snapshot().vectors).toEqual({ move: { x: 0, y: 0, active: false }, aim: { x: 0, y: 0, active: false } })
    expect(touch.view().sticks).toEqual({ move: null, aim: null })
  })

  it("has no vectors and no sticks in the view for a buttons-only layout", () => {
    const fake = makeTarget()
    const touch = Touch.actions(fake.target, fake.blurHost, () => ({ sticks: {}, buttons: { jump: { center: { x: 50, y: 50 }, radius: 20 } } }))
    fake.down(1, 300, 300)
    const snapshot = touch.snapshot()
    expect(snapshot.vectors).toEqual({})
    expect(snapshot.used).toBe(false)
    expect(touch.view().sticks).toEqual({})
  })
})

describe("Touch.idle and Touch.scripted with sticks", () => {
  it("starts every named stick at rest", () => {
    expect(Touch.idle({ buttons: ["dash"], sticks: ["move", "aim"] })).toEqual({
      actions: { dash: { held: false, pressed: false, released: false, aim: null, cancelled: false } },
      vectors: { move: { x: 0, y: 0, active: false }, aim: { x: 0, y: 0, active: false } },
      swipe: { active: false, delta: { x: 0, y: 0 } },
      used: false
    })
    expect(Touch.idle({ buttons: ["dash"], sticks: [] }).vectors).toEqual({})
  })

  it("plays each stick by name, each from its frame on until lifted", () => {
    const touch = Touch.scripted({ buttons: ["dash"], sticks: ["move", "aim"] }, [
      { frame: 0, sticks: { move: { x: 0, y: -0.5 } } },
      { frame: 1, sticks: { aim: { x: 2, y: 0 } } },
      { frame: 2, sticks: { move: null } },
      { frame: 3, sticks: { aim: null } }
    ])
    expect(touch.snapshot().vectors).toEqual({ move: { x: 0, y: -0.5, active: true }, aim: { x: 0, y: 0, active: false } })
    expect(touch.snapshot().vectors).toEqual({ move: { x: 0, y: -0.5, active: true }, aim: { x: 1, y: 0, active: true } })
    const moved = touch.snapshot()
    expect(moved.vectors).toEqual({ move: { x: 0, y: 0, active: false }, aim: { x: 1, y: 0, active: true } })
    expect(moved.used).toBe(true)
    expect(touch.snapshot().used).toBe(false)
    expect(touch.view().sticks).toEqual({ move: null, aim: null })
    expect(touch.view().layout.sticks.aim?.radius).toBe(1)
  })
})
