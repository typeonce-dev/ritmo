/**
 * Replays: the last seconds of a play session, saved as a file an agent can
 * open headless, explain with a session, and turn into an ordinary test.
 *
 * A replay is a debug artifact, not a long-term test: open it, find the bug
 * with `why` / `journal`, `extract` the few ticks that show it into a test,
 * then delete the replay.
 *
 * - `recorder(runtime, options)` keeps a rolling window of one schedule's
 *   ticks: periodic world snapshots (so the window has a start), what each
 *   of the schedule's input services returned from `snapshot()` each tick
 *   (stored as changes from the previous tick), and every `runtime.send`.
 *   Time and randomness live in the world, so that is everything the
 *   simulation reads. `save(reason)` hands the file to a `Sink`.
 * - `session(make, file)` restores the start and replays the ticks in a
 *   normal devtools `Session`; `verify` replays twice and compares the
 *   checkpoint hashes to find nondeterminism; `extract` cuts a range of
 *   ticks into a small replay with its own start, for a test.
 *
 * Every service the recorded schedule needs must be a `snapshot()` source of
 * plain data (input) or plain data itself (rules, config); anything else is
 * a compile error naming the service, because it could not be replayed.
 * Effects the simulation has on the host go out through the world (events,
 * resources) instead.
 *
 * This module calls no platform API: sinks deliver files (`memorySink`
 * here; `ReplayNodeSink` writes files in Node; `ReplayViteSink` and
 * `ReplayVitePlugin` deliver to a Vite dev server), and wall time comes
 * from the injected `hostClock`.
 *
 * @module Replay
 * @docGroup devtools
 *
 * @example
 * ```ts
 * const recorder = Replay.recorder(runtime, {
 *   schedule: simulate, name: "simulate", keep: 30, step: Clock.hz(30),
 *   sink: ReplayViteSink.make({ fetch }), hostClock: HostClock.standard,
 *   saveOn: { failure: true, invariants: [DeadAreGone] }
 * })
 *
 * // later, in Node:
 * const replay = Replay.session(makeReplaySimulation, Replay.parse(JSON.parse(text)))
 * if (replay._tag === "Success") console.log(replay.success.play().text)
 * ```
 */
import type { Clock, HostClock } from "@typeonce/ritmo"
import type * as Debug from "@typeonce/ritmo/Debug"
import type { Descriptor } from "@typeonce/ritmo/Descriptor"
import type * as Requirement from "@typeonce/ritmo/Requirement"
import * as Result from "@typeonce/ritmo/Result"
import type { AnyScheduleOrder, ExecutableScheduleDefinition } from "@typeonce/ritmo/Schedule"
import type { Schema } from "@typeonce/ritmo/Schema"
import type * as Snapshot from "@typeonce/ritmo/Snapshot"

import * as Format from "./Format.ts"
import type { Invariant } from "./Invariant.ts"
import { libraryVersion } from "./internal/version.ts"
import * as Rendered from "./Rendered.ts"
import * as Session from "./Session.ts"

type AnySchedule<S extends Schema.Any, Root> = ExecutableScheduleDefinition<S, any, Root, any, any, AnyScheduleOrder>

/** The `@typeonce/ritmo-devtools` version written into replay files. */
export const version = libraryVersion

/** An input service: one value per call, such as a keyboard's actions this step. */
export interface Source<Data> {
  readonly snapshot: () => Data
}

/**
 * Whether a type is plain data (what JSON keeps): no functions, maps, sets,
 * or class instances with methods. Recursive types are checked once.
 */
export type IsPlain<T> = false extends PlainMember<T, never> ? false : true

// Checks one member of a union at a time (the conditional distributes), so a
// recursive type is recognised when it comes back (`Seen`).
type PlainMember<T, Seen> =
  T extends string | number | boolean | null | undefined ? true
  : [T] extends [Seen] ? true
  : T extends (...args: ReadonlyArray<never>) => unknown ? false
  : T extends ReadonlyArray<infer Element> ? PlainMember<Element, Seen | T>
  : T extends object ? PlainField<T, keyof T, Seen | T>
  : false

