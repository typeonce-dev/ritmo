import { describe, expect, it } from "vitest"

import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import { Controls, Gamepad, Keyboard } from "@typeonce/ritmo-browser"
import * as Random from "@typeonce/ritmo-math/Random"

const idle = { held: false, pressed: false, released: false }
const Actions = Controls.actions({ buttons: ["join", "back", "jump"], vectors: ["move"] })
const leftKeys = { move: Keyboard.vector({ up: ["w"], down: ["s"], left: ["a"], right: ["d"] }), join: [" "], back: ["q"], jump: [" "] } as const
const rightKeys = { move: Keyboard.vector({ up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"] }), join: ["Enter"], back: ["Backspace"], jump: ["Enter"] } as const
const padKeys = { move: Gamepad.vector({ stick: "left" }), join: ["south"], back: ["east"], jump: ["south"] } as const
const Players = Controls.players(Actions, { slots: ["p1", "p2"], join: "join", leave: "back" })

const tap = (frame: number, name: Keyboard.TimelineName<typeof leftKeys>) => ({ frame, press: [name], release: [name] })

describe("Controls.players", () => {
  it("joins the first free slot on a join press, with that snapshot idle", () => {
    const pool = Players.pool({
      left: Keyboard.scripted(leftKeys, [{ frame: 1, press: ["join", "jump"] }, { frame: 2, press: ["move.right"] }]),
      right: Keyboard.scripted(rightKeys, [{ frame: 3, press: ["join"], release: ["join"] }])
    })
    pool.setJoining(true)
    const before = pool.snapshot()
    expect(before.p1).toMatchObject({ joined: false, device: null, event: null })
    const joined = pool.snapshot()
    expect(joined.p1).toMatchObject({ joined: true, device: "left", connected: true, event: "joined" })
    // The space that joins is also jump: it does nothing else.
    expect(joined.p1.actions.jump).toEqual(idle)
    const walking = pool.snapshot()
    expect(walking.p1.event).toBe(null)
    expect(walking.p1.actions.jump).toEqual({ held: true, pressed: false, released: false })
    expect(walking.p1.vectors.move).toEqual({ x: 1, y: 0 })
    const second = pool.snapshot()
    expect(second.p2).toMatchObject({ joined: true, device: "right", event: "joined" })
    expect(second.joining).toBe(true)
  })

  it("ignores presses while joining is closed, a second join from a held device, and devices past the last slot", () => {
    const pool = Players.pool({
      left: Keyboard.scripted(leftKeys, [tap(0, "join"), tap(1, "join"), tap(2, "join")]),
      right: Keyboard.scripted(rightKeys, [{ frame: 3, press: ["join"], release: ["join"] }]),
      pads: Gamepad.scriptedPads(padKeys, [[{ frame: 3, press: ["south"] }]])
    })
    expect(pool.snapshot().p1.joined).toBe(false)
    pool.setJoining(true)
    expect(pool.snapshot().p1.device).toBe("left")
    expect(pool.snapshot().p2.joined).toBe(false)
    const full = pool.snapshot()
    expect([full.p1.device, full.p2.device]).toEqual(["left", "right"])
  })

  it("leaves by button only while joining is open, keeps slot names, and fills the gap first", () => {
    const pool = Players.pool({
      left: Keyboard.scripted(leftKeys, [tap(0, "join"), tap(2, "back"), tap(4, "join")]),
      right: Keyboard.scripted(rightKeys, [{ frame: 1, press: ["join"], release: ["join"] }])
    })
    pool.setJoining(true)
    pool.snapshot()
    pool.snapshot()
    const left = pool.snapshot()
    expect(left.p1).toMatchObject({ joined: false, event: "left" })
    expect(left.p2.device).toBe("right")
    pool.snapshot()
    expect(pool.snapshot().p1).toMatchObject({ device: "left", event: "joined" })
  })

  it("treats leave as an ordinary action while joining is closed, and frees a slot through leave(slot)", () => {
    const pool = Players.pool({ left: Keyboard.scripted(leftKeys, [tap(0, "join"), tap(1, "back")]), right: Keyboard.scripted(rightKeys, []) })
    pool.setJoining(true)
    pool.snapshot()
    pool.setJoining(false)
    const back = pool.snapshot()
    expect(back.p1.joined).toBe(true)
    expect(back.p1.actions.back.pressed).toBe(true)
    pool.leave("p1")
    expect(pool.snapshot().p1).toMatchObject({ joined: false, event: "left" })
    expect(pool.snapshot().p1.event).toBe(null)
  })

  it("joins on any button but leave with join: any", () => {
    const Drop = Controls.players(Actions, { slots: ["p1", "p2"], join: "any", leave: "back" })
    const pool = Drop.pool({ left: Keyboard.scripted(leftKeys, [tap(0, "back"), { frame: 1, press: ["move.up"] }]), right: Keyboard.scripted(rightKeys, []) })
    pool.setJoining(true)
    expect(pool.snapshot().p1.joined).toBe(false)
    const joined = pool.snapshot()
    expect(joined.p1).toMatchObject({ joined: true, event: "joined" })
    expect(joined.p1.vectors.move).toEqual({ x: 0, y: 0 })
    expect(pool.snapshot().p1.vectors.move).toEqual({ x: 0, y: -1 })
  })

  it("gives each pad its own slot, keeps it while unplugged, and returns the pad to it", () => {
    const pool = Players.pool({
      left: Keyboard.scripted(leftKeys, []),
      pads: Gamepad.scriptedPads(padKeys, [
        [{ frame: 0, press: ["south"], release: ["south"] }, { frame: 2, connected: false }, { frame: 4, connected: true, left: { x: 0, y: 1 } }],
        [{ frame: 1, press: ["south"], release: ["south"] }]
      ])
    })
    pool.setJoining(true)
    expect(pool.snapshot().p1.device).toBe("pads")
    const both = pool.snapshot()
    expect(both.p2).toMatchObject({ device: "pads", event: "joined" })
    const unplugged = pool.snapshot()
    expect(unplugged.p1).toMatchObject({ joined: true, connected: false })
    pool.snapshot()
    const back = pool.snapshot()
    expect(back.p1.connected).toBe(true)
    expect(back.p1.vectors.move).toEqual({ x: 0, y: 1 })
    if (back.p1.device === "pads") expect(back.p1.devices.pads.id).toBe("scripted 1")
  })

  it("seats a player without a press, joining or not, and refuses a held slot or device", () => {
    const pool = Players.pool({
      left: Keyboard.scripted(leftKeys, [{ frame: 1, press: ["jump"] }]),
      right: Keyboard.scripted(rightKeys, [{ frame: 1, press: ["join"], release: ["join"] }])
    })
    expect(pool.seat("p1", "left")).toEqual({ ok: true })
    expect(pool.seat("p1", "right")).toEqual({ ok: false, reason: "slot-taken" })
    expect(pool.seat("p2", "left")).toEqual({ ok: false, reason: "device-taken" })
    const seated = pool.snapshot()
    expect(seated.joining).toBe(false)
    expect(seated.p1).toMatchObject({ joined: true, device: "left", connected: true, event: "joined" })
    const playing = pool.snapshot()
    expect(playing.p1.event).toBe(null)
    expect(playing.p1.actions.jump.pressed).toBe(true)
    // Joining is still closed: the other keyboard's press does not join.
    expect(playing.p2.joined).toBe(false)
  })

  it("seats a pad by its place in the list, before it is plugged in", () => {
    const pool = Players.pool({
      left: Keyboard.scripted(leftKeys, []),
      pads: Gamepad.scriptedPads(padKeys, [[{ frame: 0, connected: false }, { frame: 2, connected: true, left: { x: 1, y: 0 } }]])
    })
    expect(pool.seat("p1", { pads: 1 })).toEqual({ ok: false, reason: "no-such-pad" })
    expect(pool.seat("p1", { pads: -1 })).toEqual({ ok: false, reason: "no-such-pad" })
    expect(pool.seat("p1", { pads: 0 })).toEqual({ ok: true })
    expect(pool.seat("p2", { pads: 0 })).toEqual({ ok: false, reason: "device-taken" })
    expect(pool.snapshot().p1).toMatchObject({ joined: true, device: "pads", connected: false, event: "joined" })
    pool.snapshot()
    const plugged = pool.snapshot()
    expect(plugged.p1.connected).toBe(true)
    expect(plugged.p1.vectors.move).toEqual({ x: 1, y: 0 })
  })

  it("reports a seated slot's join before a leave pressed on the same snapshot", () => {
    const pool = Players.pool({ left: Keyboard.scripted(leftKeys, [tap(0, "back")]), right: Keyboard.scripted(rightKeys, []) })
    pool.seat("p1", "left")
    pool.setJoining(true)
    expect(pool.snapshot().p1).toMatchObject({ joined: true, event: "joined" })
    expect(pool.snapshot().p1).toMatchObject({ joined: true, event: null })
  })

  it("tells two pads of one model apart by their place: neither takes the other's slot", () => {
    const base = Gamepad.scriptedPads(padKeys, [
      [{ frame: 0, press: ["south"], release: ["south"] }, { frame: 2, connected: false }],
      [{ frame: 1, press: ["south"], release: ["south"] }, { frame: 2, connected: false }, { frame: 3, connected: true }]
    ])
    // Both report the same id, as two controllers of one model do.
    const same = { ...base, snapshot: () => base.snapshot().map((pad) => ({ ...pad, id: "Xbox Controller" })) }
    const pool = Players.pool({ left: Keyboard.scripted(leftKeys, []), pads: same })
    pool.setJoining(true)
    pool.snapshot()
    pool.snapshot()
    pool.snapshot()
    const back = pool.snapshot()
    // The second pad came back: it is p2's again, and p1 waits for its own.
    expect(back.p1).toMatchObject({ joined: true, connected: false })
    expect(back.p2).toMatchObject({ joined: true, connected: true })
  })

  it("starts idle with every slot empty and joining closed", () => {
    expect(Players.idle({ left: Keyboard.idle(leftKeys), pads: Gamepad.idle(padKeys) })).toEqual({
      joining: false,
      p1: { joined: false, device: null, connected: false, event: null, devices: {}, actions: { join: idle, back: idle, jump: idle }, vectors: { move: { x: 0, y: 0 } }, available: { join: true, back: true, jump: true, move: true } },
      p2: { joined: false, device: null, connected: false, event: null, devices: {}, actions: { join: idle, back: idle, jump: idle }, vectors: { move: { x: 0, y: 0 } }, available: { join: true, back: true, jump: true, move: true } }
    })
  })

  it("lints keys two keyboards share, a device taken twice, gaps, and joining never opened", () => {
    const shared = Keyboard.scripted({ ...rightKeys, jump: [" "] }, [])
    const reused = Keyboard.scripted(leftKeys, [])
    Actions.merge({ keyboard: reused })
    const pool = Players.pool({ left: reused, right: Keyboard.scripted(rightKeys, []), other: shared })
    const PoolService = Descriptor.Service<typeof pool>()("PlayersTest/Pool")
    const Game = Schema.bind(Schema.fragment({}))
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(Game.Runtime.service(PoolService, pool)), resources: {}, debug: { hostClock: HostClock.test() } })
    if (!runtime.ok) throw new Error("runtime")
    const messages = runtime.value.debug.describe().lints.filter((lint) => lint.code === "service-lint").map((lint) => lint.message)
    expect(messages).toContain(`left and other both bind " ": one key press reaches two players`)
    expect(messages).toContain("left is taken by a Controls merge and a player pool: each takes its snapshots, so a press reaches one of them")
    expect(messages).toContain("joining was never opened in this session, so nobody could join")
  })

  it("draws fuzzed input for the seated players: joined on frame 1, then each frame's actions", () => {
    const devices = { left: Keyboard.idle(leftKeys), right: Keyboard.idle(rightKeys), pads: Gamepad.idle(padKeys) }
    const random = Random.make(4)
    const first = Players.random(random, 1, { devices, seats: { p1: "pads" } })
    expect(first.joining).toBe(false)
    expect(first.p1).toMatchObject({ joined: true, device: "pads", connected: true, event: "joined", devices: { pads: devices.pads } })
    expect(first.p1.actions.jump).toEqual(idle)
    expect(first.p1.vectors.move).toEqual({ x: 0, y: 0 })
    expect(first.p2).toMatchObject({ joined: false, device: null, event: null })
    const later = Array.from({ length: 50 }, (_, index) => Players.random(random, index + 2, { devices, seats: { p1: "pads" } }))
    for (const snapshot of later) {
      expect(snapshot.p1).toMatchObject({ joined: true, device: "pads", event: null })
      expect(Math.hypot(snapshot.p1.vectors.move.x, snapshot.p1.vectors.move.y)).toBeLessThanOrEqual(1 + 1e-9)
      expect(snapshot.p2.joined).toBe(false)
    }
    expect(later.some((snapshot) => snapshot.p1.actions.jump.pressed)).toBe(true)
  })
})
