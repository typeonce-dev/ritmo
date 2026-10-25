/**
 * Compact text for debug data: values, descriptions, world dumps, streams.
 *
 * The output is meant to be read in a terminal or pasted into a prompt, so it
 * favors one line per fact and short, stable prefixes (`e12` for entity 12,
 * `f40` for frame 40). An entity with a label prints as `player e12`
 * (see {@link entity}). Numbers are rounded to at most 3 decimals for display;
 * the underlying data keeps exact values.
 *
 * @module Format
 * @docGroup devtools
 */
import type * as Debug from "@typeonce/ritmo/Debug"
import type * as Machine from "@typeonce/ritmo/Machine"

/** How much of a nested value the text output prints. */
export interface ValueOptions {
  /** Nesting depth printed before `…`. Defaults to 3. */
  readonly depth?: number
  /** Array items and object keys printed before `…+N`. Defaults to 8. */
  readonly items?: number
}

/**
 * Entity id to label, read when printing entities. A session gets them from
 * its `labels` inspector (a `ReadonlyMap<number, string>` is one); pass
 * `runtime.inspect(Labels)` where a function takes labels as data, such as
 * `Desync.compare`.
 */
export interface Labels {
  // A method, so a map keyed by branded entity ids (`match.entity.id`) is labels too.
  get(entity: number): string | undefined
}

/**
 * The one way devtools prints an entity: `player e12` when `labels` names
 * it, `e12` otherwise. An empty label counts as none.
 */
export const entity = (id: number, labels?: Labels): string => {
  const label = labels?.get(id)
  return label === undefined || label === "" ? `e${id}` : `${label} e${id}`
}

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value) || Number.isInteger(value)) return String(value)
  const rounded = Math.round(value * 1000) / 1000
  return String(rounded === 0 ? 0 : rounded)
}

/**
 * Prints a value on one line: `{x:1.5,y:2}`, `[1,2,…+8]`, `Container{…}` for
 * class instances past the depth limit. Entity ids and handles are numbers
 * and print as such.
 */
export const value = (input: unknown, options: ValueOptions = {}): string => {
  const maxDepth = options.depth ?? 3
  const maxItems = options.items ?? 8
  const seen = new Set<object>()
  const go = (current: unknown, depth: number): string => {
    switch (typeof current) {
      case "number":
        return formatNumber(current)
      case "string":
        return JSON.stringify(current)
      case "boolean":
      case "bigint":
        return String(current)
      case "undefined":
        return "undefined"
      case "symbol":
        return current.toString()
      case "function":
        return "[fn]"
    }
    if (current === null) return "null"
    const object = current as object
    if (seen.has(object)) return "[cycle]"
    const prototype = Object.getPrototypeOf(object) as object | null
    const className = prototype === null || prototype === Object.prototype || Array.isArray(object)
      ? ""
      : (prototype.constructor as { readonly name?: string } | undefined)?.name ?? ""
    if (depth >= maxDepth) return Array.isArray(object) ? `[…${object.length}]` : `${className}{…}`
    seen.add(object)
    let text: string
    if (Array.isArray(object)) {
      const shown = object.slice(0, maxItems).map((item) => go(item, depth + 1))
      if (object.length > maxItems) shown.push(`…+${object.length - maxItems}`)
      text = `[${shown.join(",")}]`
    } else if (object instanceof Map) {
      const entries = [...object.entries()]
      const shown = entries.slice(0, maxItems).map(([key, item]) => `${go(key, depth + 1)}=>${go(item, depth + 1)}`)
      if (entries.length > maxItems) shown.push(`…+${entries.length - maxItems}`)
      text = `Map{${shown.join(",")}}`
    } else if (object instanceof Set) {
      const items = [...object]
      const shown = items.slice(0, maxItems).map((item) => go(item, depth + 1))
      if (items.length > maxItems) shown.push(`…+${items.length - maxItems}`)
      text = `Set{${shown.join(",")}}`
    } else {
      const keys = Object.keys(object)
      const record = object as Record<string, unknown>
      const shown = keys.slice(0, maxItems).map((key) => `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}:${go(record[key], depth + 1)}`)
      if (keys.length > maxItems) shown.push(`…+${keys.length - maxItems}`)
      text = `${className}{${shown.join(",")}}`
    }
    seen.delete(object)
    return text
  }
  return go(input, 0)
}

