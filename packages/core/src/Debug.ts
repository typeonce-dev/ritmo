/**
 * Opt-in runtime introspection for tools, tests, and coding agents.
 *
 * A runtime made with `debug: { hostClock }` carries a `debug` handle. Runtimes made
 * without it have no handle at all, so production code cannot reach into
 * internals by accident and pays nothing for them.
 *
 * The handle is read-only: it describes the schema and schedules, dumps the
 * current world as plain data, reports stream retention, and streams trace
 * events while schedules run. Nothing it returns can change the world.
 *
 * - `describe()` is static: every component, resource, event, relation,
 *   machine, and service, each named schedule's steps, each system's declared
 *   access, who reads and writes what, and lints over that graph and what
 *   the runtime has seen so far (see `Lint`).
 * - `dump(filter?)` is the current world: entities with component values and
 *   relation targets, resources, machine values, and pending commands. It
 *   works even when `snapshot()` is gated, because a dump is never restored.
 * - `observe(listener)` delivers one `TraceEvent` per frame start, schedule
 *   boundary, system run or skip, applied marker, and machine transition.
 *   System runs carry every component, resource, event, and next-state write
 *   with before/after values; applied markers carry every command with the
 *   system that queued it and its structural effects.
 * - `streams()` reports each event, transition-event, and relation-failure
 *   stream: its size, and each reader's unread count and loss.
 * - `beginFrame(schedule)` runs one frame of a schedule a step at a time, so
 *   a tool can read the world between two systems (see {@link FrameCursor}).
 *
 * Values in descriptions, dumps, and traces are shared with the world, not
 * copied. World values are immutable by contract, so they stay valid as a
 * history, but serialize them before sending them elsewhere.
 *
 * `@typeonce/ritmo-devtools` builds sessions, histories, formatting, and invariants
 * on top of this handle.
 *
 * @module Debug
 * @docGroup runtime
 *
 * @example
 * ```ts
 * // `runtime` was made with `debug: { hostClock: HostClock.standard }`.
 * runtime.debug.nameSchedules({ setup, update })
 *
 * const stop = runtime.debug.observe((event) => {
 *   if (event.type === "system" && event.outcome !== "ok") console.log(event)
 * })
 * runtime.tick(setup)
 * console.log(runtime.debug.dump({ with: [Player] }))
 * stop()
 * ```
 */
import type { FieldMeta } from "./Descriptor.ts"
import type { HostClock } from "./HostClock.ts"
import type * as Machine from "./Machine.ts"
import type * as Result from "./Result.ts"
import type { MissingRuntimeRequirements, TickOrderViolation } from "./Runtime.ts"
import type { AnyScheduleOrder, ExecutableScheduleDefinition, FailureOf } from "./Schedule.ts"
import type { Schema } from "./Schema.ts"

/** Version of the description, dump, and trace formats. */
export const formatVersion = 1 as const

/**
 * The debug handle of a runtime made with `debug: { hostClock }`.
 */
