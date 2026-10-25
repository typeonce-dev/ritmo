/**
 * Static parts of the runtime debug handle: naming, schema and schedule
 * descriptions, access indexes, and lints. Everything here reads definitions
 * only; world state is passed in by the runtime.
 */
import type * as Debug from "../Debug.ts"
import * as DescriptorModule from "../Descriptor.ts"
import type { Descriptor } from "../Descriptor.ts"
import type * as EntityScope from "../EntityScope.ts"
import type * as Inspector from "../Inspector.ts"
import type * as Machine from "../Machine.ts"
import type * as Query from "../Query.ts"
import type * as Relation from "../Relation.ts"
import * as Schedule from "../Schedule.ts"
import * as OrderInternal from "./order.ts"
import type { Schema } from "../Schema.ts"
import type { SystemDefinition } from "../System.ts"

type AnySystem = SystemDefinition<any, any, any>
type AnySchedule = { readonly steps: ReadonlyArray<Schedule.ScheduleStep> }
type TransitionSchedule = Machine.StateMachine.AnyTransitionSchedule<any, any>

export const storageOf = (descriptor: Descriptor.Any): Debug.Storage =>
  DescriptorModule.isTransient(descriptor) ? "transient"
  : DescriptorModule.hasConstructor(descriptor) ? "constructed"
  : "plain"

/** A machine value as text: its state's name, then its fields when it has any (`Talking {"page":2}`). */
export const renderState = (value: Machine.AnyValue): string => {
  const { _tag, ...fields } = value
  return Object.keys(fields).length === 0 ? _tag : `${_tag} ${JSON.stringify(fields)}`
}

export const renderCondition = (condition: Machine.Condition): string => {
  switch (condition.kind) {
    case "inState":
      return `inState(${condition.machine.name}=${condition.state})`
    case "stateChanged":
      return `stateChanged(${condition.machine.name})`
    case "not":
      return `not(${renderCondition(condition.condition)})`
    case "and":
      return condition.conditions.map(renderCondition).join(" and ")
    case "or":
      return `(${condition.conditions.map(renderCondition).join(" or ")})`
    case "check":
      return `check(${condition.name})`
  }
}

/** Every `check` condition inside a condition list, through `not`/`and`/`or`. */
const checksOf = (conditions: ReadonlyArray<Machine.Condition>): Array<Machine.CheckCondition> =>
  conditions.flatMap((condition): Array<Machine.CheckCondition> => {
    switch (condition.kind) {
      case "check":
        return [condition]
      case "not":
        return checksOf([condition.condition])
      case "and":
      case "or":
        return checksOf(condition.conditions)
      default:
        return []
    }
  })

export const transitionScheduleName = (schedule: TransitionSchedule): string => {
  const { machine, phase, state, from, to } = schedule.transition
  switch (phase) {
    case "enter":
      return `onEnter(${machine.name}=${String(state)})`
    case "exit":
      return `onExit(${machine.name}=${String(state)})`
    case "transition":
      return `onTransition(${machine.name}: ${String(from)}->${String(to)})`
  }
}

const names = <A>(record: Record<string, A>, name: (value: A) => string): Array<string> =>
  Object.values(record).map(name)

const lifecycleNames = (filters: ReadonlyArray<Query.Filter<any>>, kind: "added" | "changed"): Array<string> =>
  filters.flatMap((filter) => filter.kind === kind ? [filter.descriptor.name] : [])

const describeQuery = (slot: string, query: Query.Query.Any<any>): Debug.QueryDescription => {
  const reads: Array<string> = []
  const writes: Array<string> = []
  const optional: Array<string> = []
  const relations: Array<string> = []
  for (const access of Object.values(query.selection) as ReadonlyArray<{ readonly mode: string; readonly descriptor: { readonly name?: string; readonly relatedName?: string } }>) {
    const name = access.descriptor.name ?? access.descriptor.relatedName ?? "?"
    switch (access.mode) {
      case "read":
        reads.push(name)
        break
      case "write":
        writes.push(name)
        break
      case "optional":
        optional.push(name)
        break
      default:
        relations.push(`${access.mode} ${name}`)
    }
  }
  const relationNames = (list: ReadonlyArray<Relation.Relation.Any>, label: string) =>
    list.map((relation) => `${label} ${relation.name}`)
  return {
    slot,
    reads,
    writes,
    optional,
    with: query.with.map((descriptor) => descriptor.name),
    without: query.without.map((descriptor) => descriptor.name),
    added: lifecycleNames(query.filters, "added"),
    changed: lifecycleNames(query.filters, "changed"),
    anyOf: query.filters.flatMap((filter) => filter.kind === "anyOf"
      ? [{ added: lifecycleNames(filter.filters, "added"), changed: lifecycleNames(filter.filters, "changed") }]
      : []),
    relations: [
      ...relations,
      ...relationNames(query.withRelations, "with"),
      ...relationNames(query.withoutRelations, "without"),
      ...relationNames(query.withRelated, "withRelated"),
      ...relationNames(query.withoutRelated, "withoutRelated")
    ]
  }
}

