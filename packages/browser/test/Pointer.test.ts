import { describe, expect, it } from "vitest"

import { Pointer } from "@typeonce/ritmo-browser"

const makeTarget = (rect = { left: 10, top: 20 }) => {
  const listeners = new Map<string, Set<(event?: any) => void>>()
  const captured: Array<number> = []
  const add = (type: string, listener: (event?: any) => void) => {
    const set = listeners.get(type) ?? new Set()
    set.add(listener)
    listeners.set(type, set)
  }
  const remove = (type: string, listener: (event?: any) => void) => {
    listeners.get(type)?.delete(listener)
  }
  const target: Pointer.PointerTarget = {
    addEventListener: add,
    removeEventListener: remove,
    getBoundingClientRect: () => rect,
    setPointerCapture: (id) => captured.push(id),
    releasePointerCapture: (id) => captured.splice(captured.indexOf(id), 1),
    requestPointerLock: () => {
      lockRequests++
    }
  }
  let lockRequests = 0
  const blurHost: Pointer.BlurHost = { addEventListener: add, removeEventListener: remove }
  let prevented = 0
  const dispatch = (type: string, clientX: number, clientY: number, button = 0) => {
    for (const listener of listeners.get(type) ?? []) {
      listener({ clientX, clientY, button, pointerId: 1, preventDefault: () => prevented++ })
    }
  }
  const lockListeners = new Set<() => void>()
  const lock = {
    pointerLockElement: null as unknown,
    addEventListener: (_type: "pointerlockchange", listener: () => void) => lockListeners.add(listener),
    removeEventListener: (_type: "pointerlockchange", listener: () => void) => lockListeners.delete(listener)
  }
  const setLocked = (locked: boolean) => {
    lock.pointerLockElement = locked ? target : null
    for (const listener of lockListeners) listener()
  }
  return {
    target,
    blurHost,
    lock,
    setLocked,
    lockRequests: () => lockRequests,
    lockListenerCount: () => lockListeners.size,
    captured,
    wheel: (deltaX: number, deltaY: number, deltaMode = 0) => {
      for (const listener of listeners.get("wheel") ?? []) listener({ deltaX, deltaY, deltaMode, preventDefault: () => prevented++ })
    },
    motion: (movementX: number, movementY: number) => {
      for (const listener of listeners.get("pointermove") ?? []) listener({ clientX: 10, clientY: 20, movementX, movementY, button: -1, pointerId: 1, preventDefault: () => {} })
    },
    prevented: () => prevented,
    /** A pointer event as browsers send it, with the `buttons` bitmask of what is down. */
    chord: (type: "pointerdown" | "pointermove" | "pointerup", button: number, buttons: number, pointerType = "mouse") => {
      for (const listener of listeners.get(type) ?? []) {
        listener({ clientX: 10, clientY: 20, button, buttons, pointerId: 1, pointerType, preventDefault: () => prevented++ })
      }
    },
    move: (x: number, y: number) => dispatch("pointermove", x, y),
    down: (x: number, y: number, button = 0) => dispatch("pointerdown", x, y, button),
    up: (x: number, y: number, button = 0) => dispatch("pointerup", x, y, button),
    leave: () => dispatch("pointerleave", 0, 0),
    contextMenu: () => dispatch("contextmenu", 0, 0),
    blur: () => {
      for (const listener of listeners.get("blur") ?? []) listener()
    },
    listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0)
  }
}

const bindings = { fire: ["primary"], aim: ["secondary", "back"] } as const

