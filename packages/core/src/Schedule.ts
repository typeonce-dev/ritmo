/**
 * Explicit schedule construction and visibility boundaries.
 *
 * Authoring-time structure is validated once, then schedules carry only their
 * normalized steps, systems, and nominal requirement union.
 *
 * Steps run in authored order. `when(conditions, ...entries)` gates a whole
 * group of systems on run conditions at once, and `pauseWhen(...)` pauses a
 * group without losing the events published meanwhile. Marker steps are the only way queued
 * structural work is applied, and nothing is flushed implicitly when a
 * schedule ends:
 *
 * - `applyDeferred()` applies queued commands
 * - `applyStateTransitions(...)` applies queued commands, then queued machine
 *   transitions
 *
 * Reads need no marker. Change detection (`added`, `changed`, removed and
 * despawned reads), events, transition events, and relation failures are
 * per-reader streams: each system sees what was published since its own
 * previous run, once, in order. Removed/despawned records, events,
 * transition events, and relation failures are kept until every system that
 * reads them has run, so schedules may be ticked at different rates.
 *
 * A system skipped by its run conditions (`when`) discards the events,
 * transition events, and relation failures published meanwhile, but keeps
 * its change-detection position: when it runs again, `added`/`changed`
 * filters and removed/despawned reads still show everything since its
 * previous completed run. Use `pauseWhen` to keep the messages too.
 *
 * @module Schedule
 * @docGroup runtime
 */
import type { Condition, ConditionNeedsFromConditions, StateMachine } from "./Machine.ts"
import * as Requirement from "./Requirement.ts"
import type { Schema } from "./Schema.ts"
import type { FailureOf as SystemFailureOf, SystemDefinition, SystemFailure, ThisTick } from "./System.ts"

/** The `applyDeferred()` marker step. */
export interface ApplyDeferredStep {
  readonly kind: "applyDeferred"
}

/** The `applyStateTransitions(...)` marker step, with the bundle whose transition schedules it runs. */
export interface ApplyStateTransitionsStep<
  out Bundle extends TransitionBundleDefinition<any, any, any, any, any, any> | undefined = undefined,
  out Root = unknown
> {
  readonly kind: "applyStateTransitions"
  readonly bundle?: Bundle
  readonly __schemaRoot?: Root | undefined
}

/** A marker step: where queued work is applied. */
export type ScheduleMarkerStep =
  | ApplyDeferredStep
  | ApplyStateTransitionsStep<any, any>

type AnySystem = SystemDefinition<any, any, any, any, any>

/** One step of a flattened schedule: a system or a marker. */
export type ScheduleStep = AnySystem | ScheduleMarkerStep

/**
 * What a schedule carries for `thisTick` checks: its entries in order, and
 * whether any of them has a `Game.System.thisTick` read. Building a schedule
 * computes only the flag; `runtime.tick(...)` walks the entries, and only
 * when some read exists. Schedules never report order errors themselves.
 *
 * `ScheduleOrder`'s defaults claim no `thisTick` reads: `Schema.BoundSchedule`
 * (an annotation) uses it, so a schedule with a read cannot be widened into
 * one and lose its check. Schedule types default to `AnyScheduleOrder`, and a
 * schedule whose order was erased that way fails at `tick` as "not
 * statically known", never silently.
 */
export interface ScheduleOrder<
  out Entries extends ReadonlyArray<unknown> = ReadonlyArray<unknown>,
  out Reads extends boolean = false
> {
  readonly entries: Entries
  readonly reads: Reads
}

/** Accepts a schedule with any order summary (constraint positions only). */
export type AnyScheduleOrder = ScheduleOrder<ReadonlyArray<unknown>, boolean>

/**
 * One `thisTick` read whose writers do not all run earlier in the tick, as
 * found at runtime by `tryTick` and the `this-tick-order` lint. `message` is
 * the same text `runtime.tick(...)` reports at compile time.
 */
export interface OrderIssue {
  /**
   * `lateWriter`: the writer runs after the reader. `unflushedWriter`: a
   * command writer runs before a query reader with no `applyDeferred()` in
   * between.
   */
  readonly kind: "lateWriter" | "unflushedWriter"
  readonly reader: string
  /** The event or resource name, or `queries.<slot>` for a query read. */
  readonly data: string
  /** The writer at fault. */
  readonly writer: string
  readonly message: string
}

/** The message reported when the order of a tick cannot be known statically. */
export type UnknownOrderError =
  "the order of this tick is not statically known (a schedule or tick argument spread from a widened array) and it contains Game.System.thisTick reads: list the systems and schedules as literal arguments or an `as const` tuple"

/** Plugin systems with an erased spec (`any`) take part in no order check. */
type IsErased<T> = 0 extends 1 & T ? true : false

type SpecAccessValues<Spec> =
  Spec extends { readonly events: infer Events; readonly resources: infer Resources }
    ? Events[keyof Events] | Resources[keyof Resources]
    : never

type SpecQueryValues<Spec> =
  Spec extends { readonly queries: infer Queries } ? Queries[keyof Queries] : never

type CarriedOrder<Entry> =
  "__order" extends keyof Entry
    ? Entry extends { readonly __order?: (_: never) => infer Order extends AnyScheduleOrder } ? Order : never
    : never

