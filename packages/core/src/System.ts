/**
 * System declarations, typed requirements, and execution context.
 *
 * Systems are the main unit of gameplay behavior in the library. A system
 * declares everything it is allowed to touch up front, and the runtime derives
 * a context that exposes exactly that surface and nothing more.
 *
 * This module is where ECS logic becomes explicit and reviewable:
 *
 * - queries describe which entities may be visited
 * - resources, events, services, and machines are requested by name
 * - change detection is per system: each run sees what changed since its previous run
 * - hidden ambient world access is impossible through the public API
 *
 * Reach for this module whenever you are writing gameplay, simulation, reset,
 * input, host sync, or transition logic that should run inside a schedule.
 *
 * @example
 * ```ts
 * // Define one simulation step with explicit world access.
 * const Move = Game.System("Game/Move", {
 *   queries: {
 *     moving: Game.Query({
 *       selection: {
 *         position: Game.Query.write(Position),
 *         velocity: Game.Query.read(Velocity)
 *       }
 *     })
 *   },
 *   resources: {
 *     dt: Game.System.readResource(DeltaTime)
 *   }
 * }, ({ queries, resources }) => {
 *   const dt = resources.dt.get()
 *
 *   for (const { data } of queries.moving.each()) {
 *     const velocity = data.velocity.get()
 *     data.position.update((position) => ({
 *       x: position.x + velocity.x * dt,
 *       y: position.y + velocity.y * dt
 *     }))
 *   }
 * })
 * ```
 *
 * @module System
 * @docGroup core
 *
 * @groupDescription Interfaces
 * Public system contracts and runtime context view shapes derived from one system specification.
 *
 * @groupDescription Type Aliases
 * Shared system dependency, context, and requirement helper types.
 *
 * @groupDescription Functions
 * Public system authoring helpers for resources, events, lifecycle reads, and typed system definitions.
 */
import type { Descriptor } from "./Descriptor.ts"
import type * as Entity from "./Entity.ts"
import * as Machine from "./Machine.ts"
import type * as Relation from "./Relation.ts"
import type { Query, QueryMatch } from "./Query.ts"
import type { ConstructedWriteCell, ReadCell, ReadonlyValue, WriteCell } from "./Query.ts"
import * as Requirement from "./Requirement.ts"
import type * as Result from "./Result.ts"
import type { Schema } from "./Schema.ts"
import type { CommandAccess, CommandsApi, NotDeclared } from "./Command.ts"

/**
 * System declarations, typed execution context, and runtime requirements.
 *
 * Systems are explicit dependency declarations. A system spec lists exactly
 * what the implementation may read or write, and the runtime context is
 * derived from that spec.
 *
 * The main mental model is:
 *
 * - declare access up front with `Game.System.*` helpers
 * - derive a typed context from the declaration
 * - run the implementation with no hidden world access
 *
 * Runtime visibility:
 *
 * - deferred commands become visible after `Game.Schedule.applyDeferred()`
 *   (or `applyStateTransitions(...)`), the only explicit boundaries
 * - `added`/`changed` filters, removed/despawned reads, events, transition
 *   events, and relation failures are per-reader streams: each run sees what
 *   was published since the system's own previous run
 *
 * @example
 * ```ts
 * const Move = Game.System("Game/Move", {
 *   queries: {
 *     moving: Game.Query({
 *       selection: {
 *         position: Game.Query.write(Position),
 *         velocity: Game.Query.read(Velocity)
 *       }
 *     })
 *   },
 *   resources: {
 *     dt: Game.System.readResource(DeltaTime)
 *   }
 * }, ({ queries, resources }) => {
 *   const dt = resources.dt.get()
 *   for (const { data } of queries.moving.each()) {
 *     const velocity = data.velocity.get()
 *     data.position.update((position) => ({
 *       x: position.x + velocity.x * dt,
 *       y: position.y + velocity.y * dt
 *     }))
 *   }
 * })
 * ```
 */

/**
 * Declares a dependency-injected service requirement for a system.
 */
export interface ServiceRead<D extends Descriptor<"service", string, any>> {
  readonly descriptor: D
}

/**
 * Declares that a system needs a service from the external runtime environment.
 *
 * Use this for host capabilities that should not live in ECS world storage:
 * render bridges, audio sinks, logs, persistence APIs, or network clients.
 * Simulation time is `Clock` and randomness is the `Random` resource from
 * `@typeonce/ritmo-math`, not services. The matching implementation must be
 * supplied when the runtime is created with `Game.Runtime.services(...)`.
 * Service effects (audio, network, storage) are not rolled back when the
 * system fails.
 */
export const service = <D extends Descriptor<"service", string, any>>(
  descriptor: D
): ServiceRead<D> => ({
  descriptor
})

/**
 * Declares read-only access to a resource.
 */
export type ResourceRead<D extends Descriptor<"resource", string, any>> = {
  readonly mode: "read"
  readonly descriptor: D
}

/**
 * Declares writable access to a resource.
 */
export type ResourceWrite<D extends Descriptor<"resource", string, any>> = {
  readonly mode: "write"
  readonly descriptor: D
}

/**
 * Creates a resource-read declaration for a system spec.
 *
 * Use this for world-level singleton data the system needs to observe but must
 * not mutate, such as delta time, score snapshots, configuration, or
 * aggregated frame input. The resulting context slot is a read-only
 * `ReadCell`.
 */
export const readResource = <D extends Descriptor<"resource", string, any>>(
  descriptor: D
): ResourceRead<D> => ({
  mode: "read",
  descriptor
})

/**
 * Creates a resource-write declaration for a system spec.
 *
 * Use this when the system owns mutation of one world-level singleton, such as
 * score, UI summaries, accumulated damage, or frame-local caches. Declaring it
 * here makes that authority visible in the system contract before the body is
 * read.
 *
 * @example
 * ```ts
 * const CountUp = Game.System("Game/CountUp", {
 *   resources: {
 *     score: Game.System.writeResource(Score)
 *   }
 * }, ({ resources }) => {
 *   // Mutate the singleton through the explicit write cell.
 *   resources.score.update((score) => score + 1)
 * })
 * ```
 */
export const writeResource = <D extends Descriptor<"resource", string, any>>(
  descriptor: D
): ResourceWrite<D> => ({
  mode: "write",
  descriptor
})

/**
 * Declares read access to a resource plus whether it changed since this
 * system's previous completed run.
 */
export type ResourceChanged<D extends Descriptor<"resource", string, any>> = {
  readonly mode: "changed"
  readonly descriptor: D
}