describe("Pointer.actions", () => {
  it("reports element-relative positions, whether the pointer is over the element, and movement as use", () => {
    const fake = makeTarget()
    const pointer = Pointer.actions(fake.target, fake.blurHost, bindings)

    expect(pointer.snapshot()).toEqual(Pointer.idle(bindings))
    fake.move(110, 70)
    expect(pointer.snapshot()).toMatchObject({ position: { x: 100, y: 50 }, over: true, used: true })
    expect(pointer.snapshot().used).toBe(false)
    fake.move(110, 70)
    expect(pointer.snapshot().used).toBe(false)
    fake.leave()
    expect(pointer.snapshot()).toMatchObject({ position: { x: 100, y: 50 }, over: false, used: false })
  })

  it("reports bound actions and raw buttons, keeping clicks shorter than a frame", () => {
    const fake = makeTarget()
    const pointer = Pointer.actions(fake.target, fake.blurHost, bindings)

    fake.down(10, 20)
    const pressed = pointer.snapshot()
    expect(pressed.actions.fire).toEqual({ held: true, pressed: true, released: false })
    expect(pressed.buttons.primary).toEqual({ held: true, pressed: true, released: false })
    expect(pressed.used).toBe(true)
    expect(pointer.snapshot().actions.fire).toEqual({ held: true, pressed: false, released: false })
    fake.up(10, 20)
    const released = pointer.snapshot()
    expect(released.actions.fire).toEqual({ held: false, pressed: false, released: true })
    expect(released.used).toBe(false)

    fake.down(10, 20, 2)
    fake.up(10, 20, 2)
    const click = pointer.snapshot()
    expect(click.actions.aim).toEqual({ held: false, pressed: true, released: true })
    expect(click.buttons.secondary).toEqual({ held: false, pressed: true, released: true })
    expect(click.actions.fire).toEqual({ held: false, pressed: false, released: false })
  })

  it("reads the side buttons", () => {
    const fake = makeTarget()
    const pointer = Pointer.actions(fake.target, fake.blurHost, bindings)
    fake.down(10, 20, 3)
    const back = pointer.snapshot()
    expect(back.buttons.back.held).toBe(true)
    expect(back.actions.aim.held).toBe(true)
    fake.down(10, 20, 4)
    expect(pointer.snapshot().buttons.forward.pressed).toBe(true)
  })

  it("rebinds the same actions, releasing an action held only through a button it lost", () => {
    const fake = makeTarget()
    const pointer = Pointer.actions(fake.target, fake.blurHost, bindings)
    fake.down(10, 20)
    pointer.snapshot()
    pointer.rebind({ fire: ["middle"], aim: ["primary"] })
    const after = pointer.snapshot()
    expect(after.actions.fire).toEqual({ held: false, pressed: false, released: true })
    // The held button holds its new action only once pressed again.
    expect(after.actions.aim.held).toBe(false)
    fake.down(10, 20, 1)
    expect(pointer.snapshot().actions.fire.pressed).toBe(true)
  })

  it("captures the pointer while a button is held and releases buttons on blur", () => {
    const fake = makeTarget()
    const pointer = Pointer.actions(fake.target, fake.blurHost, bindings)

    fake.down(10, 20)
    expect(fake.captured).toEqual([1])
    fake.up(10, 20)
    expect(fake.captured).toEqual([])

    fake.down(10, 20)
    pointer.snapshot()
    fake.blur()
    const blurred = pointer.snapshot()
    expect(blurred.actions.fire).toEqual({ held: false, pressed: false, released: true })
    expect(blurred.used).toBe(false)
  })

  it("suppresses the context menu by default and removes every listener on dispose", () => {
    const fake = makeTarget()
    const pointer = Pointer.actions(fake.target, fake.blurHost, bindings)
    fake.contextMenu()
    expect(fake.prevented()).toBe(1)
    pointer.dispose()
    expect(fake.listenerCount()).toBe(0)

    const allowed = Pointer.actions(fake.target, fake.blurHost, bindings, { preventContextMenu: false })
    fake.contextMenu()
    expect(fake.prevented()).toBe(1)
    allowed.dispose()
  })

  it("tracks the position and raw buttons alone with no bindings", () => {
    const fake = makeTarget()
    const pointer = Pointer.actions(fake.target, fake.blurHost, {})
    fake.down(10, 20, 1)
    expect(pointer.snapshot()).toMatchObject({ actions: {}, position: { x: 0, y: 0 }, used: true })
  })
})