type Mode = { readonly mode: "read" | "changed" | "write"; readonly descriptor: Descriptor.Any }
type CommandAccess = { readonly permissions: ReadonlyArray<{ readonly permission: keyof Debug.CommandPermissions; readonly values: ReadonlyArray<{ readonly name: string }> }> }

const permissionsOf = (access: CommandAccess | undefined): Debug.CommandPermissions => {
  const of = (kind: keyof Debug.CommandPermissions) =>
    [...new Set((access?.permissions ?? []).filter((p) => p.permission === kind).flatMap((p) => p.values.map((value) => value.name)))]
  return {
    spawns: of("spawns"),
    inserts: of("inserts"),
    removes: of("removes"),
    despawns: of("despawns"),
    despawnsScope: of("despawnsScope"),
    relates: of("relates")
  }
}

const permissionVerb: Record<keyof Debug.CommandPermissions, string> = {
  spawns: "spawn",
  inserts: "insert",
  removes: "remove",
  despawns: "despawn",
  despawnsScope: "despawn the scope",
  relates: "relate"
}
type ThisTickAccess = Mode & { readonly thisTick?: true }

export const describeSystem = (system: AnySystem, placements: ReadonlyArray<string>): Debug.SystemDescription => {
  const spec = system.spec
  const byMode = (record: Record<string, Mode>, mode: Mode["mode"]) =>
    Object.values(record).filter((access) => access.mode === mode).map((access) => access.descriptor.name)
  const machineName = (access: { readonly machine: Machine.StateMachine.Any }) => access.machine.name
  const machinesByMode = (record: Record<string, { readonly machine: Machine.StateMachine.Any; readonly mode: "read" | "update" }>, mode: "read" | "update") =>
    Object.values(record).filter((access) => access.mode === mode).map(machineName)
  // A system also reads whatever its `check` conditions read.
  const checks = checksOf([...(spec.when as ReadonlyArray<Machine.Condition>), ...(spec.pauseWhen as ReadonlyArray<Machine.Condition>)]).map((check) => ({
    name: check.name,
    spec: (check.projection as Inspector.InspectorDefinition).system.spec
  }))
  const unique = (values: ReadonlyArray<string>) => [...new Set(values)]
  return {
    name: system.name,
    placements,
    queries: [
      ...Object.entries(spec.queries as Record<string, Query.Query.Any<any>>).map(([slot, query]) => describeQuery(slot, query)),
      ...checks.flatMap((check) =>
        Object.entries(check.spec.queries as Record<string, Query.Query.Any<any>>).map(([slot, query]) => describeQuery(`check(${check.name}).${slot}`, query)))
    ],
    resources: {
      reads: unique([...byMode(spec.resources, "read"), ...byMode(spec.resources, "changed"), ...checks.flatMap((check) => byMode(check.spec.resources, "read"))]),
      changed: byMode(spec.resources, "changed"),
      writes: byMode(spec.resources, "write")
    },
    events: { reads: byMode(spec.events, "read"), writes: byMode(spec.events, "write") },
    machines: {
      reads: unique([...machinesByMode(spec.machines, "read"), ...checks.flatMap((check) => machinesByMode(check.spec.machines, "read"))]),
      updates: machinesByMode(spec.machines, "update"),
      next: names(spec.nextMachines, machineName),
      transitions: names(spec.transitions, machineName),
      transitionEvents: names(spec.transitionEvents, machineName)
    },
    removed: names(spec.removed as Record<string, { readonly descriptor: Descriptor.Any }>, (access) => access.descriptor.name),
    despawned: Object.keys(spec.despawned).length > 0,
    relationFailures: names(spec.relationFailures as Record<string, { readonly relation: Relation.Relation.Any }>, (access) => access.relation.name),
    droppedRelations: names(spec.droppedRelations as Record<string, { readonly relation: Relation.Relation.Any }>, (access) => access.relation.name),
    thisTick: [
      ...[...Object.values(spec.events as Record<string, ThisTickAccess>), ...Object.values(spec.resources as Record<string, ThisTickAccess>)]
        .filter((access) => access.thisTick === true)
        .map((access) => access.descriptor.name),
      ...Object.entries(spec.queries as Record<string, { readonly thisTick?: true }>)
        .filter(([, query]) => query.thisTick === true)
        .map(([slot]) => `queries.${slot}`)
    ],
    services: names(spec.services as Record<string, { readonly descriptor: Descriptor.Any }>, (access) => access.descriptor.name),
    consumes: Object.values(spec.services as Record<string, { readonly descriptor: Descriptor.Any; readonly consumes?: true }>)
      .filter((access) => access.consumes === true)
      .map((access) => access.descriptor.name),
    commands: permissionsOf(spec.commands as CommandAccess | undefined),
    when: (spec.when as ReadonlyArray<Machine.Condition>).map(renderCondition),
    pauseWhen: (spec.pauseWhen as ReadonlyArray<Machine.Condition>).map(renderCondition),
    local: spec.local !== undefined
  }
}