type PlainField<T, K extends keyof T, Seen> = K extends keyof T ? PlainMember<T[K], Seen> : never

type ServiceNeeds<Schedule> = Extract<Requirement.Of<Schedule>, Descriptor<"service", string, any>>

type UnrecordableService<Need> =
  Need extends Descriptor<"service", infer Name, infer Value>
    ? Value extends Source<infer Data>
      ? IsPlain<Data> extends true ? never
        : `${Name}: its snapshot() returns data that is not plain (no functions, maps, or class instances), so it cannot be saved`
      : IsPlain<Value> extends true ? never
        : `${Name} is neither a snapshot() source of plain data nor plain data: give the simulation its input through a source, and its effects on the host through events or resources`
    : never

/**
 * Rejects a schedule whose services could not be replayed, naming each one.
 * Resolves to `unknown` when every service is a plain-data source or plain data.
 */
export type ValidateRecordable<Schedule> =
  [UnrecordableService<ServiceNeeds<Schedule>>] extends [never]
    ? unknown
    : { readonly __fixReplayServices__: UnrecordableService<ServiceNeeds<Schedule>> }

/** What happened in one recorded tick, beyond what the world already holds. */
export interface TickRecord {
  /** The recorder's tick number, counting the recorded schedule's ticks from 1. */
  readonly tick: number
  /** Per source service: what `snapshot()` returned this tick, in call order. Absent when it repeats the previous tick; the first tick of a saved window carries every value. */
  readonly services?: Readonly<Record<string, ReadonlyArray<unknown>>>
  /** Events the host sent since the previous recorded tick, in order. */
  readonly sent?: ReadonlyArray<{ readonly event: string; readonly value: unknown }>
}

/** A replay file (JSON). */
export interface ReplayFile {
  readonly format: "ritmo-replay"
  readonly version: 1
  /** The `@typeonce/ritmo-devtools` version that recorded it. */
  readonly library: string
  /** Hash of the schema (components, resources, events, relations, machines) from `describe()`. */
  readonly schema: string
  /** The recorded schedule's name. */
  readonly schedule: string
  /** Why it was saved, e.g. "invariant DeadAreGone broke at tick 1412". */
  readonly reason: string
  /** `hostClock.now()` when it was saved. */
  readonly savedAt: number
  /** Services that are plain data, as they were (rules, config). */
  readonly constants: Readonly<Record<string, unknown>>
  /** The world at the end of tick `start.tick`; replay starts with the tick after it. */
  readonly start: {
    readonly tick: number
    readonly snapshot: Snapshot.WorldSnapshot
    /** Commands queued and not yet applied at that point: a snapshot does not hold them, so a replay may diverge. */
    readonly pendingCommands: number
  }
  readonly ticks: ReadonlyArray<TickRecord>
  /** Hashes of the world at the end of some ticks, to compare a replay against. */
  readonly checkpoints: ReadonlyArray<{ readonly tick: number; readonly hash: string }>
}

/** Where `save` hands a replay. */
export interface Sink {
  readonly save: (file: ReplayFile) => void
}

/** A sink that keeps replays in memory (for tests, or for a host that delivers them itself). */
export const memorySink = (): Sink & { readonly files: ReadonlyArray<ReplayFile> } => {
  const files: Array<ReplayFile> = []
  return { files, save: (file) => { files.push(file) } }
}

/** What a recorder needs from a runtime: made with `debug: { hostClock }`, with snapshots available. */
export interface Recordable<S extends Schema.Any, Root> {
  readonly debug: Debug.Handle<S, Root>
  readonly snapshot: () => Result.Result<Snapshot.WorldSnapshot, Snapshot.SnapshotError>
  readonly services: Readonly<Record<string, unknown>>
  readonly inspect: (inspector: never) => unknown
}

