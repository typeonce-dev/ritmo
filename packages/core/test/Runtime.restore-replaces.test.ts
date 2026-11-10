import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Codecs from "./codecs.ts"
import { worldOf } from "./saved.ts"

// A load leaves nothing of the world it replaced.
const Root = Schema.defineRoot("ReplacesTest")
const Hp = Descriptor.ConstructedComponent(Codecs.number)("Replaces/Hp")
const Shield = Descriptor.ConstructedComponent(Codecs.number)("Replaces/Shield")
const Gold = Descriptor.ConstructedResource(Codecs.number)("Replaces/Gold")
const Gems = Descriptor.ConstructedResource(Codecs.number)("Replaces/Gems")
const Scratch = Descriptor.TransientResource<number>()("Replaces/Scratch")
const Hit = Descriptor.Event<number>()("Replaces/Hit")
const Game = Schema.bind(Schema.fragment({
  components: { Hp, Shield },
  resources: { Gold, Gems, Scratch },
  events: { Hit }
}), Root)
const Flow = Game.StateMachine("Replaces/Flow", { Menu: {}, Playing: {}, Over: {} })

const make = () => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: { Gold: 10, Gems: 1, Scratch: 0 },
    machines: Game.Runtime.machines(Game.Runtime.machine(Flow, { _tag: "Menu" }))
  })
  if (!made.ok) throw new Error("the resources did not validate")
  return made.value
}
type Runtime = ReturnType<typeof make>

const Spawn = (count: number) => Game.System("Replaces/Spawn", { commands: Game.System.commands(Game.System.spawns(Hp, Shield)) }, ({ commands }) => {
  for (let index = 0; index < count; index++) commands.spawn(Game.Command.spawn([Hp, index], [Shield, 1]))
})
const spawn = (runtime: Runtime, count: number) =>
  expect(runtime.tick(Game.Schedule(Spawn(count), Game.Schedule.applyDeferred())).ok).toBe(true)
const DropShields = Game.System("Replaces/DropShields", {
  queries: { shielded: Game.Query({ selection: { shield: Game.Query.read(Shield) } }) },
  commands: Game.System.commands(Game.System.removes(Shield))
}, ({ queries, commands }) => {
  for (const entity of queries.shielded.each()) commands.remove(entity, Shield)
})
const Despawn = Game.System("Replaces/Despawn", {
  queries: { all: Game.Query({ selection: { hp: Game.Query.read(Hp) } }) },
  commands: Game.System.commands(Game.System.despawns(Hp))
}, ({ queries, commands }) => {
  for (const entity of queries.all.each()) commands.despawn(entity)
})
const Strike = Game.System("Replaces/Strike", { events: { hit: Game.System.writeEvent(Hit) } }, ({ events }) => {
  events.hit.emit(1)
})
const Spend = Game.System("Replaces/Spend", {
  resources: { gold: Game.System.writeResource(Gold), gems: Game.System.writeResource(Gems), scratch: Game.System.writeResource(Scratch) },
  nextMachines: { flow: Game.System.nextState(Flow) }
}, ({ resources, nextMachines }) => {
  resources.gold.set(3)
  resources.gems.set(7)
  resources.scratch.set(5)
  nextMachines.flow.set({ _tag: "Over" })
})

/** What a reader of every stream a load drops sees on each run. */
const watcher = () => {
  const seen: Array<{ despawned: Array<number>; removed: Array<number>; hits: Array<number>; lagged: Array<string> }> = []
  const Watch = Game.System("Replaces/Watch", {
    despawned: { entities: Game.System.readDespawned() },
    removed: { shields: Game.System.readRemoved(Shield) },
    events: { hits: Game.System.readEvent(Hit) },
    transitionEvents: { flow: Game.System.readTransitionEvent(Flow) }
  }, ({ despawned, removed, events, transitionEvents }) => {
    seen.push({
      despawned: despawned.entities.all().map(Number),
      removed: removed.shields.all().map(Number),
      hits: [...events.hits.all()],
      lagged: [
        ...(despawned.entities.lagged() ? ["despawned"] : []),
        ...(removed.shields.lagged() ? ["removed"] : []),
        ...(events.hits.lagged() ? ["hits"] : []),
        ...(transitionEvents.flow.lagged() ? ["flow"] : [])
      ]
    })
  })
  return { Watch, seen }
}

const savedWith = (build: (runtime: Runtime) => void): unknown => {
  const runtime = make()
  build(runtime)
  return JSON.parse(JSON.stringify(worldOf(runtime.snapshot())))
}

const Read = Game.Inspector("Replaces/Read", {
  resources: { gold: Game.System.readResource(Gold), gems: Game.System.readResource(Gems), scratch: Game.System.readResource(Scratch) },
  machines: { flow: Game.System.machine(Flow) }
}, ({ resources, machines }) => ({
  gold: resources.gold.get(),
  gems: resources.gems.get(),
  scratch: resources.scratch.get(),
  flow: machines.flow.get()._tag
}))

