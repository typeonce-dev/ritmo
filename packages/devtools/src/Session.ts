/**
 * A debug session around a runtime made with `debug: { hostClock }`.
 *
 * The session names the schedules it drives, keeps a bounded history of
 * trace events, and answers questions about it as text and data:
 *
 * - `run(name, { frames, until })` ticks a schedule frame by frame and stops
 *   at the first system failure, thrown defect, or violated invariant (an
 *   invariant that throws stops it as `invariant-threw`).
 * - `step(name)` begins one frame and runs it a step at a time
 *   (`until(System)`, `next()`, `finish()`), for a value that goes wrong
 *   between two systems of one frame. `journal`, `why`, and `dump` show the
 *   partial frame.
 * - `journal(filter)` lists what happened, one fact per line, filtered by
 *   frames, entity, component, resource, event, machine, system, or kind.
 * - `why(entity, component)` lists the latest changes to one component, and
 *   the systems whose declared `spawns` could have spawned the entity. With
 *   `depth` above 1 it follows each change back through what the writing
 *   system declared it reads, one level per step (see {@link WhyOptions}).
 * - `system(name)` shows one system's declared access and recent activity.
 * - `describe()`, `dump(filter)`, `streams()` render the core debug handle.
 * - `report()` summarizes per-system timing and warnings accumulated while
 *   tracing: failed systems, missed reads, commands and next states still
 *   pending at the end of a frame, failed transitions, skipped systems that
 *   discarded messages, sent events no system reads, NaN or infinite numbers
 *   written anywhere, numbers written outside a field's declared `range`
 *   (the descriptor's `meta` option), entity counts that keep growing through a run, and
 *   failed tick results nobody read.
 *
 * Everything returns a `Rendered` value that prints as text.
 *
 * With `labels`, every entity in that text prints as `player e12` instead of
 * `e12`: journal and `why` lines, `dump`, report warnings, and invariant
 * messages. Labels are evaluated after every frame of a `run`, so a line
 * shows the label its entity had at the end of the line's frame; an entity
 * despawned by then keeps the last label it had.
 *
 * @module Session
 * @docGroup devtools
 *
 * @example
 * ```ts
 * const PlayerInsideWorld = Invariant.fromInspector(Game.Inspector("player inside world", {
 *   queries: { players: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Player] }) }
 * }, ({ queries }) => queries.players.each().some(({ data }) => data.position.get().x < 0) ? "left the world" : undefined))
 * const Labels = Game.Inspector("labels", {
 *   queries: { players: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Player] }) }
 * }, ({ queries }) => new Map(queries.players.each().map((match) => [match.entity.id, "player"] as const)))
 * // ---cut---
 * const session = Session.make(runtime, {
 *   hostClock: HostClock.test(),
 *   schedules: { setup, update },
 *   invariants: [PlayerInsideWorld],
 *   labels: Labels
 * })
 * session.run("setup")
 * console.log(session.run("update", { frames: 300 }))
 * console.log(session.why(1, Position))
 * console.log(session.journal({ frames: [180, 185], entity: 1 }))
 * ```
 */
import { HostClock, Result } from "@typeonce/ritmo"
import type * as Debug from "@typeonce/ritmo/Debug"
import type * as Inspector from "@typeonce/ritmo/Inspector"
import type * as Machine from "@typeonce/ritmo/Machine"
import type * as Runtime from "@typeonce/ritmo/Runtime"
import type { AnyScheduleOrder, ExecutableScheduleDefinition } from "@typeonce/ritmo/Schedule"
import type { Schema } from "@typeonce/ritmo/Schema"
import type { SystemDefinition } from "@typeonce/ritmo/System"

import * as Format from "./Format.ts"
import type { Invariant } from "./Invariant.ts"
import * as Rendered from "./Rendered.ts"
import { nonFinitePath, rangesOf } from "./internal/values.ts"

/**
 * What a session needs from a runtime: its debug handle, the dynamic
 * `tryTick`, which reports missing requirements as data, `inspect` for
 * invariants, and what it was provided with, which invariants are checked
 * against.
 */
export interface Target<
  S extends Schema.Any,
  Root,
  Services extends Record<string, unknown> = Record<string, unknown>,
  Resources extends object = object,
  Machines extends Record<string, unknown> = Record<string, unknown>
> {
  readonly debug: Debug.Handle<S, Root>
  readonly tryTick: (schedule: ExecutableScheduleDefinition<S, any, any, any, any>) => Result.Result<void, unknown>
  readonly inspect: (inspector: never) => unknown
  readonly services: Services
  readonly resourceValues: Resources
  readonly machineValues: Machines
}

type InvariantRequirementErrors<
  Invariants extends ReadonlyArray<Invariant>,
  Services extends Record<string, unknown>,
  Resources extends object,
  Machines extends Record<string, unknown>
> = Runtime.ValidateInspector<Invariants[number]["inspector"], Services, Resources, Machines> extends {
  readonly __fixRuntimeRequirements__: infer Errors
}
  ? Errors
  : never

/**
 * Rejects invariants whose inspectors read a resource, service, or machine
 * the runtime does not provide, naming each one.
 */
export type ValidateInvariants<
  Invariants extends ReadonlyArray<Invariant>,
  Services extends Record<string, unknown>,
  Resources extends object,
  Machines extends Record<string, unknown>
> = [InvariantRequirementErrors<Invariants, Services, Resources, Machines>] extends [never]
  ? unknown
  : { readonly __fixInvariantRequirements__: InvariantRequirementErrors<Invariants, Services, Resources, Machines> }

/**
 * Names entities in devtools text: a `Game.Inspector` returning a
 * `ReadonlyMap<number, string>` from entity id to label (`player`,
 * `enemy:slime`). It reads the world like an invariant does and is checked
 * the same way; {@link ValidateLabels} rejects one returning anything else.
 * It runs only in a debug session: the game and its runtime never call it.
 *
 * @example
 * ```ts
 * const Labels = Game.Inspector("labels", {
 *   queries: { players: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Player] }) }
 * }, ({ queries }) => new Map(queries.players.each().map((match) => [match.entity.id, "player"] as const)))
 * Session.make(runtime, { hostClock: HostClock.test(), schedules: { update }, labels: Labels })
 * ```
 */
export type LabelsInspector<Root = any> = Inspector.InspectorDefinition<any, unknown, Root, any, any>

type LabelsRequirementErrors<
  Labels extends Inspector.Inspector.Any,
  Services extends Record<string, unknown>,
  Resources extends object,
  Machines extends Record<string, unknown>
> = Runtime.ValidateInspector<Labels, Services, Resources, Machines> extends {
  readonly __fixRuntimeRequirements__: infer Errors
}
  ? Errors
  : never

/**
 * Rejects a `labels` inspector that does not return a
 * `ReadonlyMap<number, string>`, or that reads a resource, service, or
 * machine the runtime does not provide (named like invariants' are).
 */
export type ValidateLabels<
  Labels extends Inspector.Inspector.Any,
  Services extends Record<string, unknown>,
  Resources extends object,
  Machines extends Record<string, unknown>
> = [Labels] extends [never]
  ? unknown
  : [Inspector.Inspector.Value<Labels>] extends [ReadonlyMap<number, string>]
    ? [LabelsRequirementErrors<Labels, Services, Resources, Machines>] extends [never]
      ? unknown
      : { readonly __fixLabelsRequirements__: LabelsRequirementErrors<Labels, Services, Resources, Machines> }
    : { readonly __fixLabels__: "labels must return a ReadonlyMap<number, string> from entity id to label" }

/** What `Session.make` drives and checks, and how it prints. */
export interface Options<
  S extends Schema.Any,
  Root,
  Names extends string,
  Invariants extends ReadonlyArray<Invariant> = readonly [],
  Labels extends LabelsInspector<Root> = never
> {
  /** The schedules `run` can drive, by name. Also names them in traces. */
  readonly schedules: Readonly<Record<Names, ExecutableScheduleDefinition<S, any, Root, any, any>>>
  /**
   * More schedules to include in `describe()`, its lints, and the access
   * maps, without making them runnable: typically a render schedule that
   * needs services a headless runtime does not have. Without them, events
   * and components only those schedules read are reported as never read.
   * Their services show as not provided, which is not a lint. A name
   * already in `schedules` does not compile.
   */
  readonly describe?: Readonly<Record<string, ExecutableScheduleDefinition<S, any, Root, any, any>>> & {
    readonly [Name in NoInfer<Names>]?: "already a runnable schedule in schedules: give the described-only schedule another name"
  }
  /** Events the host publishes with `runtime.send`: written, for the lints (see `Debug.Handle.declareHostEvents`). */
  readonly hostEvents?: ReadonlyArray<Schema.EventDescriptor<S>>
  /**
   * Checked after every frame of every run, in order; the first violation
   * stops the run. Built with `Invariant.fromInspector(Game.Inspector(...))`.
   */
  readonly invariants?: Invariants
  /**
   * Names entities in all text output (`player e12`), from a
   * {@link LabelsInspector}. Evaluated after every frame of a `run` (and
   * when a query finds frames ticked outside `run`), so journal lines show
   * the label from the end of their frame; despawned entities keep their
   * last label.
   */
  readonly labels?: Labels
  /** Frames of trace history kept for `journal` and `why`. Defaults to 600. */
  readonly history?: number
  /**
   * Times runs (`RunResult.ms`). `HostClock.test()` makes every timing 0,
   * so text output is identical across runs (give the runtime's
   * `debug: { hostClock }` a test clock too).
   */
  readonly hostClock: HostClock.HostClock
  /** Value formatting for all text output. */
  readonly format?: Format.ValueOptions
}

