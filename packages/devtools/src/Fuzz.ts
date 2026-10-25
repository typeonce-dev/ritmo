/**
 * Seeded fuzzing that shrinks to a replay: finds a bug before anyone plays
 * into it, and hands back the small input timeline that shows it.
 *
 * `run(make, options)` builds a fresh simulation per run with the same
 * `make(playback)` factory `Replay.session` opens replays with, feeds each
 * fuzzed source a value drawn from a seeded `Random` (from
 * `@typeonce/ritmo`) every frame, and ticks the schedule in a `Session`
 * until an invariant breaks, a system fails, or something throws. The
 * failing timeline is then shrunk by delta debugging: ranges of frames are
 * dropped, then each remaining value is moved toward the input's `neutral`
 * (the whole value, then one field at a time), re-running the deterministic
 * simulation for every candidate and keeping it only when it fails the same
 * way. The result is a `Replay.ReplayFile` of the shrunk timeline, so the
 * test that locks the bug in is `Replay.session(make, file, { invariants })`.
 *
 * A source the factory asks `playback.source` for must be a fuzzed `input`,
 * and every `input` must be asked for; provide plain-data services (rules,
 * config) directly. Use `Determinism.check` to check that the same input
 * repeats; use `Session` to explain a failure by hand.
 *
 * With `network`, the same `run` fuzzes a rollback game over a faulty
 * network: every seat of a `seats` input is its own peer, a fresh runtime
 * from `make`, joined to the others by a seeded `MemoryNetworkLink`
 * (latency, jitter, loss) and driven by a `Netcode.rollback` session. A
 * desync, or any other session failure, is a `SessionFailed` violation, and
 * shrinking shrinks the input timeline with the network seed fixed. Run
 * `Netcode.syncTest` first: it finds state a rewind cannot put back on one
 * peer, faster.
 *
 * @module Fuzz
 * @docGroup devtools
 *
 * @example
 * ```ts
 * const Input = Descriptor.Service<{ snapshot: () => { dx: number } }>()("Game/Input")
 * declare const make: (playback: Replay.Playback) => Replay.Target<typeof Game.schema, typeof Root, { readonly setup: typeof setup; readonly update: typeof update }>
 * const InsideArena = Invariant.fromInspector(Game.Inspector("inside arena", {
 *   queries: { bodies: Game.Query({ selection: { position: Game.Query.read(Position) } }) }
 * }, ({ queries }) => queries.bodies.each().some(({ data }) => data.position.get().x < 0) ? "left the arena" : undefined))
 * declare const sink: Replay.Sink
 * // ---cut---
 * const Move = Fuzz.input(Input, {
 *   generate: (random) => ({ dx: random.integer(-2, 3) }),
 *   neutral: { dx: 0 }
 * })
 * const found = Fuzz.run(make, { schedule: "update", inputs: [Move], invariants: [InsideArena], frames: 600, seed: 7 })
 * if (!found.ok && found.error._tag === "Found") {
 *   sink.save(found.error.replay)     // the shrunk timeline that still fails
 *   console.log(found.error.violation) // the invariant, failure, or defect it hit
 * }
 * ```
 */
import { Clock } from "@typeonce/ritmo"
import type { Descriptor } from "@typeonce/ritmo/Descriptor"
import * as Result from "@typeonce/ritmo/Result"
import type { AnyScheduleOrder, ExecutableScheduleDefinition, Source } from "@typeonce/ritmo/Schedule"
import type { Schema } from "@typeonce/ritmo/Schema"
import type * as Snapshot from "@typeonce/ritmo/Snapshot"
import type * as Checkpoint from "@typeonce/ritmo/Checkpoint"
import type * as CoreDescriptor from "@typeonce/ritmo/Descriptor"
import * as Random from "@typeonce/ritmo/Random"
import type * as Netcode from "@typeonce/ritmo-netcode/Netcode"

import * as FuzzNetwork from "./internal/fuzzNetwork.ts"

import type { Invariant } from "./Invariant.ts"
import * as Rendered from "./Rendered.ts"
import * as Replay from "./Replay.ts"
import * as Session from "./Session.ts"

