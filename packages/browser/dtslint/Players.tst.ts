import { Descriptor, Schema } from "@typeonce/ritmo"
import { Controls, Gamepad, InputCapture, Keyboard } from "@typeonce/ritmo-browser"
import * as Random from "@typeonce/ritmo-math/Random"
import { describe, expect, it } from "tstyche"

declare const host: Keyboard.KeyboardHost & Gamepad.GamepadHost

const Actions = Controls.actions({ buttons: ["join", "back", "jump"], vectors: ["move"] })
const leftKeys = { move: Keyboard.vector({ up: ["w"], down: ["s"], left: ["a"], right: ["d"] }), join: [" "], back: ["q"], jump: [" "] } as const
const rightKeys = { move: Keyboard.vector({ up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"] }), join: ["Enter"], back: ["Backspace"], jump: ["Enter"] } as const
const padKeys = { move: Gamepad.vector({ stick: "left" }), join: ["south"], back: ["east"], jump: ["south"] } as const
const Players = Controls.players(Actions, { slots: ["p1", "p2"], join: "join", leave: "back" })

const makePlayers = (devices: {
  readonly left: Keyboard.Actions<typeof leftKeys>
  readonly right: Keyboard.Actions<typeof rightKeys>
  readonly pads: Gamepad.Pads<typeof padKeys>
}) => Players.pool(devices)

describe("Controls.players", () => {
  it("types every slot by name, with device data behind a check of device", () => {
    const pool = makePlayers({ left: Keyboard.actions(host, leftKeys), right: Keyboard.actions(host, rightKeys), pads: Gamepad.pads(host, padKeys, 4) })
    const input = pool.snapshot()
    expect(input.joining).type.toBe<boolean>()
    expect(input.p2.joined).type.toBe<boolean>()
    expect(input.p2.device).type.toBe<"left" | "right" | "pads" | null>()
    expect(input.p2.event).type.toBe<"joined" | "left" | null>()
    expect(input.p2.vectors.move).type.toBe<Controls.Vector>()
    expect(input.p2.actions.jump).type.toBe<Controls.ActionState>()
    if (input.p2.device === "pads") expect(input.p2.devices.pads).type.toBe<Gamepad.Snapshot<typeof padKeys>>()
    if (input.p2.device === "left") expect(input.p2.devices.left).type.toBe<Keyboard.Snapshot<typeof leftKeys>>()
    // @ts-expect-error Property 'pads' does not exist
    input.p2.devices.pads
    // @ts-expect-error Property 'p3' does not exist
    input.p3
    expect(Players.slots).type.toBe<ReadonlyArray<"p1" | "p2">>()
  })

  it("leaves and rebinds by name", () => {
    const pool = makePlayers({ left: Keyboard.actions(host, leftKeys), right: Keyboard.actions(host, rightKeys), pads: Gamepad.pads(host, padKeys, 4) })
    expect(pool.leave).type.toBeCallableWith("p2")
    expect(pool.leave).type.not.toBeCallableWith("p3")
    expect(pool.rebind.pads).type.toBeCallableWith({ move: Gamepad.vector({ stick: "right" }), join: ["south"], back: ["east"], jump: ["west"] })
    // @ts-expect-error Property 'nope' does not exist
    pool.rebind.nope
  })

  it("seats by slot and pool name, a pad by its place", () => {
    const pool = makePlayers({ left: Keyboard.actions(host, leftKeys), right: Keyboard.actions(host, rightKeys), pads: Gamepad.pads(host, padKeys, 4) })
    expect(pool.seat("p1", "right")).type.toBe<Controls.SeatResult>()
    expect(pool.seat).type.toBeCallableWith("p2", { pads: 0 })
    expect(pool.seat).type.not.toBeCallableWith("p3", "right")
    expect(pool.seat).type.not.toBeCallableWith("p1", "mouse")
    expect(pool.seat).type.not.toBeCallableWith("p1", "pads")
    expect(pool.seat).type.not.toBeCallableWith("p1", { left: 0 })
  })

  it("requires the join action on every pooled device", () => {
    const noJoin = Keyboard.actions(host, { move: Keyboard.vector({ up: ["i"], down: ["k"], left: ["j"], right: ["l"] }), back: ["u"], jump: ["o"] })
    // @ts-expect-error right lacks join: every pooled device binds join, or no one can join with it
    Players.pool({ left: Keyboard.actions(host, leftKeys), right: Actions.lacking(noJoin, ["join"]) })
    const noJump = Keyboard.actions(host, { move: Keyboard.vector({ up: ["i"], down: ["k"], left: ["j"], right: ["l"] }), join: ["o"], back: ["u"] })
    expect(Players.pool({ left: Keyboard.actions(host, leftKeys), right: Actions.lacking(noJump, ["jump"]) }).snapshot().p1.available.jump).type.toBe<boolean>()
    // @ts-expect-error right has no action jump: bind it on right, or pass lacking(right, [...]) from the action set
    Players.pool({ left: Keyboard.actions(host, leftKeys), right: noJump })
  })

  it("checks the declaration", () => {
    // @ts-expect-error Type '"jion"' is not assignable
    Controls.players(Actions, { slots: ["p1"], join: "jion" })
    // @ts-expect-error Type '"move"' is not assignable
    Controls.players(Actions, { slots: ["p1"], join: "move" })
    // @ts-expect-error joining is the snapshot's own field: name the slot something else
    Controls.players(Actions, { slots: ["p1", "joining"], join: "join" })
    // @ts-expect-error Type '[]' is not assignable
    Controls.players(Actions, { slots: [], join: "join" })
    expect(Controls.players(Actions, { slots: ["p1"], join: "any" }).slots).type.toBe<ReadonlyArray<"p1">>()
    // @ts-expect-error an action named any reads as join
    Controls.players(Controls.actions({ buttons: ["any", "back"] }), { slots: ["p1"], join: "back" })
  })

  it("captures into a resource initialized with idle, and keeps snapshot() to the capture", () => {
    const PlayersInput = Descriptor.Service<ReturnType<typeof makePlayers>>()("PlayersTypes/Players")
    const Input = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof PlayersInput>>()("PlayersTypes/Input")
    const Game = Schema.bind(Schema.fragment({ resources: { Input } }))
    const pool = makePlayers({ left: Keyboard.actions(host, leftKeys), right: Keyboard.actions(host, rightKeys), pads: Gamepad.pads(host, padKeys, 2) })
    Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(PlayersInput, pool)),
      resources: { Input: Players.idle({ left: Keyboard.idle(leftKeys), right: Keyboard.idle(rightKeys), pads: Gamepad.idle(padKeys) }) }
    })
    Game.System("PlayersTypes/Lobby", { services: { players: Game.System.service(PlayersInput) } }, ({ services }) => {
      expect(services.players.setJoining).type.toBeCallableWith(true)
      // @ts-expect-error snapshot() drains PlayersTypes/Players
      services.players.snapshot()
    })
  })

  it("draws fuzzed player input seated on the pool's devices", () => {
    const random = Random.make(1)
    const devices = { left: Keyboard.idle(leftKeys), right: Keyboard.idle(rightKeys), pads: Gamepad.idle(padKeys) }
    expect(Players.random(random, 2, { devices, seats: { p1: "left" } })).type.toBe<ReturnType<typeof Players.idle<typeof devices>>>()
    expect(Players.random).type.toBeCallableWith(random, 2, { devices, seats: { p1: "left", p2: "pads" } })
    expect(Players.random).type.not.toBeCallableWith(random, 2, { devices, seats: { p1: "mouse" } })
    expect(Players.random).type.not.toBeCallableWith(random, 2, { devices, seats: { p3: "left" } })
  })
})
