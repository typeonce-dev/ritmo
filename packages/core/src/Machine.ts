/**
 * Finite-state machine definitions and transition metadata.
 *
 * State machines model queued discrete phase changes whose commit boundaries
 * matter to schedule execution.
 *
 * Use this module when gameplay depends not only on the current mode, but also
 * on exactly when a mode change becomes committed and which schedules should
 * run around that boundary. Menus, rounds, encounter phases, pause flows, and
 * restart/reset pipelines are the canonical cases.
 *
 * A machine holds one value for the whole game. A state that each entity has
 * on its own (an enemy's attack windup, a door's open/closed) is not a
 * machine: use a `Descriptor.EntityState(...)` component instead.
 *
 * @example
 * ```ts
 * // Model a gameplay phase whose transition timing matters.
 * const GameFlow = Game.StateMachine("Game/GameFlow", { Menu: {}, Playing: z.object({ level: z.int() }) })
 *
 * // Gate one system so it only runs in the committed playing phase.
 * const isPlaying = Machine.inState(GameFlow, "Playing")
 * ```
 *
 * @module Machine
 * @docGroup core
 *
 * @groupDescription Namespaces
 * Grouped machine helper types for conditions, transitions, and machine-aware requirements.
 *
 * @groupDescription Interfaces
 * Public state-machine contracts and transition bundle shapes.
 *
 * @groupDescription Type Aliases
 * Shared machine state, transition, and requirement helper types.
 *
 * @groupDescription Functions
 * Public constructors for machines, conditions, and explicit transition bundles.
 */
import type { StateDefinitions, StateValueOf } from "./Descriptor.ts"
import type { AnyScheduleOrder, Schedule } from "./Schedule.ts"
import * as Requirement from "./Requirement.ts"
import type * as Result from "./Result.ts"
import type { Schema } from "./Schema.ts"
import type { SystemFailure } from "./System.ts"

/**
 * One schema-bound finite state machine definition: its states, each with its
 * own fields (`{}` for a state without data).
 */
export interface StateMachineDefinition<
  out Name extends string = string,
  out States extends StateDefinitions = StateDefinitions,
  out Root = unknown,
  out Parent = unknown
> {
  readonly kind: "stateMachine"
  readonly name: Name
  readonly key: symbol
  readonly states: States
  /** For a sub-state: the machine and the state it exists in. */
  readonly within?: SubStateParent | undefined
  readonly __schemaRoot?: Root | undefined
  /** The machine a sub-state exists within; `unknown` for a top-level machine. */
  readonly __parent?: (_: never) => Parent
}

/** Where a sub-state exists: while `machine` is in `state`. */
export interface SubStateParent {
  readonly machine: StateMachine.Any
  readonly state: string
}

/**
 * The value of a machine, or of one of its states: its name in `_tag`, next
 * to that state's fields. What game functions that work on the mode take and
 * return.
 *
 * @example
 * ```ts
 * const Mode = Game.StateMachine("Town/Mode", {
 *   Exploring: {},
 *   Talking: z.object({ speaker: z.string(), page: z.int() })
 * })
 * const nextPage = (talking: Machine.StateOf<typeof Mode, "Talking">) => talking.page + 1
 * const describe = (mode: Machine.StateOf<typeof Mode>) => mode._tag
 * ```
 */
export type StateOf<
  M extends StateMachine.Any,
  State extends StateMachine.State<M> = StateMachine.State<M>
> = StateValueOf<M["states"], State>

/** Any machine's value, as tools that print every machine see it. */
export interface AnyValue {
  readonly _tag: string
}

/**
 * Whether `M` is a sub-state (declared with `within`): it has no value while
 * its parent machine is in another state.
 */
export type IsSubState<M> =
  M extends { readonly __parent?: (_: never) => infer Parent } ? unknown extends Parent ? false : true : false

/**
 * The committed value of `M`. A sub-state has none (`undefined`) while its
 * parent machine is not in the state it exists in; a top-level machine
 * always has one.
 */
export type CurrentValue<M extends StateMachine.Any> =
  IsSubState<M> extends true ? StateOf<M> | undefined : StateOf<M>

/** The name of `M`'s committed state; `undefined` for a sub-state without a value. */
export type CurrentState<M extends StateMachine.Any> =
  IsSubState<M> extends true ? StateMachine.State<M> | undefined : StateMachine.State<M>

/**
 * Why queuing or updating a sub-state failed: its parent machine is not in
 * the state the sub-state exists in, so there is nothing to change.
 */
export interface SubStateInactive {
  readonly _tag: "SubStateInactive"
  /** The sub-state's name. */
  readonly machine: string
  /** The parent machine's name. */
  readonly parent: string
  /** The parent state the sub-state exists in. */
  readonly requires: string
}

/**
 * An `update` found the machine in another state, so nothing was written.
 */
