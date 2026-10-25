import { describe, expect, it } from "vitest"
import type { Snapshot } from "@typeonce/ritmo"
import { Desync } from "@typeonce/ritmo-devtools"

const save = (overrides: Partial<Snapshot.WorldSnapshot>): Snapshot.WorldSnapshot => ({
  version: 3,
  gameVersion: 0,
  nextEntity: 3,
  entities: [
    { id: 1, components: { "Game/Position": { x: 1, y: 2 }, "Game/Name": "left" } },
    { id: 2, components: { "Game/Position": { x: 5, y: 2 } } }
  ],
  relations: {},
  resources: { "Game/Score": [0, 1] },
  machines: { "Game/Round": { _tag: "Playing" } },
  scopes: {},
  ...overrides
})

describe("Desync.compare", () => {
  it("reports equal saves as equal", () => {
    const compared = Desync.compare(save({}), save({}))
    expect(compared.data).toEqual([])
    expect(compared.text).toBe("The saves are equal.")
  })

  it("lists each differing value by entity and path, then resources and machines", () => {
    const theirs = save({
      nextEntity: 4,
      entities: [
        { id: 1, components: { "Game/Position": { x: 1, y: 3 }, "Game/Name": "left" } },
        { id: 3, components: { "Game/Position": { x: 0, y: 0 } } }
      ],
      resources: { "Game/Score": [1, 1] },
      machines: { "Game/Round": { _tag: "Over", winner: 0 } }
    })
    const compared = Desync.compare(save({}), theirs)
    expect(compared.data.map((difference) => difference.path)).toEqual([
      "nextEntity",
      "entity 1 Game/Position.y",
      "entity 2",
      "entity 3",
      "resource Game/Score[0]",
      "machine Game/Round._tag",
      "machine Game/Round.winner"
    ])
    expect(compared.text).toContain("7 differences (mine -> theirs):")
    expect(compared.text).toContain("  e1 Game/Position.y: 2 -> 3")
  })

  it("prints -0 with its sign, so a -0 / 0 difference does not read 0 -> 0", () => {
    const theirs = save({ resources: { "Game/Score": [-0, 1] } })
    expect(Desync.compare(save({}), theirs).text).toContain("resource Game/Score[0]: 0 -> -0")
  })
})
