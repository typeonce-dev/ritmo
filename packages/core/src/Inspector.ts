/**
 * Read-only world projections for tests, saves, debugging, and host code.
 *
 * Inspectors declare the same reads as systems, but they cannot request write
 * queries, write resources, commands, events, or queued state transitions.
 * They run on demand through `runtime.inspect(...)` and return a value without
 * running a schedule or changing the world.
 *
 * Like a system, each inspector reads per-reader streams: `added`/`changed`
 * filters, `removed`/`despawned` records, and events show what happened since
 * that inspector's own previous evaluation, once. Events are not held for
 * inspectors, so one evaluated less often than events are dropped reports
 * `lagged()` instead.
 *
 * An inspector is the one typed read-only view of the world: tests, saves, UI,
 * `Game.Condition.check(...)` projections, and devtools invariants
 * (`Invariant.fromInspector(...)`) are all built from it. `runtime.inspect`
 * rejects at compile time an inspector that reads a resource, service, or
 * machine the runtime was not given.
 *
 * @module Inspector
 * @docGroup runtime
 */
import type * as Machine from "./Machine.ts"
import type * as Query from "./Query.ts"
import type * as Relation from "./Relation.ts"
import type * as Requirement from "./Requirement.ts"
import type { Schema } from "./Schema.ts"
import * as System from "./System.ts"
import type { Descriptor } from "./Descriptor.ts"

type AnyQuery = Query.Query.Any<any>

type QueryWriteAccess<Q extends AnyQuery> =
  Extract<Q["selection"][keyof Q["selection"]], { readonly mode: "write" }>

type ReadonlyQuery<Q extends AnyQuery> =
  [QueryWriteAccess<Q>] extends [never] ? Q : never

type ReadonlyQueries<Queries extends Record<string, AnyQuery>> = {
  readonly [K in keyof Queries]: ReadonlyQuery<Queries[K]>
}

/** Access categories allowed in a read-only inspector. */
export interface InspectorAccessInput {
  readonly queries?: Record<string, AnyQuery>
  readonly resources?: Record<string, System.ResourceRead<Descriptor<"resource", string, any>>>
  readonly events?: Record<string, System.EventRead<Descriptor<"event", string, any>>>
  readonly services?: Record<string, System.ServiceRead<Descriptor<"service", string, any>>>
  readonly machines?: Record<string, Machine.MachineRead>
  readonly transitionEvents?: Record<string, Machine.TransitionEventRead>
  readonly removed?: Record<string, System.RemovedRead<Descriptor<"component", string, any>>>
  readonly despawned?: Record<string, System.DespawnedRead>
  readonly relationFailures?: Record<string, System.RelationFailureRead<Relation.Relation.Any>>
  readonly droppedRelations?: Record<string, System.DroppedRelationRead<Relation.Relation.Any>>
}

type DrainsService = "an inspector must not drain a service: declare it with Game.System.service, and drain it in one system"

type ReadonlyServices<Services extends Record<string, System.ServiceRead<Descriptor<"service", string, any>>>> = {
  readonly [K in keyof Services]: Services[K] extends System.ServiceRead<any, true> ? DrainsService : Services[K]
}

/** Rejects unknown categories, writable query selections, and drained (consumed) services. */
export type ExactInspectorAccess<Access extends InspectorAccessInput> =
  System.ExactAccess<Access> & {
    readonly queries?: Access["queries"] extends Record<string, AnyQuery>
      ? ReadonlyQueries<Access["queries"]>
      : never
    readonly services?: Access["services"] extends Record<string, System.ServiceRead<Descriptor<"service", string, any>>>
      ? ReadonlyServices<Access["services"]>
      : never
  }

/** The capabilities visible to one inspector projection. */
export type InspectorContext<Spec extends System.AnySystemSpec> = Pick<
  System.SystemContext<Spec>,
  | "queries"
  | "resources"
  | "events"
  | "machines"
  | "transitionEvents"
  | "removed"
  | "despawned"
  | "relationFailures"
  | "droppedRelations"
  | "services"
>

/** A built read-only projection tied to one schema and root. */
export interface InspectorDefinition<
  Spec extends System.AnySystemSpec = System.AnySystemSpec,
  out Value = unknown,
  out Root = unknown,
  out Name extends string = string,
  out Needs extends Requirement.Requirement = Requirement.Requirement
> {
  readonly kind: "inspector"
  readonly name: Name
  readonly system: System.SystemDefinition<Spec, never, Root, Name, Needs>
  readonly requirements: ReadonlyArray<Needs>
  readonly read: (context: InspectorContext<Spec>) => Value
  readonly __schemaRoot?: Root | undefined
}

/** Type-level helpers for built inspectors. */
export namespace Inspector {
  /** Any built inspector, whatever it reads; a bound for generic code such as devtools. */
  export type Any = InspectorDefinition<any, any, any, any, any>
  /** What an inspector returns when it runs (`runtime.inspect(inspector)`). */
  export type Value<T extends Any> = T extends InspectorDefinition<any, infer Value, any, any, any> ? Value : never
  /** The requirements (machines, services) the runtime must provide to run an inspector. */
  export type Needs<T extends Any> = T extends InspectorDefinition<any, any, any, any, infer Needs> ? Needs : never
}

/** Low-level constructor used by the schema-bound `Game.Inspector` interface. */
export const make = <
  S extends Schema.Any,
  const Name extends string,
  const Access extends InspectorAccessInput,
  Value,
  Root = unknown
>(
  name: Name,
  spec: { readonly schema: S } & ExactInspectorAccess<Access>,
  read: (context: InspectorContext<System.SystemSpec<S, Access, Root>>) => Value
): InspectorDefinition<
  System.SystemSpec<S, Access, Root>,
  Value,
  Root,
  Name,
  System.SystemAccessNeeds<Access>
> => {
  const system = System.System(
    name,
    spec as never,
    () => undefined
  ) as unknown as System.SystemDefinition<
    System.SystemSpec<S, Access, Root>,
    never,
    Root,
    Name,
    System.SystemAccessNeeds<Access>
  >

  return {
    kind: "inspector",
    name,
    system,
    requirements: system.requirements,
    read
  }
}
