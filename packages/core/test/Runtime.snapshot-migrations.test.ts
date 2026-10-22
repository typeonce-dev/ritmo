import { describe, expect, it } from "vitest"
import { Decode, Descriptor, Schema, Snapshot } from "@typeonce/ritmo"

const Gold = Descriptor.ConstructedResource(Decode.number)("Migrations/Gold")
const Game = Schema.bind(Schema.fragment({ resources: { Gold } }))
const Coins = Game.Inspector("Migrations/Coins", { resources: { gold: Game.System.readResource(Gold) } }, ({ resources }) => resources.gold.get())

const saves = Snapshot.migrations(
  // Version 1 renamed the resource.
  Snapshot.migration(1, (save) => {
    const { "Migrations/Coins": coins, ...rest } = save.resources
    return { ...save, resources: { ...rest, "Migrations/Gold": coins } }
  }),
  // Version 2 doubled every amount.
  Snapshot.migration(2, (save) => ({ ...save, resources: { ...save.resources, "Migrations/Gold": (save.resources["Migrations/Gold"] as number) * 2 } }))
)
const makeRuntime = () => Game.Runtime.make({ services: Game.Runtime.services(), resources: { Gold: 0 }, saves })
const unwrap = <T>(result: { readonly _tag: "Success"; readonly success: T } | { readonly _tag: "Failure" }): T => {
  if (result._tag === "Failure") throw new Error("expected success")
  return result.success
}
const old = { version: 2, nextEntity: 1, entities: [], relations: {}, resources: { "Migrations/Coins": 5 }, machines: {}, scopes: {} }

describe("save migrations", () => {
  it("runs every step after the save's game version, in order, then validates", () => {
    const runtime = unwrap(makeRuntime())
    expect(runtime.restore(old)).toEqual({ _tag: "Success", success: undefined })
    expect(runtime.inspect(Coins)).toBe(10)
    expect(runtime.snapshot().gameVersion).toBe(2)

    const fromOne = { ...old, gameVersion: 1, resources: { "Migrations/Gold": 4 } }
    expect(runtime.restore(fromOne)).toEqual({ _tag: "Success", success: undefined })
    expect(runtime.inspect(Coins)).toBe(8)

    // A current save restores unchanged.
    const current = runtime.snapshot()
    expect(runtime.restore(JSON.parse(JSON.stringify(current)))).toEqual({ _tag: "Success", success: undefined })
    expect(runtime.inspect(Coins)).toBe(8)
  })

  it("rejects a save newer than the last step, and checks each step's output", () => {
    const runtime = unwrap(makeRuntime())
    expect(runtime.restore({ ...old, gameVersion: 3 })).toEqual({ _tag: "Failure", failure: { _tag: "NewerGameVersion", gameVersion: 3, latest: 2 } })
    const broken = Game.Runtime.make({
      services: Game.Runtime.services(),
      resources: { Gold: 0 },
      saves: Snapshot.migrations(Snapshot.migration(1, (save) => ({ ...save, entities: "none" as never })))
    })
    expect(unwrap(broken).restore(old)).toEqual({ _tag: "Failure", failure: { _tag: "InvalidSnapshot", path: "$.entities" } })
  })

  it("throws when steps are not numbered 1, 2, 3, ... in order", () => {
    const steps: ReadonlyArray<Snapshot.Migration> = [Snapshot.migration(2, (save) => save)]
    expect(() => Snapshot.migrations(...(steps as [Snapshot.Migration]))).toThrow("migration 2 is listed where migration 1 belongs")
  })
})
