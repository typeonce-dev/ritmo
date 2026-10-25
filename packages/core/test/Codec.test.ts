import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"
import type { StandardSchema } from "@typeonce/ritmo/Descriptor"
import * as Codecs from "./codecs.ts"
import { worldOf } from "./saved.ts"

// A schema whose check runs asynchronously: Ritmo validates synchronously, so it always fails.
const asyncNumber: StandardSchema<number, number> = {
  "~standard": { version: 1, vendor: "test", validate: async (raw) => ({ value: raw as number }) }
}

// A codec whose encode refuses negative values, to show a snapshot that cannot be saved.
const unsigned = {
  ...Codecs.integer,
  "~encode": Codecs.primitiveOf("a value of 0 or more", (raw): raw is number => typeof raw === "number" && raw >= 0)
}

const Inventory = Descriptor.ConstructedResource(Codecs.map(Codecs.integer))("Codec/Inventory")
const Debt = Descriptor.ConstructedResource(unsigned)("Codec/Debt")
const Player = Descriptor.Tag("Codec/Player")
const Delayed = Descriptor.ConstructedResource(asyncNumber)("Codec/Delayed")

const Game = Schema.bind(Schema.fragment({ components: { Player }, resources: { Inventory, Debt } }))

// A state whose data transforms: a cart of item counts, saved as its entries.
const items = Codecs.map(Codecs.integer)
const cart = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (raw: unknown) => {
      const decoded = items["~standard"].validate((raw as { readonly items?: unknown } | null)?.items)
      return "value" in decoded ? { value: { items: decoded.value } } : decoded
    }
  },
  "~encode": {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value: { items: [...(value as { readonly items: ReadonlyMap<string, number> }).items] } })
    }
  }
} as Descriptor.Codec<{ readonly items: ReadonlyMap<string, number> }, { readonly items: ReadonlyArray<readonly [string, number]> }> & {
  readonly "~encode": StandardSchema<{ readonly items: ReadonlyMap<string, number> }, { readonly items: ReadonlyArray<readonly [string, number]> }>
}
const Mode = Game.StateMachine("Codec/Mode", { Idle: {}, Shopping: cart })

const makeRuntime = (debt: number) => {
  const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Inventory: [["coin", 3]], Debt: debt } })
  if (!made.ok) throw new Error("invalid fixture")
  return made.value
}

describe("Codecs", () => {
  it("decodes raw values from their saved form, and saves them back through encode", () => {
    const runtime = makeRuntime(0)
    const Spawn = Game.System("Codec/Spawn", {
      commands: Game.System.commands(Game.System.spawns(Player)),
      resources: { inventory: Game.System.writeResource(Inventory) }
    }, ({ commands, resources }) => {
      commands.spawn(Game.Command.spawn([Player, {}]))
      expect(resources.inventory.get()).toEqual(new Map([["coin", 3]]))
      expect(resources.inventory.setRaw([["coin", 4], ["gem", 1]]).ok).toBe(true)
    })
    expect(runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred())).ok).toBe(true)

    const saved = worldOf(runtime.snapshot())
    expect(saved.resources["Codec/Inventory"]).toEqual([["coin", 4], ["gem", 1]])
    expect(saved.entities[0]!.components).toEqual({ "Codec/Player": {} })

    const loaded = makeRuntime(0)
    expect(loaded.restore(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true, value: undefined })
    const Read = Game.Inspector("Codec/Read", {
      queries: { players: Game.Query({ selection: { player: Game.Query.read(Player) } }) },
      resources: { inventory: Game.System.readResource(Inventory) }
    }, ({ queries, resources }) => ({ players: queries.players.each().length, inventory: resources.inventory.get() }))
    expect(loaded.inspect(Read)).toEqual({ players: 1, inventory: new Map([["coin", 4], ["gem", 1]]) })
  })

  it("fails a snapshot and a checksum whose encode rejects a value, naming it", () => {
    const failed = {
      ok: false,
      error: { _tag: "UnencodableResource", name: "Codec/Debt", error: { _tag: "SchemaIssues", issues: [{ message: "Expected a value of 0 or more", path: [] }] } }
    }
    expect(makeRuntime(-2).snapshot()).toEqual(failed)
    expect(makeRuntime(-2).checksum()).toEqual(failed)
  })

  it("rejects raw values with the schema's issues", () => {
    const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Inventory: [["coin", 1.5]], Debt: 0 } })
    expect(made.ok ? undefined : made.error).toEqual({
      resources: { Inventory: { _tag: "SchemaIssues", issues: [{ message: "Expected an integer", path: [0, 1] }] } }
    })
  })

  it("fails a schema that validates asynchronously", () => {
    const Async = Schema.bind(Schema.fragment({ resources: { Delayed } }))
    const made = Async.Runtime.make({ services: Async.Runtime.services(), resources: { Delayed: 1 } })
    expect(made.ok ? undefined : made.error).toEqual({
      resources: {
        Delayed: {
          _tag: "SchemaIssues",
          issues: [{ message: "Asynchronous validation is not supported: Ritmo validates synchronously, so use a schema without async checks" }]
        }
      }
    })
  })

  it("saves a machine state's data through its encode, and loads it back", () => {
    const made = Game.Runtime.make({
      services: Game.Runtime.services(),
      resources: { Inventory: [], Debt: 0 },
      machines: Game.Runtime.machines(Game.Runtime.machine(Mode, { _tag: "Shopping", items: new Map([["apple", 2]]) }))
    })
    if (!made.ok) throw new Error("invalid fixture")
    const saved = worldOf(made.value.snapshot())
    expect(saved.machines["Codec/Mode"]).toEqual({ _tag: "Shopping", items: [["apple", 2]] })
    expect(made.value.restore(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true, value: undefined })
    const Read = Game.Inspector("Codec/ReadMode", { machines: { mode: Game.System.machine(Mode) } }, ({ machines }) => machines.mode.get())
    expect(made.value.inspect(Read)).toEqual({ _tag: "Shopping", items: new Map([["apple", 2]]) })
  })
})