/**
 * One machine value: its state's name, then its fields when it has any
 * (`Talking {speaker:"Mira",page:2}`).
 */
export const state = (input: Machine.AnyValue, options: ValueOptions = {}): string => {
  const { _tag, ...fields } = input
  return Object.keys(fields).length === 0 ? _tag : `${_tag} ${value(fields, options)}`
}

const list = (items: ReadonlyArray<string>): string => items.length === 0 ? "-" : items.join(", ")

/** One transition as `Machine from -> to`; a sub-state without a value prints `(inactive)`. */
export const transition = (event: Pick<Debug.TransitionEvent, "machine" | "from" | "to">): string =>
  `${event.machine} ${event.from === undefined ? "(inactive)" : String(event.from)} -> ${event.to === undefined ? "(inactive)" : String(event.to)}`

/** One system's placements and declared access, indented under its name. */
export const system = (input: Debug.SystemDescription): string => {
  const lines: Array<string> = [`${input.name}  @ ${input.placements.join(", ")}`]
  for (const query of input.queries) {
    const parts = [
      query.reads.length > 0 ? `read ${query.reads.join(", ")}` : undefined,
      query.writes.length > 0 ? `write ${query.writes.join(", ")}` : undefined,
      query.optional.length > 0 ? `optional ${query.optional.join(", ")}` : undefined,
      query.with.length > 0 ? `with ${query.with.join(", ")}` : undefined,
      query.without.length > 0 ? `without ${query.without.join(", ")}` : undefined,
      query.added.length > 0 ? `added ${query.added.join(", ")}` : undefined,
      query.changed.length > 0 ? `changed ${query.changed.join(", ")}` : undefined,
      ...query.anyOf.map((members) => `any of (${[
        ...members.added.map((name) => `added ${name}`),
        ...members.changed.map((name) => `changed ${name}`)
      ].join(", ")})`),
      query.relations.length > 0 ? query.relations.join(", ") : undefined
    ].filter((part) => part !== undefined)
    lines.push(`  query ${query.slot}: ${parts.join("; ")}`)
  }
  const add = (label: string, items: ReadonlyArray<string>) => {
    if (items.length > 0) lines.push(`  ${label}: ${items.join(", ")}`)
  }
  add("reads resources", input.resources.reads.filter((name) => !input.resources.changed.includes(name)))
  add("reads resources when changed", input.resources.changed)
  add("writes resources", input.resources.writes)
  add("reads events", input.events.reads)
  add("emits events", input.events.writes)
  add("reads machines", input.machines.reads)
  add("updates machine fields", input.machines.updates)
  add("queues next state", input.machines.next)
  add("reads transitions", input.machines.transitions)
  add("reads transition events", input.machines.transitionEvents)
  add("reads removed", input.removed)
  if (input.despawned) lines.push("  reads despawned")
  add("reads relation failures", input.relationFailures)
  add("reads dropped relations", input.droppedRelations)
  add("services", input.services.filter((name) => !input.consumes.includes(name)))
  add("consumes (drains each run)", input.consumes)
  add("may spawn", input.commands.spawns)
  add("may insert", input.commands.inserts)
  add("may remove", input.commands.removes)
  add("may despawn", input.commands.despawns)
  add("may despawn scope", input.commands.despawnsScope)
  add("may relate", input.commands.relates)
  if (input.thisTick.length > 0) add("needs this tick", input.thisTick)
  add("when", input.when)
  add("pauses when", input.pauseWhen)
  if (input.local) lines.push("  local state")
  return lines.join("\n")
}

/** Lints first, so they are the first thing read. */
export const lintLines = (lints: ReadonlyArray<Debug.Lint>): Array<string> => [
  "# Lints",
  ...(lints.length === 0 ? ["(none)"] : lints.map((lint) => `${lint.severity} ${lint.code}: ${lint.message}`))
]