/** The order an entry carries: a schedule's, or the bundle of an `applyStateTransitions(...)` step. */
type OrderOf<Entry> =
  Entry extends { readonly kind: "applyStateTransitions"; readonly bundle?: infer Bundle }
    ? CarriedOrder<NonNullable<Bundle>>
    : CarriedOrder<Entry>

/**
 * Whether one entry has a `thisTick` read: a cheap flag, computed once per
 * schedule. `"unknown"` is a nested schedule whose type was widened.
 */
type EntryHasReads<Entry> =
  Entry extends AnySystem
    ? IsErased<Entry["spec"]> extends true ? "no"
      : [Extract<SpecAccessValues<Entry["spec"]> | SpecQueryValues<Entry["spec"]>, ThisTick>] extends [never] ? "no" : "yes"
    : OrderOf<Entry>["reads"] extends infer Reads
      ? boolean extends Reads ? "unknown" : Reads extends true ? "yes" : "no"
      : "no"

/** `true` when some entry reads `thisTick`, `boolean` when that cannot be known. */
type HasReads<Entries extends ReadonlyArray<unknown>> =
  EntryHasReads<Entries[number]> extends infer Flags
    ? "unknown" extends Flags ? boolean : "yes" extends Flags ? true : false
    : false

/** The order summary of entries run in this order. */
export type CompositionOrder<Entries extends ReadonlyArray<unknown>> = ScheduleOrder<Entries, HasReads<Entries>>

// The detailed check below runs only from `TickOrderErrors`, for ticks with a
// read. It never walks a tuple element by element: per read it finds the
// reader's position at each nesting level, slices the entries after it once,
// and looks for writers in the union of the systems there. A query read also
// walks back from the reader to the nearest marker, which is usually close.

/** An event or resource read. */
interface DataRead<Kind, Key, Reader, ReaderSystem> {
  readonly kind: Kind
  readonly key: Key
  readonly reader: Reader
  /** The reader itself: systems may share a display name, so writers are told apart by type. */
  readonly readerSystem: ReaderSystem
}

/**
 * A query read: the components its matches must have (`Required`), and every
 * component it names (`Named`: selection slots, optional ones included,
 * `with`, `without`, and filters).
 */
interface QueryRead<Slot, Required, Named, Reader, ReaderSystem> {
  readonly kind: "query"
  readonly slot: Slot
  readonly required: Required
  readonly named: Named
  readonly reader: Reader
  readonly readerSystem: ReaderSystem
}

type DescriptorKind<D> = D extends { readonly kind: infer Kind } ? Kind : never

type Names<D> = D extends { readonly name: infer Name extends string } ? Name : never

type DescriptorsOf<Access> =
  Access extends { readonly descriptor: infer D } ? D
  // A Query.anyOf filter names the components of its member filters.
  : Access extends { readonly kind: "anyOf"; readonly filters: ReadonlyArray<infer Member> } ? DescriptorsOf<Member>
  : never

/** Every system an entry runs, nested schedules and transition bundles included, as a union. */
export type SystemsIn<Entry> =
  Entry extends AnySystem ? Entry
  : OrderOf<Entry> extends infer Order extends AnyScheduleOrder
    ? [Order] extends [never] ? never : SystemsIn<Order["entries"][number]>
    : never

type QueryReadOf<Slot, Q, Reader, ReaderSystem> =
  Q extends { readonly selection: infer Selection; readonly with: infer With extends ReadonlyArray<unknown>; readonly without: infer Without extends ReadonlyArray<unknown>; readonly filters: infer Filters extends ReadonlyArray<unknown> }
    ? QueryRead<
        Slot,
        Names<{ readonly [K in keyof Selection]: Selection[K] extends { readonly mode: "read" | "write"; readonly descriptor: infer D } ? D : never }[keyof Selection] | With[number]>,
        Names<DescriptorsOf<Selection[keyof Selection]> | With[number] | Without[number] | DescriptorsOf<Filters[number]>>,
        Reader,
        ReaderSystem
      >
    : never

type SystemReads<Sys> =
  Sys extends AnySystem
    ? IsErased<Sys["spec"]> extends true ? never
      :
        | (Extract<SpecAccessValues<Sys["spec"]>, ThisTick> extends infer Access
          ? Access extends { readonly descriptor: infer D extends { readonly name: string } }
            ? DataRead<DescriptorKind<D>, D["name"], Sys["name"], Sys>
            : never
          : never)
        | (Sys["spec"] extends { readonly queries: infer Queries }
          ? { readonly [K in keyof Queries]: Queries[K] extends ThisTick ? QueryReadOf<K, Queries[K], Sys["name"], Sys> : never }[keyof Queries]
          : never)
    : never

/** Whether two system types are the same system (mutually assignable): a shared display name is not enough. */
type SameSystem<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false

/** Names of the systems among `Systems` that write `Key` (other than the reader itself). */
type WritersOf<Systems, Kind, Key, ReaderSystem> =
  Systems extends AnySystem
    ? IsErased<Systems["spec"]> extends true ? never
      : SameSystem<Systems, ReaderSystem> extends true ? never
      : [Extract<SpecAccessValues<Systems["spec"]>, { readonly mode: "write"; readonly descriptor: { readonly kind: Kind; readonly name: Key } }>] extends [never]
        ? never
        : Systems["name"]
    : never