describe("Pointer chords", () => {
  // `buttons` bits: 1 primary, 2 secondary, 4 middle. `button`: 0 primary, 1 middle, 2 secondary.
  const chordBindings = { fire: ["primary"], aim: ["secondary"], zoom: ["middle"] } as const
  const idle = { held: false, pressed: false, released: false }

  it("presses a button that goes down while another is held, which arrives as a pointermove", () => {
    const fake = makeTarget()
    const mouse = Pointer.actions(fake.target, fake.blurHost, chordBindings)
    fake.chord("pointerdown", 2, 2)
    expect(mouse.snapshot().actions.aim).toEqual({ held: true, pressed: true, released: false })
    fake.chord("pointermove", 0, 3)
    const chorded = mouse.snapshot()
    expect(chorded.actions.fire).toEqual({ held: true, pressed: true, released: false })
    expect(chorded.actions.aim).toEqual({ held: true, pressed: false, released: false })
    fake.chord("pointermove", 0, 2)
    expect(mouse.snapshot().actions.fire).toEqual({ held: false, pressed: false, released: true })
    fake.chord("pointerup", 2, 0)
    expect(mouse.snapshot().actions.aim).toEqual({ held: false, pressed: false, released: true })
    expect(fake.captured).toEqual([])
  })

  it("releases the first button let go while another is held, so it does not stay stuck", () => {
    const fake = makeTarget()
    const mouse = Pointer.actions(fake.target, fake.blurHost, chordBindings)
    fake.chord("pointerdown", 0, 1)
    fake.chord("pointermove", 2, 3)
    expect(mouse.snapshot().actions).toMatchObject({ fire: { held: true }, aim: { held: true } })
    fake.chord("pointermove", 0, 2)
    expect(mouse.snapshot().actions.fire).toEqual({ held: false, pressed: false, released: true })
    // The last button up is a pointerup for the other button.
    fake.chord("pointerup", 2, 0)
    const after = mouse.snapshot()
    expect(after.actions.aim).toEqual({ held: false, pressed: false, released: true })
    expect(mouse.snapshot().actions).toEqual({ fire: idle, aim: idle, zoom: idle })
    expect(fake.captured).toEqual([])
  })

  it("tracks three buttons, capturing the pointer once and releasing it when none is held", () => {
    const fake = makeTarget()
    const mouse = Pointer.actions(fake.target, fake.blurHost, chordBindings)
    fake.chord("pointerdown", 0, 1)
    fake.chord("pointermove", 2, 3)
    fake.chord("pointermove", 1, 7)
    const all = mouse.snapshot()
    expect(all.buttons.middle).toEqual({ held: true, pressed: true, released: false })
    expect(all.actions).toMatchObject({ fire: { held: true }, aim: { held: true }, zoom: { held: true } })
    expect(fake.captured).toEqual([1])
    fake.chord("pointermove", 2, 5)
    fake.chord("pointermove", 0, 4)
    const middle = mouse.snapshot()
    expect(middle.actions).toMatchObject({ fire: { released: true }, aim: { released: true }, zoom: { held: true, pressed: false } })
    expect(fake.captured).toEqual([1])
    fake.chord("pointerup", 1, 0)
    expect(mouse.snapshot().actions.zoom.released).toBe(true)
    expect(fake.captured).toEqual([])
  })

  it("keeps a tap of a second button shorter than a frame, reporting it once", () => {
    const fake = makeTarget()
    const mouse = Pointer.actions(fake.target, fake.blurHost, chordBindings)
    fake.chord("pointerdown", 0, 1)
    mouse.snapshot()
    fake.chord("pointermove", 2, 3)
    fake.chord("pointermove", 2, 1)
    fake.chord("pointermove", -1, 1)
    const tap = mouse.snapshot()
    expect(tap.actions.aim).toEqual({ held: false, pressed: true, released: true })
    expect(tap.buttons.secondary).toEqual({ held: false, pressed: true, released: true })
    expect(tap.actions.fire).toEqual({ held: true, pressed: false, released: false })
    expect(mouse.snapshot().actions.aim).toEqual(idle)
  })

  it("chords while the pointer is locked, and the click that locks stays no press while it is held", () => {
    const fake = makeTarget()
    const mouse = Pointer.actions(fake.target, fake.blurHost, chordBindings, { lock: fake.lock })
    fake.chord("pointerdown", 0, 1)
    expect(fake.lockRequests()).toBe(1)
    // Locked while the click that asked for it is still down.
    fake.setLocked(true)
    fake.chord("pointermove", -1, 1)
    expect(mouse.snapshot().actions.fire).toEqual(idle)
    fake.chord("pointermove", 2, 3)
    expect(mouse.snapshot().actions).toMatchObject({ fire: idle, aim: { held: true, pressed: true } })
    fake.chord("pointermove", 2, 1)
    fake.chord("pointerup", 0, 0)
    expect(mouse.snapshot().actions).toMatchObject({ fire: idle, aim: { released: true } })

    fake.chord("pointerdown", 0, 1)
    fake.chord("pointermove", 2, 3)
    expect(mouse.snapshot().actions).toMatchObject({ fire: { held: true, pressed: true }, aim: { held: true, pressed: true } })
    fake.chord("pointermove", 0, 2)
    fake.chord("pointerup", 2, 0)
    expect(mouse.snapshot().actions).toMatchObject({ fire: { released: true }, aim: { released: true } })
    expect(fake.lockRequests()).toBe(1)
  })

  it("presses nothing while the pointer is not locked, chorded buttons included", () => {
    const fake = makeTarget()
    const mouse = Pointer.actions(fake.target, fake.blurHost, chordBindings, { lock: fake.lock })
    fake.chord("pointerdown", 0, 1)
    fake.chord("pointermove", 2, 3)
    expect(mouse.snapshot().actions).toEqual({ fire: idle, aim: idle, zoom: idle })
    fake.chord("pointermove", 0, 2)
    fake.chord("pointerup", 2, 0)
    expect(mouse.snapshot().actions).toEqual({ fire: idle, aim: idle, zoom: idle })
  })

  it("presses a button still down after a blur again on the next event that reports it", () => {
    const fake = makeTarget()
    const mouse = Pointer.actions(fake.target, fake.blurHost, chordBindings)
    fake.chord("pointerdown", 0, 1)
    mouse.snapshot()
    fake.blur()
    expect(mouse.snapshot().actions.fire.released).toBe(true)
    fake.chord("pointermove", -1, 1)
    expect(mouse.snapshot().actions.fire).toEqual({ held: true, pressed: true, released: false })
    fake.chord("pointerup", 0, 0)
    expect(mouse.snapshot().actions.fire.released).toBe(true)
  })

  it("reads a pen's tip and barrel button as primary and secondary, and ignores its eraser", () => {
    const fake = makeTarget()
    const pen = Pointer.actions(fake.target, fake.blurHost, chordBindings)
    // Tip down, barrel button pressed, then the eraser (button 5, bit 32) flipped on.
    fake.chord("pointerdown", 0, 1, "pen")
    fake.chord("pointermove", 2, 3, "pen")
    fake.chord("pointermove", 5, 35, "pen")
    expect(pen.snapshot().actions).toMatchObject({ fire: { held: true }, aim: { held: true }, zoom: idle })
    fake.chord("pointerup", 0, 0, "pen")
    expect(pen.snapshot().actions).toMatchObject({ fire: { released: true }, aim: { released: true } })
    // Touches are left to Touch: their buttons press nothing.
    fake.chord("pointerdown", 0, 1, "touch")
    expect(pen.snapshot().actions.fire).toEqual(idle)
  })

  it("keeps a host that sends no buttons working as before: a chord reaches it only as downs and ups", () => {
    const fake = makeTarget()
    const mouse = Pointer.actions(fake.target, fake.blurHost, chordBindings)
    fake.down(10, 20, 2)
    fake.down(10, 20, 0)
    fake.move(12, 22)
    expect(mouse.snapshot().actions).toMatchObject({ fire: { held: true, pressed: true }, aim: { held: true, pressed: true } })
    fake.up(10, 20, 2)
    expect(mouse.snapshot().actions).toMatchObject({ fire: { held: true, pressed: false }, aim: { released: true } })
    expect(fake.captured.length).toBeGreaterThan(0)
    fake.up(10, 20, 0)
    expect(mouse.snapshot().actions.fire.released).toBe(true)
    expect(fake.captured).toEqual([])
  })
})

