import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"

const Mode = Descriptor.Component<"a" | "b">()("Identity/Mode")
const Kind = Descriptor.Component<"tree" | "rock">()("Identity/Kind", { immutable: true })
const Game = Schema.bind(Schema.fragment({ components: { Mode, Kind } }))

const spawn = Game.System("Identity/Spawn", { commands: Game.System.commands(Game.System.spawns(Mode, Kind)) }, ({ commands }) => {
  commands.spawn(Game.Command.spawn([Mode, "a"], [Kind, "tree"]))
})

describe("a query naming a look-alike descriptor", () => {
  it("throws when the look-alike adds behaviour the schema does not declare", () => {
    // Same kind and name as the registered plain Mode, but an entity state with transitions.
    const ModeState = Descriptor.EntityState("Identity/Mode", ["a", "b"] as const, { transitions: { a: ["b"], b: [] } })
    const Flip = Game.System("Identity/Flip", {
      queries: { modes: Game.Query({ selection: { mode: Game.Query.write(ModeState) } }) }
    }, ({ queries }) => {
      for (const { data } of queries.modes.each()) data.mode.transition("a", "b")
    })
    const runtime = Game.Runtime.make({ services: Game.Runtime.services() }).success
    runtime.tick(Game.Schedule(spawn, Game.Schedule.applyDeferred()))
    expect(() => runtime.tick(Game.Schedule(Flip))).toThrow(
      "Identity/Mode is plain in this schema, but this query names a descriptor that is an entity state"
    )
  })

  it("throws when the look-alike drops behaviour, such as immutability", () => {
    const PlainKind = Descriptor.Component<"tree" | "rock">()("Identity/Kind")
    // The types reject writing an immutable component; an erased query reaches the runtime check.
    const write = Game.Query.write as (descriptor: unknown) => ReturnType<typeof Game.Query.write<typeof Mode>>
    const Retag = Game.System("Identity/Retag", {
      queries: { kinds: Game.Query({ selection: { kind: write(PlainKind) } }) }
    }, ({ queries }) => {
      for (const { data } of queries.kinds.each()) data.kind.set("a")
    })
    const runtime = Game.Runtime.make({ services: Game.Runtime.services() }).success
    runtime.tick(Game.Schedule(spawn, Game.Schedule.applyDeferred()))
    expect(() => runtime.tick(Game.Schedule(Retag))).toThrow("Identity/Kind is immutable in this schema, but this query names a descriptor that is plain")
  })

  it("accepts a look-alike that behaves like the registered descriptor", () => {
    const SameMode = Descriptor.Component<"a" | "b">()("Identity/Mode")
    const seen: Array<string> = []
    const Read = Game.System("Identity/Read", {
      queries: { modes: Game.Query({ selection: { mode: Game.Query.read(SameMode) } }) }
    }, ({ queries }) => {
      for (const { data } of queries.modes.each()) seen.push(data.mode.get())
    })
    const runtime = Game.Runtime.make({ services: Game.Runtime.services() }).success
    runtime.tick(Game.Schedule(spawn, Game.Schedule.applyDeferred(), Read))
    expect(seen).toEqual(["a"])
  })
})