/**
 * Creates a resource read that also reports `changed()`: whether a committed
 * write left a different value since this system's previous completed run.
 *
 * Use it for work worth doing only when a value moved: rewriting a HUD label,
 * rebuilding a cache from settings. Use `readResource` when the system needs
 * the value every run anyway.
 *
 * A write that leaves an equal value is not a change: primitives compare
 * with `Object.is`, plain objects and arrays by their entries, other objects
 * by reference. This differs from `Game.Query.changed`, where every write
 * through a component write cell counts. The first run reports `true`; a
 * failed run (rolled back) is not a change, and a failed reader sees the same
 * change again next run. Its own writes are not reported to the writer.
 *
 * Conditions (`Game.Condition.check`) cannot declare it: they own no cursor.
 *
 * @example
 * ```ts
 * const SyncHud = Game.System("Game/SyncHud", {
 *   resources: { score: Game.System.changedResource(Score) },
 *   services: { hud: Game.System.service(Hud) }
 * }, ({ resources, services }) => {
 *   if (!resources.score.changed()) return
 *   services.hud.score.textContent = `${resources.score.get()}`
 * })
 * ```
 */
export const changedResource = <D extends Descriptor<"resource", string, any>>(
  descriptor: D
): ResourceChanged<D> => ({
  mode: "changed",
  descriptor
})

/**
 * Declares read-only access to an event stream.
 */
export type EventRead<D extends Descriptor<"event", string, any>> = {
  readonly mode: "read"
  readonly descriptor: D
}

/**
 * Declares write access to an event stream.
 */
export type EventWrite<D extends Descriptor<"event", string, any>> = {
  readonly mode: "write"
  readonly descriptor: D
}

/**
 * Creates an event-read declaration for a system spec.
 *
 * Each run of the reading system sees the events published since its own
 * previous completed run, once, in emission order: events from earlier
 * systems in the same schedule, and events emitted after it ran last time.
 *
 * Events are kept until every system that reads them has run, so a reader in
 * a schedule ticked less often than the emitter's (a fixed update below the
 * render rate) still receives all of them. Events nobody has read yet are
 * kept for the current and previous `runtime.tick(...)` call; a reader's
 * first run sees whatever is still kept. A system skipped by its run
 * conditions discards the events published meanwhile, but keeps its
 * change-detection position: `added`/`changed` filters and
 * `removed`/`despawned` reads still show everything since its previous
 * completed run when it runs again. Each stream is capped
 * at `Runtime.streamCapacity` entries; a reader that missed dropped ones sees
 * `lagged() === true`.
 *
 * This is the usual second half of a cross-system flow: one system emits an
 * event, and a later system reads it and re-validates any handles or lookups
 * it needs.
 */
export const readEvent = <D extends Descriptor<"event", string, any>>(
  descriptor: D
): EventRead<D> => ({
  mode: "read",
  descriptor
})

/**
 * Creates an event-write declaration for a system spec.
 *
 * Emitted events are published when the system completes successfully; a
 * failed run publishes nothing. Readers later in the same schedule see them,
 * and so do readers that run in a later tick.
 *
 * If the payload needs to name an entity for later work, emit a durable
 * `Game.Entity.handle(...)` (optionally with an intent component) and let the later
 * reader re-resolve it through `queries.x.getHandle(...)` (through a declared query).
 *
 * @example
 * ```ts
 * const EmitHit = Game.System("Game/EmitHit", {
 *   events: {
 *     hit: Game.System.writeEvent(Hit)
 *   }
 * }, ({ events }) => {
 *   events.hit.emit({ amount: 1 })
 * })
 * ```
 */
export const writeEvent = <D extends Descriptor<"event", string, any>>(
  descriptor: D
): EventWrite<D> => ({
  mode: "write",
  descriptor
})

/** The marker `thisTick(...)` adds to a read. */
export interface ThisTick {
  readonly thisTick: true
}

/**
 * Requires that every system writing this event or resource runs earlier in
 * the same `runtime.tick(...)` call than the reading system: the reader then
 * sees this tick's data, never last tick's. The library never reorders
 * anything; it only checks.
 *
 * `runtime.tick(...)` checks it at compile time over everything passed to that
 * call, in order (gated groups count by position), and rejects a writer that
 * runs after the reader and a call whose order is not statically known. A
 * read with no writer in the call compiles (a reader reused in several
 * ticks); the `event-never-written` lint reports data nobody writes.
 * `tryTick` checks the same at runtime. Plugin systems with erased specs
 * (`RenderSync.system`, `InputCapture.system`) do not count as writers.
 *
 * Use it on reads whose correctness depends on running after their writers
 * (damage applied the tick it is dealt). A plain read is right when last
 * tick's data is acceptable.
 *
 * On a query (`queries: { enemies: Game.System.thisTick(Enemies) }`), the
 * writers are systems whose declared commands can change what it matches:
 * `spawns` covering every component it requires, or `inserts` / `removes` of
 * any component it names (selection slots, optional ones included, `with`,
 * `without`, filters). Each must run earlier with an `applyDeferred()` (or
 * `applyStateTransitions(...)`) between it and the reader, since commands
 * apply only there. `despawns` never count: a despawned entity stays visible
 * to queries until the next `applyDeferred()`. Nested schedules are
 * flattened, gated groups count by position, and a transition bundle counts
 * at its `applyStateTransitions(...)` step (which applies queued commands
 * first), as if every schedule in it runs, markers inside included.
 *
 * @example
 * ```ts
 * const ApplyDamage = Game.System("Game/ApplyDamage", {
 *   events: { damage: Game.System.thisTick(Game.System.readEvent(Damage)) }
 * }, ({ events }) => { ... })
 *
 * runtime.tick(Game.Schedule(DealDamage, ApplyDamage)) // compiles
 * runtime.tick(Game.Schedule(ApplyDamage, DealDamage)) // "Game/ApplyDamage needs Game/Damage from this tick, but its writer Game/DealDamage runs after it"
 *
 * const AimAtNewest = Game.System("Game/AimAtNewest", { queries: { enemies: Game.System.thisTick(Enemies) } }, ...)
 * runtime.tick(Game.Schedule(SpawnWave, Game.Schedule.applyDeferred(), AimAtNewest)) // compiles
 * runtime.tick(Game.Schedule(SpawnWave, AimAtNewest)) // "Game/AimAtNewest needs this tick's commands for queries.enemies, but Game/SpawnWave queues them with no applyDeferred() in between"
 * ```
 */
export const thisTick = <
  Read extends EventRead<Descriptor<"event", string, any>> | ResourceRead<Descriptor<"resource", string, any>> | ResourceChanged<Descriptor<"resource", string, any>> | Query.Any<any>
>(read: Read): Read & ThisTick => ({ ...read, thisTick: true })