type AnySchedule<S extends Schema.Any, Root> = ExecutableScheduleDefinition<S, any, Root, any, any, AnyScheduleOrder>

/** One fuzzed source, made with {@link input}: what `run` feeds a `snapshot()` service every frame. */
export interface Input<Name extends string = string, Data = unknown> {
  /** The source service's name. */
  readonly name: Name
  /** The value for `frame` (counting from 1), drawn from the run's seeded generator. */
  readonly generate: (random: Random.Random, frame: number) => Data
  /** The input of a player who does nothing: what shrinking moves values toward. */
  readonly neutral: Data
}

/**
 * Declares how to fuzz one `snapshot()` source: `generate` draws its value
 * for a frame, of the type the source returns, and `neutral` is the idle
 * value. Pass the result in `run`'s `inputs`. The source is a
 * `snapshot()`-only service (`Schedule.Source`, `InputCapture.SourceOf<...>`
 * for browser input, whose `Controls` action set draws a value with
 * `random` and has `idle` for `neutral`). Use `Keyboard.scripted` (or a
 * scripted source) instead to replay one known sequence.
 */
export const input = <const Name extends string, Value extends Source<unknown>>(
  descriptor: Descriptor<"service", Name, Value> & Replay.ValidateSource<Name, Value>,
  options: {
    readonly generate: (random: Random.Random, frame: number) => Replay.SourceData<Value>
    readonly neutral: Replay.SourceData<Value>
  }
): Input<Name, Replay.SourceData<Value>> => ({ name: descriptor.name, generate: options.generate, neutral: options.neutral })

/**
 * Every seat's input of a networked game, made with {@link seats}: per
 * frame, one value per seat. Alone it fuzzes the seats source like any
 * `input`; with `run`'s `network`, each seat's value is that peer's local
 * input.
 */
export interface Seats<Name extends string = string, Data = unknown> extends Input<Name, ReadonlyArray<Data>> {
  /** The schema remote input is decoded with, as given to `Netcode.seats`. */
  readonly codec: CoreDescriptor.Codec<any, any>
  /** How many seats: over a network, how many peers. */
  readonly count: number
  /** The input of a seat that pressed nothing, as given to `Netcode.seats`. */
  readonly idle: Data
}

/**
 * Declares how to fuzz the seats of a networked game: the
 * `Netcode.Source` service its simulation captures, the input `codec` and
 * `idle` input the game gives `Netcode.seats`, `count` seats, and
 * `generate` for one seat's input on a frame. Pass it as the only input of a
 * `run` with `network`; `make` provides the service with
 * `playback.source(descriptor)` (over a network, that is the peer's
 * `seats.source`). Use `input` for a game without seats.
 */
export const seats = <const Name extends string, const C extends CoreDescriptor.Codec<any, any>>(
  descriptor: Descriptor<"service", Name, Netcode.Source<CoreDescriptor.CodecType<C>>>,
  options: {
    readonly codec: C & CoreDescriptor.CheckedCodec<C>
    readonly count: number
    readonly generate: (random: Random.Random, frame: number, seat: number) => NoInfer<CoreDescriptor.CodecType<C>>
    readonly idle: NoInfer<CoreDescriptor.CodecType<C>>
  }
): Seats<Name, CoreDescriptor.CodecType<C>> => ({
  name: descriptor.name,
  codec: options.codec,
  count: options.count,
  idle: options.idle,
  neutral: Array.from({ length: options.count }, () => options.idle),
  generate: (random, frame) => Array.from({ length: options.count }, (_, seat) => options.generate(random, frame, seat))
})

/**
 * How `run` joins the peers when it fuzzes over a network: the seeded link
 * faults (`MemoryNetworkLink.make`'s), kept fixed while shrinking, and the
 * `Netcode.rollback` options every peer's session takes.
 */
