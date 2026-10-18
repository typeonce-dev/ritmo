/**
 * Implementation of the bound `Game` surface returned by `Schema.bind(...)`.
 *
 * Every constructor here is a thin, schema-aware wrapper over the unbound
 * module functions; the precise public types live on `Schema.Game`.
 */
import { nativeSymbol, registerLayouts } from "./native.ts"
import * as Command from "../Command.ts"
import type * as Debug from "../Debug.ts"
import type * as Snapshot from "../Snapshot.ts"
import type { Descriptor } from "../Descriptor.ts"
import * as Condition from "../Condition.ts"
import * as Entity from "../Entity.ts"
import * as EntityScope from "../EntityScope.ts"
import * as Inspector from "../Inspector.ts"
import * as Machine from "../Machine.ts"
import * as QueryModule from "../Query.ts"
import * as Relation from "../Relation.ts"
import * as Runtime from "../Runtime.ts"
import * as Requirement from "../Requirement.ts"
import * as Schedule from "../Schedule.ts"
import type { Schema } from "../Schema.ts"
import * as System from "../System.ts"
import { requirementIndex, withRequired } from "./requirements.ts"

/** Why an exit phase (`onExit`, `onTransition`) cannot contain `applyDeferred()`. */
export const exitApplyDeferredMessage =
  "onExit and onTransition schedules cannot contain applyDeferred(): the exit phase rolls back as one when a system in it fails, so its commands are applied at the next applyDeferred() after the marker" as const