/**
 * Declares read access to the current committed value of a finite-state machine.
 *
 * Use this when gameplay logic needs to branch on the current committed phase,
 * but should not see queued next-state writes early. Machines are the intended
 * default for menus, rounds, encounters, pause flows, and other discrete modes
 * whose transition boundary matters.
 */
export const machine = <M extends Machine.StateMachine.Any>(
  stateMachine: M
): Machine.MachineRead<M> => Machine.read(stateMachine)

/**
 * Declares queued write access to the next value of a finite-state machine.
 *
 * This is the system-side request channel for a future phase change. It does
 * not immediately switch the committed state; the queued value is applied only
 * at an explicit `Game.Schedule.applyStateTransitions(...)` boundary.
 *
 * Use this instead of writing a plain resource when the transition timing itself is
 * part of the gameplay model, such as restarting a round, leaving a menu, or
 * entering a results screen after reset/setup schedules run.
 */
export const nextState = <M extends Machine.StateMachine.Any>(
  stateMachine: M
): Machine.NextMachineWrite<M> => Machine.write(stateMachine)

/**
 * Declares read access to the last applied transition payload of a machine.
 */
export const transition = <M extends Machine.StateMachine.Any>(
  stateMachine: M
): Machine.TransitionRead<M> => Machine.transition(stateMachine)

/**
 * Declares read access to committed transition events for one machine.
 *
 * Transition events are published when a transition commits and read like
 * normal events: each run sees those published since its previous run.
 *
 * This is one of the clearest signs that the modeled value should be a machine
 * rather than a resource or a `Descriptor.EntityState` component.
 */
export const readTransitionEvent = <M extends Machine.StateMachine.Any>(
  stateMachine: M
): Machine.TransitionEventRead<M> => Machine.readTransitionEvent(stateMachine)

/**
 * Internal union for all supported resource access declarations.
 */
type ResourceAccess =
  | ResourceRead<Descriptor<"resource", string, any>>
  | ResourceChanged<Descriptor<"resource", string, any>>
  | ResourceWrite<Descriptor<"resource", string, any>>
/**
 * Internal union for all supported event access declarations.
 */
type EventAccess = EventRead<Descriptor<"event", string, any>> | EventWrite<Descriptor<"event", string, any>>

/**
 * A read-only view over a resource value.
 */
export interface ResourceReadView<T> extends ReadCell<T> {}

/**
 * A read-only view over a resource value that also reports whether it
 * changed since this system's previous completed run (`changedResource`).
 */
export interface ResourceChangedView<T> extends ReadCell<T> {
  /** Whether a committed write left a different value since this system's previous completed run. `true` on the first run. */
  changed(): boolean
}

/**
 * A mutable view over a resource value.
 */
export type ResourceWriteView<D extends Descriptor<"resource", string, any>> =
  D extends import("./Descriptor.ts").ConstructedDescriptor<"resource", string, infer Value, infer Raw, infer Error>
    ? ConstructedWriteCell<Value, Raw, Error>
    : WriteCell<Descriptor.Value<D>>

/**
 * A read-only event stream view.
 */
export interface EventReadView<T> {
  all(): ReadonlyArray<ReadonlyValue<T>>
  /**
   * Whether entries published since this system's previous run were dropped
   * before it read them. Entries wait for every reading system, so this only
   * happens when a reader has not run for so long that the stream exceeded
   * its capacity (see `Runtime.streamCapacity`), or for inspectors, which do
   * not hold entries.
   */
  lagged(): boolean
}

/**
 * A writable event stream view.
 */
export interface EventWriteView<T> {
  /** Publishes one event. Takes the readonly shape reads return, so a read event can be emitted again. */
  emit(value: import("./Query.ts").ReadonlyValue<T>): void
}

/**
 * A read-only view over one committed finite-state-machine value.
 */
export interface MachineReadView<M extends Machine.StateMachine.Any = Machine.StateMachine.Any> {
  /** The committed value; `undefined` only for a sub-state whose parent is in another state. */
  get(): Machine.CurrentValue<M>
  is(value: Machine.StateMachine.Value<M>): boolean
}

/**
 * A queued write view over one finite-state-machine transition target.
 */
export interface NextMachineWriteView<M extends Machine.StateMachine.Any = Machine.StateMachine.Any> {
  getPending(): Machine.StateMachine.Value<M> | undefined
  /**
   * Queues `value`, committed at the next `applyStateTransitions(...)`. For a
   * sub-state it returns a `Result` that fails with `SubStateInactive` (and
   * queues nothing) while the parent is in another state.
   *
   * One value is queued per machine: a later `set` before the marker
   * replaces an earlier one. A `set` from a transition schedule (`onEnter`,
   * `onExit`, `onTransition`) is committed at the following marker, while a
   * value queued before the current marker still commits at it. A sub-state
   * value set while its parent is still in its state but leaves it at the
   * same marker returns ok and is dropped with the sub-state.
   *
   * Setting the current state again re-runs its exit and enter schedules, so
   * its sub-states restart. Use `setIfChanged` when that is not wanted.
   */
  set(value: Machine.StateMachine.Value<M>): Machine.SetResult<M>
  /** Like `set`, but committing the current value again is skipped (no exit or enter schedules). */
  setIfChanged(value: Machine.StateMachine.Value<M>): Machine.SetResult<M>
  reset(): void
}

/**
 * A read-only view over the last applied transition payload for one machine.
 *
 * Only meaningful inside transition schedules, so it is only given to
 * systems that declare `transitions: { x: Game.System.transition(M) }`.
 */
export interface TransitionReadView<M extends Machine.StateMachine.Any = Machine.StateMachine.Any> {
  get(): Machine.TransitionSnapshot<M>
}

/**
 * A read-only event stream of committed machine transitions, published by
 * `applyStateTransitions(...)`. Like events, each reader sees the
 * transitions published since its own previous run.
 */
export interface TransitionEventReadView<M extends Machine.StateMachine.Any = Machine.StateMachine.Any> {
  all(): ReadonlyArray<Machine.TransitionSnapshot<M>>
  /**
   * Whether entries published since this system's previous run were dropped
   * before it read them. Entries wait for every reading system, so this only
   * happens when a reader has not run for so long that the stream exceeded
   * its capacity (see `Runtime.streamCapacity`), or for inspectors, which do
   * not hold entries.
   */
  lagged(): boolean
}

/**
 * Declares read access to removed-component lifecycle records.
 */
export interface RemovedRead<D extends Descriptor<"component", string, any>> {
  readonly descriptor: D
}

/**
 * Declares read access to despawned-entity lifecycle records.
 */
export interface DespawnedRead {
  readonly kind: "despawned"
}

