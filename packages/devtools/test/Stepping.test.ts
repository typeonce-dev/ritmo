import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"
import { Invariant, Session } from "@typeonce/ritmo-devtools"
import * as Codecs from "../../core/test/codecs.ts"

const hostClock = HostClock.test()

const Position = Descriptor.ConstructedComponent(Codecs.struct({ x: Codecs.number }))("Step/Position")
const Health = Descriptor.ConstructedComponent(Codecs.number)("Step/Health")
const Score = Descriptor.ConstructedResource(Codecs.number)("Step/Score")
const Hit = Descriptor.Event<number>()("Step/Hit")
const Game = Schema.bind(Schema.fragment({ components: { Position, Health }, resources: { Score }, events: { Hit } }))

const Movers = Game.Query({ selection: { position: Game.Query.write(Position) } })
const Hurtable = Game.Query({ selection: { health: Game.Query.write(Health) } })

const Spawn = Game.System("Step/Spawn", { commands: Game.System.commands(Game.System.spawns(Position, Health)) }, ({ commands }) => {
  commands.spawn(Game.Command.spawn([Position, { x: 0 }], [Health, 3]))
})
const Move = Game.System("Step/Move", { queries: { movers: Movers } }, ({ queries }) => {
  for (const match of queries.movers.each()) match.data.position.update((position) => ({ x: position.x + 1 }))
})
const Hurt = Game.System("Step/Hurt", { queries: { hurtable: Hurtable }, events: { hit: Game.System.writeEvent(Hit) } }, ({ queries, events }) => {
  for (const match of queries.hurtable.each()) {
    match.data.health.update((health) => health - 1)
    events.hit.emit(1)
  }
})
const Tally = Game.System("Step/Tally", { events: { hit: Game.System.readEvent(Hit) }, resources: { score: Game.System.writeResource(Score) } }, ({ events, resources }) => {
  resources.score.set(resources.score.get() + events.hit.all().length)
})

const setup = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
const update = Game.Schedule(Move, Hurt, Tally)

const makeRuntime = () => {
  const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Score: 0 }, debug: { hostClock } })
  if (!made.ok) throw new Error("the resources did not validate")
  return made.value
}

const makeSession = () => {
  const runtime = makeRuntime()
  const session = Session.make(runtime, { hostClock, schedules: { setup, update } })
  session.run("setup")
  return { runtime, session }
}

const entityOne = (session: ReturnType<typeof makeSession>["session"]) => session.dump({ entities: [1] }).data.entities[0]?.components