export interface Handle<S extends Schema.Any = Schema.Any, Root = unknown> {
  /**
   * Names schedules for `describe()` and traces. Schedules that were never
   * named appear as `schedule#N` in traces (and in observed lints, as
   * `System (schedule#N, step K, unnamed)`) and are not described. Transition
   * schedules are named after their transition, for example
   * `onEnter(Game/Flow=Playing)`. Naming again replaces earlier names.
   */
  readonly nameSchedules: (
    schedules: Readonly<Record<string, ExecutableScheduleDefinition<S, any, Root, any, any, AnyScheduleOrder>>>
  ) => void
  /**
   * Declares the events the host publishes with `runtime.send`, so
   * `describe()` counts them as written (`event-never-written`) before the
   * first send happens. Events actually sent count as well. Declaring again
   * replaces the list.
   */
  readonly declareHostEvents: (events: ReadonlyArray<Schema.EventDescriptor<S>>) => void
  /** The static description of the schema and the named schedules. */
  readonly describe: () => Description
  /** The current world as plain data. */
  readonly dump: (filter?: DumpFilter<S>) => WorldDump
  /**
   * Delivers trace events until the returned function is called. Tracing is
   * active only while at least one listener is registered.
   */
  readonly observe: (listener: (event: TraceEvent) => void) => () => void
  /**
   * Delivers what the host does to the runtime, until the returned function
   * is called: each tick's start and end (with the schedule values it runs)
   * and each `runtime.send`. Unlike `observe`, it turns no tracing on, so a
   * tool can listen for a whole play session (replay recorders do).
   */
  readonly observeHost: (listener: (event: HostEvent<S, Root>) => void) => () => void
  /**
   * Reports the last failed tick result if nobody read its `ok`, as a
   * `failure.ignored` event (to `observe` and `observeHost` listeners), with
   * `when: "session-end"`. Call it when a session ends; the start of the
   * next tick checks the same with `when: "next-tick"`. Emits nothing to a
   * console.
   */
  readonly checkIgnoredFailures: () => void
  /** Retention and reader state of every stream that has readers or entries. */
  readonly streams: () => ReadonlyArray<StreamStatus>
  /** Live entity count and, per component, how many entities have it. Cheap enough to sample every frame. */
  readonly population: () => Population
  /** Number of frames (`tick`/`tryTick` calls and begun frames) run so far. */
  readonly frame: () => number
  /**
   * Begins one frame of `schedule` and returns a cursor that runs its steps
   * one `next()` at a time: the frame `tryTick(schedule)` would run, with
   * the same semantics and trace events, paused between steps. Each system
   * run commits at its end, markers apply at their position, and reader
   * cursors advance as in a whole tick. Missing requirements and `thisTick`
   * order violations fail here, as `tryTick` returns them, and begin
   * nothing.
   *
   * While the frame is open the world can be read (`dump`, `inspect`,
   * `streams`), but `tick`, `tryTick`, `send`, `snapshot`, `checksum`,
   * `restore`, `checkpoint`, `rewind`, and another `beginFrame` are defects:
   * run the remaining steps first. A frame cannot be abandoned halfway.
   *
   * For tools: devtools' `session.step(name)` wraps it with typed system
   * names, invariants, and labels. Games use `tick`.
   *
   * @example
   * ```ts
   * const frame = runtime.debug.beginFrame(update)
   * if (frame.ok) {
   *   frame.value.next() // the first step
   *   console.log(runtime.debug.dump({ entities: [12] }))
   *   while (frame.value.remaining().length > 0) frame.value.next()
   * }
   * ```
   */
  readonly beginFrame: <const Selected extends ExecutableScheduleDefinition<S, any, Root, any, any, AnyScheduleOrder>>(
    schedule: Selected
  ) => Result.Result<FrameCursor<FailureOf<Selected>>, MissingRuntimeRequirements | TickOrderViolation>
}

/**
 * One frame of a schedule begun with `debug.beginFrame`, run one step at a
 * time. The frame ends after its last step, after a system that fails, or
 * when a step throws (the defect is rethrown); once ended, `remaining()` is
 * empty and `next()` is a defect.
 */
export interface FrameCursor<Failure = unknown> {
  /** The frame number, as `debug.frame()` reports it. */
  readonly frame: number
  /** The steps not run yet, in order; empty once the frame has ended. */
  readonly remaining: () => ReadonlyArray<StepDescription>
  /**
   * Runs the next step: a system (committed at its end, or skipped by its
   * conditions) or a marker (applying commands, and for
   * `applyStateTransitions` the transitions and their schedules). A system
   * failure ends the frame and is returned, as `tryTick` returns it; the
   * steps after it do not run this frame.
   */
  readonly next: () => Result.Result<StepOutcome, Failure>
}

/** The step a {@link FrameCursor} ran, and whether it ended the frame. */
export interface StepOutcome {
  readonly step: StepDescription
  /** `true` when it was the frame's last step: the frame has ended. */
  readonly ended: boolean
}

/**
 * How a component or resource descriptor treats its values: `constructed`
 * values go through the descriptor's constructor, `transient` ones are left
 * out of snapshots, `plain` ones are neither.
 */
export type Storage = "constructed" | "transient" | "plain"

/** One schema component, in `Description.components`. */
export interface ComponentDescription {
  readonly name: string
  readonly storage: Storage
  /** Declared `immutable: true`: queries only read it, `commands.insert` replaces it. */
  readonly immutable: boolean
  /** The components it directly requires (`Schema.requires`). */
  readonly requires: ReadonlyArray<string>
  /** Its fields' declared unit, range, and hint (the constructor's `meta` option), by field; `{}` when none. */
  readonly meta: Readonly<Record<string, FieldMeta>>
}