/**
 * Declares read access to relation-mutation failure records.
 *
 * Failures are recorded when deferred relation commands are applied; each run
 * sees the failures recorded since the system's previous run.
 */
export interface RelationFailureRead<R extends Relation.Relation.Any> {
  readonly relation: R
}

/**
 * Declares read access to removed-component lifecycle records.
 *
 * Each run returns the entities whose component was removed since the
 * system's previous run (removals are applied when commands are). Records are
 * kept until every system that reads them has run, so a reader in a schedule
 * ticked less often than the one that removes (rendering after several fixed
 * updates) still sees every removal. A system skipped by its run conditions
 * keeps its position, like `added`/`changed`, and sees the removals when it
 * runs again. Each log is capped at `Runtime.streamCapacity` entries; a
 * reader that missed dropped ones sees `lagged() === true` (and a `missed`
 * read in the debug trace). Systems usually pair this
 * with host cleanup such as removing renderer-owned nodes. {@link readDespawned}
 * complements this for whole-entity teardown.
 *
 * @example
 * ```ts
 * const DestroyRenderNodesSystem = Game.System("Game/DestroyRenderNodes", {
 *   removed: {
 *     renderables: Game.System.readRemoved(Renderable)
 *   }
 * }, ({ removed }) => {
 *   for (const entityId of removed.renderables.all()) {
 *     // destroy host-owned node here
 *   }
 * })
 * ```
 */
export const readRemoved = <D extends Descriptor<"component", string, any>>(
  descriptor: D
): RemovedRead<D> => ({
  descriptor
})

/**
 * Declares read access to relation-mutation failure records.
 */
export const readRelationFailures = <R extends Relation.Relation.Any>(
  relation: R
): RelationFailureRead<R> => ({
  relation
})

/**
 * Declares read access to despawned-entity lifecycle records.
 *
 * Each run returns the entities despawned since the system's previous run.
 * Records are retained like {@link readRemoved} records. Use it when host-owned state must be destroyed even if no single removed
 * component is the canonical trigger. {@link readRemoved} is often used
 * alongside this in authoritative host mirrors.
 *
 * @example
 * ```ts
 * const DestroyNodesSystem = Game.System("Game/DestroyNodes", {
 *   despawned: {
 *     entities: Game.System.readDespawned()
 *   }
 * }, ({ despawned }) => {
 *   for (const entityId of despawned.entities.all()) {
 *     // destroy host-owned node here
 *   }
 * })
 * ```
 */
export const readDespawned = (): DespawnedRead => ({
  kind: "despawned"
})

/**
 * A read-only lifecycle stream of entity ids for one removed component.
 */
export interface RemovedReadView<S extends Schema.Any, Root = unknown> {
  all(): ReadonlyArray<import("./Entity.ts").EntityId<S, Root>>
  /**
   * Whether records published since this system's previous run were dropped
   * before it read them. Records wait for every reading system, so this only
   * happens when a reader has not run for so long that the log exceeded its
   * capacity (see `Runtime.streamCapacity`). Check it where a missed record
   * would leak host state (a renderer node never destroyed).
   */
  lagged(): boolean
}

/**
 * A read-only lifecycle stream of despawned entity ids.
 */
export interface DespawnedReadView<S extends Schema.Any, Root = unknown> {
  all(): ReadonlyArray<import("./Entity.ts").EntityId<S, Root>>
  /**
   * Whether records published since this system's previous run were dropped
   * before it read them. Records wait for every reading system, so this only
   * happens when a reader has not run for so long that the log exceeded its
   * capacity (see `Runtime.streamCapacity`). Check it where a missed record
   * would leak host state (a renderer node never destroyed).
   */
  lagged(): boolean
}

/**
 * A read-only stream of deferred relation-mutation failures.
 */
export interface RelationFailureReadView<
  R extends Relation.Relation.Any = Relation.Relation.Any,
  S extends Schema.Any = Schema.Any,
  Root = unknown
> {
  all(): ReadonlyArray<Relation.Relation.MutationFailure<R, S, Root>>
  /**
   * Whether entries published since this system's previous run were dropped
   * before it read them. Entries wait for every reading system, so this only
   * happens when a reader has not run for so long that the stream exceeded
   * its capacity (see `Runtime.streamCapacity`), or for inspectors, which do
   * not hold entries.
   */
  lagged(): boolean
}

/**
 * A runtime query handle exposed to system implementations.
 *
 * The handle is already typed from the query spec, so iterating it returns
 * strongly typed entity proofs and cells. A query with `added` / `changed`
 * filters only iterates (`each`, `singleOptional`): its lookups would fail
 * for every entity that did not change since this system's previous run, so
 * declare a second query without filters to resolve entities.
 */
export type QueryHandle<S extends Schema.Any, Q extends Query.Any> =
  & QueryIteration<S, Q>
  & (Q["filters"] extends readonly [] ? QueryLookups<S, Q> : FilteredQueryLookups)

/** What every query handle has: iteration over its current matches. */
export interface QueryIteration<S extends Schema.Any, Q extends Query.Any> {
  /**
   * Returns every current match, in spawn order (ascending entity id), so
   * iteration is the same on every run and platform.
   */
  each(): ReadonlyArray<QueryMatch<S, Q>>
  /**
   * Returns a single match when zero or one entity satisfies the query.
   *
   * Use this when absence is acceptable but multiplicity is still a bug. Zero
   * matches return a `Success` whose `success` is `undefined`; multiple matches remain
   * an explicit `MultipleEntities` failure.
   *
   * @example
   * ```ts
   * const player = queries.player.singleOptional()
   * if (player._tag === "Failure" || !player.success) {
   *   return
   * }
   *
   * player.success.data.position.set({ x: 0, y: 0 })
   * ```
   */
  singleOptional(): Result.Result<QueryMatch<S, Q> | undefined, Query.MultipleEntitiesError>
}

type FilteredLookupMessage = "lookups need a query without added/changed filters: declare a second query for resolving entities"

/** The lookups of a query with filters, each replaced by the message naming the fix. */
export type FilteredQueryLookups = {
  readonly [K in keyof QueryLookups<Schema.Any, Query.Any>]: (this: FilteredLookupMessage, ...args: ReadonlyArray<unknown>) => never
}

