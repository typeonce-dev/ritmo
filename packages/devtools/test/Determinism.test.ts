import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"
import { Determinism } from "@typeonce/ritmo-devtools"

const Count = Descriptor.Resource<number>()("Repeat/Count")
const Scratch = Descriptor.TransientComponent<{ value: number }>()("Repeat/Scratch")
const Game = Schema.bind(Schema.fragment({ resources: { Count }, components: { Scratch } }))
const options = { schedule: "update", frames: 4, hostClock: HostClock.test() } as const
const factory = (next: (value: number) => number) => ({ hostClock }: Determinism.Context) => {
  const runtime = Game.Runtime.make({ resources: { Count: 0 }, services: Game.Runtime.services(), debug: { hostClock } }).success
  const update = Game.Schedule(Game.System("Repeat/Advance", { resources: { count: Game.System.writeResource(Count) } }, ({ resources }) => {
    resources.count.update(next)
  }))
  return { runtime, schedules: { update } }
}

describe("Determinism.check", () => {
  it("compares all frames of independently built worlds", () => {
    expect(Determinism.check(factory((n) => n + 1), options)).toEqual({ ok: true, frames: 4 })
  })

  it("names the first differing frame, resource, and system", () => {
    let counter = 0
    const result = Determinism.check(factory(() => ++counter), options)
    expect(result).toMatchObject({ ok: false, frame: 1, reason: "difference", after: "Repeat/Advance", first: 1, second: 2 })
    if (!result.ok && result.reason === "difference") expect(result.difference).toContain("Repeat/Count")
  })

  it("checks the initial world too, without ticking", () => {
    let counter = 0
    const result = Determinism.check(({ hostClock }) => ({
      runtime: Game.Runtime.make({ resources: { Count: ++counter }, services: Game.Runtime.services(), debug: { hostClock } }).success,
      schedules: { update: Game.Schedule() }
    }), { ...options, frames: 0 })
    expect(result).toMatchObject({ ok: false, frame: 0, reason: "difference", after: undefined })
  })

  it("includes transient components and names a deferred spawn", () => {
    let counter = 0
    const result = Determinism.check(({ hostClock }) => {
      const runtime = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock } }).success
      const Spawn = Game.System("Repeat/Spawn", { commands: Game.System.commands(Game.System.spawns(Scratch)) }, ({ commands }) => {
        commands.spawn(Game.Command.spawn([Scratch, { value: ++counter }]))
      })
      return { runtime, schedules: { update: Game.Schedule(Spawn, Game.Schedule.applyDeferred()) } }
    }, options)
    expect(result).toMatchObject({ ok: false, frame: 1, reason: "difference", after: "applyDeferred()" })
    if (!result.ok && result.reason === "difference") expect(result.difference).toContain("Repeat/Scratch")
  })

  it("copies mutable values before the next run, including maps and cycles", () => {
    const Data = Descriptor.Resource<{ map: Map<string, number>; self?: unknown }>()("Repeat/Data")
    const Mutable = Schema.bind(Schema.fragment({ resources: { Data } }))
    let counter = 0
    const shared: { map: Map<string, number>; self?: unknown } = { map: new Map() }
    shared.self = shared
    const result = Determinism.check(({ hostClock }) => {
      const runtime = Mutable.Runtime.make({ services: Mutable.Runtime.services(), resources: { Data: shared }, debug: { hostClock } }).success
      const Write = Mutable.System("Repeat/Mutate", { resources: { data: Mutable.System.writeResource(Data) } }, () => {
        shared.map.set("value", ++counter)
      })
      return { runtime, schedules: { update: Mutable.Schedule(Write) } }
    }, options)
    expect(result).toMatchObject({ ok: false, frame: 1, reason: "difference", first: 1, second: 2 })
  })

  it("treats NaN as equal to NaN", () => {
    expect(Determinism.check(factory(() => Number.NaN), options)).toEqual({ ok: true, frames: 4 })
  })

  it("returns tick failures and thrown defects, never a false pass", () => {
    const make = (throws: boolean) => ({ hostClock }: Determinism.Context) => {
      const Fail = Game.System("Repeat/Fail", {}, () => {
        if (throws) throw new Error("broken")
        return Result.fail("refused")
      })
      return { runtime: Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock } }).success, schedules: { update: Game.Schedule(Fail) } }
    }
    expect(Determinism.check(make(false), options)).toMatchObject({ ok: false, frame: 1, reason: "failure", run: "first" })
    expect(Determinism.check(make(true), options)).toMatchObject({ ok: false, frame: 1, reason: "defect", run: "first" })
  })

  it("rejects a reused runtime and invalid frame counts", () => {
    const target = factory((n) => n + 1)({ hostClock: HostClock.test() })
    expect(Determinism.check(() => target, options)).toMatchObject({ ok: false, reason: "shared-runtime" })
    for (const frames of [-1, 0.5, Infinity, NaN]) expect(Determinism.check(factory((n) => n + 1), { ...options, frames })).toMatchObject({ ok: false, reason: "invalid-options" })
  })
})