/** How long `session.run` ticks: `frames` frames, or fewer when `until` returns `true`. */
export interface RunOptions {
  /** Frames to run. Defaults to 1. */
  readonly frames?: number
  /** Stops after the first frame for which this returns `true`. */
  readonly until?: (frame: number) => boolean
}

/** Why a run stopped. `completed` and `until` are the successful ones. */
export type Stop =
  | { readonly reason: "completed" }
  | { readonly reason: "until"; readonly frame: number }
  | { readonly reason: "failure"; readonly frame: number; readonly system: string; readonly error: unknown }
  | { readonly reason: "missingRequirements"; readonly frame: number; readonly requirements: unknown }
  /** A `Game.System.thisTick` read whose writer runs after it, or that has none; nothing ran. */
  | { readonly reason: "tickOrder"; readonly frame: number; readonly issues: ReadonlyArray<string> }
  | { readonly reason: "defect"; readonly frame: number; readonly error: unknown }
  | { readonly reason: "invariant"; readonly frame: number; readonly invariant: string; readonly message: string }
  /** The invariant itself threw: a bug in the check, not a violation. Fix the check, then run again. */
  | { readonly reason: "invariant-threw"; readonly frame: number; readonly invariant: string; readonly error: unknown }
  /** The `labels` inspector threw: a bug in it. Fix it, then run again. */
  | { readonly reason: "labels-threw"; readonly frame: number; readonly error: unknown }
  /**
   * A failed tick result nobody read (for example a setup tick the game ran
   * before this run): `frame` is the failed tick's, `skipped` the systems
   * that did not run then.
   */
  | {
      readonly reason: "ignored-failure"
      readonly frame: number
      readonly schedule: string
      readonly system: string | undefined
      readonly error: unknown
      readonly skipped: ReadonlyArray<string>
      readonly when: "next-tick" | "session-end"
    }

/** What one `session.run` did and why it stopped; its text is the run summary. */
export interface RunResult {
  readonly schedule: string
  /** Whether the run completed or reached `until`. */
  readonly ok: boolean
  readonly frames: number
  /** First and last frame numbers run, or `undefined` when none ran. */
  readonly range: readonly [number, number] | undefined
  readonly stop: Stop
  readonly ms: number
  /** Warning-level `describe()` lints (the named schedules and what the runtime has seen); details in `describe()`. */
  readonly lintWarnings: number
  /** Warnings raised during this run, by code; details in `report()`. */
  readonly warnings: Readonly<Partial<Record<Warning["code"], number>>>
  /** Live entities before the run, at its peak, and after it. */
  readonly entities: PopulationRange
  /**
   * Components whose count rose through the whole run (see the
   * `population-growing` warning), or `[]`.
   */
  readonly growing: ReadonlyArray<PopulationRange & { readonly component: string }>
}

/** How one count changed over a run. */
export interface PopulationRange {
  readonly start: number
  readonly peak: number
  readonly end: number
}

/**
 * Narrows `session.journal`: every field given must match. Without a filter
 * the journal lists the whole kept history.
 */
export interface JournalFilter<S extends Schema.Any> {
  /** One frame or an inclusive `[from, to]` range. */
  readonly frames?: number | readonly [number, number]
  /** Only the last `n` frames of history. */
  readonly last?: number
  readonly entity?: number
  readonly component?: Schema.ComponentDescriptor<S>
  readonly resource?: Schema.ResourceDescriptor<S>
  readonly event?: Schema.EventDescriptor<S>
  readonly machine?: Machine.StateMachine.Any
  /** System name. */
  readonly system?: string
  /** Schedule path prefix, for example `update`. */
  readonly schedule?: string
  readonly kinds?: ReadonlyArray<Format.LineKind>
  /** Keep only the most recent `n` lines. */
  readonly limit?: number
  /**
   * Include lines that record no change (equal-value writes, transitions to
   * the current state, skips that discarded nothing). Defaults to `false`.
   */
  readonly verbose?: boolean
}

/**
 * How far `why` and `whyResource` look back.
 *
 * The trace records what systems wrote, not what they read, so a level
 * past the first comes from declarations: under each change, one indented
 * `read` line per read the writing system declares, each with the latest
 * traced fact that could have produced the value it saw then:
 *
 * - an event: what was published to it since the system's previous run,
 *   and by which system (or `runtime.send`);
 * - a component of the written entity, read in the query that wrote it: the
 *   latest write, spawn, or insert of it on that entity before the run;
 * - a component of any other query: only how many entities match it now,
 *   since the trace does not say which ones the system read;
 * - a resource: its latest write before the run;
 * - a machine: its latest transition or field update before the run.
 *
 * Every such line ends in `(declared)`: a possible cause, not an observed
 * read. A system already in the chain is printed with `(cycle: not
 * followed)` and not followed again.
 *
 * @example
 * ```ts
 * const session = Session.make(runtime, { hostClock: HostClock.test(), schedules: { update } })
 * // ---cut---
 * session.why(12, Health, { depth: 3 })
 * // f181 update  Game/ApplyDamage  write e12 Game/Health 70 -> 40
 * //   read Game/Damage [{amount:30}] (declared), emitted by Game/Hitscan at f181
 * //     read e12 Game/Aim {target:7} (declared), written by Game/AimAtNewest at f180
 * ```
 */
export interface WhyOptions {
  /** Changes listed, and reads listed under each change. Defaults to 5. */
  readonly limit?: number
  /**
   * Levels printed: 1 (the default) lists the changes alone; 2 adds what
   * each writing system declared it reads and who produced it; 3 adds the
   * reads of those producers, and so on.
   */
  readonly depth?: number
}

/** One system's runs and timing over the session, in `report()` and `system(name)`. */
export interface SystemStats {
  readonly system: string
  readonly runs: number
  readonly failures: number
  /** Runs skipped by a `when` condition (the messages published meanwhile were discarded). */
  readonly skips: number
  /** Runs paused by a `pauseWhen` condition (the messages published meanwhile were held). */
  readonly pauses: number
  readonly totalMs: number
  readonly maxMs: number
}

/**
 * A problem the session saw while tracing a run, counted by kind and
 * subject. Unlike `Debug.Lint` (from `describe()`, about the declarations
 * and the session so far), a warning is raised by what one run did.
 */
export interface Warning {
  readonly code:
    | "missed-read"
    | "pending-commands"
    | "pending-next-state"
    | "transition-failed"
    | "discarded-messages"
    | "sent-event-unread"
    | "system-failed"
    | "non-finite-value"
    | "out-of-range"
    | "population-growing"
    | "ignored-failure"
  readonly message: string
  readonly count: number
  readonly firstFrame: number
  readonly lastFrame: number
}

/** What `session.report()` summarizes: timing per system, warnings, held streams, lints, and population. */
export interface Report {
  readonly frames: number
  readonly history: readonly [number, number] | undefined
  readonly systems: ReadonlyArray<SystemStats>
  readonly warnings: ReadonlyArray<Warning>
  /** Streams held past the two-frame window by a reader, or with lagged readers. */
  readonly streams: ReadonlyArray<Debug.StreamStatus>
  /** The `describe()` lints: the named schedules and what the runtime has seen. */
  readonly lints: ReadonlyArray<Debug.Lint>
  /** Live entities and entities per component now. */
  readonly population: Debug.Population
}

/** What `session.system(name)` shows: the system's declared access, its stats, and its recent journal lines. */
export interface SystemActivity {
  readonly description: Debug.SystemDescription | undefined
  readonly stats: SystemStats | undefined
  readonly recent: ReadonlyArray<Format.Line>
}

type AnySystem = SystemDefinition<any, any, any, any, any>

/** The systems a schedule runs as its own steps: nested schedules included, transition schedules (run inside a marker) not. */
type StepSystemsIn<Entry> =
  Entry extends AnySystem ? Entry
  : Entry extends { readonly kind: "applyStateTransitions" } ? never
  : Entry extends { readonly __order?: (_: never) => infer Order extends AnyScheduleOrder } ? StepSystemsIn<Order["entries"][number]>
  : never

/**
 * The systems `frame.until(...)` accepts for one schedule: the systems it
 * runs as steps, so a system of another schedule does not compile. A
 * schedule whose type was widened accepts any system, and `until` reports
 * one it does not run as `notAhead`.
 */
