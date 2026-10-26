import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"

describe("Runtime dynamic requirements", () => {
  it("reports missing nominal requirements before executing an erased schedule", () => {
    const Counter = Descriptor.Resource<number>()("RuntimeRequirements/Counter")
    const Logger = Descriptor.Service<{ readonly log: (value: number) => void }>()("RuntimeRequirements/Logger")
    const Game = Schema.bind(Schema.fragment({ resources: { Counter } }))
    const Phase = Game.StateMachine("RuntimeRequirements/Phase", { Ready: {}, Running: {} })

    const run = Game.System("RuntimeRequirements/Run", {
      resources: { counter: Game.System.writeResource(Counter) },
      services: { logger: Game.System.service(Logger) },
      machines: { phase: Game.System.machine(Phase) }
    }, ({ resources, services }) => {
      resources.counter.update((value) => value + 1)
      services.logger.log(resources.counter.get())
    })

    const schedule = Game.Schedule(run)
    const incomplete = Game.Runtime.make({
      services: Game.Runtime.services()
    }).value

    expect(incomplete.tryTick(schedule)).toEqual({
      ok: false,
      error: {
        kind: "MissingRuntimeRequirements",
        requirements: [
          { kind: "service", name: "RuntimeRequirements/Logger" },
          { kind: "resource", name: "RuntimeRequirements/Counter" },
          { kind: "stateMachine", name: "RuntimeRequirements/Phase" }
        ]
      }
    })

    const logged: Array<number> = []
    const complete = Game.Runtime.make({
      services: Game.Runtime.services(
        Game.Runtime.service(Logger, { log: (value) => logged.push(value) })
      ),
      resources: { Counter: 0 },
      machines: Game.Runtime.machines(
        Game.Runtime.machine(Phase, { _tag: "Ready" })
      )
    }).value

    expect(complete.tryTick(schedule)).toEqual({ ok: true, value: undefined })
    expect(logged).toEqual([1])
  })
})
