/**
 * Simulation time: a fixed step, a clock resource the schedule advances, and
 * durations in whole steps.
 *
 * - `Clock.hz(60)` is the step (`dt = 1/60`). The host loop and the clock
 *   share it: `FixedLoop.start({ step, ... })`.
 * - `Clock.resource(name, step)` is the resource holding the time
 *   (`{ step, hz, dt }`), and `Clock.start(step)` its first value.
 * - `Clock.system(Game, { name, resource, hold })` advances it every tick:
 *   `step + 1` and `dt = 1/hz`, or `dt = 0` while a `hold` condition passes.
 * - `Clock.duration(step, 0.5)` is a span in whole steps; `Clock.every(t, d)`
 *   is true on the step each period begins after the start (steps `d`,
 *   `2d`, ...); `Clock.elapsed(t)` is exact.
 *
 * Time is counted in steps, never accumulated in floating point: elapsed
 * seconds are `step / hz`.
 *
 * @example
 * ```ts
 * const step = Clock.hz(60)
 * const Time = Clock.resource("Game/Time", step)
 * const Game = Schema.bind(Schema.fragment({ resources: { Time } }))
 * const AdvanceTime = Clock.system(Game, { name: "Game/AdvanceTime", resource: Time, hold: [paused] })
 * const runtime = Game.Runtime.make({ services, resources: { Time: Clock.start(step) } }).value
 * ```
 *
 * @module Clock
 * @docGroup runtime
 */
import type { Descriptor } from "./Descriptor.ts"
import * as DescriptorModule from "./Descriptor.ts"
import type { Condition, ConditionNeeds, NotCondition, OrCondition } from "./Machine.ts"
import * as Result from "./Result.ts"
import type * as Schedule from "./Schedule.ts"
import type { Schema } from "./Schema.ts"
import type * as System from "./System.ts"

// ── The step ────────────────────────────────────────────────────────────

declare const stepBrand: unique symbol
declare const durationBrand: unique symbol
declare const resourceBrand: unique symbol
type IsUnion<T, Whole = T> = T extends Whole ? [Whole] extends [T] ? false : true : never

/** A fixed step: `hz` steps per second, `dt = 1 / hz` seconds each. */
export interface Step<Hz extends number = number> {
  readonly [stepBrand]: Hz
  readonly kind: "ClockStep"
  readonly hz: Hz
  readonly dt: number
}

type HzMessage = "Clock.hz needs a positive whole number of steps per second"

/** `N` when it is a literal positive whole number; otherwise the message naming what is wrong. */
export type ValidHz<N extends number> =
  number extends N ? "Clock.hz needs a literal"
  : true extends IsUnion<N> ? "Clock.hz needs one literal rate"
  : `${N}` extends `-${string}` | `${string}.${string}` | `${string}e${string}` | "0" ? HzMessage
  : AtLeast<Trimmed<Reversed<`${N}`>>, Reversed<"9007199254740992">> extends true ? HzMessage
  : N

/**
 * The step of `hz` steps per second. `hz` must be a positive whole literal
 * (`Clock.hz(60)`); anything else is a compile error, and the same check
 * runs at runtime (it throws, which only a cast can reach).
 */
