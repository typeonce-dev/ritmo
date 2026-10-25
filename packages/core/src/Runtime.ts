/**
 * Runtime creation, world storage, and schedule execution.
 *
 * The runtime is the concrete owner of the ECS world. It holds entities,
 * resources, relation graphs, machines, event buffers, lifecycle
 * buffers, and the host-provided services declared by systems.
 *
 * This module is where the library's explicit execution model becomes real:
 *
 * - systems never run without a runtime
 * - schedules are the only way world visibility advances
 * - service injection stays separate from world storage
 * - construction-time validation remains visible through result-returning APIs
 *
 * Reach for this module when wiring the final game object that a browser loop,
 * server process, test, or custom engine adapter will actually execute.
 *
 * @example
 * ```ts
 * declare const audioHost: { play: (sound: string) => void }
 * // ---cut---
 * // Provide the host capabilities systems declared as services. Simulation
 * // time comes from `Clock` and randomness from the `Random` resource,
 * // never from a service.
 * const services = Game.Runtime.services(
 *   Game.Runtime.service(Audio, { play: (sound) => audioHost.play(sound) }),
 *   Game.Runtime.service(Logger, { log: (message) => console.log(message) })
 * )
 *
 * // make always returns a Result. Score is a constructed resource, so
 * // validating it can fail and the Result must be checked.
 * const runtime = Game.Runtime.make({
 *   services,
 *   resources: { Time: Clock.start(step), Score: 0 },
 *   machines: Game.Runtime.machines(
 *     Game.Runtime.machine(GameFlow, { _tag: "Menu" })
 *   )
 * })
 *
 * if (!runtime.ok) {
 *   throw new Error("Invalid runtime bootstrap data")
 * }
 *
 * // The runtime owns the world and executes explicit schedules.
 * runtime.value.tick(setup)
 * runtime.value.tick(update)
 * ```
 *
 * @module Runtime
 * @docGroup runtime
 *
 * @groupDescription Interfaces
 * Public runtime and runtime-view contracts that expose explicit execution boundaries.
 *
 * @groupDescription Type Aliases
 * Shared runtime initialization, service, machine, and validation helper types.
 *
 * @groupDescription Functions
 * Public runtime constructors and helpers for services, machines, and bootstrap input.
 */
import * as HostClockModule from "./HostClock.ts"
import * as Checkpoint from "./Checkpoint.ts"
import * as CheckpointInternal from "./internal/checkpoint.ts"
import * as RewindableInternal from "./internal/rewindable.ts"
import * as Checksum from "./internal/checksum.ts"
import * as Command from "./Command.ts"
import * as Debug from "./Debug.ts"
import * as DescriptorModule from "./Descriptor.ts"
import type { Descriptor } from "./Descriptor.ts"
import type * as Entity from "./Entity.ts"
import type * as Inspector from "./Inspector.ts"
import * as Cells from "./internal/cells.ts"
import { sameValue } from "./internal/equal.ts"
import { construction, constructionOf } from "./internal/schema.ts"
import type { Construction } from "./internal/schema.ts"
import { emptyStates, stateCodec } from "./internal/states.ts"
import * as DebugInternal from "./internal/debug.ts"
import { makeQueryEngine } from "./internal/queries.ts"
import type { Reverts as QueryReverts } from "./internal/queries.ts"
import { requirementIndex } from "./internal/requirements.ts"
import * as Streams from "./internal/streams.ts"
import { ABSENT, makeWorld } from "./internal/world.ts"
import type { WorldHooks, WorldMark, WorldRewind } from "./internal/world.ts"
import type * as Machine from "./Machine.ts"
import * as Query from "./Query.ts"
import type { QueryMatch, ReadonlyValue } from "./Query.ts"
import * as Relation from "./Relation.ts"
import * as RelationErrors from "./internal/relations.ts"
import type * as Requirement from "./Requirement.ts"
import * as Result from "./Result.ts"
import * as Schedule from "./Schedule.ts"
import * as OrderInternal from "./internal/order.ts"
import * as EntityScopeModule from "./EntityScope.ts"
import * as Snapshot from "./Snapshot.ts"
import type { AnyScheduleOrder, ExecutableScheduleDefinition } from "./Schedule.ts"
import type { Registry, Schema } from "./Schema.ts"
import type {
  DespawnedReadView,
  EventReadView,
  ResourceChangedView,
  EventWriteView,
  LookupApi,
  QueryIteration,
  QueryLookups,
  RelationFailureReadView,
  DroppedRelationReadView,
  RemovedReadView,
  TransitionEventReadView,
  MachineReadView,
  MachineUpdateView,
  NextMachineWriteView,
  SystemContext,
  SystemDefinition,
  SystemFailure,
  TransitionReadView
} from "./System.ts"

/**
 * Runtime provisioning and schedule execution.
 *
 * `Runtime` owns ECS state and host-provided services, but not the outer game
 * loop. Host code decides when to call `tick(...)`.
 *
 * The runtime keeps dynamic behavior explicit:
 *
 * - schedule requirements are checked at the call boundary
 * - deferred changes advance only at explicit schedule markers
 * - typed lookup failures stay value-level instead of throwing
 *
 * @example
 * ```ts
 * const runtime = Game.Runtime.make({
 *   services: Game.Runtime.services(
 *     Game.Runtime.service(Logger, { log: console.log })
 *   ),
 *   resources: { Time: Clock.start(step) }
 * })
 *
 * if (runtime.ok) runtime.value.tick(update)
 * ```
 */

/**
 * String-literal type id used to brand descriptor-based runtime service maps.
 */
export type RuntimeServicesTypeId = "~ritmo/RuntimeServices"

/**
 * Runtime value for the service-map type id.
 */
const runtimeServicesTypeId: RuntimeServicesTypeId = "~ritmo/RuntimeServices"

/**
 * String-literal type id used to brand machine initialization maps.
 */
export type RuntimeMachinesTypeId = "~ritmo/RuntimeMachines"

/**
 * Runtime value for the machine-map type id.
 */
const runtimeMachinesTypeId: RuntimeMachinesTypeId = "~ritmo/RuntimeMachines"
const runtimeMachinesEntries = Symbol("RuntimeMachinesEntries")

/**
 * Initial resource values accepted by `Game.Runtime.make(...)`, keyed by
 * schema key. Resources owned by a constructed descriptor take the raw input
 * of their constructor and are validated when the runtime is made.
 */
export type RuntimeResources<S extends Schema.Any> = Partial<{
  readonly [K in keyof Schema.Resources<S>]:
    Schema.Resources<S>[K] extends DescriptorModule.ConstructedDescriptor<"resource", string, any, infer Raw, any>
      ? Raw
      : Schema.ResourceValue<S, K>
}>

/**
 * Rejects keys of `Provided` that are not resource keys of the schema, naming
 * each one. A misspelled key next to known ones would otherwise compile and
 * be dropped.
 */
export type ExactResources<S extends Schema.Any, Provided> = {
  readonly [K in Exclude<keyof Provided, keyof Schema.Resources<S>>]: {
    readonly __fixResources__: `${K & string} is not a resource key of this schema: use a key of the fragment's resources: { ... }`
  }
}

type ConstructedKeys<S extends Schema.Any, Provided> = {
  readonly [K in keyof Provided]: K extends keyof Schema.Resources<S>
    ? Schema.Resources<S>[K] extends DescriptorModule.ConstructedDescriptor<"resource", string, any, any, any> ? K : never
    : never
}[keyof Provided]

/**
 * The provided resources after validation, carried by the runtime type for
 * requirement checks.
 */
export type ProvidedResources<S extends Schema.Any, Provided> = Simplify<{
  readonly [K in keyof Provided]: K extends keyof Schema.Resources<S> ? Schema.ResourceValue<S, K> : never
}>

/**
 * Validation failures for constructed resources, keyed by schema key.
 */
export type RuntimeConstructionError<S extends Schema.Any, Provided> = Simplify<{
  readonly resources: Partial<{
    readonly [K in ConstructedKeys<S, Provided>]:
      Schema.Resources<S>[K & keyof Schema.Resources<S>] extends DescriptorModule.ConstructedDescriptor<"resource", string, any, any, infer Error>
        ? Error
        : never
  }>
}>

/**
 * A runtime plus the `debug` handle when it was made with `debug: { hostClock }`
 * (optional when the option may be `undefined`).
 */
export type WithDebug<R, Enabled, S extends Schema.Any, Root> =
  [Enabled] extends [undefined] ? R
  : [Enabled] extends [Debug.Option] ? R & Debug.Member<S, Root>
  : R & Partial<Debug.Member<S, Root>>

/**
 * What `make` returns: always a `Result`. It is a `Success` when nothing
 * provided can fail, so `.value` is the runtime; when a provided resource
 * goes through a constructor, it may be a `Failure` and must be checked.
 */
export type MakeRuntimeResult<
  S extends Schema.Any,
  Services extends Record<string, unknown>,
  Provided,
  Root,
  Machines extends Record<string, unknown>,
  Enabled = undefined
> = [ConstructedKeys<S, Provided>] extends [never]
  ? Result.Success<WithDebug<Runtime<S, Services, ProvidedResources<S, Provided>, Root, Machines>, Enabled, S, Root>>
  : Result.Result<
      WithDebug<Runtime<S, Services, ProvidedResources<S, Provided>, Root, Machines>, Enabled, S, Root>,
      RuntimeConstructionError<S, Provided>
    >

/** The state name of a machine value; `undefined` for a sub-state without one. */
const stateOf = (value: unknown): string | undefined => (value as { readonly _tag: string } | undefined)?._tag

/**
 * One machine-backed runtime state provision.
 */
export interface MachineProvision<M extends Machine.StateMachine.Any = Machine.StateMachine.Any> {
  readonly machine: M
  readonly initial: ReadonlyValue<Machine.StateOf<M>>
}

/**
 * Folds a tuple of machine provisions into the normalized runtime machine map.
 */
type MachineEntriesToRecord<
  Entries extends ReadonlyArray<MachineProvision>,
  Acc extends Record<string, unknown> = {}
> = Entries extends readonly [infer Head, ...infer Tail]
  ? Head extends MachineProvision<infer M>
    ? Tail extends ReadonlyArray<MachineProvision>
      ? MachineEntriesToRecord<Tail, Simplify<Omit<Acc, M["name"]> & {
          readonly [K in M["name"]]: Machine.StateOf<M>
        }>>
      : never
    : never
  : Simplify<Acc>

/**
 * Branded machine initialization environment produced by `Runtime.machines(...)`.
 */
export type RuntimeMachines<Machines extends Record<string, unknown> = {}> = Readonly<Machines> & {
  readonly [runtimeMachinesTypeId]: {
    readonly _Machines: (_: never) => Machines
  }
  readonly [runtimeMachinesEntries]: ReadonlyArray<MachineProvision>
}

/**
 * One descriptor-backed runtime service provision.
 *
 * `Runtime.service(...)` creates these entries with contextual typing for the
 * implementation object, so callback parameters are inferred from the service
 * descriptor instead of requiring repeated annotations at the call site.
 */
export interface ServiceProvision<D extends Descriptor<"service", string, any> = Descriptor<"service", string, any>> {
  readonly descriptor: D
  readonly implementation: Descriptor.Value<D>
}

/**
 * Folds a tuple of service entries into the normalized runtime service record.
 *
 * Later entries for the same descriptor name replace earlier ones, matching
 * normal object assignment semantics at runtime.
 */
type ServiceEntriesToRecord<
  Entries extends ReadonlyArray<ServiceProvision>,
  Acc extends Record<string, unknown> = {}
> = Entries extends readonly [infer Head, ...infer Tail]
  ? Head extends ServiceProvision<infer D>
    ? Tail extends ReadonlyArray<ServiceProvision>
      ? ServiceEntriesToRecord<Tail, Simplify<Omit<Acc, Descriptor.Name<D>> & {
          readonly [K in Descriptor.Name<D>]: Descriptor.Value<D>
        }>>
      : never
    : never
  : Simplify<Acc>

/**
 * Branded service environment produced by `Runtime.services(...)`.
 *
 * The brand ensures callers provide services through descriptors rather than
 * raw string keys, which prevents runtime mismatches between descriptor names
 * and manually repeated object properties.
 *
 * To pass services through your own function (one `makeRuntime` shared by
 * the host, the tests, and the lint target), bound its parameter by
 * `RuntimeServices`, never `RuntimeServices<any>`: every service set
 * satisfies the bound, `const` keeps the exact one, and a system that needs
 * a service the caller did not provide still fails to compile at `tick`.
 *
 * @example
 * ```ts
 * import type { RuntimeServices } from "@typeonce/ritmo/Runtime"
 *
 * export const makeRuntime = <const Services extends RuntimeServices>(services: Services) =>
 *   Game.Runtime.make({ services, resources: { Score: 0 } })
 *
 * const Input = Descriptor.Service<Keyboard.Actions<typeof bindings>>()("Game/Input")
 * makeRuntime(Game.Runtime.services(Game.Runtime.service(Input, Keyboard.scripted(bindings, []))))
 * ```
 */
export type RuntimeServices<Services extends Record<string, unknown> = {}> = Readonly<Services> & {
  readonly [runtimeServicesTypeId]: {
    readonly _Services: (_: never) => Services
  }
}

type RuntimeServicesOf<Provided extends RuntimeServices<any>> =
  [Provided] extends [RuntimeServices<infer Services>] ? Services : never

type RuntimeMachinesOf<Provided extends RuntimeMachines<any>> =
  [Provided] extends [RuntimeMachines<infer Machines>] ? Machines : {}

/**
 * Flattens an inferred object type for clearer diagnostics.
 */
type Simplify<A> = {
  readonly [K in keyof A]: A[K]
}

type RegistryKeysForDescriptor<
  Values extends Registry,
  D extends Descriptor.Any
> = {
  readonly [K in keyof Values]:
    [Values[K]] extends [D]
      ? [D] extends [Values[K]] ? K : never
      : never
}[keyof Values]

type ProvisionedDescriptorValue<
  Values extends Registry,
  Provided extends object,
  D extends Descriptor.Any
> = Provided[Extract<RegistryKeysForDescriptor<Values, D>, keyof Provided>]

type DescriptorProvisionError<
  Kind extends string,
  Values extends Registry,
  Provided extends object,
  D extends Descriptor.Any
> = [Extract<RegistryKeysForDescriptor<Values, D>, keyof Provided>] extends [never]
  ? {
      readonly __runtimeRequirementError__: `Missing ${Kind}`
      readonly __requirement__: Descriptor.Name<D>
    }
  : [ProvisionedDescriptorValue<Values, Provided, D>] extends [Descriptor.Value<D>]
    ? never
    : {
        readonly __runtimeRequirementError__: `Incompatible ${Kind}`
        readonly __requirement__: Descriptor.Name<D>
      }

type RequirementErrorFor<
  Need extends Requirement.Requirement,
  S extends Schema.Any,
  Services extends Record<string, unknown>,
  Resources extends object,
  Machines extends object
> = Need extends Descriptor<"service", infer Name, infer Value>
  ? Name extends keyof Services
    ? [Services[Name]] extends [Value] ? never : {
        readonly __runtimeRequirementError__: "Incompatible service"
        readonly __requirement__: Name
      }
    : {
        readonly __runtimeRequirementError__: "Missing service"
        readonly __requirement__: Name
      }
  : Need extends Descriptor<"resource", string, any>
    ? DescriptorProvisionError<"resource", Schema.Resources<S>, Resources, Need>
  : Need extends Machine.StateMachineDefinition<infer Name, infer States, any>
    ? Name extends keyof Machines
      ? [Machines[Name]] extends [DescriptorModule.StateValueOf<States, keyof States & string>] ? never : {
          readonly __runtimeRequirementError__: "Incompatible machine"
          readonly __requirement__: Name
        }
      : {
          readonly __runtimeRequirementError__: "Missing machine"
          readonly __requirement__: Name
        }
  : never

type RequirementErrorsFor<
  Needs extends Requirement.Requirement,
  S extends Schema.Any,
  Services extends Record<string, unknown>,
  Resources extends object,
  Machines extends object
> = Needs extends Requirement.Requirement
  ? RequirementErrorFor<Needs, S, Services, Resources, Machines>
  : never

type RequirementErrorsOfSchedule<
  Selected extends ExecutableScheduleDefinition<any, any, any, any, any, AnyScheduleOrder>,
  Services extends Record<string, unknown>,
  Resources extends object,
  Machines extends object
> = Selected extends ExecutableScheduleDefinition<infer S, any, any, any, any, AnyScheduleOrder>
  ? RequirementErrorsFor<Requirement.Of<Selected>, S, Services, Resources, Machines>
  : never

/**
 * The check `runtime.tick(...)` applies to its schedules, for a package that
 * takes a schedule to run on a runtime (`Netcode.rollback`'s `simulate`):
 * `unknown` when the runtime provides every service, resource, and machine
 * the schedules need; otherwise a `__fixRuntimeRequirements__` member naming
 * each missing one, so the call does not compile.
 */
export type ValidateScheduleArray<
  Schedules extends ReadonlyArray<ExecutableScheduleDefinition<any, any, any, any, any, AnyScheduleOrder>>,
  Services extends Record<string, unknown>,
  Resources extends object,
  Machines extends object
> = [RequirementErrorsOfSchedule<Schedules[number], Services, Resources, Machines>] extends [never]
  ? unknown
  : {
      readonly __fixRuntimeRequirements__: RequirementErrorsOfSchedule<Schedules[number], Services, Resources, Machines>
    }

type ValidateScheduleArgs<
  Schedules extends ReadonlyArray<ExecutableScheduleDefinition<any, any, any, any, any, AnyScheduleOrder>>,
  Services extends Record<string, unknown>,
  Resources extends object,
  Machines extends object
> = [RequirementErrorsOfSchedule<NoInfer<Schedules[number]>, Services, Resources, Machines>] extends [never]
  ? [Schedule.TickOrderErrors<NoInfer<Schedules>>] extends [never]
    ? Schedules
    : Schedules & {
        /** `Game.System.thisTick` reads whose writers do not all run earlier in this call. */
        readonly __fixTickOrder__: Schedule.TickOrderErrors<NoInfer<Schedules>>
      }
  : Schedules & {
      readonly __fixRuntimeRequirements__: RequirementErrorsOfSchedule<NoInfer<Schedules[number]>, Services, Resources, Machines>
    }

type ValidateSchedule<
  Schedule extends ExecutableScheduleDefinition<any, any, any, any, any, AnyScheduleOrder>,
  Services extends Record<string, unknown>,
  Resources extends object,
  Machines extends object