export interface RecorderOptions<S extends Schema.Any, Root, Recorded extends AnySchedule<S, Root>> {
  /** The schedule to record: the one ticked once per simulation step. */
  readonly schedule: Recorded
  /** Its name in the file and in the replay's session. */
  readonly name: string
  /** Seconds of play to keep. */
  readonly keep: number
  /** The schedule's fixed step (`Clock.hz(...)`), the same the game's clock runs at. */
  readonly step: Clock.Step
  /** Seconds between world snapshots. Defaults to 5. */
  readonly every?: number
  readonly sink: Sink
  /**
   * Wall time, for `savedAt` (milliseconds since the epoch): sinks name
   * files from it, so use `HostClock.standard`, not a page-relative clock
   * like `BrowserHostClock` (`HostClock.test()` in tests).
   */
  readonly hostClock: HostClock.HostClock
  /** Saves by itself: when a tick fails or throws, and when an invariant breaks (once until it holds again). */
  readonly saveOn?: {
    readonly failure?: boolean
    readonly invariants?: ReadonlyArray<Invariant<Invariant.CheckInspector>>
  }
}

export interface Recorder {
  /** Hands the current window to the sink, with `reason`, and returns it. */
  readonly save: (reason: string) => ReplayFile
  /** Ticks of the recorded schedule so far. */
  readonly ticks: () => number
  /** Stops recording and restores the services' own `snapshot`. */
  readonly stop: () => void
}