export interface Network {
  /** The link's seed: drops and delays repeat for the same seed. */
  readonly seed: number
  readonly latencyMS: number
  /** Up to this much extra delay per message (0 by default). */
  readonly jitterMS?: number
  /** The share of messages dropped, from 0 to 1 (0 by default). */
  readonly loss?: number
  /** The simulation's fixed step: the test clock moves one step per frame. */
  readonly step: Clock.Step
  /** Idle frames played after the fuzzed ones, so late input and checksums arrive (120 by default). */
  readonly settle?: number
  readonly inputDelay?: number
  readonly maxRollback?: number
  /** Ticks between checksum comparisons (10 by default here, to find a desync close to its cause). */
  readonly checksumEvery?: number
}

/** What `run` fuzzes, how long, and how hard it shrinks. */
export interface Options<
  Name extends string,
  Names extends string,
  Invariants extends ReadonlyArray<Invariant<Invariant.CheckInspector>>
> {
  /** The schedule to fuzz: the one ticked once per simulation step. Its name in the replay. */
  readonly schedule: Name
  /** Ticked once before the fuzzed frames, with every input neutral: the replay starts after it. */
  readonly setup?: Names
  /** The fuzzed sources, each from `input`. */
  readonly inputs: readonly [Input, ...Array<Input>]
  /** Checked after every frame, in order, as in `Session.make`. */
  readonly invariants?: Invariants
  /** Frames per run, a whole number above 0. */
  readonly frames: number
  /** Runs to try, each with a fresh simulation; run `i` draws from seed `seed + i`. Defaults to 10. */
  readonly runs?: number
  /** The first run's seed (an integer). A found bug reports the seed of its run. */
  readonly seed: number
  /** Simulations shrinking may run before it stops with the smallest timeline so far. Defaults to 500. */
  readonly shrinkAttempts?: number
}

/** What a fuzzed run hit. */
export type Violation =
  | { readonly _tag: "InvariantViolated"; readonly invariant: string; readonly message: string }
  | { readonly _tag: "SystemFailed"; readonly system: string; readonly error: unknown }
  /** A system threw, or `invariant` names the invariant whose check threw (a bug in the check). */
  | { readonly _tag: "Defect"; readonly invariant: string | undefined; readonly error: unknown }
  /**
   * Over a `network`: the session of `seat` failed. `Desynced` is a
   * determinism bug (`Desync.compare` its `snapshot` with the other seat's:
   * the sessions keep them); `TickFailed` and `CheckpointLost` stop a real
   * session too.
   */
  | { readonly _tag: "SessionFailed"; readonly seat: number; readonly error: Netcode.SessionError<unknown> }

/** A bug the fuzzer found: the error side of `run`. */
export interface Found {
  readonly _tag: "Found"
  readonly violation: Violation
  /** The seed of the run that found it: `run` with this `seed` and `runs: 1` finds it again. */
  readonly seed: number
  /** The frame the shrunk timeline fails at: its length, or later over a `network` (the frame a peer saw it). */
  readonly frame: number
  /**
   * The shrunk timeline as a replay; `Replay.session(make, replay, { invariants })` plays it to the violation.
   * Over a `network`, it plays every seat's input on one runtime: step it to see what each tick did,
   * and find the failure again with `run` and the same seeds.
   */
  readonly replay: Replay.ReplayFile
  /**
   * Whether the replay, opened with `Replay.session`, hits the violation
   * again. `false` means restoring the start lost state the bug needs
   * (transient components): reproduce it with `seed` instead.
   */
  readonly reproduces: boolean
  /**
   * How shrinking went: simulations run, candidates kept, and the frames of input before and after
   * (the failing frame, but over a `network`, where a desync shows a few frames after its cause).
   */
  readonly shrink: { readonly attempts: number; readonly steps: number; readonly fromFrames: number; readonly toFrames: number }
}

/** A run failed, but the same input did not fail again: the simulation reads something besides its input. */
export interface Flaky {
  readonly _tag: "Flaky"
  readonly violation: Violation
  readonly seed: number
  readonly frame: number
}

/** The options or the factory cannot be fuzzed; `message` says why. */
export interface InvalidOptions {
  readonly _tag: "InvalidOptions"
  readonly message: string
}

/** The world after setup cannot be saved (a `"~encode"` rejected it), so no replay could start there. */
export interface Unreplayable {
  readonly _tag: "Unreplayable"
  readonly error: Snapshot.SnapshotError
}

