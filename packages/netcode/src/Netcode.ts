/**
 * Networked sessions: peers that run the same simulation and agree on it.
 *
 * Every peer runs one runtime of the game and one session. Each frame, the
 * game hands its session the local player's input with `advance`; the
 * session exchanges inputs with the other peers over `NetworkLink`s and
 * ticks the simulation schedule with the input of every seat:
 *
 * - `rollback(runtime, options)` ticks at once, guessing input that has not
 *   arrived (`predict`), and when real input contradicts a guess, rewinds to
 *   the tick it was for and ticks again up to the present (with the
 *   runtime's checkpoints). For real-time games: input feels immediate.
 * - `lockstep(runtime, options)` ticks only once every seat's input for the
 *   tick has arrived. For turn-based or slow-paced games: nothing is ever
 *   run again, so the schedule needs no checkpoints, but every tick waits on
 *   the slowest message.
 *
 * The simulation reads input from one source: `seats(codec, { count, idle })`
 * makes it, the game provides `seats.source` as a service and captures it
 * (`InputCapture.system`), and the session fills it before each tick. Remote
 * input never goes through `runtime.send`.
 *
 * Seat 0 hosts: once every seat has said hello, it saves its world and
 * every peer, seat 0 too, restores that save at the same tick, so readers
 * start equal everywhere. The same step, `resync()`, recovers from a desync.
 *
 * Every `checksumEvery` ticks, peers compare `runtime.checksum()` of a
 * confirmed tick (one every seat's real input reached). A mismatch is a bug
 * in the game's determinism: `advance` fails with `Desynced` until the game
 * calls `resync()`. `session.update(...)` drives a session from a
 * `FixedLoop` and answers every halt with a resync.
 *
 * Host code outside the simulation (rendering, sound, a HUD) never rewinds:
 * it sees a rollback as ordinary changes, and events of ticks run again are
 * published again; act on them once their tick is confirmed (`status()`).
 * A frame the session cannot run (`Stalled`) drops its input, so feed it
 * state (held, aimed at) rather than one-frame edges.
 *
 * @module Netcode
 * @docGroup netcode
 *
 * @example
 * ```ts
 * const seats = Netcode.seats(PlayerInput, { count: 2, idle }).value!
 * const Seats = Descriptor.Service<Netcode.Source<PlayerInput>>()("Game/Seats")
 * const runtime = Game.Runtime.make({ services: Game.Runtime.services(Game.Runtime.service(Seats, seats.source)), ... }).value
 *
 * const session = Netcode.rollback(runtime, {
 *   simulate, seats, seat: 0, links: [link], hostClock: BrowserHostClock.make(window), step
 * })
 * if (!session.ok) throw new Error(session.error.reason)
 *
 * FixedLoop.start({
 *   source: BrowserTickSource.make(window), step, maxFrameSeconds: 0.25, maxStepsPerFrame: 5,
 *   rate: session.value.rate,
 *   update: session.value.update({ input: readInput, onHalted: (error) => console.error(error) }),
 *   render: () => runtime.tick(draw),
 *   onFailure: (failure) => showDisconnected(failure)
 * })
 * ```
 */
import type { Clock, HostClock } from "@typeonce/ritmo"
import type * as Checkpoint from "@typeonce/ritmo/Checkpoint"
import type * as Descriptor from "@typeonce/ritmo/Descriptor"
import * as Result from "@typeonce/ritmo/Result"
import type * as Runtime from "@typeonce/ritmo/Runtime"
import type { AnyScheduleOrder, ExecutableScheduleDefinition, FailureOf } from "@typeonce/ritmo/Schedule"
import type { Schema } from "@typeonce/ritmo/Schema"
import type * as Snapshot from "@typeonce/ritmo/Snapshot"
import type * as System from "@typeonce/ritmo/System"