/** The static description as sections: lints, schema, schedules, systems, access. */
export const description = (input: Debug.Description): string => {
  const lines: Array<string> = []
  lines.push("# Components")
  for (const component of input.components) {
    const notes = [component.storage, ...(component.immutable ? ["immutable"] : []), ...(component.requires.length > 0 ? [`requires ${component.requires.join(", ")}`] : [])]
    lines.push(`${component.name} (${notes.join(", ")})`)
  }
  lines.push("", "# Resources")
  for (const resource of input.resources) {
    lines.push(`${resource.name} (${resource.storage}${resource.present ? "" : ", no value"})`)
  }
  if (input.events.length > 0) {
    lines.push("", "# Events")
    for (const event of input.events) lines.push(event.name)
  }
  if (input.relations.length > 0) {
    lines.push("", "# Relations")
    for (const relation of input.relations) {
      const flags = [relation.kind, relation.linkedDespawn ? "linked despawn" : undefined, relation.ordered ? "ordered" : undefined]
        .filter((flag) => flag !== undefined)
      lines.push(`${relation.name} / ${relation.relatedName} (${flags.join(", ")})`)
    }
  }
  if (input.machines.length > 0) {
    lines.push("", "# Machines")
    for (const machine of input.machines) {
      const current = !machine.provided ? "(not provided)" : machine.current === undefined ? "(inactive)" : state(machine.current)
      lines.push(`${machine.name} = ${current}  [${machine.states.join(" | ")}]${machine.within === undefined ? "" : `  within ${machine.within}`}`)
    }
  }
  if (input.scopes.length > 0) {
    lines.push("", "# Scopes")
    for (const scope of input.scopes) {
      lines.push(`${scope.name}${scope.despawnOn.length > 0 ? ` (despawned on ${scope.despawnOn.join(", ")})` : ""}`)
    }
  }
  if (input.services.length > 0) {
    lines.push("", "# Services")
    for (const service of input.services) lines.push(`${service.name}${service.provided ? "" : " (not provided)"}`)
  }
  lines.push("", "# Schedules")
  if (input.schedules.length === 0) lines.push("(none named; call runtime.debug.nameSchedules({...}))")
  for (const schedule of input.schedules) {
    lines.push(`${schedule.name}:`)
    schedule.steps.forEach((entry, index) => {
      lines.push(`  ${String(index).padStart(2)} ${step(entry)}`)
    })
  }
  if (input.systems.length > 0) {
    lines.push("", "# Systems")
    for (const entry of input.systems) lines.push(system(entry))
  }
  lines.push("", "# Access in the named schedules (readers / writers; systems outside them are not counted)")
  for (const [label, entries] of [
    ["component", input.access.components],
    ["resource", input.access.resources],
    ["event", input.access.events]
  ] as const) {
    for (const entry of entries) {
      lines.push(`${label} ${entry.name}: read by ${list(entry.readers)}; written by ${list(entry.writers)}`)
    }
  }
  return [...lintLines(input.lints), "", ...lines].join("\n")
}

/** One schedule step: the system's name, or `<applyDeferred>` / `<applyStateTransitions: ...>` for a marker. */
export const step = (input: Debug.StepDescription): string =>
  input.kind === "system" ? input.system
  : input.kind === "applyDeferred" ? "<applyDeferred>"
  : `<applyStateTransitions${input.schedules.length > 0 ? `: ${input.schedules.join(", ")}` : ""}>`

/** One entity per line (named with `labels`), then resources, machines, and pending commands. */
export const dump = (input: Debug.WorldDump, options: ValueOptions = {}, labels?: Labels): string => {
  const lines: Array<string> = [
    `frame ${input.frame} (tick ${input.tick}), ${input.entities.length} of ${input.entityCount} entities`
  ]
  for (const dumped of input.entities) {
    const components = Object.entries(dumped.components).map(([name, component]) => `${name}=${value(component, options)}`)
    const relations = Object.entries(dumped.relations).map(([name, target]) => `${name}->${entity(target, labels)}`)
    lines.push(`${entity(dumped.id, labels)}  ${[...components, ...relations].join("  ")}`)
  }
  const resources = Object.entries(input.resources)
  if (resources.length > 0) {
    lines.push("resources:")
    for (const [name, resource] of resources) lines.push(`  ${name}=${value(resource, options)}`)
  }
  const machines = Object.entries(input.machines)
  if (machines.length > 0) {
    lines.push("machines:")
    for (const [name, machine] of machines) {
      const extra = [
        machine.pending === undefined ? undefined : `pending ${state(machine.pending)}`,
        machine.previous === undefined ? undefined : `previous ${state(machine.previous)}`
      ].filter((part) => part !== undefined)
      lines.push(`  ${name}=${state(machine.current)}${extra.length > 0 ? ` (${extra.join(", ")})` : ""}`)
    }
  }
  if (input.pendingCommands.length > 0) {
    lines.push(`pending commands: ${input.pendingCommands.map((command) => `${command.tag} from ${command.system}`).join(", ")}`)
  }
  return lines.join("\n")
}

