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
 * published again. It reads the simulation's events through
 * `session.events(descriptor)` ({@link EventStreams}): `confirmed()` hands
 * out each event once, when its tick can no longer run again; `predicted()`
 * the events of ticks that may still be undone; `withdrawn()` the ticks a
 * rollback undid.
 * A frame the session cannot run (`Stalled`) drops its input, so feed it
 * state (held, aimed at) rather than one-frame edges.
 *
 * A hidden browser tab stops its frames and goes silent: pass `hidden` (a
 * `Visibility` and a {@link HiddenPolicy}) so it tells the others instead,
 * and draw `status().hidden`.
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
import type { ReadonlyValue } from "@typeonce/ritmo/Query"
import type { Schema } from "@typeonce/ritmo/Schema"
import type * as Snapshot from "@typeonce/ritmo/Snapshot"
import type * as System from "@typeonce/ritmo/System"

import * as EventsInternal from "./internal/events.ts"
import * as HaltedInternal from "./internal/halted.ts"
import * as Internal from "./internal/session.ts"
import * as SeatsInternal from "./internal/seats.ts"
import type { NetworkLink } from "./NetworkLink.ts"
import type { Visibility } from "./Visibility.ts"

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
  /**
   * The input of a seat that pressed nothing: before its first input
   * arrives, for the first `inputDelay` (or `adaptiveDelay.max`) ticks after
   * a save, and for the ticks a rise of an adaptive delay skips.
   */
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
 * already holds as many inputs ahead as its input delay allows (as for a
 * few frames after an adaptive delay falls).
 */
export type Advanced =
  /**
   * No match yet: seat 0 has not heard from every seat, or this peer has not
   * received its save (also while hidden under `"resync-on-return"`, and
   * until seat 0's save answers its return). The input was dropped.
   */
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

/**
 * A link closed (`seat` is unknown), or a seat sent nothing for `timeoutMS`
 * (`timeoutMS + afterMS` while it is hidden, with the `hidden` option). Ends
 * the session.
 */
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
  /** Every tick before this one has every seat's real input: it will not run again (`session.events(...)` hands out its events as confirmed). */
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
  /**
   * Whether each seat's page is hidden (this seat's own included), as it
   * announced with the `hidden` option: draw who everyone is waiting for.
   */
  readonly hidden: ReadonlyArray<boolean>
  /** The input delay this seat uses now, in ticks: `inputDelay`, or where `adaptiveDelay` moved it. */
  readonly inputDelay: number
  /** How many times `adaptiveDelay` moved the delay, in total (0 with a fixed `inputDelay`). */
  readonly delayChanges: number
}

/** One event the simulation published, and the session tick that published it. */
export interface EventRecord<Value> {
  readonly tick: number
  readonly value: Value
}

/** A tick whose events `predicted()` handed out, and a rollback or a resync undid: cancel what they started. */
export interface Withdrawn {
  readonly tick: number
}

/**
 * Confirmed events dropped before the reader read them, from tick `from` up
 * to `to` (excluded): the reader did not call `confirmed()` for more than
 * {@link eventWindow} ticks, or one tick published more than the runtime's
 * `streamCapacity` events.
 */
export interface EventsLost {
  readonly _tag: "EventsLost"
  readonly from: number
  readonly to: number
}

/** How many confirmed ticks of events a reader of `session.events(...)` that stopped reading keeps; older ones are {@link EventsLost}. */
export const eventWindow: number = EventsInternal.window

/**
 * One host reader of one event of the simulation, made by
 * `session.events(descriptor)`. Each read hands out what is new since this
 * reader's previous read of the same stream, once, oldest tick first; make
 * one reader per place that acts on the event (sound, particles), and read
 * it after `advance` (from `FixedLoop`'s `render`).
 *
 * Act on `confirmed()` for effects that must happen exactly once (a sound,
 * a score sent to a server). For effects that must feel immediate
 * (particles), act on `predicted()` and undo with `withdrawn()`. A tick a
 * rollback runs again keeps what `predicted()` handed out when it publishes
 * the same events (plain data compared by value; a class instance or a map
 * counts as changed); otherwise it is withdrawn, and its new events are
 * predicted again. A resync withdraws every predicted tick. A reader sees
 * the ticks run from when it was made.
 */
export interface EventStreams<Value> {
  /**
   * Events of ticks that will not run again, each handed out once: a
   * rolled-back tick is handed out only as it finally ran. A lockstep
   * session confirms every tick it runs.
   */
  readonly confirmed: () => ReadonlyArray<EventRecord<Value>>
  /**
   * Events of ticks that may still be rolled back, each run handed out once.
   * A tick waiting in `withdrawn()` is held back until it is read there, so
   * a cancel never undoes the new run. Confirmed ticks are not repeated
   * here: an event first seen confirmed never appears as predicted.
   */
  readonly predicted: () => ReadonlyArray<EventRecord<Value>>
  /**
   * Ticks whose `predicted()` events a rollback or a resync undid since the
   * previous read: the tick ran again with other events, or not at all.
   */
  readonly withdrawn: () => ReadonlyArray<Withdrawn>
  /** Confirmed events dropped since the previous call before this reader read them: `undefined` when none. */
  readonly lost: () => EventsLost | undefined
}

/**
 * A networked session around one runtime. `Events` are the events of the
 * runtime's schema, which `events(...)` reads.
 */