/** Lookups of one entity or one hierarchy through a query without `added` / `changed` filters. */
export interface QueryLookups<S extends Schema.Any, Q extends Query.Any> {
  /**
   * Retrieves the match for one specific entity id when it satisfies the query.
   *
   * Every read and write of an entity goes through a query the system
   * declares, so its access is visible in the spec: there is no lookup that
   * takes a query at call time.
   */
  get(entityId: import("./Entity.ts").EntityId<S, Query.Root<Q>>): Result.Result<QueryMatch<S, Q>, Query.LookupError>
  /**
   * Resolves a stored durable handle back into this query's access.
   *
   * Use this for handles carried in events, resources, or components. A handle
   * is storage-safe, not proof of liveness, so stale or mismatched handles stay
   * explicit typed failures. A handle with an intent component needs a query
   * that proves it (selects or requires it).
   */
  getHandle<H extends Entity.Handle<Query.Root<Q>, any>>(
    handle: [Entity.Handle.Intent<H>] extends [undefined]
      ? H
      : Query.ProvesComponent<Q, Entity.Handle.Intent<H> & Descriptor<"component", string, any>> extends true
        ? H
        : "this query does not prove the handle's intent component: select it, or add it to with"
  ): Result.Result<QueryMatch<S, Q>, Query.LookupError>
  /**
   * The direct children of one hierarchy parent that match this query, in the
   * stored child order. Children that do not match are skipped; a missing
   * parent is a `MissingEntity` failure.
   */
  children<R extends Extract<Schema.Relations<S>[keyof Schema.Relations<S>], Relation.Relation.Hierarchy>>(
    entityId: Entity.EntityId<S, Query.Root<Q>>,
    relation: R
  ): Result.Result<ReadonlyArray<QueryMatch<S, Q>>, Relation.Relation.MissingEntityError>
  /**
   * The hierarchy descendants of one entity that match this query, in
   * `options.order` (depth-first by default). Descendants that do not match
   * are skipped. `lookup.descendants` returns every descendant's id instead.
   */
  descendants<R extends Extract<Schema.Relations<S>[keyof Schema.Relations<S>], Relation.Relation.Hierarchy>>(
    entityId: Entity.EntityId<S, Query.Root<Q>>,
    relation: R,
    options?: { readonly order?: "breadth" | "depth" }
  ): Result.Result<ReadonlyArray<QueryMatch<S, Q>>, Relation.Relation.MissingEntityError>
  /**
   * Returns a single match when exactly one entity satisfies the query.
   */
  single(): Result.Result<QueryMatch<S, Q>, Query.SingleError>
}

/**
 * Relation lookups exposed to systems: entity ids along relation edges.
 *
 * Lookups return ids only. To read or write the entities they lead to, pass
 * the ids to a declared query (`queries.x.get(id)`), or use the query
 * handle's `children` / `descendants`, so every access stays in the spec.
 *
 * All lookup methods are total and explicit:
 *
 * - no hidden exceptions
 * - missing entities are normal typed failures
 * - hierarchy traversal is available only for hierarchy relations
 */
export interface LookupApi<S extends Schema.Any, Root = unknown> {
  related<R extends Extract<Schema.Relations<S>[keyof Schema.Relations<S>], Relation.Relation.Any>>(
    entityId: Entity.EntityId<S, Root>,
    relation: R
  ): Result.Result<Entity.EntityId<S, Root>, Relation.Relation.LookupError>
  relatedSources<R extends Extract<Schema.Relations<S>[keyof Schema.Relations<S>], Relation.Relation.Any>>(
    entityId: Entity.EntityId<S, Root>,
    relation: R
  ): Result.Result<ReadonlyArray<Entity.EntityId<S, Root>>, Relation.Relation.MissingEntityError>
  parent<R extends Extract<Schema.Relations<S>[keyof Schema.Relations<S>], Relation.Relation.Hierarchy>>(
    entityId: Entity.EntityId<S, Root>,
    relation: R
  ): Result.Result<Entity.EntityId<S, Root>, Relation.Relation.LookupError>
  ancestors<R extends Extract<Schema.Relations<S>[keyof Schema.Relations<S>], Relation.Relation.Hierarchy>>(
    entityId: Entity.EntityId<S, Root>,
    relation: R
  ): Result.Result<ReadonlyArray<Entity.EntityId<S, Root>>, Relation.Relation.MissingEntityError>
  descendants<R extends Extract<Schema.Relations<S>[keyof Schema.Relations<S>], Relation.Relation.Hierarchy>>(
    entityId: Entity.EntityId<S, Root>,
    relation: R,
    options?: {
      readonly order?: "breadth" | "depth"
    }
  ): Result.Result<ReadonlyArray<Entity.EntityId<S, Root>>, Relation.Relation.MissingEntityError>
  root<R extends Extract<Schema.Relations<S>[keyof Schema.Relations<S>], Relation.Relation.Hierarchy>>(
    entityId: Entity.EntityId<S, Root>,
    relation: R
  ): Result.Result<Entity.EntityId<S, Root>, Relation.Relation.MissingEntityError>
}

/**
 * Compact ordering metadata carried by each system for schedule validation.
 *
 * This keeps schedule-level type computation focused on the small ordering
 * surface instead of repeatedly expanding the full system spec.
 */
export interface SystemOrderingSpec {
  /**
   * Identity of this system value. Every `Game.System(...)` call gets its own
   * key, so two systems may share a display name without colliding.
   */
  readonly key: symbol
  readonly name: string
}

/**
 * An explicit system specification.
 *
 * This is the central user-facing abstraction: all ECS access, service
 * dependencies, and stateful capabilities are declared here up front.
 */
