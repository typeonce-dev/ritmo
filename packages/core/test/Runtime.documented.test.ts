import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Codecs from "./codecs.ts"
import { worldOf } from "./saved.ts"

const Count = Descriptor.ConstructedComponent(Codecs.number)("Documented/Count")
const Ping = Descriptor.Event<number>()("Documented/Ping")
const Gold = Descriptor.ConstructedResource(Codecs.number)("Documented/Gold")
const Gems = Descriptor.ConstructedResource(Codecs.number)("Documented/Gems")
const Root = Schema.defineRoot("Documented")
const Game = Schema.bind(Schema.fragment({ components: { Count }, events: { Ping }, resources: { Gold, Gems } }), Root)
const Flow = Game.StateMachine("Documented/Flow", { A: {}, B: {} })

const unwrap = <T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T => {
  if (!result.ok) throw new Error("expected success")
  return result.value
}
const makeRuntime = () => unwrap(Game.Runtime.make({
  services: Game.Runtime.services(),
  resources: { Gold: 1, Gems: 1 },
  machines: Game.Runtime.machines(Game.Runtime.machine(Flow, { _tag: "A" }))
}))

describe("documented semantics", () => {
  it("a system does not see its own writes as changes, but sees its own events", () => {
    const runtime = makeRuntime()
    const seen: Array<string> = []
    const Bump = Game.System("Documented/Bump", {
      queries: {
        all: Game.Query({ selection: { count: Game.Query.write(Count) } }),
        changed: Game.Query({ selection: { count: Game.Query.read(Count) }, filters: [Game.Query.changed(Count)] })
      },
      events: { read: Game.System.readEvent(Ping), write: Game.System.writeEvent(Ping) }
    }, ({ queries, events }) => {
      seen.push(`changed=${queries.changed.each().length} pings=${events.read.all().length}`)
      const { data } = queries.all
      for (const entity of queries.all.each()) data.count.update(entity, (count) => count + 1)
      events.write.emit(1)
    })
    const Spawn = Game.System("Documented/Spawn", { commands: Game.System.commands(Game.System.spawns(Count)) }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Count, 0]))
    })
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
    runtime.tick(Game.Schedule(Bump))
    runtime.tick(Game.Schedule(Bump))
    expect(seen).toEqual(["changed=1 pings=0", "changed=0 pings=1"])
  })

  it("stateChanged holds for the rest of the schedule that applied the change only", () => {
    const runtime = makeRuntime()
    const seen: Array<boolean> = []
    const Watch = Game.System("Documented/Watch", { machines: { flow: Game.System.machine(Flow) } }, () => {})
    const changed = (label: string) => Game.Schedule.when([Game.Condition.stateChanged(Flow)], Game.System(`Documented/${label}`, {}, () => { seen.push(true) }))
    const ToB = Game.System("Documented/ToB", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
      nextMachines.flow.set({ _tag: "B" })
    })
    runtime.tick(Game.Schedule(Watch, ToB, Game.Schedule.applyStateTransitions(), changed("First"), changed("Second")))
    runtime.tick(Game.Schedule(changed("Later")))
    expect(seen).toEqual([true, true])
  })

  it("restore gives a resource the save lacks the value the runtime was made with", () => {
    const runtime = makeRuntime()
    const Gems2 = Game.System("Documented/Gems", { resources: { gems: Game.System.writeResource(Gems) } }, ({ resources }) => {
      resources.gems.set(7)
    })
    const saved = JSON.parse(JSON.stringify(worldOf(runtime.snapshot())))
    delete saved.resources["Documented/Gems"]
    runtime.tick(Game.Schedule(Gems2))
    expect(runtime.restore(saved)).toEqual({ ok: true, value: undefined })
    expect(runtime.inspect(Game.Inspector("Documented/Read", { resources: { gems: Game.System.readResource(Gems) } }, ({ resources }) => resources.gems.get()))).toBe(1)
  })
})