/**
 * Whether declared command permissions can change what a query read sees:
 * `spawns` covering every component it requires, or `inserts` / `removes` of
 * any component it names. `despawns` never count.
 */
type CommandsCount<Commands, Required, Named> =
  CommandNames<Commands> extends readonly [infer Spawns, infer Changes]
    ? [Extract<Changes, Named>] extends [never]
      ? [Spawns] extends [never] ? false
        : [Exclude<Required, Spawns>] extends [never] ? true : false
      : true
    : false

/** The component names a system may spawn, and may insert or remove: computed once per system, shared by every read. */
type CommandNames<Commands> =
  Commands extends { readonly __permissions?: (_: never) => readonly [infer Spawns, infer Inserts, infer Removes, ...Array<unknown>] }
    ? readonly [Names<Spawns>, Names<Inserts | Removes>]
    : readonly [never, never]

/** Names of the systems among `Systems` whose commands count for a query read (other than its reader). */
type CommandWritersOf<Systems, Required, Named, ReaderSystem> =
  Systems extends AnySystem
    ? IsErased<Systems["spec"]> extends true ? never
      : SameSystem<Systems, ReaderSystem> extends true ? never
      : Systems["spec"] extends { readonly commands: infer Commands }
        ? CommandsCount<Commands, Required, Named> extends true ? Systems["name"] : never
        : never
    : never

type WritersFor<Systems, R> =
  R extends QueryRead<any, infer Required, infer Named, any, infer ReaderSystem> ? CommandWritersOf<Systems, Required, Named, ReaderSystem>
  : R extends DataRead<infer Kind, infer Key, any, infer ReaderSystem> ? WritersOf<Systems, Kind, Key, ReaderSystem>
  : never

/**
 * Some level of the entries is a widened array that may contain a read.
 * `MayRead` is the flag carried by the schedule holding them: a widened array
 * no longer shows its elements, so the flag decides (`boolean`: unknown).
 */
type UnknownIn<Entries extends ReadonlyArray<unknown>, MayRead extends boolean> =
  Entries extends unknown ? UnknownInOne<Entries, MayRead> : never

type UnknownInOne<Entries extends ReadonlyArray<unknown>, MayRead extends boolean> =
  number extends Entries["length"]
    ? [MayRead] extends [false] ? never : UnknownOrderError
    : NestedOrders<Entries[number]> extends infer Order
      ? Order extends AnyScheduleOrder ? UnknownIn<Order["entries"], Order["reads"]> : never
      : never

type NestedOrders<Entry> = Entry extends AnySystem ? never : OrderOf<Entry>

type NestedEntries<Entry> =
  Entry extends AnySystem ? never
  : OrderOf<Entry> extends infer Order extends AnyScheduleOrder
    ? [Order] extends [never] ? never : Order["entries"]
    : never

type TupleOf<Length extends number, Out extends Array<unknown> = []> =
  Out["length"] extends Length ? Out : TupleOf<Length, [...Out, unknown]>

/** Literal names of the systems an entry runs; erased (`string`) names identify no one. */
type NamesIn<Entry> =
  SystemsIn<Entry> extends infer Sys
    ? Sys extends AnySystem ? (string extends Sys["name"] ? never : Sys["name"]) : never
    : never

/** Indices (as numbers) of the entries that run the reader. */
type ReaderIndices<Entries extends ReadonlyArray<unknown>, Reader> = {
  readonly [I in keyof Entries]: Reader extends NamesIn<Entries[I]> ? I : never
}[number] extends infer Index
  ? Index extends `${infer N extends number}` ? N : never
  : never

type LateWriterError<R, Writer> =
  Writer extends string
    ? R extends QueryRead<infer Slot extends string, any, any, infer Reader extends string, any>
      ? `${Writer} queues commands that ${Reader} needs this tick (queries.${Slot}), but it runs after ${Reader}: move ${Writer} before the applyDeferred() that precedes ${Reader}, or read queries.${Slot} without thisTick`
      : R extends DataRead<any, infer Key extends string, infer Reader extends string, any>
        ? `${Reader} needs ${Key} from this tick, but its writer ${Writer} runs after it: move ${Writer} before ${Reader}, or read ${Key} without thisTick`
        : never
    : never

type UnflushedWriterError<R, Writer> =
  Writer extends string
    ? R extends QueryRead<infer Slot extends string, any, any, infer Reader extends string, any>
      ? `${Reader} needs this tick's commands for queries.${Slot}, but ${Writer} queues them with no applyDeferred() in between: add Game.Schedule.applyDeferred() after ${Writer}`
      : never
    : never

/** Writers of the read's data that run after its reader, at this level and inside the reader's own entry. */
type LateWriters<Entries, R, Reader extends string> =
  // Distributes over a union of schedules (a tick of one of several), then over each place the reader runs.
  Entries extends ReadonlyArray<unknown> ? LateWritersAt<Entries, ReaderIndices<Entries, Reader>, R, Reader> : never

type LateWritersAt<Entries extends ReadonlyArray<unknown>, Index, R, Reader extends string> =
  Index extends number
    ? Entries extends readonly [...TupleOf<Index>, infer At, ...infer Rest]
      ? | LateWriterError<R, WritersFor<SystemsIn<Rest[number]>, R>>
        | LateWriters<NestedEntries<At>, R, Reader>
      : never
    : never