export interface SystemAccessInput {
  readonly queries?: Record<string, Query.Any<any>>
  readonly resources?: Record<string, ResourceAccess>
  readonly events?: Record<string, EventAccess>
  readonly services?: Record<string, ServiceRead<Descriptor<"service", string, any>>>
  readonly machines?: Record<string, Machine.MachineRead<Machine.StateMachine.Any>>
  readonly nextMachines?: Record<string, Machine.NextMachineWrite<Machine.StateMachine.Any>>
  readonly transitionEvents?: Record<string, Machine.TransitionEventRead<Machine.StateMachine.Any>>
  readonly removed?: Record<string, RemovedRead<Descriptor<"component", string, any>>>
  readonly despawned?: Record<string, DespawnedRead>
  readonly relationFailures?: Record<string, RelationFailureRead<Relation.Relation.Any>>
  /**
   * The commands the system may queue: `Game.System.commands(...)` with
   * `spawns`, `inserts`, `removes`, `despawns`, `despawnsScope`, and
   * `relates` permissions. Without it the system has no `commands`.
   */
  readonly commands?: CommandAccess.Any
  /**
   * Run conditions that skip the system: while one fails, the system does not
   * run and the events, transition events, and relation failures published
   * meanwhile are dropped for it. Use it for a mode change after which those
   * messages are stale (menu, game over); use `pauseWhen` instead for a freeze
   * whose messages stay valid. `Schedule.when(...)` adds conditions to a whole
   * group.
   *
   * Four gating forms, one rule: `when` drops the events published while
   * gated (the system resumes on fresh messages), `pauseWhen` keeps them (the
   * system resumes and reads the backlog). Put them on one system's spec, or
   * on a group with `Schedule.when(...)` / `Schedule.pauseWhen(...)`.
   */
  readonly when?: ReadonlyArray<Machine.Condition>
  /**
   * Run conditions that pause the system instead of skipping it: while one
   * fails, the system does not run but keeps its place in every event stream
   * it reads, so it sees what was published meanwhile once it runs again.
   * Use it for a freeze whose events stay valid (hit-stop, a pause menu);
   * use `when` for a mode change, after which they are stale. Checked after
   * `when`. `Schedule.pauseWhen(...)` adds them to a whole group.
   */
  readonly pauseWhen?: ReadonlyArray<Machine.Condition>
  readonly transitions?: Record<string, Machine.TransitionRead<Machine.StateMachine.Any>>
  /**
   * Scratch state owned by the system: a broad-phase grid, a path cache, a
   * reused buffer. The factory runs on first encounter in each runtime,
   * even if a gate skips that run, and again before a successful `restore`.
   * Return fresh state using synchronous allocation without side effects.
   * The value is passed to every run as `local`. It is not
   * world data: it is not rolled back when the system fails, not saved in
   * snapshots, and not visible to other systems. A system and its gated
   * copies (`Schedule.when`, `Schedule.pauseWhen`) share one value. Mode
   * changes do not reset it. Rebuild scratch buffers from current world
   * data each run; keep timers, RNG state, and gameplay progress in resources.
   * Values needing cleanup belong in host-managed services.
   */
  readonly local?: () => unknown
}

/**
 * Reusable access fragment. Use `satisfies System.SystemAccessSpec` to check
 * shared `queries`, `resources`, `services`, and other slices before spreading
 * them into `Game.System(...)`.
 */
export type SystemAccessSpec = SystemAccessInput

/** Rejects unknown system access categories, and redundant resource and event slots, at a bound constructor. */
export type ExactAccess<Access extends SystemAccessInput> = Access & {
  readonly [Key in Exclude<keyof Access, keyof SystemAccessInput>]: never
} & RedundantSlotsFix<Access, "resources", "read"> & RedundantSlotsFix<Access, "events", never>

type SlotOf<A> = A extends { readonly mode: infer Mode extends string; readonly descriptor: { readonly name: infer Name extends string } } ? readonly [Mode, Name] : never

/**
 * Slots of `Record` that repeat another slot: the same descriptor in the same
 * mode, or in `ReadMode` next to any other slot of it (a write or changed
 * view already reads).
 */
type RedundantSlots<Record, ReadMode extends string> = {
  readonly [K in keyof Record]: SlotOf<Record[K]> extends readonly [infer Mode, infer Name]
    ? [Extract<SlotOf<Omit<Record, K>[keyof Omit<Record, K>]>, readonly [Mode extends ReadMode ? string : Mode, Name]>] extends [never] ? never : K
    : never
}[keyof Record]

type RedundantSlotsFix<Access, Category extends "resources" | "events", ReadMode extends string> =
  Access extends { readonly [C in Category]?: infer Record }
    ? [RedundantSlots<Record, ReadMode>] extends [never]
      ? unknown
      : {
        readonly [C in Category]: {
          readonly [K in RedundantSlots<Record, ReadMode>]: {
            readonly __fixSystem__: `${K & string} repeats ${Category extends "resources" ? "a resource" : "an event"} another slot of this system declares: keep one slot (a write or changed view reads too)`
          }
        }
      }
    : unknown

type AccessField<
  Access,
  Key extends PropertyKey,
  Fallback
> = Key extends keyof Access ? NonNullable<Access[Key]> : Fallback

// Unlike access maps, an absent factory produces an absent callback value.
// Preserve optional factories and distribute over conditional access fragments.
type LocalFactory<Access> = Access extends unknown
  ? "local" extends keyof Access ? Access["local"] : undefined
  : never

/**
 * The exact access declaration normalized once at the system boundary.
 *
 * `Access` is the only inferred structure. Schedules and runtimes never
 * reconstruct it; they consume the small requirement union cached on the
 * resulting system value.
 */
export type SystemSpec<
  S extends Schema.Any,
  Access extends SystemAccessInput = SystemAccessInput,
  Root = unknown
> = {
  readonly queries: AccessField<Access, "queries", {}>
  readonly resources: AccessField<Access, "resources", {}>
  readonly events: AccessField<Access, "events", {}>
  readonly services: AccessField<Access, "services", {}>
  readonly machines: AccessField<Access, "machines", {}>
  readonly nextMachines: AccessField<Access, "nextMachines", {}>
  readonly transitionEvents: AccessField<Access, "transitionEvents", {}>
  readonly removed: AccessField<Access, "removed", {}>
  readonly despawned: AccessField<Access, "despawned", {}>
  readonly relationFailures: AccessField<Access, "relationFailures", {}>
  readonly when: AccessField<Access, "when", readonly []>
  readonly pauseWhen: AccessField<Access, "pauseWhen", readonly []>
  readonly transitions: AccessField<Access, "transitions", {}>
  readonly local: LocalFactory<Access>
  readonly commands: "commands" extends keyof Access ? NonNullable<Access["commands"]> : undefined
  readonly schema: S
  readonly __schemaRoot: Root
}

/**
 * Internal helper representing any fully-defined system spec shape.
 */
export type AnySystemSpec = SystemSpec<any, any, any>

type ResourceContext<Spec extends AnySystemSpec> = {
  readonly [K in keyof Spec["resources"]]:
    Spec["resources"][K] extends ResourceRead<infer D> ? ResourceReadView<Descriptor.Value<D>>
    : Spec["resources"][K] extends ResourceChanged<infer D> ? ResourceChangedView<Descriptor.Value<D>>
    : Spec["resources"][K] extends ResourceWrite<infer D> ? ResourceWriteView<D>
    : never
}

/**
 * Derives the event view context from a system spec.
 */
type EventContext<Spec extends AnySystemSpec> = {
  readonly [K in keyof Spec["events"]]:
    Spec["events"][K] extends EventRead<infer D> ? EventReadView<Descriptor.Value<D>>
    : Spec["events"][K] extends EventWrite<infer D> ? EventWriteView<Descriptor.Value<D>>
    : never
}

/**
 * Derives the service environment from a system spec.
 */
type ServiceContext<Spec extends AnySystemSpec> = {
  readonly [K in keyof Spec["services"]]:
    Spec["services"][K] extends ServiceRead<infer D> ? Descriptor.Value<D> : never
}