/** One line per stream, then one indented line per reader. */
export const streams = (input: ReadonlyArray<Debug.StreamStatus>): string => {
  if (input.length === 0) return "(no streams with readers or entries)"
  const lines: Array<string> = []
  for (const stream of input) {
    lines.push(`${stream.kind} ${stream.stream}: ${stream.size}/${stream.capacity} retained${stream.heldBy === undefined ? "" : `, held by ${stream.heldBy}`}`)
    for (const reader of stream.readers) {
      lines.push(`  ${reader.system}: ${reader.unread} unread${reader.lagged ? ", LAGGED (entries dropped before it read them)" : ""}`)
    }
  }
  return lines.join("\n")
}

const effect = (input: Debug.Effect, options: ValueOptions, labels: Labels | undefined): string => {
  const id = entity(input.entity, labels)
  switch (input.kind) {
    case "spawn":
      return `spawn ${id} ${Object.entries(input.components).map(([name, component]) => `${name}=${value(component, options)}`).join(" ")}`
    case "despawn":
      return `despawn ${id}`
    case "insert":
      return `insert ${id} ${input.component}=${value(input.value, options)}`
    case "overwrite":
      return `insert ${id} ${input.component} ${change(input.before, input.after, options)}`
    case "remove":
      return `remove ${id} ${input.component}`
    case "relate":
      return `relate ${id} ${input.relation}->${entity(input.target, labels)}`
    case "unrelate":
      return `unrelate ${id} ${input.relation}`
    case "relationFailure":
      return `relation failure ${id} ${input.relation}: ${input.error}`
    case "relationDropped": {
      const target = entity(input.target, labels)
      return `${input.relation} from ${id} to ${target} dropped: ${target} despawned`
    }
    case "requirementViolated":
      return `skipped ${input.command} ${id}: ${input.component} requires ${input.missing}`
    case "staleTarget":
      return `skipped ${input.command} ${id}: id spawned in an earlier run`
  }
}

/** The kinds of journal lines, for filtering. */
export type LineKind =
  | "write"
  | "resource"
  | "event"
  | "machine"
  | "nextState"
  | "command"
  | "effect"
  | "failure"
  | "missed"
  | "skip"
  | "transition"
  | "restore"
  | "ignored"

/**
 * The text for a failed tick result nobody read: who failed, with what, how
 * many later systems did not run, and when it was found unread.
 */
export const ignoredFailure = (event: Debug.FailureIgnoredEvent, options: ValueOptions = {}): string => {
  const who = event.system === undefined ? `${event.schedule} did not run` : `${event.system} failed`
  // A system failure shows what the system returned; anything else (missing requirements) as it is.
  const error = typeof event.error === "object" && event.error !== null && (event.error as { readonly kind?: unknown }).kind === "SystemFailure"
    ? (event.error as { readonly error: unknown }).error
    : event.error
  const later = `${event.skipped.length} later ${event.skipped.length === 1 ? "system" : "systems"} did not run`
  const found = event.when === "next-tick" ? "not read before the next tick" : "not read before the session ended"
  return `tick failure ignored: ${who} with ${value(error, options)}; ${later} (${found})`
}

/**
 * Structural equality for plain data: primitives by `Object.is`, arrays and
 * plain objects by their entries. Other objects compare by reference.
 */
