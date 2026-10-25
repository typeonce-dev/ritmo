/**
 * Determinism checked across engines: one replay, played in this process and
 * in other JavaScript engines (real browsers), must reach the same world
 * after every tick. `Ops` promises the same bits on every engine and a
 * replay recorded in one browser should verify in another; this is the
 * check that runs both claims.
 *
 * - `acrossEngines(make, file, { engines })` plays the replay twice here
 *   (the reference, and a repeat of it), compares the reference with the
 *   recording's checkpoints, then with each engine's per-tick checksums. On
 *   the first tick an engine differs, it loads both worlds at that tick and
 *   names every differing value, as `Desync.compare` does.
 * - An `Engine` is any place that can run the game: `PlaywrightEngine`
 *   (Node host) runs Chromium, WebKit, and Firefox headless. For another
 *   host (a webview, a console devkit), run `trace` and `snapshotAt` there
 *   and wrap them as an `Engine`.
 *
 * `ritmo-devtools verify <entry> <replay> --engines node,chromium,webkit,firefox`
 * is this module from the command line. With no engines it is the quick
 * check in this process alone (two runs and the recording), the one a test
 * runs; with browsers it is the one to run before trusting a replay or a
 * lockstep match across them.
 *
 * This module calls no platform API: engines are injected.
 *
 * @module Verify
 * @docGroup devtools
 *
 * @example
 * ```ts
 * const engines = PlaywrightEngine.make({ entry: "src/replay-target.ts", browsers: ["chromium", "webkit"] })
 * const verified = await Verify.acrossEngines(replayTarget, file, { engines: engines.engines })
 * await engines.close()
 * if (!verified.ok) console.log(verified.error.text)
 * ```
 */
import * as Result from "@typeonce/ritmo/Result"
import type { Schema } from "@typeonce/ritmo/Schema"
import type * as Snapshot from "@typeonce/ritmo/Snapshot"

import * as Desync from "./Desync.ts"
import * as Format from "./Format.ts"
import * as Rendered from "./Rendered.ts"
import * as Replay from "./Replay.ts"

/** The world's checksum (`runtime.checksum()`) after each replayed tick, in tick order, the start's tick first. */
export type Hashes = ReadonlyArray<{ readonly tick: number; readonly hash: string }>

/** The engine cannot run here: the tool or browser that runs it is not installed. */
export interface EngineMissing {
  readonly _tag: "EngineMissing"
  readonly engine: string
  /** What is missing. */
  readonly reason: string
  /** The command that installs it. */
  readonly install: string
}

/** The engine started and could not finish: the game did not load or threw, or the replay did not open there. */
export interface EngineFailed {
  readonly _tag: "EngineFailed"
  readonly engine: string
  readonly message: string
}

/** Why an engine produced no result. */
export type EngineError = EngineMissing | EngineFailed

/**
 * A JavaScript engine that runs the game, other than this process:
 * `PlaywrightEngine` for browsers, or one a host builds from `trace` and
 * `snapshotAt` run there.
 */
export interface Engine {
  /** Its name in reports (`chromium`, `webkit`). */
  readonly name: string
  /** Plays the whole replay and returns the world's checksum after every tick: `trace` run there. */
  readonly trace: (file: Replay.ReplayFile) => Promise<Result.Result<Hashes, EngineError>>
  /** Plays the replay to the end of `tick` and returns the world: `snapshotAt` run there. */
  readonly snapshotAt: (file: Replay.ReplayFile, tick: number) => Promise<Result.Result<Snapshot.WorldSnapshot, EngineError>>
}

/** The replay played to its end: the checksum after every tick. What an `Engine` runs in its own engine. */
export const trace = <S extends Schema.Any, Root>(
  make: (playback: Replay.Playback) => Replay.Target<S, Root>,
  file: Replay.ReplayFile
): Result.Result<Hashes, Replay.ReplayError> => {
  const opened = Replay.session(make, file)
  if (!opened.ok) return opened
  opened.value.play()
  return Result.success([...opened.value.hashes()].sort(([left], [right]) => left - right).map(([tick, hash]) => ({ tick, hash })))
}

