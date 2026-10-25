import { Descriptor, Schema } from "@typeonce/ritmo"
import type { Descriptor as DescriptorOf } from "@typeonce/ritmo/Descriptor"
import { Controls, Gamepad, InputCapture, Keyboard, Pointer, Touch } from "@typeonce/ritmo-browser"
import * as Random from "@typeonce/ritmo/Random"
import { describe, expect, it } from "tstyche"

declare const host: Keyboard.KeyboardHost & Gamepad.GamepadHost
declare const touch: Touch.Actions<"jump">
declare const canvas: Pointer.PointerTarget

const keyBindings = { jump: [" "], pause: ["Escape"] } as const
const padBindings = { jump: ["south"], pause: ["start"] } as const
const Actions = Controls.actions({ buttons: ["jump", "pause"] })

const keyboard = Keyboard.actions(host, keyBindings)
const gamepad = Gamepad.actions(host, padBindings)
const mouseBindings = { jump: ["primary"] } as const
const mouse = Pointer.actions(canvas, window, mouseBindings)
const keysWithoutPause = Keyboard.actions(host, { jump: [" "] })

describe("Controls", () => {
  it("types merged actions by the declared names", () => {
    const input = Actions.merge({ keyboard, gamepad }).snapshot()
    expect(input.actions.jump).type.toBe<Controls.ActionState>()
    expect(input.available.pause).type.toBe<boolean>()
    expect(Actions.buttons).type.toBe<ReadonlyArray<"jump" | "pause">>()
    // @ts-expect-error Property 'junp' does not exist
    input.actions.junp
  })

  it("keys devices, lastUsed, and rebind by the merge names", () => {
    const controls = Actions.merge({ keyboard, gamepad, touch: Actions.lacking(touch, ["pause"]) })
    const input = controls.snapshot()
    expect(input.devices.gamepad).type.toBe<Gamepad.Snapshot<typeof padBindings>>()
    expect(input.devices.keyboard).type.toBe<Keyboard.Snapshot<typeof keyBindings>>()
    expect(input.devices.touch).type.toBe<Touch.Snapshot<"jump">>()
    expect(input.lastUsed).type.toBe<"keyboard" | "gamepad" | "touch" | null>()
    expect(controls.rebind.gamepad).type.toBeCallableWith({ jump: ["east"], pause: ["start"] })
    expect(controls.rebind.keyboard).type.toBeCallableWith({ jump: [Keyboard.code("KeyJ")], pause: ["Escape"] })
    expect(controls.rebind.keyboard).type.not.toBeCallableWith({ jump: ["j"] })
    // @ts-expect-error Property 'mouse' does not exist
    input.devices.mouse
    // @ts-expect-error Property 'touch' does not exist
    controls.rebind.touch
  })

  it("does not let a device report an action it lacks", () => {
    const input = Actions.merge({ keyboard, touch: Actions.lacking(touch, ["pause"]) }).snapshot()
    expect(input.devices.touch.actions.jump.aim).type.toBe<Controls.Vector | null>()
    // @ts-expect-error Property 'pause' does not exist
    input.devices.touch.actions.pause
  })

  it("requires every device to bind every action, or to name what it lacks", () => {
    // @ts-expect-error touch has no action pause: bind it on touch, or pass lacking(touch, [...]) from the action set
    Actions.merge({ keyboard, touch })
    const typo = Gamepad.actions(host, { jmup: ["south"], pause: ["start"] })
    // @ts-expect-error gamepad binds jmup, which is not one of the actions
    Actions.merge({ keyboard, gamepad: typo })
  })

  it("requires lacking to name exactly the missing actions", () => {
    expect(Actions.lacking(touch, ["pause"])).type.toBe<Controls.Lacking<Touch.Actions<"jump">, "pause">>()
    // @ts-expect-error This device also lacks pause: bind it, or list it here
    Actions.lacking(touch, [])
    // @ts-expect-error Type '"paus"' is not assignable to type '"pause"'
    Actions.lacking(touch, ["paus"])
    // @ts-expect-error Type '"jump"' is not assignable to type '"pause"'
    Actions.lacking(touch, ["pause", "jump"])
    // @ts-expect-error This device binds every action: pass it to merge without lacking
    Actions.lacking(keyboard, [])
    const typo = Gamepad.actions(host, { jmup: ["south"] })
    // @ts-expect-error This device binds jmup, which is not one of the actions
    Actions.lacking(typo, ["pause"])
  })

  it("requires some device to bind every action", () => {
    const keysWithoutPause = Keyboard.actions(host, { jump: [" "] })
    // @ts-expect-error no device binds pause: bind it on one device, or remove it from Controls.actions
    Actions.merge({ keyboard: Actions.lacking(keysWithoutPause, ["pause"]), touch: Actions.lacking(touch, ["pause"]) })
  })

  it("captures into a resource declared from the service, initialized with idle", () => {
    const makeControls = (devices: {
      readonly keyboard: Keyboard.Actions<typeof keyBindings>
      readonly gamepad: Gamepad.Actions<typeof padBindings>
    }) => Actions.merge(devices)
    const ControlsInput = Descriptor.Service<ReturnType<typeof makeControls>>()("ControlsTypes/Controls")
    const Input = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof ControlsInput>>()("ControlsTypes/Input")
    const Game = Schema.bind(Schema.fragment({ resources: { Input } }))
    const Capture = InputCapture.system(Game, { name: "ControlsTypes/Capture", source: ControlsInput, resource: Input })
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(ControlsInput, makeControls({ keyboard, gamepad }))),
      resources: { Input: Actions.idle({ keyboard: Keyboard.idle(keyBindings), gamepad: Gamepad.idle(padBindings) }) }
    }).value
    expect(runtime.tick(Game.Schedule(Capture)).ok).type.toBe<boolean>()
    Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(ControlsInput, makeControls({ keyboard, gamepad }))),
      // @ts-expect-error Property 'gamepad' is missing
      resources: { Input: Actions.idle({ keyboard: Keyboard.idle(keyBindings) }) }
    })
  })

  it("rejects snapshot() through a plain service, and keeps the other methods", () => {
    const makeControls = (devices: { readonly keyboard: Keyboard.Actions<typeof keyBindings> }) => Actions.merge(devices)
    const ControlsInput = Descriptor.Service<ReturnType<typeof makeControls>>()("ControlsTypes/Plain")
    const Game = Schema.bind(Schema.fragment({}))
    Game.System("ControlsTypes/Settings", { services: { controls: Game.System.service(ControlsInput) } }, ({ services }) => {
      expect(services.controls.rebind.keyboard({ jump: ["w"], pause: ["p"] })).type.toBe<void>()
      // @ts-expect-error snapshot() drains ControlsTypes/Plain: declare it with Game.System.consumeService, or read the resource its capture writes
      services.controls.snapshot()
    })
    Game.System("ControlsTypes/Drain", { services: { controls: Game.System.consumeService(ControlsInput) } }, ({ services }) => {
      expect(services.controls.snapshot().actions.jump.pressed).type.toBe<boolean>()
    })
    const KeysInput = Descriptor.Service<Keyboard.Actions<typeof keyBindings>>()("ControlsTypes/Keys")
    Game.System("ControlsTypes/Keys", { services: { keys: Game.System.service(KeysInput) } }, ({ services }) => {
      // @ts-expect-error snapshot() drains ControlsTypes/Keys
      services.keys.snapshot()
    })
  })


  it("groups devices into one entry: lastUsed by entry, devices and rebind by device", () => {
    const controls = Actions.merge({ desktop: Actions.group({ keyboard, mouse }), gamepad, touch: Actions.lacking(touch, ["pause"]) })
    const input = controls.snapshot()
    expect(input.lastUsed).type.toBe<"desktop" | "gamepad" | "touch" | null>()
    expect(input.devices.mouse).type.toBe<Pointer.Snapshot<typeof mouseBindings>>()
    expect(input.devices.mouse.position).type.toBe<Pointer.Position>()
    expect(input.devices.keyboard).type.toBe<Keyboard.Snapshot<typeof keyBindings>>()
    expect(controls.rebind.mouse).type.toBeCallableWith({ jump: ["back"] })
    expect(controls.rebind.mouse).type.not.toBeCallableWith({ jump: ["left"] })
    // @ts-expect-error Property 'desktop' does not exist
    input.devices.desktop
    // @ts-expect-error Property 'desktop' does not exist
    controls.rebind.desktop
  })

  it("checks a group as one device in the merge", () => {
    // @ts-expect-error desktop has no action pause: bind it on desktop, or pass lacking(desktop, [...]) from the action set
    Actions.merge({ desktop: Actions.group({ keyboard: keysWithoutPause, mouse }), gamepad })
    const desktop = Actions.lacking(Actions.group({ keyboard: keysWithoutPause, mouse }), ["pause"])
    expect(Actions.merge({ desktop, gamepad }).snapshot().lastUsed).type.toBe<"desktop" | "gamepad" | null>()
    // @ts-expect-error This device also lacks pause: bind it, or list it here
    Actions.lacking(Actions.group({ keyboard: keysWithoutPause, mouse }), [])
  })

  it("rejects groups that are not two or more plain devices of the declared actions", () => {
    // @ts-expect-error a group needs at least two devices: pass keyboard to merge directly
    Actions.group({ keyboard })
    // @ts-expect-error lacking applies to the whole group: pass lacking(group(...), [...])
    Actions.group({ keyboard, touch: Actions.lacking(touch, ["pause"]) })
    // @ts-expect-error groups do not nest: list every device in one group
    Actions.group({ desktop: Actions.group({ keyboard, mouse }), gamepad })
    const extra = Pointer.actions(canvas, window, { jump: ["primary"], fire: ["secondary"] })
    // @ts-expect-error mouse binds fire, which is not one of the actions
    Actions.group({ keyboard, mouse: extra })
  })

  it("rejects a name used twice across groups and devices", () => {
    const fullMouse = Pointer.actions(canvas, window, { jump: ["primary"], pause: ["middle"] })
    // @ts-expect-error the name mouse is used twice: give every device and group its own name
    Actions.merge({ desktop: Actions.group({ keyboard, mouse }), mouse: fullMouse })
    // @ts-expect-error the name keyboard is used twice
    Actions.merge({ keyboard: Actions.group({ keyboard, mouse }), gamepad })
  })

  it("initializes a grouped merge by device names", () => {
    const makeControls = (devices: { readonly keyboard: Keyboard.Actions<typeof keyBindings>; readonly mouse: Pointer.Actions<typeof mouseBindings> }) =>
      Actions.merge({ desktop: Actions.group(devices), gamepad })
    const ControlsInput = Descriptor.Service<ReturnType<typeof makeControls>>()("ControlsTypes/Grouped")
    const Input = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof ControlsInput>>()("ControlsTypes/GroupedInput")
    const Game = Schema.bind(Schema.fragment({ resources: { Input } }))
    const services = Game.Runtime.services(Game.Runtime.service(ControlsInput, makeControls({ keyboard, mouse })))
    const idle = Actions.idle({ keyboard: Keyboard.idle(keyBindings), mouse: Pointer.idle(mouseBindings), gamepad: Gamepad.idle(padBindings) })
    Game.Runtime.make({ services, resources: { Input: idle } })
    Game.Runtime.make({
      services,
      // @ts-expect-error Property 'mouse' is missing
      resources: { Input: Actions.idle({ keyboard: Keyboard.idle(keyBindings), gamepad: Gamepad.idle(padBindings) }) }
    })
  })

  it("declares vector actions next to buttons, and checks each device binds each with its kind", () => {
    const Moving = Controls.actions({ buttons: ["jump"], vectors: ["move"] })
    const keys = Keyboard.actions(host, { move: Keyboard.vector({ up: ["w"], down: ["s"], left: ["a"], right: ["d"] }), jump: [" "] })
    const pad = Gamepad.actions(host, { move: Gamepad.vector({ stick: "left" }), jump: ["south"] })
    const input = Moving.merge({ keyboard: keys, gamepad: pad }).snapshot()
    expect(input.vectors.move).type.toBe<Controls.Vector>()
    expect(input.available.move).type.toBe<boolean>()
    expect(input.devices.keyboard.vectors.move).type.toBe<Controls.Vector>()
    // @ts-expect-error Property 'jump' does not exist
    input.vectors.jump
    // @ts-expect-error Property 'move' does not exist
    input.actions.move

    const moveAsButton = Keyboard.actions(host, { move: ["w"], jump: [" "] })
    // @ts-expect-error keyboard binds move as a button, but it is a vector action: bind it with vector(...)
    Moving.merge({ keyboard: moveAsButton, gamepad: pad })
    const jumpAsVector = Gamepad.actions(host, { move: Gamepad.vector({ stick: "left" }), jump: Gamepad.vector({ stick: "right" }) })
    // @ts-expect-error gamepad binds jump as a vector, but it is a button action: bind it to keys or buttons
    Moving.merge({ keyboard: keys, gamepad: jumpAsVector })
    const noMove = Keyboard.actions(host, { jump: [" "] })
    // @ts-expect-error keyboard has no action move: bind it on keyboard, or pass lacking(keyboard, [...]) from the action set
    Moving.merge({ keyboard: noMove, gamepad: pad })
    expect(Moving.merge({ keyboard: Moving.lacking(noMove, ["move"]), gamepad: pad }).snapshot().available.move).type.toBe<boolean>()
  })

  it("rejects a name declared as both kinds", () => {
    // @ts-expect-error move is declared as both a button and a vector action: give it one kind
    Controls.actions({ buttons: ["jump", "move"], vectors: ["move"] })
    // @ts-expect-error Type '[]' is not assignable
    Controls.actions({ buttons: [] })
  })
})

