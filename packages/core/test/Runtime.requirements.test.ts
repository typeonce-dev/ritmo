import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Runtime from "@typeonce/ritmo/Runtime"

describe("Runtime dynamic requirements", () => {
  it("reports missing nominal requirements before executing an erased schedule", () => {
    const Counter = Descriptor.Resource<number>()("RuntimeRequirements/Counter")
    const Logger = Descriptor.Service<{ readonly log: (value: number) => void }>()("RuntimeRequirements/Logger")
    const Game = Schema.bind(Schema.fragment({ resources: { Counter } }))
    const Phase = Game.StateMachine("RuntimeRequirements/Phase", ["Ready", "Running"] as const)

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
    }).success

    expect(incomplete.tryTick(schedule)).toEqual({
      _tag: "Failure",
      failure: {
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
        Game.Runtime.machine(Phase, "Ready")
      )
    }).success

    expect(complete.tryTick(schedule)).toEqual({ _tag: "Success", success: undefined })
    expect(logged).toEqual([1])
  })
})
