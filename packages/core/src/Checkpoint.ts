/**
 * Rewind a runtime in memory, for rollback netcode and client prediction.
 *
 * `runtime.checkpoint(simulate)` marks the world between ticks.
 * `runtime.rewind(checkpoint)` puts it back exactly as it was then, so
 * ticking `simulate` again gives the same results, bit for bit, as a runtime
 * that never rewound: entity ids and the next id, component values and their
 * change ticks, relations in order, scopes, every resource (transient ones
 * too), committed and queued machine states, pending commands, unread
 * events, and the read positions of every system `simulate` runs.
 *
 * A rollback game takes one checkpoint per tick, ticks ahead with guessed
 * remote input, and when real input for an earlier tick arrives and differs,
 * rewinds to the checkpoint before it and ticks again up to the present. The
 * runtime keeps the last `checkpoints` checkpoints (an option of
 * `Game.Runtime.make`, {@link defaultWindow} by default); an older one,
 * one newer than a checkpoint the runtime rewound to, and every one taken
 * before a `restore` can no longer be rewound to (`Released`).
 *
 * Checkpoints are cheap: taking one copies nothing but resources, machines,
 * and queues. From then on, the first change to a page of component values,
 * to an entity, a relation, or a scope keeps what it replaced, so the cost
 * of a tick grows with what it changes, not with the size of the world.
 *
 * To persist, use `runtime.snapshot()`: a checkpoint is a value of this
 * runtime only, with nothing in it to save (`JSON.stringify` gives `{}`),
 * and `restore` rejects it. To rewind in-process, use checkpoints:
 * `restore` is for loading saves, and gives new ids, drops queued work, and
 * restarts every reader.
 *
 * What `simulate` may use is checked when the checkpoint is taken:
 *
 * - its services must be input sources (`snapshot()`), plain data, or
 *   {@link rewindable}. A service with effects (playing a sound) would run
 *   again for every tick ticked again; emit an event or write a resource,
 *   and act on it from the host. The host feeds the input of each tick again
 *   through its source, keyed by the tick it is for (`Clock`), not by when
 *   it arrived. A library that keeps its own world (a physics or navigation
 *   engine) is provided through {@link rewindable}: every checkpoint saves
 *   it, and a rewind restores it.
 * - its systems may not keep `local` state, which a rewind cannot put back:
 *   keep it in a resource or a component.
 *
 * Systems and inspectors outside `simulate` (rendering, a HUD, a host's
 * inspector) do not rewind. Their next run sees the rewind as ordinary
 * changes: a value written after the checkpoint as changed, a component or
 * entity that is gone as removed or despawned, one that came back as added.
 * A removal is reported only for what is still gone when the reader runs, so
 * an entity the rewind took away and the ticks after it brought back (the
 * same id: ids are exact) is seen as changed, never as despawned and spawned
 * again. They may see a value as changed that ended up equal. Events they
 * read during ticks that are ticked again are published again: act on
 * events of confirmed ticks only, or de-duplicate them by tick.
 *
 * @module Checkpoint
 * @docGroup runtime
 *
 * @example
 * ```ts
 * const history = new Map<number, Checkpoint.Checkpoint<typeof Root>>()
 *
 * // Every tick: keep where it starts, then run it with the input known so far.
 * history.set(tick, runtime.checkpoint(simulate))
 * runtime.tick(simulate)
 *
 * // Real input for an earlier tick differs from the guess: go back and run again.
 * const rewound = runtime.rewind(history.get(wrongTick)!)
 * if (rewound.ok) {
 *   for (let at = wrongTick; at <= tick; at++) {
 *     history.set(at, runtime.checkpoint(simulate))
 *     runtime.tick(simulate)
 *   }
 * }
 * ```
 */
import type { Descriptor } from "./Descriptor.ts"
import * as Internal from "./internal/checkpoint.ts"
import * as RewindableInternal from "./internal/rewindable.ts"
import type * as Result from "./Result.ts"
import type * as Requirement from "./Requirement.ts"
import type * as Schedule from "./Schedule.ts"
import type { SystemDefinition } from "./System.ts"

declare const checkpointTypeId: unique symbol

