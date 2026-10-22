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
 * // Provide the host capabilities systems declared as services. Simulation
 * // time comes from `Clock` and randomness from the `Random` resource
 * // (`@typeonce/ritmo-math`), never from a service.
 * const services = Game.Runtime.services(
 *   Game.Runtime.service(Audio, { play: (sound) => audioHost.play(sound) }),
 *   Game.Runtime.service(Nodes, nodeRegistry)
 * )
 *
 * // make always returns a Result. Viewport is a constructed resource, so
 * // validating it can fail and the Result must be checked.
 * const runtime = Game.Runtime.make({
 *   services,
 *   resources: {
 *     viewport: { width: 800, height: 600 },
 *     rng: Random.seed(0x5eed)
 *   },
 *   machines: Game.Runtime.machines(
 *     Game.Runtime.machine(GameFlow, "Boot")
 *   )
 * })
 *
 * if (runtime._tag === "Failure") {
 *   throw new Error("Invalid runtime bootstrap data")
 * }
 *
 * // The runtime owns the world and executes explicit schedules.
 * runtime.success.tick(setupSchedule)
 * runtime.success.tick(updateSchedule)
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
import * as Command from "./Command.ts"
import type * as Debug from "./Debug.ts"
import * as DescriptorModule from "./Descriptor.ts"
import type { Descriptor } from "./Descriptor.ts"
import type * as Entity from "./Entity.ts"
import type * as Inspector from "./Inspector.ts"
import * as Cells from "./internal/cells.ts"
import { sameValue } from "./internal/equal.ts"
import * as DebugInternal from "./internal/debug.ts"
import { makeQueryEngine } from "./internal/queries.ts"
import { requirementIndex } from "./internal/requirements.ts"
import * as Streams from "./internal/streams.ts"
import { ABSENT, makeWorld } from "./internal/world.ts"
import type { WorldHooks } from "./internal/world.ts"
import type * as Machine from "./Machine.ts"
import * as Query from "./Query.ts"
import type { QueryMatch, ReadonlyValue } from "./Query.ts"
import * as Relation from "./Relation.ts"
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
  RemovedReadView,
  TransitionEventReadView,
  MachineReadView,
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
 *   )
 * }).value
 *
 * runtime.tick(updateSchedule)
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
 * Why `make` failed: validation failures for constructed resources, keyed by
 * schema key.
 */
