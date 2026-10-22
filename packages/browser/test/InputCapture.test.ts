import { describe, expect, it } from "vitest"

import { InputCapture, Keyboard } from "@typeonce/ritmo-browser"
import { Descriptor, Schema } from "@typeonce/ritmo"

const bindings = { jump: [" "], left: ["ArrowLeft"] } as const

describe("InputCapture", () => {
  it("copies one snapshot per run into the resource", () => {
    const Source = Descriptor.Service<InputCapture.Source<Keyboard.Snapshot<typeof bindings>>>()("CaptureTest/Source")
    const Input = Descriptor.TransientResource<Keyboard.Snapshot<typeof bindings>>()("CaptureTest/Input")
    const Game = Schema.bind(Schema.fragment({ resources: { Input } }))

    const queued: Array<Keyboard.Snapshot<typeof bindings>> = [
      { jump: { held: true, pressed: true, released: false }, left: { held: false, pressed: false, released: false } },
      { jump: { held: false, pressed: false, released: true }, left: { held: true, pressed: true, released: false } }
    ]
    const seen: Array<string> = []
    const Capture = InputCapture.system(Game, { name: "CaptureTest/Capture", source: Source, resource: Input })
    const Read = Game.System("CaptureTest/Read", { resources: { input: Game.System.readResource(Input) } }, ({ resources }) => {
      const input = resources.input.get()
      seen.push(`${input.jump.pressed}/${input.left.held}`)
    })

    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(Source, { snapshot: () => queued.shift()! })),
      resources: { Input: Keyboard.idle(bindings) }
    }).success
    runtime.tick(Game.Schedule(Read))
    runtime.tick(Game.Schedule(Capture, Read))
    runtime.tick(Game.Schedule(Capture, Read))
    expect(seen).toEqual(["false/false", "true/false", "false/true"])
  })

  it("skips capture while its run conditions fail, keeping presses in the device", () => {
    const Source = Descriptor.Service<Keyboard.Actions<typeof bindings>>()("CaptureTest/Keys")
    const Input = Descriptor.TransientResource<Keyboard.Snapshot<typeof bindings>>()("CaptureTest/Held")
    const Game = Schema.bind(Schema.fragment({ resources: { Input } }))
    const Pace = Game.StateMachine("CaptureTest/Pace", ["Running", "Frozen"] as const)
    const keyboard = Keyboard.scripted(bindings, [{ frame: 0, press: ["jump"], release: ["jump"] }])
    const Capture = InputCapture.system(Game, {
      name: "CaptureTest/Gated",
      source: Source,
      resource: Input,
      when: [Game.Condition.inState(Pace, "Running")]
    })
    const Resume = Game.System("CaptureTest/Resume", { nextMachines: { pace: Game.System.nextState(Pace) } }, ({ nextMachines }) => {
      nextMachines.pace.set("Running")
    })
    const ReadInput = Game.Inspector("CaptureTest/ReadInput", { resources: { input: Game.System.readResource(Input) } }, ({ resources }) => resources.input.get())

    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(Source, keyboard)),
      resources: { Input: Keyboard.idle(bindings) },
      machines: Game.Runtime.machines(Game.Runtime.machine(Pace, "Frozen"))
    }).success
    runtime.tick(Game.Schedule(Capture))
    expect(keyboard.frames()).toBe(0)
    runtime.tick(Game.Schedule(Resume, Game.Schedule.applyStateTransitions(), Capture))
    // The first snapshot is taken only now, so the tap is still there.
    expect(runtime.inspect(ReadInput).jump.pressed).toBe(true)
  })

  it("builds idle snapshots for every action", () => {
    expect(Keyboard.idle(bindings)).toEqual({
      jump: { held: false, pressed: false, released: false },
      left: { held: false, pressed: false, released: false }
    })
  })
})
