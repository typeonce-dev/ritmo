import { describe, expect, it } from "vitest"

import { Random } from "@typeonce/ritmo"

describe("Random", () => {
  it("draws the mulberry32 sequence, continuing exactly from a stored state", () => {
    const random = Random.make(42)
    expect([random.next(), random.next(), random.next()]).toEqual([0.6011037519201636, 0.44829055899754167, 0.8524657934904099])
    const resumed = Random.make(random.state)
    expect(resumed.next()).toBe(random.next())
    expect(Random.make(-1).state).toBe(0xffffffff)
  })

  it("stays in range", () => {
    const random = Random.make(1)
    for (let draw = 0; draw < 10_000; draw++) {
      const unit = random.next()
      expect(unit >= 0 && unit < 1).toBe(true)
      const value = random.range(-3, 5)
      expect(value >= -3 && value < 5).toBe(true)
      const integer = random.integer(-2, 3)
      expect(Number.isInteger(integer) && integer >= -2 && integer < 3).toBe(true)
    }
  })

  it("picks every element, and nothing from an empty list without drawing", () => {
    const random = Random.make(3)
    const seen = new Set<string>()
    for (let draw = 0; draw < 200; draw++) seen.add(random.pick(["a", "b", "c"])!)
    expect([...seen].sort()).toEqual(["a", "b", "c"])
    const state = random.state
    expect(random.pick([])).toBeUndefined()
    expect(random.state).toBe(state)
  })

  it("shuffles into a permutation, leaving the input alone", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
    const shuffled = Random.make(9).shuffle(items)
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items)
    expect(shuffled).not.toEqual(items)
  })

  it("chooses by weight, never an unusable weight", () => {
    const random = Random.make(5)
    const items = [{ id: "rare", weight: 1 }, { id: "never", weight: 0 }, { id: "bad", weight: Number.NaN }, { id: "common", weight: 3 }]
    const counts = new Map<string, number>()
    for (let draw = 0; draw < 40_000; draw++) {
      const chosen = random.weighted(items, (item) => item.weight)!
      counts.set(chosen.id, (counts.get(chosen.id) ?? 0) + 1)
    }
    expect(counts.get("never")).toBeUndefined()
    expect(counts.get("bad")).toBeUndefined()
    expect(counts.get("common")! / 40_000).toBeCloseTo(0.75, 1)
    const state = random.state
    expect(random.weighted(items, () => 0)).toBeUndefined()
    expect(random.weighted([], () => 1)).toBeUndefined()
    expect(random.state).toBe(state)
  })
})

describe("Random preconditions", () => {
  it("throws on bounds that leave nothing to draw, and accepts equal range bounds", () => {
    const random = Random.make(1)
    expect(() => random.integer(5, 2)).toThrow("Random.integer needs whole bounds with min below maxExclusive, got [5, 2)")
    expect(() => random.integer(3, 3)).toThrow("Random.integer needs whole bounds")
    expect(() => random.integer(0, 2.5)).toThrow("Random.integer needs whole bounds")
    expect(() => random.range(2, 1)).toThrow("Random.range needs finite bounds with min <= max, got [2, 1)")
    expect(() => random.range(0, Infinity)).toThrow("Random.range needs finite bounds")
    expect(random.range(4, 4)).toBe(4)
  })

  it("calls weight once per item", () => {
    const calls: Array<string> = []
    const pick = Random.make(3).weighted(["a", "b", "c"], (item) => {
      calls.push(item)
      return 1
    })
    expect(calls).toEqual(["a", "b", "c"])
    expect(["a", "b", "c"]).toContain(pick)
  })
})


describe("Random sequences", () => {
  it("keeps the values a game draws from a fixed seed", () => {
    const drawn = [1, 0x5eed, 0xffffffff].map((seed) => {
      const random = Random.make(seed)
      return {
        integer: [random.integer(0, 10), random.integer(-5, 5), random.integer(0, 2 ** 32), random.integer(-(2 ** 31), 2 ** 31), random.integer(1, 7)],
        range: [random.range(0, 1), random.range(-3, 5), random.range(-1e300, 1e300), random.range(2, 2)],
        pick: [random.pick(["a", "b", "c", "d"]), random.pick([1, 2, 3])],
        weighted: [random.weighted(["x", "y", "z"], (item) => item === "x" ? 1 : item === "y" ? 2 : 3), random.weighted([1, 2, 3, 4], (n) => n * 1e300)],
        shuffle: random.shuffle([1, 2, 3, 4, 5, 6, 7, 8]),
        state: random.state
      }
    })
    expect(drawn).toEqual([
      {
        integer: [6, -5, 2265367787, 2066098173, 6],
        range: [0.281103502959013, 1.902710884809494, 4.41486282274127e+299, 2],
        pick: ["d", 2],
        weighted: ["y", 2],
        shuffle: [8, 5, 7, 6, 3, 1, 2, 4],
        state: 2271577893
      },
      {
        integer: [7, -3, 4088390650, -1710428797, 3],
        range: [0.6541043182369322, -0.48657370544970036, -3.84251281619072e+299, 2],
        pick: ["b", 3],
        weighted: ["y", 4],
        shuffle: [2, 7, 1, 6, 5, 8, 3, 4],
        state: 2271602193
      },
      {
        integer: [8, -4, 3073704848, 1907222788, 6],
        range: [0.5391399988438934, 2.443981910124421, -4.885580716654653e+298, 2],
        pick: ["d", 3],
        weighted: ["y", 3],
        shuffle: [2, 3, 7, 1, 8, 5, 4, 6],
        state: 2271577891
      }
    ])
  })
})

describe("Random edge cases", () => {
  it("draws every low bit of a span wider than 2**32, and refuses one past Number.MAX_SAFE_INTEGER", () => {
    const random = Random.make(7)
    let odd = 0
    let high = 0
    for (let draw = 0; draw < 100_000; draw++) {
      const value = random.integer(0, 2 ** 40)
      expect(Number.isSafeInteger(value) && value >= 0 && value < 2 ** 40).toBe(true)
      if (value % 2 === 1) odd++
      if (value >= 2 ** 39) high++
    }
    expect(odd / 100_000).toBeCloseTo(0.5, 1)
    expect(high / 100_000).toBeCloseTo(0.5, 1)
    const widest = random.integer(-(2 ** 52), 2 ** 52 - 1)
    expect(widest >= -(2 ** 52) && widest < 2 ** 52 - 1).toBe(true)
    expect(() => random.integer(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
      .toThrow(`Random.integer needs a span of at most Number.MAX_SAFE_INTEGER, got [${-Number.MAX_SAFE_INTEGER}, ${Number.MAX_SAFE_INTEGER})`)
  })

  it("stays finite and in range when max - min overflows", () => {
    const random = Random.make(11)
    for (let draw = 0; draw < 1_000; draw++) {
      const value = random.range(-1e308, 1e308)
      expect(Number.isFinite(value) && value >= -1e308 && value <= 1e308).toBe(true)
    }
    expect(random.range(-Number.MAX_VALUE, Number.MAX_VALUE)).not.toBe(Infinity)
  })

  it("refuses usable weights whose total overflows", () => {
    const random = Random.make(13)
    const state = random.state
    expect(() => random.weighted(["a", "b"], () => 1e308)).toThrow("Random.weighted needs usable weights that add up to a finite total, got Infinity")
    expect(random.state).toBe(state)
  })
})