> = [RequirementErrorsOfSchedule<Schedule, Services, Resources, Machines>] extends [never]
  ? unknown
  : {
      readonly __fixRuntimeRequirements__: RequirementErrorsOfSchedule<Schedule, Services, Resources, Machines>
    }

type RequirementErrorsOfInspector<
  Selected extends Inspector.Inspector.Any,
  Services extends Record<string, unknown>,
  Resources extends object,
  Machines extends object
> = Selected extends Inspector.InspectorDefinition<infer Spec, any, any, any, infer Needs>
  ? RequirementErrorsFor<Needs, Spec["schema"], Services, Resources, Machines>
  : never

/**
 * Resolves to `unknown` when the runtime provides every resource, service,
 * and machine the inspector reads, otherwise to an object naming each
 * missing or incompatible one. `runtime.inspect(...)` uses it; tools that
 * run inspectors on a runtime they receive (devtools invariants) reuse it.
 */
export type ValidateInspector<
  Selected extends Inspector.Inspector.Any,
  Services extends Record<string, unknown>,
  Resources extends object,
  Machines extends object
> = [RequirementErrorsOfInspector<Selected, Services, Resources, Machines>] extends [never]
  ? unknown
  : {
      readonly __fixRuntimeRequirements__: RequirementErrorsOfInspector<Selected, Services, Resources, Machines>
    }

/** One runtime requirement that is not currently provisioned. */
export interface MissingRuntimeRequirement {
  readonly kind: Requirement.RequirementValue["kind"]
  readonly name: string
}

/**
 * Returned by `tryTick` when a `Game.System.thisTick` read has a writer that
 * runs after it in the schedule. Nothing ran.
 */
export interface TickOrderViolation {
  readonly kind: "TickOrderViolation"
  readonly issues: ReadonlyArray<Schedule.OrderIssue>
}

/** Explicit failure returned by the dynamic schedule execution path. */
export interface MissingRuntimeRequirements {
  readonly kind: "MissingRuntimeRequirements"
  readonly requirements: ReadonlyArray<MissingRuntimeRequirement>
}

/**
 * The caller-facing initialization shape for one descriptor registry.
 *
 * Initialization is keyed by schema property names, not descriptor names. This
 * is the same key space exposed by `Schema.Resources<S>`.
 */
type InitialRegistryValues<R extends Registry> = Partial<{
  readonly [K in keyof R]: Descriptor.Value<R[K]>
}>

/**
 * Seeds a descriptor-keyed runtime store from one schema registry.
 *
 * The public initialization API is keyed by schema property names, while the
 * runtime store is keyed by descriptor symbols. This helper is the only place
 * that converts between the two, so descriptor names can never drift into the
 * seeding path.
 */
const seedRegistryStore = <R extends Registry>(
  registry: R,
  initialValues: InitialRegistryValues<R> | undefined,
  target: Map<symbol, unknown>
): void => {
  if (!initialValues) {
    return
  }

  for (const [schemaKey, descriptor] of Object.entries(registry) as Array<[keyof R, R[keyof R]]>) {
    const initial = initialValues[schemaKey]
    if (initial !== undefined) {
      target.set(descriptor.key, initial)
    }
  }
}

const collectConstructedRegistryValues = <R extends Registry>(
  registry: R,
  provided: Partial<{ readonly [K in keyof R]: unknown }> | undefined
): Result.Result<InitialRegistryValues<R>, Partial<{ readonly [K in keyof R]: unknown }>> => {
  if (!provided) {
    return Result.success({})
  }

  const validated = {} as Partial<Record<keyof R, unknown>>
  const errors = {} as Partial<Record<keyof R, unknown>>

  for (const [schemaKey, descriptor] of Object.entries(registry) as Array<[keyof R, R[keyof R]]>) {
    const next = provided[schemaKey]
    if (next === undefined) {
      continue
    }

    const constructor = constructionOf(descriptor)
    if (!constructor) {
      validated[schemaKey] = next
      continue
    }

    const result = constructor.decode(next)
    if (!result.ok) {
      errors[schemaKey] = result.error
      continue
    }

    validated[schemaKey] = result.value
  }

  if (Object.keys(errors).length > 0) {
    return Result.failure(errors as Partial<{ readonly [K in keyof R]: unknown }>)
  }

  return Result.success(validated as InitialRegistryValues<R>)
}

/**
 * A loop-agnostic execution runtime.
 *
 * The runtime owns world state and services, but not the outer game loop:
 * call `tick(...)` from whatever host drives the game.
 */
export interface Runtime<
  S extends Schema.Any,
  Services extends Record<string, unknown>,
  Resources extends object = {},
  Root = unknown,
  Machines extends Record<string, unknown> = {}
> {
  /**
   * The closed schema this runtime was built for.
   */
  readonly schema: S
  /**
   * The host-provided service environment.
   */
  readonly services: Services
  /**
   * The validated resources provided when the runtime was made.
   */
  readonly resourceValues: Resources
  /**
   * The machine values provided when the runtime was made.
   */
  readonly machineValues: Machines
  /**
   * Hidden schema-root brand used by schema-bound APIs.
   */
  readonly __schemaRoot?: Root | undefined
  /**
   * Runs schedules in order.
   *
   * Every resource, service, and machine the schedules need must have been
   * provided when the runtime was made; missing ones are compile errors.
   *
   * Deferred commands and machine transitions are applied only at explicit
   * `applyDeferred()` / `applyStateTransitions(...)` steps. Nothing is flushed
   * when a schedule ends: queued work stays queued, across schedules and
   * ticks, until a later marker applies it. Reads need no marker: change
   * detection, events, transition events, and relation failures are per
   * system, each run seeing what was published since its previous run.
   * Changes are visible to `added`/`changed` filters until a reader runs;
   * removed/despawned records, events, transition events, and relation
   * failures are kept until every system that reads them has run.
   *
   * The first expected system failure stops the tick and is returned; that
   * system's ECS writes are rolled back and earlier systems stay committed.
   */
  readonly tick: {
    <const Schedules extends ReadonlyArray<ExecutableScheduleDefinition<S, any, Root, any, any, AnyScheduleOrder>>>(
      ...schedules: ValidateScheduleArgs<Schedules, Services, Resources, Machines>
    ): Result.Result<void, Schedule.FailureOf<Schedules[number]>>
  }
  /**
   * Runs a schedule whose exact requirements are not statically known: for
   * tools that hold schedules with erased types, such as devtools sessions.
   * Games use `tick(...)`, which rejects missing requirements at compile time.
   *
   * Requirements are checked against current provisioning first and missing
   * ones are returned as data, then `Game.System.thisTick` reads are checked
   * against the schedule's order (`TickOrderViolation`).
   */
  readonly tryTick: <const Selected extends ExecutableScheduleDefinition<S, any, any, any, any, AnyScheduleOrder>>(
    schedule: Selected
  ) => Result.Result<void, MissingRuntimeRequirements | TickOrderViolation | Schedule.FailureOf<Selected>>
  /**
   * Captures the world as plain data: entities with their ids, components,
   * relation edges, resources, and committed machine values, each in its
   * schema's saved form (encoded by the schema's `"~encode"` when it has one).
   * Fails with the value a `"~encode"` rejected.
   *
   * Values without a `"~encode"` are shared with the world, not copied;
   * serialize the snapshot (for example with `JSON.stringify`) to detach it.
   * Transient components and resources are skipped.
   *
   * Callable only when every component and resource is constructed or
   * transient; see the `Snapshot` module. Take it between ticks: calling it
   * while a schedule is running (from a system, a service, or a trace
   * callback) throws.
   */
  readonly snapshot: Snapshot.Gate<S, () => Result.Result<Snapshot.WorldSnapshot, Snapshot.SnapshotError>>
  /**
   * A fingerprint of what `snapshot()` saves, as 16 hex digits: equal worlds
   * give equal checksums, on every device and however they were built (the
   * order components were added or object keys written does not count).
   * For spotting desyncs: peers of a rollback or lockstep game compare the
   * checksums of confirmed ticks, and a replay compares them with the ones
   * it recorded. Like `snapshot`, it skips transient components and
   * resources, fails with the value a `"~encode"` rejected, is callable only
   * when every component and resource is constructed or transient, and
   * throws while a schedule is running.
   */
  readonly checksum: Snapshot.Gate<S, () => Result.Result<string, Snapshot.SnapshotError>>
  /**
   * Replaces the world with a snapshot after validating it against the
   * schema. On failure nothing changes. See the `Snapshot` module. Restore
   * between ticks: calling it while a schedule is running throws. A current
   * resource the save lacks keeps its value. Every checkpoint taken before
   * it is released (`rewind` fails with `Released`).
   */
  readonly restore: Snapshot.Gate<S, (data: unknown) => Result.Result<void, Snapshot.RestoreError>>
  /**
   * Marks the world now, between ticks, so `rewind` can put it back exactly:
   * for rollback and client prediction, not for saving (use `snapshot`).
   * `schedule` is the one that will be ticked again after a rewind: its
   * systems' read positions rewind with the world, and every other reader
   * sees the rewind as changes. It must use only input sources and plain
   * data as services, and keep no `local` state; anything else does not
   * compile, naming the fix. See the `Checkpoint` module.
   *
   * Calling it while a schedule is running throws.
   */
  readonly checkpoint: <const Selected extends ExecutableScheduleDefinition<S, any, Root, any, any, AnyScheduleOrder>>(
    schedule: Selected & Checkpoint.ValidateRewindable<Selected>
  ) => Checkpoint.Checkpoint<Root>
  /**
   * Puts the world back to `checkpoint`, exactly as it was when it was
   * taken, and restores every `Checkpoint.rewindable` service to its save
   * then. Checkpoints taken after it are released; it stays usable. Fails,
   * changing nothing, with a rewindable service whose `restore` failed
   * (`RestoreFailed`, typed by that `restore`), a checkpoint of another runtime or one the
   * runtime released. Calling it while a schedule is running throws. See
   * the `Checkpoint` module.
   */
  readonly rewind: (checkpoint: Checkpoint.Checkpoint<Root>) => Result.Result<void, Checkpoint.RewindError<Checkpoint.RestoreFailures<Services>>>
  /**
   * Evaluates one read-only projection without running a schedule. Like a
   * system, the inspector sees `added`/`changed` matches, removed and
   * despawned records, and events published since its own previous
   * evaluation, once.
   *
   * Inspect between ticks: calling it while a schedule is running throws
   * (read the world from a system instead). Return plain data: query matches
   * are valid during the read only, so a match in the result throws when used.
   */
  readonly inspect: {
    <const Selected extends Inspector.InspectorDefinition<any, any, Root, any, any>>(
      inspector: Selected & ValidateInspector<Selected, Services, Resources, Machines>
    ): Inspector.Inspector.Value<Selected>
  }
  /**
   * Publishes one event from outside any system: the host's way in (a menu
   * request, a network message, a test's scripted input). It is published at
   * once, stamped with a fresh tick, so every reader sees it on its next run
   * whichever schedule it belongs to, once, like an event a system emitted.
   * A reader that has not run yet sees it on its first run, however many
   * ticks of other schedules come first (up to `Runtime.streamCapacity`
   * entries), so a request sent before the first fixed step is not lost.
   * The event must belong to the schema. Calling it while a schedule is
   * running is a defect and throws: inside a tick, emit from a system.
   */
  readonly send: <D extends Schema.EventDescriptor<S>>(descriptor: D, value: ReadonlyValue<Descriptor.Value<D>>) => void
}

/**
 * Most entries one event, transition-event, relation-failure,
 * dropped-relation, removed, or despawned stream keeps for readers that have not run yet. Past it the
 * oldest entries are dropped, and readers that missed them see
 * `lagged() === true` (or a `missed` read in the debug trace).
 */
export const streamCapacity = 65_536

/**
 * Brings a parsed save to `migrations.latest`: runs every step after its
 * game version, checking the structure after each.
 */
const migrateSave = (save: Snapshot.WorldSnapshot, saves: Snapshot.Migrations | undefined): Result.Result<Snapshot.WorldSnapshot, Snapshot.RestoreError> => {
  const latest = saves?.latest ?? 0
  if (save.gameVersion > latest) return Result.failure({ _tag: "NewerGameVersion", gameVersion: save.gameVersion, latest })
  let current = save
  for (const step of saves?.steps ?? []) {
    if (step.to <= current.gameVersion) continue
    const next = Snapshot.parse({ ...step.migrate(current), gameVersion: step.to })
    if (!next.ok) return next
    current = next.value
  }
  return Result.success(current)
}

const makeValidatedRuntime = <
  S extends Schema.Any,
  Services extends Record<string, unknown>,
  Resources extends object,
  Root,
  Machines extends Record<string, unknown>
