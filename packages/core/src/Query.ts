/**
 * Query declarations, matching semantics, and typed slot access surfaces.
 *
 * Queries are the read-side center of ECS gameplay code. They describe which
 * entities a system is allowed to see and exactly which components that
 * system may read or write once a match is found.
 *
 * In practice this module answers three different design questions at once:
 *
 * - which entities should this system iterate over
 * - which components prove an entity belongs in that iteration
 * - which slots are readable, writable, or only optionally available
 *
 * Reach for this module whenever game logic needs to iterate entity state,
 * perform host sync from ECS data, or resolve durable handles back into
 * current-world entity proofs.
 *
 * @example
 * ```ts
 * // Describe exactly which entities the movement system may see.
 * const MovingActors = Game.Query({
 *   selection: {
 *     // Writable slots declare mutation capability in the query result.
 *     position: Game.Query.write(Position),
 *     // Read-only slots prove presence without granting mutation.
 *     velocity: Game.Query.read(Velocity),
 *     // Optional slots do not affect matching: `undefined` when the entity lacks the component.
 *     sprite: Game.Query.optional(Sprite)
 *   },
 *   // Structural filters describe who participates in the system at all.
 *   with: [Player],
 *   without: [Frozen]
 * })
 *
 * const MoveActors = Game.System("Game/MoveActors", {
 *   queries: { moving: MovingActors },
 *   resources: { dt: Game.System.readResource(DeltaTime) }
 * }, ({ queries, resources }) => {
 *   const dt = resources.dt.get()
 *
 *   const { data } = queries.moving
 *   for (const entity of queries.moving.each()) {
 *     const velocity = data.velocity.get(entity)
 *     data.position.update(entity, (position) => ({
 *       x: position.x + velocity.x * dt,
 *       y: position.y + velocity.y * dt
 *     }))
 *
 *     // An optional slot reads `undefined` when the entity lacks the component.
 *     void data.sprite.get(entity)
 *   }
 * })
 * ```
 *
 * @module Query
 * @docGroup core
 *
 * @groupDescription Namespaces
 * Grouped proof helpers that derive precise component evidence from one query selection.
 *
 * @groupDescription Interfaces
 * Public query contracts for selections, filters, matches, and read/write views.
 *
 * @groupDescription Type Aliases
 * Shared query access, proof, and lifecycle helper types.
 *
 * @groupDescription Functions
 * Query authoring helpers for selecting components and declaring explicit filters.
 */
import * as DescriptorModule from "./Descriptor.ts"
import type { Descriptor, StateDefinitions, EntityStateDescriptor, SchemaIssues, StateEncodedOf, StateName, StateValueOf } from "./Descriptor.ts"
import type { EntityId, EntityRef, ProvenKey } from "./Entity.ts"
import type * as Result from "./Result.ts"
import type * as Relation from "./Relation.ts"
import type { Schema } from "./Schema.ts"
import type { ExtraFields } from "./internal/exact.ts"

type ComponentDescriptor = Descriptor<"component", string, any>

/**
 * Query declarations and typed query slots.
 *
 * Queries are the main way systems gain typed entity access. A query spec is
 * fully explicit:
 *
 * - `selection` declares readable and writable slots
 * - `with` / `without` refine structural matching
 * - `added` / `changed` refine matching to changes since the system's previous run
 * - relation filters refine matching using explicit relation state
 *
 * The key mental model is that query matching is separate from the slot API:
 * required slots affect matching, while `optional(...)` does not.
 *
 * @example
 * ```ts
 * const Moving = Game.Query({
 *   selection: {
 *     position: Game.Query.write(Position),
 *     velocity: Game.Query.read(Velocity),
 *     sprite: Game.Query.optional(Sprite)
 *   },
 *   with: [Position, Velocity]
 * })
 * ```
 */

/**
 * A read access declaration for a descriptor.
 *
 * Read accesses allow systems to observe data without gaining mutation
 * capability in the resulting query or view type.
 */
export interface ReadAccess<D extends ComponentDescriptor> {
  /**
   * Distinguishes read access from write access at both type and runtime level.
   */
  readonly mode: "read"
  /**
   * The descriptor being accessed.
   */
  readonly descriptor: D
}

/**
 * A write access declaration for a descriptor.
 *
 * Write accesses produce writable slots.
 */
export interface WriteAccess<D extends ComponentDescriptor> {
  /**
   * Distinguishes write access from read access at both type and runtime level.
   */
  readonly mode: "write"
  /**
   * The descriptor being accessed.
   */
  readonly descriptor: D
}

/**
 * Any supported query access declaration.
 */
export interface OptionalReadAccess<D extends ComponentDescriptor> {
  /**
   * Distinguishes maybe-present reads from required reads.
   */
  readonly mode: "optional"
  /**
   * The component descriptor being accessed.
   */
  readonly descriptor: D
}

/** A component slot of a selection: `read`, `write`, or `optional`. */
export type Access<D extends ComponentDescriptor> =
  | ReadAccess<D>
  | WriteAccess<D>
  | OptionalReadAccess<D>

/** Anything a query `selection` slot accepts: a component slot or a relation read. */
export type SelectionAccess<
  S extends Schema.Any = Schema.Any,
  Root = unknown
> = Access<ComponentDescriptor> | Relation.SelectionAccess<S, Root>

/**
 * A filter that matches entities whose component was added since the reading
 * system's previous run.
 */
export interface AddedFilter<D extends ComponentDescriptor> {
  readonly kind: "added"
  readonly descriptor: D
}

/**
 * A filter that matches entities whose component was added, or changed to a
 * different value, since the reading system's previous run.
 */