/**
 * The systems that run between the last marker and the reader (their commands
 * are still queued when it runs), and whether a marker was found:
 * `[Systems, Flushed]`, one per place the reader runs.
 */
type Segment<Entries, Reader> =
  Entries extends ReadonlyArray<unknown> ? SegmentAt<Entries, ReaderIndices<Entries, Reader>, Reader> : never

type SegmentAt<Entries extends ReadonlyArray<unknown>, Index, Reader> =
  Index extends number
    ? InnerSegment<Entries[Index], Reader> extends readonly [infer Inner, infer Flushed]
      ? Flushed extends true ? readonly [Inner, true]
        : TailBefore<Entries, TupleOf<Index>> extends readonly [infer Outer, infer OuterFlushed]
          ? readonly [Inner | Outer, OuterFlushed]
          : never
      : never
    : never

/**
 * `TailSegment` of the entries before a position, walking back by index
 * (`Count` holds one element per entry still to visit).
 */
type TailBefore<Entries extends ReadonlyArray<unknown>, Count extends ReadonlyArray<unknown>, Acc = never> =
  Count extends readonly [unknown, ...infer Rest]
    ? Entries[Rest["length"]] extends infer Last
      ? Last extends ApplyDeferredStep ? readonly [Acc, true]
        : Last extends AnySystem ? TailBefore<Entries, Rest, Acc | Last>
        : Last extends { readonly kind: "applyStateTransitions" }
          ? TailSegment<NestedEntries<Last>> extends readonly [infer Inner, any] ? readonly [Acc | Inner, true] : readonly [Acc, true]
          : TailSegment<NestedEntries<Last>> extends readonly [infer Inner, infer Flushed]
            ? Flushed extends true ? readonly [Acc | Inner, true] : TailBefore<Entries, Rest, Acc | Inner>
            : TailBefore<Entries, Rest, Acc>
      : never
    : readonly [Acc, false]

/** The segment inside the entry that runs the reader: none for the reader itself; a transition step flushes first. */
type InnerSegment<At, Reader> =
  At extends AnySystem ? readonly [never, false]
  : At extends { readonly kind: "applyStateTransitions" }
    ? Segment<NestedEntries<At>, Reader> extends readonly [infer Inner, any] ? readonly [Inner, true] : readonly [never, true]
    : Segment<NestedEntries<At>, Reader>

/** The systems after the last marker of `Entries` (walking back from the end), and whether a marker was found. */
type TailSegment<Entries, Acc = never> =
  Entries extends readonly [...infer Init, infer Last]
    ? Last extends ApplyDeferredStep ? readonly [Acc, true]
      : Last extends AnySystem ? TailSegment<Init, Acc | Last>
      : Last extends { readonly kind: "applyStateTransitions" }
        // Its bundle runs after its own flush; markers inside the bundle count too.
        ? TailSegment<NestedEntries<Last>> extends readonly [infer Inner, any] ? readonly [Acc | Inner, true] : readonly [Acc, true]
        : TailSegment<NestedEntries<Last>> extends readonly [infer Inner, infer Flushed]
          ? Flushed extends true ? readonly [Acc | Inner, true] : TailSegment<Init, Acc | Inner>
          : TailSegment<Init, Acc>
    : readonly [Acc, false]

type UnflushedWriters<Entries, R, Reader extends string> =
  R extends QueryRead<any, any, any, any, any>
    ? Segment<Entries, Reader> extends infer Found
      ? Found extends readonly [infer Systems, any] ? UnflushedWriterError<R, WritersFor<Systems, R>> : never
      : never
    : never

type ReadErrors<Entries extends ReadonlyArray<unknown>, Reads> =
  Reads extends { readonly reader: infer Reader extends string }
    ? LateWriters<Entries, Reads, Reader> | UnflushedWriters<Entries, Reads, Reader>
    : never

type CheckTick<Schedules extends ReadonlyArray<unknown>> =
  [UnknownIn<Schedules, HasReads<Schedules>>] extends [never]
    ? ReadErrors<Schedules, SystemReads<SystemsIn<Schedules[number]>>>
    : UnknownOrderError

/**
 * Every `thisTick` error of one `runtime.tick(...)` call over its arguments
 * in order: writers that run after their reader, command writers with no
 * `applyDeferred()` before a query reader, and a call whose order is not
 * statically known. Free when nothing has a read.
 */
export type TickOrderErrors<Schedules extends ReadonlyArray<unknown>> =
  HasReads<Schedules> extends false ? never : CheckTick<Schedules>

/**
 * An input service: one value per call, such as a keyboard's actions this
 * step. A schedule that is replayed (`Replay.recorder`) or rewound
 * (`runtime.checkpoint`) takes its input from services of this shape, so
 * the host can hand it the same input again; every other service it uses
 * must be plain data.
 */
export interface Source<Data> {
  readonly snapshot: () => Data
}

/**
 * Whether a type is plain data (what JSON keeps): no functions, maps, sets,
 * or class instances with methods. Recursive types are checked once.
 */
export type IsPlain<T> = false extends PlainMember<T, never> ? false : true