>(options: {
  readonly schema: S
  readonly services: RuntimeServices<any>
  readonly resources: Partial<Record<string, unknown>>
  readonly machines: RuntimeMachines<any> | undefined
  readonly machineDefinitions: ReadonlyArray<Machine.StateMachine.Any>
  readonly scopeDefinitions: ReadonlyArray<EntityScopeModule.EntityScope.Any>
  readonly debug: Debug.Option | undefined
  readonly saves: Snapshot.Migrations | undefined
  readonly checkpoints: number
}): Runtime<S, Services, Resources, Root, Machines> => {
  const world = makeWorld(options.schema, streamCapacity)
  const queries = makeQueryEngine(world)

  /**
   * Descriptor-keyed world resource and state storage.
   */
  const resources = new Map<symbol, unknown>()
  seedRegistryStore(options.schema.resources, options.resources as InitialRegistryValues<Registry>, resources)

  /**
   * Machine-keyed committed, pending, and previous values.
   */
  const currentMachines = new Map<symbol, unknown>()
  /** Queued next values; with `debug`, `by` is the system that queued it, for the `next-state-replaced` lint. */
  const pendingMachines = new Map<symbol, { value: unknown; skipIfSame: boolean; by?: string }>()
  /** Requests dropped because their sub-state stopped existing: skipped by the marker that queued them. */
  const discardedPending = new WeakSet<object>()
  const previousMachines = new Map<symbol, unknown>()
  /** The shared value of each state without fields, by machine key. */
  const emptyMachineStates = new Map<symbol, ReadonlyMap<string, { readonly _tag: string }>>()
  /** `value`, or the one shared value of its state when that state has no fields. */
  const sharedValue = (machine: Machine.StateMachine.Any, value: unknown): unknown => {
    let empty = emptyMachineStates.get(machine.key)
    if (empty === undefined) {
      empty = emptyStates(machine.states)
      emptyMachineStates.set(machine.key, empty)
    }
    return empty.get(stateOf(value)!) ?? value
  }
  /**
   * Machine keys changed by transitions applied during the current schedule run.
   */
  let changedMachines = new Set<symbol>()
  /**
   * Active transition payloads for schedules running inside a transition phase.
   */
  const activeTransitions = new Map<symbol, Machine.TransitionSnapshot>()

  /**
   * Event, transition-event, relation-failure, and dropped-relation logs. Entries are stamped
   * with the change tick at which they were published; each reader sees the
   * entries published after its previous completed run. Entries are kept for
   * the current and previous frame, and beyond that until every system that
   * reads them has run, up to `streamCapacity` entries per stream. Events the
   * host sent wait for the first reader of their stream to run.
   */
  const events = Streams.make<unknown>(streamCapacity)
  const transitionEvents = Streams.make<Machine.TransitionSnapshot>(streamCapacity)
  const relationFailures = Streams.make<Relation.Relation.MutationFailure<Relation.Relation.Any, S, Root>>(streamCapacity)
  const droppedRelations = Streams.make<Relation.Relation.Dropped<Relation.Relation.Any, S, Root>>(streamCapacity)

  /**
   * Commands queued by systems and not yet applied. They persist across
   * schedule runs until an `applyDeferred()` or `applyStateTransitions(...)`
   * step applies them.
   */
  const pendingCommands: Array<Command.DeferredCommand<S>> = []

  /**
   * Debug state. With `debug`, `pendingOrigins` names the system that
   * queued each pending command, in step with `pendingCommands`. Tracing is
   * on only while `observe` listeners are registered; untraced runs pay one
   * boolean check at each system, schedule, and marker boundary.
   */
  const debugEnabled = options.debug !== undefined
  const pendingOrigins: Array<string> = []
  const traceListeners = new Set<(event: Debug.TraceEvent) => void>()
  let tracing = false
  let frameCount = 0
  /** Names of the schedules being run, outermost first, while tracing. */
  const schedulePath: Array<string> = []
  /** Effects of the command being applied, while tracing. */
  let commandEffects: Array<Debug.Effect> | undefined
  const scheduleNames = new Map<object, string>()
  const anonymousScheduleNames = new WeakMap<object, string>()
  let anonymousScheduleCount = 0
  // Only a debug runtime times anything; the clock is the one it was given.
  const hostClock: HostClockModule.HostClock = options.debug?.hostClock ?? { now: () => 0 }
  const now = (): number => hostClock.now()
  const emit = (event: Debug.TraceEvent): void => {
    for (const listener of traceListeners) listener(event)
  }
  const currentSchedule = (): string => schedulePath.length === 0 ? "(direct)" : schedulePath.join(" > ")
  const scheduleName = (schedule: object): string => {
    const named = scheduleNames.get(schedule) ?? anonymousScheduleNames.get(schedule)
    if (named !== undefined) return named
    anonymousScheduleCount += 1
    const name = `schedule#${anonymousScheduleCount}`
    anonymousScheduleNames.set(schedule, name)
    return name
  }
  interface DebugNames {
    readonly resources: ReadonlyMap<symbol, string>
    readonly events: ReadonlyMap<symbol, string>
    readonly machines: ReadonlyMap<symbol, string>
    readonly relations: ReadonlyMap<symbol, string>
  }
  /** Set once at the end of construction when `debug` is enabled. */
  let debugNames: DebugNames | undefined
  const recordEffect = (effect: Debug.Effect): void => {
    if (commandEffects !== undefined) commandEffects.push(effect)
  }

  const providedServices = options.services as unknown as Services
  const providedMachines = (options.machines ?? machines()) as unknown as Machines
  const machineEntries = (options.machines ?? machines())[runtimeMachinesEntries]
  const machineDefinitionOrder = new Map(
    options.machineDefinitions.map((machine, index) => [machine.key, index] as const)
  )

  /** Machines the runtime was given an initial value for. */
  const providedMachineKeys = new Set<symbol>()
  for (const provision of machineEntries) {
    currentMachines.set(provision.machine.key, sharedValue(provision.machine, provision.initial))
    providedMachineKeys.add(provision.machine.key)
  }

  /**
   * Sub-states by parent machine key, in definition order, and the value
   * each enters whenever its parent enters the state it exists in (its
   * runtime-provided value). A sub-state has no current value while its
   * parent is elsewhere, and never one when the runtime does not provide it.
   */
  const subStates = new Map<symbol, Array<Machine.StateMachine.Any>>()
  const subStateEntry = new Map<symbol, unknown>()
  for (const machine of options.machineDefinitions) {
    if (machine.within === undefined) continue
    const siblings = subStates.get(machine.within.machine.key)
    if (siblings === undefined) subStates.set(machine.within.machine.key, [machine])
    else siblings.push(machine)
    if (!currentMachines.has(machine.key)) continue
    subStateEntry.set(machine.key, currentMachines.get(machine.key))
  }
  // Definition order puts a parent before its sub-states, so a sub-state of
  // an inactive sub-state is cleared too.
  for (const machine of options.machineDefinitions) {
    if (machine.within !== undefined && stateOf(currentMachines.get(machine.within.machine.key)) !== machine.within.state) {
      currentMachines.delete(machine.key)
    }
  }

  /**
   * Scope despawn triggers by machine key, in scope definition order
   * (`Game.EntityScope(name, { despawnOnExit, despawnOnEnter })`).
   */
  const scopeTriggers = new Map<symbol, Array<{ readonly trigger: EntityScopeModule.Trigger; readonly scope: EntityScopeModule.EntityScope.Any }>>()
  for (const scope of options.scopeDefinitions) {
    for (const trigger of scope.despawnOn) {
      const triggers = scopeTriggers.get(trigger.machine.key)
      if (triggers === undefined) scopeTriggers.set(trigger.machine.key, [{ trigger, scope }])
      else triggers.push({ trigger, scope })
    }
  }

  const appendRelationFailure = (
    relation: Relation.Relation.Any,
    operation: Relation.Relation.MutationOperation,
    sourceId: number,
    targetId: number,
    error: Relation.Relation.MutationError
  ): void => {
    if (tracing) {
      recordEffect({ kind: "relationFailure", entity: sourceId, relation: relation.name, error: error._tag })
    }
    relationFailures.append(relation.key, world.currentTick(), [
      RelationErrors.mutationFailure(
        relation,
        operation,
        world.entityIdOf(sourceId) as Entity.EntityId<S, Root>,
        world.entityIdOf(targetId) as Entity.EntityId<S, Root>,
        error
      )
    ])
  }

  // Every edge a target's despawn removes, however the despawn was queued:
  // one record per edge, read by `Game.System.readDroppedRelations`.
  world.setDroppedEdge((sourceId, relation, targetId) => {
    if (tracing) recordEffect({ kind: "relationDropped", entity: sourceId, relation: relation.name, target: targetId })
    droppedRelations.append(relation.key, world.currentTick(), [{
      relation,
      source: world.entityIdOf(sourceId) as Entity.EntityId<S, Root>,
      target: world.entityIdOf(targetId) as Entity.EntityId<S, Root>
    }])
  })

  /**
   * With `debug`, the relations commands have tried to relate or
   * reorder, with the systems that queued those commands, for the
   * `relation-failure-never-read` lint. `commandOrigin` names the system whose
   * command is being applied.
   */
  const relationMutations = new Map<string, Set<string>>()
  let commandOrigin = "(unknown)"
  /**
   * With `debug`, what each system's applied commands did, as
   * `kind:name` (`spawns:Enemy`, `despawns:Enemy` for every component the
   * despawned entity had), and the systems that ran: for the
   * `command-permission-unused` lint.
   */
  const commandUses = new Map<string, Set<string>>()
  const ranSystems = new Set<string>()
  /** With `debug`, the system running now: who queued a next state. */
  let runningSystem = "(host)"
  /** With `debug`, next states one system queued and another replaced before the marker. */
  const nextStateReplacements = new Map<string, Debug.NextStateReplacement>()
  /**
   * With `debug`, the placements (schedule and step) where a system that
   * consumes a service ran, by service: for the observed
   * `service-consumed-twice` lint, which also covers unnamed schedules.
   */
  const consumedAt = new Map<string, Map<object, Map<number, string>>>()
  const consumesOf = new WeakMap<object, ReadonlyArray<string>>()
  const noteConsumed = (system: SystemDefinition<any, any, any>, schedule: object, index: number): void => {
    let names = consumesOf.get(system)
    if (names === undefined) {
      names = Object.values(system.spec.services as Record<string, { readonly descriptor: Descriptor.Any; readonly consumes?: true }>)
        .filter((access) => access.consumes === true)
        .map((access) => access.descriptor.name)
      consumesOf.set(system, names)
    }
    for (const name of names) {
      let bySchedule = consumedAt.get(name)
      if (bySchedule === undefined) {
        bySchedule = new Map()
        consumedAt.set(name, bySchedule)
      }
      let steps = bySchedule.get(schedule)
      if (steps === undefined) {
        steps = new Map()
        bySchedule.set(schedule, steps)
      }
      steps.set(index, system.name)
    }
  }
  const noteCommand = (kind: string, name: string): void => {
    let uses = commandUses.get(commandOrigin)
    if (uses === undefined) {
      uses = new Set()
      commandUses.set(commandOrigin, uses)
    }
    uses.add(`${kind}:${name}`)
  }
  const noteRelationMutation = (relation: Relation.Relation.Any): void => {
    let systems = relationMutations.get(relation.name)
    if (systems === undefined) {
      systems = new Set()
      relationMutations.set(relation.name, systems)
    }
    systems.add(commandOrigin)
  }

  /**
   * `Schema.requires`, checked when commands are applied. Types reject a
   * breaking command when they can see it; this catches the rest: a query
   * proof gone stale within one flush (another system's command applied in
   * between), erased types, and raw ids. A breaking command is skipped
   * whole, traced, and reported by the `requirement-violated` lint.
   */
  const requirements = requirementIndex(options.schema)
  /** With `debug`, skipped commands by system, command, and requirement, for the lint. */
  const requirementViolations = new Map<string, Debug.RequirementViolation>()
  const violateRequirement = (
    command: Debug.RequirementViolation["command"],
    entity: number,
    [component, missing]: readonly [string, string]
  ): void => {
    if (tracing) recordEffect({ kind: "requirementViolated", entity, command, component, missing })
    if (debugEnabled) {
      const key = `${commandOrigin}/${command}/${component}/${missing}`
      const seen = requirementViolations.get(key)
      requirementViolations.set(key, { system: commandOrigin, command, component, missing, entity, count: (seen?.count ?? 0) + 1 })
    }
  }
  const streamLosses = new Map<string, Debug.StreamLoss>()
  const watchStreamLoss = <V extends { all(): unknown; lagged(): boolean }>(view: V, system: string, stream: string, paused: boolean): V => {
    const key = `${system}/${stream}`
    const entry = (): { -readonly [K in keyof Debug.StreamLoss]: Debug.StreamLoss[K] } => {
      let found = streamLosses.get(key)
      if (found === undefined) {
        found = { system, stream, lostRuns: 0, checksLagged: false, paused }
        streamLosses.set(key, found)
      }
      return found as { -readonly [K in keyof Debug.StreamLoss]: Debug.StreamLoss[K] }
    }
    return {
      ...view,
      all: () => {
        const status = entry()
        if (view.lagged()) status.lostRuns += 1
        return view.all()
      },
      lagged: () => {
        entry().checksLagged = true
        return view.lagged()
      }
    }
  }
  const staleTargets = new Map<string, Debug.StaleTarget>()
  const reportStaleTarget = (command: Debug.StaleTarget["command"], entity: number): void => {
    if (tracing) recordEffect({ kind: "staleTarget", entity, command })
    if (debugEnabled) {
      const key = `${commandOrigin}/${command}`
      const seen = staleTargets.get(key)
      staleTargets.set(key, { system: commandOrigin, command, entity, count: (seen?.count ?? 0) + 1 })
    }
  }
  const holds = (id: number) => {
    const record = world.records.get(id)
    return (descriptor: Descriptor<"component", string, any>): boolean =>
      record !== undefined && world.has(record, world.ordinalOf(descriptor))
  }
  /** The first requirement `components` break, as `[requirer, missing]`. */
  const missingIn = (
    components: ReadonlyArray<Entity.StagedComponent>,
    alsoHeld: (descriptor: Descriptor<"component", string, any>) => boolean
  ): readonly [string, string] | undefined => {
    for (const [descriptor] of components) {
      for (const required of requirements.requires.get(descriptor.name) ?? []) {
        if (!alsoHeld(required) && !components.some(([staged]) => staged.name === required.name)) {
          return [descriptor.name, required.name]
        }
      }
    }
    return undefined
  }

  /**
   * World adapter used by deferred commands.
   */
  const commandWorld: Command.InternalWorld<S> = {
    spawnEntity(id, components) {
      if (!requirements.empty) {
        const missing = missingIn(components, () => false)
        if (missing !== undefined) {
          violateRequirement("spawn", id, missing)
          return false
        }
      }
      if (debugEnabled) for (const [descriptor] of components) noteCommand("spawns", descriptor.name)
      world.spawnEntity(id, components)
      return true
    },
    destroyEntity(id) {
      if (debugEnabled) {
        const record = world.records.get(id)
        for (const ordinal of record?.held ?? []) noteCommand("despawns", world.descriptorAt(ordinal).name)
      }
      world.destroyEntity(id)
    },
    assignEntityScope(id, scope) {
      world.assignEntityScope(id, scope.key)
    },
    destroyEntityScope(scope) {
      if (debugEnabled) noteCommand("despawnsScope", scope.name)
      world.destroyEntityScope(scope.key)
    },
    removeComponents(id, descriptors) {
      if (!requirements.empty && world.records.has(id)) {
        const held = holds(id)
        for (const descriptor of descriptors) {
          for (const requirer of requirements.requiredBy.get(descriptor.name) ?? []) {
            if (held(requirer) && !descriptors.some((removed) => removed.name === requirer.name)) {
              violateRequirement("remove", id, [requirer.name, descriptor.name])
              return
            }
          }
        }
      }
      for (const descriptor of descriptors) {
        if (debugEnabled) noteCommand("removes", descriptor.name)
        world.removeComponent(id, descriptor)
      }
    },
    insertComponents(id, entries) {
      if (!requirements.empty && world.records.has(id)) {
        const missing = missingIn(entries, holds(id))
        if (missing !== undefined) {
          violateRequirement("insert", id, missing)
          return
        }
      }
      for (const [descriptor, value] of entries) {
        if (debugEnabled) noteCommand("inserts", descriptor.name)
        world.writeComponent(id, descriptor, value)
      }
    },
    reportStaleTarget(command, id) {
      reportStaleTarget(command, id)
    },
    tryRelate(id, relation, target) {
      if (debugEnabled) {
        noteRelationMutation(relation)
        noteCommand("relates", relation.name)
      }
      const result = world.tryRelate(id, relation, target)
      if (!result.ok) {
        appendRelationFailure(relation, "relate", id, target, result.error)
      }
      return result
    },
    unrelate(id, relation) {
      if (debugEnabled) noteCommand("relates", relation.name)
      world.unrelate(id, relation)
    },
    reorderChildren(id, relation, children) {
      if (debugEnabled) {
        noteRelationMutation(relation)
        noteCommand("relates", relation.name)
      }
      const result = world.reorderChildren(id, relation, children.map((child) => child))
      if (!result.ok) {
        const targetId = result.error._tag === "MissingChildEntity"
          || result.error._tag === "DuplicateChild"
          || result.error._tag === "ChildNotRelatedToParent"
          ? result.error.childId
          : id
        appendRelationFailure(relation, "reorderChildren", id, targetId, result.error)
      }
      return result
    }
  }

  const entityId = (id: number): Entity.EntityId<S, Root> => world.entityIdOf(id) as Entity.EntityId<S, Root>

  /**
   * Change-detection state of one system (or inspector): `since` is the tick
   * of its previous completed run, which `added`/`changed` filters and
   * removed/despawned reads compare against.
   *
   * Stream reads (events, transition events, relation failures) use their own
   * cursor, because a system skipped by its run conditions discards the
   * messages published meanwhile but keeps its change-detection position.
   */
  interface ReaderState extends Streams.Cursor {
    since: number
    lastRun: number
    streamSince: number
    streamLastRun: number
    /** Tick at which the reader first ran; drops before it are not losses. */
    readonly registeredAt: number
    /**
     * What rewinds changed since the reader's previous completed run, when
     * it is not in the schedule they rewound: seen on its next completed
     * run, on top of its change ticks.
     */
    reverts: Reverts | undefined
  }

  /** {@link QueryReverts}, and per component ordinal the removals (and the despawns) a rewind made. */
  interface Reverts extends QueryReverts {
    readonly removed: Map<number, Set<number>>
    readonly despawned: Set<number>
  }

  const resolve = <Q extends Query.Query.Any<Root>>(id: number, query: Q, reader: ReaderState) =>
    queries.get(id, query, reader.since, reader.reverts) as Result.Result<QueryMatch<S, Q>, Query.Query.LookupError>

  const relatedTarget = (
    target: Entity.EntityId<S, Root>,
    relation: Relation.Relation.Any
  ): Result.Result<Entity.EntityId<S, Root>, Relation.Relation.LookupError> => {
    if (!world.records.has(target)) {
      return Result.failure(RelationErrors.missingEntityError(target))
    }
    const targetId = world.relationTarget(relation, target)
    if (targetId === undefined) {
      return Result.failure(RelationErrors.missingRelationError(target, relation.name))
    }
    return Result.success(entityId(targetId))
  }

  const makeLookup = (reader: ReaderState): LookupApi<S, Root> => {
    const lookup: LookupApi<S, Root> = {
    related: relatedTarget,
    relatedSources(target, relation) {
      if (!world.records.has(target)) {
        return Result.failure(RelationErrors.missingEntityError(target))
      }
      return Result.success(world.relatedSourceIds(relation, target).map(entityId))
    },
    parent: relatedTarget,
    ancestors(target, relation) {
      if (!world.records.has(target)) {
        return Result.failure(RelationErrors.missingEntityError(target))
      }
      const ancestors: Array<Entity.EntityId<S, Root>> = []
      let current = world.relationTarget(relation, target)
      while (current !== undefined) {
        ancestors.push(entityId(current))
        current = world.relationTarget(relation, current)
      }
      return Result.success(ancestors)
    },
    descendants(target, relation, options) {
      if (!world.records.has(target)) {
        return Result.failure(RelationErrors.missingEntityError(target))
      }
      const descendants: Array<Entity.EntityId<S, Root>> = []
      if (options?.order === "breadth") {
        const pending = [...world.relatedSourceIds(relation, target)]
        for (let index = 0; index < pending.length; index++) {
          const nextId = pending[index]!
          descendants.push(entityId(nextId))
          pending.push(...world.relatedSourceIds(relation, nextId))
        }
      } else {
        const pending = [...world.relatedSourceIds(relation, target)].reverse()
        while (pending.length > 0) {
          const nextId = pending.pop()!
          descendants.push(entityId(nextId))
          const children = world.relatedSourceIds(relation, nextId)
          for (let index = children.length - 1; index >= 0; index--) {
            pending.push(children[index]!)
          }
        }
      }
      return Result.success(descendants)
    },
    root(target, relation) {
      if (!world.records.has(target)) {
        return Result.failure(RelationErrors.missingEntityError(target))
      }
      let current: number = target
      let parentId = world.relationTarget(relation, current)
      while (parentId !== undefined) {
        current = parentId
        parentId = world.relationTarget(relation, current)
      }
      return Result.success(entityId(current))
    }
  }
    return lookup
  }

  const makeQueryHandle = <Q extends Query.Query.Any<Root>>(query: Q, reader: ReaderState, lookup: LookupApi<S, Root>): QueryIteration<S, Q> & QueryLookups<S, Q> => {
    const each = () => queries.each(query, reader.since, reader.reverts) as ReadonlyArray<QueryMatch<S, Q>>
    const matching = (ids: ReadonlyArray<Entity.EntityId<S, Root>>): Array<QueryMatch<S, Q>> => {
      const matches: Array<QueryMatch<S, Q>> = []
      for (const id of ids) {
        const resolved = resolve(id, query, reader)
        if (resolved.ok) matches.push(resolved.value)
      }
      return matches
    }
    return {
      each,
      get(target) {
        return resolve(target, query, reader)
      },
      getHandle(handle) {
        return resolve(handle as Entity.Handle<Root, any>, query, reader)
      },
      children(target, relation) {
        if (!world.records.has(target)) return Result.failure(RelationErrors.missingEntityError(target))
        return Result.success(matching(world.relatedSourceIds(relation, target).map(entityId)))
      },
      descendants(target, relation, options) {
        const ids = lookup.descendants(target, relation, options)
        return ids.ok ? Result.success(matching(ids.value)) : ids
      },
      single() {
        const matches = each()
        if (matches.length === 0) {
          return Result.failure(Query.noEntitiesError())
        }
        if (matches.length > 1) {
          return Result.failure(Query.multipleEntitiesError(matches.length))
        }
        return Result.success(matches[0]!)
      },
      singleOptional() {
        const matches = each()
        if (matches.length > 1) {
          return Result.failure(Query.multipleEntitiesError(matches.length))
        }
        return Result.success(matches[0])
      }
    }
  }

  /**
   * Journal for the running system's resource, state, event, machine field,
   * and queued machine writes. Component writes are journaled by the world. On an
   * expected failure everything is restored and the system's commands are
   * discarded; on success, buffered events are published at a fresh tick,
   * so every reader (including the emitter's next run) sees them.
   */
  const absentValue = Symbol("ritmo/absent-value")
  const resourceOriginals = new Map<symbol, unknown>()
  const machineOriginals = new Map<symbol, { value: unknown; skipIfSame: boolean } | typeof absentValue>()
  /** Committed machine values before the running system's `update`s. */
  const committedMachineOriginals = new Map<symbol, unknown>()
  const emittedEvents = new Map<symbol, Array<unknown>>()

  /**
   * The open phase, or `undefined`. A transition's exit phase (the exit
   * schedules of the sub-states it ends and of the state it leaves, then its
   * `onTransition` schedules) commits or rolls back as one: when one of its
   * systems fails, the writes, events, queued next states, queued commands,
   * and stream positions of the systems that ran before it are undone too, so
   * the retry at a later marker starts from the same state.
   */
  interface Phase {
    readonly tick: number
    readonly commands: number
    readonly origins: number
    readonly resources: Map<symbol, unknown>
    readonly resourceChangedAt: Map<symbol, number | undefined>
    readonly machines: Map<symbol, { value: unknown; skipIfSame: boolean } | typeof absentValue>
    readonly committedMachines: Map<symbol, unknown>
    readonly readers: Map<ReaderState, readonly [since: number, lastRun: number, streamSince: number, streamLastRun: number, reverts: Reverts | undefined]>
  }
  let phase: Phase | undefined

  /** Keeps a reader's position from before the phase, the first time the phase moves it. */
  const journalReader = (reader: ReaderState): void => {
    if (phase !== undefined && !phase.readers.has(reader)) {
      phase.readers.set(reader, [reader.since, reader.lastRun, reader.streamSince, reader.streamLastRun, reader.reverts])
    }
  }

  const journalStoreWrite = (store: Map<symbol, unknown>, originals: Map<symbol, unknown>) =>
    (key: symbol, value: unknown): void => {
      if (!originals.has(key)) {
        originals.set(key, store.has(key) ? store.get(key) : absentValue)
      }
      store.set(key, value)
    }
  const writeResource = journalStoreWrite(resources, resourceOriginals)
  const writeCommittedMachine = journalStoreWrite(currentMachines, committedMachineOriginals)

  /**
   * Resource change ticks for `changedResource` readers. Only resources some
   * system reads with `changedResource` are compared at commit; a reader's
   * first run reports a change anyway, so writes before it registers are not
   * needed.
   */
  const watchedResources = new Set<symbol>()
  const resourceChangedAt = new Map<symbol, number>()

  const journalMachine = (key: symbol): void => {
    if (!machineOriginals.has(key)) {
      machineOriginals.set(key, pendingMachines.get(key) ?? absentValue)
    }
  }

  const beginSystemTransaction = (): void => {
    world.beginTransaction()
  }

  const commitSystemTransaction = (): void => {
    world.commitTransaction()
    if (phase !== undefined) {
      for (const [key, before] of resourceOriginals) {
        if (!phase.resources.has(key)) phase.resources.set(key, before)
      }
      for (const [key, before] of machineOriginals) {
        if (!phase.machines.has(key)) phase.machines.set(key, before)
      }
      for (const [key, before] of committedMachineOriginals) {
        if (!phase.committedMachines.has(key)) phase.committedMachines.set(key, before)
      }
    }
    if (watchedResources.size > 0) {
      for (const [key, before] of resourceOriginals) {
        if (!watchedResources.has(key)) continue
        if (before === absentValue || !sameValue(before, resources.get(key))) {
          if (phase !== undefined && !phase.resourceChangedAt.has(key)) phase.resourceChangedAt.set(key, resourceChangedAt.get(key))
          resourceChangedAt.set(key, world.currentTick())
        }
      }
    }
    if (emittedEvents.size > 0) {
      const published = world.advanceTick()
      for (const [key, values] of emittedEvents) {
        events.append(key, published, values)
      }
      emittedEvents.clear()
    }
    resourceOriginals.clear()
    machineOriginals.clear()
    // Most systems never update a machine: skip the clear on that path.
    if (committedMachineOriginals.size > 0) committedMachineOriginals.clear()
  }

  const restoreStore = (store: Map<symbol, unknown>, originals: Map<symbol, unknown>): void => {
    for (const [key, value] of originals) {
      if (value === absentValue) {
        store.delete(key)
      } else {
        store.set(key, value)
      }
    }
    originals.clear()
  }

  const rollbackSystemTransaction = (): void => {
    world.rollbackTransaction()
    restoreStore(resources, resourceOriginals)
    for (const [key, value] of machineOriginals) {
      if (value === absentValue) {
        pendingMachines.delete(key)
      } else {
        pendingMachines.set(key, value)
      }
    }
    machineOriginals.clear()
    if (committedMachineOriginals.size > 0) restoreStore(currentMachines, committedMachineOriginals)
    emittedEvents.clear()
  }

  /**
   * Runs `run` as one phase: on failure, or a thrown defect, everything the
   * systems in it committed is undone.
   */
  const runAsPhase = (run: () => Result.Result<void, SystemFailure>): Result.Result<void, SystemFailure> => {
    const opened: Phase = {
      tick: world.currentTick(),
      commands: pendingCommands.length,
      origins: pendingOrigins.length,
      resources: new Map(),
      resourceChangedAt: new Map(),
      machines: new Map(),
      committedMachines: new Map(),
      readers: new Map()
    }
    phase = opened
    world.beginPhase()
    let result: Result.Result<void, SystemFailure> | undefined
    try {
      result = run()
    } finally {
      phase = undefined
      if (result?.ok === true) {
        world.commitPhase()
      } else {
        world.rollbackPhase()
        restoreStore(resources, opened.resources)
        for (const [key, value] of opened.machines) {
          if (value === absentValue) pendingMachines.delete(key)
          else pendingMachines.set(key, value)
        }
        restoreStore(currentMachines, opened.committedMachines)
        for (const [key, tick] of opened.resourceChangedAt) {
          if (tick === undefined) resourceChangedAt.delete(key)
          else resourceChangedAt.set(key, tick)
        }
        for (const [reader, [since, lastRun, streamSince, streamLastRun, reverts]] of opened.readers) {
          reader.since = since
          reader.lastRun = lastRun
          reader.streamSince = streamSince
          reader.streamLastRun = streamLastRun
          reader.reverts = reverts
        }
        events.retract(opened.tick)
        pendingCommands.length = opened.commands
        pendingOrigins.length = opened.origins
      }
    }
    return result
  }

  const makeResourceWriteView = (
    descriptor: Descriptor<"resource", string, any>,
    store: Map<symbol, unknown>,
    write: (key: symbol, value: unknown) => void
  ) => Cells.storeWrite(store, descriptor.key, write, constructionOf(descriptor))

  const makeResourceChangedView = (descriptor: Descriptor<"resource", string, any>, reader: ReaderState): ResourceChangedView<unknown> => {
    const key = descriptor.key
    watchedResources.add(key)
    const read = Cells.storeRead(resources, key)
    return {
      get: () => read.get(),
      // `since` is the previous completed run; 0 before the first one.
      changed: () => reader.since === 0 || (resourceChangedAt.get(key) ?? 0) > reader.since
    }
  }

  const makeEventReadView = <T>(descriptorKey: symbol, reader: ReaderState): EventReadView<T> => ({
    all() {
      return events.since(descriptorKey, reader.streamSince) as ReadonlyArray<ReadonlyValue<T>>
    },
    lagged() {
      return events.lagged(descriptorKey, reader.streamSince, reader.registeredAt)
    }
  })

  const makeEventWriteView = <T>(descriptorKey: symbol): EventWriteView<T> => ({
    emit(value) {
      const queue = emittedEvents.get(descriptorKey)
      if (queue) {
        queue.push(value)
      } else {
        emittedEvents.set(descriptorKey, [value])
      }
    }
  })

  const makeTransitionEventReadView = <M extends Machine.StateMachine.Any>(
    stateMachine: M,
    reader: ReaderState
  ): TransitionEventReadView<M> => ({
    all() {
      return transitionEvents.since(stateMachine.key, reader.streamSince) as unknown as ReadonlyArray<Machine.TransitionSnapshot<M>>
    },
    lagged() {
      return transitionEvents.lagged(stateMachine.key, reader.streamSince, reader.registeredAt)
    }
  })

  const makeRemovedReadView = (descriptor: Descriptor<"component", string, any>, reader: ReaderState): RemovedReadView<S, Root> => {
    const ordinal = world.ordinalOf(descriptor)
    return {
      all() {
        const logged = world.removedSince(ordinal, reader.since)
        const reverted = reader.reverts?.removed.get(ordinal)
        if (reverted === undefined) return logged.map(entityId)
        // A rewind's removals count only for what is still without the component.
        const ids = [...logged]
        const seen = new Set(logged)
        for (const id of [...reverted].sort((left, right) => left - right)) {
          const record = world.records.get(id)
          if (seen.has(id) || (record !== undefined && world.has(record, ordinal))) continue
          seen.add(id)
          ids.push(id)
        }
        return ids.map(entityId)
      },
      lagged() {
        return world.removedLagged(ordinal, reader.since, reader.registeredAt)
      }
    }
  }

  const makeDespawnedReadView = (reader: ReaderState): DespawnedReadView<S, Root> => ({
    all() {
      const logged = world.despawnedSince(reader.since)
      const reverted = reader.reverts?.despawned
      if (reverted === undefined) return logged.map(entityId)
      // A rewind's despawns count only for entities that are still gone.
      const ids = [...logged]
      const seen = new Set(logged)
      for (const id of [...reverted].sort((left, right) => left - right)) {
        if (seen.has(id) || world.records.has(id)) continue
        seen.add(id)
        ids.push(id)
      }
      return ids.map(entityId)
    },
    lagged() {
      return world.despawnedLagged(reader.since, reader.registeredAt)
    }
  })

  const makeRelationFailureReadView = <R extends Relation.Relation.Any>(
    relation: R,
    reader: ReaderState
  ): RelationFailureReadView<R, S, Root> => ({
    all() {
      return relationFailures.since(relation.key, reader.streamSince) as unknown as ReadonlyArray<Relation.Relation.MutationFailure<R, S, Root>>
    },
    lagged() {
      return relationFailures.lagged(relation.key, reader.streamSince, reader.registeredAt)
    }
  })

  const makeDroppedRelationReadView = <R extends Relation.Relation.Any>(
    relation: R,
    reader: ReaderState
  ): DroppedRelationReadView<R, S, Root> => ({
    all() {
      return droppedRelations.since(relation.key, reader.streamSince) as unknown as ReadonlyArray<Relation.Relation.Dropped<R, S, Root>>
    },
    lagged() {
      return droppedRelations.lagged(relation.key, reader.streamSince, reader.registeredAt)
    }
  })

  const makeMachineReadView = <M extends Machine.StateMachine.Any>(stateMachine: M): MachineReadView<M> => ({
    get: () => currentMachines.get(stateMachine.key) as ReadonlyValue<Machine.CurrentValue<M>>,
    is: (state) => stateOf(currentMachines.get(stateMachine.key)) === state
  })

  const makeMachineUpdateView = <M extends Machine.StateMachine.Any>(stateMachine: M): MachineUpdateView<M> => ({
    ...makeMachineReadView(stateMachine),
    update(change: { readonly state: string; readonly data: (current: never) => object }) {
      const current = currentMachines.get(stateMachine.key) as { readonly _tag: string } | undefined
      if (current === undefined) return subStateInactive(stateMachine)
      if (current._tag !== change.state) {
        return Result.failure({ _tag: "MachineStateMismatch", machine: stateMachine.name, expected: change.state, actual: current._tag })
      }
      writeCommittedMachine(stateMachine.key, { _tag: current._tag, ...change.data(current as never) })
      return succeeded
    }
  } as MachineUpdateView<M>)

  /** The failure of a write to a sub-state while its parent is in another state. */
  const subStateInactive = (stateMachine: Machine.StateMachine.Any): Result.Result<never, Machine.SubStateInactive> =>
    Result.failure({
      _tag: "SubStateInactive",
      machine: stateMachine.name,
      parent: stateMachine.within!.machine.name,
      requires: stateMachine.within!.state
    })

  /** Queues a next value; a sub-state whose parent is in another state queues nothing and fails. */
  const queueMachine = <M extends Machine.StateMachine.Any>(stateMachine: M, value: unknown, skipIfSame: boolean): Machine.SetResult<M> => {
    const within = stateMachine.within
    if (within !== undefined && !currentMachines.has(stateMachine.key)) {
      return subStateInactive(stateMachine) as Machine.SetResult<M>
    }
    journalMachine(stateMachine.key)
    value = sharedValue(stateMachine, value)
    if (debugEnabled) {
      const previous = pendingMachines.get(stateMachine.key)
      // A set from a transition schedule waits for the next marker: it replaces nothing queued for this one.
      if (previous?.by !== undefined && previous.by !== runningSystem && !sameValue(previous.value, value) && activeTransitions.size === 0) {
        const key = `${stateMachine.name}/${previous.by}/${runningSystem}/${JSON.stringify(previous.value)}/${JSON.stringify(value)}`
        const seen = nextStateReplacements.get(key)
        nextStateReplacements.set(key, {
          machine: stateMachine.name,
          replaced: { system: previous.by, value: previous.value as Machine.AnyValue },
          by: { system: runningSystem, value: value as Machine.AnyValue },
          count: (seen?.count ?? 0) + 1
        })
      }
      pendingMachines.set(stateMachine.key, { value, skipIfSame, by: runningSystem })
    } else {
      pendingMachines.set(stateMachine.key, { value, skipIfSame })
    }
    return (within === undefined ? undefined : succeeded) as Machine.SetResult<M>
  }

  const makeNextMachineWriteView = <M extends Machine.StateMachine.Any>(stateMachine: M): NextMachineWriteView<M> => ({
    getPending: () => pendingMachines.get(stateMachine.key)?.value as ReadonlyValue<Machine.StateOf<M>> | undefined,
    set(value) {
      return queueMachine(stateMachine, value, false)
    },
    setIfChanged(value) {
      return queueMachine(stateMachine, value, true)
    },
    reset() {
      journalMachine(stateMachine.key)
      pendingMachines.delete(stateMachine.key)
    }
  })

  const makeTransitionReadView = <M extends Machine.StateMachine.Any>(stateMachine: M): TransitionReadView<M> => ({
    get: () => activeTransitions.get(stateMachine.key) as Machine.TransitionSnapshot<M> | undefined
  })

  const evaluateCondition = (condition: Machine.Condition): boolean => {
    switch (condition.kind) {
      case "inState":
        return stateOf(currentMachines.get(condition.machine.key)) === condition.state
      case "stateChanged":
        return changedMachines.has(condition.machine.key)
      case "not":
        return !evaluateCondition(condition.condition)
      case "and":
        return condition.conditions.every(evaluateCondition)
      case "or":
        return condition.conditions.some(evaluateCondition)
      case "check": {
        // Read-only and cursor-free by construction: evaluating it never
        // advances the world tick or any reader position.
        const projection = condition.projection as Inspector.InspectorDefinition<any, boolean>
        const { context } = slotOf(projection.system, false)
        world.beginRun()
        try {
          return projection.read(context as never) === true
        } finally {
          world.endRun()
        }
      }
    }
  }

  const mapRecord = <A, B>(record: Record<string, A>, f: (value: A) => B): Record<string, B> => {
    const result: Record<string, B> = {}
    for (const key in record) {
      result[key] = f(record[key]!)
    }
    return result
  }

  /**
   * Derives the runtime system context from the explicit system spec.
   *
   * The spec is the source of truth: the runtime materializes exactly the
   * views the implementation is allowed to see. Views read live storage, so
   * one context is built per system and reused for every run.
   */
  const makeContext = (system: SystemDefinition<any, any, any>, reader: ReaderState, queue: Command.CommandQueue<S, Root>): SystemContext<any> => {
    const spec = system.spec
    const lookup = makeLookup(reader)
    const paused = (spec.pauseWhen as ReadonlyArray<unknown>).length > 0
    /** On a debug runtime, records reads after a loss and calls of `lagged()`, for the `stream-loss-unread` lint. */
    const watch = <V extends { all(): unknown; lagged(): boolean }>(view: V, stream: string): V =>
      debugEnabled ? watchStreamLoss(view, system.name, stream, paused) : view
    return {
      local: (spec.local as (() => unknown) | undefined)?.(),
      // A filtered query hands out the same object; its type hides the lookups.
      queries: mapRecord(spec.queries as Record<string, Query.Query.Any<Root>>, (query) => makeQueryHandle(query, reader, lookup) as never),
      lookup,
      resources: mapRecord(spec.resources as Record<string, any>, (access) =>
        access.mode === "read"
          ? Cells.storeRead(resources, access.descriptor.key)
          : access.mode === "changed"
            ? makeResourceChangedView(access.descriptor, reader)
            : makeResourceWriteView(access.descriptor, resources, writeResource)),
      events: mapRecord(spec.events as Record<string, any>, (access) =>
        access.mode === "read"
          ? watch(makeEventReadView(access.descriptor.key, reader), `events ${access.descriptor.name}`)
          : makeEventWriteView(access.descriptor.key)),
      machines: mapRecord(spec.machines as Record<string, any>, (access) =>
        access.mode === "update" ? makeMachineUpdateView(access.machine) : makeMachineReadView(access.machine)),
      nextMachines: mapRecord(spec.nextMachines as Record<string, any>, (access) => makeNextMachineWriteView(access.machine)),
      transitionEvents: mapRecord(spec.transitionEvents as Record<string, any>, (access) => watch(makeTransitionEventReadView(access.machine, reader), `transition events ${access.machine.name}`)),
      transitions: mapRecord(spec.transitions as Record<string, any>, (access) => makeTransitionReadView(access.machine)),
      removed: mapRecord(spec.removed as Record<string, any>, (access) => watch(makeRemovedReadView(access.descriptor, reader), `removed ${access.descriptor.name}`)),
      despawned: mapRecord(spec.despawned as Record<string, any>, () => watch(makeDespawnedReadView(reader), "despawned")),
      relationFailures: mapRecord(spec.relationFailures as Record<string, any>, (access) => watch(makeRelationFailureReadView(access.relation, reader), `relation failures ${access.relation.name}`)),
      droppedRelations: mapRecord(spec.droppedRelations as Record<string, any>, (access) => watch(makeDroppedRelationReadView(access.relation, reader), `dropped relations ${access.relation.name}`)),
      services: mapRecord(spec.services as Record<string, any>, (access) =>
        providedServices[access.descriptor.name as keyof Services]),
      // The queue serves every declared permission set; the spec's types narrow it.
      commands: queue as unknown
    } as SystemContext<any>
  }

  interface SystemSlot {
    readonly context: SystemContext<any>
    /** The system's command queue (its context's `commands`, unchecked). */
    readonly commands: Command.CommandQueue<S, Root>
    readonly reader: ReaderState
  }

  const slots = new WeakMap<SystemDefinition<any, any, any>, SystemSlot>()
  /** Every reader, for what a rewind changed for those outside the rewound schedule. */
  const allReaders = new Set<ReaderState>()
  /** Slots of systems with `local` state, rebuilt on `restore`. */
  const localSlots: Array<{ readonly slot: SystemSlot; readonly make: () => unknown }> = []
  /** Stream readers by cursor, for `debug.streams()`. */
  const streamReaders = new Map<Streams.Cursor, { readonly system: string; readonly reader: ReaderState }>()

  interface ReadStream {
    readonly kind: "event" | "transitionEvent" | "relationFailure" | "droppedRelation"
    readonly store: Streams.Streams<unknown>
    readonly key: symbol
    readonly name: string
  }

  /** The streams a system reads, for tracing. */
  const readStreamsOf = (system: SystemDefinition<any, any, any>): Array<ReadStream> => {
    const spec = system.spec
    const result: Array<ReadStream> = []
    for (const access of Object.values(spec.events as Record<string, { readonly mode: string; readonly descriptor: Descriptor.Any }>)) {
      if (access.mode === "read") result.push({ kind: "event", store: events, key: access.descriptor.key, name: access.descriptor.name })
    }
    for (const access of Object.values(spec.transitionEvents as Record<string, { readonly machine: Machine.StateMachine.Any }>)) {
      result.push({ kind: "transitionEvent", store: transitionEvents, key: access.machine.key, name: access.machine.name })
    }
    for (const access of Object.values(spec.relationFailures as Record<string, { readonly relation: Relation.Relation.Any }>)) {
      result.push({ kind: "relationFailure", store: relationFailures, key: access.relation.key, name: access.relation.name })
    }
    for (const access of Object.values(spec.droppedRelations as Record<string, { readonly relation: Relation.Relation.Any }>)) {
      result.push({ kind: "droppedRelation", store: droppedRelations, key: access.relation.key, name: access.relation.name })
    }
    return result
  }

  const missedReads = (system: SystemDefinition<any, any, any>, reader: ReaderState): Array<Debug.MissedRead> => {
    const missed: Array<Debug.MissedRead> = []
    for (const stream of readStreamsOf(system)) {
      if (stream.store.lagged(stream.key, reader.streamSince, reader.registeredAt)) {
        missed.push({ kind: stream.kind, stream: stream.name })
      }
    }
    for (const access of Object.values(system.spec.removed as Record<string, { readonly descriptor: Descriptor<"component", string, any> }>)) {
      if (world.removedLagged(world.ordinalOf(access.descriptor), reader.since, reader.registeredAt)) {
        missed.push({ kind: "removed", stream: access.descriptor.name })
      }
    }
    if (Object.keys(system.spec.despawned).length > 0 && world.despawnedLagged(reader.since, reader.registeredAt)) {
      missed.push({ kind: "despawned", stream: "despawned" })
    }
    return missed
  }

  const traceSystem = (
    system: SystemDefinition<any, any, any>,
    reader: ReaderState,
    tick: number,
    started: number,
    outcome: Debug.SystemEvent["outcome"],
    error: unknown,
    commands: ReadonlyArray<Command.DeferredCommand<S>>
  ): Debug.SystemEvent => {
    const names = debugNames!
    const writes: Array<Debug.ComponentWrite> = []
    world.forEachJournaled((entity, ordinal, before, after) => {
      writes.push({ entity, component: world.descriptorAt(ordinal).name, before, after })
    })
    const resourceWrites: Array<Debug.ResourceWrite> = []
    for (const [key, before] of resourceOriginals) {
      resourceWrites.push({
        resource: names.resources.get(key) ?? "?",
        before: before === absentValue ? undefined : before,
        after: resources.get(key)
      })
    }
    const emitted: Array<Debug.EventEmit> = []
    for (const [key, values] of emittedEvents) {
      emitted.push({ event: names.events.get(key) ?? "?", values })
    }
    const nextStates: Array<Debug.NextStateWrite> = []
    for (const key of machineOriginals.keys()) {
      nextStates.push({ machine: names.machines.get(key) ?? "?", value: pendingMachines.get(key)?.value as Machine.AnyValue | undefined })
    }
    const machineWrites: Array<Debug.MachineWrite> = []
    for (const [key, before] of committedMachineOriginals) {
      machineWrites.push({ machine: names.machines.get(key) ?? "?", before: before as Machine.AnyValue, after: currentMachines.get(key) as Machine.AnyValue })
    }
    return {
      type: "system",
      frame: frameCount,
      tick,
      schedule: currentSchedule(),
      system: system.name,
      outcome,
      ...(outcome === "ok" ? {} : { error }),
      ms: HostClockModule.elapsed(started, now()),
      writes,
      resources: resourceWrites,
      events: emitted,
      machines: machineWrites,
      nextStates,
      commands: commands.map((command) => command.tag),
      missed: missedReads(system, reader)
    }
  }

  const traceSkipped = (
    system: SystemDefinition<any, any, any>,
    condition: Machine.Condition,
    reader: ReaderState | undefined,
    held: boolean
  ): void => {
    const discarded: Array<{ readonly stream: string; readonly count: number }> = []
    if (reader !== undefined && !held) {
      for (const stream of readStreamsOf(system)) {
        const count = stream.store.since(stream.key, reader.streamLastRun).length
        if (count > 0) discarded.push({ stream: stream.name, count })
      }
    }
    emit({
      type: "system.skipped",
      frame: frameCount,
      tick: world.currentTick(),
      schedule: currentSchedule(),
      system: system.name,
      condition: DebugInternal.renderCondition(condition),
      held,
      discarded
    })
  }

  /**
   * Systems hold stream and removed/despawned entries until they have read
   * them; inspectors are evaluated on demand, so they do not (and report
   * `lagged` instead).
   */
  const registerStreamReader = (system: SystemDefinition<any, any, any>, reader: ReaderState): void => {
    if (debugEnabled) streamReaders.set(reader, { system: system.name, reader })
    const spec = system.spec
    for (const access of Object.values(spec.events as Record<string, { readonly mode: string; readonly descriptor: Descriptor.Any }>)) {
      if (access.mode === "read") events.register(access.descriptor.key, reader)
    }
    for (const access of Object.values(spec.transitionEvents as Record<string, { readonly machine: Machine.StateMachine.Any }>)) {
      transitionEvents.register(access.machine.key, reader)
    }
    for (const access of Object.values(spec.relationFailures as Record<string, { readonly relation: Relation.Relation.Any }>)) {
      relationFailures.register(access.relation.key, reader)
    }
    for (const access of Object.values(spec.droppedRelations as Record<string, { readonly relation: Relation.Relation.Any }>)) {
      droppedRelations.register(access.relation.key, reader)
    }
    // Removed/despawned reads use the change-detection cursor, so a system
    // skipped by its run conditions keeps them, like `added`/`changed`.
    for (const access of Object.values(spec.removed as Record<string, { readonly descriptor: Descriptor<"component", string, any> }>)) {
      world.registerRemovedReader(world.ordinalOf(access.descriptor), reader)
    }
    if (Object.keys(spec.despawned).length > 0) world.registerDespawnedReader(reader)
  }

  /** Gated copies (`Schedule.when`) share the state of the system they copy. */
  const stateKey = (system: SystemDefinition<any, any, any>): SystemDefinition<any, any, any> => system.base ?? system

  const slotOf = (system: SystemDefinition<any, any, any>, holdsStreams: boolean): SystemSlot => {
    let slot = slots.get(stateKey(system))
    if (!slot) {
      const reader: ReaderState = { since: 0, lastRun: 0, streamSince: 0, streamLastRun: 0, registeredAt: world.currentTick(), reverts: undefined }
      const commands = Command.makeCommands<S, Root>(() => world.allocateEntity() as Entity.EntityId<S, Root>)
      slot = { context: makeContext(system, reader, commands), commands, reader }
      slots.set(stateKey(system), slot)
      allReaders.add(reader)
      if (holdsStreams) registerStreamReader(system, slot.reader)
      const make = system.spec.local as (() => unknown) | undefined
      if (make !== undefined) localSlots.push({ slot, make })
    }
    return slot
  }

  const succeeded = Result.success(undefined)

  /**
   * Runs one system atomically when its run conditions pass.
   *
   * On success its writes are committed and its commands queued. On an
   * expected failure its ECS writes are rolled back and its commands dropped.
   * A thrown defect is rethrown after the same rollback.
   */
  const runSystem = (system: SystemDefinition<any, any, any>, schedule: object, index: number): Result.Result<void, SystemFailure> => {
    for (const condition of system.spec.when as ReadonlyArray<Machine.Condition>) {
      if (!evaluateCondition(condition)) {
        // A skipped system discards the messages published meanwhile, so it
        // neither holds them nor receives a backlog when it runs again.
        const skipped = slotOf(system, true)
        if (tracing) traceSkipped(system, condition, skipped.reader, false)
        journalReader(skipped.reader)
        skipped.reader.streamLastRun = world.currentTick()
        return succeeded
      }
    }
    for (const condition of system.spec.pauseWhen as ReadonlyArray<Machine.Condition>) {
      if (!evaluateCondition(condition)) {
        // A paused system keeps its stream cursor, so it holds the messages
        // published meanwhile and reads them when the pause ends. The slot is
        // made now, so entries published before its first run are held too.
        const paused = slotOf(system, true)
        if (tracing) traceSkipped(system, condition, paused.reader, true)
        return succeeded
      }
    }
    const { context, commands, reader } = slotOf(system, true)
    if (debugEnabled) {
      ranSystems.add(system.name)
      runningSystem = system.name
      noteConsumed(system, schedule, index)
    }
    journalReader(reader)
    // Changes stamped after the previous completed run are visible to this run.
    reader.since = reader.lastRun
    reader.streamSince = reader.streamLastRun
    const thisRun = world.advanceTick()
    const started = tracing ? now() : 0
    beginSystemTransaction()
    let outcome: Result.Result<unknown, unknown>
    world.beginRun()
    try {
      // A system that returns nothing cannot fail; otherwise it returned a `Result`.
      outcome = system.run(context) ?? succeeded
    } catch (defect) {
      world.endRun()
      if (tracing) emit(traceSystem(system, reader, thisRun, started, "defect", defect, commands.flush()))
      rollbackSystemTransaction()
      commands.flush()
      throw defect
    }
    world.endRun()
    if (!outcome.ok) {
      if (tracing) emit(traceSystem(system, reader, thisRun, started, "failed", outcome.error, commands.flush()))
      rollbackSystemTransaction()
      commands.flush()
      return Result.failure({ kind: "SystemFailure", system: system.name, error: outcome.error })
    }
    const queued = commands.flush()
    const traced = tracing ? traceSystem(system, reader, thisRun, started, "ok", undefined, queued) : undefined
    commitSystemTransaction()
    // A failed run leaves `lastRun` unchanged, so the next run sees the same changes again.
    reader.lastRun = thisRun
    reader.streamLastRun = thisRun
    reader.reverts = undefined
    for (let index = 0; index < queued.length; index++) {
      pendingCommands.push(queued[index]!)
    }
    if (debugEnabled) {
      for (let index = 0; index < queued.length; index++) pendingOrigins.push(system.name)
    }
    if (traced !== undefined) emit(traced)
    return succeeded
  }

  const applyDeferred = (marker: Debug.DeferredEvent["marker"] = "applyDeferred"): void => {
    // Commands applied here may not queue further commands, so one drain is enough.
    const commands = pendingCommands.splice(0, pendingCommands.length)
    const origins = pendingOrigins.splice(0, pendingOrigins.length)
    world.advanceTick()
    if (!tracing) {
      if (!debugEnabled) {
        for (const command of commands) {
          command.apply(commandWorld)
        }
        return
      }
      for (let index = 0; index < commands.length; index++) {
        commandOrigin = origins[index] ?? "(unknown)"
        commands[index]!.apply(commandWorld)
      }
      return
    }
    const applied: Array<Debug.AppliedCommand> = []
    for (let index = 0; index < commands.length; index++) {
      const command = commands[index]!
      const effects: Array<Debug.Effect> = []
      commandEffects = effects
      commandOrigin = origins[index] ?? "(unknown)"
      try {
        command.apply(commandWorld)
      } finally {
        commandEffects = undefined
      }
      applied.push({ tag: command.tag, system: origins[index] ?? "(unknown)", effects })
    }
    if (applied.length > 0) {
      emit({ type: "deferred", frame: frameCount, tick: world.currentTick(), schedule: currentSchedule(), marker, commands: applied })
    }
  }

  /** Runs `run` as the named schedule in traces. */
  const traceSchedule = (name: string, run: () => Result.Result<void, SystemFailure>): Result.Result<void, SystemFailure> => {
    schedulePath.push(name)
    const scheduleLabel = currentSchedule()
    emit({ type: "schedule.start", frame: frameCount, schedule: scheduleLabel })
    const started = now()
    let result: Result.Result<void, SystemFailure>
    try {
      result = run()
    } finally {
      schedulePath.pop()
    }
    emit({ type: "schedule.end", frame: frameCount, schedule: scheduleLabel, ok: result.ok, ms: HostClockModule.elapsed(started, now()) })
    return result
  }

  const traceTransition = (
    machineKey: symbol,
    snapshot: Machine.TransitionSnapshot,
    outcome: Debug.TransitionEvent["outcome"]
  ): void => {
    emit({
      type: "transition",
      frame: frameCount,
      tick: world.currentTick(),
      schedule: currentSchedule(),
      machine: debugNames!.machines.get(machineKey) ?? "?",
      from: snapshot.from,
      to: snapshot.to,
      outcome
    })
  }

  const runTransitionSchedule = (
    schedule: Machine.StateMachine.AnyTransitionSchedule<S, Root>,
    snapshot: Machine.TransitionSnapshot
  ): Result.Result<void, SystemFailure> => {
    if (schedule.steps.some((step) => !Schedule.isSystemStep(step) && step.kind === "applyStateTransitions")) {
      throw new Error("Transition schedules cannot contain applyStateTransitions() steps")
    }
    activeTransitions.set(schedule.transition.machine.key, snapshot)
    try {
      return tracing
        ? traceSchedule(DebugInternal.transitionScheduleName(schedule), () => runSteps(schedule))
        : runSteps(schedule)
    } finally {
      activeTransitions.delete(schedule.transition.machine.key)
    }
  }

  /**
   * Despawns the scopes whose trigger matches a committed transition: leaving
   * `snapshot.from` or entering `snapshot.to`. It runs right after the
   * commit, so `onExit` systems still saw the members and entities spawned by
   * `onEnter` survive. Members are the entities in the scope at that moment:
   * commands queued by `onExit` systems and not yet applied are not.
   */
  const despawnTriggeredScopes = (machineKey: symbol, snapshot: Machine.TransitionSnapshot): void => {
    const triggers = scopeTriggers.get(machineKey)
    if (triggers === undefined) return
    const applied: Array<Debug.AppliedCommand> = []
    for (const { trigger, scope } of triggers) {
      const matches = trigger.phase === "exit" ? trigger.state === snapshot.from : trigger.state === snapshot.to
      if (!matches) continue
      const origin = `${trigger.phase === "exit" ? "onExit" : "onEnter"}(${trigger.machine.name}=${String(trigger.state)})`
      const effects: Array<Debug.Effect> = []
      commandEffects = tracing ? effects : undefined
      commandOrigin = origin
      try {
        commandWorld.destroyEntityScope(scope)
      } finally {
        commandEffects = undefined
      }
      if (tracing) applied.push({ tag: `despawnScope ${scope.name}`, system: origin, effects })
    }
    if (applied.length > 0) {
      emit({ type: "deferred", frame: frameCount, tick: world.currentTick(), schedule: currentSchedule(), marker: "applyStateTransitions", commands: applied })
    }
  }

  /**
   * Applies queued commands, then queued machine transitions, running the
   * matching exit, transition, and enter schedules from the bundle.
   */
  const applyStateTransitions = (
    bundle?: Schedule.TransitionBundleDefinition<S, ReadonlyArray<Machine.StateMachine.AnyTransitionSchedule<S, Root>>, any, Root, any, any>
  ): Result.Result<void, SystemFailure> => {
    applyDeferred("applyStateTransitions")
    changedMachines = new Set()
    const scheduledTransitions = Array.from(pendingMachines.entries())
      .sort(([leftKey], [rightKey]) =>
        (machineDefinitionOrder.get(leftKey) ?? Number.MAX_SAFE_INTEGER)
        - (machineDefinitionOrder.get(rightKey) ?? Number.MAX_SAFE_INTEGER)
      )

    const schedules = bundle?.entries ?? []
    for (const [machineKey, pending] of scheduledTransitions) {
      if (discardedPending.has(pending)) {
        // Discarded earlier in this marker: its parent left the state it exists in.
        continue
      }
      // A transition schedule earlier in this marker may have queued a newer
      // value for this machine: that one waits for the next marker.
      if (pendingMachines.get(machineKey) === pending) pendingMachines.delete(machineKey)
      /** Keeps this request queued after a failure, unless a newer one replaced it. */
      const requeue = () => {
        if (!pendingMachines.has(machineKey)) pendingMachines.set(machineKey, pending)
      }
      const current = currentMachines.get(machineKey)
      if (current === undefined) {
        continue
      }
      if (pending.skipIfSame && sameValue(current, pending.value)) {
        if (tracing) traceTransition(machineKey, { from: stateOf(current)!, to: stateOf(current)! }, "unchanged")
        continue
      }

      const snapshot: Machine.TransitionSnapshot = {
        from: stateOf(current)!,
        to: stateOf(pending.value)!
      }

      // Sub-states that exist in the state being left exit first, deepest
      // first: their exit schedules run before the parent's, while they
      // still have their values, and they lose them at the parent's commit.
      // The exit phase is one transaction: a failure undoes all of it, and
      // the transition stays queued for a later attempt.
      const leaving = activeSubStatesIn(machineKey, snapshot.from)
      const exited = runAsPhase(() => {
        for (const sub of leaving) {
          const state = stateOf(currentMachines.get(sub.key))
          const result = runPhase(sub.key, "exit", state, { from: state, to: undefined } as unknown as Machine.TransitionSnapshot, schedules)
          if (!result.ok) return result
        }
        const left = runPhase(machineKey, "exit", snapshot.from, snapshot, schedules)
        if (!left.ok) return left
        for (const schedule of schedules) {
          const transition = schedule.transition
          if (
            transition.phase === "transition"
            && transition.machine.key === machineKey
            && transition.from === snapshot.from
            && transition.to === snapshot.to
          ) {
            const result = runTransitionSchedule(schedule, snapshot)
            if (!result.ok) return result
          }
        }
        return succeeded
      })
      if (!exited.ok) {
        requeue()
        if (tracing) traceTransition(machineKey, snapshot, "failed")
        return exited
      }

      for (const sub of leaving) commitMachine(sub.key, currentMachines.get(sub.key), undefined)
      commitMachine(machineKey, current, pending.value)
      // Sub-states that exist in the entered state enter their value together
      // with the parent, parents first, before any onEnter schedule runs: a
      // failing onEnter cannot leave them without a value, and their scope
      // triggers fire before what the onEnter schedules spawn.
      const entered = commitSubStates(machineKey, snapshot.to)

      for (const schedule of schedules) {
        const transition = schedule.transition
        if (transition.phase === "enter" && transition.machine.key === machineKey && transition.state === snapshot.to) {
          const result = runTransitionSchedule(schedule, snapshot)
          if (!result.ok) {
            if (tracing) traceTransition(machineKey, snapshot, "enterFailed")
            return result
          }
        }
      }
      const enteredSchedules = runSubStateEnters(entered, schedules)
      if (!enteredSchedules.ok) return enteredSchedules
    }
    return succeeded
  }

  /**
   * Commits one machine's value (`undefined` for a sub-state that stops
   * existing): records the change and its transition event, traces it, and
   * despawns the scopes it triggers.
   */
  const commitMachine = (machineKey: symbol, from: unknown, to: unknown): void => {
    const snapshot = { from: stateOf(from), to: stateOf(to) } as unknown as Machine.TransitionSnapshot
    if (from !== undefined) previousMachines.set(machineKey, from)
    if (to === undefined) {
      currentMachines.delete(machineKey)
      const discarded = pendingMachines.get(machineKey)
      if (discarded !== undefined) discardedPending.add(discarded)
      pendingMachines.delete(machineKey)
    } else {
      currentMachines.set(machineKey, to)
    }
    changedMachines.add(machineKey)
    transitionEvents.append(machineKey, world.advanceTick(), [snapshot])
    if (tracing) traceTransition(machineKey, snapshot, "applied")
    despawnTriggeredScopes(machineKey, snapshot)
  }

  type TransitionSchedules = ReadonlyArray<Machine.StateMachine.AnyTransitionSchedule<S, Root>>

  /** Runs every schedule of `phase` for `machineKey` in `state`, in bundle order. */
  const runPhase = (
    machineKey: symbol,
    phase: "enter" | "exit",
    state: string | undefined,
    snapshot: Machine.TransitionSnapshot,
    schedules: TransitionSchedules
  ): Result.Result<void, SystemFailure> => {
    for (const schedule of schedules) {
      const transition = schedule.transition
      if (transition.phase === phase && transition.machine.key === machineKey && transition.state === state) {
        const result = runTransitionSchedule(schedule, snapshot)
        if (!result.ok) return result
      }
    }
    return succeeded
  }

  /** The sub-states with a value that exist in `state` of `parentKey`, and theirs, deepest first. */
  const activeSubStatesIn = (parentKey: symbol, state: string): Array<Machine.StateMachine.Any> => {
    const result: Array<Machine.StateMachine.Any> = []
    for (const sub of subStates.get(parentKey) ?? []) {
      const value = currentMachines.get(sub.key)
      if (sub.within!.state !== state || value === undefined) continue
      result.push(...activeSubStatesIn(sub.key, stateOf(value)!), sub)
    }
    return result
  }

  /**
   * Gives the sub-states of `parentKey` that exist in `state` their entry
   * value, and theirs, parents first. Returns what it entered, in that order.
   */
  const commitSubStates = (parentKey: symbol, state: string): Array<readonly [symbol, unknown]> => {
    const entered: Array<readonly [symbol, unknown]> = []
    for (const sub of subStates.get(parentKey) ?? []) {
      if (sub.within!.state !== state || currentMachines.has(sub.key) || !subStateEntry.has(sub.key)) continue
      const value = subStateEntry.get(sub.key)
      commitMachine(sub.key, undefined, value)
      entered.push([sub.key, value], ...commitSubStates(sub.key, stateOf(value)!))
    }
    return entered
  }

  /** Runs the onEnter schedules of sub-states entered by {@link commitSubStates}, in that order. */
  const runSubStateEnters = (entered: ReadonlyArray<readonly [symbol, unknown]>, schedules: TransitionSchedules): Result.Result<void, SystemFailure> => {
    for (const [key, value] of entered) {
      const snapshot = { from: undefined, to: stateOf(value) } as unknown as Machine.TransitionSnapshot
      const result = runPhase(key, "enter", stateOf(value), snapshot, schedules)
      if (!result.ok) {
        if (tracing) traceTransition(key, snapshot, "enterFailed")
        return result
      }
    }
    return succeeded
  }

  /**
   * Executes schedule steps in authored order.
   *
   * Nothing is applied implicitly: queued commands and next states stay
   * pending, across schedule runs if needed, until a marker step applies
   * them. Stream reads (events, relation failures) are per reader, not
   * marker-driven.
   */
  function runSteps(schedule: { readonly steps: ReadonlyArray<Schedule.ScheduleStep> }): Result.Result<void, SystemFailure> {
    const steps = schedule.steps
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index]!
      if (Schedule.isSystemStep(step)) {
        const result = runSystem(step as SystemDefinition<any, any, any>, schedule, index)
        if (!result.ok) {
          return result
        }
        continue
      }
      switch (step.kind) {
        case "applyDeferred":
          applyDeferred()
          break
        case "applyStateTransitions": {
          const result = applyStateTransitions(step.bundle as never)
          if (!result.ok) {
            return result
          }
          break
        }
      }
    }
    return succeeded
  }

  /** Whether `runtime.tick` is on the stack: a nested `tick` is a defect. */
  let ticking = false
  /**
   * Whether a tick is advancing its frame or running its schedules (in
   * `tick` and `tryTick`): `send`, `snapshot`, and `restore` are defects
   * meanwhile. It is cleared before `tick.end` is announced to host listeners.
   */
  let inTick = false

  /**
   * Whether a frame begun with `debug.beginFrame` is still open (debug
   * runtimes only). Between its steps nothing runs, but the frame is not
   * over: `tick`, `tryTick`, `send`, `snapshot`, `checksum`, `restore`,
   * `checkpoint`, and `rewind` are defects until its last step has run.
   */
  let frameOpen = false
  const openFrameDefect = (call: string): Error =>
    new Error(`${call} was called while a stepped frame is open (debug.beginFrame): run its remaining steps first (with devtools, call finish() on the stepped frame)`)

  /**
   * Runs one schedule. A failing system stops the schedule; systems that
   * already succeeded stay committed, and their pending work stays pending.
   */
  const runScheduleUnsafe = (schedule: ExecutableScheduleDefinition<S, any, any, any, any, AnyScheduleOrder>): Result.Result<void, SystemFailure> => {
    changedMachines = new Set()
    return tracing
      ? traceSchedule(scheduleName(schedule), () => runSteps(schedule))
      : runSteps(schedule)
  }

  const eventsByKey = new Set((Object.values(options.schema.events) as ReadonlyArray<Descriptor.Any>).map((descriptor) => descriptor.key))
  const externallyWrittenEvents = new Set<string>()
  /** `debug.observeHost` listeners: ticks and sends, without tracing. Only a debug runtime registers any. */
  const hostListeners = new Set<(event: Debug.HostEvent<S, Root>) => void>()
  const emitHost = (event: Debug.HostEvent<S, Root>): void => {
    for (const listener of hostListeners) listener(event)
  }
  /** Events declared as sent by the host (`debug.declareHostEvents`). */
  let hostEvents = new Set<string>()

  const send = (descriptor: Descriptor<"event", string, any>, value: unknown): void => {
    if (frameOpen) throw openFrameDefect(`runtime.send(${descriptor.name})`)
    if (inTick) throw new Error(`runtime.send(${descriptor.name}) was called while a schedule is running: emit from a system instead`)
    if (!eventsByKey.has(descriptor.key)) throw new Error(`runtime.send: ${descriptor.name} is not an event of this runtime's schema`)
    const published = world.advanceTick()
    events.append(descriptor.key, published, [value], true)
    // Bound host traffic even when it sends repeatedly without ticking.
    events.trim(0)
    externallyWrittenEvents.add(descriptor.name)
    if (hostListeners.size > 0) emitHost({ type: "send", event: descriptor.name, value })
    if (tracing) emit({ type: "runtime.sent", frame: frameCount, tick: published, event: descriptor.name, value })
  }

  const advanceFrame = (): void => {
    frameCount += 1
    const boundary = world.advanceFrame()
    if (tracing) emit({ type: "frame", frame: frameCount, tick: world.currentTick() })
    events.trim(boundary)
    transitionEvents.trim(boundary)
    relationFailures.trim(boundary)
    droppedRelations.trim(boundary)
  }

  /**
   * With debug: the last failed tick result, until its `ok` is read. The
   * result handed back is a copy whose `ok` getter marks it read.
   */
  let unread: { read: boolean; readonly event: Omit<Debug.FailureIgnoredEvent, "type" | "when"> } | undefined
  const reportUnread = (when: Debug.FailureIgnoredEvent["when"]): void => {
    const pending = unread
    unread = undefined
    if (pending === undefined || pending.read) return
    const event: Debug.FailureIgnoredEvent = { type: "failure.ignored", ...pending.event, when }
    emit(event)
    emitHost(event)
  }
  const watchResult = <R extends Result.Result<void, unknown>>(
    result: R,
    schedules: ReadonlyArray<ExecutableScheduleDefinition<S, any, any, any, any, AnyScheduleOrder>>
  ): R => {
    if (!debugEnabled || result.ok) return result
    const error = result.error
    const system = typeof error === "object" && error !== null && (error as { readonly kind?: unknown }).kind === "SystemFailure"
      ? (error as SystemFailure).system
      : undefined
    const names = schedules.flatMap((schedule) => schedule.steps.filter(Schedule.isSystemStep).map((step) => (step as SystemDefinition<any, any, any>).name))
    const at = system === undefined ? -1 : names.indexOf(system)
    const holder = system === undefined
      ? schedules[0]
      : schedules.find((schedule) => schedule.steps.some((step) => Schedule.isSystemStep(step) && (step as SystemDefinition<any, any, any>).name === system)) ?? schedules[0]
    const entry = {
      read: false,
      event: {
        frame: frameCount,
        schedule: holder === undefined ? "(none)" : scheduleName(holder),
        system,
        error,
        skipped: [...new Set(names.slice(at + 1))]
      }
    }
    unread = entry
    return {
      get ok() {
        entry.read = true
        return false
      },
      error
    } as unknown as R
  }

  const tickUnsafe = (schedules: ReadonlyArray<ExecutableScheduleDefinition<S, any, any, any, any, AnyScheduleOrder>>): Result.Result<void, SystemFailure> => {
    if (frameOpen) throw openFrameDefect("runtime.tick")
    if (ticking) throw new Error("runtime.tick cannot run inside another tick")
    if (debugEnabled) reportUnread("next-tick")
    ticking = true
    inTick = true
    try {
      advanceFrame()
      return watchResult(observedTick(schedules, () => {
        for (const schedule of schedules) {
          const result = runScheduleUnsafe(schedule)
          if (!result.ok) return result
        }
        return succeeded
      }), schedules)
    } finally {
      ticking = false
      inTick = false
    }
  }

  /** Runs one tick's schedules, telling `observeHost` listeners when it starts and how it ends. */
  const observedTick = (
    schedules: ReadonlyArray<ExecutableScheduleDefinition<S, any, any, any, any, AnyScheduleOrder>>,
    run: () => Result.Result<void, SystemFailure>
  ): Result.Result<void, SystemFailure> => {
    if (hostListeners.size === 0) return run()
    emitHost({ type: "tick.start", schedules, frame: frameCount })
    let result: Result.Result<void, SystemFailure>
    try {
      result = run()
    } catch (defect) {
      inTick = false
      emitHost({ type: "tick.end", schedules, frame: frameCount, outcome: "defect", error: defect })
      throw defect
    }
    inTick = false
    emitHost(result.ok
      ? { type: "tick.end", schedules, frame: frameCount, outcome: "ok" }
      : { type: "tick.end", schedules, frame: frameCount, outcome: "failed", error: result.error })
    return result
  }

  const hasRequirement = (requirement: Requirement.RequirementValue): boolean => {
    switch (requirement.kind) {
      case "service":
        return Object.prototype.hasOwnProperty.call(providedServices, requirement.name)
      case "resource":
        return resources.has(requirement.key)
      case "stateMachine":
        // An inactive sub-state has no value but is provided.
        return providedMachineKeys.has(requirement.key) || currentMachines.has(requirement.key)
    }
  }

  const tryRunSchedule = <const Selected extends ExecutableScheduleDefinition<S, any, any, any, any, AnyScheduleOrder>>(
    schedule: Selected
  ): Result.Result<void, MissingRuntimeRequirements | TickOrderViolation | Schedule.FailureOf<Selected>> => {
    if (frameOpen) throw openFrameDefect("runtime.tryTick")
    if (debugEnabled) reportUnread("next-tick")
    const missing = schedule.requirements
      .filter((requirement) => !hasRequirement(requirement))
      .map(({ kind, name }) => ({ kind, name }))

    if (missing.length > 0) {
      return watchResult(Result.failure({
        kind: "MissingRuntimeRequirements" as const,
        requirements: missing
      }), [schedule])
    }

    const issues = OrderInternal.tickOrderIssues(schedule.steps)
    if (issues.length > 0) {
      return watchResult(Result.failure({ kind: "TickOrderViolation" as const, issues }), [schedule])
    }

    if (inTick) throw new Error("runtime.tryTick cannot run inside another tick")
    inTick = true
    try {
      advanceFrame()
      return watchResult(observedTick([schedule], () => runScheduleUnsafe(schedule)), [schedule]) as Result.Result<void, Schedule.FailureOf<Selected>>
    } finally {
      inTick = false
    }
  }

  /**
   * Evaluates a declared read-only projection without running a schedule.
   * Like a system, an inspector sees `added`/`changed`/removed records made
   * since its previous evaluation.
   */
  const inspect = <const Selected extends Inspector.InspectorDefinition<any, any, Root, any, any>>(
    inspector: Selected
  ): Inspector.Inspector.Value<Selected> => {
    // Matches are valid in the run that produced them, so runs never nest.
    if (inTick) throw new Error(`runtime.inspect(${inspector.name}) was called while a schedule is running: read the world from a system, or inspect between ticks`)
    const { context, reader } = slotOf(inspector.system, false)
    reader.since = reader.lastRun
    reader.streamSince = reader.streamLastRun
    world.beginRun()
    let value: Inspector.Inspector.Value<Selected>
    try {
      value = inspector.read(context) as Inspector.Inspector.Value<Selected>
    } finally {
      world.endRun()
    }
    reader.lastRun = world.advanceTick()
    reader.streamLastRun = reader.lastRun
    reader.reverts = undefined
    return value
  }

  const componentsByName = new Map(
    (Object.values(options.schema.components) as ReadonlyArray<Descriptor<"component", string, any>>)
      .map((descriptor) => [descriptor.name, descriptor] as const)
  )
  const resourcesByName = new Map(
    (Object.values(options.schema.resources) as ReadonlyArray<Descriptor<"resource", string, any>>)
      .map((descriptor) => [descriptor.name, descriptor] as const)
  )
  const relationsByName = new Map(
    (Object.values(options.schema.relations) as ReadonlyArray<Relation.Relation.Any>)
      .map((relation) => [relation.name, relation] as const)
  )
  const machinesByName = new Map<string, Machine.StateMachine.Any>()
  for (const machine of options.machineDefinitions) machinesByName.set(machine.name, machine)
  for (const provision of machineEntries) machinesByName.set(provision.machine.name, provision.machine)
  /** Each machine's value schema, made on its first snapshot or restore. */
  const machineSchemas = new Map<symbol, Construction>()
  const machineSchema = (machine: Machine.StateMachine.Any): Construction => {
    let schema = machineSchemas.get(machine.key)
    if (schema === undefined) {
      schema = construction(stateCodec(machine.states))
      machineSchemas.set(machine.key, schema)
    }
    return schema
  }
  // A value's saved form: its schema's `"~encode"`, or the value as it is.
  const encoded = (schema: Construction | undefined, value: unknown): Result.Result<unknown, DescriptorModule.SchemaIssues> =>
    schema?.encode === undefined ? Result.success(value) : schema.encode(value)

  const snapshot = (): Result.Result<Snapshot.WorldSnapshot, Snapshot.SnapshotError> => {
    if (frameOpen) throw openFrameDefect("runtime.snapshot")
    if (inTick) throw new Error("runtime.snapshot was called while a schedule is running: it would capture writes a failing system rolls back; take it between ticks")
    const savedEntities = world.exportEntities(DescriptorModule.isTransient)
    for (const entity of savedEntities) {
      for (const [name, value] of Object.entries(entity.components)) {
        const saved = encoded(constructionOf(componentsByName.get(name)!), value)
        if (!saved.ok) return Result.failure({ _tag: "UnencodableComponent", entityId: entity.id, name, error: saved.error })
        entity.components[name] = saved.value
      }
    }
    const savedResources: Record<string, unknown> = {}
    for (const [name, descriptor] of resourcesByName) {
      if (!DescriptorModule.isTransient(descriptor) && resources.has(descriptor.key)) {
        const saved = encoded(constructionOf(descriptor), resources.get(descriptor.key))
        if (!saved.ok) return Result.failure({ _tag: "UnencodableResource", name, error: saved.error })
        savedResources[name] = saved.value
      }
    }
    const savedMachines: Record<string, unknown> = {}
    for (const [name, machine] of machinesByName) {
      const value = currentMachines.get(machine.key)
      if (value === undefined) continue
      const saved = encoded(machineSchema(machine), value)
      if (!saved.ok) return Result.failure({ _tag: "UnencodableMachineState", name, error: saved.error })
      savedMachines[name] = saved.value
    }
    const savedScopes: Record<string, ReadonlyArray<number>> = {}
    for (const [key, members] of world.exportScopes()) {
      const name = EntityScopeModule.nameOf(key)
      if (name !== undefined) savedScopes[name] = members
    }
    return Result.success({
      version: Snapshot.version,
      gameVersion: options.saves?.latest ?? 0,
      nextEntity: world.nextEntityValue(),
      entities: savedEntities,
      relations: world.exportRelations(),
      resources: savedResources,
      machines: savedMachines,
      scopes: savedScopes
    })
  }

  const checksum = (): Result.Result<string, Snapshot.SnapshotError> => {
    if (frameOpen) throw openFrameDefect("runtime.checksum")
    if (inTick) throw new Error("runtime.checksum was called while a schedule is running: it would hash writes a failing system rolls back; take it between ticks")
    const saved = snapshot()
    return saved.ok ? Result.success(Checksum.checksum(saved.value)) : saved
  }

  // The public type only exposes `restore` when every saved descriptor has a
  // schema; a descriptor without one still fails closed here.
  const validate = (value: unknown, descriptor: Descriptor.Any): Result.Result<unknown, DescriptorModule.SchemaIssues> | undefined =>
    constructionOf(descriptor)?.decode(value)

  const restore = (data: unknown): Result.Result<void, Snapshot.RestoreError> => {
    const parsed = Snapshot.parse(data)
    if (!parsed.ok) return parsed
    const migrated = migrateSave(parsed.value, options.saves)
    if (!migrated.ok) return migrated
    const saved = migrated.value

    // Validate everything before touching the world.
    const ids = new Set<number>()
    const entities: Array<{ readonly id: number; readonly components: Array<Entity.StagedComponent> }> = []
    for (const entity of saved.entities) {
      if (ids.has(entity.id)) return Result.failure({ _tag: "DuplicateEntity", entityId: entity.id })
      ids.add(entity.id)
      const components: Array<Entity.StagedComponent> = []
      for (const [name, raw] of Object.entries(entity.components)) {
        const descriptor = componentsByName.get(name)
        if (!descriptor || DescriptorModule.isTransient(descriptor)) {
          return Result.failure({ _tag: "UnknownComponent", entityId: entity.id, name })
        }
        const value = validate(raw, descriptor)
        if (value === undefined) return Result.failure({ _tag: "UnvalidatedDescriptor", name })
        if (!value.ok) return Result.failure({ _tag: "InvalidComponent", entityId: entity.id, name, error: value.error })
        components.push([descriptor, value.value])
      }
      // Transient components are never saved, so a requirement on one is not checked here.
      const missing = missingIn(components, DescriptorModule.isTransient)
      if (missing !== undefined) {
        return Result.failure({ _tag: "MissingRequiredComponent", entityId: entity.id, name: missing[1], requiredBy: missing[0] })
      }
      entities.push({ id: entity.id, components })
    }
    const validatedResources: Array<readonly [symbol, unknown]> = []
    for (const [name, raw] of Object.entries(saved.resources)) {
      const descriptor = resourcesByName.get(name)
      if (!descriptor || DescriptorModule.isTransient(descriptor)) return Result.failure({ _tag: "UnknownResource", name })
      const value = validate(raw, descriptor)
      if (value === undefined) return Result.failure({ _tag: "UnvalidatedDescriptor", name })
      if (!value.ok) return Result.failure({ _tag: "InvalidResource", name, error: value.error })
      validatedResources.push([descriptor.key, value.value])
    }
    const edges: Array<readonly [Relation.Relation.Any, number, number]> = []
    for (const [name, groups] of Object.entries(saved.relations)) {
      const relation = relationsByName.get(name)
      if (!relation) return Result.failure({ _tag: "UnknownRelation", name })
      const parents = new Map<number, number>()
      for (const [target, sources] of groups) {
        for (const source of sources) {
          const valid = ids.has(source) && ids.has(target) && (relation.allowSelf || source !== target) && !parents.has(source)
          if (!valid) return Result.failure({ _tag: "InvalidRelation", name, sourceId: source, targetId: target })
          parents.set(source, target)
          edges.push([relation, source, target])
        }
      }
      if (relation.relationKind === "hierarchy") {
        for (const [source] of parents) {
          const seen = new Set<number>([source])
          for (let current = parents.get(source); current !== undefined; current = parents.get(current)) {
            if (seen.has(current)) {
              return Result.failure({ _tag: "InvalidRelation", name, sourceId: source, targetId: parents.get(source)! })
            }
            seen.add(current)
          }
        }
      }
    }
    const restoredMachines = new Map(currentMachines)
    for (const [name, raw] of Object.entries(saved.machines)) {
      const machine = machinesByName.get(name)
      if (!machine) return Result.failure({ _tag: "UnknownMachine", name })
      const value = machineSchema(machine).decode(raw)
      if (!value.ok) return Result.failure({ _tag: "InvalidMachineState", name, error: value.error })
      restoredMachines.set(machine.key, sharedValue(machine, value.value))
    }
    // A save has no value for a sub-state whose parent is elsewhere; one that
    // has a value must have its parent in the state it exists in. A sub-state
    // missing while its parent is there enters its entry value.
    for (const machine of options.machineDefinitions) {
      const within = machine.within
      if (within === undefined) continue
      const active = stateOf(restoredMachines.get(within.machine.key)) === within.state
      if (Object.hasOwn(saved.machines, machine.name)) {
        if (!active) {
          return Result.failure({ _tag: "InactiveSubState", name: machine.name, parent: within.machine.name, requires: within.state })
        }
      } else if (active && subStateEntry.has(machine.key)) {
        restoredMachines.set(machine.key, subStateEntry.get(machine.key))
      } else {
        restoredMachines.delete(machine.key)
      }
    }

    const scoped = new Set<number>()
    const memberships: Array<readonly [number, symbol]> = []
    for (const [name, members] of Object.entries(saved.scopes)) {
      if (!options.scopeDefinitions.some((scope) => scope.name === name)) return Result.failure({ _tag: "UnknownScope", name })
      for (const id of members) {
        if (!ids.has(id) || scoped.has(id)) return Result.failure({ _tag: "InvalidScope", name, entityId: id })
        scoped.add(id)
        memberships.push([id, EntityScopeModule.keyOf(name)])
      }
    }

    const rebuiltLocals = localSlots.map(({ make }) => make())

    // Apply: the old world is despawned and the saved one spawned, so change
    // detection and renderer sync observe the restore like any other change.
    // Checkpoints taken before it stand for a world that no longer leads here.
    releaseMarks(0, "restored")
    pendingCommands.length = 0
    pendingOrigins.length = 0
    pendingMachines.clear()
    events.clear()
    transitionEvents.clear()
    relationFailures.clear()
    droppedRelations.clear()
    world.advanceTick()
    world.despawnAll()
    // Exactly the save's: ids allocated after a restore do not depend on the world it replaced.
    world.setNextEntity(Math.max(saved.nextEntity, ...entities.map((entity) => entity.id + 1)))
    for (const entity of entities) {
      world.spawnEntity(world.entityIdOf(entity.id), entity.components)
    }
    for (const [relation, source, target] of edges) {
      world.tryRelate(source, relation, target)
    }
    for (const [id, key] of memberships) world.assignEntityScope(id, key)
    for (const [key, value] of validatedResources) {
      resources.set(key, value)
      resourceChangedAt.set(key, world.currentTick())
    }
    currentMachines.clear()
    for (const [key, value] of restoredMachines) currentMachines.set(key, value)
    // Locals are not saved: each system starts over from its factory.
    localSlots.forEach(({ slot }, index) => { (slot.context as { local: unknown }).local = rebuiltLocals[index] })
    return succeeded
  }

  const tracedRestore = (data: unknown): Result.Result<void, Snapshot.RestoreError> => {
    if (frameOpen) throw openFrameDefect("runtime.restore")
    if (inTick) throw new Error("runtime.restore was called while a schedule is running: the running systems' queued commands would land on the restored world; restore between ticks")
    const result = restore(data)
    if (tracing) emit({ type: "restore", frame: frameCount, tick: world.currentTick(), ok: result.ok })
    return result
  }

  /** What a checkpoint holds beyond the world's mark: the runtime's own stores, copied when it was taken. */
  interface RuntimeMark {
    readonly owner: object
    readonly world: WorldMark
    readonly resources: ReadonlyMap<symbol, unknown>
    readonly resourceChangedAt: ReadonlyMap<symbol, number>
    readonly currentMachines: ReadonlyMap<symbol, unknown>
    readonly pendingMachines: ReadonlyMap<symbol, { value: unknown; skipIfSame: boolean; by?: string }>
    readonly previousMachines: ReadonlyMap<symbol, unknown>
    readonly pendingCommands: ReadonlyArray<Command.DeferredCommand<S>>
    readonly pendingOrigins: ReadonlyArray<string>
    readonly events: Streams.StreamMark
    readonly transitionEvents: Streams.StreamMark
    readonly relationFailures: Streams.StreamMark
    /** Each rewindable service's save, in `rewindables` order; `undefined` when the runtime has none. */
    readonly rewindables: ReadonlyArray<unknown> | undefined
    readonly droppedRelations: Streams.StreamMark
    /** The rewound schedule's systems (their state keys), with each reader's positions then (`undefined`: not run yet). */
    readonly readers: ReadonlyMap<SystemDefinition<any, any, any>, readonly [since: number, lastRun: number, streamSince: number, streamLastRun: number] | undefined>
    released: Checkpoint.Released["reason"] | undefined
  }

  /** Identifies this runtime's checkpoints. */
  const checkpointOwner = {}
  /** Held checkpoints, oldest first, in step with the world's marks. */
  const runtimeMarks: Array<RuntimeMark> = []
  const checkpointWindow = options.checkpoints
  /** The provided `Checkpoint.rewindable` services, saved with every checkpoint. */
  const rewindables = RewindableInternal.collect(providedServices as Readonly<Record<string, unknown>>)

  /** Releases the marks from `from` on (newest last), for `reason`. */
  const releaseMarks = (from: number, reason: Checkpoint.Released["reason"]): void => {
    if (runtimeMarks.length === 0) return
    for (let index = from; index < runtimeMarks.length; index++) runtimeMarks[index]!.released = reason
    if (from === 0) {
      runtimeMarks.length = 0
      world.dropMarks()
    } else {
      runtimeMarks.length = from
    }
    releaseStreams()
  }

  const releaseStreams = (): void => {
    events.release(runtimeMarks.map((mark) => mark.events))
    transitionEvents.release(runtimeMarks.map((mark) => mark.transitionEvents))
    relationFailures.release(runtimeMarks.map((mark) => mark.relationFailures))
    droppedRelations.release(runtimeMarks.map((mark) => mark.droppedRelations))
  }

  /** The systems a schedule runs, transition bundles included, by the key their state is kept under. */
  const rewoundSystems = (steps: ReadonlyArray<Schedule.ScheduleStep>, into: Set<SystemDefinition<any, any, any>>): void => {
    for (const step of steps) {
      if (Schedule.isSystemStep(step)) {
        const system = step as SystemDefinition<any, any, any>
        if (system.spec.local !== undefined) {
          throw new Error(`runtime.checkpoint: ${system.name} keeps local state, which a rewind cannot put back: keep it in a resource or a component`)
        }
        into.add(stateKey(system))
      } else if (step.kind === "applyStateTransitions" && step.bundle !== undefined) {
        for (const schedule of (step.bundle as { readonly entries: ReadonlyArray<{ readonly steps: ReadonlyArray<Schedule.ScheduleStep> }> }).entries) {
          rewoundSystems(schedule.steps, into)
        }
      }
    }
  }

  const checkpoint = (schedule: ExecutableScheduleDefinition<S, any, any, any, any, AnyScheduleOrder>): Checkpoint.Checkpoint<Root> => {
    if (frameOpen) throw openFrameDefect("runtime.checkpoint")
    if (inTick) throw new Error("runtime.checkpoint was called while a schedule is running: the running systems' writes are not committed yet; take it between ticks")
    const systems = new Set<SystemDefinition<any, any, any>>()
    rewoundSystems(schedule.steps, systems)
    const readers = new Map<SystemDefinition<any, any, any>, readonly [number, number, number, number] | undefined>()
    for (const system of systems) {
      const reader = slots.get(system)?.reader
      readers.set(system, reader === undefined ? undefined : [reader.since, reader.lastRun, reader.streamSince, reader.streamLastRun])
    }
    const mark: RuntimeMark = {
      owner: checkpointOwner,
      world: world.takeMark(),
      resources: new Map(resources),
      resourceChangedAt: new Map(resourceChangedAt),
      currentMachines: new Map(currentMachines),
      pendingMachines: new Map(pendingMachines),
      previousMachines: new Map(previousMachines),
      pendingCommands: pendingCommands.slice(),
      pendingOrigins: pendingOrigins.slice(),
      events: events.mark(),
      transitionEvents: transitionEvents.mark(),
      relationFailures: relationFailures.mark(),
      rewindables: rewindables === undefined ? undefined : RewindableInternal.saveAll(rewindables),
      droppedRelations: droppedRelations.mark(),
      readers,
      released: undefined
    }
    runtimeMarks.push(mark)
    if (runtimeMarks.length > checkpointWindow) {
      runtimeMarks.shift()!.released = "window"
      world.releaseOldestMark()
      releaseStreams()
    }
    return CheckpointInternal.make(mark) as Checkpoint.Checkpoint<Root>
  }

  const addAll = (into: Map<number, Set<number>>, from: ReadonlyMap<number, ReadonlySet<number>>): void => {
    for (const [ordinal, ids] of from) {
      let set = into.get(ordinal)
      if (set === undefined) into.set(ordinal, set = new Set<number>())
      for (const id of ids) set.add(id)
    }
  }

  /** Gives a reader outside the rewound schedule what the rewind changed, for its next run. */
  const revert = (reader: ReaderState, rewound: WorldRewind): void => {
    const reverts = reader.reverts ??= { added: new Map(), changed: new Map(), removed: new Map(), despawned: new Set() }
    addAll(reverts.added, rewound.back)
    addAll(reverts.changed, rewound.back)
    addAll(reverts.changed, rewound.written)
    addAll(reverts.removed, rewound.gone)
    for (const id of rewound.despawned) reverts.despawned.add(id)
    // Removals made after the checkpoint that the reader had not read yet: the rewind took them back.
    for (const [ordinal, id, at] of rewound.removedAfter) {
      if (at <= reader.lastRun) continue
      let set = reverts.removed.get(ordinal)
      if (set === undefined) reverts.removed.set(ordinal, set = new Set<number>())
      set.add(id)
    }
    for (const [id, at] of rewound.despawnedAfter) {
      if (at > reader.lastRun) reverts.despawned.add(id)
    }
  }

  const restoreMap = <K, V>(target: Map<K, V>, from: ReadonlyMap<K, V>): void => {
    target.clear()
    for (const [key, value] of from) target.set(key, value)
  }

  const rewind = (value: Checkpoint.Checkpoint<Root>): Result.Result<void, Checkpoint.RewindError> => {
    if (frameOpen) throw openFrameDefect("runtime.rewind")
    if (inTick) throw new Error("runtime.rewind was called while a schedule is running: the running systems' queued commands would land on the rewound world; rewind between ticks")
    const mark = CheckpointInternal.internalOf(value) as RuntimeMark | undefined
    if (mark === undefined || mark.owner !== checkpointOwner) return Result.failure({ _tag: "OtherRuntime" })
    if (mark.released !== undefined) return Result.failure({ _tag: "Released", reason: mark.released })
    // Services first: a failed restore leaves the world as it is.
    if (rewindables !== undefined) {
      const failed = RewindableInternal.restoreAll(rewindables, mark.rewindables!)
      if (failed !== undefined) return Result.failure({ _tag: "RestoreFailed", service: failed.service, error: failed.error })
    }
    const index = runtimeMarks.indexOf(mark)
    const rewound = world.rewindToMark(mark.world)
    for (let newer = index + 1; newer < runtimeMarks.length; newer++) runtimeMarks[newer]!.released = "rewound"
    runtimeMarks.length = index + 1

    restoreMap(resources, mark.resources)
    restoreMap(resourceChangedAt, mark.resourceChangedAt)
    restoreMap(currentMachines, mark.currentMachines)
    restoreMap(pendingMachines, mark.pendingMachines)
    restoreMap(previousMachines, mark.previousMachines)
    pendingCommands.length = 0
    for (const command of mark.pendingCommands) pendingCommands.push(command)
    pendingOrigins.length = 0
    for (const origin of mark.pendingOrigins) pendingOrigins.push(origin)
    events.rewind(mark.events, mark.world.tick)
    transitionEvents.rewind(mark.transitionEvents, mark.world.tick)
    relationFailures.rewind(mark.relationFailures, mark.world.tick)
    droppedRelations.rewind(mark.droppedRelations, mark.world.tick)
    releaseStreams()

    const inside = new Set<ReaderState>()
    for (const [system, positions] of mark.readers) {
      const reader = slots.get(system)?.reader
      if (reader === undefined) continue
      inside.add(reader)
      // A system first run after the checkpoint starts over, as if it never ran.
      const [since, lastRun, streamSince, streamLastRun] = positions ?? [0, 0, 0, 0]
      reader.since = since
      reader.lastRun = lastRun
      reader.streamSince = streamSince
      reader.streamLastRun = streamLastRun
      reader.reverts = undefined
    }
    for (const reader of allReaders) {
      // A reader that has not run since the checkpoint never saw what the rewind undid.
      if (!inside.has(reader) && reader.lastRun > mark.world.tick) revert(reader, rewound)
    }
    return succeeded
  }

  const runtime: Runtime<S, Services, Resources, Root, Machines> = {
    schema: options.schema,
    services: providedServices,
    resourceValues: options.resources as Resources,
    machineValues: providedMachines,
    tick(...schedules) {
      return tickUnsafe(schedules) as never
    },
    tryTick: tryRunSchedule,
    // The gate is type-only: the functions exist on every runtime.
    snapshot: snapshot as unknown as Snapshot.Gate<S, typeof snapshot>,
    checksum: checksum as unknown as Snapshot.Gate<S, typeof checksum>,
    restore: tracedRestore as unknown as Snapshot.Gate<S, typeof restore>,
    checkpoint: checkpoint as Runtime<S, Services, Resources, Root, Machines>["checkpoint"],
    // Restore failures are typed per service in the interface; the runtime only knows their names.
    rewind: rewind as Runtime<S, Services, Resources, Root, Machines>["rewind"],
    inspect,
    send: send as Runtime<S, Services, Resources, Root, Machines>["send"]
  }
  if (!debugEnabled) {
    return runtime
  }

  const keyedNames = <A extends { readonly key: symbol }>(entries: Iterable<readonly [string, A]>): Map<symbol, string> =>
    new Map([...entries].map(([name, value]) => [value.key, name] as const))
  debugNames = {
    resources: keyedNames(resourcesByName),
    events: keyedNames((Object.values(options.schema.events) as ReadonlyArray<Descriptor.Any>).map((descriptor) => [descriptor.name, descriptor] as const)),
    machines: keyedNames(machinesByName),
    relations: keyedNames(relationsByName)
  }

  const worldHooks: WorldHooks = {
    spawned: (entity, components) => recordEffect({ kind: "spawn", entity, components }),
    despawned: (entity) => recordEffect({ kind: "despawn", entity }),
    inserted: (entity, ordinal, value) =>
      recordEffect({ kind: "insert", entity, component: world.descriptorAt(ordinal).name, value }),
    overwritten: (entity, ordinal, before, after) =>
      recordEffect({ kind: "overwrite", entity, component: world.descriptorAt(ordinal).name, before, after }),
    removed: (entity, ordinal) => recordEffect({ kind: "remove", entity, component: world.descriptorAt(ordinal).name }),
    related: (entity, relation, target) => recordEffect({ kind: "relate", entity, relation: relation.name, target }),
    unrelated: (entity, relation) => recordEffect({ kind: "unrelate", entity, relation: relation.name })
  }

  const dump = (filter?: Debug.DumpFilter<S>): Debug.WorldDump => {
    const required = (filter?.with ?? []).map((descriptor) => world.ordinalOf(descriptor))
    const only = filter?.entities === undefined ? undefined : new Set(filter.entities)
    const limit = filter?.limit ?? Number.POSITIVE_INFINITY
    const entities: Array<Debug.EntityDump> = []
    for (const record of [...world.records.values()].sort((left, right) => left.id - right.id)) {
      if (entities.length >= limit) break
      if (only !== undefined && !only.has(record.id)) continue
      if (!required.every((ordinal) => world.has(record, ordinal))) continue
      const components: Record<string, unknown> = {}
      for (const ordinal of record.held) components[world.descriptorAt(ordinal).name] = world.valueAt(record, ordinal)
      const relations: Record<string, number> = {}
      for (const relation of world.relationDefinitions) {
        const target = world.relationTarget(relation, record.id)
        if (target !== undefined) relations[relation.name] = target
      }
      entities.push({ id: record.id, components, relations })
    }
    const dumpedResources: Record<string, unknown> = {}
    for (const [name, descriptor] of resourcesByName) {
      if (resources.has(descriptor.key)) dumpedResources[name] = resources.get(descriptor.key)
    }
    const dumpedMachines: Record<string, Debug.MachineDump> = {}
    for (const [name, machine] of machinesByName) {
      const current = currentMachines.get(machine.key)
      if (current === undefined) continue
      const pending = pendingMachines.get(machine.key)
      const previous = previousMachines.get(machine.key)
      dumpedMachines[name] = {
        current: current as Machine.AnyValue,
        ...(pending === undefined ? {} : { pending: pending.value as Machine.AnyValue }),
        ...(previous === undefined ? {} : { previous: previous as Machine.AnyValue })
      }
    }
    return {
      version: 1,
      frame: frameCount,
      tick: world.currentTick(),
      entityCount: world.records.size,
      entities,
      resources: dumpedResources,
      machines: dumpedMachines,
      pendingCommands: pendingCommands.map((command, index) => ({ tag: command.tag, system: pendingOrigins[index] ?? "(unknown)" }))
    }
  }

  const streams = (): ReadonlyArray<Debug.StreamStatus> => {
    const result: Array<Debug.StreamStatus> = []
    const windowBoundary = world.retainedAfter()
    const inspectStore = (
      kind: Debug.StreamStatus["kind"],
      store: Streams.Streams<unknown>,
      names: ReadonlyMap<symbol, string>
    ): void => {
      for (const entry of store.inspect()) {
        let holder: { readonly system: string; readonly lastRun: number } | undefined
        const readers = entry.readers.map((cursor): Debug.StreamReaderStatus => {
          const known = streamReaders.get(cursor)
          const system = known?.system ?? "(unknown)"
          if (holder === undefined || cursor.streamLastRun < holder.lastRun) holder = { system, lastRun: cursor.streamLastRun }
          return {
            system,
            unread: store.since(entry.key, cursor.streamLastRun).length,
            lagged: known !== undefined && store.lagged(entry.key, known.reader.streamLastRun, known.reader.registeredAt)
          }
        })
        const heldByReader = entry.oldestTick !== undefined && entry.oldestTick <= windowBoundary
          && holder !== undefined && holder.lastRun < entry.oldestTick
        result.push({
          kind,
          stream: names.get(entry.key) ?? "(unknown)",
          size: entry.size,
          capacity: store.capacity,
          readers,
          heldBy: heldByReader ? holder!.system : undefined
        })
      }
    }
    inspectStore("event", events, debugNames!.events)
    inspectStore("transitionEvent", transitionEvents as Streams.Streams<unknown>, debugNames!.machines)
    inspectStore("relationFailure", relationFailures as Streams.Streams<unknown>, debugNames!.relations)
    inspectStore("droppedRelation", droppedRelations as Streams.Streams<unknown>, debugNames!.relations)
    return result
  }

  /**
   * `debug.beginFrame`: the frame `tryTick(schedule)` runs, one step per
   * `next()`. It replays `tryTick`, `runScheduleUnsafe`, and `runSteps` in
   * order (checks, frame advance, host and trace events, steps, ignored
   * failures), so a stepped frame and a ticked one are the same frame.
   */
  const beginFrame = (
    schedule: ExecutableScheduleDefinition<S, any, any, any, any, AnyScheduleOrder>
  ): Result.Result<Debug.FrameCursor<SystemFailure>, MissingRuntimeRequirements | TickOrderViolation> => {
    if (frameOpen) throw openFrameDefect("debug.beginFrame")
    if (inTick) throw new Error("debug.beginFrame was called while a schedule is running: begin a frame between ticks")
    reportUnread("next-tick")
    const missing = schedule.requirements
      .filter((requirement) => !hasRequirement(requirement))
      .map(({ kind, name }) => ({ kind, name }))
    if (missing.length > 0) {
      return watchResult(Result.failure({ kind: "MissingRuntimeRequirements" as const, requirements: missing }), [schedule])
    }
    const issues = OrderInternal.tickOrderIssues(schedule.steps)
    if (issues.length > 0) {
      return watchResult(Result.failure({ kind: "TickOrderViolation" as const, issues }), [schedule])
    }
    const steps = schedule.steps
    inTick = true
    try {
      advanceFrame()
    } finally {
      inTick = false
    }
    const frame = frameCount
    const hosted = hostListeners.size > 0
    if (hosted) emitHost({ type: "tick.start", schedules: [schedule], frame })
    changedMachines = new Set()
    const label = scheduleName(schedule)
    // Like `traceSchedule`: the schedule events are emitted when tracing was on at its start.
    const traced = tracing
    if (traced) emit({ type: "schedule.start", frame, schedule: label })
    const started = traced ? now() : 0
    let index = 0
    let ended = false
    frameOpen = true
    const end = (result: Result.Result<void, SystemFailure>): void => {
      ended = true
      frameOpen = false
      if (traced) emit({ type: "schedule.end", frame, schedule: label, ok: result.ok, ms: HostClockModule.elapsed(started, now()) })
      if (hosted) {
        emitHost(result.ok
          ? { type: "tick.end", schedules: [schedule], frame, outcome: "ok" }
          : { type: "tick.end", schedules: [schedule], frame, outcome: "failed", error: result.error })
      }
    }
    const runStep = (step: Schedule.ScheduleStep, at: number): Result.Result<void, SystemFailure> => {
      if (Schedule.isSystemStep(step)) return runSystem(step as SystemDefinition<any, any, any>, schedule, at)
      if (step.kind === "applyDeferred") {
        applyDeferred()
        return succeeded
      }
      return applyStateTransitions(step.bundle as never)
    }
    const cursor: Debug.FrameCursor<SystemFailure> = {
      frame,
      remaining: () => ended ? [] : steps.slice(index).map(DebugInternal.describeStep),
      next: () => {
        if (ended) throw new Error("FrameCursor.next was called after the frame ended: begin another frame")
        const at = index
        const step = steps[at]!
        index += 1
        inTick = true
        schedulePath.push(label)
        let result: Result.Result<void, SystemFailure>
        try {
          result = runStep(step, at)
        } catch (defect) {
          ended = true
          frameOpen = false
          if (hosted) emitHost({ type: "tick.end", schedules: [schedule], frame, outcome: "defect", error: defect })
          throw defect
        } finally {
          schedulePath.pop()
          inTick = false
        }
        if (!result.ok) {
          end(result)
          return watchResult(result, [schedule]) as unknown as Result.Result<Debug.StepOutcome, SystemFailure>
        }
        const last = index === steps.length
        if (last) end(result)
        return Result.success({ step: DebugInternal.describeStep(step), ended: last })
      }
    }
    if (steps.length === 0) end(succeeded)
    return Result.success(cursor)
  }

  const handle: Debug.Handle<S, Root> = {
    beginFrame: beginFrame as Debug.Handle<S, Root>["beginFrame"],
    nameSchedules(named) {
      scheduleNames.clear()
      for (const [name, schedule] of Object.entries(named)) scheduleNames.set(schedule, name)
    },
    declareHostEvents(declared) {
      hostEvents = new Set(declared.map((descriptor) => descriptor.name))
    },
    describe: () => DebugInternal.describe({
      schema: options.schema,
      machines: [...new Set(machinesByName.values())],
      currentMachine: (machine) => currentMachines.get(machine.key) as Machine.AnyValue | undefined,
      providesMachine: (machine) => providedMachineKeys.has(machine.key),
      scopes: options.scopeDefinitions,
      providedServices: Object.keys(providedServices),
      serviceLints: Object.entries(providedServices as Record<string, unknown>).flatMap(([name, value]) => {
        const report = typeof value === "object" && value !== null ? (value as Partial<Debug.ReportsLints>)[Debug.serviceLints] : undefined
        return typeof report === "function" ? [[name, report.call(value)] as const] : []
      }),
      externallyWrittenEvents: new Set([...externallyWrittenEvents, ...hostEvents]),
      relationMutations,
      commandUses,
      ranSystems,
      consumedPlacements: [...consumedAt].map(([name, bySchedule]) => [name, [...bySchedule].flatMap(([schedule, steps]) => {
        const named = scheduleNames.get(schedule)
          ?? ("transition" in schedule ? DebugInternal.transitionScheduleName(schedule as Machine.StateMachine.AnyTransitionSchedule<S, Root>) : undefined)
        return [...steps].map(([index, system]) => named === undefined
          ? `${system} (${scheduleName(schedule)}, step ${index}, unnamed)`
          : `${system} (${named}#${index})`)
      })] as const),
      requirementViolations: [...requirementViolations.values()],
      nextStateReplacements: [...nextStateReplacements.values()],
      staleTargets: [...staleTargets.values()],
      streamLosses: [...streamLosses.values()],
      hasResource: (descriptor) => resources.has(descriptor.key),
      schedules: [...scheduleNames].map(([schedule, name]) => [name, schedule as ExecutableScheduleDefinition<S>] as const)
    }),
    dump,
    observe(listener) {
      traceListeners.add(listener)
      tracing = true
      world.setHooks(worldHooks)
      return () => {
        traceListeners.delete(listener)
        if (traceListeners.size === 0) {
          tracing = false
          world.setHooks(undefined)
        }
      }
    },
    observeHost(listener) {
      hostListeners.add(listener)
      return () => {
        hostListeners.delete(listener)
      }
    },
    checkIgnoredFailures: () => reportUnread("session-end"),
    streams,
    population: () => {
      const components: Record<string, number> = {}
      for (const descriptor of Object.values(options.schema.components) as ReadonlyArray<Descriptor<"component", string, unknown>>) {
        components[descriptor.name] = world.membersOf(world.ordinalOf(descriptor)).size
      }
      return { entities: world.records.size, components }
    },
    frame: () => frameCount
  }
  return Object.assign(runtime, { debug: handle })
}

