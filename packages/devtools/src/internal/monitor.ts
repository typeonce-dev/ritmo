/**
 * The data side of the monitor: folds trace events into per-system and
 * per-schedule windows, samples the population, keeps alerts and the
 * activity of one selected entity. No DOM, so it runs (and is tested) in Node.
 *
 * Nothing here keeps trace values beyond the selected entity's recent lines:
 * every event is reduced to counts and dropped, so a long session costs no
 * memory.
 */
import type * as Debug from "@typeonce/ritmo/Debug"

import * as Format from "../Format.ts"
import { nonFinitePath } from "./values.ts"

/** What one system did during one sample window. */
export interface SystemWindow {
  readonly runs: number
  readonly skips: number
  readonly failures: number
  readonly ms: number
  readonly maxMs: number
  readonly writes: number
  readonly events: number
  readonly commands: number
  readonly spawns: number
  readonly despawns: number
}

/** Top-level schedule runs (ticks) during one sample window. */
export interface ScheduleWindow {
  readonly ticks: number
  readonly ms: number
  readonly maxMs: number
}

/** One closed sample window, from `Collector.sample`. */
export interface Sample {
  /** The `now` passed to `sample` when the window closed. */
  readonly at: number
  readonly seconds: number
  readonly systems: ReadonlyMap<string, SystemWindow>
  readonly schedules: ReadonlyMap<string, ScheduleWindow>
  readonly population: Debug.Population
  /** Time spent folding trace events during the window. */
  readonly overheadMs: number
}

/** A problem the panel flags, counted by kind and subject (a subset of the session `Warning` codes). */
export interface Alert {
  readonly code: "system-failed" | "non-finite-value" | "discarded-messages" | "ignored-failure"
  readonly message: string
  readonly count: number
  readonly firstFrame: number
  readonly lastFrame: number
}

/** One change to the selected entity. */
export interface EntityLine {
  readonly frame: number
  readonly system: string
  readonly text: string
}

/** Entities one system spawned, grouped by their component set. */
export interface SpawnKind {
  readonly components: ReadonlyArray<string>
  readonly count: number
}

type MutableWindow = { -readonly [K in keyof SystemWindow]: SystemWindow[K] }
type MutableSchedule = { -readonly [K in keyof ScheduleWindow]: ScheduleWindow[K] }
type MutableAlert = { -readonly [K in keyof Alert]: Alert[K] }

const emptyWindow = (): MutableWindow => ({
  runs: 0, skips: 0, failures: 0, ms: 0, maxMs: 0, writes: 0, events: 0, commands: 0, spawns: 0, despawns: 0
})

export interface CollectorOptions {
  /** Samples kept for sparklines. */
  readonly history?: number
  /** Lines kept for the selected entity. */
  readonly entityLines?: number
}

export class Collector {
  readonly history: Array<Sample> = []
  readonly alerts = new Map<string, MutableAlert>()
  /** The condition that last skipped each system. */
  readonly skippedBy = new Map<string, string>()
  /** The last error of each system that failed. */
  readonly lastError = new Map<string, string>()
  /** Frame of each system's latest run that wrote something. */
  readonly lastWrite = new Map<string, number>()
  private readonly spawnKinds = new Map<string, Map<string, SpawnKind>>()
  private systems = new Map<string, MutableWindow>()
  private schedules = new Map<string, MutableSchedule>()
  private overhead = 0
  private windowStart: number
  private selected: number | undefined
  private lines: Array<EntityLine> = []
  private readonly maxHistory: number
  private readonly maxLines: number
  private readonly population: () => Debug.Population

  private readonly clock: () => number

  /** `now` reads the host clock (milliseconds); the collector times its own work with it. */
  constructor(population: () => Debug.Population, now: () => number, options: CollectorOptions = {}) {
    this.population = population
    this.clock = now
    this.windowStart = now()
    this.maxHistory = options.history ?? 60
    this.maxLines = options.entityLines ?? 40
  }