import * as HaltedInternal from "./internal/halted.ts"
import * as Internal from "./internal/session.ts"
import * as SeatsInternal from "./internal/seats.ts"
import type { NetworkLink } from "./NetworkLink.ts"

/**
 * The simulation's input: one value per seat, for the tick being run.
 * Provide `seats.source` as the service, and capture it once at the start
 * of the simulation (`InputCapture.system`).
 */
export interface Source<Input> extends System.Consumes<"snapshot"> {
  readonly snapshot: () => ReadonlyArray<Input>
}

/** The players of a networked game and the input each sends, made by {@link seats}. */
export interface Seats<Input> {
  /** How many seats, one per player. */
  readonly count: number
  /** The input of a seat that pressed nothing: before its first input arrives, and for the first `inputDelay` ticks. */
  readonly idle: Input
  /** The service the simulation reads input from. One session fills it. */
  readonly source: Source<Input>
}

/** An option a constructor rejected, and why. */
export interface InvalidOptions {
  readonly _tag: "InvalidOptions"
  readonly field: string
  readonly value: unknown
  readonly reason: string
}

/**
 * The players of a networked game: `count` seats whose input is decoded
 * with `codec` (a Standard Schema the game brings, like a constructed
 * component's) when it arrives from another peer. `idle` must decode.
 */
export const seats = <const S extends Descriptor.Codec<any, any>>(
  codec: S & Descriptor.CheckedCodec<S>,
  options: { readonly count: number; readonly idle: Descriptor.CodecType<S> }
): Result.Result<Seats<Descriptor.CodecType<S>>, InvalidOptions> =>
  SeatsInternal.make(codec, options) as Result.Result<Seats<Descriptor.CodecType<S>>, InvalidOptions>

/**
 * What one `advance` did. `input` is the tick the local input was recorded
 * for, or `undefined` when it was dropped: the session is waiting, or
 * already holds as many inputs ahead as `inputDelay` allows.
 */
export type Advanced =
  /** No match yet: seat 0 has not heard from every seat, or this peer has not received its save. The input was dropped. */
  | { readonly _tag: "Waiting" }
  /**
   * Nothing ran: lockstep is waiting for another seat's input, or rollback
   * is `maxRollback` ticks past the last tick every seat confirmed (then
   * the input was dropped too).
   */
  | { readonly _tag: "Stalled"; readonly input: number | undefined }
  /** Ticked `ticks` ticks up to `tick` (excluded), of which `again` after a rollback. */
  | { readonly _tag: "Ran"; readonly tick: number; readonly ticks: number; readonly again: number; readonly input: number | undefined }

/**
 * Two peers' checksums of a confirmed tick differ: the simulation is not
 * deterministic (a platform API, `Math.random`, iteration over unsorted
 * data). The session stops until `resync()`. `snapshot` is this peer's save
 * of that tick when the session keeps them (`keepSnapshots`), to compare
 * with the other's (`Desync.compare` in `@typeonce/ritmo-devtools`).
 */
export interface Desynced {
  readonly _tag: "Desynced"
  readonly tick: number
  readonly seat: number
  readonly mine: string
  readonly theirs: string
  readonly snapshot: Snapshot.WorldSnapshot | undefined
}

/**
 * A rollback could not rewind: the runtime let go of a checkpoint the
 * session needed (something else took or rewound checkpoints on the same
 * runtime), or a `Checkpoint.rewindable` service failed to restore
 * (`RestoreFailed`). The session stops until `resync()`.
 */
export interface CheckpointLost {
  readonly _tag: "CheckpointLost"
  readonly error: Checkpoint.RewindError
}

/** A system of the simulation failed on `tick`. The session stops until `resync()`. */
export interface TickFailed<TickError> {
  readonly _tag: "TickFailed"
  readonly tick: number
  readonly error: TickError
}

/**
 * Seat 0 could not save its world, or this peer could not restore the save:
 * the peers run different versions of the game, or a value does not encode.
 * Ends the session.
 */