/** Why `run` did not pass. */
export type FuzzError = Found | Flaky | InvalidOptions | Unreplayable

/** Every run completed: how many, of how many frames, from which seed. */
export interface Passed {
  readonly runs: number
  readonly frames: number
  readonly seed: number
}

/** A timeline: per frame, the value of each input, in `inputs` order. */
type Timeline = ReadonlyArray<ReadonlyArray<unknown>>

type Outcome =
  | { readonly kind: "passed"; readonly file?: Replay.ReplayFile | undefined }
  | { readonly kind: "violated"; readonly violation: Violation; readonly frame: number; readonly file: Replay.ReplayFile | undefined }
  | { readonly kind: "invalid"; readonly error: InvalidOptions | Unreplayable }

/** Two violations are the same bug when they name the same invariant, system, or kind of defect. */
const signature = (violation: Violation): string =>
  violation._tag === "InvariantViolated" ? `invariant ${violation.invariant}`
  : violation._tag === "SystemFailed" ? `system ${violation.system}`
  : violation._tag === "SessionFailed" ? `session ${violation.error._tag}`
  : `defect ${violation.invariant ?? ""}`

const describe = (violation: Violation): string => {
  if (violation._tag === "InvariantViolated") return `invariant ${violation.invariant} broke: ${violation.message}`
  if (violation._tag === "SessionFailed") return `seat ${violation.seat}'s session failed with ${violation.error._tag}${"tick" in violation.error ? ` at tick ${violation.error.tick}` : ""}`
  const error = violation.error instanceof Error ? violation.error.message : JSON.stringify(violation.error) ?? String(violation.error)
  if (violation._tag === "SystemFailed") return `${violation.system} failed: ${error}`
  return violation.invariant === undefined ? `a system threw: ${error}` : `invariant ${violation.invariant} threw: ${error}`
}

const violationOf = (stop: Session.Stop): Violation | InvalidOptions | undefined => {
  switch (stop.reason) {
    case "completed":
    case "until":
      return undefined
    case "invariant":
      return { _tag: "InvariantViolated", invariant: stop.invariant, message: stop.message }
    case "failure":
      return { _tag: "SystemFailed", system: stop.system, error: stop.error }
    case "ignored-failure":
      return { _tag: "SystemFailed", system: stop.system ?? stop.schedule, error: stop.error }
    case "defect":
      return { _tag: "Defect", invariant: undefined, error: stop.error }
    case "invariant-threw":
      return { _tag: "Defect", invariant: stop.invariant, error: stop.error }
    case "missingRequirements":
      return { _tag: "InvalidOptions", message: `the fuzzed schedule's runtime is missing requirements: ${JSON.stringify(stop.requirements)}` }
    case "tickOrder":
      return { _tag: "InvalidOptions", message: `the fuzzed schedule's tick order is invalid: ${stop.issues.join("; ")}` }
  }
}

const same = (left: unknown, right: unknown): boolean => left === right || JSON.stringify(left) === JSON.stringify(right)

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Values closer to `neutral` than `value`: `neutral` itself, then `value` with one field set to neutral's. */
const simpler = (value: unknown, neutral: unknown): Array<unknown> => {
  if (same(value, neutral)) return []
  const candidates: Array<unknown> = [neutral]
  // Every seat's input: one seat at a time.
  if (Array.isArray(value) && Array.isArray(neutral) && value.length === neutral.length) {
    value.forEach((item, index) => {
      for (const candidate of simpler(item, neutral[index])) {
        const next = value.map((other, at) => at === index ? candidate : other)
        if (!same(next, neutral)) candidates.push(next)
      }
    })
  }
  if (isRecord(value) && isRecord(neutral)) {
    const keys = Object.keys(value).filter((key) => !same(value[key], neutral[key]))
    if (keys.length > 1) for (const key of keys) candidates.push({ ...value, [key]: neutral[key] })
  }
  return candidates
}

/**
 * Over a `network`: the only input is a `Fuzz.seats`, the fuzzed schedule
 * must rewind and the runtime save (as for `Netcode.rollback`).
 */
