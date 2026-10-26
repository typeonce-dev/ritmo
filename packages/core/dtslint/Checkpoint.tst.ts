import { Checkpoint, Descriptor, Result, Schema } from "@typeonce/ritmo"
import type * as Schedule from "@typeonce/ritmo/Schedule"
import { describe, expect, it } from "tstyche"

const Count = Descriptor.Resource<number>()("CheckpointTypes/Count")
const Keys = Descriptor.Service<Schedule.Source<{ readonly left: boolean }>>()("CheckpointTypes/Keys")
const Tuning = Descriptor.Service<{ readonly speed: number }>()("CheckpointTypes/Tuning")
const Sound = Descriptor.Service<{ readonly play: (name: string) => void }>()("CheckpointTypes/Sound")

const Root = Schema.defineRoot("CheckpointTypes")
const Game = Schema.bind(Schema.fragment({ resources: { Count } }), Root)
const Other = Schema.bind(Schema.fragment({ resources: { Count } }), Schema.defineRoot("CheckpointTypes/Other"))

const Step = Game.System("CheckpointTypes/Step", {
  resources: { count: Game.System.writeResource(Count) },
  services: { keys: Game.System.consumeService(Keys), tuning: Game.System.service(Tuning) }
}, ({ resources, services }) => {
  if (services.keys.snapshot().left) resources.count.update((count) => count + services.tuning.speed)
})
const Noisy = Game.System("CheckpointTypes/Noisy", { services: { sound: Game.System.service(Sound) } }, ({ services }) => {
  services.sound.play("tick")
})
const Remembering = Game.System("CheckpointTypes/Remembering", { local: () => ({ runs: 0 }) }, ({ local }) => {
  local.runs++
})

const simulate = Game.Schedule(Step)

const runtime = Game.Runtime.make({
  resources: { Count: 0 },
  services: Game.Runtime.services(
    Game.Runtime.service(Keys, { snapshot: () => ({ left: true }) }),
    Game.Runtime.service(Tuning, { speed: 1 }),
    Game.Runtime.service(Sound, { play: () => {} })
  )
}).value

describe("runtime.checkpoint", () => {
  it("returns a checkpoint of the game's root", () => {
    expect(runtime.checkpoint(simulate)).type.toBe<Checkpoint.Checkpoint<typeof Root>>()
  })

  it("accepts input sources and plain-data services", () => {
    expect(runtime.checkpoint).type.toBeCallableWith(Game.Schedule(Step))
  })

  it("rejects a service that is neither a source nor plain data", () => {
    // @ts-expect-error CheckpointTypes/Sound is neither a snapshot() source, plain data, nor Checkpoint.rewindable
    runtime.checkpoint(Game.Schedule(Noisy))
  })

  it("rejects a system that keeps local state", () => {
    // @ts-expect-error CheckpointTypes/Remembering keeps local state, which a rewind cannot put back
    runtime.checkpoint(Game.Schedule(Remembering))
  })

  it("rejects a schedule whose systems are not statically known", () => {
    const widened: Schedule.ExecutableScheduleDefinition<typeof Game.schema, any, typeof Root, any, any> = simulate
    // @ts-expect-error the systems of this schedule are not statically known
    runtime.checkpoint(widened)
  })

  it("checks the systems of transition schedules too", () => {
    const Phase = Game.StateMachine("CheckpointTypes/Phase", { Calm: {}, Rush: {} })
    const rewound = Game.Schedule(Step, Game.Schedule.applyStateTransitions(Game.Schedule.transitions(Game.Schedule.onEnter(Phase, "Rush", [Remembering]))))
    // @ts-expect-error CheckpointTypes/Remembering keeps local state
    runtime.checkpoint(rewound)
  })
})

describe("runtime.rewind", () => {
  it("returns a Result naming why nothing changed", () => {
    expect(runtime.rewind(runtime.checkpoint(simulate))).type.toBe<Result.Result<void, Checkpoint.RewindError<never>>>()
  })

  it("rejects a checkpoint of another game", () => {
    const other = Other.Runtime.make({ resources: { Count: 0 }, services: Other.Runtime.services() }).value
    const foreign = other.checkpoint(Other.Schedule(Other.System("CheckpointTypes/Foreign", {}, () => {})))
    expect(runtime.rewind).type.not.toBeCallableWith(foreign)
    expect(runtime.rewind).type.toBeCallableWith(runtime.checkpoint(simulate))
  })
})