/**
 * Creates a runtime for a fully built schema and a set of external services.
 *
 * Resources owned by constructed descriptors take raw input and are validated
 * here. The runtime always comes back as a `Result`: typed `Success` when
 * nothing provided can fail (read `.value`), and a `Result` to check when a
 * constructed resource is provided.
 *
 * The runtime does not own the outer frame loop. It only owns ECS state plus
 * the host-provided services that systems are allowed to depend on.
 *
 * @example
 * ```ts
 * const runtime = Game.Runtime.make({
 *   services: Game.Runtime.services(
 *     Game.Runtime.service(Logger, { log: console.log })
 *   ),
 *   resources: { Score: 0 },
 *   machines: Game.Runtime.machines(Game.Runtime.machine(GameFlow, { _tag: "Menu" }))
 * })
 * if (!runtime.ok) throw new Error(JSON.stringify(runtime.error))
 * ```
 */
export const make = <
  S extends Schema.Any,
  const ProvidedServices extends RuntimeServices<any>,
  const Resources extends RuntimeResources<S> = {},
  Root = unknown,
  const ProvidedMachines extends RuntimeMachines<any> = RuntimeMachines<{}>,
  const Enabled extends Debug.Option | undefined = undefined
>(options: {
  readonly schema: S
  readonly services: ProvidedServices
  readonly resources?: Resources & ExactResources<S, Resources>
  readonly machines?: ProvidedMachines
  readonly machineDefinitions?: ReadonlyArray<Machine.StateMachine.Any>
  /** Scopes whose members a committed state change despawns; `Game.Runtime.make` passes every `Game.EntityScope`. */
  readonly scopeDefinitions?: ReadonlyArray<EntityScopeModule.EntityScope.Any>
  /** Attaches a `debug` handle to the runtime, timed by `hostClock`; see the `Debug` module. */
  readonly debug?: Enabled
  /** The game's save migrations (`Snapshot.migrations`), applied by `restore`. */
  readonly saves?: Snapshot.Migrations
  /** How many checkpoints `runtime.checkpoint` keeps, a positive whole number ({@link Checkpoint.defaultWindow} by default). */
  readonly checkpoints?: number
}): MakeRuntimeResult<S, Simplify<RuntimeServicesOf<ProvidedServices>>, Resources, Root, RuntimeMachinesOf<ProvidedMachines>, Enabled> => {
  const validated = collectConstructedRegistryValues(options.schema.resources, options.resources)
  if (!validated.ok) {
    return Result.failure({ resources: validated.error }) as never
  }
  const checkpoints = options.checkpoints ?? Checkpoint.defaultWindow
  if (!Number.isSafeInteger(checkpoints) || checkpoints < 1) {
    throw new Error(`Game.Runtime.make: checkpoints must be a positive whole number, got ${checkpoints}`)
  }
  const runtime = makeValidatedRuntime({
    schema: options.schema,
    services: options.services,
    resources: validated.value,
    machines: options.machines,
    machineDefinitions: options.machineDefinitions ?? [],
    scopeDefinitions: options.scopeDefinitions ?? [],
    debug: options.debug,
    saves: options.saves,
    checkpoints
  })
  return Result.success(runtime) as never
}