/** One schema resource, in `Description.resources`. */
export interface ResourceDescription {
  readonly name: string
  readonly storage: Storage
  /** Whether the resource currently has a value. */
  readonly present: boolean
  /** Its fields' declared unit, range, and hint (the constructor's `meta` option), by field; `{}` when none. */
  readonly meta: Readonly<Record<string, FieldMeta>>
}

/** One schema relation and its related side (`relatedName`), in `Description.relations`. */
export interface RelationDescription {
  readonly name: string
  readonly relatedName: string
  readonly kind: "hierarchy" | "relation"
  readonly linkedDespawn: boolean
  readonly ordered: boolean
}

/** One state machine of the game, in `Description.machines`. */
export interface MachineDescription {
  readonly name: string
  /** The names of its states. */
  readonly states: ReadonlyArray<string>
  /**
   * The committed value, or `undefined` when the runtime does not provide the
   * machine, or when it is a sub-state whose parent is in another state.
   */
  readonly current: Machine.AnyValue | undefined
  /** Whether the runtime was given an initial value for the machine. */
  readonly provided: boolean
  /** For a sub-state, where it exists, as `Parent=state`. */
  readonly within: string | undefined
}

/** An entity scope and the state changes that despawn it (`Game.EntityScope(name, { despawnOnExit, despawnOnEnter })`). */
export interface ScopeDescription {
  readonly name: string
  /** Triggers as `onExit(Flow=Playing)` / `onEnter(Flow=Menu)`; empty when only `commands.despawnScope` ends it. */
  readonly despawnOn: ReadonlyArray<string>
}

/** One service the runtime provides or a described system declares, and whether it is provided. */
export interface ServiceDescription {
  readonly name: string
  readonly provided: boolean
}

/** One query slot of a system, as component and relation names. */
export interface QueryDescription {
  readonly slot: string
  readonly reads: ReadonlyArray<string>
  readonly writes: ReadonlyArray<string>
  readonly optional: ReadonlyArray<string>
  readonly with: ReadonlyArray<string>
  readonly without: ReadonlyArray<string>
  readonly added: ReadonlyArray<string>
  readonly changed: ReadonlyArray<string>
  /** One entry per `anyOf` filter: the components of its `added` and `changed` members. */
  readonly anyOf: ReadonlyArray<{ readonly added: ReadonlyArray<string>; readonly changed: ReadonlyArray<string> }>
  /** Relation filters and reads, for example `with ChildOf` or `read Children`. */
  readonly relations: ReadonlyArray<string>
}

/** Everything one system declares, by name. */
export interface SystemDescription {
  readonly name: string
  /** Where the system runs, as `schedule#step`. */
  readonly placements: ReadonlyArray<string>
  readonly queries: ReadonlyArray<QueryDescription>
  /** Resource reads and writes. `changed` lists the reads declared with `changedResource` (also in `reads`). */
  readonly resources: { readonly reads: ReadonlyArray<string>; readonly changed: ReadonlyArray<string>; readonly writes: ReadonlyArray<string> }
  readonly events: { readonly reads: ReadonlyArray<string>; readonly writes: ReadonlyArray<string> }
  readonly machines: {
    readonly reads: ReadonlyArray<string>
    /** Machines whose current state's fields it changes (`Game.System.updateMachine`); they are read too. */
    readonly updates: ReadonlyArray<string>
    readonly next: ReadonlyArray<string>
    readonly transitions: ReadonlyArray<string>
    readonly transitionEvents: ReadonlyArray<string>
  }
  readonly removed: ReadonlyArray<string>
  readonly despawned: boolean
  readonly relationFailures: ReadonlyArray<string>
  /** Relations whose edges dropped by a target's despawn it reads (`Game.System.readDroppedRelations`). */
  readonly droppedRelations: ReadonlyArray<string>
  /** Events and resources read with `Game.System.thisTick`, and query slots as `queries.<slot>`. */
  readonly thisTick: ReadonlyArray<string>
  readonly services: ReadonlyArray<string>
  /** The services declared with `Game.System.consumeService` (also in `services`). */
  readonly consumes: ReadonlyArray<string>
  /**
   * The declared command permissions (`Game.System.commands(...)`), by
   * kind: component names for spawns, inserts, removes and despawns, scope
   * names for despawnsScope, relation names for relates.
   */
  readonly commands: CommandPermissions
  /**
   * Run conditions, rendered, for example `stateChanged(Game/Flow)`. A system
   * placed under several `Schedule.when` / `pauseWhen` groups is described
   * once, with the conditions of every placement.
   */
  readonly when: ReadonlyArray<string>
  /** Pause conditions, rendered: while one fails the system waits and holds its stream entries. */
  readonly pauseWhen: ReadonlyArray<string>
  /** Whether the system declares `local` scratch state. */
  readonly local: boolean
}

