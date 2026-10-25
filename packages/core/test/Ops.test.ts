import { describe, expect, it } from "vitest"

import { Ops } from "@typeonce/ritmo"

// Inputs come from integer draws assembled into doubles bit by bit, never from
// the engine's own Math functions, so every platform feeds the same numbers.
const bits = new Float64Array(1)
const halves = new Uint32Array(bits.buffer)
const words = new BigUint64Array(bits.buffer)
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0

const generator = (seed: number) => {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return (t ^ (t >>> 14)) >>> 0
  }
  /** A double with a random sign and mantissa and an exponent in [minExponent, maxExponent]. */
  return (minExponent: number, maxExponent: number): number => {
    const exponent = minExponent + (next() % (maxExponent - minExponent + 1))
    halves[HI] = ((next() & 0x80000000) | ((exponent + 1023) << 20) | (next() & 0xfffff)) >>> 0
    halves[1 - HI] = next()
    return bits[0]!
  }
}

/** FNV-1a over the exact bits of every value. */
const hashOf = (values: ReadonlyArray<number>): string => {
  let hash = 0xcbf29ce484222325n
  for (const value of values) {
    bits[0] = value
    hash = ((hash ^ words[0]!) * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, "0")
}

const COUNT = 10_000

const sample = (count: number, draw: () => number): Array<number> => Array.from({ length: count }, draw)

/** Distance in units in the last place, 0 for equal values (and for two NaNs). */
const ulps = (a: number, b: number): number => {
  if (Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b))) return 0
  const order = (x: number): bigint => {
    bits[0] = x
    const raw = BigInt.asIntN(64, words[0]!)
    return raw < 0n ? -(raw & 0x7fffffffffffffffn) : raw
  }
  const distance = order(a) - order(b)
  return Number(distance < 0n ? -distance : distance)
}