  /** Folds one trace event. Pass it to `debug.observe`. */
  readonly observe = (event: Debug.TraceEvent): void => {
    const started = this.clock()
    switch (event.type) {
      case "system":
        this.onSystem(event)
        break
      case "system.skipped": {
        this.windowOf(event.system).skips += 1
        this.skippedBy.set(event.system, event.held ? `${event.condition} (paused, holding its stream entries)` : event.condition)
        for (const discarded of event.discarded) {
          this.alert(
            "discarded-messages",
            `discarded:${event.system}:${discarded.stream}`,
            `${event.system} was skipped (${event.condition}) and discarded ${discarded.stream}`,
            event.frame
          )
        }
        break
      }
      case "deferred":
        this.onDeferred(event)
        break
      case "failure.ignored":
        this.alert("ignored-failure", `ignored:${event.frame}`, Format.ignoredFailure(event), event.frame)
        break
      case "schedule.end":
        if (!event.schedule.includes(" > ")) {
          const schedule = this.scheduleOf(event.schedule)
          schedule.ticks += 1
          schedule.ms += event.ms
          schedule.maxMs = Math.max(schedule.maxMs, event.ms)
        }
        break
    }
    this.overhead += Math.max(0, this.clock() - started)
  }

  private windowOf(system: string): MutableWindow {
    let window = this.systems.get(system)
    if (!window) {
      window = emptyWindow()
      this.systems.set(system, window)
    }
    return window
  }

  private scheduleOf(name: string): MutableSchedule {
    let schedule = this.schedules.get(name)
    if (!schedule) {
      schedule = { ticks: 0, ms: 0, maxMs: 0 }
      this.schedules.set(name, schedule)
    }
    return schedule
  }

  private alert(code: Alert["code"], key: string, message: string, frame: number) {
    const existing = this.alerts.get(key)
    if (existing) {
      existing.count += 1
      existing.lastFrame = frame
    } else {
      this.alerts.set(key, { code, message, count: 1, firstFrame: frame, lastFrame: frame })
    }
  }

  private checkFinite(system: string, subject: string, value: unknown, frame: number, entity?: number) {
    const path = nonFinitePath(value)
    if (path === undefined) return
    this.alert(
      "non-finite-value",
      `nonfinite:${system}:${subject}`,
      `${system} wrote NaN or an infinity to ${entity === undefined ? "" : `${Format.entity(entity)} `}${subject}${path}`,
      frame
    )
  }

  private line(frame: number, system: string, text: string) {
    this.lines.push({ frame, system, text })
    if (this.lines.length > this.maxLines) this.lines.shift()
  }

  private onSystem(event: Debug.SystemEvent) {
    const window = this.windowOf(event.system)
    window.runs += 1
    window.ms += event.ms
    window.maxMs = Math.max(window.maxMs, event.ms)
    if (event.outcome !== "ok") {
      window.failures += 1
      const error = Format.value(event.error)
      this.lastError.set(event.system, error)
      this.alert("system-failed", `failed:${event.system}`, `${event.system} ${event.outcome === "defect" ? "threw" : "failed"}: ${error}`, event.frame)
      return
    }
    const written = event.writes.length + event.resources.length
    window.writes += written
    window.commands += event.commands.length
    if (written > 0) this.lastWrite.set(event.system, event.frame)
    for (const write of event.writes) {
      this.checkFinite(event.system, write.component, write.after, event.frame, write.entity)
      if (write.entity === this.selected) this.line(event.frame, event.system, `${write.component} ${Format.change(write.before, write.after)}`)
    }
    for (const write of event.resources) this.checkFinite(event.system, write.resource, write.after, event.frame)
    for (const emit of event.events) {
      window.events += emit.values.length
      this.checkFinite(event.system, emit.event, emit.values, event.frame)
    }
  }

  private onDeferred(event: Debug.DeferredEvent) {
    for (const command of event.commands) {
      const window = this.windowOf(command.system)
      for (const effect of command.effects) {
        switch (effect.kind) {
          case "spawn": {
            window.spawns += 1
            const components = Object.keys(effect.components).sort()
            const kinds = this.spawnKinds.get(command.system) ?? new Map<string, SpawnKind>()
            this.spawnKinds.set(command.system, kinds)
            const key = components.join(",")
            kinds.set(key, { components, count: (kinds.get(key)?.count ?? 0) + 1 })
            for (const [component, value] of Object.entries(effect.components)) {
              this.checkFinite(command.system, component, value, event.frame, effect.entity)
            }
            if (effect.entity === this.selected) this.line(event.frame, command.system, `spawned with ${components.join(", ")}`)
            break
          }
          case "despawn":
            window.despawns += 1
            if (effect.entity === this.selected) this.line(event.frame, command.system, "despawned")
            break
          case "insert":
            this.checkFinite(command.system, effect.component, effect.value, event.frame, effect.entity)
            if (effect.entity === this.selected) this.line(event.frame, command.system, `+${effect.component} ${Format.value(effect.value)}`)
            break
          case "overwrite":
            this.checkFinite(command.system, effect.component, effect.after, event.frame, effect.entity)
            if (effect.entity === this.selected) this.line(event.frame, command.system, `${effect.component} ${Format.change(effect.before, effect.after)}`)
            break
          case "remove":
            if (effect.entity === this.selected) this.line(event.frame, command.system, `-${effect.component}`)
            break
          case "relate":
          case "unrelate":
          case "relationFailure":
            if (effect.entity === this.selected) this.line(event.frame, command.system, `${effect.kind} ${effect.relation}`)
            break
        }
      }
    }
  }