/** Declared command permissions of one system, by kind. Empty lists when it declares none. */
export interface CommandPermissions {
  readonly spawns: ReadonlyArray<string>
  readonly inserts: ReadonlyArray<string>
  readonly removes: ReadonlyArray<string>
  readonly despawns: ReadonlyArray<string>
  readonly despawnsScope: ReadonlyArray<string>
  readonly relates: ReadonlyArray<string>
}

/** One step of a described schedule: a system by name, or a marker. */
export type StepDescription =
  | { readonly kind: "system"; readonly system: string }
  | { readonly kind: "applyDeferred" }
  | { readonly kind: "applyStateTransitions"; readonly schedules: ReadonlyArray<string> }

/** One named schedule and its steps, in authored order. */
export interface ScheduleDescription {
  readonly name: string
  readonly steps: ReadonlyArray<StepDescription>
}

/**
 * A finding about the described schedules. `warning` is almost certainly a
 * bug; `info` is worth a look but can be intentional.
 *
 * Read from declarations of the named schedules:
 * - `event-never-read` / `event-never-written`: an event with writers and no
 *   reader, or readers and no writer. Events declared with
 *   `declareHostEvents` or sent with `runtime.send(...)` count as written.
 * - `next-state-never-applied`: next states are queued, but no schedule has
 *   an `applyStateTransitions(...)` marker.
 * - `resource-changed-never-written`: a `changedResource` read nobody writes.
 * - `this-tick-order`: a `Game.System.thisTick` read placed before a writer.
 * - `read-before-write` (`info`): a read placed before the first writer in
 *   the same schedule, so it sees the previous run's value.
 * - `component-never-read` (`info`): written, but read by no other system.
 *
 * Also read from what the runtime has seen, so describe after the game has
 * run for a while:
 * - `relation-failure-never-read`: a relation that `relates` permissions or
 *   applied commands relate or reorder (which can fail), with no system
 *   reading its failures.
 * - `scope-trigger-never-applied`: a scope's despawn trigger whose machine
 *   the runtime does not provide, or that nothing queues or applies.
 * - `service-consumed-twice`: a service declared with
 *   `Game.System.consumeService` at more than one placement, in the named
 *   schedules, or where consuming systems ran, named or not.
 * - `command-permission-unused` (`info`): a permission a system that ran
 *   never used.
 * - `requirement-violated`: commands skipped because they would have broken
 *   a `Schema.requires` requirement.
 * - `next-state-replaced`: a next state one system queued and another
 *   replaced with a different value before the marker (the last wins).
 * - `stale-target`: `despawn` / `remove` commands given a `SpawnedId` kept
 *   from an earlier run (skipped).
 * - `stream-loss-unread`: a stream reader that never checks `lagged()` and
 *   lost entries (`info` when it only reads under `pauseWhen`).
 * - `service-lint`: a finding a provided service reports through
 *   {@link serviceLints}, with the service's severity.
 */
export interface Lint {
  readonly severity: "warning" | "info"
  readonly code:
    | "event-never-read"
    | "relation-failure-never-read"
    | "event-never-written"
    | "next-state-never-applied"
    | "resource-changed-never-written"
    | "component-never-read"
    | "read-before-write"
    | "this-tick-order"
    | "command-permission-unused"
    | "requirement-violated"
    | "next-state-replaced"
    | "stale-target"
    | "stream-loss-unread"
    | "scope-trigger-never-applied"
    | "service-consumed-twice"
    | "service-lint"
  readonly message: string
  readonly subject: string
  /** What to change to resolve it (or, for `info`, when it is fine as it is). */
  readonly fix: string
}