/**
 * Derives the committed-machine view context from a system spec.
 */
type MachineContext<Spec extends AnySystemSpec> = {
  readonly [K in keyof Spec["machines"]]:
    Spec["machines"][K] extends Machine.MachineRead<infer M> ? MachineReadView<M> : never
}

/**
 * Derives the next-machine write context from a system spec.
 */
type NextMachineContext<Spec extends AnySystemSpec> = {
  readonly [K in keyof Spec["nextMachines"]]:
    Spec["nextMachines"][K] extends Machine.NextMachineWrite<infer M> ? NextMachineWriteView<M> : never
}

/**
 * Derives the transition-event view context from a system spec.
 */
type TransitionEventContext<Spec extends AnySystemSpec> = {
  readonly [K in keyof Spec["transitionEvents"]]:
    Spec["transitionEvents"][K] extends Machine.TransitionEventRead<infer M> ? TransitionEventReadView<M> : never
}

type RemovedContext<Spec extends AnySystemSpec> = {
  readonly [K in keyof Spec["removed"]]:
    Spec["removed"][K] extends RemovedRead<any> ? RemovedReadView<Spec["schema"], Spec["__schemaRoot"]> : never
}

type DespawnedContext<Spec extends AnySystemSpec> = {
  readonly [K in keyof Spec["despawned"]]:
    Spec["despawned"][K] extends DespawnedRead ? DespawnedReadView<Spec["schema"], Spec["__schemaRoot"]> : never
}

type RelationFailureContext<Spec extends AnySystemSpec> = {
  readonly [K in keyof Spec["relationFailures"]]:
    Spec["relationFailures"][K] extends RelationFailureRead<infer R>
      ? RelationFailureReadView<R, Spec["schema"], Spec["__schemaRoot"]>
      : never
}

/**
 * Derives the transition view context from a system spec.
 */
type TransitionContext<Spec extends AnySystemSpec> = {
  readonly [K in keyof Spec["transitions"]]:
    Spec["transitions"][K] extends Machine.TransitionRead<infer M> ? TransitionReadView<M> : never
}

/**
 * Derives the query handle context from a system spec.
 */
type QueryContext<Spec extends AnySystemSpec> = {
  readonly [K in keyof Spec["queries"]]: QueryHandle<Spec["schema"], Spec["queries"][K]>
}

/** The value of the system's `local` factory, or `undefined` when it declares none. */
type LocalValue<Factory> = Factory extends () => infer Local ? Local : undefined
type LocalContext<Spec extends AnySystemSpec> = LocalValue<Spec["local"]>

type CommandsContext<Spec extends AnySystemSpec> =
  Spec["commands"] extends CommandAccess<infer Spawns, infer Inserts, infer Removes, infer Despawns, infer Scopes, infer Relates>
    ? CommandsApi<Spec["schema"], Spec["__schemaRoot"], Spawns, Inserts, Removes, Despawns, Scopes, Relates>
    : NotDeclared

/**
 * The implementation context derived from a system spec.
 *
 * Instead of inferring from callback parameters, the library computes this
 * context from the declared spec so the runtime and types stay in sync.
 */
export interface SystemContext<Spec extends AnySystemSpec> {
  readonly queries: QueryContext<Spec>
  readonly lookup: LookupApi<Spec["schema"], Spec["__schemaRoot"]>
  readonly resources: ResourceContext<Spec>
  readonly events: EventContext<Spec>
  readonly machines: MachineContext<Spec>
  readonly nextMachines: NextMachineContext<Spec>
  readonly transitionEvents: TransitionEventContext<Spec>
  readonly removed: RemovedContext<Spec>
  readonly despawned: DespawnedContext<Spec>
  readonly relationFailures: RelationFailureContext<Spec>
  readonly transitions: TransitionContext<Spec>
  readonly services: ServiceContext<Spec>
  /** The commands the spec declares (`commands: Game.System.commands(...)`). */
  readonly commands: CommandsContext<Spec>
  /** The system's own scratch state (see `local` in the spec); `undefined` when it declares none. */
  readonly local: LocalContext<Spec>
}

type DescriptorFromAccess<Access> =
  Access extends { readonly descriptor: infer D extends Requirement.Requirement } ? D : never

type DescriptorNeedsFromRecord<RecordValue> =
  RecordValue extends Record<string, unknown>
    ? DescriptorFromAccess<RecordValue[keyof RecordValue]>
    : never

/** The flat nominal requirement union derived from one exact system spec. */
export type SystemNeeds<Spec extends AnySystemSpec> =
  | DescriptorNeedsFromRecord<Spec["services"]>
  | DescriptorNeedsFromRecord<Spec["resources"]>
  | Machine.MachineNeedsFromRecord<Spec["machines"]>
  | Machine.MachineNeedsFromRecord<Spec["nextMachines"]>
  | Machine.MachineNeedsFromRecord<Spec["transitionEvents"]>
  | Machine.MachineNeedsFromRecord<Spec["transitions"]>
  | Machine.ConditionNeedsFromConditions<Spec["when"]>
  | Machine.ConditionNeedsFromConditions<Spec["pauseWhen"]>

type AccessRecordValue<Access, Key extends PropertyKey> =
  Key extends keyof Access
    ? NonNullable<Access[Key]> extends infer RecordValue extends Record<string, unknown>
      ? RecordValue[keyof RecordValue]
      : never
    : never

type RequirementFromAccessValue<Value> =
  Value extends { readonly descriptor: infer D extends Requirement.Requirement } ? D
  : Value extends { readonly machine: infer M extends Machine.StateMachine.Any } ? M
  : never

/** Derives requirements directly from the constructor's inferred access object. */
export type SystemAccessNeeds<Access extends SystemAccessInput> =
  | RequirementFromAccessValue<AccessRecordValue<Access,
      | "services"
      | "resources"
      | "machines"
      | "nextMachines"
      | "transitionEvents"
      | "transitions">>
  | ("when" extends keyof Access
      ? NonNullable<Access["when"]> extends ReadonlyArray<Machine.Condition>
        ? Machine.ConditionNeedsFromConditions<NonNullable<Access["when"]>>
        : never
      : never)
  | ("pauseWhen" extends keyof Access
      ? NonNullable<Access["pauseWhen"]> extends ReadonlyArray<Machine.Condition>
        ? Machine.ConditionNeedsFromConditions<NonNullable<Access["pauseWhen"]>>
        : never
      : never)

/** One expected failure returned by a named system. */
export interface SystemFailure<
  out Name extends string = string,
  out Error = unknown
> {
  readonly _tag: "SystemFailure"
  readonly system: Name
  readonly error: Error
}