export const sameValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length && left.every((item, index) => sameValue(item, right[index]))
  }
  const plain = (value: object) => {
    const prototype = Object.getPrototypeOf(value) as object | null
    return prototype === null || prototype === Object.prototype
  }
  if (!plain(left) || !plain(right) || Array.isArray(right)) return false
  const leftKeys = Object.keys(left)
  const rightRecord = right as Record<string, unknown>
  return leftKeys.length === Object.keys(right).length
    && leftKeys.every((key) => key in rightRecord && sameValue((left as Record<string, unknown>)[key], rightRecord[key]))
}

const isPlainContainer = (input: unknown): input is Record<string, unknown> | ReadonlyArray<unknown> => {
  if (typeof input !== "object" || input === null) return false
  if (Array.isArray(input)) return true
  const prototype = Object.getPrototypeOf(input) as object | null
  return prototype === null || prototype === Object.prototype
}

/**
 * `before -> after`. When both sides are large plain objects or arrays, only
 * the changed paths are printed: `~ up.held: false -> true, left.held: false -> true`.
 */
export const change = (before: unknown, after: unknown, options: ValueOptions = {}): string => {
  const full = `${value(before, options)} -> ${value(after, options)}`
  if (full.length <= 100 || !isPlainContainer(before) || !isPlainContainer(after)) return full
  const changes: Array<string> = []
  const walk = (left: unknown, right: unknown, path: string) => {
    if (sameValue(left, right)) return
    if (isPlainContainer(left) && isPlainContainer(right) && Array.isArray(left) === Array.isArray(right)) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)])
      for (const key of keys) {
        const segment = Array.isArray(left) ? `[${key}]` : path === "" ? key : `.${key}`
        walk((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], `${path}${segment}`)
      }
      return
    }
    changes.push(`${path === "" ? "(value)" : path}: ${value(left, options)} -> ${value(right, options)}`)
  }
  walk(before, after, "")
  const shown = changes.slice(0, 8)
  if (changes.length > shown.length) shown.push(`…+${changes.length - shown.length}`)
  return `~ ${shown.join(", ")}`
}

/** One printable fact from a trace event. */
export interface Line {
  readonly kind: LineKind
  readonly frame: number
  readonly schedule: string
  readonly system: string | undefined
  /** The entity the line is about, when there is one. */
  readonly entity: number | undefined
  /** That entity's label, when the labels given to {@link lines} name it. */
  readonly label: string | undefined
  /** The component, resource, event, machine, or stream the line is about. */
  readonly subject: string | undefined
  readonly text: string
  /**
   * The line records no change: a write of an equal value, a transition to
   * the current state, or a skip that discarded nothing.
   */
  readonly noop: boolean
}

/**
 * Splits one trace event into printable lines, naming entities with
 * `labels`. Frame and schedule boundaries produce no lines.
 */
export const lines = (event: Debug.TraceEvent, options: ValueOptions = {}, labels?: Labels): ReadonlyArray<Line> =>
  rawLines(event, options, labels).map((line) => {
    const label = line.entity === undefined ? undefined : labels?.get(line.entity)
    return { ...line, label: label === "" ? undefined : label }
  })