/** Names listed more than once in `Names` (a tuple), in order of their second listing. */
type RepeatedNames<Names extends ReadonlyArray<string>, Seen extends string = never> =
  Names extends readonly [infer Head extends string, ...infer Tail extends ReadonlyArray<string>]
    ? (string extends Head ? never : Head extends Seen ? Head : never) | RepeatedNames<Tail, Seen | Head>
    : never

type ProvidedServiceNames<Entries extends ReadonlyArray<ServiceProvision>> = {
  readonly [K in keyof Entries]: Entries[K] extends ServiceProvision<infer D> ? D["name"] : string
}
type ProvidedMachineNames<Entries extends ReadonlyArray<MachineProvision>> = {
  readonly [K in keyof Entries]: Entries[K] extends MachineProvision<infer M> ? M["name"] : string
}

/** Rejects a service provided twice: only the last would be used. */
type UniqueServices<Entries extends ReadonlyArray<ServiceProvision>> =
  [RepeatedNames<ProvidedServiceNames<Entries>>] extends [never] ? unknown : {
    readonly __fixServices__: `${RepeatedNames<ProvidedServiceNames<Entries>>} is provided twice: keep one Game.Runtime.service(...) for it`
  }

/** Rejects a machine started twice: only the last initial value would be used. */
type UniqueMachines<Entries extends ReadonlyArray<MachineProvision>> =
  [RepeatedNames<ProvidedMachineNames<Entries>>] extends [never] ? unknown : {
    readonly __fixMachines__: `${RepeatedNames<ProvidedMachineNames<Entries>>} is provided twice: keep one Game.Runtime.machine(...) for it`
  }