/** Extracts the normalized failure carried by one system definition. */
export type FailureOf<Value> =
  Value extends SystemDefinition<any, infer Error, any, infer Name, any>
    ? [Error] extends [never] ? never : SystemFailure<Name, Error>
    : never

/**
 * A fully defined system value ready to be placed into a schedule.
 */
export interface SystemDefinition<
  Spec extends AnySystemSpec,
  out E = never,
  out Root = unknown,
  out Name extends string = string,
  out Needs extends Requirement.Requirement = Requirement.Requirement
> {
  /**
   * Human-readable declaration name used to derive the internal typed label.
   */
  readonly name: Name
  /**
   * The explicit static description of the system.
   */
  readonly spec: Spec
  /**
   * Cached static runtime requirements for this system.
   *
   * Carrying this directly on the value avoids having later schedule-level
   * type folds re-infer the full spec repeatedly, which keeps the bound API
   * both stricter and cheaper for the compiler.
   */
  readonly requirements: ReadonlyArray<Needs>
  /**
   * Hidden schema-root brand used by schema-bound APIs.
   */
  readonly __schemaRoot: Root
  /**
   * Compact schedule-ordering view derived from the system spec once.
   */
  readonly ordering: SystemOrderingSpec
  /**
   * The executable implementation of the system.
   */
  readonly run: SystemRun<Spec, E>
  /**
   * The system this one is a gated copy of, made by `Schedule.when(...)`:
   * the same system with extra run conditions. The runtime keys per-system
   * state (change detection, event cursors) by the original, so a system and
   * its gated copies are one reader.
   */
  readonly base?: SystemDefinition<any, any, any, any, any> | undefined
}

/**
 * A system implementation.
 *
 * Return nothing for a system that cannot fail. Return
 * `Result.fail(error)` for an expected failure: the system's ECS writes
 * are rolled back, its commands and events are dropped, and the tick stops
 * with a typed `SystemFailure` whose `error` is inferred from every
 * `Result.fail(...)` the body returns. A returned success
 * (`Result.succeed(...)`) behaves like returning nothing. Exceptions are
 * defects, not failures: they roll back the same way and are rethrown.
 *
 * @example
 * ```ts
 * const Spend = Game.System("Game/Spend", {
 *   resources: { gold: Game.System.writeResource(Gold) }
 * }, ({ resources }) => {
 *   if (resources.gold.get() < 10) return Result.fail("NotEnoughGold" as const)
 *   resources.gold.update((gold) => gold - 10)
 * })
 * ```
 */
export type SystemRun<Spec extends AnySystemSpec, E = never> =
  (context: SystemContext<Spec>) => Result.Result<unknown, E> | void

/**
 * Defines a system from an explicit spec and a typed implementation.
 *
 * This is the public entrypoint for authoring systems. The implementation only
 * receives the capabilities declared in the spec; return
 * `Result.fail(error)` for an expected failure (see {@link SystemRun}).
 *
 * Use the string-name overload in normal code. The name is turned into an
 * internal ordering token automatically, so the system can participate in
 * schedule validation without extra user-authored identity plumbing.
 *
 * @example
 * ```ts
 * const CountEnemies = Game.System("Game/CountEnemies", {
 *   queries: {
 *     enemies: Game.Query({
 *       selection: {
 *         enemy: Game.Query.read(Enemy)
 *       }
 *     })
 *   },
 *   resources: {
 *     total: Game.System.writeResource(EnemyCount)
 *   }
 * }, ({ queries, resources }) => {
 *   resources.total.set(queries.enemies.each().length)
 * })
 * ```
 */
const requirementValuesFromRecord = (
  record: Record<string, unknown> | undefined
): ReadonlyArray<Requirement.RequirementValue> => {
  if (!record) return []
  const requirements: Array<Requirement.RequirementValue> = []
  for (const access of Object.values(record)) {
    if (typeof access !== "object" || access === null) continue
    if ("descriptor" in access) {
      requirements.push(access.descriptor as Requirement.RequirementValue)
    } else if ("machine" in access) {
      requirements.push(access.machine as Requirement.RequirementValue)
    }
  }
  return requirements
}

const requirementValuesFromCondition = (
  condition: Machine.Condition
): ReadonlyArray<Requirement.RequirementValue> => condition.requirements

const collectSystemRequirements = (
  spec: Omit<SystemAccessInput, "local">
): ReadonlyArray<Requirement.RequirementValue> => Requirement.collect([
  ...requirementValuesFromRecord(spec.services),
  ...requirementValuesFromRecord(spec.resources),
  ...requirementValuesFromRecord(spec.machines),
  ...requirementValuesFromRecord(spec.nextMachines),
  ...requirementValuesFromRecord(spec.transitionEvents),
  ...requirementValuesFromRecord(spec.transitions),
  ...(spec.when ?? []).flatMap(requirementValuesFromCondition),
  ...(spec.pauseWhen ?? []).flatMap(requirementValuesFromCondition)
])

export function System<
  const Access extends SystemAccessInput & { readonly schema: Schema.Any },
  E = never,
  Root = unknown,
  const Name extends string = string
>(
  name: Name,
  spec: Access & {
    readonly [Key in Exclude<keyof Access, keyof SystemAccessInput | "schema">]: never
  },
  run: SystemRun<SystemSpec<Access["schema"], Access, Root>, E>
): SystemDefinition<SystemSpec<Access["schema"], Access, Root>, E, Root, Name, SystemAccessNeeds<Access>>

export function System(
  name: string,
  spec: { readonly schema: Schema.Any } & SystemAccessInput,
  run: (context: any) => Result.Result<any, any> | void
): SystemDefinition<any, any, any, any, any> {
  type Spec = SystemSpec<Schema.Any, SystemAccessInput, unknown>

  const normalizedSpec = {
    schema: spec.schema,
    queries: spec.queries ?? {},
    resources: spec.resources ?? {},
    events: spec.events ?? {},
    services: spec.services ?? {},
    machines: spec.machines ?? {},
    nextMachines: spec.nextMachines ?? {},
    transitionEvents: spec.transitionEvents ?? {},
    removed: spec.removed ?? {},
    despawned: spec.despawned ?? {},
    relationFailures: spec.relationFailures ?? {},
    when: spec.when ?? [],
    pauseWhen: spec.pauseWhen ?? [],
    transitions: spec.transitions ?? {},
    local: spec.local,
    commands: spec.commands,
    __schemaRoot: undefined
  } as Spec

  return {
    name,
    requirements: collectSystemRequirements(normalizedSpec),
    __schemaRoot: undefined,
    ordering: {
      key: Symbol(name),
      name
    },
    spec: normalizedSpec,
    run
  } as SystemDefinition<any, any, any, any, any>
}