export interface ChangedFilter<D extends ComponentDescriptor> {
  readonly kind: "changed"
  readonly descriptor: D
}

/** An `added` or `changed` filter: the filters `anyOf` combines. */
export type LifecycleFilter<D extends ComponentDescriptor> =
  | AddedFilter<D>
  | ChangedFilter<D>

/**
 * A filter that matches entities passing at least one of its `added` /
 * `changed` filters since the reading system's previous run.
 */
export interface AnyOfFilter<D extends ComponentDescriptor> {
  readonly kind: "anyOf"
  readonly filters: ReadonlyArray<LifecycleFilter<D>>
}

/** An entry of a query's `filters`: `added`, `changed`, or `anyOf`. */
export type Filter<D extends ComponentDescriptor> =
  | LifecycleFilter<D>
  | AnyOfFilter<D>

/**
 * Declares read-only access to a component in a query selection.
 *
 * A required read slot is both a matching requirement and a typing decision:
 * the entity must have that component, and the resulting slot becomes a
 * `ReadCell`. Use this for data the system needs to inspect but must not
 * mutate.
 */
export const read = <D extends ComponentDescriptor>(descriptor: D): ReadAccess<D> => ({
  mode: "read",
  descriptor
})

/**
 * Declares writable access to a component in a query selection.
 *
 * Use this when the system is responsible for mutating component state in
 * place. A write slot both requires component presence and exposes the slot as
 * a `WriteCell`, so mutation capability stays visible in the query spec rather
 * than appearing ad hoc in the loop body.
 *
 * Components declared `immutable: true` cannot be written: replace them with
 * `commands.insert(...)` instead.
 */
export const write = <D extends ComponentDescriptor>(descriptor: D & Writable<D>): WriteAccess<D> => {
  if (DescriptorModule.isImmutable(descriptor)) {
    throw new Error(immutableMessage(descriptor.name))
  }
  return { mode: "write", descriptor }
}

const immutableMessage = (name: string) =>
  `${name} is immutable: replace it with commands.insert(entity, [${name}, value])`

type NameOf<D> = D extends { readonly name: infer Name extends string } ? Name : never

/**
 * `unknown` for a component a query may write; for one declared
 * `immutable: true`, an argument error naming the fix.
 */
export type Writable<D> = D extends DescriptorModule.Immutable
  ? { readonly __immutable__: `${NameOf<D>} is immutable: replace it with commands.insert(entity, [${NameOf<D>}, value])` }
  : unknown

/**
 * Declares maybe-present read-only access to a component in a query
 * specification.
 *
 * `optional(...)` is for reading extra data when the entity holds it, not for
 * matching: the query matches entities with or without the component. The
 * slot reads the component's value when the entity holds it and `undefined`
 * when it does not, so check it (`data.sprite?.get()`, or
 * `data.sprite !== undefined`) before reading. For a component whose own
 * value can be `undefined`, an `undefined` slot means absent and `get()`
 * returning `undefined` means present.
 *
 * To match only entities that hold a component (such as "is this the
 * player?"), list it in the query's `with: [Player]` filter, or read it with
 * `Game.Query.read(...)`, instead of an optional slot.
 *
 * @example
 * ```ts
 * // Keep the main query focused on movers, but read sprite data when available.
 * const query = Game.Query({
 *   selection: {
 *     position: Game.Query.read(Position),
 *     sprite: Game.Query.optional(Sprite)
 *   }
 * })
 *
 * const DrawMovers = Game.System("Game/DrawMovers", { queries: { movers: query } }, ({ queries }) => {
 *   const { data } = queries.movers
 *   for (const entity of queries.movers.each()) {
 *     const frame = data.sprite.get(entity)?.frame ?? 0
 *     void frame
 *   }
 * })
 * ```
 */
export const optional = <D extends ComponentDescriptor>(descriptor: D): OptionalReadAccess<D> => ({
  mode: "optional",
  descriptor
})

/**
 * Declares a filter that matches components added since the reading system's
 * previous run.
 *
 * Change detection is per system: every system sees each addition exactly
 * once, on its first run after the addition, independently of other systems.
 * A system's first run sees every existing component as added. This is the
 * usual entrypoint for incremental host sync, such as creating renderer nodes.
 *
 * @example
 * ```ts
 * const AddedRenderableQuery = Game.Query({
 *   selection: {
 *     position: Game.Query.read(Position),
 *     renderable: Game.Query.read(Renderable)
 *   },
 *   filters: [Game.Query.added(Renderable)]
 * })
 * ```
 */
export const added = <D extends ComponentDescriptor>(descriptor: D): AddedFilter<D> => ({
  kind: "added",
  descriptor
})

/**
 * Declares a filter that matches components added, or changed to a different
 * value, since the reading system's previous run.
 *
 * A write counts when the value differs from the one before the writing
 * system's run: a different number or string (`NaN` equals `NaN`), or a
 * different object. Writing back the value read, or an equal number, is not
 * a change; a new object is one even when its fields are equal, so write the
 * value you read when nothing moved. Inserting a component counts as added
 * and changed. Writes from a system whose run failed are rolled back and do
 * not count. A system never sees its own writes as changes on its next run
 * (it does see the events it emitted).
 *
 * @example
 * ```ts
 * const MovedQuery = Game.Query({
 *   selection: {
 *     position: Game.Query.read(Position)
 *   },
 *   filters: [Game.Query.changed(Position)]
 * })
 * ```
 */
export const changed = <D extends ComponentDescriptor>(descriptor: D): ChangedFilter<D> => ({
  kind: "changed",
  descriptor
})