type NetworkChecks<Net, S extends Schema.Any, Fuzzed> =
  [Net] extends [Network]
    ? { readonly inputs: readonly [Seats] } & Checkpoint.ValidateRewindable<Fuzzed> & Snapshot.Gate<S, unknown>
    : unknown

/**
 * Fuzzes `options.schedule` of the simulation `make` builds. Each run makes
 * a fresh runtime with `make(playback)` (the `Replay.session` factory),
 * ticks `setup` once, then ticks the schedule up to `frames` times with
 * every input's `generate`d value, checking `invariants` after each frame.
 * The first run that fails is shrunk and returned as a `Found` with a
 * replay; a schedule name that `make` does not return, an invariant that
 * reads what the runtime does not provide, or a schedule service that could
 * not be replayed does not compile.
 *
 * With `network`, every seat of the one `Fuzz.seats` input plays on its own
 * peer (a fresh `make` each, seat 0 ticking `setup`) through
 * `Netcode.rollback` over a seeded `MemoryNetworkLink`, and the invariants
 * are checked on every peer after each frame. A session failure is a
 * `SessionFailed` violation; a schedule that cannot be rewound, or a
 * runtime that cannot save, does not compile.
 */
export const run = <
  S extends Schema.Any,
  Root,
  const Schedules extends Readonly<Record<string, AnySchedule<S, Root>>>,
  Services extends Record<string, unknown>,
  Resources extends object,
  Machines extends Record<string, unknown>,
  const Name extends keyof Schedules & string,
  const Invariants extends ReadonlyArray<Invariant<Invariant.CheckInspector>> = readonly [],
  const Net extends Network | undefined = undefined