  /** Closes the current window and starts a new one. */
  sample(now: number): Sample {
    const sample: Sample = {
      at: now,
      seconds: Math.max(1e-6, (now - this.windowStart) / 1000),
      systems: this.systems,
      schedules: this.schedules,
      population: this.population(),
      overheadMs: this.overhead
    }
    this.history.push(sample)
    if (this.history.length > this.maxHistory) this.history.shift()
    this.systems = new Map()
    this.schedules = new Map()
    this.overhead = 0
    this.windowStart = now
    return sample
  }

  /** Entities a system spawned, by component set, most frequent first. */
  spawnsOf(system: string): ReadonlyArray<SpawnKind> {
    return [...(this.spawnKinds.get(system)?.values() ?? [])].sort((left, right) => right.count - left.count)
  }

  /**
   * What a system spawns, one name per kind: the component of that kind found
   * in the fewest spawn kinds seen so far (from any system); ties are broken
   * by `compare` (for example: fewest live entities, then most readers).
   */
  spawnNames(system: string, compare: (left: string, right: string) => number): ReadonlyArray<string> {
    const kindsWith = new Map<string, number>()
    const all = new Map<string, ReadonlyArray<string>>()
    for (const kinds of this.spawnKinds.values()) {
      for (const [key, kind] of kinds) all.set(key, kind.components)
    }
    for (const components of all.values()) {
      for (const component of components) kindsWith.set(component, (kindsWith.get(component) ?? 0) + 1)
    }
    const names = this.spawnsOf(system).map((kind) =>
      [...kind.components].sort((left, right) =>
        (kindsWith.get(left) ?? 0) - (kindsWith.get(right) ?? 0) || compare(left, right) || left.localeCompare(right))[0] ?? "entity")
    return [...new Set(names)]
  }

  /** Follows one entity's changes from now on (`undefined` stops). */
  select(entity: number | undefined): void {
    if (entity === this.selected) return
    this.selected = entity
    this.lines = []
  }

  get selection(): number | undefined {
    return this.selected
  }

  get entityLines(): ReadonlyArray<EntityLine> {
    return this.lines
  }

  /** Clears alerts, e.g. after the user dismissed them. */
  clearAlerts(): void {
    this.alerts.clear()
  }
}

/** Totals of a system over the last `count` samples. */
export const recentSystem = (history: ReadonlyArray<Sample>, system: string, count: number): SystemWindow & { readonly seconds: number } => {
  const total = emptyWindow()
  let seconds = 0
  for (const sample of history.slice(-count)) {
    seconds += sample.seconds
    const window = sample.systems.get(system)
    if (!window) continue
    total.runs += window.runs
    total.skips += window.skips
    total.failures += window.failures
    total.ms += window.ms
    total.maxMs = Math.max(total.maxMs, window.maxMs)
    total.writes += window.writes
    total.events += window.events
    total.commands += window.commands
    total.spawns += window.spawns
    total.despawns += window.despawns
  }
  return { ...total, seconds }
}

/** Totals of a top-level schedule over the last `count` samples. */
export const recentSchedule = (history: ReadonlyArray<Sample>, schedule: string, count: number): ScheduleWindow & { readonly seconds: number } => {
  let ticks = 0
  let ms = 0
  let maxMs = 0
  let seconds = 0
  for (const sample of history.slice(-count)) {
    seconds += sample.seconds
    const window = sample.schedules.get(schedule)
    if (!window) continue
    ticks += window.ticks
    ms += window.ms
    maxMs = Math.max(maxMs, window.maxMs)
  }
  return { ticks, ms, maxMs, seconds }
}