/**
 * Declares a filter that matches entities passing at least one of `filters`
 * (`added` / `changed`) since the reading system's previous run. Each entity
 * is matched once, however many of its filters pass.
 *
 * Filters listed side by side in `filters: [...]` must all pass; use `anyOf`
 * when any one of them is enough, for example to redraw when either the
 * position or the sprite changed.
 *
 * @example
 * ```ts
 * const RedrawQuery = Game.Query({
 *   selection: { position: Game.Query.read(Position), sprite: Game.Query.read(Sprite) },
 *   filters: [Game.Query.anyOf(Game.Query.changed(Position), Game.Query.changed(Sprite))]
 * })
 * ```
 */
export const anyOf = <
  const Filters extends readonly [
    LifecycleFilter<ComponentDescriptor>,
    LifecycleFilter<ComponentDescriptor>,
    ...ReadonlyArray<LifecycleFilter<ComponentDescriptor>>
  ]
>(...filters: Filters): AnyOfFilter<Filters[number]["descriptor"]> => ({
  kind: "anyOf",
  filters
})

/**
 * A fully explicit query specification.
 *
 * Queries describe exactly which components are read or written, plus optional
 * `with` and `without` filters. They are the source of typed entity proofs.
 */
export interface QuerySpec<
  out Selection extends Record<string, SelectionAccess<any, Root>>,
  out With extends ReadonlyArray<ComponentDescriptor> = [],
  out Without extends ReadonlyArray<ComponentDescriptor> = [],
  out Filters extends ReadonlyArray<Filter<ComponentDescriptor>> = [],
  out WithRelations extends ReadonlyArray<Relation.Relation.Any> = [],
  out WithoutRelations extends ReadonlyArray<Relation.Relation.Any> = [],
  out WithRelated extends ReadonlyArray<Relation.Relation.Any> = [],
  out WithoutRelated extends ReadonlyArray<Relation.Relation.Any> = [],
  Root = unknown
> {
  /**
   * Named access slots that become the query's typed `data`.
   */
  readonly selection: Selection
  /**
   * Components that must be present for an entity to match.
   */
  readonly with: With
  /**
   * Components that must be absent for an entity to match.
   */
  readonly without: Without
  /**
   * Change filters that refine matching relative to the reading system's previous run.
   */
  readonly filters: Filters
  /**
   * Relations that must be present on the entity as outgoing edges.
   */
  readonly withRelations: WithRelations
  /**
   * Relations that must be absent on the entity as outgoing edges.
   */
  readonly withoutRelations: WithoutRelations
  /**
   * Reverse relation collections that must be present and non-empty.
   */
  readonly withRelated: WithRelated
  /**
   * Reverse relation collections that must be absent or empty.
   */
  readonly withoutRelated: WithoutRelated
  /**
   * Hidden schema-root brand used by schema-bound APIs.
   */
  readonly __schemaRoot?: Root | undefined
}

/**
 * Type-level helpers for queries.
 */
export namespace Query {
  /**
   * A non-empty readonly array.
   */
  export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]]

  /**
   * Any supported query specification.
   */
  export type Any<Root = unknown> = QuerySpec<
    Record<string, SelectionAccess<any, Root>>,
    ReadonlyArray<ComponentDescriptor>,
    ReadonlyArray<ComponentDescriptor>,
    ReadonlyArray<Filter<ComponentDescriptor>>,
    ReadonlyArray<Relation.Relation.Any>,
    ReadonlyArray<Relation.Relation.Any>,
    ReadonlyArray<Relation.Relation.Any>,
    ReadonlyArray<Relation.Relation.Any>,
    Root
  >

  /**
   * Extracts the schema-root brand carried by one query.
   */
  export type Root<T extends Any> = T extends QuerySpec<any, any, any, any, any, any, any, any, infer R> ? R : never

  type FilteredDescriptors<F> = F extends { readonly kind: "added" | "changed"; readonly descriptor: infer D } ? D : never

  type RequiredSelectionDescriptors<T extends Any> = {
    readonly [K in keyof T["selection"]]:
      T["selection"][K] extends ReadAccess<infer D> | WriteAccess<infer D> ? D : never
  }[keyof T["selection"]]

  /**
   * Whether one query statically proves the presence of a component descriptor.
   *
   * This is used by durable-handle resolution so intent-qualified handles can
   * only be resolved with queries that actually prove the intended role.
   */
  export type ProvesComponent<
    T extends Any,
    D extends ComponentDescriptor
  > = [Extract<Proven<T>, D>] extends [never]
    ? false
    : true

  /**
   * The component descriptors a query proves its matches have: required
   * selection slots, `with`, and the component of each `added` / `changed`
   * filter (a matching entity has it). A `Query.anyOf` member proves nothing alone.
   */
  export type Proven<T extends Any> = RequiredSelectionDescriptors<T> | T["with"][number] | FilteredDescriptors<T["filters"][number]>

  /** The component descriptors a query proves its matches lack: its `without`. */
  export type Excluded<T extends Any> = T["without"][number]

  type RelationDescriptors<T extends Any> = {
    readonly [K in keyof T["selection"]]:
      T["selection"][K] extends Relation.RelationReadAccess<infer R, any, any> | Relation.RelatedReadAccess<infer R, any, any> ? R : never
  }[keyof T["selection"]] | T["withRelations"][number] | T["withRelated"][number]

  /** The relations a query proves its entities have: its required relation slots, `withRelations`, and `withRelated`. */
  export type ProvenRelations<T extends Any> = RelationDescriptors<T>

  /**
   * Entity lookup failed because the entity id is not currently alive.
   */
  export interface MissingEntityError {
    readonly _tag: "MissingEntity"
    readonly entityId: number
  }

  /**
   * Entity lookup failed because the entity does not satisfy the query.
   */
  export interface QueryMismatchError {
    readonly _tag: "QueryMismatch"
    readonly entityId: number
  }

  /**
   * A query expected one result, but matched none.
   */
  export interface NoEntitiesError {
    readonly _tag: "NoEntities"
  }

  /**
   * A query expected one result, but matched multiple.
   */
  export interface MultipleEntitiesError {
    readonly _tag: "MultipleEntities"
    readonly count: number
  }

  /**
   * Errors produced by exact entity lookup helpers.
   */
  export type LookupError = MissingEntityError | QueryMismatchError

  /**
   * Errors produced by exact-one query helpers.
   */
  export type SingleError = NoEntitiesError | MultipleEntitiesError
}