export interface SyncFailed {
  readonly _tag: "SyncFailed"
  readonly error: Snapshot.SnapshotError | Snapshot.RestoreError
}

/** A link closed (`seat` is unknown), or a seat sent nothing for `timeoutMS`. Ends the session. */
export interface Disconnected {
  readonly _tag: "Disconnected"
  readonly seat: number | undefined
  readonly reason: "closed" | "timeout"
  readonly detail: string
}

/** Another peer speaks a different version of the session protocol. Ends the session. */
export interface ProtocolMismatch {
  readonly _tag: "ProtocolMismatch"
  readonly version: unknown
}

/** Stops the session until `resync()`: every peer then starts again from seat 0's world. */
export type Halted<TickError> = Desynced | CheckpointLost | TickFailed<TickError>

/** Ends the session: every later `advance` fails with the same error. */
export type Ended = SyncFailed | Disconnected | ProtocolMismatch

/** Why `advance` ran nothing: the session {@link Halted} until `resync()`, or {@link Ended}. */
export type SessionError<TickError> = Halted<TickError> | Ended

/** Whether the session only stopped until `resync()`, rather than ended. */
export const isHalted: <TickError>(error: SessionError<TickError>) => error is Halted<TickError> = HaltedInternal.isHalted

/** Where a session stands, for a HUD or a test. */
export interface Status {
  /** The match's save number: 0 before the first save arrived, then one more for each resync. */
  readonly epoch: number
  /** The next tick to run. */
  readonly tick: number
  /** Every tick before this one has every seat's real input: its events will not be published again. */
  readonly confirmed: number
  /** The last tick whose checksum every seat agreed on (`-1`: none yet in this epoch). */
  readonly verified: number
  /** Ticks run again after rollbacks, in total. */
  readonly again: number
  /** Rollbacks, in total. */
  readonly rollbacks: number
  /** Messages dropped because they did not parse or decode. */
  readonly dropped: number
  /** How many ticks this peer runs ahead of the slowest other seat (negative: behind). */
  readonly ahead: number
  /** The smoothed round trip to each other seat, in milliseconds (`undefined`: not measured yet). */
  readonly roundTripMS: ReadonlyArray<number | undefined>
}

/** A networked session around one runtime. */
export interface Session<Input, TickError> {
  /**
   * Runs this frame: reads the links, rolls back if real input contradicts
   * a guess (rollback), records `local` as this seat's input for the tick
   * `inputDelay` ticks ahead, ticks the simulation, and sends what the other
   * peers need. Call it once per fixed step, from `FixedLoop`'s `update`.
   */
  readonly advance: (local: Input) => Result.Result<Advanced, SessionError<TickError>>
  /**
   * Starts the match again from seat 0's world: seat 0 saves it, and every
   * peer restores the save at the same tick. Clears `Desynced`,
   * `CheckpointLost`, and `TickFailed`; does nothing once the session ended.
   */
  readonly resync: () => void
  /**
   * How fast this peer should run, for `FixedLoop`'s `rate`: below 1 while
   * it runs ahead of the others, so peers stay within reach of each other.
   */
  readonly rate: () => number
  /**
   * The `update` of the `FixedLoop` that drives this session: each step
   * advances it with `input()`. A halt is reported to `onHalted` once (a
   * desync is a bug in the game's determinism: log it) and answered with
   * `resync()`, and the loop keeps running; the loop stops with the error
   * once the session ended.
   */
  readonly update: (options: {
    /** This seat's input for the step, read once per step. */
    readonly input: () => Input
    readonly onHalted: (error: Halted<TickError>) => void
  }) => () => Result.Result<void, Ended>
  readonly status: () => Status
}