describe("session.step", () => {
  it("shows the world after each system of one frame", () => {
    const { session } = makeSession()
    const frame = session.step("update")
    const reached = frame.until(Hurt)
    expect(reached.data).toEqual(Result.success({ frame: 2, system: "Step/Hurt", ran: [{ kind: "system", system: "Step/Move" }] }))
    expect(reached.text).toBe("step update f2: stopped before Step/Hurt; ran Step/Move")
    expect(entityOne(session)).toEqual({ "Step/Position": { x: 1 }, "Step/Health": 3 })
    const ran = frame.next()
    expect(ran.data).toEqual(Result.success({ frame: 2, step: { kind: "system", system: "Step/Hurt" }, ended: false }))
    expect(ran.text).toBe("step update f2: ran Step/Hurt; next: Step/Tally")
    expect(entityOne(session)).toEqual({ "Step/Position": { x: 1 }, "Step/Health": 2 })
    expect(session.dump().data.resources["Step/Score"]).toBe(0)
    expect(frame.remaining().data).toEqual([{ kind: "system", system: "Step/Tally" }])
    const last = frame.next()
    expect(last.data).toEqual(Result.success({ frame: 2, step: { kind: "system", system: "Step/Tally" }, ended: true }))
    expect(session.dump().data.resources["Step/Score"]).toBe(1)
    const finished = frame.finish()
    expect(finished.data).toMatchObject({ schedule: "update", ok: true, frames: 1, range: [2, 2], stop: { reason: "completed" } })
    expect(frame.finish()).toBe(finished)
    expect(frame.next().data).toEqual(Result.failure({ reason: "frameEnded", frame: 2 }))
  })

  it("shows the partial frame in journal and why", () => {
    const { session } = makeSession()
    const frame = session.step("update")
    frame.until(Tally)
    const journal = session.journal({ frames: 2 }).text
    expect(journal).toContain("Step/Hurt")
    expect(journal).not.toContain("Step/Tally")
    expect(session.why(1, Health).text).toContain("Step/Health is now 2")
    expect(session.why(1, Health).data.at(-1)).toMatchObject({ frame: 2, system: "Step/Hurt" })
    frame.finish()
  })

  it("applies an applyDeferred marker's commands exactly at its position", () => {
    const runtime = makeRuntime()
    const session = Session.make(runtime, { hostClock, schedules: { setup } })
    const frame = session.step("setup")
    frame.next()
    expect(session.dump().data).toMatchObject({ entityCount: 0, pendingCommands: [{ system: "Step/Spawn" }] })
    expect(frame.next().text).toBe("step setup f1: ran <applyDeferred>; the frame ended, finish() reports it")
    expect(session.dump().data).toMatchObject({ entityCount: 1, pendingCommands: [] })
    expect(frame.finish().data.stop).toEqual({ reason: "completed" })
  })

  it("ends the frame at a failing system, and finish() reports it as run does", () => {
    const Fail = Game.System("Step/Fail", {}, () => Result.failure("Broken" as const))
    const failing = Game.Schedule(Move, Fail, Hurt)
    const stepped = Session.make(makeRuntime(), { hostClock, schedules: { failing } })
    const ran = Session.make(makeRuntime(), { hostClock, schedules: { failing } })

    const frame = stepped.step("failing")
    const until = frame.until(Hurt)
    expect(until.data).toEqual(Result.failure({ reason: "failure", frame: 1, system: "Step/Fail", error: "Broken" }))
    expect(until.text).toBe("step failing f1: Step/Fail FAILED: \"Broken\"; the frame ended, finish() reports it")
    expect(frame.until(Hurt).data).toEqual(Result.failure({ reason: "frameEnded", frame: 1 }))
    expect(frame.remaining().data).toEqual([])
    const finished = frame.finish()
    const whole = ran.run("failing")
    expect(finished.data).toEqual(whole.data)
    expect(finished.text).toBe(whole.text)
    expect(stepped.journal().text).toBe(ran.journal().text)
  })

  it("stops on a thrown defect, and finish() reports it as run does", () => {
    const Throw = Game.System("Step/Throw", {}, () => {
      throw new Error("kaboom")
    })
    const throwing = Game.Schedule(Move, Throw)
    const { runtime, session } = (() => {
      const runtime = makeRuntime()
      return { runtime, session: Session.make(runtime, { hostClock, schedules: { throwing } }) }
    })()
    const frame = session.step("throwing")
    frame.next()
    const thrown = frame.next()
    expect(thrown.data).toMatchObject({ ok: false, error: { reason: "defect", frame: 1 } })
    expect(frame.finish().data.stop).toMatchObject({ reason: "defect", frame: 1 })
    // The frame is closed: the runtime ticks again.
    expect(() => runtime.tick(Game.Schedule(Move))).not.toThrow()
  })

  it("refuses ticks, sends, snapshots, and other runs while a frame is open", () => {
    const { runtime, session } = makeSession()
    const frame = session.step("update")
    frame.next()
    expect(() => runtime.tick(update)).toThrow(/runtime\.tick was called while a stepped frame is open/)
    expect(() => runtime.tryTick(update)).toThrow(/runtime\.tryTick was called while a stepped frame is open/)
    expect(() => runtime.send(Hit, 1)).toThrow(/stepped frame is open/)
    expect(() => runtime.snapshot()).toThrow(/stepped frame is open/)
    expect(() => runtime.checksum()).toThrow(/stepped frame is open/)
    expect(() => runtime.checkpoint(update)).toThrow(/stepped frame is open/)
    expect(() => session.run("update")).toThrow(/session\.run\(update\) was called while frame f2 of update is being stepped: call finish\(\) on it first/)
    expect(() => session.step("update")).toThrow(/session\.step\(update\)/)
    frame.finish()
    expect(runtime.tryTick(update).ok).toBe(true)
  })

  it("stepping a frame and finishing it equals running it", () => {
    const play = (step: boolean) => {
      const { runtime, session } = makeSession()
      session.run("update")
      if (step) {
        const frame = session.step("update")
        frame.until(Tally)
        session.dump({ entities: [1] })
        frame.next()
        frame.finish()
      } else {
        session.run("update")
      }
      session.run("update")
      const checksum = runtime.checksum()
      return { journal: session.journal({ verbose: true }).text, checksum: checksum.ok ? checksum.value : undefined, dump: session.dump().data }
    }
    const stepped = play(true)
    const ran = play(false)
    expect(stepped.checksum).toBeDefined()
    expect(stepped).toEqual(ran)
  })

  it("reports a system that is not ahead without running anything", () => {
    const { session } = makeSession()
    const frame = session.step("update")
    frame.until(Tally)
    const behind = frame.until(Move)
    expect(behind.data).toEqual(Result.failure({ reason: "notAhead", frame: 2, system: "Step/Move", remaining: [{ kind: "system", system: "Step/Tally" }] }))
    expect(behind.text).toContain("Step/Move is not ahead")
    expect(frame.remaining().data).toEqual([{ kind: "system", system: "Step/Tally" }])
    expect(frame.until(Tally).data).toMatchObject({ ok: true, value: { ran: [] } })
    frame.finish()
  })

  it("checks invariants mid-frame only when asked, and at the end of the frame in finish()", () => {
    const Healthy = Invariant.fromInspector(Game.Inspector("full health", {
      queries: { hurt: Game.Query({ selection: { health: Game.Query.read(Health) } }) }
    }, ({ queries }) => queries.hurt.each().some((match) => match.data.health.get() < 3) ? "hurt" : undefined))
    const runtime = makeRuntime()
    const session = Session.make(runtime, { hostClock, schedules: { setup, update }, invariants: [Healthy] })
    session.run("setup")
    const frame = session.step("update")
    frame.until(Hurt)
    expect(frame.check().data).toEqual(Result.success(undefined))
    expect(frame.check().text).toBe("step update f2: invariants hold before Step/Hurt")
    frame.next()
    const violated = frame.check()
    expect(violated.data).toEqual(Result.failure({ reason: "invariant", frame: 2, invariant: "full health", message: "hurt" }))
    expect(violated.text).toContain("violated before Step/Tally: hurt")
    expect(frame.finish().data.stop).toEqual({ reason: "invariant", frame: 2, invariant: "full health", message: "hurt" })
  })

  it("stops before a system placed under Schedule.when, given the system itself", () => {
    const Flow = Game.StateMachine("Step/Flow", { Playing: {} })
    const gated = Game.Schedule(Move, Game.Schedule.when([Game.Condition.inState(Flow, "Playing")], Hurt))
    const made = Game.Runtime.make({
      services: Game.Runtime.services(),
      resources: { Score: 0 },
      machines: Game.Runtime.machines(Game.Runtime.machine(Flow, { _tag: "Playing" })),
      debug: { hostClock }
    })
    if (!made.ok) throw new Error("the resources did not validate")
    const session = Session.make(made.value, { hostClock, schedules: { gated } })
    const frame = session.step("gated")
    expect(frame.until(Hurt).data).toMatchObject({ ok: true, value: { system: "Step/Hurt", ran: [{ kind: "system", system: "Step/Move" }] } })
    expect(frame.finish().data.ok).toBe(true)
  })

  it("reports missing requirements when the frame cannot begin", () => {
    const Clock = Descriptor.Service<{ readonly now: () => number }>()("Step/Clock")
    const Timed = Game.System("Step/Timed", { services: { clock: Game.System.service(Clock) } }, () => {})
    const timed = Game.Schedule(Timed)
    const session = Session.make(makeRuntime(), { hostClock, schedules: { timed } })
    const frame = session.step("timed")
    expect(frame.next().data).toMatchObject({ ok: false, error: { reason: "missingRequirements", frame: 0 } })
    expect(frame.until(Timed).text).toMatch(/^step timed: NOT BEGUN: missing runtime requirements/)
    expect(frame.finish().data.stop).toMatchObject({ reason: "missingRequirements", frame: 0 })
    expect(session.run("timed").data.stop).toMatchObject({ reason: "missingRequirements" })
  })
})