export type RuntimeConstructionError<S extends Schema.Any, Provided> = Simplify<{
  readonly _tag: "RuntimeConstructionError"
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
 * provided can fail, so `.success` is the runtime; when a provided resource
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

/**
 * One machine-backed runtime state provision.
 */
export interface MachineProvision<M extends Machine.StateMachine.Any = Machine.StateMachine.Any> {
  readonly machine: M
  readonly initial: Machine.StateMachine.Value<M>
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
          readonly [K in M["name"]]: Machine.StateMachine.Value<M>
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
  : Need extends Machine.StateMachineDefinition<infer Name, infer Values, any>
    ? Name extends keyof Machines
      ? [Machines[Name]] extends [Values[number]] ? never : {
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

export type ValidateSchedules<
  Schedules extends ReadonlyArray<ExecutableScheduleDefinition<any, any, any, any, any, AnyScheduleOrder>>,
  Services extends Record<string, unknown>,
  Resources extends object,
  Machines extends object
> = {
  readonly [K in keyof Schedules]:
    Schedules[K] & ValidateSchedule<
      Extract<Schedules[K], ExecutableScheduleDefinition<any, any, any, any, any, AnyScheduleOrder>>,
      Services,
      Resources,
      Machines
    >
}

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

export type AnyRequirements = Requirement.Requirement

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
    return Result.succeed({})
  }

  const validated = {} as Partial<Record<keyof R, unknown>>
  const errors = {} as Partial<Record<keyof R, unknown>>

  for (const [schemaKey, descriptor] of Object.entries(registry) as Array<[keyof R, R[keyof R]]>) {
    const next = provided[schemaKey]
    if (next === undefined) {
      continue
    }

    const constructor = DescriptorModule.constructorOf(descriptor)
    if (!constructor) {
      validated[schemaKey] = next
      continue
    }

    const result = constructor.result(next as never)
    if (result._tag === "Failure") {
      errors[schemaKey] = result.failure
      continue
    }

    validated[schemaKey] = result.success
  }

  if (Object.keys(errors).length > 0) {
    return Result.fail(errors as Partial<{ readonly [K in keyof R]: unknown }>)
  }

  return Result.succeed(validated as InitialRegistryValues<R>)
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
   * relation edges, resources, and committed machine values.
   *
   * A value whose constructor has an `encode` is saved encoded; a value
   * without one is shared with the world, not copied: serialize the snapshot
   * (for example with `JSON.stringify`) to detach it. Transient components and
   * resources are skipped. Fails only when an `encode` rejects a value.
   *
   * Callable only when every component and resource is constructed or
   * transient; see the `Snapshot` module. Take it between ticks: calling it
   * while a schedule is running (from a system, a service, or a trace
   * callback) throws.
   */
  readonly snapshot: Snapshot.Gate<S, () => Result.Result<Snapshot.WorldSnapshot, Snapshot.SnapshotError>>
  /**
   * Replaces the world with a snapshot after validating it against the
   * schema. On failure nothing changes. See the `Snapshot` module. Restore
   * between ticks: calling it while a schedule is running throws. A current
   * resource the save lacks keeps its value.
   */
  readonly restore: Snapshot.Gate<S, (data: unknown) => Result.Result<void, Snapshot.RestoreError>>
  /**
   * Evaluates one read-only projection without running a schedule. Like a
   * system, the inspector sees `added`/`changed` matches, removed and
   * despawned records, and events published since its own previous
   * evaluation, once.
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
   * The event must belong to the schema. Calling it while a schedule is
   * running is a defect and throws: inside a tick, emit from a system.
   */
  readonly send: <D extends Schema.EventDescriptor<S>>(descriptor: D, value: ReadonlyValue<Descriptor.Value<D>>) => void
}

/**
 * Creates a runtime for a fully built schema and a set of external services.
 *
 * Use this when bootstrap data is already in carried form and you want the
 * most direct path from bound schema to executable world. This is the final
 * assembly step that turns the type-level ECS design into a concrete runtime
 * value.
 *
 * The runtime does not own the outer frame loop. It only owns ECS state plus
 * the host-provided services that systems are allowed to depend on.
 *
 * @example
 * ```ts
 * // Assemble the world once all schema and schedules are defined.
 * const runtime = Game.Runtime.make({
 *   services: Game.Runtime.services(
 *     Game.Runtime.service(Logger, { log: console.log })
 *   ),
 *   resources: {
 *     score: 0
 *   }
 * }).value
 * ```
 */
/**
 * Most entries one event, transition-event, relation-failure, removed, or
 * despawned stream keeps for readers that have not run yet. Past it the
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
  if (save.gameVersion > latest) return Result.fail({ _tag: "NewerGameVersion", gameVersion: save.gameVersion, latest })
  let current = save
  for (const step of saves?.steps ?? []) {
    if (step.to <= current.gameVersion) continue
    const next = Snapshot.parse({ ...step.migrate(current), gameVersion: step.to })
    if (next._tag === "Failure") return next
    current = next.success
  }
  return Result.succeed(current)
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
  /**
   * Machine keys changed by transitions applied during the current schedule run.
   */
  let changedMachines = new Set<symbol>()
  /**
   * Active transition payloads for schedules running inside a transition phase.
   */
  const activeTransitions = new Map<symbol, Machine.TransitionSnapshot>()

  /**
   * Event, transition-event, and relation-failure logs. Entries are stamped
   * with the change tick at which they were published; each reader sees the
   * entries published after its previous completed run. Entries are kept for
   * the current and previous frame, and beyond that until every system that
   * reads them has run, up to `streamCapacity` entries per stream.
   */
  const events = Streams.make<unknown>(streamCapacity)
  const transitionEvents = Streams.make<Machine.TransitionSnapshot>(streamCapacity)
  const relationFailures = Streams.make<Relation.Relation.MutationFailure<Relation.Relation.Any, S, Root>>(streamCapacity)

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
    currentMachines.set(provision.machine.key, provision.initial)
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
    if (machine.within !== undefined && currentMachines.get(machine.within.machine.key) !== machine.within.state) {
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
      Relation.mutationFailure(
        relation,
        operation,
        world.entityIdOf(sourceId) as Entity.EntityId<S, Root>,
        world.entityIdOf(targetId) as Entity.EntityId<S, Root>,
        error
      )
    ])
  }

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
        record?.values.forEach((value, ordinal) => {
          if (value !== ABSENT) noteCommand("despawns", world.descriptorAt(ordinal).name)
        })
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
      if (result._tag === "Failure") {
        appendRelationFailure(relation, "relate", id, target, result.failure)
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
      if (result._tag === "Failure") {
        const targetId = result.failure._tag === "MissingChildEntity"
          || result.failure._tag === "DuplicateChild"
          || result.failure._tag === "ChildNotRelatedToParent"
          ? result.failure.childId
          : id
        appendRelationFailure(relation, "reorderChildren", id, targetId, result.failure)
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
  }

  const resolve = <Q extends Query.Query.Any<Root>>(id: number, query: Q, reader: ReaderState) =>
    queries.get(id, query, reader.since) as Result.Result<QueryMatch<S, Q>, Query.Query.LookupError>

  const relatedTarget = (
    target: Entity.EntityId<S, Root>,
    relation: Relation.Relation.Any
  ): Result.Result<Entity.EntityId<S, Root>, Relation.Relation.LookupError> => {
    if (!world.records.has(target)) {
      return Result.fail(Relation.missingEntityError(target))
    }
    const targetId = world.relationTarget(relation, target)
    if (targetId === undefined) {
      return Result.fail(Relation.missingRelationError(target, relation.name))
    }
    return Result.succeed(entityId(targetId))
  }

  const makeLookup = (reader: ReaderState): LookupApi<S, Root> => {
    const lookup: LookupApi<S, Root> = {
    related: relatedTarget,
    relatedSources(target, relation) {
      if (!world.records.has(target)) {
        return Result.fail(Relation.missingEntityError(target))
      }
      return Result.succeed(world.relatedSourceIds(relation, target).map(entityId))
    },
    parent: relatedTarget,
    ancestors(target, relation) {
      if (!world.records.has(target)) {
        return Result.fail(Relation.missingEntityError(target))
      }
      const ancestors: Array<Entity.EntityId<S, Root>> = []
      let current = world.relationTarget(relation, target)
      while (current !== undefined) {
        ancestors.push(entityId(current))
        current = world.relationTarget(relation, current)
      }
      return Result.succeed(ancestors)
    },
    descendants(target, relation, options) {
      if (!world.records.has(target)) {
        return Result.fail(Relation.missingEntityError(target))
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
      return Result.succeed(descendants)
    },
    root(target, relation) {
      if (!world.records.has(target)) {
        return Result.fail(Relation.missingEntityError(target))
      }
      let current: number = target
      let parentId = world.relationTarget(relation, current)
      while (parentId !== undefined) {
        current = parentId
        parentId = world.relationTarget(relation, current)
      }
      return Result.succeed(entityId(current))
    }
  }
    return lookup
  }

  const makeQueryHandle = <Q extends Query.Query.Any<Root>>(query: Q, reader: ReaderState, lookup: LookupApi<S, Root>): QueryIteration<S, Q> & QueryLookups<S, Q> => {
    const each = () => queries.each(query, reader.since) as ReadonlyArray<QueryMatch<S, Q>>
    const matching = (ids: ReadonlyArray<Entity.EntityId<S, Root>>): Array<QueryMatch<S, Q>> => {
      const matches: Array<QueryMatch<S, Q>> = []
      for (const id of ids) {
        const resolved = resolve(id, query, reader)
        if (resolved._tag === "Success") matches.push(resolved.success)
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
        if (!world.records.has(target)) return Result.fail(Relation.missingEntityError(target))
        return Result.succeed(matching(world.relatedSourceIds(relation, target).map(entityId)))
      },
      descendants(target, relation, options) {
        const ids = lookup.descendants(target, relation, options)
        return ids._tag === "Success" ? Result.succeed(matching(ids.success)) : ids
      },
      single() {
        const matches = each()
        if (matches.length === 0) {
          return Result.fail(Query.noEntitiesError())
        }
        if (matches.length > 1) {
          return Result.fail(Query.multipleEntitiesError(matches.length))
        }
        return Result.succeed(matches[0]!)
      },
      singleOptional() {
        const matches = each()
        if (matches.length > 1) {
          return Result.fail(Query.multipleEntitiesError(matches.length))
        }
        return Result.succeed(matches[0])
      }
    }
  }

  /**
   * Journal for the running system's resource, state, event, and queued
   * machine writes. Component writes are journaled by the world. On an
   * expected failure everything is restored and the system's commands are
   * discarded; on success, buffered events are published at a fresh tick,
   * so every reader (including the emitter's next run) sees them.
   */
  const absentValue = Symbol("ritmo/absent-value")
  const resourceOriginals = new Map<symbol, unknown>()
  const machineOriginals = new Map<symbol, { value: unknown; skipIfSame: boolean } | typeof absentValue>()
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
    readonly readers: Map<ReaderState, readonly [since: number, lastRun: number, streamSince: number, streamLastRun: number]>
  }
  let phase: Phase | undefined

  /** Keeps a reader's position from before the phase, the first time the phase moves it. */
  const journalReader = (reader: ReaderState): void => {
    if (phase !== undefined && !phase.readers.has(reader)) {
      phase.readers.set(reader, [reader.since, reader.lastRun, reader.streamSince, reader.streamLastRun])
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
      readers: new Map()
    }
    phase = opened
    world.beginPhase()
    let result: Result.Result<void, SystemFailure> | undefined
    try {
      result = run()
    } finally {
      phase = undefined
      if (result?._tag === "Success") {
        world.commitPhase()
      } else {
        world.rollbackPhase()
        restoreStore(resources, opened.resources)
        for (const [key, value] of opened.machines) {
          if (value === absentValue) pendingMachines.delete(key)
          else pendingMachines.set(key, value)
        }
        for (const [key, tick] of opened.resourceChangedAt) {
          if (tick === undefined) resourceChangedAt.delete(key)
          else resourceChangedAt.set(key, tick)
        }
        for (const [reader, [since, lastRun, streamSince, streamLastRun]] of opened.readers) {
          reader.since = since
          reader.lastRun = lastRun
          reader.streamSince = streamSince
          reader.streamLastRun = streamLastRun
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
  ) => Cells.storeWrite(store, descriptor.key, write, DescriptorModule.constructorOf(descriptor))

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
        return world.removedSince(ordinal, reader.since).map(entityId)
      },
      lagged() {
        return world.removedLagged(ordinal, reader.since, reader.registeredAt)
      }
    }
  }

  const makeDespawnedReadView = (reader: ReaderState): DespawnedReadView<S, Root> => ({
    all() {
      return world.despawnedSince(reader.since).map(entityId)
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

  const makeMachineReadView = <M extends Machine.StateMachine.Any>(stateMachine: M): MachineReadView<M> => ({
    get: () => currentMachines.get(stateMachine.key) as Machine.CurrentValue<M>,
    is: (value) => currentMachines.get(stateMachine.key) === value
  })

  /** Queues a next value; a sub-state whose parent is in another state queues nothing and fails. */
  const queueMachine = <M extends Machine.StateMachine.Any>(stateMachine: M, value: unknown, skipIfSame: boolean): Machine.SetResult<M> => {
    const within = stateMachine.within
    if (within !== undefined && !currentMachines.has(stateMachine.key)) {
      return Result.fail({
        _tag: "SubStateInactive",
        machine: stateMachine.name,
        parent: within.machine.name,
        requires: within.state
      } satisfies Machine.SubStateInactive) as Machine.SetResult<M>
    }
    journalMachine(stateMachine.key)
    if (debugEnabled) {
      const previous = pendingMachines.get(stateMachine.key)
      // A set from a transition schedule waits for the next marker: it replaces nothing queued for this one.
      if (previous?.by !== undefined && previous.by !== runningSystem && previous.value !== value && activeTransitions.size === 0) {
        const key = `${stateMachine.name}/${previous.by}/${runningSystem}/${String(previous.value)}/${String(value)}`
        const seen = nextStateReplacements.get(key)
        nextStateReplacements.set(key, {
          machine: stateMachine.name,
          replaced: { system: previous.by, value: previous.value as Machine.StateValue },
          by: { system: runningSystem, value: value as Machine.StateValue },
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
    getPending: () => pendingMachines.get(stateMachine.key)?.value as Machine.StateMachine.Value<M> | undefined,
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
    get: () => activeTransitions.get(stateMachine.key) as Machine.TransitionSnapshot<M>
  })

  const evaluateCondition = (condition: Machine.Condition): boolean => {
    switch (condition.kind) {
      case "inState":
        return currentMachines.get(condition.machine.key) === condition.value
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
        return projection.read(context as never) === true
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
      machines: mapRecord(spec.machines as Record<string, any>, (access) => makeMachineReadView(access.machine)),
      nextMachines: mapRecord(spec.nextMachines as Record<string, any>, (access) => makeNextMachineWriteView(access.machine)),
      transitionEvents: mapRecord(spec.transitionEvents as Record<string, any>, (access) => watch(makeTransitionEventReadView(access.machine, reader), `transition events ${access.machine.name}`)),
      transitions: mapRecord(spec.transitions as Record<string, any>, (access) => makeTransitionReadView(access.machine)),
      removed: mapRecord(spec.removed as Record<string, any>, (access) => watch(makeRemovedReadView(access.descriptor, reader), `removed ${access.descriptor.name}`)),
      despawned: mapRecord(spec.despawned as Record<string, any>, () => watch(makeDespawnedReadView(reader), "despawned")),
      relationFailures: mapRecord(spec.relationFailures as Record<string, any>, (access) => watch(makeRelationFailureReadView(access.relation, reader), `relation failures ${access.relation.name}`)),
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
  /** Slots of systems with `local` state, rebuilt on `restore`. */
  const localSlots: Array<{ readonly slot: SystemSlot; readonly make: () => unknown }> = []
  /** Stream readers by cursor, for `debug.streams()`. */
  const streamReaders = new Map<Streams.Cursor, { readonly system: string; readonly reader: ReaderState }>()

  interface ReadStream {
    readonly kind: "event" | "transitionEvent" | "relationFailure"
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
      nextStates.push({ machine: names.machines.get(key) ?? "?", value: pendingMachines.get(key)?.value as Machine.StateValue | undefined })
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
      const reader: ReaderState = { since: 0, lastRun: 0, streamSince: 0, streamLastRun: 0, registeredAt: world.currentTick() }
      const commands = Command.makeCommands<S, Root>(() => world.allocateEntity() as Entity.EntityId<S, Root>)
      slot = { context: makeContext(system, reader, commands), commands, reader }
      slots.set(stateKey(system), slot)
      if (holdsStreams) registerStreamReader(system, slot.reader)
      const make = system.spec.local as (() => unknown) | undefined
      if (make !== undefined) localSlots.push({ slot, make })
    }
    return slot
  }

  const succeeded = Result.succeed(undefined)

  /**
   * Runs one system atomically when its run conditions pass.
   *
   * On success its writes are committed and its commands queued. On an
   * expected failure its ECS writes are rolled back and its commands dropped.
   * A thrown defect is rethrown after the same rollback.
   */
  const runSystem = (system: SystemDefinition<any, any, any>): Result.Result<void, SystemFailure> => {
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
    }
    journalReader(reader)
    // Changes stamped after the previous completed run are visible to this run.
    reader.since = reader.lastRun
    reader.streamSince = reader.streamLastRun
    const thisRun = world.advanceTick()
    const started = tracing ? now() : 0
    beginSystemTransaction()
    let outcome: Result.Result<unknown, unknown>
    try {
      // A system that returns nothing cannot fail; otherwise it returned a `Result`.
      outcome = system.run(context) ?? succeeded
    } catch (defect) {
      if (tracing) emit(traceSystem(system, reader, thisRun, started, "defect", defect, commands.flush()))
      rollbackSystemTransaction()
      commands.flush()
      throw defect
    }
    if (outcome._tag === "Failure") {
      if (tracing) emit(traceSystem(system, reader, thisRun, started, "failed", outcome.failure, commands.flush()))
      rollbackSystemTransaction()
      commands.flush()
      return Result.fail({ _tag: "SystemFailure", system: system.name, error: outcome.failure })
    }
    const queued = commands.flush()
    const traced = tracing ? traceSystem(system, reader, thisRun, started, "ok", undefined, queued) : undefined
    commitSystemTransaction()
    // A failed run leaves `lastRun` unchanged, so the next run sees the same changes again.
    reader.lastRun = thisRun
    reader.streamLastRun = thisRun
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
    emit({ type: "schedule.end", frame: frameCount, schedule: scheduleLabel, ok: result._tag === "Success", ms: HostClockModule.elapsed(started, now()) })
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
        ? traceSchedule(DebugInternal.transitionScheduleName(schedule), () => runSteps(schedule.steps))
        : runSteps(schedule.steps)
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
      if (pending.skipIfSame && current === pending.value) {
        if (tracing) traceTransition(machineKey, { from: current as Machine.StateValue, to: current as Machine.StateValue }, "unchanged")
        continue
      }

      const snapshot = {
        from: current as Machine.StateValue,
        to: pending.value as Machine.StateValue
      }

      // Sub-states that exist in the state being left exit first, deepest
      // first: their exit schedules run before the parent's, while they
      // still have their values, and they lose them at the parent's commit.
      // The exit phase is one transaction: a failure undoes all of it, and
      // the transition stays queued for a later attempt.
      const leaving = activeSubStatesIn(machineKey, snapshot.from)
      const exited = runAsPhase(() => {
        for (const sub of leaving) {
          const value = currentMachines.get(sub.key)
          const result = runPhase(sub.key, "exit", value, { from: value, to: undefined } as unknown as Machine.TransitionSnapshot, schedules)
          if (result._tag === "Failure") return result
        }
        const left = runPhase(machineKey, "exit", snapshot.from, snapshot, schedules)
        if (left._tag === "Failure") return left
        for (const schedule of schedules) {
          const transition = schedule.transition
          if (
            transition.phase === "transition"
            && transition.machine.key === machineKey
            && transition.from === snapshot.from
            && transition.to === snapshot.to
          ) {
            const result = runTransitionSchedule(schedule, snapshot)
            if (result._tag === "Failure") return result
          }
        }
        return succeeded
      })
      if (exited._tag === "Failure") {
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
          if (result._tag === "Failure") {
            if (tracing) traceTransition(machineKey, snapshot, "enterFailed")
            return result
          }
        }
      }
      const enteredSchedules = runSubStateEnters(entered, schedules)
      if (enteredSchedules._tag === "Failure") return enteredSchedules
    }
    return succeeded
  }

  /**
   * Commits one machine's value (`undefined` for a sub-state that stops
   * existing): records the change and its transition event, traces it, and
   * despawns the scopes it triggers.
   */
  const commitMachine = (machineKey: symbol, from: unknown, to: unknown): void => {
    const snapshot = { from, to } as unknown as Machine.TransitionSnapshot
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
    state: unknown,
    snapshot: Machine.TransitionSnapshot,
    schedules: TransitionSchedules
  ): Result.Result<void, SystemFailure> => {
    for (const schedule of schedules) {
      const transition = schedule.transition
      if (transition.phase === phase && transition.machine.key === machineKey && transition.state === state) {
        const result = runTransitionSchedule(schedule, snapshot)
        if (result._tag === "Failure") return result
      }
    }
    return succeeded
  }

  /** The sub-states with a value that exist in `state` of `parentKey`, and theirs, deepest first. */
  const activeSubStatesIn = (parentKey: symbol, state: unknown): Array<Machine.StateMachine.Any> => {
    const result: Array<Machine.StateMachine.Any> = []
    for (const sub of subStates.get(parentKey) ?? []) {
      const value = currentMachines.get(sub.key)
      if (sub.within!.state !== state || value === undefined) continue
      result.push(...activeSubStatesIn(sub.key, value), sub)
    }
    return result
  }

  /**
   * Gives the sub-states of `parentKey` that exist in `state` their entry
   * value, and theirs, parents first. Returns what it entered, in that order.
   */
  const commitSubStates = (parentKey: symbol, state: unknown): Array<readonly [symbol, unknown]> => {
    const entered: Array<readonly [symbol, unknown]> = []
    for (const sub of subStates.get(parentKey) ?? []) {
      if (sub.within!.state !== state || currentMachines.has(sub.key) || !subStateEntry.has(sub.key)) continue
      const value = subStateEntry.get(sub.key)
      commitMachine(sub.key, undefined, value)
      entered.push([sub.key, value], ...commitSubStates(sub.key, value))
    }
    return entered
  }

  /** Runs the onEnter schedules of sub-states entered by {@link commitSubStates}, in that order. */
  const runSubStateEnters = (entered: ReadonlyArray<readonly [symbol, unknown]>, schedules: TransitionSchedules): Result.Result<void, SystemFailure> => {
    for (const [key, value] of entered) {
      const snapshot = { from: undefined, to: value } as unknown as Machine.TransitionSnapshot
      const result = runPhase(key, "enter", value, snapshot, schedules)
      if (result._tag === "Failure") {
        if (tracing) traceTransition(key, snapshot, "enterFailed")
        return result
      }
    }
    return succeeded
  }

  /**
   * Executes schedule steps in authored order.
   *
   * Nothing advances implicitly: queued commands, events,
   * and relation failures stay pending, across schedule runs if needed, until
   * a marker step advances them.
   */
  function runSteps(steps: ReadonlyArray<Schedule.ScheduleStep>): Result.Result<void, SystemFailure> {
    for (const step of steps) {
      if (Schedule.isSystemStep(step)) {
        const result = runSystem(step as SystemDefinition<any, any, any>)
        if (result._tag === "Failure") {
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
          if (result._tag === "Failure") {
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
   * Runs one schedule. A failing system stops the schedule; systems that
   * already succeeded stay committed, and their pending work stays pending.
   */
  const runScheduleUnsafe = (schedule: ExecutableScheduleDefinition<S, any, any, any, any, AnyScheduleOrder>): Result.Result<void, SystemFailure> => {
    changedMachines = new Set()
    return tracing
      ? traceSchedule(scheduleName(schedule), () => runSteps(schedule.steps))
      : runSteps(schedule.steps)
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
  }

  /**
   * With debug: the last failed tick result, until its `_tag` is read. The
   * result handed back is a copy whose `_tag` getter marks it read.
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
    if (!debugEnabled || result._tag === "Success") return result
    const error = result.failure
    const system = typeof error === "object" && error !== null && (error as { readonly _tag?: unknown })._tag === "SystemFailure"
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
      get _tag() {
        entry.read = true
        return "Failure"
      },
      failure: error
    } as unknown as R
  }

  const tickUnsafe = (schedules: ReadonlyArray<ExecutableScheduleDefinition<S, any, any, any, any, AnyScheduleOrder>>): Result.Result<void, SystemFailure> => {
    if (ticking) throw new Error("runtime.tick cannot run inside another tick")
    if (debugEnabled) reportUnread("next-tick")
    ticking = true
    inTick = true
    try {
      advanceFrame()
      return watchResult(observedTick(schedules, () => {
        for (const schedule of schedules) {
          const result = runScheduleUnsafe(schedule)
          if (result._tag === "Failure") return result
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
    emitHost(result._tag === "Success"
      ? { type: "tick.end", schedules, frame: frameCount, outcome: "ok" }
      : { type: "tick.end", schedules, frame: frameCount, outcome: "failed", error: result.failure })
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
    if (debugEnabled) reportUnread("next-tick")
    const missing = schedule.requirements
      .filter((requirement) => !hasRequirement(requirement))
      .map(({ kind, name }) => ({ kind, name }))

    if (missing.length > 0) {
      return watchResult(Result.fail({
        kind: "MissingRuntimeRequirements" as const,
        requirements: missing
      }), [schedule])
    }

    const issues = OrderInternal.tickOrderIssues(schedule.steps)
    if (issues.length > 0) {
      return watchResult(Result.fail({ kind: "TickOrderViolation" as const, issues }), [schedule])
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
    const { context, reader } = slotOf(inspector.system, false)
    reader.since = reader.lastRun
    reader.streamSince = reader.streamLastRun
    const value = inspector.read(context) as Inspector.Inspector.Value<Selected>
    reader.lastRun = world.advanceTick()
    reader.streamLastRun = reader.lastRun
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

  // Each saved descriptor's `encode`, found once: a snapshot of a schema
  // without encoders copies its values as before.
  const resourceEncoders = new Map<string, (value: unknown) => Result.Result<unknown, unknown>>()
  for (const [name, descriptor] of resourcesByName) {
    const encode = DescriptorModule.encoderOf(descriptor)
    if (encode !== undefined) resourceEncoders.set(name, encode)
  }
  const componentEncoders = new Map<string, (value: unknown) => Result.Result<unknown, unknown>>()
  for (const descriptor of Object.values(options.schema.components) as ReadonlyArray<Descriptor.Any>) {
    const encode = DescriptorModule.encoderOf(descriptor)
    if (encode !== undefined) componentEncoders.set(descriptor.name, encode)
  }

  const snapshot = (): Result.Result<Snapshot.WorldSnapshot, Snapshot.SnapshotError> => {
    if (inTick) throw new Error("runtime.snapshot was called while a schedule is running: it would capture writes a failing system rolls back; take it between ticks")
    const savedResources: Record<string, unknown> = {}
    for (const [name, descriptor] of resourcesByName) {
      if (!DescriptorModule.isTransient(descriptor) && resources.has(descriptor.key)) {
        const value = resources.get(descriptor.key)
        const encode = resourceEncoders.get(name)
        if (encode === undefined) {
          savedResources[name] = value
          continue
        }
        const encoded = encode(value)
        if (encoded._tag === "Failure") return Result.fail({ _tag: "UnencodableResource", name, error: encoded.failure })
        savedResources[name] = encoded.success
      }
    }
    const entities = world.exportEntities(DescriptorModule.isTransient)
    if (componentEncoders.size > 0) {
      for (const entity of entities) {
        for (const name in entity.components) {
          const encode = componentEncoders.get(name)
          if (encode === undefined) continue
          const encoded = encode(entity.components[name])
          if (encoded._tag === "Failure") return Result.fail({ _tag: "UnencodableComponent", entityId: entity.id, name, error: encoded.failure })
          entity.components[name] = encoded.success
        }
      }
    }
    const savedMachines: Record<string, Machine.StateValue> = {}
    for (const [name, machine] of machinesByName) {
      const value = currentMachines.get(machine.key)
      if (value !== undefined) savedMachines[name] = value as Machine.StateValue
    }
    const savedScopes: Record<string, ReadonlyArray<number>> = {}
    for (const [key, members] of world.exportScopes()) {
      const name = EntityScopeModule.nameOf(key)
      if (name !== undefined) savedScopes[name] = members
    }
    return Result.succeed({
      version: Snapshot.version,
      gameVersion: options.saves?.latest ?? 0,
      nextEntity: world.nextEntityValue(),
      entities,
      relations: world.exportRelations(),
      resources: savedResources,
      machines: savedMachines,
      scopes: savedScopes
    })
  }

  // The public type only exposes `restore` when every saved descriptor has a
  // constructor; a descriptor without one still fails closed here.
  const validate = (value: unknown, descriptor: Descriptor.Any): Result.Result<unknown, unknown> | undefined =>
    DescriptorModule.hasConstructor(descriptor) ? DescriptorModule.decoderOf(descriptor)(value) : undefined

  const restore = (data: unknown): Result.Result<void, Snapshot.RestoreError> => {
    const parsed = Snapshot.parse(data)
    if (parsed._tag === "Failure") return parsed
    const migrated = migrateSave(parsed.success, options.saves)
    if (migrated._tag === "Failure") return migrated
    const saved = migrated.success

    // Validate everything before touching the world.
    const ids = new Set<number>()
    const entities: Array<{ readonly id: number; readonly components: Array<Entity.StagedComponent> }> = []
    for (const entity of saved.entities) {
      if (ids.has(entity.id)) return Result.fail({ _tag: "DuplicateEntity", entityId: entity.id })
      ids.add(entity.id)
      const components: Array<Entity.StagedComponent> = []
      for (const [name, raw] of Object.entries(entity.components)) {
        const descriptor = componentsByName.get(name)
        if (!descriptor || DescriptorModule.isTransient(descriptor)) {
          return Result.fail({ _tag: "UnknownComponent", entityId: entity.id, name })
        }
        const value = validate(raw, descriptor)
        if (value === undefined) return Result.fail({ _tag: "UnvalidatedDescriptor", name })
        if (value._tag === "Failure") return Result.fail({ _tag: "InvalidComponent", entityId: entity.id, name, error: value.failure })
        components.push([descriptor, value.success])
      }
      // Transient components are never saved, so a requirement on one is not checked here.
      const missing = missingIn(components, DescriptorModule.isTransient)
      if (missing !== undefined) {
        return Result.fail({ _tag: "MissingRequiredComponent", entityId: entity.id, name: missing[1], requiredBy: missing[0] })
      }
      entities.push({ id: entity.id, components })
    }
    const validatedResources: Array<readonly [symbol, unknown]> = []
    for (const [name, raw] of Object.entries(saved.resources)) {
      const descriptor = resourcesByName.get(name)
      if (!descriptor || DescriptorModule.isTransient(descriptor)) return Result.fail({ _tag: "UnknownResource", name })
      const value = validate(raw, descriptor)
      if (value === undefined) return Result.fail({ _tag: "UnvalidatedDescriptor", name })
      if (value._tag === "Failure") return Result.fail({ _tag: "InvalidResource", name, error: value.failure })
      validatedResources.push([descriptor.key, value.success])
    }
    const edges: Array<readonly [Relation.Relation.Any, number, number]> = []
    for (const [name, groups] of Object.entries(saved.relations)) {
      const relation = relationsByName.get(name)
      if (!relation) return Result.fail({ _tag: "UnknownRelation", name })
      const parents = new Map<number, number>()
      for (const [target, sources] of groups) {
        for (const source of sources) {
          const valid = ids.has(source) && ids.has(target) && (relation.allowSelf || source !== target) && !parents.has(source)
          if (!valid) return Result.fail({ _tag: "InvalidRelation", name, sourceId: source, targetId: target })
          parents.set(source, target)
          edges.push([relation, source, target])
        }
      }
      if (relation.relationKind === "hierarchy") {
        for (const [source] of parents) {
          const seen = new Set<number>([source])
          for (let current = parents.get(source); current !== undefined; current = parents.get(current)) {
            if (seen.has(current)) {
              return Result.fail({ _tag: "InvalidRelation", name, sourceId: source, targetId: parents.get(source)! })
            }
            seen.add(current)
          }
        }
      }
    }
    const restoredMachines = new Map(currentMachines)
    for (const [name, value] of Object.entries(saved.machines)) {
      const machine = machinesByName.get(name)
      if (!machine) return Result.fail({ _tag: "UnknownMachine", name })
      if (!machine.values.includes(value)) return Result.fail({ _tag: "InvalidMachineState", name, value })
      restoredMachines.set(machine.key, value)
    }
    // A save has no value for a sub-state whose parent is elsewhere; one that
    // has a value must have its parent in the state it exists in. A sub-state
    // missing while its parent is there enters its entry value.
    for (const machine of options.machineDefinitions) {
      const within = machine.within
      if (within === undefined) continue
      const active = restoredMachines.get(within.machine.key) === within.state
      if (Object.hasOwn(saved.machines, machine.name)) {
        if (!active) {
          return Result.fail({ _tag: "InactiveSubState", name: machine.name, parent: within.machine.name, requires: within.state })
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
      if (!options.scopeDefinitions.some((scope) => scope.name === name)) return Result.fail({ _tag: "UnknownScope", name })
      for (const id of members) {
        if (!ids.has(id) || scoped.has(id)) return Result.fail({ _tag: "InvalidScope", name, entityId: id })
        scoped.add(id)
        memberships.push([id, EntityScopeModule.keyOf(name)])
      }
    }

    const rebuiltLocals = localSlots.map(({ make }) => make())

    // Apply: the old world is despawned and the saved one spawned, so change
    // detection and renderer sync observe the restore like any other change.
    pendingCommands.length = 0
    pendingOrigins.length = 0
    pendingMachines.clear()
    events.clear()
    transitionEvents.clear()
    relationFailures.clear()
    world.advanceTick()
    world.despawnAll()
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
    if (inTick) throw new Error("runtime.restore was called while a schedule is running: the running systems' queued commands would land on the restored world; restore between ticks")
    const result = restore(data)
    if (tracing) emit({ type: "restore", frame: frameCount, tick: world.currentTick(), ok: result._tag === "Success" })
    return result
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
    restore: tracedRestore as unknown as Snapshot.Gate<S, typeof restore>,
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
      record.values.forEach((value, ordinal) => {
        if (value !== ABSENT) components[world.descriptorAt(ordinal).name] = value
      })
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
        current: current as Machine.StateValue,
        ...(pending === undefined ? {} : { pending: pending.value as Machine.StateValue }),
        ...(previous === undefined ? {} : { previous: previous as Machine.StateValue })
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
    return result
  }

  const handle: Debug.Handle<S, Root> = {
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
      currentMachine: (machine) => currentMachines.get(machine.key) as Machine.StateValue | undefined,
      providesMachine: (machine) => providedMachineKeys.has(machine.key),
      scopes: options.scopeDefinitions,
      providedServices: Object.keys(providedServices),
      externallyWrittenEvents: new Set([...externallyWrittenEvents, ...hostEvents]),
      relationMutations,
      commandUses,
      ranSystems,
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
 *   machines: Game.Runtime.machines(Game.Runtime.machine(Flow, "Menu"))
 * }).value
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
}): MakeRuntimeResult<S, Simplify<RuntimeServicesOf<ProvidedServices>>, Resources, Root, RuntimeMachinesOf<ProvidedMachines>, Enabled> => {
  const validated = collectConstructedRegistryValues(options.schema.resources, options.resources)
  if (validated._tag === "Failure") {
    return Result.fail({ _tag: "RuntimeConstructionError", resources: validated.failure }) as never
  }
  const runtime = makeValidatedRuntime({
    schema: options.schema,
    services: options.services,
    resources: validated.success,
    machines: options.machines,
    machineDefinitions: options.machineDefinitions ?? [],
    scopeDefinitions: options.scopeDefinitions ?? [],
    debug: options.debug,
    saves: options.saves
  })
  return Result.succeed(runtime) as never
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
 * This is the runtime-side counterpart to `Game.System.service(...)`. Use it
 * to assemble the host implementations the game exposes to systems, such as
 * render bridges, audio sinks, logs, or network clients. Simulation time is
 * `Clock` and randomness is the `Random` resource from
 * `@typeonce/ritmo-math`; neither is a service.
 *
 * The helper keeps the runtime map keyed by service descriptors instead of
 * ad hoc strings, so the provision site cannot drift from the declaration site.
 * Each service is provided once: a second provision of the same one does not
 * compile.
 *
 * @example
 * ```ts
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
 *   Game.Runtime.machine(GameFlow, "Menu")
 * )
 * ```
 */
export const machine = <
  M extends Machine.StateMachine.Any
>(
  stateMachine: M,
  initial: Machine.StateMachine.Value<M>
): MachineProvision<M> => ({
  machine: stateMachine,
  initial
})