// Checks one member of a union at a time (the conditional distributes), so a
// recursive type is recognised when it comes back (`Seen`).
type PlainMember<T, Seen> =
  T extends string | number | boolean | null | undefined ? true
  : [T] extends [Seen] ? true
  : T extends (...args: ReadonlyArray<never>) => unknown ? false
  : T extends ReadonlyArray<infer Element> ? PlainMember<Element, Seen | T>
  : T extends object ? PlainField<T, keyof T, Seen | T>
  : false

type PlainField<T, K extends keyof T, Seen> = K extends keyof T ? PlainMember<T[K], Seen> : never

/** Transition schedules grouped by `transitions(...)`, run by the `applyStateTransitions(bundle)` they are passed to. */
export interface TransitionBundleDefinition<
  S extends Schema.Any = Schema.Any,
  out Entries extends ReadonlyArray<StateMachine.AnyTransitionSchedule<S, any>> = ReadonlyArray<StateMachine.AnyTransitionSchedule<S, any>>,
  out Needs extends Requirement.Requirement = Requirement.Requirement,
  out Root = unknown,
  out CarriedNeeds extends Requirement.Requirement = Needs,
  out Failure extends SystemFailure = never,
  out Order extends AnyScheduleOrder = AnyScheduleOrder
> {
  readonly kind: "transitionBundle"
  readonly entries: Entries
  readonly requirements: ReadonlyArray<CarriedNeeds>
  readonly __failure?: (_: never) => Failure
  /**
   * The bundle's schedules in order, for `Game.System.thisTick` checks: they
   * count at the position of the `applyStateTransitions(...)` step that
   * applies the bundle, as if every one of them runs.
   */
  readonly __order?: (_: never) => Order
  readonly __schemaRoot?: Root | undefined
}

/** A built schedule, ready for `runtime.tick(...)`: its flattened steps, systems, and carried requirements. */
export interface ExecutableScheduleDefinition<
  S extends Schema.Any,
  out Needs extends Requirement.Requirement = Requirement.Requirement,
  out Root = unknown,
  out CarriedNeeds extends Requirement.Requirement = Needs,
  out Failure extends SystemFailure = never,
  // Any order by default, so a pattern that names five parameters (`infer S, any, ...`) matches every schedule.
  out Order extends AnyScheduleOrder = AnyScheduleOrder
> {
  readonly kind: "schedule"
  readonly steps: ReadonlyArray<ScheduleStep>
  readonly systems: ReadonlyArray<AnySystem>
  readonly schema: S
  readonly requirements: ReadonlyArray<CarriedNeeds>
  readonly __failure?: (_: never) => Failure
  /** Writes, `thisTick` reads, and order errors, checked by `runtime.tick(...)`. */
  readonly __order?: (_: never) => Order
  readonly __schemaRoot?: Root | undefined
}

/** Alias of {@link ExecutableScheduleDefinition}. */
export type ScheduleDefinition<
  S extends Schema.Any,
  Needs extends Requirement.Requirement = Requirement.Requirement,
  Root = unknown,
  CarriedNeeds extends Requirement.Requirement = Needs,
  Failure extends SystemFailure = never,
  Order extends AnyScheduleOrder = AnyScheduleOrder
> = ExecutableScheduleDefinition<S, Needs, Root, CarriedNeeds, Failure, Order>

/** Type-level helpers for schedules. */
export namespace Schedule {
  /**
   * Any built schedule of schema `S`, whatever its order; what
   * `Game.Schedule(...)` returns, before `runtime.tick(...)` checks it.
   */
  export type Definition<
    S extends Schema.Any,
    Needs extends Requirement.Requirement = Requirement.Requirement,
    Root = unknown,
    CarriedNeeds extends Requirement.Requirement = Needs,
    Failure extends SystemFailure = never
  > = ScheduleDefinition<S, Needs, Root, CarriedNeeds, Failure>
  /** A marker step (`applyDeferred()`, `applyStateTransitions(...)`). */
  export type Step = ScheduleStep
  /** The transition schedules `Game.Schedule.transitions(...)` bundles for one `applyStateTransitions(...)`. */
  export type TransitionBundle<
    S extends Schema.Any,
    Entries extends ReadonlyArray<StateMachine.AnyTransitionSchedule<S, any>> = ReadonlyArray<StateMachine.AnyTransitionSchedule<S, any>>,
    Needs extends Requirement.Requirement = Requirement.Requirement,
    Root = unknown,
    CarriedNeeds extends Requirement.Requirement = Needs,
    Failure extends SystemFailure = never
  > = TransitionBundleDefinition<S, Entries, Needs, Root, CarriedNeeds, Failure>
}

/**
 * Anything a schedule can contain: systems, marker steps, and other schedules
 * (which are flattened in place).
 */
export type ScheduleEntry =
  | ScheduleStep
  | ScheduleDefinition<any, any, any, any, any, AnyScheduleOrder>

type EntrySchema<Entry> =
  Entry extends { readonly schema: infer S extends Schema.Any } ? S
  : Entry extends SystemDefinition<infer Spec, any, any, any, any> ? Spec["schema"]
  : never

type MarkerNeeds<Step> =
  Step extends ApplyStateTransitionsStep<infer Bundle, any>
    ? Requirement.Of<NonNullable<Bundle>>
    : never

