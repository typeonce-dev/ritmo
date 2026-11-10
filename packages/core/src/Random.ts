/**
 * Deterministic random numbers (mulberry32) whose whole state is one 32-bit
 * integer.
 *
 * Keep the state in a resource, so a run replays exactly and saves with the
 * world: declare it with `Random.codec` as its schema, start it with
 * `seed`, and draw in systems through `draw` over its write cell, which writes
 * every draw back (rolled back with a failed system). Two generators made
 * from the same state draw the same sequence on every platform. `make` is for
 * a state that lives outside the world (a level generator seeded once).
 *
 * @example
 * ```ts
 * const Rng = Descriptor.ConstructedResource(Random.codec)("Game/Rng")
 * const Root = Schema.defineRoot("Game")
 * const Game = Schema.bind(Schema.fragment({ resources: { Rng } }), Root)
 * const runtime = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Rng: Random.seed(0x5eed) } })
 *
 * const kinds = ["grunt", "archer"] as const
 * Game.System("Game/Spawn", { resources: { rng: Game.System.writeResource(Rng) } }, ({ resources }) => {
 *   const random = Random.draw(resources.rng)
 *   const angle = random.range(0, Math.PI * 2)
 *   const kind = random.pick(kinds) ?? "grunt"
 * })
 * ```
 *
 * @module Random
 * @docGroup helpers
 *
 * @categoryDescription Random Types
 * The generator interface.
 *
 * @categoryDescription Construction
 * Making a generator from a stored state.
 *
 * @categoryDescription Resource
 * Keeping the state in a world resource.
 */
import type * as Brand from "./Brand.ts"
import type { StandardSchema } from "./Descriptor.ts"
import { standard } from "./internal/schema.ts"
import type { WriteCell } from "./Query.ts"
import * as Result from "./Result.ts"

/**
 * A generator. Every draw advances `state`.
 *
 * @category Random Types
 */
export interface Random {
  /** The current state: an unsigned 32-bit integer. Store it to continue the sequence later. */
  readonly state: number
  /** Uniform in [0, 1). */
  next(): number
  /**
   * Uniform in [min, max), or `min` when they are equal. Throws when `min > max` or a bound is not finite.
   * Any two finite bounds work, even when `max - min` is beyond the largest number. Where
   * the bounds are only a few doubles apart (`range(1e16, 1e16 + 2)`), the result rounds to
   * one of those doubles, `max` included.
   */
  range(min: number, max: number): number
  /**
   * A uniform integer in [min, maxExclusive). Throws unless both bounds are safe integers with
   * min < maxExclusive and a span (`maxExclusive - min`) of at most `Number.MAX_SAFE_INTEGER`.
   * A span up to 2**32 takes one draw; a wider one takes two draws, or more now and then.
   */
  integer(min: number, maxExclusive: number): number
  /** A uniform element of `items`, or `undefined` when it is empty (no draw is made then). */
  pick<A>(items: ReadonlyArray<A>): A | undefined
  /** A shuffled copy of `items` (Fisher–Yates). */
  shuffle<A>(items: ReadonlyArray<A>): Array<A>
  /**
   * An element of `items` chosen with probability proportional to `weight`,
   * or `undefined` when no element has a positive finite weight (no draw is
   * made then). Elements with zero, negative, or non-finite weight are never
   * chosen. Throws when the usable weights add up to more than the largest
   * number. `weight` is called once per element.
   */
  weighted<A>(items: ReadonlyArray<A>, weight: (item: A) => number): A | undefined
}

const usable = (weight: number): boolean => weight > 0 && weight < Infinity

// 2**32 and 2**53 (one draw's words, and the integers a double holds exactly).
const word = 4294967296
const exact = 9007199254740992

// A span `max - min` that overflows: halve both bounds, so neither the span nor the sum can.
const wideRange = (min: number, max: number, unit: number): number => (min / 2 + (max / 2 - min / 2) * unit) * 2

class Mulberry32 implements Random {
  state: number

  constructor(state: number) {
    this.state = state >>> 0
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  range(min: number, max: number): number {
    if (!(Number.isFinite(min) && Number.isFinite(max) && min <= max)) {
      throw new Error(`Random.range needs finite bounds with min <= max, got [${min}, ${max})`)
    }
    const span = max - min
    return span === Infinity ? wideRange(min, max, this.next()) : min + span * this.next()
  }

  integer(min: number, maxExclusive: number): number {
    if (!(Number.isSafeInteger(min) && Number.isSafeInteger(maxExclusive) && min < maxExclusive)) {
      throw new Error(`Random.integer needs whole bounds with min below maxExclusive, got [${min}, ${maxExclusive})`)
    }
    const span = maxExclusive - min
    return span <= word ? min + Math.floor(this.next() * span) : min + this.#wide(min, maxExclusive, span)
  }

  // A span wider than one draw's 32 bits: 53 bits from two draws, drawn again in the rare case
  // that lands past the last whole multiple of the span, so every offset is equally likely.
  #wide(min: number, maxExclusive: number, span: number): number {
    if (!Number.isSafeInteger(span)) {
      throw new Error(`Random.integer needs a span of at most Number.MAX_SAFE_INTEGER, got [${min}, ${maxExclusive})`)
    }
    const limit = exact - (exact % span)
    for (;;) {
      const high = this.next() * word
      const low = (this.next() * word) >>> 11
      const bits = high * 2097152 + low
      if (bits < limit) return bits % span
    }
  }