/**
 * The key a service value implements to add its own findings to
 * `describe()` lints, as `service-lint` lints with the service's name as
 * subject: `[Debug.serviceLints]: () => [...]`. Use it in packages whose
 * services carry configuration a mistake can hide in (an input merge
 * reporting the actions a device lacks); game code does not need it.
 */
export const serviceLints: unique symbol = Symbol.for("@typeonce/ritmo/Debug/serviceLints")

/** One finding a service reports through {@link serviceLints}. */
export interface ServiceLint {
  readonly severity: "warning" | "info"
  readonly message: string
  /** What to change to resolve it (or, for `info`, when it is fine as it is). */
  readonly fix: string
}

/** A service value that reports findings; see {@link serviceLints}. */
export interface ReportsLints {
  readonly [serviceLints]: () => ReadonlyArray<ServiceLint>
}

/** Readers and writers of one component, resource, or event. */
export interface AccessIndexEntry {
  readonly name: string
  readonly readers: ReadonlyArray<string>
  readonly writers: ReadonlyArray<string>
}

/** What `describe()` returns: the schema, the named schedules, their systems, who reads and writes what, and {@link Lint}s. */
export interface Description {
  readonly version: typeof formatVersion
  readonly components: ReadonlyArray<ComponentDescription>
  readonly resources: ReadonlyArray<ResourceDescription>
  readonly events: ReadonlyArray<{ readonly name: string }>
  readonly relations: ReadonlyArray<RelationDescription>
  readonly machines: ReadonlyArray<MachineDescription>
  /** Scopes defined through the game, in definition order. */
  readonly scopes: ReadonlyArray<ScopeDescription>
  readonly services: ReadonlyArray<ServiceDescription>
  readonly schedules: ReadonlyArray<ScheduleDescription>
  readonly systems: ReadonlyArray<SystemDescription>
  /**
   * Readers and writers across the named schedules. Component writers are
   * systems with a write query slot or a declared `spawns`, `inserts`, or
   * `removes` permission for it.
   */
  readonly access: {
    readonly components: ReadonlyArray<AccessIndexEntry>
    readonly resources: ReadonlyArray<AccessIndexEntry>
    readonly events: ReadonlyArray<AccessIndexEntry>
  }
  readonly lints: ReadonlyArray<Lint>
}

/** How many entities are alive, and how many have each component. */
export interface Population {
  readonly entities: number
  /** Entities per component, by descriptor name, for every schema component. */
  readonly components: Readonly<Record<string, number>>
}

/**
 * Narrows a dump. Entity ids are the raw numbers printed in dumps and traces.
 */
export interface DumpFilter<S extends Schema.Any = Schema.Any> {
  /** Only these entities. */
  readonly entities?: ReadonlyArray<number>
  /** Only entities that have every one of these components. */
  readonly with?: ReadonlyArray<Schema.ComponentDescriptor<S>>
  /** At most this many entities, lowest ids first. */
  readonly limit?: number
}

/** One live entity in a {@link WorldDump}. */
export interface EntityDump {
  readonly id: number
  /** Component values by descriptor name, transient ones included. */
  readonly components: Readonly<Record<string, unknown>>
  /** Relation targets by relation name. */
  readonly relations: Readonly<Record<string, number>>
}

/** One provided machine's value in a {@link WorldDump}. */
export interface MachineDump {
  readonly current: Machine.AnyValue
  /** The queued next value, applied at the next `applyStateTransitions`. */
  readonly pending?: Machine.AnyValue
  readonly previous?: Machine.AnyValue
}

/** A command queued and not yet applied, in `WorldDump.pendingCommands`. */
export interface PendingCommand {
  readonly tag: string
  /** The system that queued the command. */
  readonly system: string
}

/** What `dump(filter?)` returns: the current world as plain data. Use `streams()` for stream state and `population()` for cheap counts. */
export interface WorldDump {
  readonly version: typeof formatVersion
  readonly frame: number
  readonly tick: number
  /** Live entities before filtering. */
  readonly entityCount: number
  readonly entities: ReadonlyArray<EntityDump>
  readonly resources: Readonly<Record<string, unknown>>
  readonly machines: Readonly<Record<string, MachineDump>>
  /** Commands queued and not yet applied by a marker. */
  readonly pendingCommands: ReadonlyArray<PendingCommand>
}

