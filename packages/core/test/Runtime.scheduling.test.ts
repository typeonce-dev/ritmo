import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Runtime from "@typeonce/ritmo/Runtime"
import * as Schedule from "@typeonce/ritmo/Schedule"
import * as System from "@typeonce/ritmo/System"
import { readResourceValue } from "./utils/fixtures.ts"

const Counter = Descriptor.Resource<number>()("Counter")
const Log = Descriptor.Resource<ReadonlyArray<string>>()("Log")

const Game = Schema.bind(Schema.fragment({
  resources: {
    Counter,
    Log
  }
}))
const schema = Game.schema

const makeRuntime = () =>
  Runtime.make({
    schema,
    services: Runtime.services(),
    resources: {
      Counter: 0,
      Log: []
    }
  }).success

describe("Runtime scheduling", () => {
  it("runSchedule executes only the provided schedule", () => {
    const increment = System.System(
      "RuntimeScheduling/Increment",
      {
        schema,
        resources: {
          counter: System.writeResource(Counter)
        }
      },
      ({ resources }) =>
        {
          resources.counter.update((value) => value + 1)
        }
    )

    const append = System.System(
      "RuntimeScheduling/AppendLog",
      {
        schema,
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ resources }) =>
        {
          resources.log.update((entries) => [...entries, "ran"])
        }
    )

    const runtime = makeRuntime()
    runtime.tick(Schedule.Schedule(increment))

    expect(readResourceValue(runtime, schema, Counter)).toBe(1)
    expect(readResourceValue(runtime, schema, Log)).toEqual([])
    runtime.tick(Schedule.Schedule(append))
    expect(readResourceValue(runtime, schema, Log)).toEqual(["ran"])
  })

  it("tick executes schedules in the order provided", () => {
    const first = System.System(
      "RuntimeScheduling/First",
      {
        schema,
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ resources }) =>
        {
          resources.log.update((entries) => [...entries, "first"])
        }
    )

    const second = System.System(
      "RuntimeScheduling/Second",
      {
        schema,
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ resources }) =>
        {
          resources.log.update((entries) => [...entries, "second"])
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Schedule.Schedule(first),
      Schedule.Schedule(second)
    )

    expect(readResourceValue(runtime, schema, Log)).toEqual(["first", "second"])
  })

  it("preserves authored system order exactly", () => {
    const first = System.System(
      "RuntimeScheduling/DirectFirst",
      {
        schema,
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ resources }) =>
        {
          resources.log.update((entries) => [...entries, "first"])
        }
    )

    const second = System.System(
      "RuntimeScheduling/DirectSecond",
      {
        schema,
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ resources }) =>
        {
          resources.log.update((entries) => [...entries, "second"])
        }
    )

    const runtime = makeRuntime()
    runtime.tick(Schedule.Schedule(second, first))

    expect(readResourceValue(runtime, schema, Log)).toEqual(["second", "first"])
  })

  it("preserves authored order across multiple systems with no implicit grouping", () => {
    const first = System.System(
      "RuntimeScheduling/ChainedFirst",
      {
        schema,
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ resources }) =>
        {
          resources.log.update((entries) => [...entries, "first"])
        }
    )

    const second = System.System(
      "RuntimeScheduling/ChainedSecond",
      {
        schema,
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ resources }) =>
        {
          resources.log.update((entries) => [...entries, "second"])
        }
    )

    const runtime = makeRuntime()
    runtime.tick(Schedule.Schedule(first, second))

    expect(readResourceValue(runtime, schema, Log)).toEqual(["first", "second"])
  })

  it("keeps explicit marker boundaries while preserving authored order", () => {
    const first = System.System(
      "RuntimeScheduling/BoundaryFirst",
      {
        schema,
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ resources }) =>
        {
          resources.log.update((entries) => [...entries, "first"])
        }
    )

    const second = System.System(
      "RuntimeScheduling/BoundarySecond",
      {
        schema,
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ resources }) =>
        {
          resources.log.update((entries) => [...entries, "second"])
        }
    )

    const runtime = makeRuntime()
    runtime.tick(Schedule.Schedule(first, second))
    expect(readResourceValue(runtime, schema, Log)).toEqual(["first", "second"])
  })

  it("composes reusable final schedules into one flattened explicit schedule", () => {
    const first = System.System(
      "RuntimeScheduling/ComposeFirst",
      {
        schema,
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ resources }) =>
        {
          resources.log.update((entries) => [...entries, "first"])
        }
    )

    const second = System.System(
      "RuntimeScheduling/ComposeSecond",
      {
        schema,
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ resources }) =>
        {
          resources.log.update((entries) => [...entries, "second"])
        }
    )

    const hostMirror = Schedule.Schedule(
      second
    )

    const runtime = makeRuntime()
    runtime.tick(Schedule.Schedule(
      first,
      Schedule.applyDeferred(),
      hostMirror
    ))

    expect(readResourceValue(runtime, schema, Log)).toEqual(["first", "second"])
  })

  it("rejects duplicate systems reused across composed entries", () => {
    const duplicate = System.System(
      "RuntimeScheduling/ComposeDuplicate",
      {
        schema,
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ resources }) =>
        {
          resources.log.update((entries) => [...entries, "duplicate"])
        }
    )

    const phase = Schedule.Schedule(duplicate)

    expect(() =>
      Schedule.Schedule(duplicate, phase)
    ).toThrow("Duplicate system step in schedule")
  })

  it("rejects entries that are not systems, schedules, or markers with a message naming them", () => {
    // Types prevent this; the cast stands for a stale import that is undefined at runtime.
    const missing = undefined as unknown as ReturnType<typeof Game.Schedule.applyDeferred>
    const Flow = Game.StateMachine("RuntimeScheduling/Flow", ["A", "B"] as const)
    expect(() => Game.Schedule(Game.Schedule.applyDeferred(), missing)).toThrow("Schedule entry 1 is not a system, a schedule, or a marker step: got undefined undefined. Is an import undefined?")
    expect(() => Schedule.Schedule(missing)).toThrow(/Schedule entry 0 is not a system/)
    expect(() => Game.Schedule.when([Game.Condition.inState(Flow, "A")], missing)).toThrow(/Schedule entry 0/)
    expect(() => Game.Schedule.onEnter(Flow, "A", [missing])).toThrow(/Schedule entry 0/)
    expect(() => Game.Schedule({ steps: [] } as unknown as ReturnType<typeof Game.Schedule.applyDeferred>)).toThrow(/got an object with keys steps/)
  })
})

