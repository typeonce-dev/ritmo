import { Descriptor, Schema } from "@typeonce/ritmo"
import type { ExecutableScheduleDefinition } from "@typeonce/ritmo/Schedule"
import type * as System from "@typeonce/ritmo/System"
import { describe, expect, it } from "tstyche"

const Damage = Descriptor.Event<{ readonly amount: number }>()("ThisTick/Damage")
const Score = Descriptor.Resource<number>()("ThisTick/Score")
const Game = Schema.bind(Schema.fragment({ resources: { Score }, events: { Damage } }))
const Flow = Game.StateMachine("ThisTick/Flow", ["Playing", "Paused"])

const Deal = Game.System("ThisTick/Deal", { events: { damage: Game.System.writeEvent(Damage) } }, ({ events }) => {
  events.damage.emit({ amount: 1 })
})
const Apply = Game.System("ThisTick/Apply", {
  events: { damage: Game.System.thisTick(Game.System.readEvent(Damage)) }
}, ({ events }) => {
  expect(events.damage.all()).type.toBe<ReadonlyArray<{ readonly amount: number }>>()
})
const Count = Game.System("ThisTick/Count", { resources: { score: Game.System.writeResource(Score) } }, ({ resources }) => {
  resources.score.update((score) => score + 1)
})
const Show = Game.System("ThisTick/Show", {
  resources: { score: Game.System.thisTick(Game.System.readResource(Score)) }
}, ({ resources }) => {
  expect(resources.score.get()).type.toBe<number>()
})

const runtime = Game.Runtime.make({
  services: Game.Runtime.services(),
  resources: { Score: 0 },
  machines: Game.Runtime.machines(Game.Runtime.machine(Flow, "Playing"))
}).success

describe("Game.System.thisTick", () => {
  it("marks a read and keeps its context view", () => {
    expect(Game.System.thisTick(Game.System.readEvent(Damage))).type.toBe<System.EventRead<typeof Damage> & System.ThisTick>()
    expect(Game.System.thisTick(Game.System.readResource(Score))).type.toBe<System.ResourceRead<typeof Score> & System.ThisTick>()
  })

  it("accepts event and resource reads and queries, never writes", () => {
    expect(Game.System.thisTick).type.not.toBeCallableWith(Game.System.writeEvent(Damage))
    expect(Game.System.thisTick).type.not.toBeCallableWith(Game.System.writeResource(Score))
    expect(Game.System.thisTick).type.toBeCallableWith(Game.System.readEvent(Damage))
  })

  it("compiles when every writer runs earlier in the same tick call", () => {
    runtime.tick(Game.Schedule(Deal, Apply))
    runtime.tick(Game.Schedule(Deal), Game.Schedule(Apply))
    runtime.tick(Game.Schedule(Count, Show, Deal, Apply))
    // A sub-schedule is never checked on its own.
    const reads = Game.Schedule(Apply)
    runtime.tick(Game.Schedule(Deal, reads))
  })

  it("rejects a writer that runs after the reader, naming reader, data, and writer", () => {
    // @ts-expect-error ThisTick/Apply needs ThisTick/Damage from this tick, but its writer ThisTick/Deal runs after it: move ThisTick/Deal before ThisTick/Apply
    runtime.tick(Game.Schedule(Apply, Deal))
    // @ts-expect-error ThisTick/Show needs ThisTick/Score from this tick, but its writer ThisTick/Count runs after it
    runtime.tick(Game.Schedule(Show), Game.Schedule(Count))
  })

  it("checks a writer that shares the reader's display name", () => {
    // Two systems may share a display name; a writer named like its reader is still a writer.
    const Twin = Game.System("ThisTick/Apply", { events: { damage: Game.System.writeEvent(Damage) } }, ({ events }) => {
      events.damage.emit({ amount: 2 })
    })
    // @ts-expect-error ThisTick/Apply needs ThisTick/Damage from this tick, but its writer ThisTick/Apply runs after it
    runtime.tick(Game.Schedule(Apply, Twin))
    runtime.tick(Game.Schedule(Twin, Apply))
  })

  it("counts gated groups by position", () => {
    // @ts-expect-error ThisTick/Apply needs ThisTick/Damage from this tick, but its writer ThisTick/Deal runs after it
    runtime.tick(Game.Schedule(Game.Schedule.when([Game.Condition.inState(Flow, "Playing")], Apply), Deal))
    runtime.tick(Game.Schedule(Game.Schedule.pauseWhen([Game.Condition.inState(Flow, "Playing")], Deal), Apply))
  })

  it("accepts a read with no writer in the tick call (a reused reader)", () => {
    runtime.tick(Game.Schedule(Apply))
    runtime.tick(Game.Schedule(Show))
  })

  it("does not count a writer ticked in a separate call", () => {
    runtime.tick(Game.Schedule(Apply))
    runtime.tick(Game.Schedule(Deal))
    // In one call, the same order is an error.
    // @ts-expect-error ThisTick/Apply needs ThisTick/Damage from this tick, but its writer ThisTick/Deal runs after it
    runtime.tick(Game.Schedule(Apply), Game.Schedule(Deal))
  })

  it("rejects a tick whose order is not statically known", () => {
    const widened: Array<typeof Deal | typeof Apply> = [Deal, Apply]
    // @ts-expect-error the order of this tick is not statically known
    runtime.tick(Game.Schedule(...widened))
    const schedules: Array<ReturnType<typeof Game.Schedule<[typeof Deal, typeof Apply]>>> = []
    // @ts-expect-error the order of this tick is not statically known
    runtime.tick(...schedules)
  })

  it("still reports missing requirements for a schedule with thisTick reads", () => {
    const Clock = Descriptor.Service<{ readonly now: () => number }>()("ThisTick/Clock")
    const Timed = Game.System("ThisTick/Timed", {
      events: { damage: Game.System.thisTick(Game.System.readEvent(Damage)) },
      services: { clock: Game.System.service(Clock) }
    }, () => {})
    // @ts-expect-error __runtimeRequirementError__: "Missing service"; readonly __requirement__: "ThisTick/Clock"
    runtime.tick(Game.Schedule(Deal, Timed))
    const bare = Game.Runtime.make({ services: Game.Runtime.services() }).success
    // @ts-expect-error __runtimeRequirementError__: "Missing resource"; readonly __requirement__: "ThisTick/Score"
    bare.tick(Game.Schedule(Count, Show))
  })

  it("fails a tick of a schedule whose order was erased by an annotation, instead of passing it", () => {
    const erased: ExecutableScheduleDefinition<typeof Game.schema, never, typeof Game.schema> = Game.Schedule(Apply, Deal)
    // @ts-expect-error the order of this tick is not statically known
    runtime.tick(erased)
  })

  it("does not let a schedule with thisTick reads widen into an annotation that drops them", () => {
    const plain: Schema.Schema.BoundSchedule<typeof Game.schema, typeof Game.schema> = Game.Schedule(Deal)
    expect(plain).type.toBeAssignableTo<Schema.Schema.BoundSchedule<typeof Game.schema, typeof Game.schema>>()
    expect(Game.Schedule(Apply)).type.not.toBeAssignableTo<Schema.Schema.BoundSchedule<typeof Game.schema, typeof Game.schema>>()
  })
})
