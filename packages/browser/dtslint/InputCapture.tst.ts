import { Controls, InputCapture, Keyboard } from "@typeonce/ritmo-browser"
import { Descriptor, Schema } from "@typeonce/ritmo"
import { describe, expect, it } from "tstyche"

const bindings = { jump: [" "] } as const
type Snapshot = Keyboard.Snapshot<typeof bindings>

const KeyboardInput = Descriptor.Service<Keyboard.Actions<typeof bindings>>()("CaptureTypes/Keyboard")
const Input = Descriptor.TransientResource<Snapshot>()("CaptureTypes/Input")
const Wrong = Descriptor.Resource<{ readonly jump: boolean }>()("CaptureTypes/Wrong")
const Fewer = Descriptor.TransientResource<Keyboard.Snapshot<{ readonly jump: readonly [" "]; readonly left: readonly ["a"] }>>()("CaptureTypes/Fewer")
const Optional = Descriptor.TransientResource<{
  readonly actions: { readonly jump: Controls.ActionState; readonly left?: Controls.ActionState }
  readonly used: boolean
}>()("CaptureTypes/Optional")
const Wide = Descriptor.TransientResource<unknown>()("CaptureTypes/Wide")
const Declared = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof KeyboardInput>>()("CaptureTypes/Declared")
const Clock = Descriptor.Service<{ readonly now: () => number }>()("CaptureTypes/Clock")
const Game = Schema.bind(Schema.fragment({ resources: { Input, Wrong, Fewer, Optional, Wide, Declared } }))

describe("InputCapture", () => {
  it("requires the service and resource at tick time", () => {
    const Capture = InputCapture.system(Game, { name: "CaptureTypes/Capture", source: KeyboardInput, resource: Input })
    const withoutKeyboard = Game.Runtime.make({
      services: Game.Runtime.services(),
      resources: { Input: Keyboard.idle(bindings), Wrong: { jump: false } }
    }).value
    // @ts-expect-error __runtimeRequirementError__: "Missing service"; readonly __requirement__: "CaptureTypes/Keyboard"
    withoutKeyboard.tick(Game.Schedule(Capture))

    const ready = Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(KeyboardInput, Keyboard.actions(window, bindings))),
      resources: { Input: Keyboard.idle(bindings), Wrong: { jump: false } }
    }).value
    expect(ready.tick(Game.Schedule(Capture)).ok).type.toBe<boolean>()
  })

  it("requires the machines its run conditions read", () => {
    const Pace = Game.StateMachine("CaptureTypes/Pace", { Running: {}, Frozen: {} })
    const Capture = InputCapture.system(Game, {
      name: "CaptureTypes/Gated",
      source: KeyboardInput,
      resource: Input,
      when: [Game.Condition.inState(Pace, "Running")]
    })
    const services = Game.Runtime.services(Game.Runtime.service(KeyboardInput, Keyboard.actions(window, bindings)))
    const resources = { Input: Keyboard.idle(bindings), Wrong: { jump: false } }
    const withoutMachine = Game.Runtime.make({ services, resources }).value
    // @ts-expect-error __runtimeRequirementError__: "Missing machine"; readonly __requirement__: "CaptureTypes/Pace"
    withoutMachine.tick(Game.Schedule(Capture))
    const ready = Game.Runtime.make({ services, resources, machines: Game.Runtime.machines(Game.Runtime.machine(Pace, { _tag: "Running" })) }).value
    expect(ready.tick(Game.Schedule(Capture)).ok).type.toBe<boolean>()
  })

  it("rejects resources whose value is not exactly the snapshot type", () => {
    // @ts-expect-error must be exactly the source's snapshot type
    InputCapture.system(Game, { name: "CaptureTypes/Wrong", source: KeyboardInput, resource: Wrong })
    // @ts-expect-error must be exactly the source's snapshot type
    InputCapture.system(Game, { name: "CaptureTypes/Fewer", source: KeyboardInput, resource: Fewer })
    // @ts-expect-error must be exactly the source's snapshot type
    InputCapture.system(Game, { name: "CaptureTypes/Optional", source: KeyboardInput, resource: Optional })
    // @ts-expect-error must be exactly the source's snapshot type
    InputCapture.system(Game, { name: "CaptureTypes/Wide", source: KeyboardInput, resource: Wide })
  })

  it("accepts a resource declared with SnapshotOf", () => {
    expect(InputCapture.system).type.toBeCallableWith(Game, { name: "CaptureTypes/Declared", source: KeyboardInput, resource: Declared })
  })

  it("rejects sources without snapshot()", () => {
    expect(InputCapture.system).type.not.toBeCallableWith(Game, { name: "CaptureTypes/NoSnapshot", source: Clock, resource: Input })
    expect(InputCapture.system).type.toBeCallableWith(Game, { name: "CaptureTypes/Snapshot", source: KeyboardInput, resource: Input })
  })

  it("counts as the resource's writer for thisTick readers", () => {
    const Capture = InputCapture.system(Game, { name: "CaptureTypes/Ordered", source: KeyboardInput, resource: Input })
    const Reader = Game.System("CaptureTypes/Reader", {
      resources: { input: Game.System.thisTick(Game.System.readResource(Input)) }
    }, () => {})
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(KeyboardInput, Keyboard.actions(window, bindings))),
      resources: { Input: Keyboard.idle(bindings), Wrong: { jump: false } }
    }).value
    expect(runtime.tick(Game.Schedule(Capture, Reader)).ok).type.toBe<boolean>()
    // @ts-expect-error CaptureTypes/Reader needs CaptureTypes/Input from this tick, but its writer CaptureTypes/Ordered runs after it
    runtime.tick(Game.Schedule(Reader, Capture))
  })

  it("declares a source service as a device's snapshot() only, with SourceOf", () => {
    expect<InputCapture.SourceOf<Keyboard.Actions<typeof bindings>>>().type.toBe<InputCapture.Source<Snapshot>>()
    const Sourced = Descriptor.Service<InputCapture.SourceOf<Keyboard.Actions<typeof bindings>>>()("CaptureTypes/Sourced")
    expect<InputCapture.SnapshotOf<typeof Sourced>>().type.toBe<Snapshot>()
    expect(InputCapture.system).type.toBeCallableWith(Game, { name: "CaptureTypes/FromSourced", source: Sourced, resource: Input })
    // @ts-expect-error does not satisfy the constraint 'Source<unknown>'
    type NotASource = InputCapture.SourceOf<{ readonly now: () => number }>
  })
})