/** FNV-1a over a string, as 8 hex digits: a cheap fingerprint for checkpoints and schemas. */
const fingerprint = (text: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

/** The schema's fingerprint: what must match for a replay to load. */
export const schemaHash = <S extends Schema.Any, Root>(debug: Debug.Handle<S, Root>): string => {
  const description = debug.describe()
  return fingerprint(JSON.stringify({
    components: description.components.map(({ name, storage }) => ({ name, storage })),
    resources: description.resources.map(({ name, storage }) => ({ name, storage })),
    events: description.events,
    relations: description.relations,
    machines: description.machines.map(({ name, states }) => ({ name, states }))
  }))
}

const worldHash = (snapshot: Snapshot.WorldSnapshot): string => fingerprint(JSON.stringify(snapshot))

// A world whose snapshot fails (an `encode` rejected a value) hashes its failure, so replays still compare.
const savedHash = (saved: Result.Result<Snapshot.WorldSnapshot, Snapshot.SnapshotError>): string =>
  saved._tag === "Success" ? worldHash(saved.success) : fingerprint(JSON.stringify(saved))

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const isSource = (value: unknown): value is Source<unknown> => isRecord(value) && typeof value["snapshot"] === "function"

/** The names of the services a schedule needs. */
const serviceNames = (schedule: { readonly requirements: ReadonlyArray<unknown> }): Array<string> =>
  schedule.requirements.flatMap((requirement) =>
    isRecord(requirement) && requirement["kind"] === "service" && typeof requirement["name"] === "string" ? [requirement["name"]] : [])

/**
 * Starts recording a runtime made with `debug: { hostClock }`. The schedule's source
 * services have their `snapshot` wrapped to record what the systems got; the
 * services must not be frozen.
 */
export const recorder = <S extends Schema.Any, Root, const Recorded extends AnySchedule<S, Root>>(
  runtime: Recordable<S, Root>,
  options: RecorderOptions<S, Root, Recorded> & ValidateRecordable<Recorded>
): Recorder => {
  const keepTicks = Math.max(1, Math.ceil(options.keep / options.step.dt))
  const everyTicks = Math.max(1, Math.round((options.every ?? 5) / options.step.dt))
  const constants: Record<string, unknown> = {}
  const restores: Array<() => void> = []
  let current: Map<string, Array<unknown>> | undefined
  for (const name of serviceNames(options.schedule)) {
    const service = runtime.services[name]
    if (!isSource(service)) {
      constants[name] = service
      continue
    }
    const own = service.snapshot
    Reflect.set(service, "snapshot", () => {
      const value = own.call(service)
      if (current !== undefined) {
        const calls = current.get(name)
        if (calls === undefined) current.set(name, [value])
        else calls.push(value)
      }
      return value
    })
    restores.push(() => Reflect.set(service, "snapshot", own))
  }

  let tick = 0
  let sent: Array<{ readonly event: string; readonly value: unknown }> = []
  let ticks: Array<TickRecord> = []
  /** Snapshot points still needed: the newest one at or before the window start, and every later one. */
  let points: Array<{ readonly tick: number; readonly snapshot: Snapshot.WorldSnapshot; readonly pendingCommands: number }> = []
  let checkpoints: Array<{ readonly tick: number; readonly hash: string }> = []
  const previous = new Map<string, string>()
  const broken = new Set<string>()

  const takePoint = () => {
    const saved = runtime.snapshot()
    // A world that cannot be saved now (an `encode` rejected a value) adds no point: the window starts at an earlier one.
    if (saved._tag === "Failure") return
    const snapshot = saved.success
    points.push({ tick, snapshot, pendingCommands: runtime.debug.dump({ limit: 0 }).pendingCommands.length })
    checkpoints.push({ tick, hash: worldHash(snapshot) })
    const windowStart = tick - keepTicks
    let firstNeeded = -1
    for (let index = 0; index < points.length; index++) if (points[index]!.tick <= windowStart) firstNeeded = index
    if (firstNeeded > 0) {
      points = points.slice(firstNeeded)
      const start = points[0]!.tick
      // Service values are stored only when they change, so the first kept
      // tick takes the latest values of the dropped ones it does not repeat:
      // the window must replay on its own.
      const carried: Record<string, ReadonlyArray<unknown>> = {}
      for (const record of ticks) if (record.tick <= start && record.services !== undefined) Object.assign(carried, record.services)
      ticks = ticks.filter((record) => record.tick > start)
      const first = ticks[0]
      if (first !== undefined && Object.keys(carried).length > 0) {
        ticks[0] = { ...first, services: { ...carried, ...first.services } }
      }
      checkpoints = checkpoints.filter((checkpoint) => checkpoint.tick >= start)
    }
  }
  takePoint()

  const save = (reason: string): ReplayFile => {
    const start = points[0]!
    const file: ReplayFile = {
      format: "ritmo-replay",
      version: 1,
      library: libraryVersion,
      schema: schemaHash(runtime.debug),
      schedule: options.name,
      reason,
      savedAt: options.hostClock.now(),
      constants,
      start,
      ticks: ticks.filter((record) => record.tick > start.tick),
      checkpoints: checkpoints.filter((checkpoint) => checkpoint.tick >= start.tick)
    }
    options.sink.save(file)
    return file
  }

  const check = runtime.inspect as (inspector: Invariant.CheckInspector) => string | undefined
  const stopObserving = runtime.debug.observeHost((event) => {
    if (event.type === "send") {
      sent.push({ event: event.event, value: event.value })
      return
    }
    if (event.type === "failure.ignored") {
      // An unread failure is a failure nobody saw: save it like one.
      if (options.saveOn?.failure === true) save(Format.ignoredFailure(event))
      return
    }
    if (!event.schedules.includes(options.schedule)) return
    if (event.type === "tick.start") {
      tick += 1
      current = new Map()
      return
    }
    const calls = current ?? new Map<string, Array<unknown>>()
    current = undefined
    const changed: Record<string, ReadonlyArray<unknown>> = {}
    for (const [name, values] of calls) {
      const text = JSON.stringify(values)
      if (previous.get(name) !== text) changed[name] = values
      previous.set(name, text)
    }
    ticks.push({
      tick,
      ...(Object.keys(changed).length > 0 ? { services: changed } : {}),
      ...(sent.length > 0 ? { sent } : {})
    })
    sent = []
    if (tick % everyTicks === 0) takePoint()
    if (event.outcome !== "ok" && options.saveOn?.failure === true) {
      save(`tick ${tick} ${event.outcome === "defect" ? "threw" : "failed"}: ${describeError(event.error)}`)
    }
    for (const invariant of options.saveOn?.invariants ?? []) {
      const message = check(invariant.inspector)
      if (message === undefined) {
        broken.delete(invariant.name)
      } else if (!broken.has(invariant.name)) {
        broken.add(invariant.name)
        save(`invariant ${invariant.name} broke at tick ${tick}: ${message}`)
      }
    }
  })

  return {
    save,
    ticks: () => tick,
    stop: () => {
      stopObserving()
      for (const restore of restores) restore()
    }
  }
}

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (isRecord(error) && typeof error["system"] === "string") return `${error["system"]} returned ${JSON.stringify(error["error"])}`
  return JSON.stringify(error) ?? String(error)
}