/** The world at the end of `tick` (a recorder tick number, or the start's tick), as plain data. What an `Engine` runs to explain a difference. */
export const snapshotAt = <S extends Schema.Any, Root>(
  make: (playback: Replay.Playback) => Replay.Target<S, Root>,
  file: Replay.ReplayFile,
  tick: number
): Result.Result<Snapshot.WorldSnapshot, Replay.ReplayError> => {
  const opened = Replay.session(make, file)
  if (!opened.ok) return opened
  opened.value.play({ to: tick })
  const snapshot = opened.value.snapshot()
  return snapshot.ok ? snapshot : Result.failure({ _tag: "SnapshotFailed", error: snapshot.error })
}

/** The engine reached the same world as the reference after every tick. */
export interface Agreed {
  readonly _tag: "Agreed"
  readonly engine: string
  /** Ticks compared, the start's tick not counted. */
  readonly ticks: number
}

/**
 * The first tick whose world differs. `against` is `"node"` (the reference
 * run in this process; for `engine: "node"`, a second run there) or
 * `"recording"` (the file's checkpoints, which hold only hashes, so
 * `differences` is empty).
 */
export interface Diverged {
  readonly _tag: "Diverged"
  readonly engine: string
  readonly against: "node" | "recording"
  readonly tick: number
  /** Every differing value at `tick`, the reference's world as `mine`, the engine's as `theirs`. */
  readonly differences: ReadonlyArray<Desync.Difference>
  /** Why `differences` is empty, when it is: the worlds could not be loaded, or they are equal as saves (the hash covers more). */
  readonly unexplained: string | undefined
}

/** What one engine's check found. */
export type Outcome = Agreed | Diverged | EngineError

/** Every engine agreed: the replay is deterministic here, matches its recording, and plays the same everywhere. */
export interface Verified {
  readonly schedule: string
  /** Ticks compared, the start's tick not counted. */
  readonly ticks: number
  /** `node` first, then each engine. */
  readonly engines: ReadonlyArray<string>
}

/** The replay did not open in this process: the reference could not run, so nothing was compared. */
export interface ReplayInvalid {
  readonly _tag: "ReplayInvalid"
  readonly error: Replay.ReplayError
  readonly text: string
}

/** Some engine did not agree: `outcomes` has one entry per engine, `node` first; narrow each by `_tag`. */
export interface NotVerified {
  readonly _tag: "NotVerified"
  readonly outcomes: ReadonlyArray<Outcome>
  readonly text: string
}

/** Why `acrossEngines` failed. */
export type VerifyError = ReplayInvalid | NotVerified

/** Which engines `acrossEngines` compares with this process. */
export interface Options {
  /** Engines checked against this process, in report order. None checks this process alone. */
  readonly engines?: ReadonlyArray<Engine>
}

const firstDifference = (reference: Hashes, other: Hashes): number | undefined => {
  const mine = new Map(reference.map(({ tick, hash }) => [tick, hash] as const))
  const theirs = new Map(other.map(({ tick, hash }) => [tick, hash] as const))
  return [...new Set([...mine.keys(), ...theirs.keys()])].sort((left, right) => left - right).find((tick) => mine.get(tick) !== theirs.get(tick))
}

/**
 * Plays `file` in this process twice and in each engine, and returns
 * `Verified` when every run reaches the same world after every tick as the
 * reference run here, and the reference matches the recording's
 * checkpoints. Otherwise it fails with `NotVerified`, one outcome per engine:
 * `Diverged` names the first differing tick and every differing value
 * there, and an engine that is not installed or did not finish is reported
 * as `EngineMissing` / `EngineFailed`, never skipped.
 *
 * `make` is the game's replay factory, the one `Replay.session` takes;
 * each engine loads the same one.
 */