export interface MachineStateMismatch<State extends string = string> {
  readonly _tag: "MachineStateMismatch"
  /** The machine's name. */
  readonly machine: string
  /** The state `update` was given. */
  readonly expected: State
  /** The state the machine was actually in. */
  readonly actual: State
}

/**
 * What `nextMachines.x.set(...)` returns: nothing for a top-level machine,
 * and for a sub-state a `Result` that fails with `SubStateInactive` when its
 * parent is in another state.
 */
export type SetResult<M extends StateMachine.Any> =
  IsSubState<M> extends true ? Result.Result<void, SubStateInactive> : void

/**
 * What `machines.x.update(...)` returns: a failure with
 * `MachineStateMismatch` when the machine is in another state, and for a
 * sub-state with `SubStateInactive` when it has no value.
 */
export type UpdateResult<M extends StateMachine.Any> = Result.Result<
  void,
  MachineStateMismatch<StateMachine.State<M>> | (IsSubState<M> extends true ? SubStateInactive : never)
>

/**
 * The runtime-visible transition payload for one machine: the names of the
 * states it left and entered. The entered state's fields are the machine's
 * value (`machines.x.get()`); in `onExit` the value is still the state being
 * left. For a sub-state, `from` is `undefined` when it starts existing (its
 * parent entered its state) and `to` is `undefined` when it stops.
 */
export interface TransitionSnapshot<M extends StateMachineDefinition = StateMachineDefinition> {
  readonly from: CurrentState<M>
  readonly to: CurrentState<M>
}

/**
 * Read access to the current committed state in a system spec.
 */
export interface MachineRead<M extends StateMachineDefinition = StateMachineDefinition> {
  readonly machine: M
  readonly mode: "read"
}

/**
 * Immediate write access to the fields of the current state in a system spec
 * (`Game.System.updateMachine`). It reads too.
 */
export interface MachineUpdate<M extends StateMachineDefinition = StateMachineDefinition> {
  readonly machine: M
  readonly mode: "update"
}

/**
 * Queued write access to the next state in a system spec.
 */
export interface NextMachineWrite<M extends StateMachineDefinition = StateMachineDefinition> {
  readonly machine: M
}

/**
 * Read access to transition metadata in a system spec.
 */
export interface TransitionRead<M extends StateMachineDefinition = StateMachineDefinition> {
  readonly machine: M
}

/**
 * Read access to committed transition events in a system spec.
 */
export interface TransitionEventRead<M extends StateMachineDefinition = StateMachineDefinition> {
  readonly machine: M
}

/**
 * A typed declarative run condition.
 */
export type Condition<Root = unknown> =
  | InStateCondition<StateMachineDefinition<string, StateDefinitions, Root>>
  | StateChangedCondition<StateMachineDefinition<string, StateDefinitions, Root>>
  | NotCondition<Condition<Root>>
  | AndCondition<ReadonlyArray<Condition<Root>>>
  | OrCondition<ReadonlyArray<Condition<Root>>>
  | CheckCondition<Root>

/** Made by `inState(machine, state)`. */
export interface InStateCondition<M extends StateMachineDefinition = StateMachineDefinition> {
  readonly kind: "inState"
  readonly machine: M
  /** Checked against `M` by `inState`; a plain string keeps the condition covariant in `M`. */
  readonly state: string
  readonly requirements: ReadonlyArray<Requirement.RequirementValue>
  readonly __conditionNeeds?: M | undefined
}

/** Made by `stateChanged(machine)`. */
export interface StateChangedCondition<M extends StateMachineDefinition = StateMachineDefinition> {
  readonly kind: "stateChanged"
  readonly machine: M
  readonly requirements: ReadonlyArray<Requirement.RequirementValue>
  readonly __conditionNeeds?: M | undefined
}

/** Made by `not(condition)`. */
export interface NotCondition<
  C extends Condition = Condition,
  Needs extends Requirement.Requirement = Requirement.Requirement
> {
  readonly kind: "not"
  readonly condition: C
  readonly requirements: ReadonlyArray<Requirement.RequirementValue>
  readonly __conditionNeeds?: Needs | undefined
}

/** Made by `and(...conditions)`. */
export interface AndCondition<
  C extends ReadonlyArray<Condition> = ReadonlyArray<Condition>,
  Needs extends Requirement.Requirement = Requirement.Requirement
> {
  readonly kind: "and"
  readonly conditions: C
  readonly requirements: ReadonlyArray<Requirement.RequirementValue>
  readonly __conditionNeeds?: Needs | undefined
}

/** Made by `or(...conditions)`. */
export interface OrCondition<
  C extends ReadonlyArray<Condition> = ReadonlyArray<Condition>,
  Needs extends Requirement.Requirement = Requirement.Requirement