/**
 * Deep read projection used by every ECS read capability: what `get()`
 * returns.
 *
 * Helpers that take values read from slots or cells type their parameter
 * `ReadonlyValue<T>`, not `T`, so `get()` results pass in without a cast.
 * To change a value, write a new one with the slot's or cell's `update`; stored values
 * are never mutated in place (a runtime made with `debug` freezes them).
 *
 * @example
 * ```ts
 * import type { ReadonlyValue } from "@typeonce/ritmo/Query"
 *
 * type TuningValue = Descriptor.Descriptor.Value<typeof Tuning>
 * const spawnRate = (tuning: ReadonlyValue<TuningValue>) => tuning.waves[0]?.rate ?? 1
 *
 * Game.System("Game/Spawner", { resources: { tuning: Game.System.readResource(Tuning) } }, ({ resources }) => {
 *   spawnRate(resources.tuning.get())
 * })
 * ```
 */
export type ReadonlyValue<T> =
  T extends string | number | boolean | bigint | symbol | null | undefined ? T
  : T extends (...args: ReadonlyArray<any>) => any ? T
  : T extends ReadonlyMap<infer Key, infer Value> ? ReadonlyMap<ReadonlyValue<Key>, ReadonlyValue<Value>>
  : T extends ReadonlySet<infer Value> ? ReadonlySet<ReadonlyValue<Value>>
  : T extends readonly unknown[] ? { readonly [K in keyof T]: ReadonlyValue<T[K]> }
  : T extends object ? { readonly [K in keyof T]: ReadonlyValue<T[K]> }
  : T

/**
 * A read-only cell of a resource or machine. Entities have {@link ReadSlot}.
 *
 * Object and collection values are deeply readonly so in-place mutation cannot
 * bypass lifecycle tracking, validation, or a system transaction.
 */
export interface ReadCell<T> {
  /**
   * Reads the current value.
   */
  get(): ReadonlyValue<T>
}

/**
 * A mutable cell of a resource. Entities have {@link WriteSlot}.
 *
 * This gives a narrow mutation surface instead of exposing raw storage objects.
 * Values written here are already valid. Data that still needs validation
 * goes through its descriptor's schema: declare the descriptor with
 * `Descriptor.ConstructedComponent` / `ConstructedResource` and write with
 * `setRaw` / `updateRaw` on its {@link ConstructedWriteCell}.
 */
export interface WriteCell<T, Name extends string = string> extends ReadCell<T> {
  /**
   * Replaces the current value. Takes the readonly shape reads return, so a
   * value read from any slot or cell can be written back as it is.
   *
   * The world owns `value` from here: never mutate it afterwards, build a new
   * one. A runtime made with `debug` freezes it, so a later mutation throws
   * where it happens.
   */
  set(value: ReadonlyValue<T>): void
  /**
   * Updates the current value based on the previous one. Return a new value
   * (`(body) => ({ ...body, x: body.x + 1 })`); the world owns it, as with
   * `set`. A field the value does not have does not compile, spread or not
   * (see {@link ExactUpdate}).
   */
  update<Next extends ReadonlyValue<T>>(f: ((current: ReadonlyValue<T>) => Next) & ExactUpdate<T, Next, Name>): void
}

/**
 * Writable cell for a resource backed by a constructed descriptor.
 *
 * This extends the normal write-cell surface with explicit raw-validation
 * helpers. It never appears for plain descriptors.
 */
export interface ConstructedWriteCell<T, Raw, Error, Name extends string = string> extends WriteCell<T, Name> {
  /**
   * Validates one raw candidate and writes it only on success.
   *
   * @example
   * ```ts
   * declare const position: Query.ConstructedWriteCell<{ x: number; y: number }, { x: number; y: number }, unknown>
   * // ---cut---
   * const written = position.setRaw({ x: 16, y: 24 })
   * if (!written.ok) console.error(written.error)
   * ```
   */
  setRaw(raw: Raw): Result.Result<void, Error>
  /**
   * Derives one raw candidate from the current value, validates it, and writes
   * it only on success.
   *
   * @example
   * ```ts
   * declare const position: Query.ConstructedWriteCell<{ x: number; y: number }, { x: number; y: number }, unknown>
   * // ---cut---
   * position.updateRaw((current) => ({
   *   x: current.x + 1,
   *   y: current.y
   * }))
   * ```
   */
  updateRaw<Next extends Raw>(f: ((current: ReadonlyValue<T>) => Next) & ExactUpdate<Raw, Next, Name>): Result.Result<void, Error>
}

/**
 * Rejects an `update` (or `updateRaw`) callback of a component or resource
 * whose result has a field the value does not have. A spread in a callback's
 * result escapes TypeScript's excess property check, so `({ ...p, xx: 1 })`
 * would store `xx` next to the value's own fields, and a save holding it
 * would fail to restore against a strict schema. `Name` is the component or
 * resource.
 */