describe("Ops", () => {
  // Recorded on Node (V8) on macOS arm64, Linux x64, and Linux arm64, and on
  // Bun (JavaScriptCore): all four return these exact bits. A change here means
  // results differ from what earlier versions returned, and replays recorded
  // on them may diverge.
  it("returns the same bits on every platform", () => {
    const unary = {
      sin: [-30, 40],
      cos: [-30, 40],
      tan: [-30, 40],
      asin: [-30, -1],
      acos: [-30, -1],
      atan: [-30, 70],
      exp: [-30, 9],
      tanh: [-30, 5]
    } as const
    const hashes: Record<string, string> = {}
    for (const [name, [min, max]] of Object.entries(unary)) {
      const draw = generator(name.length * 7919)
      hashes[name] = hashOf(sample(COUNT, () => Ops[name as keyof typeof unary](draw(min, max))))
    }
    const pair = generator(1)
    hashes.atan2 = hashOf(sample(COUNT, () => Ops.atan2(pair(-20, 20), pair(-20, 20))))
    const power = generator(2)
    hashes.pow = hashOf(sample(COUNT, () => Ops.pow(Math.abs(power(-10, 10)), power(-6, 3))))
    const lengths = generator(3)
    hashes.hypot = hashOf(sample(COUNT, () => Ops.hypot(lengths(-600, 600), lengths(-600, 600))))
    const huge = generator(4)
    const hugeValues: Array<number> = []
    for (let index = 0; index < COUNT; index++) hugeValues.push(Ops.sin(huge(41, 1023)), Ops.cos(huge(41, 1023)))
    hashes.hugeArguments = hashOf(hugeValues)

    expect(hashes).toEqual({
      sin: "f361b10f6dd8c4ac",
      cos: "3262ad44a7a9fc92",
      tan: "ca3f0dd47877bef3",
      asin: "77e56773cd96fdd5",
      acos: "eb37b10d14e7f0b1",
      atan: "72eb580e6e9dd295",
      exp: "323681c848e91b7e",
      tanh: "66b4338138752da4",
      atan2: "5086d2e6820dd7f1",
      pow: "389644f77fcde112",
      hypot: "6ca0e951b8b4c62b",
      hugeArguments: "96bd4d3362292f8b"
    })
  })

  // Same recording as above, for the logarithms, hyperbolic functions, and
  // cube root added later.
  it("returns the same bits on every platform for logarithms, hyperbolics, and cbrt", () => {
    const positive = (draw: (min: number, max: number) => number, min: number, max: number) => () => Math.abs(draw(min, max))
    const inputs = {
      expm1: [-30, 9, false],
      log: [-1022, 1023, true],
      log2: [-1022, 1023, true],
      log10: [-1022, 1023, true],
      log1p: [-30, 30, true],
      cbrt: [-1022, 1023, false],
      sinh: [-30, 9, false],
      cosh: [-30, 9, false],
      asinh: [-30, 600, false],
      atanh: [-30, -1, false]
    } as const
    const hashes: Record<string, string> = {}
    for (const [name, [min, max, onlyPositive]] of Object.entries(inputs)) {
      const draw = generator(name.length * 104729)
      const input = onlyPositive ? positive(draw, min, max) : () => draw(min, max)
      hashes[name] = hashOf(sample(COUNT, () => Ops[name as keyof typeof inputs](input())))
    }
    const above = generator(5)
    hashes.acosh = hashOf(sample(COUNT, () => Ops.acosh(1 + Math.abs(above(-50, 600)))))

    expect(hashes).toEqual({
      expm1: "bc2bff6d5407367f",
      log: "15b864c38b9216a5",
      log2: "aa77428c43b796df",
      log10: "e5c4b907e2a163e3",
      log1p: "574578cdd9bd65c9",
      cbrt: "bf00c8f98d06cfaf",
      sinh: "0a3caa24b9a18795",
      cosh: "3b864d701de5fa74",
      asinh: "032b000a779e2d35",
      atanh: "4d16f52e5388e7cc",
      acosh: "294609db4506d689"
    })
  })

  it("stays within an ulp or two of the engine's Math", () => {
    // The engine's Math is itself up to an ulp off (and differs per platform),
    // so the bound is loose by one; tanh is within 2 ulp of the exact value,
    // like the native one, and sinh and cosh round the other way from V8's.
    const draw = generator(99)
    const bounds: Array<readonly [string, (x: number, y: number) => number, (x: number, y: number) => number, number]> = [
      ["sin", Ops.sin, Math.sin, 2],
      ["cos", Ops.cos, Math.cos, 2],
      ["tan", Ops.tan, Math.tan, 2],
      ["atan", Ops.atan, Math.atan, 2],
      ["atan2", Ops.atan2, Math.atan2, 2],
      ["exp", (x) => Ops.exp(x / 64), (x) => Math.exp(x / 64), 2],
      ["tanh", Ops.tanh, Math.tanh, 4],
      ["asin", (x) => Ops.asin(x / 2048), (x) => Math.asin(x / 2048), 2],
      ["acos", (x) => Ops.acos(x / 2048), (x) => Math.acos(x / 2048), 2],
      ["pow", (x, y) => Ops.pow(Math.abs(x), y / 128), (x, y) => Math.pow(Math.abs(x), y / 128), 2],
      ["hypot", Ops.hypot, Math.hypot, 3],
      ["expm1", (x) => Ops.expm1(x / 64), (x) => Math.expm1(x / 64), 2],
      ["log", (x) => Ops.log(Math.abs(x)), (x) => Math.log(Math.abs(x)), 2],
      ["log2", (x) => Ops.log2(Math.abs(x)), (x) => Math.log2(Math.abs(x)), 2],
      ["log10", (x) => Ops.log10(Math.abs(x)), (x) => Math.log10(Math.abs(x)), 2],
      ["log1p", (x) => Ops.log1p(Math.abs(x)), (x) => Math.log1p(Math.abs(x)), 2],
      ["cbrt", Ops.cbrt, Math.cbrt, 2],
      ["sinh", (x) => Ops.sinh(x / 64), (x) => Math.sinh(x / 64), 3],
      ["cosh", (x) => Ops.cosh(x / 64), (x) => Math.cosh(x / 64), 3],
      ["asinh", Ops.asinh, Math.asinh, 2],
      ["acosh", (x) => Ops.acosh(1 + Math.abs(x)), (x) => Math.acosh(1 + Math.abs(x)), 2],
      ["atanh", (x) => Ops.atanh(x / 2048), (x) => Math.atanh(x / 2048), 2]
    ]
    for (const [name, ours, native, bound] of bounds) {
      let worst = 0
      for (let index = 0; index < COUNT; index++) {
        const x = draw(-8, 10)
        const y = draw(-8, 10)
        worst = Math.max(worst, ulps(ours(x, y), native(x, y)))
      }
      expect({ name, withinBound: worst <= bound }).toEqual({ name, withinBound: true })
    }
  })

  it("matches the engine's Math on special values", () => {
    const exact = [0, -0, Infinity, -Infinity, NaN, 5e-324, -5e-324, 1e300, -1e300]
    const unary = ["sin", "cos", "tan", "asin", "acos", "atan", "exp", "tanh", "expm1", "log", "log2", "log10", "log1p", "cbrt", "sinh", "cosh", "asinh", "acosh", "atanh"] as const
    for (const name of unary) {
      for (const x of exact) expect([name, x, Ops[name](x)]).toEqual([name, x, Math[name](x)])
    }
    expect([Ops.asin(1), Ops.asin(-1), Ops.acos(1), Ops.acos(-1), Ops.exp(1)]).toEqual([Math.PI / 2, -Math.PI / 2, 0, Math.PI, Math.E])
    expect([Ops.log(1), Ops.log2(8), Ops.log10(1000), Ops.log1p(-1), Ops.cbrt(-27), Ops.acosh(1), Ops.atanh(1), Ops.atanh(-1)]).toEqual([0, 3, 3, -Infinity, -3, 0, Infinity, -Infinity])
    expect([Ops.log(-1), Ops.log1p(-2), Ops.acosh(0.5), Ops.atanh(2)]).toEqual([NaN, NaN, NaN, NaN])
    const specials = [0, -0, 1, -1, 2, -2, 0.5, -0.5, 3, -3, Infinity, -Infinity, NaN, 5e-324, -5e-324, 1e300, -1e300]
    for (const name of ["atan2", "pow", "hypot"] as const) {
      for (const x of specials) {
        for (const y of specials) {
          // Exact where an argument is zero, infinite, or NaN; otherwise within an ulp.
          if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0 || y === 0) {
            expect([name, x, y, Ops[name](x, y)]).toEqual([name, x, y, Math[name](x, y)])
          } else {
            expect([name, x, y, ulps(Ops[name](x, y), Math[name](x, y)) <= 1]).toEqual([name, x, y, true])
          }
        }
      }
    }
    // The cases ECMAScript defines differently from C's pow.
    expect(Ops.pow(1, NaN)).toBeNaN()
    expect(Ops.pow(-1, Infinity)).toBeNaN()
    expect(Ops.pow(NaN, 0)).toBe(1)
    expect(Ops.pow(-8, 1 / 3)).toBeNaN()
    expect(Ops.pow(-2, 3)).toBe(-8)
  })

  it("keeps hypot within an ulp of the exact length, without overflow", () => {
    const draw = generator(7)
    for (let index = 0; index < 2_000; index++) {
      const x = draw(-20, 20)
      const y = draw(-20, 20)
      expect(ulps(Ops.hypot(x, y), exactHypot(x, y))).toBeLessThanOrEqual(1)
    }
    for (const [x, y] of [[3e300, 4e300], [3e-300, 4e-300], [1e308, 1e308], [5e-324, 5e-324]] as const) {
      expect(ulps(Ops.hypot(x, y), exactHypot(x, y))).toBeLessThanOrEqual(1)
    }
    expect(Ops.hypot(1e308, 1e308)).toBeLessThan(Infinity)
  })
})

/** The correctly rounded sqrt(x² + y²), computed with BigInt. */
const exactHypot = (x: number, y: number): number => {
  const parts = (value: number): readonly [bigint, number] => {
    bits[0] = Math.abs(value)
    const raw = words[0]!
    const exponent = Number(raw >> 52n)
    const mantissa = (raw & 0xfffffffffffffn) | (exponent === 0 ? 0n : 1n << 52n)
    return [mantissa, Math.max(exponent, 1) - 1075]
  }
  const [mx, ex] = parts(x)
  const [my, ey] = parts(y)
  const base = Math.min(ex, ey)
  const sx = mx << BigInt(ex - base)
  const sy = my << BigInt(ey - base)
  // sqrt((sx² + sy²) · 2^(2·base)) with 200 extra bits, then one rounding.
  const square = (sx * sx + sy * sy) << 400n
  let root = 1n << BigInt((square.toString(2).length >> 1) + 1)
  for (;;) {
    const next = (root + square / root) >> 1n
    if (next >= root) break
    root = next
  }
  return Number(root) * 2 ** -200 * 2 ** base
}