const rejectRepeated = (names: ReadonlyArray<string>, kind: "service" | "machine"): void => {
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) throw new Error(`${name} is provided twice: keep one Game.Runtime.${kind}(...) for it`)
    seen.add(name)
  }
}

/**
 * Builds the descriptor-backed runtime service environment.
 *
 * This is the runtime-side counterpart to `Game.System.service(...)` and
 * `Game.System.consumeService(...)`. Use it
 * to assemble the host implementations the game exposes to systems, such as
 * render bridges, audio sinks, logs, or network clients. Simulation time is
 * `Clock` and randomness is the `Random` resource; neither is a service.
 *
 * The helper keeps the runtime map keyed by service descriptors instead of
 * ad hoc strings, so the provision site cannot drift from the declaration site.
 * Each service is provided once: a second provision of the same one does not
 * compile.
 *
 * @example
 * ```ts
 * declare const audioHost: { play: (sound: string) => void }
 * // ---cut---
 * // Bundle host capabilities once when building the runtime.
 * const services = Game.Runtime.services(
 *   Game.Runtime.service(Logger, { log: console.log }),
 *   Game.Runtime.service(Audio, { play: (sound) => audioHost.play(sound) })
 * )
 * ```
 */
export const services = <
  const Entries extends ReadonlyArray<ServiceProvision>