export type ExactUpdate<T, Next, Name extends string> =
  [ExtraFields<T, Next>] extends [never] ? unknown
    : { readonly __fixUpdate__: `${Name} has no field ${ExtraFields<T, Next> & string}: return only its own fields` }

/**
 * A `transition` or `update` found the entity state in another state, so
 * nothing was written.
 */
export interface EntityStateMismatchError<State extends string> {
  readonly _tag: "EntityStateMismatch"
  /** Name of the `Descriptor.EntityState` component. */
  readonly component: string
  /** The state the move expected (`from`, or `update`'s `state`). */
  readonly expected: State
  /** The state the component was actually in. */
  readonly actual: State
}

/**
 * The states every one of `From` may move to in a transition graph (of an
 * entity state or a state machine): with a union `from`, only the moves all
 * of them allow.
 */
export type StateTargets<Transitions, From extends keyof Transitions> =
  (From extends unknown ? (to: Transitions[From] extends ReadonlyArray<infer To> ? To : never) => void : never) extends
    (to: infer To) => void ? To : never

/** The names of a state's fields: its value's keys besides `_tag`. */
type StateFieldName<States extends StateDefinitions, State extends StateName<States>> = Exclude<keyof StateValueOf<States, State>, "_tag">

/** A state's fields as a write takes them: the value without `_tag`. */
export type StateData<States extends StateDefinitions, State extends StateName<States>> = ReadonlyValue<
  { readonly [Field in StateFieldName<States, State>]: StateValueOf<States, State>[Field] }
>

/**
 * `data` of a `transition` into `To` (of an entity state or a state machine):
 * required with all of `To`'s fields, and absent for a state without fields.
 */
export type StateMoveData<States extends StateDefinitions, To extends StateName<States>> =
  [StateFieldName<States, To>] extends [never] ? { readonly data?: never } : { readonly data: StateData<States, To> }

/**
 * What the callback of an `update` (of an entity state or a state machine)
 * returns for `State`: its fields, and optionally its own `_tag` (from a
 * spread of the current value).
 */
export type StateUpdateResult<States extends StateDefinitions, State extends StateName<States>> =
  StateData<States, State> & { readonly _tag?: State }

/**
 * Rejects an `update` callback (of an entity state or a state machine) when
 * its result has a field `State` does not have. A spread in a callback's
 * result escapes TypeScript's excess property check, and a field of another
 * state would otherwise be written next to this state's fields. `Move` names
 * the way to change state instead.
 */
export type StateExactFields<States extends StateDefinitions, State extends StateName<States>, Next, Move extends string> =
  [Exclude<keyof Next, keyof StateValueOf<States, State>>] extends [never] ? unknown
    : { readonly data: `${State} has no field ${Exclude<keyof Next, keyof StateValueOf<States, State>> & string}: write only this state's fields, or move with ${Move}` }

/** What a slot of a query's `data` asks of an entity: that its query proves `D`. */
export interface EntityProving<in D> {
  readonly __entity: { readonly [Key in ProvenKey<D>]: true }
}

/**
 * A read slot of a query's `data`: reads the value of any entity whose query
 * proves `D`. Valid during the run that handed it out; it throws when used
 * later, so read `queries.x.data` again in each run.
 *
 * Object and collection values are deeply readonly, so in-place mutation cannot
 * bypass lifecycle tracking, validation, or a system transaction.
 */
export interface ReadSlot<T, D> {
  /** Reads the entity's current value. */
  get(entity: EntityProving<D>): ReadonlyValue<T>
}

/**
 * An optional slot of a query's `data`: the entity's value, or `undefined` when
 * it lacks the component. An optional slot does not affect which entities match.
 */
export interface OptionalSlot<T> {
  /** Reads the entity's current value, or `undefined` when it lacks the component. */
  get(entity: EntityProving<never>): ReadonlyValue<T> | undefined
  /** Whether the entity holds the component: use it where the value itself may be `undefined`. */
  has(entity: EntityProving<never>): boolean
}

/**
 * A write slot of a query's `data`: {@link ReadSlot}, and writes the value of
 * any entity whose query proves `D`. Writes join the system's transaction: a
 * failed system rolls them back, and `changed` sees a value that differs when
 * the system commits. Values written here are already valid; data that still
 * needs validation goes through its descriptor's schema, with
 * `Descriptor.ConstructedComponent` and {@link ConstructedWriteSlot}.
 */
export interface WriteSlot<T, D> extends ReadSlot<T, D> {
  /**
   * Replaces the entity's value. Takes the readonly shape reads return, so a
   * value read from any slot can be written back as it is.
   *
   * The world owns `value` from here: never mutate it afterwards, build a new
   * one. A runtime made with `debug` freezes it, so a later mutation throws
   * where it happens.
   */
  set(entity: EntityProving<D>, value: ReadonlyValue<T>): void
  /**
   * Updates the entity's value from its current one. Return a new value
   * (`(body) => ({ ...body, x: body.x + 1 })`); the world owns it, as with
   * `set`.
   */
  update<Next extends ReadonlyValue<T>>(
    entity: EntityProving<D>,
    f: ((current: ReadonlyValue<T>) => Next) & ExactUpdate<T, Next, DescriptorName<D>>
  ): void
}

/**
 * Write slot of a component with a constructed descriptor: {@link WriteSlot},
 * and explicit raw validation. It never appears for plain descriptors.
 */