describe("Pointer wheel", () => {
  const wheelBindings = { next: ["wheelDown"], previous: ["wheelUp"] } as const

  it("reports how far the wheel scrolled and pulses once per notch", () => {
    const fake = makeTarget()
    const pointer = Pointer.actions(fake.target, fake.blurHost, wheelBindings)
    fake.wheel(0, 100)
    const notch = pointer.snapshot()
    expect(notch.wheel).toEqual({ x: 0, y: 100 })
    expect(notch.actions.next).toEqual({ held: false, pressed: true, released: true })
    expect(notch.buttons.wheelDown).toEqual({ held: false, pressed: true, released: true })
    expect(notch.used).toBe(true)
    expect(fake.prevented()).toBe(1)
    const after = pointer.snapshot()
    expect(after.wheel).toEqual({ x: 0, y: 0 })
    expect(after.actions.next.pressed).toBe(false)
    expect(after.used).toBe(false)
  })

  it("adds up small scrolls toward a pulse, starting over when the direction turns", () => {
    const fake = makeTarget()
    const pointer = Pointer.actions(fake.target, fake.blurHost, wheelBindings)
    fake.wheel(0, 60)
    expect(pointer.snapshot().actions.next.pressed).toBe(false)
    fake.wheel(0, 60)
    expect(pointer.snapshot().actions.next.pressed).toBe(true)
    fake.wheel(0, -30)
    fake.wheel(0, -80)
    const turned = pointer.snapshot()
    expect(turned.actions.previous.pressed).toBe(true)
    expect(turned.wheel).toEqual({ x: 0, y: -110 })
  })

  it("reads lines and pages as pixels, horizontal scrolls as wheelLeft and wheelRight", () => {
    const fake = makeTarget()
    const pointer = Pointer.actions(fake.target, fake.blurHost, {}, { preventScroll: false })
    fake.wheel(-7, 3, 1)
    const lines = pointer.snapshot()
    expect(lines.wheel).toEqual({ x: -112, y: 48 })
    expect(lines.buttons.wheelLeft.pressed).toBe(true)
    expect(lines.buttons.wheelDown.pressed).toBe(false)
    expect(fake.prevented()).toBe(0)
    fake.wheel(0, 1, 2)
    expect(pointer.snapshot().wheel).toEqual({ x: 0, y: 800 })
  })
})