/** Why a replay could not be opened. */
export type ReplayError =
  | { readonly _tag: "InvalidReplay"; readonly message: string }
  | { readonly _tag: "SchemaMismatch"; readonly message: "replay recorded with an older schema"; readonly recorded: string; readonly current: string }
  | { readonly _tag: "MissingSchedule"; readonly schedule: string }
  | { readonly _tag: "RestoreFailed"; readonly error: Snapshot.RestoreError }
  /** `extract` could not save the world where the cut starts (an `encode` rejected a value). */
  | { readonly _tag: "SnapshotFailed"; readonly error: Snapshot.SnapshotError }

/** Checks the shape of untrusted replay data (`JSON.parse` output). */
export const parse = (data: unknown): Result.Result<ReplayFile, ReplayError> => {
  const invalid = (message: string) => Result.fail<ReplayError>({ _tag: "InvalidReplay", message })
  if (!isRecord(data) || data["format"] !== "ritmo-replay") return invalid("not a ritmo replay (format)")
  if (data["version"] !== 1) return invalid(`unsupported replay version ${JSON.stringify(data["version"])}`)
  for (const key of ["library", "schema", "schedule", "reason"] as const) {
    if (typeof data[key] !== "string") return invalid(`${key} must be a string`)
  }
  const start = data["start"]
  if (!isRecord(start) || typeof start["tick"] !== "number" || !isRecord(start["snapshot"])) return invalid("start must hold a tick and a snapshot")
  if (!Array.isArray(data["ticks"]) || !data["ticks"].every((record) => isRecord(record) && typeof record["tick"] === "number")) return invalid("ticks must be tick records")
  if (!Array.isArray(data["checkpoints"])) return invalid("checkpoints must be a list")
  if (!isRecord(data["constants"])) return invalid("constants must be an object")
  // The snapshot itself is validated by `restore`, and service values by the systems that read them.
  return Result.succeed(data as unknown as ReplayFile)
}

/**
 * What a replay hands the game's `make` function: the recorded input, as
 * sources to provide in place of the live ones, and the recorded constants.
 */
export interface Playback {
  /** A source returning, call by call, what the recorded one returned at the current tick. */
  readonly source: <const Name extends string, Data>(descriptor: Descriptor<"service", Name, Source<Data>>) => Source<Data>
  /** A constant service's recorded value (`undefined` if it was not recorded). */
  readonly constant: <const Name extends string, Value>(descriptor: Descriptor<"service", Name, Value>) => unknown
}

/**
 * What the game's `make` function returns: a fresh runtime
 * (`debug: { hostClock }`) built on the playback, the recorded schedule by
 * name, and the clock the replay session times runs with
 * (`HostClock.test()` for identical text output).
 */
export interface Target<S extends Schema.Any, Root> {
  readonly hostClock: HostClock.HostClock
  readonly runtime: Session.Target<S, Root> & {
    readonly snapshot: () => Result.Result<Snapshot.WorldSnapshot, Snapshot.SnapshotError>
    readonly restore: (data: unknown) => Result.Result<void, Snapshot.RestoreError>
    readonly send: (descriptor: never, value: never) => void
  }
  readonly schedules: Readonly<Record<string, AnySchedule<S, Root>>>
}

export interface PlayResult {
  /** The session's run of the replayed ticks. */
  readonly run: Session.RunResult
  /** Recorded checkpoints whose hash differs in this replay: the simulation is not deterministic, or the code changed. */
  readonly diverged: ReadonlyArray<{ readonly tick: number; readonly recorded: string; readonly replayed: string }>
}

