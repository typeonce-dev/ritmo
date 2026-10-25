import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import { Session } from "@typeonce/ritmo-devtools"

const hostClock = HostClock.test()

const Name = Descriptor.Component<string>()("Game/Name")
const { relation: Targeting } = Descriptor.Relation("Game/Targeting", "Game/TargetedBy")
const Game = Schema.bind(Schema.fragment({ components: { Name }, relations: { Targeting } }))

const Named = Game.Query({ selection: { name: Game.Query.read(Name) } })

const Spawn = Game.System("Game/Spawn", {
  commands: Game.System.commands(Game.System.spawns(Name), Game.System.relates(Targeting))
}, ({ commands }) => {
  const target = commands.spawn(Game.Command.spawn([Name, "target"]))
  commands.spawn(Game.Command.relate(Game.Command.spawn([Name, "chaser"]), Targeting, target))
})
const Kill = Game.System("Game/Kill", {
  queries: { named: Named },
  commands: Game.System.commands(Game.System.despawns(Name))
}, ({ queries, commands }) => {
  for (const match of queries.named.each()) if (match.data.name.get() === "target") commands.despawn(match.entity)
})
const DropTargets = Game.System("Game/DropTargets", {
  droppedRelations: { lost: Game.System.readDroppedRelations(Targeting) }
}, ({ droppedRelations }) => {
  droppedRelations.lost.all()
})

describe("dropped relations in a session", () => {
  it("journals each edge a target's despawn drops and describes its readers", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock } }).value
    const setup = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
    const update = Game.Schedule(Kill, Game.Schedule.applyDeferred(), DropTargets)
    const session = Session.make(runtime, { hostClock, schedules: { setup, update } })
    session.run("setup")
    session.run("update")
    expect(session.journal({ kinds: ["effect"] }).data.map((line) => line.text)).toContain(
      "applyDeferred: Game/Targeting from e2 to e1 dropped: e1 despawned"
    )
    expect(session.describe().text).toContain("reads dropped relations: Game/Targeting")
  })
})