export interface Session<Input, TickError, Events extends Descriptor.Descriptor<"event", string, any> = never> {
  /**
   * Runs this frame: reads the links, rolls back if real input contradicts
   * a guess (rollback), records `local` as this seat's input for the tick
   * `status().inputDelay` ticks ahead, ticks the simulation, and sends what
   * the other peers need. Call it once per fixed step, from `FixedLoop`'s `update`.
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
  /**
   * A new host reader of `descriptor`'s events, an event of the runtime's
   * schema: see {@link EventStreams}. It sees the ticks run from now on.
   */
  readonly events: <D extends Events>(descriptor: D) => EventStreams<ReadonlyValue<Descriptor.Descriptor.Value<D>>>
}

/**
 * What the other peers do while a seat's page is hidden:
 *
 * - `"stall"`: they wait for its input, as for any slow seat (rollback runs
 *   `maxRollback` ticks on guesses, then stalls; lockstep stalls at once),
 *   and the hidden seat goes on from where it stopped when it shows again.
 * - `"resync-on-return"`: they play on, with idle input for the hidden seat
 *   after its last sent input. When it shows again, seat 0 sends a save and
 *   it restores it, as in `resync()`; until then its `advance` is
 *   `Waiting`. Seat 0 itself is never played around (every save comes from
 *   its world): when seat 0 hides, the others wait, as with `"stall"`.
 */
export type HiddenPolicy = "stall" | "resync-on-return"

/**
 * The `hidden` option: how this peer learns that its page hides, and what
 * the others do meanwhile. Every peer passes the same `afterMS` and `then`.
 */
export interface HiddenOptions {
  /** This peer's page: `BrowserVisibility.make(document)` in the browser, `MemoryVisibility.make()` in tests. */
  readonly visibility: Visibility
  /**
   * How long the others hold the policy for a hidden seat before its
   * silence counts again: a seat that hides and never returns (the tab was
   * closed) ends the session with `Disconnected` at most `afterMS +
   * timeoutMS` after it hid.
   */
  readonly afterMS: number
  readonly then: HiddenPolicy
}

/** Options both sessions take, with one of {@link Delay}'s. */
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
  /** Ticks between checksum comparisons (30 by default). */
  readonly checksumEvery?: number
  /** A seat that sends nothing for this long is gone (5000 by default). */
  readonly timeoutMS?: number
  /** Keeps the save of each compared tick until the peers agree, so `Desynced` carries it. Costs a save per comparison. */
  readonly keepSnapshots?: boolean
  /**
   * Announces to the other peers when this page hides, so they apply a
   * policy (and show it in `status().hidden`) instead of timing out. The
   * session unsubscribes from `visibility` once it ends. Without it, a
   * hidden peer is silent, and the others end with `Disconnected` after
   * `timeoutMS`.
   */
  readonly hidden?: HiddenOptions
}

/**
 * Bounds of an adaptive input delay, in ticks (whole numbers, `0 <= min <=
 * max`). The session starts at `max` and moves the delay to cover half the
 * smoothed round trip to the slowest other seat, `ceil(roundTripMS / 2 /
 * step ms)` clamped to the bounds, once that target held for 4
 * measurements in a row (one per 250 ms).
 */
export interface AdaptiveDelay {
  readonly min: number
  readonly max: number
}

/**
 * How a session picks its input delay, the ticks between pressing and the
 * tick the input is for: fixed with `inputDelay` (2 by default), or moved
 * with the connection with `adaptiveDelay`. Never both.
 *
 * More delay means fewer rollbacks (rollback) or less waiting (lockstep),
 * for a little lag. Each seat's delay is its own: an adaptive delay moves
 * without any agreement between peers, since every input carries its tick.
 * A rise leaves the ticks it skips idle, and a fall drops this seat's input
 * for as many frames as it fell (`Advanced.input` is `undefined`). Every
 * peer must give the same `inputDelay`, or the same `adaptiveDelay.max`:
 * after a save, that many ticks are idle for every seat.
 */
export type Delay =
  | {
    /** Ticks between pressing and the tick the input is for (2 by default). */
    readonly inputDelay?: number
    /** Not with `inputDelay`. */
    readonly adaptiveDelay?: "inputDelay fixes the delay: give inputDelay or adaptiveDelay, not both"
  }
  | {
    /** Moves the delay within these bounds from the measured round trip. */
    readonly adaptiveDelay: AdaptiveDelay
    /** Not with `adaptiveDelay`. */
    readonly inputDelay?: "adaptiveDelay moves the delay: give inputDelay or adaptiveDelay, not both"
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
  options: RollbackOptions<Input> & Delay & {
    /** The schedule every peer ticks the same way. */
    readonly simulate: Simulate & Checkpoint.ValidateRewindable<Simulate> & Runtime.ValidateScheduleArray<readonly [Simulate], Services, Resources, Machines>
  }
): Result.Result<Session<Input, FailureOf<Simulate>, Schema.EventDescriptor<S>>, InvalidOptions> =>
  Internal.make("rollback", runtime as unknown as Internal.Driven, options as unknown as Internal.MakeOptions) as Result.Result<Session<Input, FailureOf<Simulate>, Schema.EventDescriptor<S>>, InvalidOptions>

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
  options: Options<Input> & Delay & {
    /** The schedule every peer ticks the same way. */
    readonly simulate: Simulate & Runtime.ValidateScheduleArray<readonly [Simulate], Services, Resources, Machines>
  }
): Result.Result<Session<Input, FailureOf<Simulate>, Schema.EventDescriptor<S>>, InvalidOptions> =>
  Internal.make("lockstep", runtime as unknown as Internal.Driven, options as unknown as Internal.MakeOptions) as Result.Result<Session<Input, FailureOf<Simulate>, Schema.EventDescriptor<S>>, InvalidOptions>