/** Options both sessions take. */
export interface Options<Input> {
  readonly seats: Seats<Input>
  /** This peer's seat: `0` hosts. */
  readonly seat: number
  /** One link per other peer, or one to a relay. */
  readonly links: ReadonlyArray<NetworkLink>
  /** For round trips, pacing, and timeouts. */
  readonly hostClock: HostClock.HostClock
  /** The simulation's fixed step, as given to `FixedLoop`. */
  readonly step: Clock.Step
  /** Ticks between pressing and the tick the input is for (2 by default): fewer rollbacks, or less waiting, for a little lag. */
  readonly inputDelay?: number
  /** Ticks between checksum comparisons (30 by default). */
  readonly checksumEvery?: number
  /** A seat that sends nothing for this long is gone (5000 by default). */
  readonly timeoutMS?: number
  /** Keeps the save of each compared tick until the peers agree, so `Desynced` carries it. Costs a save per comparison. */
  readonly keepSnapshots?: boolean
}

/** Options of {@link rollback}. */
export interface RollbackOptions<Input> extends Options<Input> {
  /**
   * How many ticks past the last confirmed one this peer may run on
   * guesses (8 by default). The runtime must keep at least this many
   * checkpoints (`Game.Runtime.make`'s `checkpoints`, 16 by default).
   */
  readonly maxRollback?: number
  /** The guess for a seat's input from its last real one (the same input by default). */
  readonly predict?: (previous: Input) => Input
}

type AnySchedule<S extends Schema.Any, Root> = ExecutableScheduleDefinition<S, any, Root, any, any, AnyScheduleOrder>

/** Resolves to `unknown` when the runtime can save and restore, otherwise to the fix (as `snapshot` does). */
type ValidateSaveable<S extends Schema.Any> = Snapshot.Gate<S, unknown>

/**
 * A rollback session: ticks at once with guesses for missing input, and
 * runs ticks again when real input contradicts them. `simulate` must be
 * rewindable (`runtime.checkpoint`'s rules), the runtime must save and
 * restore (every component and resource constructed or transient), and it
 * must provide `seats.source`.
 */
export const rollback = <
  S extends Schema.Any,
  Services extends Record<string, unknown>,
  Resources extends object,
  Root,
  Machines extends Record<string, unknown>,
  Input,
  const Simulate extends AnySchedule<S, Root>
>(
  runtime: Runtime.Runtime<S, Services, Resources, Root, Machines> & ValidateSaveable<S>,
  options: RollbackOptions<Input> & {
    /** The schedule every peer ticks the same way. */
    readonly simulate: Simulate & Checkpoint.ValidateRewindable<Simulate> & Runtime.ValidateScheduleArray<readonly [Simulate], Services, Resources, Machines>
  }
): Result.Result<Session<Input, FailureOf<Simulate>>, InvalidOptions> =>
  Internal.make("rollback", runtime as unknown as Internal.Driven, options as unknown as Internal.MakeOptions) as Result.Result<Session<Input, FailureOf<Simulate>>, InvalidOptions>

/**
 * A lockstep session: ticks only with every seat's real input, so nothing
 * runs twice. The runtime must save and restore (for the first save and
 * resyncs), and provide `seats.source`.
 */
export const lockstep = <
  S extends Schema.Any,
  Services extends Record<string, unknown>,
  Resources extends object,
  Root,
  Machines extends Record<string, unknown>,
  Input,
  const Simulate extends AnySchedule<S, Root>
>(
  runtime: Runtime.Runtime<S, Services, Resources, Root, Machines> & ValidateSaveable<S>,
  options: Options<Input> & {
    /** The schedule every peer ticks the same way. */
    readonly simulate: Simulate & Runtime.ValidateScheduleArray<readonly [Simulate], Services, Resources, Machines>
  }
): Result.Result<Session<Input, FailureOf<Simulate>>, InvalidOptions> =>
  Internal.make("lockstep", runtime as unknown as Internal.Driven, options as unknown as Internal.MakeOptions) as Result.Result<Session<Input, FailureOf<Simulate>>, InvalidOptions>