/** One reader of a stream. */
export interface StreamReaderStatus {
  readonly system: string
  /** Entries published after the reader's previous run. */
  readonly unread: number
  /** Whether entries the reader never saw were dropped at capacity. */
  readonly lagged: boolean
}

/** One stream as `streams()` reports it: retained entries and each reader's state. */
export interface StreamStatus {
  readonly kind: "event" | "transitionEvent" | "relationFailure" | "droppedRelation"
  /** The event, machine, or relation name. */
  readonly stream: string
  /** Retained entries. */
  readonly size: number
  readonly capacity: number
  readonly readers: ReadonlyArray<StreamReaderStatus>
  /**
   * The reader whose unread entries keep the oldest batch alive, when a
   * reader (not the two-frame window) is what holds it.
   */
  readonly heldBy: string | undefined
}

/** A component changed in place by a system's write query slot: written to a different value (see `Game.Query.changed`). */
export interface ComponentWrite {
  readonly entity: number
  readonly component: string
  readonly before: unknown
  readonly after: unknown
}

/** A resource set or removed by a system, in `SystemEvent.resources`. */
export interface ResourceWrite {
  readonly resource: string
  /** `undefined` when the resource had no value. */
  readonly before: unknown
  /** `undefined` when the system removed the value. */
  readonly after: unknown
}

/** The values a system emitted to one event, in `SystemEvent.events`. */
export interface EventEmit {
  readonly event: string
  readonly values: ReadonlyArray<unknown>
}

/** A next state a system queued or cleared, in `SystemEvent.nextStates`. */
export interface NextStateWrite {
  readonly machine: string
  /** `undefined` when the system cleared the queued value. */
  readonly value: Machine.AnyValue | undefined
}

/** The fields of a machine's current state, changed by a system with `machines.x.update(...)`, in `SystemEvent.machines`. */
export interface MachineWrite {
  readonly machine: string
  readonly before: Machine.AnyValue
  readonly after: Machine.AnyValue
}

/**
 * A read the system could not fully see: stream, removed, or despawned
 * entries dropped at capacity before the system read them.
 */
export interface MissedRead {
  readonly kind: "event" | "transitionEvent" | "relationFailure" | "droppedRelation" | "removed" | "despawned"
  readonly stream: string
}

/** A structural change made while a command was applied. */
export type Effect =
  | { readonly kind: "spawn"; readonly entity: number; readonly components: Readonly<Record<string, unknown>> }
  | { readonly kind: "despawn"; readonly entity: number }
  | { readonly kind: "insert"; readonly entity: number; readonly component: string; readonly value: unknown }
  | { readonly kind: "overwrite"; readonly entity: number; readonly component: string; readonly before: unknown; readonly after: unknown }
  | { readonly kind: "remove"; readonly entity: number; readonly component: string }
  | { readonly kind: "relate"; readonly entity: number; readonly relation: string; readonly target: number }
  | { readonly kind: "unrelate"; readonly entity: number; readonly relation: string }
  | { readonly kind: "relationFailure"; readonly entity: number; readonly relation: string; readonly error: string }
  /** An edge from `entity` to `target` removed because `target` despawned (`Game.System.readDroppedRelations`). */
  | { readonly kind: "relationDropped"; readonly entity: number; readonly relation: string; readonly target: number }
  /** A command skipped because it would leave `component` without `missing` (`Schema.requires`). */
  | {
      readonly kind: "requirementViolated"
      readonly entity: number
      readonly command: RequirementViolation["command"]
      readonly component: string
      readonly missing: string
    }
  /** A `despawn` / `remove` skipped because it was given a `SpawnedId` from an earlier run. */
  | { readonly kind: "staleTarget"; readonly entity: number; readonly command: StaleTarget["command"] }

/**
 * A next state one system queued and another replaced with a different value
 * before the same `applyStateTransitions(...)`: the `next-state-replaced`
 * lint. Only the last value is committed.
 */