export const makeGame = <S extends Schema.Any, Root>(schema: S, _root: Root): Schema.Game<S, Root> => {
  const requirements = requirementIndex(schema)
  const definedMachines: Array<Machine.StateMachine.Any> = []
  const definedMachineNames = new Set<string>()

  const defineMachine = (
    name: string,
    values: readonly [Machine.StateValue, ...Machine.StateValue[]],
    options?: { readonly within: readonly [Machine.StateMachine.Any, Machine.StateValue] }
  ) => {
    if (definedMachineNames.has(name)) {
      throw new Error(`Duplicate state machine name: ${name}`)
    }
    const machine = Machine.StateMachine(
      name,
      values,
      options === undefined ? undefined : { machine: options.within[0], state: options.within[1] }
    )
    definedMachines.push(machine)
    definedMachineNames.add(name)
    return machine
  }

  /**
   * Every scope defined through this game, in definition order. The runtime
   * reads their triggers at `Runtime.make`, so a scope only ever used with
   * `spawnIn` is still despawned by its state change.
   */
  const definedScopes: Array<EntityScope.EntityScope.Any> = []
  const definedScopeNames = new Set<string>()

  const defineScope = (
    name: string,
    options?: {
      readonly despawnOnEnter?: readonly [Machine.StateMachine.Any, Machine.StateValue]
      readonly despawnOnExit?: readonly [Machine.StateMachine.Any, Machine.StateValue]
    }
  ) => {
    if (definedScopeNames.has(name)) {
      throw new Error(`Duplicate entity scope name: ${name}`)
    }
    const triggers: Array<EntityScope.Trigger> = []
    if (options?.despawnOnExit !== undefined) {
      triggers.push({ phase: "exit", machine: options.despawnOnExit[0], state: options.despawnOnExit[1] })
    }
    if (options?.despawnOnEnter !== undefined) {
      triggers.push({ phase: "enter", machine: options.despawnOnEnter[0], state: options.despawnOnEnter[1] })
    }
    const scope = EntityScope.make(name, triggers)
    definedScopes.push(scope)
    definedScopeNames.add(name)
    return scope
  }

  const transitionSchedule = (
    transition: Machine.TransitionScheduleDefinition["transition"],
    plan: ReadonlyArray<Schedule.ScheduleEntry>
  ) => {
    const schedule = Schedule.make(schema, plan)
    if (transition.phase !== "enter" && schedule.steps.some((step) => !Schedule.isSystemStep(step) && step.kind === "applyDeferred")) {
      throw new Error(exitApplyDeferredMessage)
    }
    // The machine is a requirement: a runtime without it could never run the schedule.
    return { ...schedule, requirements: Requirement.collect([...schedule.requirements, transition.machine]), transition }
  }

  const game = {
    [nativeSymbol]: { layouts: (layouts: import("./native.ts").Layouts) => registerLayouts(schema, layouts) },
    schema,
    EntityScope: defineScope,
    Inspector: (name: string, spec: object, read: (context: any) => unknown) =>
      Inspector.make(name, { schema, ...spec } as never, read),
    Entity: {
      handle: Entity.handle,
      id: (handle: number) => Entity.makeEntityId(handle)
    },
    Query: Object.assign((spec: never) => QueryModule.Query(spec), {
      read: QueryModule.read,
      write: QueryModule.write,
      optional: QueryModule.optional,
      added: QueryModule.added,
      changed: QueryModule.changed,
      anyOf: QueryModule.anyOf,
      readRelation: Relation.read,
      optionalRelation: Relation.optional,
      readRelated: Relation.readRelated,
      optionalRelated: Relation.optionalRelated
    }),
    Command: {
      spawn: Command.spawn,
      extend: Command.extend,
      entry: Command.entry,
      entryRaw: Command.entryRaw,
      relate: Command.relate
    },
    StateMachine: defineMachine,
    Condition: {
      inState: Machine.inState,
      stateChanged: Machine.stateChanged,
      not: Machine.not,
      and: Machine.and,
      or: Machine.or,
      check: (name: string, spec: Condition.CheckAccessInput, predicate: (context: any) => boolean) =>
        Condition.check(schema, name, spec as never, predicate)
    },
    System: Object.assign(
      (name: string, spec: object, run: (context: any) => any) =>
        System.System(name, { schema, ...spec } as never, run),
      {
        readResource: System.readResource,
        writeResource: System.writeResource,
        changedResource: System.changedResource,
        readEvent: System.readEvent,
        writeEvent: System.writeEvent,
        thisTick: System.thisTick,
        commands: Command.commands,
        // `spawns(Player)` also allows what `Player` requires (`Schema.requires`), matching its type.
        spawns: (...components: ReadonlyArray<Descriptor<"component", string, any>>) =>
          // Internally erased: the bound signature already requires at least one component.
          Command.spawns(...(withRequired(requirements, components) as unknown as readonly [Descriptor<"component", string, any>])),
        inserts: Command.inserts,
        removes: Command.removes,
        despawns: Command.despawns,
        despawnsScope: Command.despawnsScope,
        relates: Command.relates,
        service: System.service,
        machine: System.machine,
        nextState: System.nextState,
        readTransitionEvent: System.readTransitionEvent,
        transition: System.transition,
        readRemoved: System.readRemoved,
        readDespawned: System.readDespawned,
        readRelationFailures: System.readRelationFailures
      }
    ),
    Schedule: Object.assign(
      (...entries: ReadonlyArray<Schedule.ScheduleEntry>) => Schedule.make(schema, entries),
      {
        transitions: Schedule.transitions,
        onEnter: (machine: Machine.StateMachine.Any, state: Machine.StateValue, plan: ReadonlyArray<Schedule.ScheduleEntry>) =>
          transitionSchedule({ machine, phase: "enter", state }, plan),
        onExit: (machine: Machine.StateMachine.Any, state: Machine.StateValue, plan: ReadonlyArray<Schedule.ScheduleEntry>) =>
          transitionSchedule({ machine, phase: "exit", state }, plan),
        onTransition: (
          machine: Machine.StateMachine.Any,
          [from, to]: readonly [Machine.StateValue, Machine.StateValue],
          plan: ReadonlyArray<Schedule.ScheduleEntry>
        ) => transitionSchedule({ machine, phase: "transition", from, to }, plan),
        when: (conditions: ReadonlyArray<Machine.Condition>, ...entries: ReadonlyArray<Schedule.ScheduleEntry>) =>
          Schedule.when(schema, conditions, entries),
        pauseWhen: (conditions: ReadonlyArray<Machine.Condition>, ...entries: ReadonlyArray<Schedule.ScheduleEntry>) =>
          Schedule.pauseWhen(schema, conditions, entries),
        applyDeferred: Schedule.applyDeferred,
        applyStateTransitions: Schedule.applyStateTransitions
      }
    ),
    Runtime: {
      make: (options: {
        readonly services: Runtime.RuntimeServices<any>
        readonly resources?: object
        readonly machines?: Runtime.RuntimeMachines<any>
        readonly debug?: Debug.Option
        readonly saves?: Snapshot.Migrations
      }) => Runtime.make({ schema, ...options, machineDefinitions: definedMachines, scopeDefinitions: definedScopes } as never),
      service: Runtime.service,
      services: Runtime.services,
      machine: Runtime.machine,
      machines: Runtime.machines
    }
  }

  return game as unknown as Schema.Game<S, Root>
}
