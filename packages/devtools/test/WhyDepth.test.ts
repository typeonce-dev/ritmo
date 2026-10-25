import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import { Session } from "@typeonce/ritmo-devtools"

const hostClock = HostClock.test()

const Health = Descriptor.Component<number>()("Why/Health")
const Armor = Descriptor.Component<number>()("Why/Armor")
const Position = Descriptor.Component<{ readonly x: number }>()("Why/Position")
const Aim = Descriptor.Resource<{ readonly target: number }>()("Why/Aim")
const Heat = Descriptor.Resource<number>()("Why/Heat")
const Cool = Descriptor.Resource<number>()("Why/Cool")
const Damage = Descriptor.Event<{ readonly amount: number }>()("Why/Damage")
const Game = Schema.bind(Schema.fragment({
  components: { Health, Armor, Position },
  resources: { Aim, Heat, Cool },
  events: { Damage }
}))

const Spawn = Game.System("Why/Spawn", { commands: Game.System.commands(Game.System.spawns(Health, Armor, Position)) }, ({ commands }) => {
  commands.spawn(Game.Command.spawn([Health, 100], [Armor, 5], [Position, { x: 0 }]))
  commands.spawn(Game.Command.spawn([Position, { x: 10 }]))
  commands.spawn(Game.Command.spawn([Position, { x: 20 }]))
})
const AimAtNewest = Game.System("Why/AimAtNewest", { resources: { aim: Game.System.writeResource(Aim) } }, ({ resources }) => {
  resources.aim.set({ target: 1 })
})
const Hitscan = Game.System("Why/Hitscan", {
  resources: { aim: Game.System.readResource(Aim) },
  queries: { targets: Game.Query({ selection: { position: Game.Query.read(Position) } }) },
  events: { damage: Game.System.writeEvent(Damage) }
}, ({ events }) => {
  events.damage.emit({ amount: 30 })
})
const ApplyDamage = Game.System("Why/ApplyDamage", {
  events: { damage: Game.System.readEvent(Damage) },
  queries: { hurt: Game.Query({ selection: { health: Game.Query.write(Health), armor: Game.Query.read(Armor) } }) }
}, ({ events, queries }) => {
  const total = events.damage.all().reduce((sum, damage) => sum + damage.amount, 0)
  for (const match of queries.hurt.each()) match.data.health.update((health) => health - total)
})

const setup = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
const update = Game.Schedule(AimAtNewest, Hitscan, ApplyDamage)

const play = () => {
  const runtime = Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: { Aim: { target: 0 }, Heat: 0, Cool: 0 },
    debug: { hostClock }
  }).value
  const session = Session.make(runtime, { hostClock, schedules: { setup, update } })
  session.run("setup")
  session.run("update", { frames: 2 })
  return session
}

const HeatUp = Game.System("Why/HeatUp", {
  resources: { cool: Game.System.readResource(Cool), heat: Game.System.writeResource(Heat) }
}, ({ resources }) => {
  resources.heat.set(resources.cool.get() + 1)
})
const CoolDown = Game.System("Why/CoolDown", {
  resources: { heat: Game.System.readResource(Heat), cool: Game.System.writeResource(Cool) }
}, ({ resources }) => {
  resources.cool.set(resources.heat.get() + 1)
})