/**
 * The world of one runtime at one moment between ticks, to rewind to with
 * `runtime.rewind(checkpoint)`. Opaque: it holds nothing to read or save.
 * `Root` is the game's schema root, so a checkpoint of another game does not
 * type-check.
 */
export interface Checkpoint<out Root = unknown> {
  readonly [checkpointTypeId]: "~ritmo/Checkpoint"
  readonly __schemaRoot?: Root | undefined
}

/** How many checkpoints a runtime keeps when `Game.Runtime.make` is not given `checkpoints`. */
export const defaultWindow = 16

/** The checkpoint was taken by another runtime. */
export interface OtherRuntime {
  readonly _tag: "OtherRuntime"
}

/**
 * The runtime let go of the checkpoint: `window`, it is older than the last
 * `checkpoints` taken; `rewound`, the runtime rewound to an older one; or
 * `restored`, a save was restored after it was taken.
 */
export interface Released {
  readonly _tag: "Released"
  readonly reason: "window" | "rewound" | "restored"
}

/**
 * A {@link rewindable} service's `restore` failed: `service` is the name it
 * was provided under, `error` what its `restore` returned. The rewind changed
 * nothing (no other service's `current`, nothing in the world), and the
 * checkpoint stays held.
 */
export interface RestoreFailed<out Name extends string = string, out E = unknown> {
  readonly _tag: "RestoreFailed"
  readonly service: Name
  readonly error: E
}

/**
 * Why `runtime.rewind(checkpoint)` changed nothing. `Failure` is the
 * {@link RestoreFailed} of each rewindable service the runtime was given
 * ({@link RestoreFailures}); `runtime.rewind` narrows it to exactly those, so
 * a runtime without rewindable services never returns `RestoreFailed`. The
 * default covers every runtime, for code that takes any rewind error.
 */
export type RewindError<Failure extends RestoreFailed<string, unknown> = RestoreFailed> = OtherRuntime | Released | Failure

/**
 * The {@link RestoreFailed} each {@link rewindable} service in `Services`
 * (a runtime's provided services, by name) can fail a rewind with, typed by
 * its `restore`. `never` when there is none.
 */
export type RestoreFailures<Services> = {
  readonly [K in keyof Services & string]: Services[K] extends Rewindable<any, any, infer E> ? RestoreFailed<K, E> : never
}[keyof Services & string]

declare const rewindableTypeId: unique symbol

/**
 * A service that keeps its own state outside the world (a physics or
 * navigation library with its own world, such as Rapier or Box2D), made
 * rewindable with {@link rewindable}. Provide it as the service's value
 * (`Descriptor.Service<typeof physics>()`); systems use `current`.
 *
 * `current` is the live value. After a rewind it is the value `restore`
 * returned, so a system must read `current` each run and never keep it.
 */
export interface Rewindable<in out Value, in out Saved, out E> {
  readonly [rewindableTypeId]: "~ritmo/Rewindable"
  /** The live value systems use: the restored one after a rewind. Read it each run; do not keep it. */
  readonly current: Value
  /** Saves `current`: called once per `runtime.checkpoint(...)`. */
  readonly save: (value: Value) => Saved
  /** Builds the value from a save: called once per `runtime.rewind(...)`, possibly more than once with the same save. */
  readonly restore: (saved: Saved) => Result.Result<Value, E>
}

/** The `save` and `restore` that make a value {@link rewindable}. */
export interface RewindableHooks<in out Value, in out Saved, out E> {
  /**
   * The value's state now, as a value the service never changes later (a
   * copy, or bytes): a checkpoint holds it until the checkpoint is
   * released, and a rewind may restore it more than once.
   */
  readonly save: (value: Value) => Saved
  /**
   * A value in the state `saved` holds, or why it cannot be built (a typed
   * `Result`, failing the rewind with {@link RestoreFailed}). It may build a
   * new value (`World.restoreSnapshot`) or put the existing one back and
   * return it. It must not change `saved`.
   */
  readonly restore: (saved: Saved) => Result.Result<Value, E>
}