> {
  readonly kind: "or"
  readonly conditions: C
  readonly requirements: ReadonlyArray<Requirement.RequirementValue>
  readonly __conditionNeeds?: Needs | undefined
}

/**
 * A run condition computed by a read-only predicate over declared resources,
 * machines, and plain queries (see `Condition.check` / `Game.Condition.check`).
 *
 * The predicate is evaluated just before each gated system runs, against
 * committed values: writes by earlier systems in the same run are visible.
 * Its access excludes every read that consumes or advances a per-reader
 * cursor (events, `added`/`changed` filters, removed/despawned records), so
 * evaluating it any number of times gives the same answer until something it
 * reads is written.
 */
export interface CheckCondition<
  Root = unknown,
  Needs extends Requirement.Requirement = Requirement.Requirement
> {
  readonly kind: "check"
  /** Shown by devtools in place of the predicate. */
  readonly name: string
  /**
   * The read-only projection evaluated for the check. Opaque on purpose: the
   * runtime and devtools read it; keeping its type out of the `Condition`
   * union keeps every system's `when` cheap to check.
   */
  readonly projection: CheckProjection
  readonly requirements: ReadonlyArray<Requirement.RequirementValue>
  readonly __conditionNeeds?: Needs | undefined
  readonly __schemaRoot?: Root | undefined
}

/** The opaque read-only projection behind a `CheckCondition`. */
export interface CheckProjection {
  readonly kind: "inspector"
  readonly name: string
}

/**
 * A machine-bound transition schedule created through the schema-bound API.
 */
export interface TransitionScheduleDefinition<
  S extends Schema.Any = Schema.Any,
  M extends StateMachineDefinition = StateMachineDefinition,
  Needs extends Requirement.Requirement = Requirement.Requirement,
  Root = unknown,
  Failure extends SystemFailure = never,
  Order extends AnyScheduleOrder = AnyScheduleOrder
> {
  readonly steps: ReadonlyArray<Schedule.Step>
  readonly systems: ReadonlyArray<unknown>
  readonly schema: S
  readonly requirements: ReadonlyArray<Needs>
  readonly __failure?: (_: never) => Failure
  /** The plan's order, for `Game.System.thisTick` checks of the tick that applies it. */
  readonly __order?: (_: never) => Order
  readonly __schemaRoot?: Root | undefined
  readonly transition: {
    readonly machine: M
    readonly phase: "enter" | "exit" | "transition"
    // State names as plain strings: `onEnter` / `onExit` / `onTransition`
    // check them against `M`, and a name type here would make the schedule
    // invariant in `M` (`keyof`), so it would not fit `AnyTransitionSchedule`.
    readonly state?: string
    readonly from?: string
    readonly to?: string
  }
}

/**
 * Type-level and value-level helpers for finite-state machines.
 */
export namespace StateMachine {
  /** Any state machine, whatever its states and game; a bound for generic code. */
  export type Any = StateMachineDefinition
  /** The names of `M`'s states. */
  export type State<M extends Any> = keyof M["states"] & string
  /** The game root a machine belongs to (the `Game` whose `Game.StateMachine` made it). */
  export type Root<M extends Any> = M extends StateMachineDefinition<string, StateDefinitions, infer R> ? R : never
  /** Any run condition of the game rooted at `Root` (`Game.Condition.inState(...)`, `not`, `or`). */
  export type AnyCondition<Root = unknown> = Condition<Root>
  /** Any transition schedule (`Game.Schedule.onEnter` / `onExit` / `onTransition`) of the game rooted at `Root`. */
  export type AnyTransitionSchedule<S extends Schema.Any = Schema.Any, Root = unknown> =
    TransitionScheduleDefinition<S, Any, Requirement.Requirement, Root, SystemFailure>
}

/**
 * `unknown` when `M` was defined by the game rooted at `Root`; otherwise a
 * type naming the fix, so passing another game's machine fails with that
 * message.
 */
export type SameGame<M, Root> =
  M extends StateMachineDefinition<infer Name, StateDefinitions, infer MachineRoot>
    ? [Root] extends [MachineRoot]
      ? [MachineRoot] extends [Root]
        ? unknown
        : ForeignMachine<`${Name} is a state machine of another game: use a machine defined with this game's Game.StateMachine(...)`>
      : ForeignMachine<`${Name} is a state machine of another game: use a machine defined with this game's Game.StateMachine(...)`>
    : unknown

/** The message type `SameGame` resolves to: a type error prints `Message`. */
type ForeignMachine<Message extends string> = { readonly __foreignMachine__: Message }

/** Extracts the machine token from one declared machine access slot. */
type MachineFromAccess<Access> =
  Access extends { readonly machine: infer M extends StateMachine.Any } ? M : never

/**
 * Extracts every requirement (machines, and the resources a `check` reads)
 * mentioned by one run condition, through `not`/`and`/`or`.
 */
