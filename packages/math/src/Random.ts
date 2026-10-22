/**
 * Deterministic random numbers (mulberry32) whose whole state is one 32-bit
 * integer.
 *
 * Keep the state in a resource, so a run replays exactly and saves with the
 * world: declare it with this module as its validator, start it with
 * `seed`, and draw in systems through `draw` over its write cell, which writes
 * every draw back (rolled back with a failed system). Two generators made
 * from the same state draw the same sequence on every platform. `make` is for
 * a state that lives outside the world (a level generator seeded once).
 *
 * @example
 * ```ts
 * const Rng = Descriptor.ConstructedResource(Random)("Game/Rng")
 * const runtime = Game.Runtime.make({ services, resources: { Rng: Random.seed(0x5eed) } })
 *
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
import type * as Brand from "@typeonce/ritmo/Brand"
import type { WriteCell } from "@typeonce/ritmo/Query"
import * as Result from "@typeonce/ritmo/Result"

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
  /** Uniform in [min, max), or `min` when they are equal. Throws when `min > max` or a bound is not finite. */
  range(min: number, max: number): number
  /** A uniform integer in [min, maxExclusive). Throws unless both bounds are integers with min < maxExclusive. */
  integer(min: number, maxExclusive: number): number
  /** A uniform element of `items`, or `undefined` when it is empty (no draw is made then). */
  pick<A>(items: ReadonlyArray<A>): A | undefined
  /** A shuffled copy of `items` (Fisher–Yates). */
  shuffle<A>(items: ReadonlyArray<A>): Array<A>
  /**
   * An element of `items` chosen with probability proportional to `weight`,
   * or `undefined` when no element has a positive finite weight (no draw is
   * made then). Elements with zero, negative, or non-finite weight are never
   * chosen. `weight` is called once per element.
   */
  weighted<A>(items: ReadonlyArray<A>, weight: (item: A) => number): A | undefined
}

const usable = (weight: number): boolean => weight > 0 && weight < Infinity

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
    return min + (max - min) * this.next()
  }

  integer(min: number, maxExclusive: number): number {
    if (!(Number.isSafeInteger(min) && Number.isSafeInteger(maxExclusive) && min < maxExclusive)) {
      throw new Error(`Random.integer needs whole bounds with min below maxExclusive, got [${min}, ${maxExclusive})`)
    }
    return min + Math.floor(this.next() * (maxExclusive - min))
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
    if (!usable(total)) return undefined
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
 * Only `seed`, `result`, and `decode` make one, so `draw` takes the cell of a
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
 * Validates a state, for `Descriptor.ConstructedResource(Random)` and saves.
 *
 * @category Resource
 */
export const result = (raw: number): Result.Result<State, InvalidState> =>
  isState(raw) ? Result.succeed(raw) : Result.fail({ _tag: "InvalidRandomState", value: raw })

/**
 * Validates a state read from untrusted data (a save).
 *
 * @category Resource
 */
export const decode = (raw: unknown): Result.Result<State, InvalidState> =>
  isState(raw) ? Result.succeed(raw) : Result.fail({ _tag: "InvalidRandomState", value: raw })

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