/**
 * Walks named schedules, including the transition schedules reachable from
 * their `applyStateTransitions` markers.
 */
const collectSchedules = (
  named: ReadonlyArray<readonly [string, AnySchedule]>
): ReadonlyArray<readonly [string, AnySchedule]> => {
  const result: Array<readonly [string, AnySchedule]> = []
  const seen = new Set<AnySchedule>()
  const visit = (name: string, schedule: AnySchedule) => {
    if (seen.has(schedule)) return
    seen.add(schedule)
    result.push([name, schedule])
    for (const step of schedule.steps) {
      if (!Schedule.isSystemStep(step) && step.kind === "applyStateTransitions" && step.bundle) {
        for (const entry of step.bundle.entries as ReadonlyArray<TransitionSchedule>) {
          visit(transitionScheduleName(entry), entry)
        }
      }
    }
  }
  for (const [name, schedule] of named) visit(name, schedule)
  return result
}

export const describeStep = (step: Schedule.ScheduleStep): Debug.StepDescription => {
  if (Schedule.isSystemStep(step)) return { kind: "system", system: step.name }
  if (step.kind === "applyDeferred") return { kind: "applyDeferred" }
  return {
    kind: "applyStateTransitions",
    schedules: ((step.bundle?.entries ?? []) as ReadonlyArray<TransitionSchedule>).map(transitionScheduleName)
  }
}

class Index {
  private readonly entries = new Map<string, { readers: Set<string>; writers: Set<string> }>()

  constructor(order: ReadonlyArray<string>) {
    for (const name of order) this.entry(name)
  }

  private entry(name: string) {
    let entry = this.entries.get(name)
    if (!entry) {
      entry = { readers: new Set(), writers: new Set() }
      this.entries.set(name, entry)
    }
    return entry
  }

  read(name: string, system: string) {
    this.entry(name).readers.add(system)
  }

  write(name: string, system: string) {
    this.entry(name).writers.add(system)
  }

  list(): Array<Debug.AccessIndexEntry> {
    return [...this.entries].map(([name, entry]) => ({
      name,
      readers: [...entry.readers],
      writers: [...entry.writers]
    }))
  }
}

export interface DescribeInput {
  readonly schema: Schema.Any
  readonly machines: ReadonlyArray<Machine.StateMachine.Any>
  readonly currentMachine: (machine: Machine.StateMachine.Any) => Machine.AnyValue | undefined
  /** Whether the runtime was given an initial value for the machine. */
  readonly providesMachine: (machine: Machine.StateMachine.Any) => boolean
  /** Every scope defined through the game, with its despawn triggers. */
  readonly scopes: ReadonlyArray<EntityScope.EntityScope.Any>
  readonly providedServices: ReadonlyArray<string>
  /** Findings provided services report through `Debug.serviceLints`, by service name. */
  readonly serviceLints: ReadonlyArray<readonly [string, ReadonlyArray<Debug.ServiceLint>]>
  readonly externallyWrittenEvents: ReadonlySet<string>
  /** Relations commands have tried to relate or reorder, by the queuing systems. */
  readonly relationMutations: ReadonlyMap<string, ReadonlySet<string>>
  /** What each system's applied commands did, as `kind:name`; see `Runtime`. */
  readonly commandUses: ReadonlyMap<string, ReadonlySet<string>>
  /** Systems that ran in this session. */
  readonly ranSystems: ReadonlySet<string>
  /** Where systems that consume a service ran in this session, by service. */
  readonly consumedPlacements: ReadonlyArray<readonly [string, ReadonlyArray<string>]>
  /** Commands skipped because they would have broken a `Schema.requires` requirement. */
  readonly requirementViolations: ReadonlyArray<Debug.RequirementViolation>
  readonly nextStateReplacements: ReadonlyArray<Debug.NextStateReplacement>
  readonly staleTargets: ReadonlyArray<Debug.StaleTarget>
  readonly streamLosses: ReadonlyArray<Debug.StreamLoss>
  readonly hasResource: (descriptor: Descriptor.Any) => boolean
  readonly schedules: ReadonlyArray<readonly [string, AnySchedule]>
}