type EntryNeeds<Entry> = Requirement.Of<Entry> | MarkerNeeds<Entry>

type CarriedFailure<Entry> =
  "__failure" extends keyof Entry
    ? Entry extends { readonly __failure?: (_: never) => infer Failure extends SystemFailure }
      ? Failure
      : never
    : never

/** Extracts the expected failure union carried by a built schedule value. */
export type FailureOf<Value> = CarriedFailure<Value>

type MarkerFailure<Step> =
  Step extends ApplyStateTransitionsStep<infer Bundle, any>
    ? CarriedFailure<NonNullable<Bundle>>
    : never

/** Extracts the normalized expected failure carried by one schedule entry. */
export type EntryFailure<Entry> =
  Entry extends AnySystem ? SystemFailureOf<Entry>
  : MarkerFailure<Entry> | CarriedFailure<Entry>

/** Failure union for one authored schedule plan. */
export type CompositionFailure<Entries extends ReadonlyArray<ScheduleEntry>> =
  EntryFailure<Entries[number]>

/**
 * The requirements (services, resources, machines) a schedule of `Entries`
 * needs: every entry's, nested schedules included. Hovers on a built
 * schedule show it; `runtime.tick(...)` checks it against what the runtime
 * provides.
 */
export type CompositionExactRequirements<Entries extends ReadonlyArray<ScheduleEntry>> =
  EntryNeeds<Entries[number]>

/**
 * The schedule built by `Game.Schedule(...entries)`: the entries'
 * requirements, failures, and order, carried for `runtime.tick(...)`.
 * Hovers show it; name a schedule with `const update = Game.Schedule(...)`,
 * never with this type.
 */
export type AnonymousScheduleBuildFor<
  S extends Schema.Any,
  Entries extends ReadonlyArray<ScheduleEntry>,
  Root = unknown
> = ScheduleDefinition<
  S,
  CompositionExactRequirements<Entries>,
  Root,
  CompositionExactRequirements<Entries>,
  CompositionFailure<Entries>,
  CompositionOrder<Entries>
>

/**
 * The schedule built by `when(conditions, ...entries)`: the entries' needs
 * plus the machines the conditions read.
 */
export type ConditionalScheduleBuildFor<
  S extends Schema.Any,
  Conditions extends ReadonlyArray<Condition>,
  Entries extends ReadonlyArray<ScheduleEntry>,
  Root = unknown
> = ScheduleDefinition<
  S,
  CompositionExactRequirements<Entries> | ConditionNeedsFromConditions<Conditions>,
  Root,
  CompositionExactRequirements<Entries> | ConditionNeedsFromConditions<Conditions>,
  CompositionFailure<Entries>,
  CompositionOrder<Entries>
>

/** What `Game.Schedule.transitions(...)` accepts: transition schedules, or bundles of them (flattened in place). */
export type TransitionBundleInput<S extends Schema.Any = Schema.Any, Root = unknown> =
  | StateMachine.AnyTransitionSchedule<S, Root>
  | TransitionBundleDefinition<S, ReadonlyArray<StateMachine.AnyTransitionSchedule<S, Root>>, any, Root, any, any>

type FlattenTransitionEntry<Entry> =
  Entry extends TransitionBundleDefinition<any, infer InnerEntries, any, any, any, any>
    ? InnerEntries[number]
    : Extract<Entry, StateMachine.AnyTransitionSchedule<any, any>>

/** The transition schedules of `Entries` with nested bundles flattened, as one bundle carries them. */
export type FlattenTransitionEntries<
  Entries extends ReadonlyArray<TransitionBundleInput<any, any>>
> = ReadonlyArray<FlattenTransitionEntry<Entries[number]>>

/** The requirements of every transition schedule in a bundle; `applyStateTransitions(bundle)` carries them. */
export type TransitionBundleRequirements<
  Entries extends ReadonlyArray<StateMachine.AnyTransitionSchedule<any, any>>
> = Requirement.Of<Entries[number]>

/** The expected failures of every transition schedule in a bundle; `applyStateTransitions(bundle)` carries them. */
export type TransitionBundleFailure<
  Entries extends ReadonlyArray<StateMachine.AnyTransitionSchedule<any, any>>
> = CarriedFailure<Entries[number]>


/**
 * Applies every command queued so far, including commands queued by earlier
 * schedule runs.
 */
export const applyDeferred = (): ApplyDeferredStep => ({ kind: "applyDeferred" })

/**
 * Groups transition schedules into one bundle for
 * {@link applyStateTransitions}. Use `Game.Schedule.transitions(...)`,
 * which checks the entries against the bound game.
 */
export const transitions = <
  S extends Schema.Any,
  const Entries extends ReadonlyArray<TransitionBundleInput<S, any>>
>(...entries: Entries): TransitionBundleDefinition<
  S,
  FlattenTransitionEntries<Entries>,
  TransitionBundleRequirements<FlattenTransitionEntries<Entries>>,
  unknown,
  TransitionBundleRequirements<FlattenTransitionEntries<Entries>>,
  TransitionBundleFailure<FlattenTransitionEntries<Entries>>,
  CompositionOrder<Entries>