export type StepSystem<Schedule> = [StepSystemsIn<Schedule>] extends [never] ? AnySystem : StepSystemsIn<Schedule>

/**
 * Why a step call did not get where it was asked to.
 *
 * - `frameEnded`: the frame already ended (its last step ran, or a system
 *   failed); nothing ran. `finish()` reports the frame.
 * - `notAhead`: the system is not among the steps left (it already ran
 *   this frame, or the schedule does not run it as a step); nothing ran.
 * - `failure` / `defect`: a system returned a failure or a step threw; the
 *   steps after it do not run this frame, and the frame ended.
 * - `missingRequirements` / `tickOrder`: the frame never began, as `run`
 *   reports them.
 */
export type StepStop =
  | { readonly reason: "frameEnded"; readonly frame: number }
  | { readonly reason: "notAhead"; readonly frame: number; readonly system: string; readonly remaining: ReadonlyArray<Debug.StepDescription> }
  | Extract<Stop, { readonly reason: "failure" | "defect" | "missingRequirements" | "tickOrder" }>

/** Where `frame.until(system)` stopped: before `system`, which has not run yet. */
export interface StepReached {
  readonly frame: number
  readonly system: string
  /** The steps this call ran, in order (empty when `system` was already next). */
  readonly ran: ReadonlyArray<Debug.StepDescription>
}

/** The step `frame.next()` ran. */
export interface StepRan {
  readonly frame: number
  readonly step: Debug.StepDescription
  /** `true` when it was the last step: the frame ended, and `finish()` evaluates it. */
  readonly ended: boolean
}

/** A violated or throwing invariant found by `frame.check()`. */
export type CheckStop = Extract<Stop, { readonly reason: "invariant" | "invariant-threw" }>

/**
 * One frame of a schedule run a step at a time, begun by `session.step(name)`.
 * Each system run still commits at its end, markers apply at their position,
 * and reader cursors advance as in `run`: only the pauses are new. While it
 * is open, `run`, `step`, and the runtime's `tick`, `send`, `snapshot`,
 * `restore`, `checkpoint`, and `rewind` are refused; `finish()` it first.
 */
export interface SteppedFrame<System> {
  /**
   * Runs the steps (systems and markers) before `system` and stops before
   * it. Takes the system value placed in the schedule, so names that repeat
   * across schedules stay unambiguous and a system the schedule does not
   * run does not compile.
   */
  readonly until: (system: System) => Rendered.Rendered<Result.Result<StepReached, StepStop>>
  /** Runs exactly one step. */
  readonly next: () => Rendered.Rendered<Result.Result<StepRan, StepStop>>
  /** The steps not run yet, in order; empty once the frame has ended. */
  readonly remaining: () => Rendered.Rendered<ReadonlyArray<Debug.StepDescription>>
  /**
   * Evaluates the session's invariants now, between two steps. An invariant
   * may legitimately fail mid-frame (a marker later in the frame applies the
   * commands that restore it), so this is only an explicit question:
   * `finish()` checks the invariants at the end of the frame, as `run` does.
   * Like labels, it reads the world through inspectors, which advances the
   * world's change tick: tick numbers in this frame then differ from an
   * unstepped run's.
   */
  readonly check: () => Rendered.Rendered<Result.Result<void, CheckStop>>
  /**
   * Runs the rest of the frame and reports it as `run(name, { frames: 1 })`
   * would: the same `RunResult`, with labels and invariants evaluated at the
   * end of the frame. A system failure or defect during an earlier step is
   * its stop. Calling it again returns the same result.
   */
  readonly finish: () => Rendered.Rendered<RunResult>
}

/** A debug session made by `Session.make`; see the module description for each query. */
export interface Session<
  S extends Schema.Any,
  Names extends string,
  Schedules extends Readonly<Record<Names, unknown>> = Readonly<Record<Names, ExecutableScheduleDefinition<S, any, any, any, any>>>
> {
  /** Ticks the named schedule frame by frame; stops at the first failure, defect, or violated invariant. */
  readonly run: (name: Names, options?: RunOptions) => Rendered.Rendered<RunResult>
  /**
   * Begins one frame of the named schedule, to run it a step at a time (see
   * {@link SteppedFrame}). Use it when a value goes wrong between two systems
   * of one frame; use `run` for whole frames.
   */
  readonly step: <Name extends Names>(name: Name) => SteppedFrame<StepSystem<Schedules[Name]>>
  /** What happened in the kept history, one fact per line. */
  readonly journal: (filter?: JournalFilter<S>) => Rendered.Rendered<ReadonlyArray<Format.Line>>
  /**
   * Latest changes to one entity's component, and the systems whose `spawns`
   * could have spawned it; with `depth` above 1, what each writing system
   * declared it reads, under each change ({@link WhyOptions}). Use
   * `whyResource` for resources.
   */
  readonly why: (entity: number, component: Schema.ComponentDescriptor<S>, options?: WhyOptions) => Rendered.Rendered<ReadonlyArray<Format.Line>>
  /** Latest changes to one resource and the systems that made them; `depth` as for `why`. */
  readonly whyResource: (resource: Schema.ResourceDescriptor<S>, options?: WhyOptions) => Rendered.Rendered<ReadonlyArray<Format.Line>>
  /** One system's declared access and recent activity. */
  readonly system: (name: string, options?: { readonly limit?: number }) => Rendered.Rendered<SystemActivity>
  /** `debug.describe()`, lints first. */
  readonly describe: () => Rendered.Rendered<Debug.Description>
  /** `debug.dump(filter)`: the current world. */
  readonly dump: (filter?: Debug.DumpFilter<S>) => Rendered.Rendered<Debug.WorldDump>
  /** `debug.streams()`: each stream's size and readers. */
  readonly streams: () => Rendered.Rendered<ReadonlyArray<Debug.StreamStatus>>
  /** Per-system timing, warnings, held streams, lints, and population since the session started. */
  readonly report: () => Rendered.Rendered<Report>
  /** Frames run by the runtime so far. */
  readonly frame: () => number
  /** Stops tracing. Queries keep working on the history recorded so far. */
  readonly close: () => void
}

interface FrameRecord {
  readonly frame: number
  readonly events: Array<Debug.TraceEvent>
  /** The labels at the end of this frame, when they were evaluated then. */
  labels?: ReadonlyMap<number, string>
}

/** `e12` tokens in free text (not `&e12` handles), as an invariant writes them. */
const entityToken = /(?<![\w&])e(\d+)\b/g

const inRange = (frame: number, frames: number | readonly [number, number] | undefined): boolean =>
  frames === undefined ? true
  : typeof frames === "number" ? frame === frames
  : frame >= frames[0] && frame <= frames[1]

/** Minimum frames in a run before its counts are checked for steady growth. */
const growthMinFrames = 60

/**
 * Whether counts sampled once per frame grow steadily: the lowest count in
 * each quarter of the run is higher than in the quarter before. Spawn bursts
 * that are cleaned up do not raise the floor; entities never despawned do.
 */
const growsSteadily = (samples: ReadonlyArray<number>): boolean => {
  const quarter = Math.floor(samples.length / 4)
  let previous = Number.NEGATIVE_INFINITY
  for (let index = 0; index < 4; index++) {
    const window = samples.slice(index * quarter, index === 3 ? samples.length : (index + 1) * quarter)
    const floor = Math.min(...window)
    if (floor <= previous) return false
    previous = floor
  }
  return true
}

/** The stop for a failed tick or step result, as `run` reports it. */
const failureStop = (failure: unknown, frame: number): Extract<Stop, { readonly reason: "failure" | "missingRequirements" | "tickOrder" }> => {
  const error = describeError(failure)
  return error.kind === "MissingRuntimeRequirements"
    ? { reason: "missingRequirements", frame, requirements: error.requirements }
    : error.kind === "TickOrderViolation"
      ? { reason: "tickOrder", frame, issues: (error.issues ?? []).map((issue) => issue.message) }
      : { reason: "failure", frame, system: typeof error.system === "string" ? error.system : "(unknown)", error: error.error }
}

const describeError = (error: unknown): { readonly kind?: unknown; readonly system?: unknown; readonly error?: unknown; readonly requirements?: unknown; readonly issues?: ReadonlyArray<{ readonly message: string }> } =>
  typeof error === "object" && error !== null ? error : {}

/**
 * Starts a session over a runtime made with `debug: { hostClock }`: names
 * `schedules` (and `describe`) on its debug handle and starts tracing. A
 * name in both `schedules` and `describe` does not compile. Use `Lint.run` instead
 * for a pass/fail lint check, and `Replay.session` to open a saved replay.
 */
export const make = <
  S extends Schema.Any,
  Root,
  Services extends Record<string, unknown>,
  Resources extends object,
  Machines extends Record<string, unknown>,
  const Names extends string,
  const Schedules extends Readonly<Record<Names, ExecutableScheduleDefinition<S, any, Root, any, any>>>,
  const Invariants extends ReadonlyArray<Invariant<Inspector.InspectorDefinition<any, string | undefined, Root, any, any>>> = readonly [],
  const Labels extends LabelsInspector<Root> = never
