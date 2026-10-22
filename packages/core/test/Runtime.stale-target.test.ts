import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import type * as Command from "@typeonce/ritmo/Command"

const Boss = Descriptor.Component<{}>()("StaleTarget/Boss")
const Mark = Descriptor.Component<{}>()("StaleTarget/Mark")
const Game = Schema.bind(Schema.fragment({ components: { Boss, Mark } }))
const Bosses = Game.Inspector("StaleTarget/Bosses", { queries: { bosses: Game.Query({ selection: { boss: Game.Query.read(Boss) } }) } }, ({ queries }) => queries.bosses.each().length)

describe("a spawned id used after its run", () => {
  it("is skipped by despawn and remove, traced, and linted", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.test() } }).success
    let kept: Command.SpawnedId<typeof Game.schema, typeof Game.schema, "StaleTarget/Boss" | "StaleTarget/Mark"> | undefined
    const Spawn = Game.System("StaleTarget/Spawn", { commands: Game.System.commands(Game.System.spawns(Boss, Mark)) }, ({ commands }) => {
      kept = commands.spawn(Game.Command.spawn([Boss, {}], [Mark, {}]))
    })
    const Later = Game.System("StaleTarget/Later", { commands: Game.System.commands(Game.System.despawns(Boss), Game.System.removes(Mark)) }, ({ commands }) => {
      if (kept === undefined) return
      commands.remove(kept, Mark)
      commands.despawn(kept)
    })
    const effects: Array<unknown> = []
    runtime.debug.observe((event) => {
      if (event.type === "deferred") for (const command of event.commands) effects.push(...command.effects)
    })
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
    runtime.tick(Game.Schedule(Later, Game.Schedule.applyDeferred()))
    // The boss stays: an id from an earlier run proves nothing about what it names now.
    expect(runtime.inspect(Bosses)).toBe(1)
    expect(effects.filter((effect) => (effect as { kind: string }).kind === "staleTarget")).toEqual([
      { kind: "staleTarget", entity: kept, command: "remove" },
      { kind: "staleTarget", entity: kept, command: "despawn" }
    ])
    expect(runtime.debug.describe().lints.filter((lint) => lint.code === "stale-target").map((lint) => lint.message)).toEqual([
      `StaleTarget/Later passed remove an id spawned in an earlier run (last entity ${kept}), so it was skipped once`,
      `StaleTarget/Later passed despawn an id spawned in an earlier run (last entity ${kept}), so it was skipped once`
    ])
  })

  it("still lets the run that spawned an id despawn and remove through it", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services() }).success
    const SpawnAndUndo = Game.System("StaleTarget/SpawnAndUndo", {
      commands: Game.System.commands(Game.System.spawns(Boss, Mark), Game.System.despawns(Boss), Game.System.removes(Mark))
    }, ({ commands }) => {
      const first = commands.spawn(Game.Command.spawn([Boss, {}], [Mark, {}]))
      commands.remove(first, Mark)
      commands.despawn(commands.spawn(Game.Command.spawn([Boss, {}])))
    })
    runtime.tick(Game.Schedule(SpawnAndUndo, Game.Schedule.applyDeferred()))
    expect(runtime.inspect(Bosses)).toBe(1)
  })
})