export interface ConstructedWriteSlot<T, Raw, Error, D> extends WriteSlot<T, D> {
  /**
   * Validates one raw candidate and writes it only on success.
   *
   * @example
   * ```ts
   * const Moves = Game.Query({ selection: { position: Game.Query.write(Position) } })
   *
   * Game.System("Game/Teleport", { queries: { moves: Moves } }, ({ queries }) => {
   *   const { data } = queries.moves
   *   for (const entity of queries.moves.each()) {
   *     const written = data.position.setRaw(entity, { x: 16, y: 24 })
   *     if (!written.ok) console.error(written.error)
   *   }
   * })
   * ```
   */
  setRaw(entity: EntityProving<D>, raw: Raw): Result.Result<void, Error>
  /**
   * Derives one raw candidate from the current value, validates it, and writes
   * it only on success.
   *
   * @example
   * ```ts
   * const Moves = Game.Query({ selection: { position: Game.Query.write(Position) } })
   *
   * Game.System("Game/Nudge", { queries: { moves: Moves } }, ({ queries }) => {
   *   const { data } = queries.moves
   *   for (const entity of queries.moves.each()) {
   *     data.position.updateRaw(entity, (position) => ({ x: position.x + 1, y: position.y }))
   *   }
   * })
   * ```
   */
  updateRaw<Next extends Raw>(
    entity: EntityProving<D>,
    f: ((current: ReadonlyValue<T>) => Next) & ExactUpdate<Raw, Next, DescriptorName<D>>
  ): Result.Result<void, Error>
}

/**
 * The type of an entity state slot's `set`: the unchecked write, for an
 * entity state declared without `transitions`. For one declared with them
 * it is a message naming `transition`, so calling it does not compile.
 * `Transitions` is the slot's graph: every move, when none was declared.
 */
export type UncheckedEntityStateWrite<States extends StateDefinitions, Transitions, D> =
  { readonly [State in StateName<States>]: ReadonlyArray<StateName<States>> } extends Transitions
    ? (entity: EntityProving<D>, value: ReadonlyValue<StateValueOf<States, StateName<States>>>) => void
    : { readonly __fixMove__: "this entity state declares `transitions`: move it with data.x.transition(entity, { from, to, data }), which checks the graph and the current state, or write data from outside the simulation (a test, a level file) with data.x.setRaw(entity, raw)" }

/**
 * Write slot of an entity state component (`Descriptor.EntityState`).
 *
 * `transition` enters a state with all of its fields, and `update` changes the
 * current state's fields. Both are a compare-and-set: they write only while
 * the component is in the expected state, and otherwise return
 * `EntityStateMismatch` without writing. With a transition graph, `to` must be
 * one of the moves the graph allows from `from`, and `set` does not compile;
 * without one, any pair of states is accepted and `set` writes any value.
 */
export interface EntityStateWriteSlot<States extends StateDefinitions, Transitions, D>
  extends ReadSlot<StateValueOf<States, StateName<States>>, D>
{
  /**
   * Moves from `from` to `to` if the component is still in `from`, writing
   * `to`'s fields from `data`: nothing carries over from `from`. A state
   * without fields takes no `data`. Use it for every move the transition
   * table describes.
   *
   * @example
   * ```ts
   * const Phase = Descriptor.EntityState("Game/Phase", { windup: {}, active: {} }, { transitions: { windup: ["active"], active: [] } })
   * declare const data: { readonly phase: Query.WriteSlotOf<typeof Phase> }
   * declare const entity: Entity.EntityRef<typeof Game.schema, typeof Root, typeof Phase>
   * // ---cut---
   * const started = data.phase.transition(entity, { from: "windup", to: "active" })
   * if (!started.ok) {
   *   // started.error.actual is the state some earlier write left
   * }
   * ```
   */
  transition<const From extends keyof States & keyof Transitions & string, const To extends StateTargets<Transitions, From> & keyof States & string>(
    entity: EntityProving<D>,
    move: { readonly from: From; readonly to: To } & StateMoveData<States, To>
  ): Result.Result<void, EntityStateMismatchError<StateName<States>>>
  /**
   * Changes the fields of `state` if the component is still in it, without
   * leaving it: `data` maps the current value to the new fields.
   *
   * @example
   * ```ts
   * declare const data: { readonly contact: Query.WriteSlotOf<typeof Contact> }
   * declare const entity: Entity.EntityRef<typeof Game.schema, typeof Root, typeof Contact>
   * declare const gravity: number
   * // ---cut---
   * data.contact.update(entity, { state: "air", data: (air) => ({ ...air, vy: air.vy - gravity }) })
   * ```
   */
  update<const State extends keyof States & string, Next extends StateUpdateResult<States, State>>(
    entity: EntityProving<D>,
    change: {
      readonly state: State
      readonly data: (current: ReadonlyValue<StateValueOf<States, State>>) => Next
    } & StateExactFields<States, State, Next, "transition">
  ): Result.Result<void, EntityStateMismatchError<StateName<States>>>
  /**
   * Writes any value without checking the current state: the value a pure
   * function computed from the current one. Use `transition` and `update`
   * for the moves a system makes itself, so the current state is checked.
   * On an entity state declared with `transitions` it does not compile:
   * `transition` is the way to move it, so a system's moves are ones the
   * graph lists. To write a state there from outside the simulation (a
   * test, a level file), use `setRaw`, which decodes it first.
   */
  readonly set: UncheckedEntityStateWrite<States, Transitions, D>
  /**
   * Decodes an untrusted value (in its saved form) and writes it only on
   * success, without checking the graph or the current state: for data from
   * outside the simulation (a level file, an editor), not for a system's own
   * moves.
   */
  setRaw(entity: EntityProving<D>, raw: StateEncodedOf<States>): Result.Result<void, SchemaIssues>
}