/**
 * Makes `value`, a service that keeps its own state (a physics or navigation
 * library's world), part of rollback: every `runtime.checkpoint(...)` calls
 * `save` and keeps its output with the checkpoint (freed with it, when the
 * checkpoint is released), and `runtime.rewind(...)` calls `restore` with it
 * and makes the result `current`. This is the only way a stateful service
 * enters a rewound schedule; the library stays the game's.
 *
 * Cost: one `save` per checkpoint (one per tick in a rollback game) for each
 * rewindable service the runtime was given, whether the checkpointed
 * schedule uses it or not, and one `restore` per rewind. A runtime without
 * rewindable services pays nothing.
 *
 * Not saved elsewhere:
 *
 * - `runtime.snapshot()` does not include it, and `runtime.restore(save)`
 *   leaves it as it is: after loading a save (a netcode resync too), rebuild
 *   it from the world, or keep what gameplay reads in components.
 * - `runtime.checksum()` does not cover it: desync detection sees the world
 *   only. Mirror what gameplay reads (positions, velocities) into components
 *   each tick, so it is checked, saved, and inspected like the rest.
 *
 * @example
 * ```ts
 * const physics = Checkpoint.rewindable(world, {
 *   save: (world) => world.takeSnapshot(),
 *   restore: (bytes) => {
 *     const restored = RAPIER.World.restoreSnapshot(bytes)
 *     return restored === undefined ? Result.failure({ _tag: "CorruptSnapshot" as const }) : Result.success(restored)
 *   }
 * })
 * const Physics = Descriptor.Service<typeof physics>()("Game/Physics")
 * // Systems step and read `services.physics.current`; `runtime.checkpoint(simulate)` compiles.
 * ```
 */
export const rewindable = <Value, Saved, E = never>(
  value: Value,
  hooks: RewindableHooks<Value, Saved, E>
): Rewindable<Value, Saved, E> =>
  RewindableInternal.make(value, hooks.save, hooks.restore) as Rewindable<Value, Saved, E>

/** Whether `value` was made by {@link rewindable}. */
export const isRewindable = (value: unknown): value is Rewindable<unknown, unknown, unknown> =>
  RewindableInternal.isRewindable(value)

/**
 * Whether `value` is a checkpoint a runtime took. A checkpoint copied or
 * parsed back from JSON is not one.
 */
export const isCheckpoint = (value: unknown): value is Checkpoint =>
  Internal.isCheckpoint(value)

type AnySystem = SystemDefinition<any, any, any, any, any>

/** Plugin systems with an erased spec (`any`) are not checked. */
type IsErased<T> = 0 extends 1 & T ? true : false

type ServiceIssue<Need> =
  Need extends Descriptor<"service", infer Name, infer Value>
    ? Value extends Schedule.Source<any> ? never
      : Value extends Rewindable<any, any, any> ? never
      : Schedule.IsPlain<Value> extends true ? never
      : `${Name} is neither a snapshot() source, plain data, nor Checkpoint.rewindable, so a rewind would call it again for every tick run again: give the simulation its input through a source, its effects on the host through events or resources, and a library that keeps its own state through Checkpoint.rewindable(value, { save, restore })`
    : never

type LocalIssue<Sys> =
  Sys extends AnySystem
    ? IsErased<Sys["spec"]> extends true ? never
      : [Exclude<Sys["spec"]["local"], undefined>] extends [never] ? never
      : `${Sys["name"]} keeps local state, which a rewind cannot put back: keep it in a resource or a component`
    : never

type OrderEntries<Selected> =
  Selected extends { readonly __order?: (_: never) => infer Order extends Schedule.AnyScheduleOrder } ? Order["entries"] : ReadonlyArray<unknown>

type ScheduleIssues<Selected> =
  number extends OrderEntries<Selected>["length"]
    ? "the systems of this schedule are not statically known (it was widened to a schedule type): pass the schedule as built"
    : | ServiceIssue<Extract<Requirement.Of<Selected>, Descriptor<"service", string, any>>>
      | LocalIssue<Schedule.SystemsIn<Selected>>

/**
 * Resolves to `unknown` when a schedule can be rewound: every service it
 * uses (its transition bundles included) is an input source, plain data, or
 * {@link rewindable},
 * and none of its systems keeps `local` state. Otherwise to an object naming
 * each problem and its fix. `runtime.checkpoint(schedule)` uses it.
 */
export type ValidateRewindable<Selected> =
  [ScheduleIssues<Selected>] extends [never]
    ? unknown
    : { readonly __fixCheckpoint__: ScheduleIssues<Selected> }
