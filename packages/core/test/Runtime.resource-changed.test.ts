import { describe, expect, it } from "vitest"
import { Decode, Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"
import * as Runtime from "@typeonce/ritmo/Runtime"

const hostClock = HostClock.test()

const Score = Descriptor.ConstructedResource(Decode.number)("Changed/Score")
const Hud = Descriptor.ConstructedResource(Decode.struct({ label: Decode.string, tags: Decode.array(Decode.string) }))("Changed/Hud")
const Open = Descriptor.ConstructedResource(Decode.boolean)("Changed/Open")

const Game = Schema.bind(Schema.fragment({ resources: { Score, Hud, Open } }))

const unwrap = <A>(made: { readonly _tag: "Success"; readonly success: A } | { readonly _tag: "Failure" }): A => {
  if (made._tag === "Failure") throw new Error("invalid fixture")
  return made.success
}

const makeRuntime = () => unwrap(
  Game.Runtime.make({
    services: Runtime.services(),
    resources: { Score: 0, Hud: { label: "a", tags: ["x"] }, Open: true },
    debug: { hostClock }
  }))

/** A writer whose next value is set by the test. */
const writer = () => {
  const state = { score: 0, hud: { label: "a", tags: ["x"] } as { readonly label: string; readonly tags: ReadonlyArray<string> }, fail: false }
  const system = Game.System("Changed/Write", {
    resources: { score: Game.System.writeResource(Score), hud: Game.System.writeResource(Hud) }
  }, ({ resources }) => {
    resources.score.set(state.score)
    resources.hud.set(state.hud)
    return state.fail ? Result.fail("boom") : Result.succeed(undefined)
  })
  return { state, system }
}

const reader = (name: string) => {
  const seen: Array<readonly [boolean, boolean]> = []
  const system = Game.System(`Changed/${name}`, {
    resources: { score: Game.System.changedResource(Score), hud: Game.System.changedResource(Hud) }
  }, ({ resources }) => {
    seen.push([resources.score.changed(), resources.hud.changed()])
  })
  return { seen, system }
}

describe("Game.System.changedResource", () => {
  it("reports true on the first run, then only for writes that leave a different value", () => {
    const w = writer()
    const r = reader("Reader")
    const runtime = makeRuntime()
    const schedule = Game.Schedule(w.system, r.system)

    runtime.tick(schedule) // first run, and writes equal the initial values
    w.state.score = 1
    runtime.tick(schedule) // score changed
    runtime.tick(schedule) // same values rewritten
    w.state.hud = { label: "a", tags: ["x"] }
    runtime.tick(schedule) // fresh but structurally equal object
    w.state.hud = { label: "a", tags: ["y"] }
    runtime.tick(schedule) // nested change

    expect(r.seen).toEqual([[true, true], [true, false], [false, false], [false, false], [false, true]])
  })

  it("keeps one cursor per reader", () => {
    const w = writer()
    const early = reader("Early")
    const late = reader("Late")
    const runtime = makeRuntime()

    runtime.tick(Game.Schedule(early.system, w.system, late.system))
    w.state.score = 5
    // Early runs before the write in this tick and sees it next tick; Late sees it now.
    runtime.tick(Game.Schedule(early.system, w.system, late.system))
    runtime.tick(Game.Schedule(early.system, w.system, late.system))

    expect(early.seen.map(([score]) => score)).toEqual([true, false, true])
    expect(late.seen.map(([score]) => score)).toEqual([true, true, false])
  })

  it("does not report a write rolled back by a failed system", () => {
    const w = writer()
    const r = reader("AfterFailure")
    const runtime = makeRuntime()
    const schedule = Game.Schedule(w.system, r.system)

    runtime.tick(schedule)
    w.state.score = 9
    w.state.fail = true
    expect(runtime.tryTick(schedule)._tag).toBe("Failure")
    expect(r.seen.length).toBe(1)
    // The failure aborted the tick before the reader; rerun the reader alone.
    runtime.tick(Game.Schedule(r.system))
    expect(r.seen.at(-1)).toEqual([false, false])
  })

  it("lets a reader skipped by a run condition see the change when it runs again", () => {
    const Flow = Game.StateMachine("Changed/Flow", ["On", "Off"] as const)
    const w = writer()
    const base = reader("Gated")
    // A gated copy shares the base system's cursor.
    const r = { seen: base.seen, system: Game.Schedule.when([Game.Condition.inState(Flow, "On")], base.system) }
    const SetFlow = Game.System("Changed/SetFlow", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
      nextMachines.flow.set(flowNext)
    })
    let flowNext: "On" | "Off" = "On"
    const runtime = unwrap(Game.Runtime.make({
      services: Runtime.services(),
      resources: { Score: 0, Hud: { label: "a", tags: ["x"] }, Open: true },
      machines: Runtime.machines(Runtime.machine(Flow, "On")),
      debug: { hostClock }
    }))
    const schedule = Game.Schedule(SetFlow, Game.Schedule.applyStateTransitions(), w.system, r.system)

    runtime.tick(schedule) // On: first run
    flowNext = "Off"
    w.state.score = 3
    runtime.tick(schedule) // Off: reader skipped, write happens
    w.state.score = 3
    runtime.tick(schedule) // Off: no further change
    flowNext = "On"
    runtime.tick(schedule) // On: reader sees the write from two ticks ago

    expect(r.seen.map(([score]) => score)).toEqual([true, true])
  })

  it("marks every resource changed after restore", () => {
    const w = writer()
    const r = reader("Restore")
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(w.system, r.system))
    runtime.tick(Game.Schedule(r.system))
    const saved = runtime.snapshot()
    const restored = runtime.restore(JSON.parse(JSON.stringify(saved)))
    expect(restored).toEqual({ _tag: "Success", success: undefined })
    runtime.tick(Game.Schedule(r.system))
    expect(r.seen).toEqual([[true, true], [false, false], [true, true]])
  })

  it("does not report a system's own writes to it", () => {
    const seen: Array<boolean> = []
    const Both = Game.System("Changed/Both", {
      resources: { score: Game.System.writeResource(Score), watched: Game.System.changedResource(Score) }
    }, ({ resources }) => {
      seen.push(resources.watched.changed())
      resources.score.update((score) => score + 1)
    })
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(Both))
    runtime.tick(Game.Schedule(Both))
    runtime.tick(Game.Schedule(Both))
    expect(seen).toEqual([true, false, false])
  })

  it("is listed under changed in describe(), with a lint when nothing writes it", () => {
    const w = writer()
    const r = reader("Described")
    const OpenReader = Game.System("Changed/OpenReader", { resources: { open: Game.System.changedResource(Open) } }, () => {})
    const runtime = makeRuntime()
    runtime.debug.nameSchedules({ update: Game.Schedule(w.system, r.system, OpenReader) })
    const described = runtime.debug.describe()
    const system = described.systems.find((entry) => entry.name === "Changed/Described")
    expect(system?.resources).toEqual({ reads: ["Changed/Score", "Changed/Hud"], changed: ["Changed/Score", "Changed/Hud"], writes: [] })
    expect(described.lints.filter((lint) => lint.code === "resource-changed-never-written").map((lint) => lint.subject)).toEqual(["Changed/Open"])
  })
})