export interface ReplaySession<S extends Schema.Any, Names extends string> {
  /** The devtools session the ticks run in: `why`, `journal`, `report` work as in any run. */
  readonly session: Session.Session<S, Names>
  readonly file: ReplayFile
  /** Replays the recorded ticks (up to `to`, the recorder's tick number) and compares checkpoints. */
  readonly play: (options?: { readonly to?: number }) => Rendered.Rendered<PlayResult>
  /** Hashes of the world at the end of each replayed tick so far. */
  readonly hashes: () => ReadonlyMap<number, string>
  /** The world as plain data now (fails when an `encode` rejects a value). */
  readonly snapshot: () => Result.Result<Snapshot.WorldSnapshot, Snapshot.SnapshotError>
}

/**
 * Opens a replay: builds the game with `make(playback)`, checks the schema,
 * restores the start, and returns a session ready to `play`.
 */
export const session = <S extends Schema.Any, Root>(
  make: (playback: Playback) => Target<S, Root>,
  file: ReplayFile
): Result.Result<ReplaySession<S, string>, ReplayError> => {
  /** The last tick replayed (the start's tick before any). */
  let ran = file.start.tick
  let calls = new Map<string, number>()
  const latest = new Map<string, ReadonlyArray<unknown>>()
  const byTick = new Map(file.ticks.map((record) => [record.tick, record] as const))
  const playback: Playback = {
    source: (descriptor) => ({
      snapshot: () => {
        const values = latest.get(descriptor.name) ?? []
        const index = calls.get(descriptor.name) ?? 0
        calls.set(descriptor.name, index + 1)
        // Each call this tick returns what the recorded call returned (the last one again past the end).
        return values[Math.min(index, values.length - 1)] as never
      }
    }),
    constant: (descriptor) => file.constants[descriptor.name]
  }
  const target = make(playback)
  const schedule = target.schedules[file.schedule]
  if (schedule === undefined) return Result.fail({ _tag: "MissingSchedule", schedule: file.schedule })
  const current = schemaHash(target.runtime.debug)
  if (current !== file.schema) {
    return Result.fail({ _tag: "SchemaMismatch", message: "replay recorded with an older schema", recorded: file.schema, current })
  }
  const restored = target.runtime.restore(file.start.snapshot)
  if (restored._tag === "Failure") return Result.fail({ _tag: "RestoreFailed", error: restored.failure })
  const replay = Session.make(target.runtime, { schedules: { [file.schedule]: schedule }, hostClock: target.hostClock })
  const send = target.runtime.send as (descriptor: { readonly kind: "event"; readonly name: string; readonly key: symbol }, value: unknown) => void
  const events = new Map(target.runtime.debug.describe().events.map(({ name }) => [name, { kind: "event" as const, name, key: Symbol.for(`ritmo/event/${name}`) }]))
  const hashes = new Map<number, string>([[ran, savedHash(target.runtime.snapshot())]])
  const recorded = new Map(file.checkpoints.map(({ tick, hash }) => [tick, hash] as const))
  const last = file.ticks.at(-1)?.tick ?? file.start.tick

  const play = (options: { readonly to?: number } = {}): Rendered.Rendered<PlayResult> => {
    const to = Math.min(options.to ?? last, last)
    const frames = Math.max(0, to - ran)
    const diverged: Array<{ readonly tick: number; readonly recorded: string; readonly replayed: string }> = []
    const run = replay.run(file.schedule, {
      frames,
      // `until` runs after each frame: the tick is checked, and the next one's input set up before it runs.
      until: () => {
        ran += 1
        const hash = savedHash(target.runtime.snapshot())
        hashes.set(ran, hash)
        const expected = recorded.get(ran)
        if (expected !== undefined && expected !== hash) diverged.push({ tick: ran, recorded: expected, replayed: hash })
        prepare(ran + 1)
        return false
      }
    })
    return Rendered.make({ run: run.data, diverged }, diverged.length === 0
      ? `${run.text}\ncheckpoints match`
      : `${run.text}\nDIVERGED at ${diverged.map((entry) => `tick ${entry.tick}`).join(", ")}: the simulation is not deterministic, or the code changed since recording`)
  }

  /** Sets up tick `next`: its sends, and its sources' values. */
  const prepare = (next: number) => {
    const record = byTick.get(next)
    for (const [name, values] of Object.entries(record?.services ?? {})) latest.set(name, values)
    calls = new Map()
    for (const { event, value } of record?.sent ?? []) {
      const descriptor = events.get(event)
      if (descriptor !== undefined) send(descriptor, value)
    }
  }
  prepare(ran + 1)

  return Result.succeed({
    session: replay,
    file,
    play,
    hashes: () => hashes,
    snapshot: () => target.runtime.snapshot()
  })
}