/**
 * The write slot of one queried component descriptor: a plain, constructed, or
 * entity state write slot, by what the descriptor is.
 */
export type WriteSlotOf<D extends ComponentDescriptor> =
  D extends EntityStateDescriptor<string, infer States, infer Transitions>
    ? EntityStateWriteSlot<States, Transitions extends undefined ? { readonly [State in StateName<States>]: ReadonlyArray<StateName<States>> } : Transitions, D>
    : D extends import("./Descriptor.ts").ConstructedDescriptor<"component", string, infer Value, infer Raw, infer Error>
    ? ConstructedWriteSlot<Value, Raw, Error, D>
    : WriteSlot<Descriptor.Value<D>, D>

/**
 * `queries.x.data`: one slot per entry of the query's `selection`, with exactly
 * the access it declared. A read slot has no `set`. Each slot takes an entity
 * from the query, so no object per entity exists.
 *
 * Valid during the run that handed it out: a slot kept in `local` state, a
 * closure, or an inspector's result throws when used later. Read
 * `queries.x.data` again in each run; to keep the values past the run, read
 * them into plain rows with `queries.x.rows()`.
 */
export type QueryData<T extends Query.Any> = {
  readonly [K in keyof T["selection"]]:
    T["selection"][K] extends ReadAccess<infer D> ? ReadSlot<Descriptor.Value<D>, D>
    : T["selection"][K] extends OptionalReadAccess<infer D> ? OptionalSlot<Descriptor.Value<D>>
    : T["selection"][K] extends WriteAccess<infer D> ? WriteSlotOf<D>
    : T["selection"][K] extends Relation.RelationReadAccess<infer R, infer S extends Schema.Any, infer Root> ? ReadSlot<EntityId<S, Root>, R>
    : T["selection"][K] extends Relation.OptionalRelationReadAccess<any, infer S extends Schema.Any, infer Root> ? OptionalSlot<EntityId<S, Root>>
    : T["selection"][K] extends Relation.RelatedReadAccess<infer R, infer S extends Schema.Any, infer Root> ? ReadSlot<ReadonlyArray<EntityId<S, Root>>, R>
    : T["selection"][K] extends Relation.OptionalRelatedReadAccess<any, infer S extends Schema.Any, infer Root> ? OptionalSlot<ReadonlyArray<EntityId<S, Root>>>
    : never
}

/**
 * The entity type of a query: what `queries.x.each()` holds. It goes to the
 * query's `data` and to `commands`.
 *
 * Type a game helper that takes one entity with this type, from the game's
 * schema (named as in `Schema.bind`) and the query constant, and pass it the
 * slot it reads. A helper that takes the query's entities and its `data` takes
 * the handle instead, typed `QueryIteration` (from `@typeonce/ritmo/System`).
 *
 * @example
 * ```ts
 * import type { QueryData, QueryEntity } from "@typeonce/ritmo/Query"
 * import type { QueryIteration } from "@typeonce/ritmo/System"
 *
 * const PlayerRead = Game.Query({ selection: { position: Game.Query.read(Position) } })
 *
 * const leftOf = (player: QueryEntity<typeof Game.schema, typeof PlayerRead>, data: QueryData<typeof PlayerRead>, x: number) =>
 *   data.position.get(player).x < x
 * const leftmost = (players: QueryIteration<typeof Game.schema, typeof PlayerRead>) =>
 *   players.each().reduce((min, player) => Math.min(min, players.data.position.get(player).x), Infinity)
 *
 * Game.System("Game/Leftmost", { queries: { players: PlayerRead } }, ({ queries }) => {
 *   const x = leftmost(queries.players)
 *   console.log(queries.players.each().filter((player) => !leftOf(player, queries.players.data, x)).length)
 * })
 * ```
 */
export type QueryEntity<S extends Schema.Any, Q extends Query.Any> =
  EntityRef<S, Query.Root<Q>, Query.Proven<Q>, Query.Excluded<Q>, Query.ProvenRelations<Q>>

/**
 * The plain values of one entity of a query: one field per entry of its
 * `selection`, each what that slot's `get` returns (`undefined` for an
 * optional slot whose entity lacks the component). What `queries.x.rows()`
 * holds in `values`.
 *
 * Plain values, not slots: they stay readable after the run that read them,
 * so a view, an inspector's result, or a memoized helper can keep them.
 */
export type QueryValues<T extends Query.Any> = {
  readonly [K in keyof QueryData<T>]: QueryData<T>[K] extends { get(entity: never): infer V } ? V : never
}

/**
 * One entity of a query read into plain values: its id and its
 * {@link QueryValues}. What `queries.x.rows()` returns.
 *
 * It carries the `id`, not the entity: a row kept past its run cannot be read
 * through a query's `data`. To act on the entity again, resolve the id with
 * `queries.x.get(id)`, which is fallible.
 */
export interface QueryRow<S extends Schema.Any, Q extends Query.Any> {
  readonly id: EntityId<S, Query.Root<Q>>
  readonly values: QueryValues<Q>
}

/**
 * Creates a typed missing-entity error.
 */
export const missingEntityError = (entityId: number): Query.MissingEntityError => ({
  _tag: "MissingEntity",
  entityId
})

/**
 * Creates a typed query-mismatch error.
 */
export const queryMismatchError = (entityId: number): Query.QueryMismatchError => ({
  _tag: "QueryMismatch",
  entityId
})

/**
 * Creates a typed zero-match error.
 */
export const noEntitiesError = (): Query.NoEntitiesError => ({
  _tag: "NoEntities"
})