export type ConditionNeeds<C> =
  C extends { readonly __conditionNeeds?: infer N extends Requirement.Requirement | undefined }
    ? NonNullable<N>
    : never

/** Extracts the requirement union carried by a condition list. */
export type ConditionNeedsFromConditions<C extends ReadonlyArray<Condition>> =
  ConditionNeeds<C[number]>

/** Extracts only the machine tokens mentioned by one run condition. */
export type MachineNeedsFromCondition<C> = Extract<ConditionNeeds<C>, StateMachine.Any>

/** Extracts the machine-token union carried by a named access record. */
export type MachineNeedsFromRecord<R extends Record<string, unknown>> =
  MachineFromAccess<R[keyof R]>

/** Extracts the machine-token union carried by a condition list. */
export type MachineNeedsFromConditions<C extends ReadonlyArray<Condition>> =
  MachineNeedsFromCondition<C[number]>

/**
 * Creates a schema-bound finite-state machine definition: one game-wide mode.
 * Games declare machines with `Game.StateMachine(...)`, whose JSDoc describes
 * the states and their data.
 *
 * Use `Descriptor.EntityState(...)` instead when every entity carries its own
 * state (per-entity, written immediately, no enter/exit schedules).
 */
export const StateMachine = <
  const Name extends string,
  const States extends StateDefinitions,
  Root = unknown
>(
  name: Name,
  states: States,
  within?: SubStateParent
): StateMachineDefinition<Name, States, Root> => ({
  kind: "stateMachine",
  name,
  key: Symbol.for(`ritmo/stateMachine/${name}`),
  states,
  ...(within === undefined ? {} : { within })
})

/**
 * Declares that a system wants to read the current committed state.
 *
 * Use this for the current committed phase value. Queued updates remain hidden
 * until the schedule reaches `applyStateTransitions(...)`.
 */
export const read = <M extends StateMachine.Any>(machine: M): MachineRead<M> => ({
  machine,
  mode: "read"
})

/**
 * Declares that a system wants to change the fields of the current state
 * immediately, without leaving it. The state name changes only at the commit;
 * the current state's fields change immediately.
 */
export const update = <M extends StateMachine.Any>(machine: M): MachineUpdate<M> => ({
  machine,
  mode: "update"
})

/**
 * Declares that a system wants to queue the next state.
 *
 * This is the machine equivalent of "request a phase change later". The change
 * becomes committed only at `applyStateTransitions(...)`.
 */
export const write = <M extends StateMachine.Any>(machine: M): NextMachineWrite<M> => ({
  machine
})

/**
 * Declares that a system wants access to the last applied transition payload.
 */
export const transition = <M extends StateMachine.Any>(machine: M): TransitionRead<M> => ({
  machine
})

/**
 * Declares that a system wants to read committed transition events for one machine.
 *
 * Use this when later systems need to observe that a transition happened after
 * the schedule has already committed it.
 */
export const readTransitionEvent = <M extends StateMachine.Any>(machine: M): TransitionEventRead<M> => ({
  machine
})

/**
 * Creates a condition that only passes in one machine state, whatever its
 * fields.
 *
 * Use this to gate systems or schedule entries by the committed gameplay phase.
 * If you need this kind of gating, the value should generally be modeled as a
 * finite-state machine rather than a plain state descriptor.
 */
export const inState = <M extends StateMachine.Any>(
  machine: M,
  state: StateMachine.State<M>
): InStateCondition<M> => ({
  kind: "inState",
  machine,
  state,
  requirements: [machine]
})

/**
 * Creates a condition that passes when the machine changed during the current schedule execution:
 * from the `applyStateTransitions(...)` that committed the change to the end of
 * that schedule (or the next `applyStateTransitions(...)`), not for the rest of
 * the tick call or the next schedule.
 */
export const stateChanged = <M extends StateMachine.Any>(
  machine: M
): StateChangedCondition<M> => ({
  kind: "stateChanged",
  machine,
  requirements: [machine]
})

/**
 * Negates another condition.
 */
export const not = <C extends Condition>(condition: C): NotCondition<C, ConditionNeeds<C>> => ({
  kind: "not",
  condition,
  requirements: condition.requirements
})

/**
 * Requires every child condition to pass.
 */
export const and = <const C extends ReadonlyArray<Condition>>(...conditions: C): AndCondition<C, ConditionNeeds<C[number]>> => ({
  kind: "and",
  conditions,
  requirements: Requirement.collect(conditions.flatMap((condition) => condition.requirements))
})

/**
 * Requires at least one child condition to pass.
 */
export const or = <const C extends ReadonlyArray<Condition>>(...conditions: C): OrCondition<C, ConditionNeeds<C[number]>> => ({
  kind: "or",
  conditions,
  requirements: Requirement.collect(conditions.flatMap((condition) => condition.requirements))
})