describe("Checkpoint", () => {
  it("narrows unknown values", () => {
    const value: unknown = runtime.checkpoint(simulate)
    if (Checkpoint.isCheckpoint(value)) expect(value).type.toBe<Checkpoint.Checkpoint>()
  })

  it("names each rewind error", () => {
    expect<Checkpoint.RewindError["_tag"]>().type.toBe<"OtherRuntime" | "Released" | "RestoreFailed">()
    expect<Checkpoint.RewindError<never>["_tag"]>().type.toBe<"OtherRuntime" | "Released">()
    expect<Checkpoint.Released["reason"]>().type.toBe<"window" | "rewound" | "restored">()
  })

  it("resolves ValidateRewindable to unknown for a rewindable schedule", () => {
    expect<Checkpoint.ValidateRewindable<typeof simulate>>().type.toBe<unknown>()
  })
})

// A stand-in for a physics library that keeps its own world.
class World {
  count = 0
  step(): void {
    this.count++
  }
  take(): Uint8Array {
    return new Uint8Array([this.count])
  }
  static from(bytes: Uint8Array): World | undefined {
    const world = new World()
    world.count = bytes[0] ?? 0
    return bytes.length === 1 ? world : undefined
  }
}

const physics = Checkpoint.rewindable(new World(), {
  save: (world) => world.take(),
  restore: (bytes) => {
    const restored = World.from(bytes)
    return restored === undefined ? Result.failure({ _tag: "CorruptSnapshot" as const }) : Result.success(restored)
  }
})
const Physics = Descriptor.Service<typeof physics>()("CheckpointTypes/Physics")
const Stepper = Game.System("CheckpointTypes/Stepper", {
  resources: { count: Game.System.writeResource(Count) },
  services: { physics: Game.System.service(Physics) }
}, ({ resources, services }) => {
  services.physics.current.step()
  resources.count.set(services.physics.current.count)
})
const physical = Game.Runtime.make({
  resources: { Count: 0 },
  services: Game.Runtime.services(Game.Runtime.service(Physics, physics))
}).value

describe("Checkpoint.rewindable", () => {
  it("infers the value, the save, and the restore error from the hooks", () => {
    expect(physics).type.toBe<Checkpoint.Rewindable<World, Uint8Array, { _tag: "CorruptSnapshot" }>>()
    expect(physics.current).type.toBe<World>()
  })

  it("has no restore error when restore cannot fail", () => {
    expect(Checkpoint.rewindable(1, { save: (count) => count, restore: (saved) => Result.success(saved) }))
      .type.toBe<Checkpoint.Rewindable<number, number, never>>()
  })

  it("lets a schedule that uses it be checkpointed", () => {
    expect(physical.checkpoint).type.toBeCallableWith(Game.Schedule(Stepper))
    expect<Checkpoint.ValidateRewindable<ReturnType<typeof Game.Schedule<[typeof Stepper]>>>>().type.toBe<unknown>()
  })

  it("types a rewind's RestoreFailed by the service's name and restore", () => {
    expect(physical.rewind(physical.checkpoint(Game.Schedule(Stepper)))).type.toBe<
      Result.Result<void, Checkpoint.RewindError<Checkpoint.RestoreFailed<"CheckpointTypes/Physics", { _tag: "CorruptSnapshot" }>>>
    >()
  })

  it("rejects a restore that does not return a Result", () => {
    // @ts-expect-error is not assignable to type 'Result<World
    Checkpoint.rewindable(new World(), { save: (world) => world.take(), restore: (bytes) => World.from(bytes) })
  })

  it("rejects a restore that builds another value", () => {
    // @ts-expect-error Type 'number' is not assignable to type 'World'
    Checkpoint.rewindable(new World(), { save: (world) => world.take(), restore: (bytes) => Result.success(bytes.length) })
  })

  it("rejects a restore that takes something other than what save returns", () => {
    Checkpoint.rewindable(new World(), {
      // @ts-expect-error is not assignable to type 'string'
      save: (world) => world.take(),
      restore: (text: string) => Result.success(new World())
    })
  })

  it("rejects a value that is only shaped like one", () => {
    const forged = { current: new World(), save: (world: World) => world.take(), restore: (bytes: Uint8Array) => Result.success(new World()) }
    expect(Game.Runtime.service).type.not.toBeCallableWith(Physics, forged)
  })

  it("narrows unknown values", () => {
    const value: unknown = physics
    if (Checkpoint.isRewindable(value)) expect(value).type.toBe<Checkpoint.Rewindable<unknown, unknown, unknown>>()
  })
})