/**
 * Replays twice and compares the world after every tick: different hashes
 * mean the simulation reads something the replay does not hold (wall time,
 * `Math.random`, host state).
 */
export const verify = <S extends Schema.Any, Root>(
  make: (playback: Playback) => Target<S, Root>,
  file: ReplayFile
): Result.Result<Rendered.Rendered<{ readonly deterministic: boolean; readonly firstDifference: number | undefined; readonly diverged: PlayResult["diverged"] }>, ReplayError> => {
  const first = session(make, file)
  if (first._tag === "Failure") return first
  const second = session(make, file)
  if (second._tag === "Failure") return second
  const played = first.success.play()
  second.success.play()
  const ticks = [...first.success.hashes().keys()].sort((left, right) => left - right)
  const firstDifference = ticks.find((tick) => first.success.hashes().get(tick) !== second.success.hashes().get(tick))
  const deterministic = firstDifference === undefined
  return Result.succeed(Rendered.make(
    { deterministic, firstDifference, diverged: played.data.diverged },
    deterministic
      ? `deterministic over ${ticks.length - 1} ticks${played.data.diverged.length === 0 ? ", and matches the recording" : `, but differs from the recording at tick ${played.data.diverged[0]!.tick}`}`
      : `NOT deterministic: two replays differ from tick ${firstDifference}`
  ))
}

/**
 * Cuts ticks `from`..`to` (recorder tick numbers) into a smaller replay that
 * starts at the end of tick `from - 1`: few enough ticks to keep next to a
 * test and play with `session`.
 */
export const extract = <S extends Schema.Any, Root>(
  make: (playback: Playback) => Target<S, Root>,
  file: ReplayFile,
  range: { readonly from: number; readonly to: number }
): Result.Result<ReplayFile, ReplayError> => {
  const opened = session(make, file)
  if (opened._tag === "Failure") return opened
  opened.success.play({ to: range.from - 1 })
  const saved = opened.success.snapshot()
  if (saved._tag === "Failure") return Result.fail({ _tag: "SnapshotFailed", error: saved.failure })
  const start = saved.success
  // Each kept tick carries its sources' values in full, so the extract does not depend on earlier ticks.
  const latest = new Map<string, ReadonlyArray<unknown>>()
  const ticks: Array<TickRecord> = []
  for (const record of file.ticks) {
    for (const [name, values] of Object.entries(record.services ?? {})) latest.set(name, values)
    if (record.tick < range.from || record.tick > range.to) continue
    ticks.push({ tick: record.tick, services: Object.fromEntries(latest), ...(record.sent === undefined ? {} : { sent: record.sent }) })
  }
  opened.success.play({ to: range.to })
  const checkpoints = [...opened.success.hashes()].filter(([tick]) => tick >= range.from - 1 && tick <= range.to).map(([tick, hash]) => ({ tick, hash }))
  return Result.succeed({
    ...file,
    reason: `${file.reason} (ticks ${range.from}-${range.to})`,
    start: { tick: range.from - 1, snapshot: start, pendingCommands: 0 },
    ticks,
    checkpoints
  })
}