export const hz = <const N extends number>(hz: ValidHz<N>): Step<N> => {
  const value = hz as number
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Clock.hz needs a positive whole number of steps per second, got ${value}`)
  return { kind: "ClockStep", hz: value as N, dt: 1 / value } as Step<N>
}

// ── The time value and its resource ─────────────────────────────────────

/** The clock: steps advanced since the start, the rate, and this tick's seconds. */
export interface Time<Hz extends number = number> {
  /** Steps advanced since the start (held ticks do not count). */
  readonly step: number
  readonly hz: Hz
  /** Seconds this tick: `1 / hz` when the clock advanced, 0 while held. */
  readonly dt: number
}

/** A saved or provided clock value that does not fit this game's clock. */
export interface InvalidTime {
  readonly _tag: "InvalidTime"
  readonly message: string
}

/** The first value of a clock: step 0, nothing elapsed yet. */
export const start = <Hz extends number>(step: Step<Hz>): Time<Hz> => ({ step: 0, hz: step.hz, dt: 0 })

const timeOf = <Hz extends number>(step: Step<Hz>, raw: unknown): Result.Result<Time<Hz>, InvalidTime> => {
  if (typeof raw !== "object" || raw === null) return Result.fail({ _tag: "InvalidTime", message: "a clock value is an object { step, hz, dt }" })
  const value = raw as { readonly step?: unknown; readonly hz?: unknown; readonly dt?: unknown }
  if (value.hz !== step.hz) {
    return Result.fail({
      _tag: "InvalidTime",
      message: typeof value.hz === "number" ? `saved at ${value.hz} Hz, this game runs at ${step.hz} Hz` : `hz must be ${step.hz}`
    })
  }
  if (typeof value.step !== "number" || !Number.isSafeInteger(value.step) || value.step < 0) {
    return Result.fail({ _tag: "InvalidTime", message: "step must be a whole number of steps, 0 or more" })
  }
  if (value.dt !== 0 && value.dt !== step.dt) return Result.fail({ _tag: "InvalidTime", message: `dt must be 0 or 1/${step.hz}` })
  return Result.succeed({ step: value.step, hz: step.hz, dt: value.dt })
}

/** The descriptor `Clock.resource` returns: a validated resource holding `Time<Hz>`. */
export type ClockResource<Name extends string, Hz extends number> =
  DescriptorModule.DecodableDescriptor<"resource", Name, Time<Hz>, Time<Hz>, InvalidTime> & { readonly [resourceBrand]: Hz }

/**
 * A resource holding a clock that runs at `step`. Its validator rejects a
 * value of another rate, so restoring a save made at another step length
 * fails (`InvalidResource` naming it: "saved at 60 Hz, this game runs at
 * 120 Hz"). A game may hold several clocks under different names.
 *
 * It is a validated resource, so a runtime given its value
 * (`resources: { Time: Clock.start(step) }`) is made as a `Result`, like any
 * runtime given validated resources.
 */
export const resource = <const Name extends string, Hz extends number>(name: Name, step: Step<Hz>): ClockResource<Name, Hz> =>
  DescriptorModule.ConstructedResource({
    result: (raw: Time<Hz>) => timeOf(step, raw),
    decode: (raw: unknown) => timeOf(step, raw)
  })(name) as unknown as ClockResource<Name, Hz>

/** Seconds of simulation time since the start: `step / hz`, exact (no accumulated floats). */
export const elapsed = (time: Time): number => time.step / time.hz

// ── The system ──────────────────────────────────────────────────────────

type ClockAccess<R, When extends ReadonlyArray<Condition>> = {
  readonly resources: { readonly clock: System.ResourceWrite<R & Descriptor<"resource", string, any>> }
  readonly when: When
}

type ClockSystem<S extends Schema.Any, Root, R, Name extends string, When extends ReadonlyArray<Condition>> =
  Schema.BoundSystem<S, Root, System.SystemSpec<S, ClockAccess<R, When>, Root>, never, Name, System.SystemAccessNeeds<ClockAccess<R, When>>>

type HeldWhen<Hold extends ReadonlyArray<Condition>> = readonly [OrCondition<Hold, ConditionNeeds<Hold[number]>>]
type RunsWhen<Hold extends ReadonlyArray<Condition>> =
  readonly [NotCondition<OrCondition<Hold, ConditionNeeds<Hold[number]>>, ConditionNeeds<Hold[number]>>]

/** What `Clock.system` builds: the clock's two writers, in order. */
export type ClockSchedule<S extends Schema.Any, Root, R, Name extends string, Hold extends ReadonlyArray<Condition>> =
  Schedule.AnonymousScheduleBuildFor<S, readonly [
    ClockSystem<S, Root, R, `${Name}/Hold`, HeldWhen<Hold>>,
    ClockSystem<S, Root, R, Name, RunsWhen<Hold>>
  ], Root>

/**
 * Advances a clock resource every tick: while any `hold` condition passes
 * (a pause, a menu), time stands still (`dt = 0`, `every` false); otherwise
 * `step + 1` and `dt = 1 / hz`. A plugin: list it in the schedule like any
 * system, before every system that reads the time this tick.
 *
 * It is two systems: `<name>/Hold` sets `dt` to 0 while held, and `<name>`
 * advances otherwise. Gating one system with `when` instead would leave the
 * last advancing tick's `dt` (and `every`) in place for the whole pause.
 */
export const system = <
  S extends Schema.Any,
  Root,
  const Name extends string,
  R extends Schema.ResourceDescriptor<S> & ClockResource<any, any>,
  const Hold extends ReadonlyArray<Condition<Root>> = readonly []
>(
  Game: Schema.Game<S, Root>,
  options: { readonly name: Name; readonly resource: R; readonly hold?: Hold }
): ClockSchedule<S, Root, R, Name, Hold> => {
  // Internally the descriptors are erased; the result type above carries the exact access.
  const Sys = Game.System as unknown as (name: string, spec: object, run: (context: { readonly resources: { readonly clock: { update: (f: (time: Time) => Time) => void } } }) => void) => unknown
  const Build = Game.Schedule as unknown as (...entries: ReadonlyArray<unknown>) => unknown
  const held = Game.Condition.or(...(options.hold ?? []))
  const write = { clock: Game.System.writeResource(options.resource) }
  const Hold = Sys(`${options.name}/Hold`, { resources: write, when: [held] }, ({ resources }) => {
    resources.clock.update((time) => time.dt === 0 ? time : { step: time.step, hz: time.hz, dt: 0 })
  })
  const Advance = Sys(options.name, { resources: write, when: [Game.Condition.not(held)] }, ({ resources }) => {
    resources.clock.update((time) => ({ step: time.step + 1, hz: time.hz, dt: 1 / time.hz }))
  })
  return Build(Hold, Advance) as ClockSchedule<S, Root, R, Name, Hold>
}

// ── Durations ───────────────────────────────────────────────────────────

/** A span of simulation time in whole steps of one clock rate. */
export interface Duration<Hz extends number = number> {
  readonly [durationBrand]: Hz
  readonly kind: "ClockDuration"
  readonly steps: number
  readonly hz: Hz
}

/** Why `durationRaw` refused a number of seconds. */
export interface InvalidDuration {
  readonly _tag: "InvalidDuration"
  readonly seconds: number
  readonly message: string
}

// Type-level decimal arithmetic for literal seconds: digits as reversed tuples.
type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
type Units<D extends Digit> = {
  "0": []; "1": [0]; "2": [0, 0]; "3": [0, 0, 0]; "4": [0, 0, 0, 0]; "5": [0, 0, 0, 0, 0]
  "6": [0, 0, 0, 0, 0, 0]; "7": [0, 0, 0, 0, 0, 0, 0]; "8": [0, 0, 0, 0, 0, 0, 0, 0]; "9": [0, 0, 0, 0, 0, 0, 0, 0, 0]
}[D]
type Reversed<S extends string, Out extends Array<Digit> = []> =
  S extends `${infer Head extends Digit}${infer Tail}` ? Reversed<Tail, [Head, ...Out]> : Out
type SumDigit<A extends Digit, B extends Digit, Carry extends 0 | 1> =
  `${[...Units<A>, ...Units<B>, ...(Carry extends 1 ? [0] : [])]["length"] & number}` extends infer Sum extends string
    ? Sum extends `1${infer Low extends Digit}` ? [Low, 1] : Sum extends Digit ? [Sum, 0] : never
    : never
type Add<A extends Array<Digit>, B extends Array<Digit>, Carry extends 0 | 1 = 0, Out extends Array<Digit> = []> =
  [A, B] extends [[], []] ? Carry extends 1 ? [...Out, "1"] : Out
  : SumDigit<A extends [infer X extends Digit, ...Array<Digit>] ? X : "0", B extends [infer Y extends Digit, ...Array<Digit>] ? Y : "0", Carry> extends [infer D extends Digit, infer C extends 0 | 1]
    ? Add<A extends [Digit, ...infer RA extends Array<Digit>] ? RA : [], B extends [Digit, ...infer RB extends Array<Digit>] ? RB : [], C, [...Out, D]>
    : never
type Times<A extends Array<Digit>, Count extends Array<0>, Out extends Array<Digit> = []> =
  Count extends [0, ...infer Rest extends Array<0>]
    ? Add<Out, A> extends infer Sum extends Array<Digit> ? Times<A, Rest, Sum> : never
    : Out
type Multiply<A extends Array<Digit>, B extends Array<Digit>, Shift extends Array<Digit> = [], Out extends Array<Digit> = []> =
  B extends [infer D extends Digit, ...infer Rest extends Array<Digit>]
    ? Times<A, Units<D>> extends infer Partial extends Array<Digit>
      ? Add<Out, [...Shift, ...Partial]> extends infer Sum extends Array<Digit>
        ? Multiply<A, Rest, ["0", ...Shift], Sum>
        : never
      : never
    : Out
type Trimmed<A extends Array<Digit>> = A extends [...infer Rest extends Array<Digit>, "0"] ? Trimmed<Rest> : A
/** Whether reversed `A` >= reversed `B` (both trimmed of leading zeros). */
type AtLeast<A extends Array<Digit>, B extends Array<Digit>> =
  A["length"] extends B["length"] ? MostSignificantAtLeast<A, B> : LongerThan<A, B>
/** Whether `A` has more elements than `B`. */
type LongerThan<A extends Array<unknown>, B extends Array<unknown>> =
  B extends [unknown, ...infer RB] ? A extends [unknown, ...infer RA] ? LongerThan<RA, RB> : false : A extends [] ? false : true
/** Equal lengths: compare from the most significant digit (the end of a reversed tuple). */
type MostSignificantAtLeast<A extends Array<Digit>, B extends Array<Digit>> =
  [A, B] extends [[...infer RA extends Array<Digit>, infer X extends Digit], [...infer RB extends Array<Digit>, infer Y extends Digit]]
    ? X extends Y ? MostSignificantAtLeast<RA, RB> : LongerThan<Units<X>, Units<Y>>
    : true
type ZerosAfterOne<Fraction extends string, Out extends Array<Digit> = []> =
  Fraction extends `${Digit}${infer Rest}` ? ZerosAfterOne<Rest, ["0", ...Out]> : [...Out, "1"]

/** Whether `0.Fraction` seconds at `Hz` steps per second is at least one step: `Fraction * Hz >= 10^digits`. */
type FractionReachesStep<Fraction extends string, Hz extends number> =
  AtLeast<Trimmed<Multiply<Reversed<Fraction>, Reversed<`${Hz}`>>>, ZerosAfterOne<Fraction>>

type MantissaDigits<S extends string> = S extends `${infer Whole}.${infer Fraction}` ? `${Whole}${Fraction}` : S
type ScientificFraction<Mantissa extends string, Exponent extends string, Count extends Array<0> = [0], Zeros extends string = ""> =
  `${Count["length"]}` extends Exponent ? `${Zeros}${MantissaDigits<Mantissa>}`
  : ScientificFraction<Mantissa, Exponent, [...Count, 0], `${Zeros}0`>

/** `Seconds` when it is a literal, non-negative, and at least one step at `Hz`; otherwise the message. */
export type ValidDuration<Hz extends number, Seconds extends number> =
  number extends Seconds ? "Clock.duration needs a literal number of seconds: use Clock.durationRaw for data"
  : true extends IsUnion<Seconds> ? "Clock.duration needs one literal duration: use Clock.durationRaw for data"
  : number extends Hz ? "Clock.duration needs a step built with Clock.hz(literal)"
  : `${Seconds}` extends `-${string}` ? "Clock.duration needs a non-negative number of seconds"
  : `${Seconds}` extends "0" ? `${Seconds}s is shorter than one step (1/${Hz}s)`
  : `${Seconds}` extends `${string}e+${string}` ? "a duration must fit in a safe whole number of steps"
  : `${Seconds}` extends `${infer Mantissa}e-${infer Exponent}`
    ? FractionReachesStep<ScientificFraction<Mantissa, Exponent>, Hz> extends true ? Seconds : `${Seconds}s is shorter than one step (1/${Hz}s)`
  : `${Seconds}` extends `0.${infer Fraction}`
    ? FractionReachesStep<Fraction, Hz> extends true ? Seconds : `${Seconds}s is shorter than one step (1/${Hz}s)`
    : Seconds

const stepsOf = (hz: number, seconds: number): Result.Result<number, InvalidDuration> => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return Result.fail({ _tag: "InvalidDuration", seconds, message: "a duration needs a finite, non-negative number of seconds" })
  }
  // Exact check first (at least one whole step), then round to the nearest whole step, half up.
  if (seconds * hz < 1 - 1e-9) {
    return Result.fail({ _tag: "InvalidDuration", seconds, message: `${seconds}s is shorter than one step (1/${hz}s)` })
  }
  const steps = Math.max(1, Math.round(seconds * hz))
  if (!Number.isSafeInteger(steps)) return Result.fail({ _tag: "InvalidDuration", seconds, message: "a duration must fit in a safe whole number of steps" })
  return Result.succeed(steps)
}

/**
 * A literal number of seconds as whole steps of `step`: at least one step,
 * rounded to the nearest whole step (half up), so `Clock.duration(Clock.hz(60), 0.025)`
 * is 2 steps (1.5 rounds up). Shorter than one step is a compile error
 * ("0.001s is shorter than one step (1/60s)"). For seconds read from data,
 * use `durationRaw`; for a count of steps, `durationOfSteps`.
 */
export const duration = <Hz extends number, const Seconds extends number>(step: Step<Hz>, seconds: ValidDuration<Hz, Seconds>): Duration<Hz> => {
  const steps = stepsOf(step.hz, seconds as number)
  if (steps._tag === "Failure") throw new Error(steps.failure.message)
  return { kind: "ClockDuration", steps: steps.success, hz: step.hz } as Duration<Hz>
}

/** Seconds from data as whole steps of `step`, the same rules as `duration`, as a `Result`. */
export const durationRaw = <Hz extends number>(step: Step<Hz>, seconds: number): Result.Result<Duration<Hz>, InvalidDuration> => {
  const steps = stepsOf(step.hz, seconds)
  return steps._tag === "Success" ? Result.succeed({ kind: "ClockDuration", steps: steps.success, hz: step.hz } as Duration<Hz>) : steps
}

type StepsMessage = "Clock.durationOfSteps needs a positive whole number of steps"

/** `N` when it is a positive whole number (or a computed `number`); otherwise the message. */
export type ValidSteps<N extends number> =
  number extends N ? N
  : `${N}` extends `-${string}` | `${string}.${string}` | `${string}e${string}` | "0" ? StepsMessage
  : N

/**
 * A whole number of steps of `step` as a duration: `Clock.durationOfSteps(Clock.hz(60), 3)`.
 * Use it when the length is counted in steps (an animation of 3 frames, a
 * cooldown stored as steps); use `duration` for literal seconds and
 * `durationRaw` for seconds from data. A count cannot round, so nothing can
 * fail for a positive whole number: a literal zero, negative, or fraction is
 * a compile error, and a computed one throws.
 */
export const durationOfSteps = <Hz extends number, const N extends number>(step: Step<Hz>, steps: ValidSteps<N>): Duration<Hz> => {
  const count = steps as number
  if (!Number.isSafeInteger(count) || count <= 0) throw new Error(`Clock.durationOfSteps needs a positive whole number of steps, got ${count}`)
  return { kind: "ClockDuration", steps: count, hz: step.hz } as Duration<Hz>
}

/** The whole steps a duration spans. */
export const steps = (duration: Duration): number => duration.steps

/**
 * Whether a period of `duration` begins on this tick: the clock advanced
 * (not held) to a step that is a multiple of the period. False while held,
 * and on the first step (0), which no advance reached: the first period
 * begins at step `duration`.
 */
export const every = <Hz extends number>(time: Time<Hz>, duration: Duration<NoInfer<Hz>>): boolean =>
  time.dt > 0 && time.step % duration.steps === 0
