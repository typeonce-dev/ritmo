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
    releasePointerCapture: (id) => captured.splice(captured.indexOf(id), 1)
  }
  const blurHost: Pointer.BlurHost = { addEventListener: add, removeEventListener: remove }
  let prevented = 0
  const dispatch = (type: string, clientX: number, clientY: number, button = 0) => {
    for (const listener of listeners.get(type) ?? []) {
      listener({ clientX, clientY, button, pointerId: 1, preventDefault: () => prevented++ })
    }
  }
  return {
    target,
    blurHost,
    captured,
    prevented: () => prevented,
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

describe("Pointer.track", () => {
  it("reports element-relative positions and whether the pointer is over the element", () => {
    const fake = makeTarget()
    const pointer = Pointer.track(fake.target, fake.blurHost)

    expect(pointer.snapshot()).toEqual(Pointer.idle())
    fake.move(110, 70)
    expect(pointer.snapshot()).toMatchObject({ position: { x: 100, y: 50 }, over: true })
    fake.leave()
    expect(pointer.snapshot()).toMatchObject({ position: { x: 100, y: 50 }, over: false })
  })

  it("reports held state and press edges, keeping clicks shorter than a frame", () => {
    const fake = makeTarget()
    const pointer = Pointer.track(fake.target, fake.blurHost)

    fake.down(10, 20)
    expect(pointer.snapshot().primary).toEqual({ held: true, pressed: true, released: false })
    expect(pointer.snapshot().primary).toEqual({ held: true, pressed: false, released: false })
    fake.up(10, 20)
    expect(pointer.snapshot().primary).toEqual({ held: false, pressed: false, released: true })

    fake.down(10, 20, 2)
    fake.up(10, 20, 2)
    const click = pointer.snapshot()
    expect(click.secondary).toEqual({ held: false, pressed: true, released: true })
    expect(click.primary).toEqual({ held: false, pressed: false, released: false })
  })

  it("captures the pointer while a button is held and releases buttons on blur", () => {
    const fake = makeTarget()
    const pointer = Pointer.track(fake.target, fake.blurHost)

    fake.down(10, 20)
    expect(fake.captured).toEqual([1])
    fake.up(10, 20)
    expect(fake.captured).toEqual([])

    fake.down(10, 20)
    pointer.snapshot()
    fake.blur()
    expect(pointer.snapshot().primary).toEqual({ held: false, pressed: false, released: true })
  })

  it("suppresses the context menu by default and removes every listener on dispose", () => {
    const fake = makeTarget()
    const pointer = Pointer.track(fake.target, fake.blurHost)
    fake.contextMenu()
    expect(fake.prevented()).toBe(1)
    pointer.dispose()
    expect(fake.listenerCount()).toBe(0)

    const allowed = Pointer.track(fake.target, fake.blurHost, { preventContextMenu: false })
    fake.contextMenu()
    expect(fake.prevented()).toBe(1)
    allowed.dispose()
  })
})

describe("Pointer timelines", () => {
  it("plays moves, presses, and releases by snapshot index", () => {
    const pointer = Pointer.scripted([
      { frame: 0, move: { x: 5, y: 6 }, press: ["primary"] },
      { frame: 2, release: ["primary"] },
      { frame: 3, move: { x: 7, y: 8 }, press: ["secondary"], release: ["secondary"] }
    ])
    const snapshots = [0, 1, 2, 3].map(() => pointer.snapshot())

    expect(snapshots.map((snapshot) => snapshot.position)).toEqual([{ x: 5, y: 6 }, { x: 5, y: 6 }, { x: 5, y: 6 }, { x: 7, y: 8 }])
    expect(snapshots.map((snapshot) => snapshot.primary.held)).toEqual([true, true, false, false])
    expect(snapshots[2]!.primary.released).toBe(true)
    expect(snapshots[3]!.secondary).toEqual({ held: false, pressed: true, released: true })
    expect(pointer.frames()).toBe(4)
  })

  it("records a live session into a timeline that replays to the same snapshots", () => {
    const fake = makeTarget({ left: 0, top: 0 })
    const recorder = Pointer.recording(Pointer.track(fake.target, fake.blurHost))
    const live: Array<Pointer.Snapshot> = []
    fake.move(3, 4)
    live.push(recorder.snapshot())
    live.push(recorder.snapshot())
    fake.down(5, 6)
    live.push(recorder.snapshot())
    fake.up(5, 6)
    live.push(recorder.snapshot())

    const parsed = Pointer.parseTimeline(JSON.parse(JSON.stringify(recorder.timeline())))
    expect(parsed._tag).toBe("Success")
    if (parsed._tag === "Failure") return
    const replay = Pointer.scripted(parsed.success)
    const replayed = live.map(() => replay.snapshot())
    expect(replayed.map(({ over: _, ...rest }) => rest)).toEqual(live.map(({ over: _, ...rest }) => rest))
    recorder.dispose()
    expect(fake.listenerCount()).toBe(0)
  })

  it("rejects malformed timelines with a path", () => {
    expect(Pointer.parseTimeline([{ frame: 0, move: { x: "1", y: 2 } }])).toEqual({
      _tag: "Failure",
      failure: { _tag: "InvalidTimeline", path: "[0].move.x", message: "expected a finite number" }
    })
    expect(Pointer.parseTimeline([{ frame: 1, press: ["left"] }])).toMatchObject({
      _tag: "Failure",
      failure: { path: "[0].press[0]" }
    })
  })
})