> => {
  const flattened = entries.flatMap((entry) =>
    "kind" in entry && entry.kind === "transitionBundle" ? [...entry.entries] : [entry]
  ) as unknown as FlattenTransitionEntries<Entries>

  return {
    kind: "transitionBundle",
    entries: flattened,
    requirements: Requirement.collect(flattened.flatMap((entry) => entry.requirements))
  } as TransitionBundleDefinition<
    S,
    FlattenTransitionEntries<Entries>,
    TransitionBundleRequirements<FlattenTransitionEntries<Entries>>,
    unknown,
    TransitionBundleRequirements<FlattenTransitionEntries<Entries>>,
    TransitionBundleFailure<FlattenTransitionEntries<Entries>>,
    CompositionOrder<Entries>
  >
}

/**
 * The marker that applies queued commands, then commits queued next states,
 * running the given bundle's transition schedules. Use
 * `Game.Schedule.applyStateTransitions(...)`, which checks the bundle
 * against the bound game.
 */
export const applyStateTransitions = <
  const Bundle extends TransitionBundleDefinition<any, any, any, any, any, any> | undefined = undefined
>(bundle?: Bundle): ApplyStateTransitionsStep<Bundle> => ({
  kind: "applyStateTransitions",
  bundle
}) as ApplyStateTransitionsStep<Bundle>

/**
 * Builds one schedule from systems, marker steps, and nested schedules.
 *
 * Nested schedules are flattened in place, so reusable pieces compose into
 * one ordered step list. The schema is inferred from the first system or
 * nested schedule; `Game.Schedule(...)` supplies it from the bound game
 * instead, so marker-only schedules are valid there.
 */
export function Schedule<const Entries extends ReadonlyArray<ScheduleEntry>>(
  ...entries: Entries
): AnonymousScheduleBuildFor<EntrySchema<Entries[number]>, Entries> {
  validateEntries(entries)
  return make(findPlanSchema(entries), entries)
}

/**
 * Builds one schedule for a known schema.
 */
export const make = <S extends Schema.Any, const Entries extends ReadonlyArray<ScheduleEntry>>(
  schema: S,
  entries: Entries
): AnonymousScheduleBuildFor<S, Entries> => {
  const steps = normalizeEntries(entries)
  validateUniqueSystemSteps(steps, "schedule")
  return {
    kind: "schedule",
    schema,
    steps,
    systems: collectUniqueSystems(steps),
    requirements: collectStepRequirements(steps)
  } as AnonymousScheduleBuildFor<S, Entries>
}

/**
 * Builds one schedule whose systems run only while every condition passes,
 * in addition to their own `when` conditions: the group equivalent of a
 * system's `when`, for gating many systems on one mode (playing, paused,
 * a hit-stop) without repeating it on each.
 *
 * Use this when the gated systems should drop the events published while
 * they were gated (a mode change makes them stale). Use `pauseWhen` instead
 * when they must read that backlog on resume (hit-stop, pause menu). For one
 * system, put the same conditions in its spec's `when` / `pauseWhen`.
 *
 * Conditions gate every system in `entries`, nested schedules included.
 * Marker steps (`applyDeferred`, `applyStateTransitions`) in the group still
 * run, and so do the transition schedules an `applyStateTransitions(bundle)`
 * in the group runs: gate those systems in their own specs. A gated system is the same system as far as the runtime is concerned:
 * it shares change detection and event cursors with the original and with
 * any other gated copy, so using one system in two groups of one schedule is
 * a duplicate like any other.
 */
export const when = <
  S extends Schema.Any,
  const Conditions extends ReadonlyArray<Condition>,
  const Entries extends ReadonlyArray<ScheduleEntry>
>(
  schema: S,
  conditions: Conditions,
  entries: Entries
): ConditionalScheduleBuildFor<S, Conditions, Entries> => {
  const steps = normalizeEntries(entries).map((step) => isSystemStep(step) ? gate(step, conditions, []) : step)
  validateUniqueSystemSteps(steps, "schedule")
  return {
    kind: "schedule",
    schema,
    steps,
    systems: collectUniqueSystems(steps),
    requirements: collectStepRequirements(steps)
  } as unknown as ConditionalScheduleBuildFor<S, Conditions, Entries>
}

/**
 * A schedule whose systems are paused while any of `conditions` fails: like
 * `when`, except that a paused system keeps its place in the event streams it
 * reads (and in transition events and relation failures), so it sees
 * everything published during the pause once it runs again. `when` discards
 * those messages, which is right for a mode change (menu, game over) but
 * loses the last hit of a step that started a hit-stop, or the kill that
 * fired a passive. Use `pauseWhen` for a freeze whose events stay valid, and
 * `when` for a mode after which they are stale; nest them to combine both.
 * Marker steps in the group still run.
 *
 * A paused reader holds its stream entries, so a long pause can reach
 * `Runtime.streamCapacity`; past it the oldest are dropped and the reader
 * sees `lagged() === true` when it resumes.
 *
 * @example
 * ```ts
 * const HitStop = Game.StateMachine("Game/HitStop", { Running: {}, Frozen: {} })
 * const ApplyHits = Game.System("Game/ApplyHits", { events: { hits: Game.System.readEvent(Hit) } }, ({ events }) => {
 *   for (const hit of events.hits.all()) console.log(hit.amount)
 * })
 * // ---cut---
 * const frozen = Game.Condition.inState(HitStop, "Frozen")
 * const gameplay = Game.Schedule.when([Game.Condition.inState(GameFlow, "Playing")],
 *   Game.Schedule.pauseWhen([Game.Condition.not(frozen)], Move, ApplyHits)
 * )
 * ```
 */