describe("Pointer lock", () => {
  it("locks on a click that is not reported as a press, then reports raw motion while locked", () => {
    const fake = makeTarget()
    const pointer = Pointer.actions(fake.target, fake.blurHost, bindings, { lock: fake.lock })
    fake.down(10, 20)
    expect(fake.lockRequests()).toBe(1)
    const resume = pointer.snapshot()
    expect(resume.actions.fire.pressed).toBe(false)
    expect(resume.locked).toBe(false)
    fake.up(10, 20)
    fake.setLocked(true)
    fake.motion(5, -2)
    fake.motion(1, 1)
    const looking = pointer.snapshot()
    expect(looking).toMatchObject({ locked: true, over: true, movement: { x: 6, y: -1 }, used: true })
    fake.down(10, 20)
    expect(fake.lockRequests()).toBe(1)
    expect(pointer.snapshot().actions.fire.pressed).toBe(true)
  })

  it("releases what was held when the lock ends, and removes the lock listener on dispose", () => {
    const fake = makeTarget()
    const pointer = Pointer.actions(fake.target, fake.blurHost, bindings, { lock: fake.lock })
    fake.setLocked(true)
    fake.down(10, 20)
    pointer.snapshot()
    fake.setLocked(false)
    const unlocked = pointer.snapshot()
    expect(unlocked.locked).toBe(false)
    expect(unlocked.actions.fire).toEqual({ held: false, pressed: false, released: true })
    pointer.dispose()
    expect(fake.listenerCount()).toBe(0)
    expect(fake.lockListenerCount()).toBe(0)
  })

  it("reports raw motion without a lock too, and never locks without the option", () => {
    const fake = makeTarget()
    const pointer = Pointer.actions(fake.target, fake.blurHost, bindings)
    fake.motion(3, 4)
    expect(pointer.snapshot()).toMatchObject({ movement: { x: 3, y: 4 }, locked: false })
    fake.down(10, 20)
    expect(fake.lockRequests()).toBe(0)
  })
})

describe("Pointer.parseRebinding", () => {
  it("accepts exactly the actions of the bindings, each with known buttons", () => {
    expect(Pointer.parseRebinding(bindings, { fire: ["forward"], aim: ["primary"] })).toEqual({
      ok: true,
      value: { fire: ["forward"], aim: ["primary"] }
    })
    expect(Pointer.parseRebinding(bindings, { fire: ["left"], aim: ["primary"] })).toMatchObject({ ok: false, error: { path: "fire[0]" } })
    expect(Pointer.parseRebinding(bindings, { fire: ["primary"] })).toMatchObject({ ok: false, error: { path: "aim" } })
    expect(Pointer.parseRebinding(bindings, { fire: ["primary"], aim: ["primary"], jump: ["primary"] })).toMatchObject({ ok: false, error: { path: "jump" } })
  })
})