>(...entries: Entries & UniqueServices<Entries>): RuntimeServices<ServiceEntriesToRecord<Entries>> => {
  rejectRepeated(entries.map((entry) => entry.descriptor.name), "service")
  const provided: Record<string, unknown> = {}
  for (const { descriptor, implementation } of entries) {
    provided[descriptor.name] = implementation
  }
  return provided as RuntimeServices<ServiceEntriesToRecord<Entries>>
}

/**
 * Creates one service provision for `Runtime.services(...)`.
 *
 * Use this at the runtime assembly boundary to pair a service descriptor with
 * its concrete host implementation. Passing the descriptor first keeps the
 * implementation object contextually typed and makes the dependency relation
 * obvious in docs and code review.
 */
export const service = <
  D extends Descriptor<"service", string, any>
>(
  descriptor: D,
  implementation: Descriptor.Value<D>
): ServiceProvision<D> => ({
  descriptor,
  implementation
})

/**
 * Builds the machine initialization environment from machine definitions.
 *
 * Use this when gameplay phases need a known committed starting state before
 * any schedule runs, for example `"Boot"`, `"Menu"`, or `"Playing"`. Each
 * machine is provided once: a second provision of the same one does not
 * compile.
 */
export const machines = <
  const Entries extends ReadonlyArray<MachineProvision>
>(...entries: Entries & UniqueMachines<Entries>): RuntimeMachines<MachineEntriesToRecord<Entries>> => {
  rejectRepeated(entries.map((entry) => entry.machine.name), "machine")
  const provided: Record<string, unknown> = {}
  for (const { machine, initial } of entries) {
    provided[machine.name] = initial
  }
  return {
    ...provided,
    [runtimeMachinesEntries]: entries
  } as unknown as RuntimeMachines<MachineEntriesToRecord<Entries>>
}

/**
 * Creates one machine initialization provision.
 *
 * This is the machine-side equivalent of `Runtime.service(...)`: it pairs one
 * machine definition with the committed initial value the runtime should start
 * from before any transition schedule runs.
 *
 * @example
 * ```ts
 * // Start the game in a known committed phase.
 * const machines = Game.Runtime.machines(
 *   Game.Runtime.machine(GameFlow, { _tag: "Menu" })
 * )
 * ```
 */
export const machine = <
  M extends Machine.StateMachine.Any
>(
  stateMachine: M,
  initial: ReadonlyValue<Machine.StateOf<M>>
): MachineProvision<M> => ({
  machine: stateMachine,
  initial
})