export const pauseWhen = <
  S extends Schema.Any,
  const Conditions extends ReadonlyArray<Condition>,
  const Entries extends ReadonlyArray<ScheduleEntry>
>(
  schema: S,
  conditions: Conditions,
  entries: Entries
): ConditionalScheduleBuildFor<S, Conditions, Entries> => {
  const steps = normalizeEntries(entries).map((step) => isSystemStep(step) ? gate(step, [], conditions) : step)
  validateUniqueSystemSteps(steps, "schedule")
  return {
    kind: "schedule",
    schema,
    steps,
    systems: collectUniqueSystems(steps),
    requirements: collectStepRequirements(steps)
  } as unknown as ConditionalScheduleBuildFor<S, Conditions, Entries>
}

/** A copy of `system` that also requires `when` (skipping) and `pauseWhen` (pausing) conditions, sharing runtime state with the original. */
const gate = (system: AnySystem, when: ReadonlyArray<Condition>, pauseWhen: ReadonlyArray<Condition>): AnySystem => ({
  ...system,
  spec: { ...system.spec, when: [...when, ...system.spec.when], pauseWhen: [...pauseWhen, ...system.spec.pauseWhen] },
  requirements: Requirement.collect([...system.requirements, ...[...when, ...pauseWhen].flatMap((condition) => condition.requirements)]),
  base: system.base ?? system
})

/** Whether a schedule step or entry is a system (not a marker or a nested schedule). */
export const isSystemStep = (step: ScheduleStep | ScheduleEntry): step is AnySystem =>
  typeof step === "object" && step !== null && "spec" in step

const isScheduleEntry = (entry: ScheduleEntry): entry is ScheduleDefinition<any, any, any, any, any, AnyScheduleOrder> =>
  typeof entry === "object" && entry !== null && "kind" in entry && entry.kind === "schedule"

const describeValue = (value: unknown): string =>
  value === null ? "null"
  : typeof value !== "object" ? `${typeof value} ${String(value)}`
  : `an object with keys ${Object.keys(value).join(", ") || "(none)"}`

/**
 * Rejects entries that are not systems, schedules, or marker steps, with a
 * message naming the entry. The types already prevent this; it catches
 * values that bypassed them (a stale import that is `undefined`, a
 * dynamically built list), which otherwise fail deep inside with an
 * unhelpful error.
 */
const validateEntries = (entries: ReadonlyArray<unknown>): void => {
  entries.forEach((entry, index) => {
    const valid = typeof entry === "object" && entry !== null && (
      "spec" in entry ||
      ("kind" in entry && (entry.kind === "schedule" || entry.kind === "applyDeferred" || entry.kind === "applyStateTransitions"))
    )
    if (!valid) {
      throw new Error(`Schedule entry ${index} is not a system, a schedule, or a marker step: got ${describeValue(entry)}. Is an import undefined?`)
    }
  })
}

const normalizeEntries = (entries: ReadonlyArray<ScheduleEntry>): ReadonlyArray<ScheduleStep> => {
  validateEntries(entries)
  return entries.flatMap((entry) =>
    isScheduleEntry(entry)
      ? [...entry.steps]
      : [entry]
  )
}

const findPlanSchema = <Entries extends ReadonlyArray<ScheduleEntry>>(
  entries: Entries
): EntrySchema<Entries[number]> => {
  const owner = entries.find((entry) => isSystemStep(entry) || "schema" in entry)
  if (!owner) {
    throw new Error("Schedule plan must include at least one system or schedule to infer its schema; use Game.Schedule(...) for marker-only schedules")
  }
  return (isSystemStep(owner) ? owner.spec.schema : owner.schema) as EntrySchema<Entries[number]>
}

const collectUniqueSystems = (steps: ReadonlyArray<ScheduleStep>): ReadonlyArray<AnySystem> => {
  const unique = new Map<symbol, AnySystem>()
  for (const step of steps) {
    if (isSystemStep(step) && !unique.has(step.ordering.key)) {
      unique.set(step.ordering.key, step)
    }
  }
  return [...unique.values()]
}

const collectStepRequirements = (
  steps: ReadonlyArray<ScheduleStep>
): ReadonlyArray<Requirement.Requirement> => Requirement.collect(steps.flatMap((step) => {
  if (isSystemStep(step)) return step.requirements
  if (step.kind === "applyStateTransitions") return step.bundle?.requirements ?? []
  return []
})) as ReadonlyArray<Requirement.Requirement>

const validateUniqueSystemSteps = (
  steps: ReadonlyArray<ScheduleStep>,
  context: string
): void => {
  const keys = new Set<symbol>()
  for (const step of steps) {
    if (!isSystemStep(step)) continue
    if (keys.has(step.ordering.key)) {
      throw new Error(`Duplicate system step in ${context}: ${step.ordering.name}`)
    }
    keys.add(step.ordering.key)
  }
}
