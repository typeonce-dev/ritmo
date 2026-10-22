import { describe, expect, it } from "vitest"
import { Clock, HostClock, Result, Schema } from "@typeonce/ritmo"
import { Replay, Session } from "@typeonce/ritmo-devtools"
import { Collector } from "@typeonce/ritmo-devtools/Monitor"

const Game = Schema.bind(Schema.fragment({}))
const Load = Game.System("Ignore/Load", {}, () => Result.fail("level file missing" as const))
const Place = Game.System("Ignore/Place", {}, () => {})
const Decorate = Game.System("Ignore/Decorate", {}, () => {})
const Tick = Game.System("Ignore/Tick", {}, () => {})
const setup = Game.Schedule(Load, Place, Decorate)
const update = Game.Schedule(Tick)

const make = () => {
  const hostClock = HostClock.test()
  const runtime = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock } }).success
  return { runtime, hostClock }
}

const ignoredText = "tick failure ignored: Ignore/Load failed with \"level file missing\"; 2 later systems did not run (not read before the next tick)"

describe("ignored tick failures in devtools", () => {
  it("stops a session run on a setup failure the game did not read, and reports it", () => {
    const { runtime, hostClock } = make()
    const session = Session.make(runtime, { hostClock, schedules: { setup, update } })
    runtime.tick(setup)
    const run = session.run("update", { frames: 3 })
    expect(run.data.stop).toEqual({
      reason: "ignored-failure",
      frame: 1,
      schedule: "setup",
      system: "Ignore/Load",
      error: { _tag: "SystemFailure", system: "Ignore/Load", error: "level file missing" },
      skipped: ["Ignore/Place", "Ignore/Decorate"],
      when: "next-tick"
    })
    expect(run.data.frames).toBe(1)
    expect(run.text).toContain(`STOPPED: ${ignoredText}, at f1`)
    expect(session.report().data.warnings.filter((warning) => warning.code === "ignored-failure").map((warning) => warning.message)).toEqual([ignoredText])
    expect(session.journal().text).toContain(ignoredText)
  })

  it("reports a failure still unread when the session reports (its end)", () => {
    const { runtime, hostClock } = make()
    const session = Session.make(runtime, { hostClock, schedules: { setup } })
    runtime.tick(setup)
    expect(session.report().data.warnings.filter((warning) => warning.code === "ignored-failure").map((warning) => warning.message)).toEqual([
      "tick failure ignored: Ignore/Load failed with \"level file missing\"; 2 later systems did not run (not read before the session ended)"
    ])
  })

  it("does not stop a run, or warn, for failures the session read itself", () => {
    const { runtime, hostClock } = make()
    const session = Session.make(runtime, { hostClock, schedules: { setup } })
    expect(session.run("setup").data.stop.reason).toBe("failure")
    expect(session.report().data.warnings.map((warning) => warning.code)).not.toContain("ignored-failure")
  })

  it("saves a replay when a failure goes unread", () => {
    const { runtime, hostClock } = make()
    const sink = Replay.memorySink()
    Replay.recorder(runtime, { schedule: setup, name: "setup", keep: 10, step: Clock.hz(1), sink, hostClock, saveOn: { failure: true } })
    runtime.tick(setup)
    runtime.tick(update)
    expect(sink.files.map((file) => file.reason)).toContain(ignoredText)
  })

  it("raises a monitor alert", () => {
    const { runtime } = make()
    const collector = new Collector(() => runtime.debug.population(), () => 0)
    runtime.debug.observe(collector.observe)
    runtime.tick(setup)
    runtime.tick(update)
    expect([...collector.alerts.values()].map((alert) => [alert.code, alert.message])).toContainEqual(["ignored-failure", ignoredText])
  })
})
