/**
 * Run conditions computed by code: `check(...)`.
 *
 * `Machine.inState` and friends gate systems on state machines. A check gates
 * them on anything the world holds, with ordinary code instead of a growing
 * set of combinators:
 *
 * ```ts
 * const playing = Game.Condition.check("playing", {
 *   resources: { stop: Game.System.readResource(HitStop) },
 *   machines: { flow: Game.System.machine(Flow) }
 * }, ({ resources, machines }) => machines.flow.is("Playing") && resources.stop.get().remaining <= 0)
 *
 * Game.Schedule.when([playing], Move, Attack)
 * ```
 *
 * A check declares its reads like a system, and they become requirements of
 * whatever it gates, so a runtime without them is a compile error. Its access
 * is stricter than an inspector's: only resources, machines, and read-only
 * queries without change filters. Every read that consumes or advances a
 * per-reader cursor (events, transition events, `added`/`changed` filters,
 * removed/despawned records, relation failures) is rejected, and so are
 * services. A check gating many systems is evaluated once per system, and
 * with these reads it gives the same answer each time until something it
 * reads is written.
 *
 * Checks are evaluated just before each gated system runs, against committed
 * values: unlike machine conditions, whose values change only at
 * `applyStateTransitions` markers, a write by an earlier system in the same
 * run is visible. A predicate that throws is a defect: the exception
 * propagates like one thrown by a system.
 *
 * @module Condition
 * @docGroup runtime
 */
import type { Descriptor } from "./Descriptor.ts"
import * as Inspector from "./Inspector.ts"
import type * as Machine from "./Machine.ts"
import type * as Query from "./Query.ts"
import type { Schema } from "./Schema.ts"
import type * as System from "./System.ts"

type AnyQuery = Query.Query.Any<any>

/** Access categories a check may declare. */
export interface CheckAccessInput {
  readonly queries?: Record<string, AnyQuery>
  readonly resources?: Record<string, CheckResourceAccess>
  readonly machines?: Record<string, Machine.MachineRead>
}

/** Accepted at the constraint so `ExactCheckAccess` can reject the last two with a message naming the fix. */
type CheckResourceAccess =
  | System.ResourceRead<Descriptor<"resource", string, any>>
  | System.ResourceChanged<Descriptor<"resource", string, any>>
  | System.ResourceWrite<Descriptor<"resource", string, any>>

/** A check reads committed values and owns no cursor: `changedResource` and `writeResource` slots become a message naming the fix. */
type CheckResources<Resources> = {
  readonly [K in keyof Resources]: Resources[K] extends { readonly mode: "changed" }
    ? "changedResource consumes a per-reader cursor, which a check does not have: use Game.System.readResource here, and changedResource in the gated system"
    : Resources[K] extends { readonly mode: "write" }
      ? "a check cannot write resources: use Game.System.readResource"
      : Resources[K]
}

type QueryWriteAccess<Q extends AnyQuery> =
  Extract<Q["selection"][keyof Q["selection"]], { readonly mode: "write" }>

/** A query a check may read: no write slots and no `added`/`changed` filters. */
type StatelessQuery<Q extends AnyQuery> =
  [QueryWriteAccess<Q>] extends [never]
    ? Q["filters"] extends readonly [] ? Q : never
    : never

type StatelessQueries<Queries extends Record<string, AnyQuery>> = {
  readonly [K in keyof Queries]: StatelessQuery<Queries[K]>
}

/**
 * Rejects categories a check may not declare (events, services, removed and
 * despawned reads, ...) and queries that write or filter on changes.
 */
export type ExactCheckAccess<Access extends CheckAccessInput> = Access & {
  readonly [Key in Exclude<keyof Access, keyof CheckAccessInput>]: never
} & {
  readonly queries?: Access["queries"] extends Record<string, AnyQuery>
    ? StatelessQueries<Access["queries"]>
    : never
  readonly resources?: CheckResources<Access["resources"]>
}

/** What a check's predicate sees: its declared resources, machines, and queries, read-only. */
export type CheckContext<Spec extends System.AnySystemSpec> = Pick<
  System.SystemContext<Spec>,
  "queries" | "resources" | "machines"
>

/**
 * Builds a check for a known schema. `Game.Condition.check(...)` supplies the
 * schema and root from the bound game.
 */
export const check = <
  S extends Schema.Any,
  const Name extends string,
  const Access extends CheckAccessInput,
  Root = unknown
>(
  schema: S,
  name: Name,
  spec: ExactCheckAccess<Access>,
  predicate: (context: CheckContext<System.SystemSpec<S, Access, Root>>) => boolean
): Machine.CheckCondition<Root, System.SystemAccessNeeds<Access>> => {
  const projection = Inspector.make(name, { schema, ...spec } as never, predicate as never)
  return {
    kind: "check",
    name,
    projection,
    requirements: projection.requirements
  }
}