>(
  make: (playback: Replay.Playback) => Replay.Target<S, Root, Schedules, Services, Resources, Machines>,
  options: Options<Name, NoInfer<keyof Schedules & string>, Invariants>
    & Session.ValidateInvariants<Invariants, Services, Resources, Machines>
    & Replay.ValidateRecordable<Schedules[Name]>
    & {
      /** Fuzz every seat as its own peer over a seeded faulty network, with `Netcode.rollback` sessions. */
      readonly network?: Net
    }
    & NetworkChecks<Net, S, Schedules[Name]>
): Result.Result<Rendered.Rendered<Passed>, FuzzError> => {
  const invalid = (message: string) => Result.failure<FuzzError>({ _tag: "InvalidOptions", message })
  const runs = options.runs ?? 10
  const budget = options.shrinkAttempts ?? 500
  if (!Number.isSafeInteger(options.frames) || options.frames < 1) return invalid("frames must be a whole number above 0")
  if (!Number.isSafeInteger(runs) || runs < 1) return invalid("runs must be a whole number above 0")
  if (!Number.isSafeInteger(options.seed)) return invalid("seed must be an integer")
  if (!Number.isSafeInteger(budget) || budget < 0) return invalid("shrinkAttempts must be a whole number, 0 or more")
  const inputs: ReadonlyArray<Input> = options.inputs
  const indexOf = new Map(inputs.map((entry, index) => [entry.name, index] as const))
  if (indexOf.size !== inputs.length) return invalid("each input must fuzz a different source")
  const neutral: ReadonlyArray<unknown> = inputs.map((entry) => entry.neutral)
  // `run`'s signature checked the invariants against this runtime's provisions.
  const invariants = (options.invariants ?? []) as readonly []
  const network: Network | undefined = options.network
  let plan: FuzzNetwork.NetworkPlan | undefined
  if (network !== undefined) {
    const only = inputs[0]!
    if (inputs.length !== 1 || !("codec" in only) || !("count" in only)) return invalid("over a network, give inputs exactly one Fuzz.seats")
    const seated = only as Seats
    const settle = network.settle ?? 120
    if (!Number.isSafeInteger(settle) || settle < 0) return invalid("network.settle must be a whole number, 0 or more")
    plan = {
      name: seated.name, codec: seated.codec, count: seated.count, idle: seated.idle,
      make, schedule: options.schedule, setup: options.setup, invariants: options.invariants ?? [],
      step: network.step, seed: network.seed, latencyMS: network.latencyMS, jitterMS: network.jitterMS ?? 0, loss: network.loss ?? 0, settle,
      inputDelay: network.inputDelay, maxRollback: network.maxRollback, checksumEvery: network.checksumEvery ?? 10
    }
  }

  /**
   * Runs one fresh simulation over `timeline`; `record` also saves it as a replay with that reason
   * (a text: saved even when it passes).
   */
  const simulateOne = (timeline: Timeline, record: ((violation: Violation, frame: number) => string) | string | undefined): Outcome => {
    let current = neutral
    const asked = new Set<string>()
    const unknown: Array<string> = []
    const playback: Replay.Playback = {
      source: <const SourceName extends string, Value extends Source<unknown>>(descriptor: Descriptor<"service", SourceName, Value>): Source<Replay.SourceData<Value>> => {
        asked.add(descriptor.name)
        const index = indexOf.get(descriptor.name)
        if (index === undefined) unknown.push(descriptor.name)
        // The value was generated for this source's `input`, whose type `input` checked against the descriptor.
        return { snapshot: () => (index === undefined ? undefined : current[index]) as Replay.SourceData<Value> }
      },
      constant: () => undefined
    }
    const target = make(playback)
    if (unknown.length > 0) return { kind: "invalid", error: { _tag: "InvalidOptions", message: `make asked playback.source for ${unknown.join(", ")}, which no input fuzzes: add Fuzz.input for it, or provide it directly` } }
    const unread = inputs.filter((entry) => !asked.has(entry.name)).map((entry) => entry.name)
    if (unread.length > 0) return { kind: "invalid", error: { _tag: "InvalidOptions", message: `make never asked playback.source for ${unread.join(", ")}: provide the fuzzed source with playback.source(...)` } }
    const schedules: Readonly<Record<string, AnySchedule<S, Root> | undefined>> = target.schedules
    const schedule = schedules[options.schedule]
    if (schedule === undefined) return { kind: "invalid", error: { _tag: "InvalidOptions", message: `make returned no schedule ${options.schedule}` } }
    const runtime: Session.Target<S, Root> & Replay.Recordable<S, Root> = target.runtime
    if (options.setup !== undefined) {
      const setup = schedules[options.setup]
      if (setup === undefined) return { kind: "invalid", error: { _tag: "InvalidOptions", message: `make returned no schedule ${options.setup}` } }
      const ticked = runtime.tryTick(setup)
      if (!ticked.ok) return { kind: "invalid", error: { _tag: "InvalidOptions", message: `setup failed with every input neutral: ${JSON.stringify(ticked.error)}` } }
    }
    const start = runtime.snapshot()
    if (!start.ok) return { kind: "invalid", error: { _tag: "Unreplayable", error: start.error } }

    const sink = Replay.memorySink()
    // One window over the whole timeline, with its only snapshot at the start.
    // `run`'s signature checked that the schedule's services can be recorded.
    const recorder = record === undefined ? undefined : Replay.recorder(runtime, {
      schedule, name: options.schedule, keep: timeline.length + 1, every: timeline.length + 1, step: Clock.hz(1), sink, hostClock: target.hostClock
    } as never)
    const session = Session.make(runtime, { schedules: { [options.schedule]: schedule }, hostClock: target.hostClock, invariants, history: 1 })
    let ticked = 0
    current = timeline[0] ?? neutral
    const played = session.run(options.schedule, {
      frames: timeline.length,
      until: () => {
        ticked += 1
        current = timeline[ticked] ?? neutral
        return false
      }
    })
    session.close()
    const found = violationOf(played.data.stop)
    const frame = ticked + 1
    const reason = found?._tag === "InvalidOptions" || record === undefined ? undefined
      : typeof record === "string" ? record
      : found === undefined ? undefined
      : record(found, frame)
    const file = reason === undefined ? undefined : recorder?.save(reason)
    recorder?.stop()
    if (found === undefined) return { kind: "passed", file }
    if (found._tag === "InvalidOptions") return { kind: "invalid", error: found }
    return { kind: "violated", violation: found, frame, file }
  }

  /** Over the network: every seat on its own peer. The replay plays the same timeline on one runtime. */
  const simulate = (timeline: Timeline, record: ((violation: Violation, frame: number) => string) | undefined): Outcome => {
    if (plan === undefined) return simulateOne(timeline, record)
    const played = FuzzNetwork.play(plan, timeline)
    if (played.kind === "invalid") return { kind: "invalid", error: { _tag: "InvalidOptions", message: played.message } }
    if (played.kind === "passed") return played
    const one = record === undefined ? undefined : simulateOne(timeline.slice(0, played.frame), record(played.violation, played.frame))
    return { kind: "violated", violation: played.violation, frame: played.frame, file: one?.kind === "invalid" ? undefined : one?.file }
  }

  for (let index = 0; index < runs; index++) {
    const seed = options.seed + index
    const random = Random.make(seed)
    const timeline: Array<ReadonlyArray<unknown>> = []
    for (let frame = 1; frame <= options.frames; frame++) timeline.push(inputs.map((entry) => entry.generate(random, frame)))
    const first = simulate(timeline, undefined)
    if (first.kind === "invalid") return Result.failure(first.error)
    if (first.kind === "passed") continue
    const target = signature(first.violation)
    let attempts = 0
    let steps = 0
    let best: Timeline = timeline.slice(0, first.frame)
    /** Whether `candidate` still fails the same way; on success, `best` becomes it, cut at its failing frame. */
    const fails = (candidate: Timeline): boolean => {
      attempts += 1
      const outcome = simulate(candidate, undefined)
      if (outcome.kind !== "violated" || signature(outcome.violation) !== target) return false
      best = candidate.slice(0, outcome.frame)
      steps += 1
      return true
    }
    if (!fails(best)) return Result.failure({ _tag: "Flaky", violation: first.violation, seed, frame: first.frame })
    steps = 0
    shrink: for (let changed = true; changed;) {
      changed = false
      // Drop ranges of frames, halving the range when no range of that size can go.
      for (let size = Math.max(1, Math.floor(best.length / 2)); size >= 1; size = Math.floor(size / 2)) {
        for (let from = 0; from < best.length && best.length > 1;) {
          if (attempts >= budget) break shrink
          if (fails([...best.slice(0, from), ...best.slice(from + size)])) changed = true
          else from += size
        }
      }
      // Move each remaining value toward its input's neutral.
      for (let frame = 0; frame < best.length; frame++) {
        for (let slot = 0; slot < inputs.length; slot++) {
          for (const candidate of simpler(best[frame]![slot], neutral[slot])) {
            if (attempts >= budget) break shrink
            const values = [...best[frame]!]
            values[slot] = candidate
            if (fails([...best.slice(0, frame), values, ...best.slice(frame + 1)])) {
              changed = true
              break
            }
          }
        }
      }
    }
    const final = simulate(best, (violation, frame) =>
      `fuzz seed ${seed}${network === undefined ? "" : ` over network seed ${network.seed}`}: ${describe(violation)} at frame ${frame} (shrunk from ${Math.min(first.frame, timeline.length)} frames)`)
    if (final.kind !== "violated" || final.file === undefined || signature(final.violation) !== target) {
      return Result.failure({ _tag: "Flaky", violation: first.violation, seed, frame: first.frame })
    }
    const opened = Replay.session(make, final.file, { invariants })
    const replayed = opened.ok ? violationOf(opened.value.play().data.run.stop) : undefined
    return Result.failure({
      _tag: "Found",
      violation: final.violation,
      seed,
      frame: final.frame,
      replay: final.file,
      reproduces: replayed !== undefined && replayed._tag !== "InvalidOptions" && signature(replayed) === target,
      shrink: { attempts, steps, fromFrames: Math.min(first.frame, timeline.length), toFrames: best.length }
    })
  }
  return Result.success(Rendered.make(
    { runs, frames: options.frames, seed: options.seed },
    `${runs} run${runs === 1 ? "" : "s"} of ${options.frames} frames from seed ${options.seed}: no invariant broke, no system failed, nothing threw`
  ))
}