describe("one home for the shared input types", () => {
  it("ActionState and Vector are exported from Controls only", () => {
    // @ts-expect-error has no exported member 'ActionState'
    type FromKeyboard = Keyboard.ActionState
    // @ts-expect-error has no exported member named 'Vector'
    type FromGamepad = Gamepad.Vector
    // @ts-expect-error has no exported member 'Vector'
    type FromTouch = Touch.Vector
    // @ts-expect-error has no exported member 'ActionState'
    type FromPointer = Pointer.ActionState
    expect<Controls.ActionState>().type.toBe<{ readonly held: boolean; readonly pressed: boolean; readonly released: boolean }>()
    expect<Controls.Vector>().type.toBe<{ readonly x: number; readonly y: number }>()
  })

  it("draws a fuzzed snapshot of the idle snapshot's type, from a generator", () => {
    const random = Random.make(1)
    const devices = { keyboard: Keyboard.idle(keyBindings), gamepad: Gamepad.idle(padBindings) }
    expect(Actions.random(random, devices)).type.toBe<ReturnType<typeof Actions.idle<typeof devices>>>()
    expect(Actions.random).type.toBeCallableWith(random, devices)
    expect(Actions.random).type.not.toBeCallableWith({}, devices)
    expect(Actions.random).type.not.toBeCallableWith(random, { keyboard: { pressed: true } })
  })

  it("declares the input service as the merge's snapshot() only: the merge provides it, systems still cannot drain it", () => {
    const makeControls = (devices: { readonly keyboard: Keyboard.Actions<typeof keyBindings>; readonly gamepad: Gamepad.Actions<typeof padBindings> }) =>
      Actions.merge(devices)
    const ControlsInput = Descriptor.Service<InputCapture.SourceOf<ReturnType<typeof makeControls>>>()("ControlsTypes/Source")
    expect<InputCapture.SnapshotOf<typeof ControlsInput>>().type.toBe<ReturnType<ReturnType<typeof makeControls>["snapshot"]>>()
    // A replay's plain source and the live merge both provide it; the merge's rebind stays with the host.
    expect<{ readonly snapshot: () => InputCapture.SnapshotOf<typeof ControlsInput> }>().type.toBeAssignableTo<DescriptorOf.Value<typeof ControlsInput>>()
    expect(makeControls({ keyboard, gamepad })).type.toBeAssignableTo<DescriptorOf.Value<typeof ControlsInput>>()
    // @ts-expect-error Property 'rebind' does not exist
    ;({} as DescriptorOf.Value<typeof ControlsInput>).rebind
    const Game = Schema.bind(Schema.fragment({}))
    Game.System("ControlsTypes/Peek", { services: { controls: Game.System.service(ControlsInput) } }, ({ services }) => {
      // @ts-expect-error snapshot() drains ControlsTypes/Source
      services.controls.snapshot()
    })
  })
})