>(
  runtime: Target<S, Root, Services, Resources, Machines>,
  options:
    & Options<S, Root, Names, Invariants, Labels>
    & { readonly schedules: Schedules }
    & ValidateInvariants<Invariants, Services, Resources, Machines>
    & ValidateLabels<Labels, Services, Resources, Machines>
): Session<S, Names, Schedules> => {
  const inspect = runtime.inspect as (inspector: Inspector.Inspector.Any) => unknown
  const debug = runtime.debug
  const capacity = options.history ?? 600
  const format = options.format ?? {}
  const schedules = options.schedules as Readonly<Record<string, ExecutableScheduleDefinition<S, any, Root, any, any>>>
  const described = options.describe ?? {}
  debug.nameSchedules({ ...described, ...schedules })
  debug.declareHostEvents(options.hostEvents ?? [])

  const history: Array<FrameRecord> = []
  let current: FrameRecord = { frame: debug.frame(), events: [] }
  history.push(current)

  const stats = new Map<string, { runs: number; failures: number; skips: number; pauses: number; totalMs: number; maxMs: number }>()
  const statsOf = (system: string) => {
    let entry = stats.get(system)
    if (!entry) {
      entry = { runs: 0, failures: 0, skips: 0, pauses: 0, totalMs: 0, maxMs: 0 }
      stats.set(system, entry)
    }
    return entry
  }
  const labelsInspector = options.labels as LabelsInspector | undefined
  /** Each labelled entity's latest label; a despawned entity keeps its last one. */
  const lastLabels = new Map<number, string>()
  /** The labels of the last evaluation. */
  let latestLabels: ReadonlyMap<number, string> = new Map()
  /** Evaluates the labels for the frame that just ended and stamps it on its record. */
  const evaluateLabels = (): void => {
    if (labelsInspector === undefined) return
    const labels = inspect(labelsInspector) as ReadonlyMap<number, string>
    const dropped = [...latestLabels.keys()].filter((id) => !labels.has(id))
    // An entity that lost its label while alive has none now; a despawned one keeps it.
    if (dropped.length > 0) for (const alive of debug.dump({ entities: dropped }).entities) lastLabels.delete(alive.id)
    for (const [id, label] of labels) lastLabels.set(id, label)
    latestLabels = labels
    current.labels = labels
  }
  /** Evaluates labels when frames ran outside `run` (queries print the latest world). */
  const refreshLabels = (): void => {
    if (labelsInspector === undefined || current.labels !== undefined) return
    try {
      evaluateLabels()
    } catch {
      // A throwing labels inspector stops `run` as `labels-threw`; queries print ids alone.
    }
  }
  /** The labels for a line of `frame`: that frame's (or the next evaluated one's), then each entity's last. */
  const labelsAt = (frame: number): Format.Labels | undefined => {
    if (labelsInspector === undefined) return undefined
    const own = history.find((entry) => entry.frame >= frame && entry.labels !== undefined)?.labels
    return { get: (id) => own?.get(id) ?? lastLabels.get(id) }
  }
  const nowLabels = (): Format.Labels | undefined => {
    refreshLabels()
    return labelsAt(debug.frame())
  }

  type WarningMessage = string | ((labels: Format.Labels | undefined) => string)
  const warnings = new Map<string, { code: Warning["code"]; message: WarningMessage; count: number; firstFrame: number; lastFrame: number }>()
  const warn = (code: Warning["code"], key: string, message: WarningMessage, frame: number) => {
    const existing = warnings.get(key)
    if (existing) {
      existing.count += 1
      existing.lastFrame = frame
    } else {
      warnings.set(key, { code, message, count: 1, firstFrame: frame, lastFrame: frame })
    }
  }

  /** Events some system in the named schedules reads, computed on the first `runtime.send`. */
  let readEvents: Set<string> | undefined
  /** Commands queued and not yet applied, by queuing system. */
  const pending = new Map<string, number>()
  /** Next states queued and not yet applied, by machine, with the queuing system. */
  const pendingStates = new Map<string, string>()
  const checkPending = (frame: number) => {
    for (const [machine, system] of pendingStates) {
      warn(
        "pending-next-state",
        `pending-state:${machine}`,
        `a next state of ${machine} queued by ${system} was still pending at the end of a frame; only an applyStateTransitions() marker applies it`,
        frame
      )
    }
    if (pending.size === 0) return
    const systems = [...pending.keys()].sort()
    const count = [...pending.values()].reduce((total, value) => total + value, 0)
    warn(
      "pending-commands",
      `pending:${systems.join(",")}`,
      `commands queued by ${systems.join(", ")} were still pending at the end of a frame (${count} at first); the next applyDeferred() applies them`,
      frame
    )
  }

  const checkFinite = (system: string, subject: string, value: unknown, frame: number, entity?: number) => {
    const path = nonFinitePath(value)
    if (path === undefined) return
    warn(
      "non-finite-value",
      `nonfinite:${system}:${subject}`,
      (labels) => `${system} wrote a NaN or infinite number to ${entity === undefined ? "" : `${Format.entity(entity, labels)} `}${subject}${path} (first at f${frame}; why() shows its history)`,
      frame
    )
  }

  /** The declared ranges of every component and resource field, by descriptor name, read from `describe()` on the first write. */
  let ranges: ReturnType<typeof rangesOf> | undefined
  const checkRange = (kind: "component" | "resource", system: string, subject: string, value: unknown, frame: number, entity?: number) => {
    ranges ??= rangesOf(debug.describe())
    const fields = ranges[kind].get(subject)
    if (fields === undefined || typeof value !== "object" || value === null) return
    for (const [field, min, max] of fields) {
      const written = (value as Readonly<Record<string, unknown>>)[field]
      // NaN and infinities are `non-finite-value` warnings.
      if (typeof written !== "number" || !Number.isFinite(written) || (written >= min && written <= max)) continue
      warn(
        "out-of-range",
        `range:${system}:${subject}.${field}`,
        (labels) => `${entity === undefined ? "" : `${Format.entity(entity, labels)} `}${subject}.${field} written as ${Format.value(written)}, declared range [${Format.value(min)}, ${Format.value(max)}] by ${system} at frame ${frame}`,
        frame
      )
    }
  }
  const checkComponent = (system: string, subject: string, value: unknown, frame: number, entity: number) => {
    checkFinite(system, subject, value, frame, entity)
    checkRange("component", system, subject, value, frame, entity)
  }

  const record = (event: Debug.TraceEvent) => {
    if (event.type === "frame") {
      checkPending(current.frame)
      current = { frame: event.frame, events: [] }
      history.push(current)
      if (history.length > capacity) history.shift()
    }
    current.events.push(event)
    switch (event.type) {
      case "system": {
        const entry = statsOf(event.system)
        entry.runs += 1
        entry.totalMs += event.ms
        entry.maxMs = Math.max(entry.maxMs, event.ms)
        if (event.outcome !== "ok") {
          entry.failures += 1
          warn("system-failed", `failed:${event.system}`, `${event.system} ${event.outcome === "defect" ? "threw" : "failed"}: ${Format.value(event.error, format)}`, event.frame)
        } else {
          if (event.commands.length > 0) pending.set(event.system, (pending.get(event.system) ?? 0) + event.commands.length)
          for (const write of event.writes) checkComponent(event.system, write.component, write.after, event.frame, write.entity)
          for (const write of event.resources) {
            checkFinite(event.system, write.resource, write.after, event.frame)
            checkRange("resource", event.system, write.resource, write.after, event.frame)
          }
          for (const emit of event.events) checkFinite(event.system, emit.event, emit.values, event.frame)
          for (const next of event.nextStates) {
            if (next.value === undefined) pendingStates.delete(next.machine)
            else pendingStates.set(next.machine, event.system)
          }
        }
        for (const missed of event.missed) {
          warn("missed-read", `missed:${event.system}:${missed.kind}:${missed.stream}`, `${event.system} missed ${missed.kind} ${missed.stream}: entries were dropped before it ran`, event.frame)
        }
        break
      }
      case "system.skipped": {
        if (event.held) statsOf(event.system).pauses += 1
        else statsOf(event.system).skips += 1
        for (const discarded of event.discarded) {
          warn(
            "discarded-messages",
            `discarded:${event.system}:${discarded.stream}`,
            `${event.system} was skipped (${event.condition} is false) and discarded ${discarded.stream} entries published meanwhile`,
            event.frame
          )
        }
        break
      }
      case "runtime.sent": {
        checkFinite("runtime.send", event.event, event.value, event.frame)
        // An event the host sends that no system in the named schedules reads is a wiring mistake.
        readEvents ??= new Set(debug.describe().systems.flatMap((system) => system.events.reads))
        if (!readEvents.has(event.event)) {
          warn("sent-event-unread", `unread:${event.event}`, `runtime.send(${event.event}) was called but no system in the named schedules reads ${event.event}`, event.frame)
        }
        break
      }
      case "deferred":
        pending.clear()
        for (const command of event.commands) {
          for (const effect of command.effects) {
            switch (effect.kind) {
              case "spawn":
                for (const [component, value] of Object.entries(effect.components)) checkComponent(command.system, component, value, event.frame, effect.entity)
                break
              case "insert":
                checkComponent(command.system, effect.component, effect.value, event.frame, effect.entity)
                break
              case "overwrite":
                checkComponent(command.system, effect.component, effect.after, event.frame, effect.entity)
                break
              // No component value written: nothing to check.
              case "remove":
              case "despawn":
              case "relate":
              case "unrelate":
              case "relationDropped":
              case "relationFailure":
              case "requirementViolated":
              case "staleTarget":
                break
            }
          }
        }
        break
      case "failure.ignored":
        ignored = event
        warn("ignored-failure", `ignored:${event.frame}`, Format.ignoredFailure(event, format), event.frame)
        break
      case "transition":
        if (event.outcome !== "failed") pendingStates.delete(event.machine)
        if (event.outcome === "failed" || event.outcome === "enterFailed") {
          warn("transition-failed", `transition:${event.machine}:${String(event.from)}:${String(event.to)}`, `transition ${Format.transition(event)} ${event.outcome}`, event.frame)
        }
        break
      // A frame starts above; schedule bounds and restores carry nothing to check.
      case "frame":
      case "schedule.start":
      case "schedule.end":
      case "restore":
        break
    }
  }
  /** The last `failure.ignored` event seen, for `run` to stop on. */
  let ignored: Debug.FailureIgnoredEvent | undefined
  const takeIgnored = (): Debug.FailureIgnoredEvent | undefined => {
    const found = ignored
    ignored = undefined
    return found
  }
  const stopObserving = debug.observe(record)

  const historyRange = (): readonly [number, number] | undefined => {
    const first = history.find((entry) => entry.events.length > 0)
    return first === undefined ? undefined : [first.frame, history[history.length - 1]!.frame]
  }

  /** The first invariant violated (or throwing) now, in order. */
  const checkInvariants = (frame: number): CheckStop | undefined => {
    for (const invariant of options.invariants ?? []) {
      let message: string | undefined
      try {
        message = inspect(invariant.inspector) as string | undefined
      } catch (error) {
        return { reason: "invariant-threw", frame, invariant: invariant.name, error }
      }
      if (message !== undefined) return { reason: "invariant", frame, invariant: invariant.name, message }
    }
    return undefined
  }

  /** What a run compares against: taken before its first frame begins. */
  const startRun = () => {
    takeIgnored()
    return {
      started: options.hostClock.now(),
      warningsBefore: new Map([...warnings].map(([key, warning]) => [key, warning.count])),
      initial: debug.population()
    }
  }

  /** The frame `session.step` has open, if any. */
  let stepping: { readonly name: string; readonly frame: number } | undefined
  const refuseWhileStepping = (call: string): void => {
    if (stepping !== undefined) throw new Error(`${call} was called while frame f${stepping.frame} of ${stepping.name} is being stepped: call finish() on it first`)
  }

  const run = (name: Names, runOptions: RunOptions = {}): Rendered.Rendered<RunResult> => {
    refuseWhileStepping(`session.run(${name})`)
    const schedule = schedules[name]!
    return runFrames(name, runOptions, startRun(), () => runtime.tryTick(schedule))
  }

  /** Ticks `frames` frames with `tickFrame` and reports them; `run` and `finish()` share it. */
  const runFrames = (
    name: string,
    runOptions: RunOptions,
    { started, warningsBefore, initial }: ReturnType<typeof startRun>,
    tickFrame: () => Result.Result<void, unknown>
  ): Rendered.Rendered<RunResult> => {
    const frames = runOptions.frames ?? 1
    const entityCounts: Array<number> = []
    const componentCounts = new Map<string, Array<number>>(Object.keys(initial.components).map((name) => [name, []]))
    const sample = () => {
      const population = debug.population()
      entityCounts.push(population.entities)
      for (const [name, count] of Object.entries(population.components)) componentCounts.get(name)?.push(count)
    }
    let first: number | undefined
    let last: number | undefined
    let stop: Stop = { reason: "completed" }
    for (let index = 0; index < frames; index++) {
      let result: Result.Result<void, unknown>
      try {
        result = tickFrame()
      } catch (defect) {
        const frame = debug.frame()
        first ??= frame
        last = frame
        stop = { reason: "defect", frame, error: defect }
        break
      }
      const frame = debug.frame()
      first ??= frame
      last = frame
      sample()
      const unread = takeIgnored()
      if (unread !== undefined) {
        const { type: _type, ...found } = unread
        stop = { reason: "ignored-failure", ...found }
        break
      }
      if (!result.ok) {
        stop = failureStop(result.error, frame)
        break
      }
      try {
        evaluateLabels()
      } catch (error) {
        stop = { reason: "labels-threw", frame, error }
        break
      }
      const checked = checkInvariants(frame)
      if (checked) {
        stop = checked
        break
      }
      if (runOptions.until?.(frame)) {
        stop = { reason: "until", frame }
        break
      }
    }
    checkPending(debug.frame())
    const range = (start: number, samples: ReadonlyArray<number>): PopulationRange => ({
      start,
      peak: Math.max(start, ...samples),
      end: samples.length === 0 ? start : samples[samples.length - 1]!
    })
    const growing = entityCounts.length < growthMinFrames
      ? []
      : [...componentCounts]
        .filter(([, samples]) => growsSteadily(samples))
        .map(([component, samples]) => ({ component, ...range(initial.components[component]!, samples) }))
    for (const entry of growing) {
      warn(
        "population-growing",
        `growing:${entry.component}`,
        `${entry.component} count rose through every quarter of a ${entityCounts.length}-frame ${name} run (${entry.start} -> ${entry.end}); entities may never be despawned`,
        debug.frame()
      )
    }
    const raised: Partial<Record<Warning["code"], number>> = {}
    for (const [key, warning] of warnings) {
      const count = warning.count - (warningsBefore.get(key) ?? 0)
      if (count > 0) raised[warning.code] = (raised[warning.code] ?? 0) + count
    }
    const lintWarnings = debug.describe().lints.filter((lint) => lint.severity === "warning")
    const data: RunResult = {
      schedule: name,
      ok: stop.reason === "completed" || stop.reason === "until",
      frames: first === undefined || last === undefined ? 0 : last - first + 1,
      range: first === undefined || last === undefined ? undefined : [first, last],
      stop,
      ms: HostClock.elapsed(started, options.hostClock.now()),
      lintWarnings: lintWarnings.length,
      warnings: raised,
      entities: range(initial.entities, entityCounts),
      growing
    }
    const lintText = lintWarnings.length === 0
      ? ""
      : `\n${lintWarnings.length} lint warnings (see describe() or report()): ${lintWarnings.map((lint) => `${lint.code} ${lint.subject}`).join(", ")}`
    const raisedCodes = Object.entries(raised)
    const warningText = raisedCodes.length === 0
      ? ""
      : `\nwarnings during the run (see report()): ${raisedCodes.map(([code, count]) => `${code} x${count}`).join(", ")}`
    return Rendered.make(data, renderRun(data, format, labelsAt(debug.frame())) + lintText + warningText)
  }

  const step = (name: Names): SteppedFrame<AnySystem> => {
    refuseWhileStepping(`session.step(${name})`)
    const schedule = schedules[name]!
    const start = startRun()
    const begun = debug.beginFrame(schedule)
    const frame = debug.frame()
    const cursor = begun.ok ? begun.value : undefined
    /** Why the frame never began (missing requirements, `thisTick` order). */
    const notBegun = begun.ok ? undefined : failureStop(begun.error, frame) as StepStop
    /** How the frame ended before `finish()`: a failed system's result, or a thrown defect. */
    let ended: { readonly result: Result.Result<void, unknown> } | { readonly defect: unknown } | undefined
    let finished: Rendered.Rendered<RunResult> | undefined
    if (cursor !== undefined && cursor.remaining().length > 0) stepping = { name, frame }

    const head = notBegun === undefined ? `step ${name} f${frame}` : `step ${name}`
    const stopText = (stop: StepStop): string => {
      switch (stop.reason) {
        case "frameEnded":
          return `${head}: the frame has ended; finish() reports it`
        case "notAhead":
          return `${head}: ${stop.system} is not ahead (it already ran this frame, or ${name} does not run it as a step); nothing ran. Remaining: ${stop.remaining.length === 0 ? "(none)" : stop.remaining.map(Format.step).join(", ")}`
        case "failure":
          return `${head}: ${stop.system} FAILED: ${Format.value(stop.error, format)}; the frame ended, finish() reports it`
        case "defect":
          return `${head}: DEFECT: ${stop.error instanceof Error ? stop.error.stack ?? stop.error.message : Format.value(stop.error, format)}`
        case "missingRequirements":
          return `${head}: NOT BEGUN: missing runtime requirements ${Format.value(stop.requirements, format)}`
        case "tickOrder":
          return `${head}: NOT BEGUN: ${stop.issues.join("; ")}`
      }
    }
    const remainingSteps = (): ReadonlyArray<Debug.StepDescription> =>
      cursor === undefined || ended !== undefined ? [] : cursor.remaining()
    const nextText = (): string => {
      const left = remainingSteps()
      return left.length === 0 ? "the frame ended, finish() reports it" : `next: ${Format.step(left[0]!)}`
    }
    const unavailable = (): StepStop | undefined =>
      notBegun ?? (remainingSteps().length === 0 ? { reason: "frameEnded", frame } : undefined)

    /** Runs one step; a failure or defect ends the frame. */
    const advance = (): Result.Result<Debug.StepOutcome, StepStop> => {
      const stop = unavailable()
      if (stop !== undefined) return Result.failure(stop)
      let result: Result.Result<Debug.StepOutcome, unknown>
      try {
        result = cursor!.next()
      } catch (defect) {
        ended = { defect }
        stepping = undefined
        return Result.failure({ reason: "defect", frame, error: defect })
      } finally {
        // Labels evaluated mid-frame are evaluated again for the world after this step.
        if (current.frame === frame) delete current.labels
      }
      if (!result.ok) {
        ended = { result: Result.failure(result.error) }
        stepping = undefined
        return Result.failure(failureStop(result.error, frame))
      }
      if (result.value.ended) stepping = undefined
      return Result.success(result.value)
    }

    const stepped: SteppedFrame<AnySystem> = {
      until: (system) => {
        const unavailableStop = unavailable()
        const left = remainingSteps()
        const offset = schedule.steps
          .slice(schedule.steps.length - left.length)
          .findIndex((entry) => "ordering" in entry && entry.ordering.key === system.ordering.key)
        const stop: StepStop | undefined = unavailableStop
          ?? (offset === -1 ? { reason: "notAhead", frame, system: system.name, remaining: left } : undefined)
        if (stop !== undefined) return Rendered.make(Result.failure(stop), stopText(stop))
        const ran: Array<Debug.StepDescription> = []
        for (let index = 0; index < offset; index++) {
          const result = advance()
          if (!result.ok) return Rendered.make(Result.failure(result.error), stopText(result.error))
          ran.push(result.value.step)
        }
        const reached: StepReached = { frame, system: system.name, ran }
        return Rendered.make(
          Result.success(reached),
          `${head}: stopped before ${system.name}; ${ran.length === 0 ? "nothing ran" : `ran ${ran.map(Format.step).join(", ")}`}`
        )
      },
      next: () => {
        const result = advance()
        if (!result.ok) return Rendered.make(Result.failure(result.error), stopText(result.error))
        const ran: StepRan = { frame, step: result.value.step, ended: result.value.ended }
        return Rendered.make(Result.success(ran), `${head}: ran ${Format.step(ran.step)}; ${nextText()}`)
      },
      remaining: () => {
        const left = remainingSteps()
        return Rendered.make(left, left.length === 0
          ? `${head}: no steps left; ${finished === undefined ? "finish() reports the frame" : "finished"}`
          : `${head}: ${left.length} steps left: ${left.map(Format.step).join(", ")}`)
      },
      check: () => {
        const at = remainingSteps()
        const where = at.length === 0 ? "at the end of the frame" : `before ${Format.step(at[0]!)}`
        const stop = checkInvariants(frame)
        if (stop === undefined) return Rendered.make(Result.success(undefined), `${head}: invariants hold ${where}`)
        const text = stop.reason === "invariant"
          ? `${head}: INVARIANT "${stop.invariant}" violated ${where}: ${stop.message.replace(entityToken, (_token, id: string) => Format.entity(Number(id), nowLabels()))} (it may hold again by the end of the frame)`
          : `${head}: INVARIANT "${stop.invariant}" threw ${where}: ${stop.error instanceof Error ? stop.error.stack ?? stop.error.message : Format.value(stop.error, format)}`
        return Rendered.make(Result.failure(stop), text)
      },
      finish: () => {
        finished ??= runFrames(name, {}, start, () => {
          if (!begun.ok) return begun
          if (ended !== undefined) {
            if ("defect" in ended) throw ended.defect
            return ended.result
          }
          try {
            while (cursor!.remaining().length > 0) {
              const result = cursor!.next()
              if (!result.ok) return result
            }
            return Result.success(undefined)
          } finally {
            stepping = undefined
          }
        })
        return finished
      }
    }
    return stepped
  }

  /** Lines hidden by the last `collectLines` call because they record no change. */
  let hidden = 0

  const collectLines = (filter: JournalFilter<S>): Array<Format.Line> => collectSourced(filter).map((entry) => entry.line)

  /** The journal lines of `filter`, each with its event's position in {@link flatTrace}. */
  const collectSourced = (filter: JournalFilter<S>): Array<{ readonly line: Format.Line; readonly at: number }> => {
    hidden = 0
    refreshLabels()
    const subject = filter.component?.name ?? filter.resource?.name ?? filter.event?.name ?? filter.machine?.name
    // `slice(-last)` keeps the journal's meaning of `last` (0 keeps everything).
    const first = filter.last === undefined ? 0 : history.length - history.slice(-filter.last).length
    const result: Array<{ readonly line: Format.Line; readonly at: number }> = []
    let at = 0
    for (const [index, entry] of history.entries()) {
      if (index < first || !inRange(entry.frame, filter.frames)) {
        at += entry.events.length
        continue
      }
      const labels = labelsAt(entry.frame)
      for (const event of entry.events) {
        const position = at++
        for (const line of Format.lines(event, format, labels)) {
          if (filter.entity !== undefined && line.entity !== filter.entity) continue
          if (subject !== undefined && line.subject !== subject && !(line.kind === "effect" && line.subject === undefined && filter.entity !== undefined)) continue
          if (filter.system !== undefined && line.system !== filter.system) continue
          if (filter.schedule !== undefined && !line.schedule.startsWith(filter.schedule)) continue
          if (filter.kinds !== undefined && !filter.kinds.includes(line.kind)) continue
          if (line.noop && filter.verbose !== true) {
            hidden += 1
            continue
          }
          result.push({ line, at: position })
        }
      }
    }
    return filter.limit === undefined ? result : result.slice(-filter.limit)
  }

  const renderLines = (header: string, lines: ReadonlyArray<Format.Line>): string =>
    [header, ...lines.map(Format.line)].join("\n")

  const rangeText = () => {
    const range = historyRange()
    return range === undefined ? "empty history" : `history f${range[0]}-f${range[1]}`
  }

  const journal = (filter: JournalFilter<S> = {}) => {
    const lines = collectLines(filter)
    const hiddenText = hidden > 0 ? `, ${hidden} no-change lines hidden (verbose: true shows them)` : ""
    return Rendered.make(lines, renderLines(`journal: ${lines.length} lines (${rangeText()}${hiddenText})`, lines))
  }

  const why = (entity: number, component: Schema.ComponentDescriptor<S>, whyOptions: WhyOptions = {}) => {
    const sourced = collectSourced({ entity, component, kinds: ["write", "effect"], limit: whyOptions.limit ?? 5 })
    const lines = followReads(sourced, whyOptions)
    const currentValue = debug.dump({ entities: [entity] }).entities[0]
    const name = Format.entity(entity, nowLabels())
    const now = currentValue === undefined
      ? `${name} is not alive`
      : component.name in currentValue.components
        ? `${name} ${component.name} is now ${Format.value(currentValue.components[component.name], format)}`
        : `${name} has no ${component.name} now`
    const changes = sourced.length === 0
      ? `${now}; no change to it in ${rangeText()}`
      : `${now}; last ${sourced.length} changes (oldest first):`
    const spawners = spawnersOf(currentValue === undefined ? [component.name] : Object.keys(currentValue.components), component.name)
    const header = `${changes}\n${spawners.length === 0
      ? `no described system declares spawns of ${component.name}`
      : `could have spawned it: ${spawners.join(", ")}`}${readsNote(lines)}`
    return Rendered.make(lines, renderLines(header, lines))
  }

  /**
   * The described systems whose declared `spawns` include `component` and
   * cover every component the entity has that no described system may
   * insert (so it can only have come from the spawn).
   */
  const spawnersOf = (has: ReadonlyArray<string>, component: string): Array<string> => {
    const systems = debug.describe().systems
    const insertable = new Set(systems.flatMap((system) => system.commands.inserts))
    const fromSpawn = has.filter((name) => !insertable.has(name))
    return systems
      .filter((system) => system.commands.spawns.includes(component) && fromSpawn.every((name) => system.commands.spawns.includes(name)))
      .map((system) => system.name)
  }

  const whyResource = (resource: Schema.ResourceDescriptor<S>, whyOptions: WhyOptions = {}) => {
    const lines = followReads(collectSourced({ resource, kinds: ["resource"], limit: whyOptions.limit ?? 5 }), whyOptions)
    const resources = debug.dump({ limit: 0 }).resources
    const now = resource.name in resources
      ? `${resource.name} is now ${Format.value(resources[resource.name], format)}`
      : `${resource.name} has no value now`
    const changes = lines.filter((line) => line.depth === 0).length
    const header = changes === 0
      ? `${now}; no change to it in ${rangeText()}`
      : `${now}; last ${changes} changes (oldest first):${readsNote(lines)}`
    return Rendered.make(lines, renderLines(header, lines))
  }

  /** The header note `why` adds when it printed declared reads. */
  const readsNote = (lines: ReadonlyArray<Format.Line>): string =>
    lines.some((line) => line.depth > 0)
      ? "\nindented: what each writing system declared it reads, and the latest fact that could have produced it (declared: possible causes, not observed reads)"
      : ""

  /** Every kept trace event, oldest first; {@link collectSourced} positions index into it. */
  const flatTrace = (): ReadonlyArray<Debug.TraceEvent> => history.flatMap((entry) => entry.events)

  /**
   * The changes `why` lists, each followed (with `depth` above 1) by the
   * reads its system declared, depth first. Positions are in trace order, so
   * "before the run" is what the system could have seen.
   */
  const followReads = (sourced: ReadonlyArray<{ readonly line: Format.Line; readonly at: number }>, whyOptions: WhyOptions): Array<Format.Line> => {
    const depth = whyOptions.depth ?? 1
    const limit = whyOptions.limit ?? 5
    if (depth <= 1 || sourced.length === 0) return sourced.map((entry) => entry.line)
    const trace = flatTrace()
    const systems = new Map(debug.describe().systems.map((entry) => [entry.name, entry] as const))
    let world: ReadonlyArray<Debug.EntityDump> | undefined
    const worldNow = () => (world ??= debug.dump().entities)

    /** The latest committed run of `system` before `before`. */
    const runBefore = (system: string, before: number): { readonly at: number; readonly run: Debug.SystemEvent } | undefined => {
      for (let at = before - 1; at >= 0; at--) {
        const event = trace[at]!
        if (event.type === "system" && event.system === system && event.outcome === "ok") return { at, run: event }
      }
      return undefined
    }
    /** Where the stream reads of the run at `at` start: after the system's previous run, or the discarding skip. */
    const readsSince = (system: string, at: number): number => {
      for (let index = at - 1; index >= 0; index--) {
        const event = trace[index]!
        if ((event.type === "system" && event.system === system) || (event.type === "system.skipped" && event.system === system && !event.held)) return index + 1
      }
      return 0
    }
    const latest = <A>(before: number, find: (event: Debug.TraceEvent, at: number) => A | undefined): A | undefined => {
      for (let at = before - 1; at >= 0; at--) {
        const found = find(trace[at]!, at)
        if (found !== undefined) return found
      }
      return undefined
    }

    /** A run whose reads can be followed: the entity and component (or resource) it wrote, which its own reads skip. */
    interface Cause {
      readonly at: number
      readonly run: Debug.SystemEvent
      readonly entity: number | undefined
      readonly subject: string | undefined
    }
    interface Read {
      readonly frame: number
      readonly schedule: string
      readonly system: string | undefined
      readonly entity: number | undefined
      readonly subject: string
      readonly text: string
      readonly next: Cause | undefined
    }

    const readsOf = (cause: Cause): Array<Read> => {
      const { run } = cause
      const description = systems.get(run.system)
      const here = { frame: run.frame, schedule: run.schedule, system: undefined, entity: undefined, next: undefined }
      if (description === undefined) {
        return [{ ...here, subject: run.system, text: `${run.system} is in no named or described schedule: its declared reads are unknown` }]
      }
      const reads: Array<Read> = []
      const since = readsSince(run.system, cause.at)
      for (const name of description.events.reads) {
        const before = reads.length
        for (let at = since; at < cause.at; at++) {
          const event = trace[at]!
          if (event.type === "runtime.sent" && event.event === name) {
            reads.push({ ...here, frame: event.frame, schedule: "", subject: name, text: `read ${name} ${Format.value([event.value], format)} (declared), sent by runtime.send at f${event.frame}` })
          }
          if (event.type === "system" && event.outcome === "ok") {
            for (const emitted of event.events) {
              if (emitted.event !== name) continue
              reads.push({
                frame: event.frame,
                schedule: event.schedule,
                system: event.system,
                entity: undefined,
                subject: name,
                text: `read ${name} ${Format.value(emitted.values, format)} (declared), emitted by ${event.system} at f${event.frame}`,
                next: { at, run: event, entity: undefined, subject: undefined }
              })
            }
          }
        }
        if (reads.length === before) {
          reads.push({ ...here, subject: name, text: `read ${name} (declared): nothing published to it since ${run.system}'s previous run` })
        }
      }
      for (const query of description.queries) {
        const components = [...query.reads, ...query.writes, ...query.optional]
        if (cause.entity !== undefined && cause.subject !== undefined && query.writes.includes(cause.subject)) {
          const entity = cause.entity
          for (const name of components.filter((component) => component !== cause.subject)) {
            reads.push(componentRead(cause, entity, name))
          }
        } else if (components.length > 0) {
          const required = [...query.reads, ...query.writes, ...query.with]
          const count = worldNow().filter((dumped) =>
            required.every((name) => name in dumped.components) && !query.without.some((name) => name in dumped.components)).length
          reads.push({
            ...here,
            subject: components[0]!,
            text: `read ${components.join(", ")} of ${count} matching ${count === 1 ? "entity" : "entities"} now (declared; the trace does not say which it read)`
          })
        }
      }
      for (const name of new Set([...description.resources.reads, ...description.resources.writes])) {
        if (name === cause.subject && cause.entity === undefined) continue
        const found = latest(cause.at, (event, at) => {
          if (event.type !== "system" || event.outcome !== "ok") return undefined
          // An equal-value write did not produce the value; the change before it did.
          const write = event.resources.find((entry) => entry.resource === name && !Format.sameValue(entry.before, entry.after))
          return write === undefined ? undefined : { at, event, write }
        })
        reads.push(found === undefined
          ? { ...here, subject: name, text: `read resource ${name} (declared): no change to it in ${rangeText()}` }
          : {
            frame: found.event.frame,
            schedule: found.event.schedule,
            system: found.event.system,
            entity: undefined,
            subject: name,
            text: `read resource ${name} ${Format.value(found.write.after, format)} (declared), written by ${found.event.system} at f${found.event.frame}`,
            next: { at: found.at, run: found.event, entity: undefined, subject: name }
          })
      }
      for (const name of new Set([...description.machines.reads, ...description.machines.updates])) {
        const found = latest(cause.at, (event, at): Read | undefined => {
          if (event.type === "transition" && event.machine === name && (event.outcome === "applied" || event.outcome === "enterFailed")) {
            return { ...here, frame: event.frame, schedule: event.schedule, subject: name, text: `read machine ${name} (declared): transition ${Format.transition(event)} ${event.outcome} at f${event.frame}` }
          }
          if (event.type !== "system" || event.outcome !== "ok" || event.system === run.system) return undefined
          const write = event.machines.find((entry) => entry.machine === name)
          return write === undefined ? undefined : {
            frame: event.frame,
            schedule: event.schedule,
            system: event.system,
            entity: undefined,
            subject: name,
            text: `read machine ${name} ${Format.change(write.before, write.after, format)} (declared), updated by ${event.system} at f${event.frame}`,
            next: { at, run: event, entity: undefined, subject: undefined }
          }
        })
        reads.push(found ?? { ...here, subject: name, text: `read machine ${name} (declared): no transition in ${rangeText()}` })
      }
      if (reads.length === 0) reads.push({ ...here, subject: run.system, text: `${run.system} declares no other reads (declared)` })
      return reads
    }

    /** The latest value of `component` on `entity` before the cause's run, and what produced it. */
    const componentRead = (cause: Cause, entity: number, component: string): Read => {
      const name = Format.entity(entity, labelsAt(cause.run.frame))
      const found = latest(cause.at, (event, at): Read | undefined => {
        if (event.type === "system" && event.outcome === "ok") {
          const write = event.writes.find((entry) => entry.entity === entity && entry.component === component && !Format.sameValue(entry.before, entry.after))
          return write === undefined ? undefined : {
            frame: event.frame,
            schedule: event.schedule,
            system: event.system,
            entity,
            subject: component,
            text: `read ${name} ${component} ${Format.value(write.after, format)} (declared), written by ${event.system} at f${event.frame}`,
            next: { at, run: event, entity, subject: component }
          }
        }
        if (event.type !== "deferred") return undefined
        for (const command of [...event.commands].reverse()) {
          for (const effect of [...command.effects].reverse()) {
            if (effect.entity !== entity) continue
            const value = effect.kind === "spawn" ? (component in effect.components ? { found: effect.components[component] } : undefined)
              : effect.kind === "insert" && effect.component === component ? { found: effect.value }
              : effect.kind === "overwrite" && effect.component === component ? { found: effect.after }
              : undefined
            if (value === undefined) continue
            const queued = runBefore(command.system, at)
            return {
              frame: event.frame,
              schedule: event.schedule,
              system: command.system,
              entity,
              subject: component,
              text: `read ${name} ${component} ${Format.value(value.found, format)} (declared), ${effect.kind === "spawn" ? "spawned" : "inserted"} by ${command.system} at f${event.frame}`,
              next: queued === undefined ? undefined : { ...queued, entity: undefined, subject: undefined }
            }
          }
        }
        return undefined
      })
      return found ?? { frame: cause.run.frame, schedule: cause.run.schedule, system: undefined, entity, subject: component, text: `read ${name} ${component} (declared): no change to it in ${rangeText()}`, next: undefined }
    }

    const toLine = (read: Read, level: number, suffix: string): Format.Line => {
      const label = read.entity === undefined ? undefined : labelsAt(read.frame)?.get(read.entity)
      return {
        kind: "read",
        frame: read.frame,
        schedule: read.schedule,
        system: read.system,
        entity: read.entity,
        label: label === "" ? undefined : label,
        subject: read.subject,
        text: `${read.text}${suffix}`,
        noop: false,
        depth: level
      }
    }

    const out: Array<Format.Line> = []
    const follow = (cause: Cause, level: number, chain: ReadonlySet<string>) => {
      const reads = readsOf(cause)
      for (const read of reads.slice(0, limit)) {
        const cycle = read.next !== undefined && chain.has(read.next.run.system)
        out.push(toLine(read, level, cycle ? " (cycle: not followed)" : ""))
        if (read.next !== undefined && !cycle && level + 1 < depth) follow(read.next, level + 1, new Set([...chain, read.next.run.system]))
      }
      if (reads.length > limit) {
        out.push({
          kind: "read",
          frame: cause.run.frame,
          schedule: cause.run.schedule,
          system: undefined,
          entity: undefined,
          label: undefined,
          subject: undefined,
          text: `…+${reads.length - limit} more declared reads of ${cause.run.system} (raise limit to see them)`,
          noop: false,
          depth: level
        })
      }
    }
    /** The run behind a listed change: the writing run, or for an applied command the run that queued it. */
    const causeOf = (line: Format.Line, at: number): Cause | undefined => {
      const event = trace[at]
      if (event?.type === "system") return { at, run: event, entity: line.entity, subject: line.subject }
      const queued = event?.type === "deferred" && line.system !== undefined ? runBefore(line.system, at) : undefined
      return queued === undefined ? undefined : { ...queued, entity: undefined, subject: undefined }
    }
    for (const { line, at } of sourced) {
      out.push(line)
      const cause = causeOf(line, at)
      if (cause !== undefined) follow(cause, 1, new Set([cause.run.system]))
    }
    return out
  }

  const statsFor = (system: string): SystemStats | undefined => {
    const entry = stats.get(system)
    return entry === undefined ? undefined : { system, ...entry }
  }

  const system = (name: string, systemOptions: { readonly limit?: number } = {}) => {
    const description = debug.describe().systems.find((entry) => entry.name === name)
    const recent = collectLines({ system: name, limit: systemOptions.limit ?? 20 })
    const data: SystemActivity = { description, stats: statsFor(name), recent }
    const lines: Array<string> = []
    if (description === undefined) {
      lines.push(`${name} is not in any named schedule`)
    } else {
      lines.push(Format.system(description))
    }
    const entry = data.stats
    lines.push(entry === undefined
      ? "no traced runs"
      : `${entry.runs} runs, ${entry.failures} failures, ${entry.skips} skips, ${entry.pauses} pauses, avg ${Format.value(entry.runs === 0 ? 0 : entry.totalMs / entry.runs)}ms, max ${Format.value(entry.maxMs)}ms`)
    lines.push(`recent (${rangeText()}${hidden > 0 ? `, ${hidden} no-change lines hidden` : ""}):`)
    lines.push(...(recent.length === 0 ? ["(no changes recorded; journal({ system, verbose: true }) shows every line)"] : recent.map(Format.line)))
    return Rendered.make(data, lines.join("\n"))
  }

  const report = () => {
    // The report is where a session ends: a failure still unread shows here.
    debug.checkIgnoredFailures()
    const systems = [...stats.keys()].map((name) => statsFor(name)!).sort((left, right) => right.totalMs - left.totalMs)
    const data: Report = {
      frames: debug.frame(),
      history: historyRange(),
      systems,
      warnings: [...warnings.values()].map((warning) => ({
        ...warning,
        message: typeof warning.message === "string" ? warning.message : warning.message(labelsAt(warning.firstFrame))
      })),
      streams: debug.streams().filter((stream) => stream.heldBy !== undefined || stream.readers.some((reader) => reader.lagged)),
      lints: debug.describe().lints,
      population: debug.population()
    }
    const lines = [`${data.frames} frames run (${rangeText()})`, "", ...Format.lintLines(data.lints), "", "# Systems (by total time)"]
    for (const entry of systems) {
      lines.push(`${entry.system}: ${entry.runs} runs, avg ${Format.value(entry.runs === 0 ? 0 : entry.totalMs / entry.runs)}ms, max ${Format.value(entry.maxMs)}ms${entry.failures > 0 ? `, ${entry.failures} failures` : ""}${entry.skips > 0 ? `, ${entry.skips} skips` : ""}${entry.pauses > 0 ? `, ${entry.pauses} pauses` : ""}`)
    }
    lines.push("", "# Warnings")
    if (data.warnings.length === 0) lines.push("(none)")
    for (const warning of data.warnings) {
      lines.push(`${warning.code}: ${warning.message} (x${warning.count}, f${warning.firstFrame}-f${warning.lastFrame})`)
    }
    if (data.streams.length > 0) {
      lines.push("", "# Streams held by readers", Format.streams(data.streams))
    }
    const counted = Object.entries(data.population.components).filter(([, count]) => count > 0).sort(([, left], [, right]) => right - left)
    lines.push("", `# Population: ${data.population.entities} entities`, ...counted.map(([component, count]) => `${component}: ${count}`))
    return Rendered.make(data, lines.join("\n"))
  }

  return {
    run,
    step: step as Session<S, Names, Schedules>["step"],
    journal,
    why,
    whyResource,
    system,
    describe: () => {
      const description = debug.describe()
      return Rendered.make(description, Format.description(description))
    },
    dump: (filter) => {
      const dumped = debug.dump(filter)
      return Rendered.make(dumped, Format.dump(dumped, format, nowLabels()))
    },
    streams: () => {
      const status = debug.streams()
      return Rendered.make(status, Format.streams(status))
    },
    report,
    frame: () => debug.frame(),
    close: () => {
      debug.checkIgnoredFailures()
      stopObserving()
    }
  }
}