export const acrossEngines = async <S extends Schema.Any, Root>(
  make: (playback: Replay.Playback) => Replay.Target<S, Root>,
  file: Replay.ReplayFile,
  options: Options = {}
): Promise<Result.Result<Rendered.Rendered<Verified>, VerifyError>> => {
  const reference = trace(make, file)
  if (!reference.ok) {
    return Result.failure({ _tag: "ReplayInvalid", error: reference.error, text: `the replay does not open here: ${JSON.stringify(reference.error)}` })
  }
  const here = (tick: number) => snapshotAt(make, file, tick)
  const ticks = reference.value.length - 1
  const outcomes: Array<Outcome> = []

  const repeat = trace(make, file)
  const repeated = repeat.ok ? firstDifference(reference.value, repeat.value) : undefined
  // As `Replay.session` does, the recording is compared on the replayed ticks, not on the start it restores.
  const checkpoints = file.checkpoints.filter(({ tick }) => tick > file.start.tick)
  const recorded = firstDifference(reference.value.filter(({ tick }) => checkpoints.some((checkpoint) => checkpoint.tick === tick)), checkpoints)
  if (!repeat.ok) {
    outcomes.push({ _tag: "EngineFailed", engine: "node", message: `a second run did not open: ${JSON.stringify(repeat.error)}` })
  } else if (repeated !== undefined) {
    outcomes.push(await explain("node", "node", repeated, here, async (tick) => here(tick)))
  } else if (recorded !== undefined) {
    outcomes.push({ _tag: "Diverged", engine: "node", against: "recording", tick: recorded, differences: [], unexplained: "the recording holds only a hash at this tick" })
  } else {
    outcomes.push({ _tag: "Agreed", engine: "node", ticks })
  }

  outcomes.push(...await Promise.all((options.engines ?? []).map(async (engine): Promise<Outcome> => {
    const traced = await engine.trace(file)
    if (!traced.ok) return traced.error
    const tick = firstDifference(reference.value, traced.value)
    if (tick === undefined) return { _tag: "Agreed", engine: engine.name, ticks }
    return explain(engine.name, "node", tick, here, (at) => engine.snapshotAt(file, at))
  })))

  if (outcomes.every((outcome) => outcome._tag === "Agreed")) {
    const engines = outcomes.map((outcome) => outcome.engine)
    return Result.success(Rendered.make(
      { schedule: file.schedule, ticks, engines },
      `verified ${ticks} ticks of ${file.schedule} on ${engines.join(", ")}: every engine reaches the same world as node after every tick, and node matches the recording`
    ))
  }
  return Result.failure({ _tag: "NotVerified", outcomes, text: [`NOT verified: ${ticks} ticks of ${file.schedule}`, ...outcomes.map(describe)].join("\n") })
}

/** Loads both worlds at `tick` and lists what differs. */
const explain = async (
  engine: string,
  against: "node",
  tick: number,
  mine: (tick: number) => Result.Result<Snapshot.WorldSnapshot, Replay.ReplayError>,
  theirs: (tick: number) => Promise<Result.Result<Snapshot.WorldSnapshot, Replay.ReplayError | EngineError>>
): Promise<Diverged> => {
  const left = mine(tick)
  const right = await theirs(tick)
  if (!left.ok || !right.ok) {
    const error = left.ok ? right.ok ? undefined : right.error : left.error
    return { _tag: "Diverged", engine, against, tick, differences: [], unexplained: `the worlds at this tick could not be loaded: ${JSON.stringify(error)}` }
  }
  const differences = Desync.compare(left.value, right.value).data
  return {
    _tag: "Diverged", engine, against, tick, differences,
    unexplained: differences.length === 0 ? "the saves are equal: the checksum covers something a snapshot does not show" : undefined
  }
}

const where = ({ path, entity }: Desync.Difference): string =>
  entity === undefined ? path : `${Format.entity(entity)}${path.slice(`entity ${entity}`.length)}`

/** One outcome as text: the first line names the engine, the tick, and the first difference. */
const describe = (outcome: Outcome): string => {
  switch (outcome._tag) {
    case "Agreed":
      return `${outcome.engine}: agrees with ${outcome.engine === "node" ? "a second node run and the recording" : "node"} over ${outcome.ticks} ticks`
    case "EngineMissing":
      return `${outcome.engine}: not installed (${outcome.reason}): ${outcome.install}`
    case "EngineFailed":
      return `${outcome.engine}: failed: ${outcome.message}`
    case "Diverged": {
      const reference = outcome.engine === outcome.against ? "a second node run" : outcome.against
      const [first] = outcome.differences
      const head = `tick ${outcome.tick}: ${outcome.engine} differs from ${reference}${first === undefined ? "" : ` in ${where(first)} (${Format.value(first.mine)} -> ${Format.value(first.theirs)})`}`
      if (outcome.unexplained !== undefined) return `${head}\n  ${outcome.unexplained}`
      return [head, `  ${outcome.differences.length} difference${outcome.differences.length === 1 ? "" : "s"} (${reference} -> ${outcome.engine}):`,
        ...outcome.differences.map((difference) => `    ${where(difference)}: ${Format.value(difference.mine)} -> ${Format.value(difference.theirs)}`)].join("\n")
    }
  }
}