const rawLines = (event: Debug.TraceEvent, options: ValueOptions, labels: Labels | undefined): ReadonlyArray<Omit<Line, "label">> => {
  switch (event.type) {
    case "frame":
    case "schedule.start":
    case "schedule.end":
      return []
    case "restore":
      return [{ kind: "restore", frame: event.frame, schedule: "", system: undefined, entity: undefined, subject: undefined, noop: false, text: `restore ${event.ok ? "applied" : "rejected"}` }]
    case "failure.ignored":
      return [{ kind: "ignored", frame: event.frame, schedule: event.schedule, system: event.system, entity: undefined, subject: undefined, noop: false, text: ignoredFailure(event, options) }]
    case "transition":
      return [{
        kind: "transition",
        frame: event.frame,
        schedule: event.schedule,
        system: undefined,
        entity: undefined,
        subject: event.machine,
        noop: event.outcome === "unchanged",
        text: `transition ${transition(event)} ${event.outcome}`
      }]
    case "system.skipped": {
      const discarded = event.discarded.map((entry) => `${entry.count} ${entry.stream}`)
      return [{
        kind: "skip",
        frame: event.frame,
        schedule: event.schedule,
        system: event.system,
        entity: undefined,
        subject: undefined,
        noop: discarded.length === 0,
        text: event.held
          ? `paused: ${event.condition} is false (holding its stream entries)`
          : `skipped: ${event.condition} is false${discarded.length > 0 ? `; discarded ${discarded.join(", ")}` : ""}`
      }]
    }
    case "runtime.sent":
      return [{
        kind: "event",
        frame: event.frame,
        schedule: "",
        system: undefined,
        entity: undefined,
        subject: event.event,
        noop: false,
        text: `sent ${event.event} ${value(event.value)} (runtime.send)`
      }]
    case "deferred": {
      const result: Array<Omit<Line, "label">> = []
      for (const command of event.commands) {
        if (command.effects.length === 0) {
          result.push({ kind: "effect", frame: event.frame, schedule: event.schedule, system: command.system, entity: undefined, subject: undefined, noop: true, text: `${event.marker}: ${command.tag} had no effect` })
        }
        for (const applied of command.effects) {
          result.push({
            kind: "effect",
            frame: event.frame,
            schedule: event.schedule,
            system: command.system,
            entity: applied.entity,
            subject: "component" in applied ? applied.component : "relation" in applied ? applied.relation : undefined,
            noop: applied.kind === "overwrite" && sameValue(applied.before, applied.after),
            text: `${event.marker}: ${effect(applied, options, labels)}`
          })
        }
      }
      return result
    }
    case "system": {
      const base = { frame: event.frame, schedule: event.schedule, system: event.system }
      const result: Array<Omit<Line, "label">> = []
      const rolledBack = event.outcome === "ok" ? "" : " (rolled back)"
      if (event.outcome !== "ok") {
        result.push({ ...base, kind: "failure", entity: undefined, subject: undefined, noop: false, text: `${event.outcome}: ${value(event.error, options)}` })
      }
      for (const write of event.writes) {
        result.push({ ...base, kind: "write", entity: write.entity, subject: write.component, noop: sameValue(write.before, write.after), text: `write ${entity(write.entity, labels)} ${write.component} ${change(write.before, write.after, options)}${rolledBack}` })
      }
      for (const write of event.resources) {
        result.push({ ...base, kind: "resource", entity: undefined, subject: write.resource, noop: sameValue(write.before, write.after), text: `resource ${write.resource} ${change(write.before, write.after, options)}${rolledBack}` })
      }
      for (const emitted of event.events) {
        result.push({ ...base, kind: "event", entity: undefined, subject: emitted.event, noop: false, text: `emit ${emitted.event} ${value(emitted.values, options)}${rolledBack}` })
      }
      for (const write of event.machines) {
        result.push({ ...base, kind: "machine", entity: undefined, subject: write.machine, noop: sameValue(write.before, write.after), text: `machine ${write.machine} ${change(write.before, write.after, options)}${rolledBack}` })
      }
      for (const next of event.nextStates) {
        result.push({ ...base, kind: "nextState", entity: undefined, subject: next.machine, noop: false, text: `next state ${next.machine}=${next.value === undefined ? "(cleared)" : state(next.value, options)}${rolledBack}` })
      }
      if (event.commands.length > 0) {
        const counts = new Map<string, number>()
        for (const tag of event.commands) counts.set(tag, (counts.get(tag) ?? 0) + 1)
        const summary = [...counts].map(([tag, count]) => count === 1 ? tag : `${tag} x${count}`).join(", ")
        result.push({ ...base, kind: "command", entity: undefined, subject: undefined, noop: false, text: `queued ${summary}${event.outcome === "ok" ? "" : " (dropped)"}` })
      }
      for (const missed of event.missed) {
        result.push({ ...base, kind: "missed", entity: undefined, subject: missed.stream, noop: false, text: `missed ${missed.kind} ${missed.stream} (entries dropped before this run)` })
      }
      return result
    }
  }
}

/** `f12 update  Game/Move  write e3 ...` */
export const line = (input: Line): string =>
  `f${input.frame} ${input.schedule}  ${input.system ?? "-"}  ${input.text}${input.noop && (input.kind === "write" || input.kind === "resource" || input.kind === "effect") ? " (unchanged)" : ""}`