export interface NextStateReplacement {
  readonly machine: string
  readonly replaced: { readonly system: string; readonly value: Machine.AnyValue }
  readonly by: { readonly system: string; readonly value: Machine.AnyValue }
  /** How many times it happened. */
  readonly count: number
}

/**
 * Commands of one system skipped because applying them would have left a
 * component without one it requires (`Schema.requires`): the
 * `requirement-violated` lint.
 */
export interface RequirementViolation {
  readonly system: string
  readonly command: "spawn" | "insert" | "remove"
  /** The requirer. */
  readonly component: string
  /** The required component it would have lacked. */
  readonly missing: string
  /** The last entity it happened to. */
  readonly entity: number
  /** How many commands were skipped this way. */
  readonly count: number
}

/**
 * Commands of one system skipped because they were given a `SpawnedId` kept
 * from an earlier run, whose entity may since have been despawned and its id
 * reused: the `stale-target` lint.
 */
export interface StaleTarget {
  readonly system: string
  readonly command: "despawn" | "remove"
  /** The last entity id it happened to. */
  readonly entity: number
  /** How many commands were skipped this way. */
  readonly count: number
}

/**
 * One system's reads of one stream (events, transition events, removed,
 * despawned, relation failures) on a debug runtime: the
 * `stream-loss-unread` lint.
 */
export interface StreamLoss {
  readonly system: string
  /** The stream, as `events Hit`, `removed Sprite`, `despawned`, ... */
  readonly stream: string
  /** Runs that read it after entries were dropped before they were read. */
  readonly lostRuns: number
  /** Whether the system called `lagged()` on it. */
  readonly checksLagged: boolean
  /** Whether the system has `pauseWhen` conditions (a long pause can drop entries). */
  readonly paused: boolean
}

/** One command a marker applied, with the system that queued it and what it changed. */
export interface AppliedCommand {
  readonly tag: string
  readonly system: string
  readonly effects: ReadonlyArray<Effect>
}

/** The start of a frame (`tick`/`tryTick` call). */
export interface FrameEvent {
  readonly type: "frame"
  readonly frame: number
  readonly tick: number
}

/** A schedule starting to run. */
export interface ScheduleStartEvent {
  readonly type: "schedule.start"
  readonly frame: number
  readonly schedule: string
}

/** A schedule finished; `ok` is `false` when a system in it failed. */
export interface ScheduleEndEvent {
  readonly type: "schedule.end"
  readonly frame: number
  readonly schedule: string
  readonly ok: boolean
  readonly ms: number
}

/** One system run, with every write it made (or that was rolled back). */
export interface SystemEvent {
  readonly type: "system"
  readonly frame: number
  readonly tick: number
  /** Schedule path, for example `update` or `update > onEnter(Game/Flow=Playing)`. */
  readonly schedule: string
  readonly system: string
  /**
   * `ok` committed its writes; `failed` returned an expected failure and was
   * rolled back; `defect` threw and was rolled back (the error is rethrown).
   */
  readonly outcome: "ok" | "failed" | "defect"
  readonly error?: unknown
  readonly ms: number
  /** Committed writes; on failure, the writes that were rolled back. */
  readonly writes: ReadonlyArray<ComponentWrite>
  readonly resources: ReadonlyArray<ResourceWrite>
  readonly events: ReadonlyArray<EventEmit>
  /** Immediate changes to the current state's fields (`machines.x.update(...)`). */
  readonly machines: ReadonlyArray<MachineWrite>
  readonly nextStates: ReadonlyArray<NextStateWrite>
  /** Tags of the commands queued (dropped on failure). */
  readonly commands: ReadonlyArray<string>
  readonly missed: ReadonlyArray<MissedRead>
}

/** A system not run because a `when` or `pauseWhen` condition did not hold. */
export interface SystemSkippedEvent {
  readonly type: "system.skipped"
  readonly frame: number
  readonly tick: number
  readonly schedule: string
  readonly system: string
  /** The run condition that did not hold, rendered. */
  readonly condition: string
  /**
   * `true` when a `pauseWhen` condition failed: the system is paused and
   * keeps its stream entries. `false` when a `when`
   * condition failed: the entries are discarded for it.
   */
  readonly held: boolean
  /** Stream entries published since the system's previous run, now discarded for it (empty when `held`). */
  readonly discarded: ReadonlyArray<{ readonly stream: string; readonly count: number }>
}