const renderRun = (result: RunResult, format: Format.ValueOptions, labels: Format.Labels | undefined): string => {
  const frames = result.range === undefined ? "no frames" : `f${result.range[0]}-f${result.range[1]}`
  const head = `run ${result.schedule}: ${result.frames} frames (${frames}) in ${Format.value(result.ms)}ms`
  const stop = result.stop
  switch (stop.reason) {
    case "completed":
      return `${head}, completed`
    case "until":
      return `${head}, stopped at f${stop.frame}: until() returned true`
    case "failure":
      return `${head}, FAILED at f${stop.frame}: ${stop.system} returned ${Format.value(stop.error, format)}`
    case "missingRequirements":
      return `${head}, FAILED at f${stop.frame}: missing runtime requirements ${Format.value(stop.requirements, format)}`
    case "defect":
      return `${head}, DEFECT at f${stop.frame}: ${stop.error instanceof Error ? stop.error.stack ?? stop.error.message : Format.value(stop.error, format)}`
    case "invariant":
      return `${head}, INVARIANT "${stop.invariant}" violated at f${stop.frame}: ${stop.message.replace(entityToken, (_token, id: string) => Format.entity(Number(id), labels))}`
    case "invariant-threw":
      return `${head}, INVARIANT "${stop.invariant}" threw at f${stop.frame}: ${stop.error instanceof Error ? stop.error.stack ?? stop.error.message : Format.value(stop.error, format)}`
    case "labels-threw":
      return `${head}, LABELS threw at f${stop.frame}: ${stop.error instanceof Error ? stop.error.stack ?? stop.error.message : Format.value(stop.error, format)}`
    case "tickOrder":
      return `${head}, NOT RUN after f${stop.frame}: ${stop.issues.join("; ")}`
    case "ignored-failure":
      return `${head}, STOPPED: ${Format.ignoredFailure({ type: "failure.ignored", ...stop }, format)}, at f${stop.frame}`
  }
}