export const describe = (input: DescribeInput): Debug.Description => {
  const componentDescriptors = Object.values(input.schema.components) as ReadonlyArray<Descriptor.Any>
  const resourceDescriptors = Object.values(input.schema.resources) as ReadonlyArray<Descriptor.Any>
  const eventDescriptors = Object.values(input.schema.events) as ReadonlyArray<Descriptor.Any>
  const relations = Object.values(input.schema.relations) as ReadonlyArray<Relation.Relation.Any>

  const schedules = collectSchedules(input.schedules)
  // A system gated by Schedule.when / pauseWhen is a copy pointing at its
  // base: both are one system, described once with every placement.
  const baseOf = (system: AnySystem): AnySystem => (system as { readonly base?: AnySystem }).base ?? system
  const placements = new Map<AnySystem, Array<string>>()
  const steps = new Set<AnySystem>()
  for (const [name, schedule] of schedules) {
    schedule.steps.forEach((step, index) => {
      if (!Schedule.isSystemStep(step)) return
      const system = baseOf(step as AnySystem)
      steps.add(step as AnySystem)
      const list = placements.get(system)
      const placement = `${name}#${index}`
      if (list) list.push(placement)
      else placements.set(system, [placement])
    })
  }
  // Gates differ per placement: the description lists the conditions of all of them.
  const gatesOf = new Map<AnySystem, { when: Set<unknown>; pauseWhen: Set<unknown> }>()
  for (const step of steps) {
    const base = baseOf(step)
    const gates = gatesOf.get(base) ?? { when: new Set(), pauseWhen: new Set() }
    for (const condition of step.spec.when as ReadonlyArray<unknown>) gates.when.add(condition)
    for (const condition of step.spec.pauseWhen as ReadonlyArray<unknown>) gates.pauseWhen.add(condition)
    gatesOf.set(base, gates)
  }
  const byBase = new Map([...placements].map(([system, where]) => {
    const gates = gatesOf.get(system)!
    const merged = { ...system, spec: { ...system.spec, when: [...gates.when], pauseWhen: [...gates.pauseWhen] } } as AnySystem
    return [system, describeSystem(merged, where)] as const
  }))
  const described = new Map<AnySystem, Debug.SystemDescription>([...steps].map((step) => [step, byBase.get(baseOf(step))!] as const))
  const systems = [...byBase.values()]

  const components = new Index(componentDescriptors.map((descriptor) => descriptor.name))
  const resources = new Index(resourceDescriptors.map((descriptor) => descriptor.name))
  const events = new Index(eventDescriptors.map((descriptor) => descriptor.name))
  const nextStates = new Map<string, Array<string>>()
  for (const name of input.externallyWrittenEvents) events.write(name, "runtime.send")
  for (const system of systems) {
    for (const query of system.queries) {
      for (const name of [...query.reads, ...query.optional, ...query.with, ...query.added, ...query.changed, ...anyOfNames(query)]) {
        components.read(name, system.name)
      }
      for (const name of query.writes) {
        components.read(name, system.name)
        components.write(name, system.name)
      }
    }
    for (const name of system.removed) components.read(name, system.name)
    for (const name of [...system.commands.spawns, ...system.commands.inserts, ...system.commands.removes]) components.write(name, system.name)
    for (const name of system.resources.reads) resources.read(name, system.name)
    for (const name of system.resources.writes) resources.write(name, system.name)
    for (const name of system.events.reads) events.read(name, system.name)
    for (const name of system.events.writes) events.write(name, system.name)
    for (const name of system.machines.next) {
      const queuers = nextStates.get(name)
      if (queuers) queuers.push(`${system.name} @ ${system.placements.join(", ")}`)
      else nextStates.set(name, [`${system.name} @ ${system.placements.join(", ")}`])
    }
  }

  const appliesTransitions = schedules.some(([, schedule]) =>
    schedule.steps.some((step) => !Schedule.isSystemStep(step) && step.kind === "applyStateTransitions"))

  const lints: Array<Omit<Debug.Lint, "fix">> = []
  const triggerName = (trigger: EntityScope.Trigger) =>
    `${trigger.phase === "exit" ? "onExit" : "onEnter"}(${trigger.machine.name}=${String(trigger.state)})`
  for (const scope of input.scopes) {
    for (const trigger of scope.despawnOn) {
      const machine = input.machines.find((candidate) => candidate.key === trigger.machine.key)
      if (machine !== undefined && input.providesMachine(machine)) continue
      lints.push({
        severity: "warning",
        code: "scope-trigger-never-applied",
        subject: scope.name,
        message: `${scope.name} is despawned on ${triggerName(trigger)}, but the runtime does not provide ${trigger.machine.name}, so its state never changes and the scope is never despawned`
      })
    }
  }
  if (schedules.length > 0) {
    for (const entry of events.list()) {
      if (entry.writers.length > 0 && entry.readers.length === 0) {
        lints.push({
          severity: "warning",
          code: "event-never-read",
          subject: entry.name,
          message: `${entry.name} is emitted by ${entry.writers.join(", ")} but no described system reads it`
        })
      }
      if (entry.readers.length > 0 && entry.writers.length === 0) {
        lints.push({
          severity: "warning",
          code: "event-never-written",
          subject: entry.name,
          message: `${entry.name} is read by ${entry.readers.join(", ")} but no described system emits it`
        })
      }
    }
    if (!appliesTransitions) {
      for (const [name, queuers] of nextStates) {
        lints.push({
          severity: "warning",
          code: "next-state-never-applied",
          subject: name,
          message: `next states of ${name} are queued by ${queuers.join("; ")}, but no described schedule has an applyStateTransitions() marker, so they never take effect`
        })
      }
    }
    for (const scope of input.scopes) {
      for (const trigger of scope.despawnOn) {
        const machine = input.machines.find((candidate) => candidate.key === trigger.machine.key)
        if (machine === undefined || !input.providesMachine(machine)) continue
        const reason = !appliesTransitions
          ? "no described schedule has an applyStateTransitions() marker"
          : !queuedWithParents(machine, nextStates)
            ? `no described system queues a next state of ${machine.name}`
            : undefined
        if (reason === undefined) continue
        lints.push({
          severity: "warning",
          code: "scope-trigger-never-applied",
          subject: scope.name,
          message: `${scope.name} is despawned on ${triggerName(trigger)}, but ${reason}, so the scope is never despawned`
        })
      }
    }
    const failureReaders = new Set(systems.flatMap((system) => system.relationFailures))
    // Declared `relates` permissions, and relations that commands were seen to relate (erased types can relate without one).
    const relaters = new Map<string, Set<string>>()
    for (const system of systems) {
      for (const name of system.commands.relates) relaters.set(name, new Set([...(relaters.get(name) ?? []), system.name]))
    }
    for (const [name, queuers] of input.relationMutations) relaters.set(name, new Set([...(relaters.get(name) ?? []), ...queuers]))
    for (const [name, queuers] of relaters) {
      if (failureReaders.has(name)) continue
      lints.push({
        severity: "warning",
        code: "relation-failure-never-read",
        subject: name,
        message: `${name} is related by commands from ${[...queuers].sort().join(", ")}, but no described system reads its failures (Game.System.readRelationFailures(${name})), so a failed relate or reorder is dropped silently`
      })
    }
    const resourceWriters = new Set(systems.flatMap((system) => system.resources.writes))
    const changedReaders = new Map<string, Array<string>>()
    for (const system of systems) {
      for (const name of system.resources.changed) changedReaders.set(name, [...(changedReaders.get(name) ?? []), system.name])
    }
    for (const [name, readers] of changedReaders) {
      if (resourceWriters.has(name)) continue
      lints.push({
        severity: "warning",
        code: "resource-changed-never-written",
        subject: name,
        message: `${name} is read with changedResource by ${readers.join(", ")}, but no described system writes it, so changed() is true only on the first run`
      })
    }
    const consumers = new Map<string, Array<string>>()
    for (const system of systems) {
      for (const name of system.consumes) {
        consumers.set(name, [...(consumers.get(name) ?? []), ...system.placements.map((placement) => `${system.name} (${placement})`)])
      }
    }
    for (const [name, where] of consumers) {
      if (where.length < 2) continue
      lints.push({
        severity: "warning",
        code: "service-consumed-twice",
        subject: name,
        message: `${name} is consumed by ${where.join(" and ")}: each run takes what arrived since the previous one, so each sees only what the others left (an input press reaches one of them)`
      })
    }
    lints.push(...readBeforeWriteLints(schedules, described, input.externallyWrittenEvents))
    // Each named schedule is checked as one tick; `tick` checks this at compile time.
    for (const [name, schedule] of input.schedules) {
      for (const issue of OrderInternal.tickOrderIssues(schedule.steps)) {
        lints.push({ severity: "warning", code: "this-tick-order", subject: issue.data, message: `in ${name}, ${issue.message}` })
      }
    }
    // Observed with debug: only systems that ran, so an unplayed session reports nothing.
    for (const system of systems) {
      if (!input.ranSystems.has(system.name)) continue
      const uses = input.commandUses.get(system.name) ?? new Set<string>()
      for (const kind of Object.keys(permissionVerb) as Array<keyof Debug.CommandPermissions>) {
        const unused = system.commands[kind].filter((name) => !uses.has(`${kind}:${name}`))
        if (unused.length === 0) continue
        lints.push({
          severity: "info",
          code: "command-permission-unused",
          subject: system.name,
          message: `${system.name} may ${permissionVerb[kind]} ${unused.join(", ")} but never did in this session`
        })
      }
    }
    for (const entry of components.list()) {
      if (entry.writers.length > 0 && entry.readers.every((reader) => entry.writers.includes(reader))) {
        lints.push({
          severity: "info",
          code: "component-never-read",
          subject: entry.name,
          message: `${entry.name} is written by ${entry.writers.join(", ")} but read by no other described system`
        })
      }
    }
  }
  // Observed with debug, whether or not schedules are named: a consumer in
  // an unnamed schedule (or one the named set leaves out) is seen once it runs.
  const consumedStatically = new Set(lints.filter((lint) => lint.code === "service-consumed-twice").map((lint) => lint.subject))
  for (const [name, where] of input.consumedPlacements) {
    if (where.length < 2 || consumedStatically.has(name)) continue
    lints.push({
      severity: "warning",
      code: "service-consumed-twice",
      subject: name,
      message: `${name} was consumed by ${where.join(" and ")} in this session: each run takes what arrived since the previous one, so each sees only what the others left (an input press reaches one of them)`
    })
  }
  // Observed with debug, whether or not schedules are named.
  for (const violation of input.requirementViolations) {
    const times = violation.count === 1 ? "once" : `${violation.count} times`
    lints.push({
      severity: "warning",
      code: "requirement-violated",
      subject: violation.system,
      message: `${violation.system} queued ${violation.command === "insert" ? "an" : "a"} ${violation.command} that would have left ${violation.component} without ${violation.missing} (last on entity ${violation.entity}), so it was skipped ${times}`
    })
  }
  for (const replacement of input.nextStateReplacements) {
    const times = replacement.count === 1 ? "" : `, ${replacement.count} times`
    lints.push({
      severity: "warning",
      code: "next-state-replaced",
      subject: replacement.machine,
      message: `${replacement.by.system} queued ${replacement.machine}=${renderState(replacement.by.value)}, replacing ${renderState(replacement.replaced.value)} queued by ${replacement.replaced.system} before the same applyStateTransitions()${times}: the last value wins`
    })
  }
  for (const stale of input.staleTargets) {
    const times = stale.count === 1 ? "once" : `${stale.count} times`
    lints.push({
      severity: "warning",
      code: "stale-target",
      subject: stale.system,
      message: `${stale.system} passed ${stale.command} an id spawned in an earlier run (last entity ${stale.entity}), so it was skipped ${times}`
    })
  }
  for (const loss of input.streamLosses) {
    if (loss.checksLagged) continue
    if (loss.lostRuns > 0) {
      lints.push({
        severity: "warning",
        code: "stream-loss-unread",
        subject: loss.system,
        message: `${loss.system} read ${loss.stream} after entries were dropped before it read them (${loss.lostRuns === 1 ? "once" : `${loss.lostRuns} runs`}), and never checks lagged()`
      })
    } else if (loss.paused) {
      lints.push({
        severity: "info",
        code: "stream-loss-unread",
        subject: loss.system,
        message: `${loss.system} reads ${loss.stream} under pauseWhen and never checks lagged(): a long pause drops entries past the stream's capacity`
      })
    }
  }

  return {
    version: 1,
    components: componentDescriptors.map((descriptor) => ({
      name: descriptor.name,
      storage: storageOf(descriptor),
      immutable: DescriptorModule.isImmutable(descriptor),
      requires: [...new Set(input.schema.requires
        .filter((requirement) => requirement.component.name === descriptor.name)
        .flatMap((requirement) => requirement.required.map((required) => required.name)))]
    })),
    resources: resourceDescriptors.map((descriptor) => ({
      name: descriptor.name,
      storage: storageOf(descriptor),
      present: input.hasResource(descriptor)
    })),
    events: eventDescriptors.map((descriptor) => ({ name: descriptor.name })),
    relations: relations.map((relation) => ({
      name: relation.name,
      relatedName: relation.relatedName,
      kind: relation.relationKind,
      linkedDespawn: relation.linkedDespawn,
      ordered: relation.ordered
    })),
    machines: input.machines.map((machine) => ({
      name: machine.name,
      states: Object.keys(machine.states),
      current: input.currentMachine(machine),
      provided: input.providesMachine(machine),
      within: machine.within === undefined ? undefined : `${machine.within.machine.name}=${String(machine.within.state)}`
    })),
    scopes: input.scopes.map((scope) => ({ name: scope.name, despawnOn: scope.despawnOn.map(triggerName) })),
    services: describeServices(input.providedServices, systems),
    schedules: schedules.map(([name, schedule]) => ({ name, steps: schedule.steps.map(describeStep) })),
    systems,
    access: {
      components: components.list(),
      resources: resources.list(),
      events: events.list()
    },
    lints: [
      ...lints.map((lint) => ({ ...lint, fix: fixFor(lint.code, lint.subject) })),
      ...input.serviceLints.flatMap(([service, reported]) =>
        reported.map((lint) => ({ severity: lint.severity, code: "service-lint" as const, subject: service, message: lint.message, fix: lint.fix })))
    ]
  }
}