describe("Pointer timelines", () => {
  it("plays moves, presses, and releases by snapshot index through the bindings", () => {
    const pointer = Pointer.scripted(bindings, [
      { frame: 0, move: { x: 5, y: 6 }, press: ["primary"] },
      { frame: 2, release: ["primary"] },
      { frame: 3, move: { x: 7, y: 8 }, press: ["secondary"], release: ["secondary"] }
    ])
    const snapshots = [0, 1, 2, 3].map(() => pointer.snapshot())

    expect(snapshots.map((snapshot) => snapshot.position)).toEqual([{ x: 5, y: 6 }, { x: 5, y: 6 }, { x: 5, y: 6 }, { x: 7, y: 8 }])
    expect(snapshots.map((snapshot) => snapshot.actions.fire.held)).toEqual([true, true, false, false])
    expect(snapshots.map((snapshot) => snapshot.used)).toEqual([true, true, false, true])
    expect(snapshots[2]!.actions.fire.released).toBe(true)
    expect(snapshots[3]!.actions.aim).toEqual({ held: false, pressed: true, released: true })
    expect(pointer.frames()).toBe(4)
  })

  it("plays wheel, raw motion, and the lock", () => {
    const pointer = Pointer.scripted({ next: ["wheelDown"], fire: ["primary"] }, [
      { frame: 0, wheel: { x: 0, y: 250 } },
      { frame: 1, locked: true, movement: { x: 4, y: 0 }, press: ["primary"] },
      { frame: 2, locked: false }
    ])
    const [scrolled, looking, unlocked] = [0, 1, 2].map(() => pointer.snapshot())
    expect(scrolled!.wheel).toEqual({ x: 0, y: 250 })
    expect(scrolled!.actions.next.pressed).toBe(true)
    expect(looking).toMatchObject({ locked: true, movement: { x: 4, y: 0 } })
    expect(unlocked!.locked).toBe(false)
    expect(unlocked!.actions.fire).toEqual({ held: false, pressed: false, released: true })
  })

  it("records a live session into a timeline that replays to the same snapshots", () => {
    const fake = makeTarget({ left: 0, top: 0 })
    const recorder = Pointer.recording(Pointer.actions(fake.target, fake.blurHost, { ...bindings, next: ["wheelDown"] }, { lock: fake.lock }))
    const live: Array<Pointer.Snapshot<typeof bindings & { readonly next: readonly ["wheelDown"] }>> = []
    fake.move(3, 4)
    live.push(recorder.snapshot())
    live.push(recorder.snapshot())
    fake.wheel(0, 140)
    live.push(recorder.snapshot())
    fake.setLocked(true)
    fake.down(5, 6)
    fake.motion(2, 2)
    live.push(recorder.snapshot())
    fake.up(5, 6)
    fake.setLocked(false)
    live.push(recorder.snapshot())

    const parsed = Pointer.parseTimeline(JSON.parse(JSON.stringify(recorder.timeline())))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const replay = Pointer.scripted({ ...bindings, next: ["wheelDown"] }, parsed.value)
    const replayed = live.map(() => replay.snapshot())
    expect(replayed.map(({ over: _, ...rest }) => rest)).toEqual(live.map(({ over: _, ...rest }) => rest))
    recorder.dispose()
    expect(fake.listenerCount()).toBe(0)
  })

  it("rejects malformed timelines with a path", () => {
    expect(Pointer.parseTimeline([{ frame: 0, move: { x: "1", y: 2 } }])).toEqual({
      ok: false,
      error: { _tag: "InvalidTimeline", path: "[0].move.x", message: "expected a finite number" }
    })
    expect(Pointer.parseTimeline([{ frame: 1, press: ["left"] }])).toMatchObject({
      ok: false,
      error: { path: "[0].press[0]" }
    })
    // Wheel pulses come from wheel, not from press.
    expect(Pointer.parseTimeline([{ frame: 1, press: ["wheelUp"] }])).toMatchObject({ ok: false, error: { path: "[0].press[0]" } })
    expect(Pointer.parseTimeline([{ frame: 1, wheel: { x: 0, y: Infinity } }])).toMatchObject({ ok: false, error: { path: "[0].wheel.y" } })
    expect(Pointer.parseTimeline([{ frame: 1, locked: "yes" }])).toMatchObject({ ok: false, error: { path: "[0].locked" } })
  })
})