  pick<A>(items: ReadonlyArray<A>): A | undefined {
    return items.length === 0 ? undefined : items[Math.floor(this.next() * items.length)]
  }

  shuffle<A>(items: ReadonlyArray<A>): Array<A> {
    const shuffled = items.slice()
    for (let index = shuffled.length - 1; index > 0; index--) {
      const other = Math.floor(this.next() * (index + 1))
      const swap = shuffled[index]!
      shuffled[index] = shuffled[other]!
      shuffled[other] = swap
    }
    return shuffled
  }

  weighted<A>(items: ReadonlyArray<A>, weight: (item: A) => number): A | undefined {
    // `weight` is called once per item: it may be costly or not pure.
    const weights = items.map(weight)
    let total = 0
    for (const value of weights) {
      if (usable(value)) total += value
    }
    if (!usable(total)) return unusableTotal(total)
    let roll = this.next() * total
    let last: A | undefined
    for (let index = 0; index < items.length; index++) {
      const value = weights[index]!
      if (!usable(value)) continue
      last = items[index]
      roll -= value
      if (roll < 0) return items[index]
    }
    // Rounding can leave a sliver of the roll past the last bucket.
    return last
  }
}

// No usable weight, or usable weights whose sum overflows (which no draw could split fairly).
const unusableTotal = (total: number): undefined => {
  if (total === Infinity) throw new Error("Random.weighted needs usable weights that add up to a finite total, got Infinity")
  return undefined
}

/**
 * A generator continuing from `state`. Any number is accepted and reduced to
 * an unsigned 32-bit integer (`state >>> 0`), so a stored state round-trips
 * exactly.
 *
 * @category Construction
 */
export const make = (state: number): Random => new Mulberry32(state)

/**
 * A generator's state as a resource holds it: an unsigned 32-bit integer.
 * Only `seed`, `result`, and `codec` make one, so `draw` takes the cell of a
 * random resource and nothing else.
 *
 * @category Resource
 */
export type State = Brand.Branded<number, "Random/State">

/** Why a value is not a generator state. @category Resource */
export interface InvalidState {
  readonly _tag: "InvalidRandomState"
  readonly value: unknown
}

const isState = (value: unknown): value is State =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff

/**
 * Validates a state, for game code that builds one from a number.
 *
 * @category Resource
 */
export const result = (raw: number): Result.Result<State, InvalidState> =>
  isState(raw) ? Result.success(raw) : Result.failure({ _tag: "InvalidRandomState", value: raw })

/**
 * Whether any value is a generator state: a guard, also for building a
 * state field in your own schema (`Schema.declare(Random.is)`).
 *
 * @category Resource
 */
export const is = (raw: unknown): raw is State => isState(raw)

/**
 * The codec of a random resource's state (a Standard Schema, see
 * `Descriptor.Codec`): `Descriptor.ConstructedResource(Random.codec)`. Its
 * saved form is the number itself, so it needs no `"~encode"`.
 *
 * @category Resource
 */
export const codec: StandardSchema<number, State> = standard<State>(
  (raw) => isState(raw) ? Result.success(raw) : Result.failure("Expected a generator state: an unsigned 32-bit integer")
)

/**
 * The starting state for a seed, reduced to an unsigned 32-bit integer like
 * `make`: the value to give a random resource in `Game.Runtime.make`.
 *
 * @category Resource
 */
export const seed = (value: number): State => (value >>> 0) as State

class CellRandom extends Mulberry32 {
  readonly #cell: WriteCell<State>

  constructor(cell: WriteCell<State>) {
    super(cell.get())
    this.#cell = cell
  }

  override next(): number {
    // Read the cell each time, so two generators over one cell share one sequence.
    this.state = this.#cell.get()
    const value = super.next()
    this.#cell.set(this.state as State)
    return value
  }
}

/**
 * A generator over a random resource's write cell: every draw continues from
 * the stored state and writes the new one back, so the system needs no
 * `set` of its own, a failed run rolls the draws back, and generators made
 * from the same cell in one run continue one sequence.
 *
 * @category Resource
 */
export const draw = (cell: WriteCell<State>): Random => new CellRandom(cell)