/**
 * Whether a described system queues a next state of `machine`, or of a
 * machine it exists within: a parent leaving its state changes a sub-state too.
 */
const queuedWithParents = (machine: Machine.StateMachine.Any, nextStates: ReadonlyMap<string, unknown>): boolean => {
  for (let current: Machine.StateMachine.Any | undefined = machine; current !== undefined; current = current.within?.machine) {
    if (nextStates.has(current.name)) return true
  }
  return false
}

/** The fix each lint names, by code. */
const fixFor = (code: Debug.Lint["code"], subject: string): string => {
  switch (code) {
    case "event-never-read":
      return `read ${subject} in a system with Game.System.readEvent, or stop emitting it; if only a render schedule reads it, pass that schedule as describe-only`
    case "event-never-written":
      return `emit ${subject} from a system with Game.System.writeEvent, or stop reading it; if the host sends it with runtime.send, declare it (debug.declareHostEvents, or hostEvents in a Session or lint target)`
    case "next-state-never-applied":
      return `add Game.Schedule.applyStateTransitions(...) to a schedule that runs after the system that queues ${subject}`
    case "resource-changed-never-written":
      return `write ${subject} from a system with Game.System.writeResource, or read it with Game.System.readResource; if only a render schedule writes it, pass that schedule as describe-only`
    case "scope-trigger-never-applied":
      return `provide the machine of ${subject}'s trigger in Game.Runtime.make({ machines }), queue its next state from a system, and apply it with Game.Schedule.applyStateTransitions(...); or despawn ${subject} with commands.despawnScope(...) instead`
    case "relation-failure-never-read":
      return `read the failures with Game.System.readRelationFailures(${subject}) in a system and handle them`
    case "this-tick-order":
      return "move the writer before the reader in the schedule (the message names both), or read without Game.System.thisTick"
    case "component-never-read":
      return `fine if ${subject} is read outside the described schedules (rendering, inspectors); otherwise stop writing it`
    case "requirement-violated":
      return `keep what ${subject} spawns or inserts complete (every component its components require), and remove a required component only together with its requirers; a query proof can go stale when another system's command is applied first in the same applyDeferred()`
    case "stream-loss-unread":
      return `check lagged() in ${subject} where a missed entry matters (a node never destroyed, a count off), and rebuild from queries when it is true; fine if a missed entry is harmless`
    case "stale-target":
      return `an id spawn returns is valid only in the run that spawned it; in ${subject}, keep the entity id or a handle and resolve it again with a query (queries.x.get(id) / queries.x.getHandle(handle)) and pass match.entity`
    case "next-state-replaced":
      return "decide between the values in one system, or check whether a next state is already queued (nextMachines.x.getPending()) before setting another"
    case "command-permission-unused":
      return `fine if the session did not reach the case where ${subject} uses it; otherwise drop the permission from its Game.System.commands(...)`
    case "service-consumed-twice":
      return `consume ${subject} in one system placed once (InputCapture.system for an input source), write what it takes to a resource, and read the resource everywhere else`
    case "service-lint":
      return "follow the fix the service reports"
    case "read-before-write":
      return "fine when a one-run lag is intended (input before movement); otherwise move the reader after the writer, or read with Game.System.thisTick to make it an error"
  }
}