describe("why with depth", () => {
  it("follows each change back through the reads its systems declared, naming who produced each", () => {
    const session = play()
    expect(session.why(1, Health, { depth: 3, limit: 1 }).text).toBe([
      "e1 Why/Health is now 40; last 1 changes (oldest first):",
      "could have spawned it: Why/Spawn",
      "indented: what each writing system declared it reads, and the latest fact that could have produced it (declared: possible causes, not observed reads)",
      "f3 update  Why/ApplyDamage  write e1 Why/Health 70 -> 40",
      "  read Why/Damage [{amount:30}] (declared), emitted by Why/Hitscan at f3",
      "    read Why/Position of 3 matching entities now (declared; the trace does not say which it read)",
      "    …+1 more declared reads of Why/Hitscan (raise limit to see them)",
      "  …+1 more declared reads of Why/ApplyDamage (raise limit to see them)"
    ].join("\n"))
    const chain = session.why(1, Health, { depth: 3 }).data.filter((line) => line.frame === 3 || line.depth > 0).slice(-6)
    expect(chain.map((line) => `${line.depth} ${line.text}`)).toEqual([
      "0 write e1 Why/Health 70 -> 40",
      "1 read Why/Damage [{amount:30}] (declared), emitted by Why/Hitscan at f3",
      "2 read Why/Position of 3 matching entities now (declared; the trace does not say which it read)",
      // An equal-value write at f3 did not produce the value: the change at f2 did.
      "2 read resource Why/Aim {target:1} (declared), written by Why/AimAtNewest at f2",
      "1 read e1 Why/Armor 5 (declared), spawned by Why/Spawn at f1",
      "2 Why/Spawn declares no other reads (declared)"
    ])
    expect(chain.map((line) => [line.kind, line.system, line.subject])).toEqual([
      ["write", "Why/ApplyDamage", "Why/Health"],
      ["read", "Why/Hitscan", "Why/Damage"],
      ["read", undefined, "Why/Position"],
      ["read", "Why/AimAtNewest", "Why/Aim"],
      ["read", "Why/Spawn", "Why/Armor"],
      ["read", undefined, "Why/Spawn"]
    ])
  })

  it("prints one level of reads per depth step", () => {
    const session = play()
    const lines = session.why(1, Health, { depth: 2 }).data
    expect(Math.max(...lines.map((line) => line.depth))).toBe(1)
    expect(lines.filter((line) => line.frame === 3 || line.depth > 0).slice(-3).map((line) => line.text)).toEqual([
      "write e1 Why/Health 70 -> 40",
      "read Why/Damage [{amount:30}] (declared), emitted by Why/Hitscan at f3",
      "read e1 Why/Armor 5 (declared), spawned by Why/Spawn at f1"
    ])
    // The spawn's system declares no reads: said, not left out.
    expect(lines[1]?.text).toBe("Why/Spawn declares no other reads (declared)")
  })

  it("prints exactly the changes at depth 1, the default", () => {
    const session = play()
    const plain = session.why(1, Health)
    expect(session.why(1, Health, { depth: 1 }).text).toBe(plain.text)
    expect(plain.data.every((line) => line.depth === 0 && line.kind !== "read")).toBe(true)
    expect(plain.text).toBe([
      "e1 Why/Health is now 40; last 3 changes (oldest first):",
      "could have spawned it: Why/Spawn",
      "f1 setup  Why/Spawn  applyDeferred: spawn e1 Why/Health=100 Why/Armor=5 Why/Position={x:0}",
      "f2 update  Why/ApplyDamage  write e1 Why/Health 100 -> 70",
      "f3 update  Why/ApplyDamage  write e1 Why/Health 70 -> 40"
    ].join("\n"))
  })

  it("stops at a system already in the chain", () => {
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(),
      resources: { Aim: { target: 0 }, Heat: 0, Cool: 0 },
      debug: { hostClock }
    }).value
    const session = Session.make(runtime, { hostClock, schedules: { update: Game.Schedule(HeatUp, CoolDown) } })
    session.run("update", { frames: 2 })
    expect(session.whyResource(Heat, { depth: 10, limit: 1 }).text).toBe([
      "Why/Heat is now 3; last 1 changes (oldest first):",
      "indented: what each writing system declared it reads, and the latest fact that could have produced it (declared: possible causes, not observed reads)",
      "f2 update  Why/HeatUp  resource Why/Heat 1 -> 3",
      "  read resource Why/Cool 2 (declared), written by Why/CoolDown at f1",
      "    read resource Why/Heat 1 (declared), written by Why/HeatUp at f1 (cycle: not followed)"
    ].join("\n"))
  })

  it("follows a resource's writers with whyResource", () => {
    const session = play()
    expect(session.whyResource(Aim, { depth: 2 }).text).toBe([
      "Why/Aim is now {target:1}; last 1 changes (oldest first):",
      "indented: what each writing system declared it reads, and the latest fact that could have produced it (declared: possible causes, not observed reads)",
      "f2 update  Why/AimAtNewest  resource Why/Aim {target:0} -> {target:1}",
      "  Why/AimAtNewest declares no other reads (declared)"
    ].join("\n"))
    expect(session.whyResource(Aim).text).toBe([
      "Why/Aim is now {target:1}; last 1 changes (oldest first):",
      "f2 update  Why/AimAtNewest  resource Why/Aim {target:0} -> {target:1}"
    ].join("\n"))
  })

  it("names entities in read lines with the session's labels", () => {
    const Labels = Game.Inspector("labels", {
      queries: { armored: Game.Query({ selection: { armor: Game.Query.read(Armor) } }) }
    }, ({ queries }) => new Map(queries.armored.each().map((match) => [match.entity.id, "hero"] as const)))
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(),
      resources: { Aim: { target: 0 }, Heat: 0, Cool: 0 },
      debug: { hostClock }
    }).value
    const session = Session.make(runtime, { hostClock, schedules: { setup, update }, labels: Labels })
    session.run("setup")
    session.run("update")
    const armor = session.why(1, Health, { depth: 2 }).data.find((line) => line.subject === Armor.name)
    expect(armor).toMatchObject({ kind: "read", depth: 1, entity: 1, label: "hero", text: "read hero e1 Why/Armor 5 (declared), spawned by Why/Spawn at f1" })
  })
})