describe("a load leaves nothing of the world it replaced", () => {
  it("publishes no removal or despawn of the replaced world, and every reader that ran before is lagged", () => {
    const save = savedWith((runtime) => spawn(runtime, 1))
    const runtime = make()
    const { Watch, seen } = watcher()
    spawn(runtime, 3)
    runtime.tick(Game.Schedule(Watch))
    // Unread when the load comes: a removal, a despawn, an event.
    runtime.tick(Game.Schedule(DropShields, Strike, Game.Schedule.applyDeferred()))
    expect(runtime.restore(save).ok).toBe(true)
    runtime.tick(Game.Schedule(Watch))
    runtime.tick(Game.Schedule(Watch))
    expect(seen).toEqual([
      { despawned: [], removed: [], hits: [], lagged: [] },
      { despawned: [], removed: [], hits: [], lagged: ["despawned", "removed", "hits", "flow"] },
      { despawned: [], removed: [], hits: [], lagged: [] }
    ])
  })

  it("gives a reader whose first run comes after the load nothing to read, and no lag", () => {
    const save = savedWith((runtime) => spawn(runtime, 1))
    const runtime = make()
    const { Watch, seen } = watcher()
    spawn(runtime, 3)
    runtime.tick(Game.Schedule(Despawn, Strike, Game.Schedule.applyDeferred()))
    expect(runtime.restore(save).ok).toBe(true)
    runtime.tick(Game.Schedule(Watch))
    expect(seen).toEqual([{ despawned: [], removed: [], hits: [], lagged: [] }])
  })

  it("keeps an event the host sent and no system has read", () => {
    const save = savedWith(() => {})
    const runtime = make()
    const { Watch, seen } = watcher()
    runtime.send(Hit, 9)
    expect(runtime.restore(save).ok).toBe(true)
    runtime.tick(Game.Schedule(Watch))
    expect(seen.map((run) => run.hits)).toEqual([[9]])
  })

  it("reports what the load despawns and removes only after it, as usual", () => {
    const save = savedWith((runtime) => spawn(runtime, 2))
    const runtime = make()
    const { Watch, seen } = watcher()
    expect(runtime.restore(save).ok).toBe(true)
    runtime.tick(Game.Schedule(Watch))
    runtime.tick(Game.Schedule(DropShields, Game.Schedule.applyDeferred()))
    runtime.tick(Game.Schedule(Despawn, Game.Schedule.applyDeferred()))
    runtime.tick(Game.Schedule(Watch))
    expect(seen.at(-1)).toEqual({ despawned: [1, 2], removed: [1, 2], hits: [], lagged: [] })
  })

  it("gives every transient resource the value the runtime was made with", () => {
    const save = savedWith(() => {})
    const runtime = make()
    runtime.tick(Game.Schedule(Spend))
    expect(runtime.inspect(Read).scratch).toBe(5)
    expect(runtime.restore(save).ok).toBe(true)
    expect(runtime.inspect(Read).scratch).toBe(0)
  })

  it("gives a resource and a machine the save lacks the values the runtime was made with, whatever each runtime held", () => {
    const raw = savedWith((runtime) => spawn(runtime, 2)) as { resources: Record<string, unknown>; machines: Record<string, unknown> }
    delete raw.resources["Replaces/Gems"]
    delete raw.machines["Replaces/Flow"]
    const played = make()
    played.tick(Game.Schedule(Spend, Game.Schedule.applyStateTransitions()))
    expect(played.inspect(Read)).toEqual({ gold: 3, gems: 7, scratch: 5, flow: "Over" })
    const fresh = make()
    expect(played.restore(raw).ok).toBe(true)
    expect(fresh.restore(raw).ok).toBe(true)
    expect(played.inspect(Read)).toEqual({ gold: 10, gems: 1, scratch: 0, flow: "Menu" })
    expect(fresh.inspect(Read)).toEqual(played.inspect(Read))
    expect(played.checksum()).toEqual(fresh.checksum())
  })

  it("shows every resource as changed to a reader that ran before", () => {
    const save = savedWith(() => {})
    const runtime = make()
    const changed: Array<boolean> = []
    const Watch = Game.System("Replaces/WatchScratch", { resources: { scratch: Game.System.changedResource(Scratch) } }, ({ resources }) => {
      changed.push(resources.scratch.changed())
    })
    runtime.tick(Game.Schedule(Watch))
    runtime.tick(Game.Schedule(Watch))
    expect(runtime.restore(save).ok).toBe(true)
    runtime.tick(Game.Schedule(Watch))
    expect(changed).toEqual([true, false, true])
  })
})