/**
 * Creates a typed multi-match error.
 */
export const multipleEntitiesError = (count: number): Query.MultipleEntitiesError => ({
  _tag: "MultipleEntities",
  count
})

/**
 * `T` itself, but not a place inference reads from: a list a query omits
 * stays `[]` even when the call sits where a wider query type is expected
 * (`queries: { ... }` in a spec). Unlike `NoInfer`, it prints as `T`.
 */
// `T` appears only as the check type, which inference never reads.
export type Uninferred<T, Bound> = [T] extends [infer U extends Bound] ? U : never

type DescriptorName<D> = D extends { readonly name: infer Name extends string } ? Name : never

/** The names a query requires: its read and write slots, `with`, and plain `added` / `changed` filters. */
type RequiredNames<Selection, With extends ReadonlyArray<unknown>, Filters extends ReadonlyArray<unknown>> =
  | DescriptorName<{ readonly [K in keyof Selection]: Selection[K] extends { readonly mode: "read" | "write"; readonly descriptor: infer D } ? D : never }[keyof Selection]>
  | DescriptorName<With[number]>
  | DescriptorName<Filters[number] extends infer F ? F extends { readonly kind: "added" | "changed"; readonly descriptor: infer D } ? D : never : never>

/**
 * Rejects a `without` naming a component the query also requires: such a
 * query can never match. Use it on the `without` list of a query spec.
 */
export type ExclusionsPossible<Selection, With extends ReadonlyArray<unknown>, Without extends ReadonlyArray<unknown>, Filters extends ReadonlyArray<unknown>> =
  [Extract<DescriptorName<Without[number]>, RequiredNames<Selection, With, Filters>>] extends [never]
    ? unknown
    : {
      readonly __fixQuery__: `${Extract<DescriptorName<Without[number]>, RequiredNames<Selection, With, Filters>>} is both required and excluded (without): this query can never match; remove it from one side`
    }

/**
 * Creates an explicit query specification.
 *
 * Use this inside system specs instead of relying on callback parameter
 * inference. The resulting value drives both runtime execution and the derived
 * query result type.
 *
 * A query spec is purely declarative. It does not access the world by itself;
 * systems receive `QueryHandle`s derived from the spec. In practice this is
 * where you encode the exact shape of one gameplay iteration pass. Game
 * code uses `Game.Query(...)`, which checks the descriptors against the
 * bound game.
 *
 * @example
 * ```ts
 * // Define one reusable iteration contract for a movement system.
 * const Moving = Game.Query({
 *   selection: {
 *     position: Game.Query.write(Position),
 *     velocity: Game.Query.read(Velocity)
 *   },
 *   with: [Position, Velocity],
 *   without: [Frozen]
 * })
 * ```
 */
export const Query = <
  const Selection extends Record<string, SelectionAccess<any, Root>>,
  const With extends ReadonlyArray<ComponentDescriptor> = [],
  const Without extends ReadonlyArray<ComponentDescriptor> = [],
  const Filters extends ReadonlyArray<Filter<ComponentDescriptor>> = [],
  const WithRelations extends ReadonlyArray<Relation.Relation.Any> = [],
  const WithoutRelations extends ReadonlyArray<Relation.Relation.Any> = [],
  const WithRelated extends ReadonlyArray<Relation.Relation.Any> = [],
  const WithoutRelated extends ReadonlyArray<Relation.Relation.Any> = [],
  Root = unknown
>(spec: {
  readonly selection: Selection
  readonly with?: With
  readonly without?: Without & ExclusionsPossible<Selection, With, Without, Filters>
  readonly filters?: Filters
  readonly withRelations?: WithRelations
  readonly withoutRelations?: WithoutRelations
  readonly withRelated?: WithRelated
  readonly withoutRelated?: WithoutRelated
  // Uninferred: an omitted list is `[]`, never inferred from the spec it is written in (`queries: { ... }`).
}): QuerySpec<Selection, Uninferred<With, ReadonlyArray<ComponentDescriptor>>, Uninferred<Without, ReadonlyArray<ComponentDescriptor>>, Uninferred<Filters, ReadonlyArray<Filter<ComponentDescriptor>>>, Uninferred<WithRelations, ReadonlyArray<Relation.Relation.Any>>, Uninferred<WithoutRelations, ReadonlyArray<Relation.Relation.Any>>, Uninferred<WithRelated, ReadonlyArray<Relation.Relation.Any>>, Uninferred<WithoutRelated, ReadonlyArray<Relation.Relation.Any>>, Root> => ({
  selection: spec.selection,
  with: (spec.with ?? []) as unknown as Uninferred<With, ReadonlyArray<ComponentDescriptor>>,
  without: (spec.without ?? []) as unknown as Uninferred<Without, ReadonlyArray<ComponentDescriptor>>,
  filters: (spec.filters ?? []) as unknown as Uninferred<Filters, ReadonlyArray<Filter<ComponentDescriptor>>>,
  withRelations: (spec.withRelations ?? []) as unknown as Uninferred<WithRelations, ReadonlyArray<Relation.Relation.Any>>,
  withoutRelations: (spec.withoutRelations ?? []) as unknown as Uninferred<WithoutRelations, ReadonlyArray<Relation.Relation.Any>>,
  withRelated: (spec.withRelated ?? []) as unknown as Uninferred<WithRelated, ReadonlyArray<Relation.Relation.Any>>,
  withoutRelated: (spec.withoutRelated ?? []) as unknown as Uninferred<WithoutRelated, ReadonlyArray<Relation.Relation.Any>>,
  __schemaRoot: undefined
})
