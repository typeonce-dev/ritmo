import { describe, expect, it } from "vitest"
import { Debug, Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"

const Score = Descriptor.Resource<number>()("Ignored/Score")
const Root = Schema.defineRoot("Ignored")
const Game = Schema.bind(Schema.fragment({ resources: { Score } }), Root)

const Load = Game.System("Ignored/Load", {}, () => Result.failure("level file missing" as const))
const Place = Game.System("Ignored/Place", {}, () => {})
const Count = Game.System("Ignored/Count", { resources: { score: Game.System.writeResource(Score) } }, ({ resources }) => {
  resources.score.update((score) => score + 1)
})
const Decorate = Game.System("Ignored/Decorate", {}, () => {})
const setup = Game.Schedule(Place, Load, Decorate, Count)
const update = Game.Schedule(Count)

const makeDebug = () => Game.Runtime.make({ services: Game.Runtime.services(), resources: { Score: 0 }, debug: { hostClock: HostClock.test() } }).value

const ignoredEvents = (runtime: ReturnType<typeof makeDebug>) => {
  const seen: Array<Debug.FailureIgnoredEvent> = []
  runtime.debug.observe((event) => {
    if (event.type === "failure.ignored") seen.push(event)
  })
  return seen
}

describe("ignored tick failures (debug only)", () => {
  it("reports a setup failure nobody read at the start of the next tick, with the systems it skipped", () => {
    const runtime = makeDebug()
    runtime.debug.nameSchedules({ setup, update })
    const seen = ignoredEvents(runtime)
    runtime.tick(setup)
    expect(seen).toEqual([])
    runtime.tick(update)
    expect(seen).toEqual([{
      type: "failure.ignored",
      frame: 1,
      schedule: "setup",
      system: "Ignored/Load",
      error: { kind: "SystemFailure", system: "Ignored/Load", error: "level file missing" },
      skipped: ["Ignored/Decorate", "Ignored/Count"],
      when: "next-tick"
    }])
  })

  it("does not report a result whose ok was read, from tick or tryTick", () => {
    const runtime = makeDebug()
    const seen = ignoredEvents(runtime)
    const ticked = runtime.tick(setup)
    if (!ticked.ok) expect(ticked.error.system).toBe("Ignored/Load")
    const tried = runtime.tryTick(setup)
    expect(tried.ok).toBe(false)
    runtime.tick(update)
    runtime.debug.checkIgnoredFailures()
    expect(seen).toEqual([])
  })

  it("reports a result read only after the next tick: it was not read in time", () => {
    const runtime = makeDebug()
    const seen = ignoredEvents(runtime)
    const late = runtime.tick(setup)
    runtime.tick(update)
    expect(late.ok).toBe(false)
    expect(seen.map((event) => event.when)).toEqual(["next-tick"])
  })

  it("reports an unread failure when the session ends, and only once", () => {
    const runtime = makeDebug()
    const seen = ignoredEvents(runtime)
    runtime.tryTick(setup)
    runtime.debug.checkIgnoredFailures()
    runtime.debug.checkIgnoredFailures()
    expect(seen.map((event) => [event.system, event.when])).toEqual([["Ignored/Load", "session-end"]])
  })

  it("reports a tryTick that ran nothing (missing requirements), with every system skipped", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.test() } }).value
    const seen: Array<Debug.FailureIgnoredEvent> = []
    runtime.debug.observeHost((event) => {
      if (event.type === "failure.ignored") seen.push(event)
    })
    runtime.tryTick(update)
    runtime.tryTick(update)
    expect(seen.map((event) => [event.system, event.skipped])).toEqual([[undefined, ["Ignored/Count"]]])
  })

  it("tracks nothing with debug off: the result is the plain failure", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Score: 0 } }).value
    const result = runtime.tick(setup)
    expect(Object.getOwnPropertyDescriptor(result, "ok")?.get).toBeUndefined()
    expect(result).toEqual({ ok: false, error: { kind: "SystemFailure", system: "Ignored/Load", error: "level file missing" } })
  })
})