/** An event the host published with `runtime.send(...)`, outside any system. */
export interface SentEvent {
  readonly type: "runtime.sent"
  readonly frame: number
  readonly tick: number
  readonly event: string
  readonly value: unknown
}

/** A marker step that applied queued commands. */
export interface DeferredEvent {
  readonly type: "deferred"
  readonly frame: number
  readonly tick: number
  readonly schedule: string
  readonly marker: "applyDeferred" | "applyStateTransitions"
  readonly commands: ReadonlyArray<AppliedCommand>
}

/** A machine transition at an `applyStateTransitions(...)` marker. */
export interface TransitionEvent {
  readonly type: "transition"
  readonly frame: number
  readonly tick: number
  readonly schedule: string
  readonly machine: string
  /** The state left; `undefined` when a sub-state starts existing (its parent entered its state). */
  readonly from: string | undefined
  /** The state entered; `undefined` when a sub-state stops existing (its parent left its state). */
  readonly to: string | undefined
  /**
   * `applied` committed the new value; `unchanged` was a `setIfChanged` to the
   * current value; `failed` stopped in an exit or transition schedule and was
   * queued again; `enterFailed` committed but an enter schedule failed.
   */
  readonly outcome: "applied" | "unchanged" | "failed" | "enterFailed"
}

/** A `restore` of a snapshot; `ok` is `false` when it was rejected. */
export interface RestoreEvent {
  readonly type: "restore"
  readonly frame: number
  readonly tick: number
  readonly ok: boolean
}

/** What `observeHost` delivers. */
export type HostEvent<S extends Schema.Any = Schema.Any, Root = unknown> =
  | {
      readonly type: "tick.start"
      /** The schedule values passed to this `tick(...)` (or `tryTick`) call, in order. */
      readonly schedules: ReadonlyArray<ExecutableScheduleDefinition<S, any, Root, any, any, AnyScheduleOrder>>
      readonly frame: number
    }
  | {
      readonly type: "tick.end"
      readonly schedules: ReadonlyArray<ExecutableScheduleDefinition<S, any, Root, any, any, AnyScheduleOrder>>
      readonly frame: number
      /** `failed`: a system returned `Result.failure`; `defect`: one threw (rethrown after this event). */
      readonly outcome: "ok" | "failed" | "defect"
      readonly error?: unknown
    }
  | { readonly type: "send"; readonly event: string; readonly value: unknown }
  | FailureIgnoredEvent

/**
 * A failed `tick` / `tryTick` result whose `ok` nobody read: the failure
 * went unnoticed, and the systems after the failing one did not run that
 * tick. Found at the start of the next tick (`when: "next-tick"`) or by
 * `checkIgnoredFailures()` (`when: "session-end"`). Debug runtimes only.
 */
export interface FailureIgnoredEvent {
  readonly type: "failure.ignored"
  /** The frame of the failed tick. */
  readonly frame: number
  /** The schedule holding the failing system (the first one for a tick that ran nothing). */
  readonly schedule: string
  /** The failing system; `undefined` when `tryTick` ran nothing (missing requirements, order). */
  readonly system: string | undefined
  readonly error: unknown
  /** The systems of the tick that did not run because of the failure, in order. */
  readonly skipped: ReadonlyArray<string>
  readonly when: "next-tick" | "session-end"
}

/** Everything `observe` delivers. */
export type TraceEvent =
  | FrameEvent
  | ScheduleStartEvent
  | ScheduleEndEvent
  | SystemEvent
  | SystemSkippedEvent
  | SentEvent
  | DeferredEvent
  | TransitionEvent
  | RestoreEvent
  | FailureIgnoredEvent

/**
 * The `debug` runtime option: `{ hostClock }` attaches a handle, timing
 * traces with that clock. A value that may be `undefined`
 * (`import.meta.env.DEV ? { hostClock } : undefined`) attaches it when
 * present and types `debug` as optional, so code checks it before use.
 */
export interface Option {
  /** Times trace events (`ms`); see `HostClock`. */
  readonly hostClock: HostClock
}

/**
 * The member a runtime made with `debug: { hostClock }` carries.
 */
export interface Member<S extends Schema.Any, Root> {
  readonly debug: Handle<S, Root>
}