type Accesses = { readonly reads: ReadonlyArray<string>; readonly writes: ReadonlyArray<string> }

/** The components named by a query's `anyOf` filters. */
const anyOfNames = (query: Debug.QueryDescription): ReadonlyArray<string> =>
  query.anyOf.flatMap((filter) => [...filter.added, ...filter.changed])

/** What a system reads and writes, per kind. `with`/`without` filters test presence and are not reads. */
const accessesOf = (system: Debug.SystemDescription): Record<"component" | "resource" | "event", Accesses> => ({
  component: {
    reads: system.queries.flatMap((query) => [...query.reads, ...query.optional, ...query.added, ...query.changed, ...anyOfNames(query)]),
    writes: system.queries.flatMap((query) => query.writes)
  },
  resource: { reads: system.resources.reads, writes: system.resources.writes },
  event: system.events
})

/**
 * Systems that read a component, resource, or event earlier in a schedule
 * than the first system that writes it there: they see the value (or events)
 * from the schedule's previous run. Often intended, so `info`.
 */
const readBeforeWriteLints = (
  schedules: ReadonlyArray<readonly [string, AnySchedule]>,
  described: ReadonlyMap<AnySystem, Debug.SystemDescription>,
  externallyWrittenEvents: ReadonlySet<string>
): Array<Omit<Debug.Lint, "fix">> => {
  const lints: Array<Omit<Debug.Lint, "fix">> = []
  for (const [name, schedule] of schedules) {
    const steps = schedule.steps.flatMap((step) =>
      Schedule.isSystemStep(step) ? [{ system: described.get(step as AnySystem)!, accesses: accessesOf(described.get(step as AnySystem)!) }] : [])
    for (const kind of ["component", "resource", "event"] as const) {
      const firstWriter = new Map<string, number>()
      steps.forEach((step, index) => {
        for (const subject of step.accesses[kind].writes) if (!firstWriter.has(subject)) firstWriter.set(subject, index)
      })
      for (const [subject, writerIndex] of firstWriter) {
        if (kind === "event" && externallyWrittenEvents.has(subject)) continue
        const readers = [...new Set(steps.slice(0, writerIndex)
          .filter((step) => step.accesses[kind].reads.includes(subject) && !step.accesses[kind].writes.includes(subject))
          .map((step) => step.system.name))]
        if (readers.length === 0) continue
        const writer = steps[writerIndex]!.system.name
        const sees = kind === "event" ? `${subject} events one run late` : `the ${subject} value from the previous run`
        lints.push({
          severity: "info",
          code: "read-before-write",
          subject,
          message: `in ${name}, ${readers.join(", ")} ${readers.length === 1 ? "runs" : "run"} before ${writer} writes ${subject}, so ${readers.length === 1 ? "it sees" : "they see"} ${sees}`
        })
      }
    }
  }
  return lints
}

const describeServices = (
  provided: ReadonlyArray<string>,
  systems: ReadonlyArray<Debug.SystemDescription>
): Array<Debug.ServiceDescription> => {
  const all = new Set(provided)
  for (const system of systems) for (const name of system.services) all.add(name)
  return [...all].map((name) => ({ name, provided: provided.includes(name) }))
}
