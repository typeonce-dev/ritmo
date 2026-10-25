/**
 * A live monitor panel for a running game in the browser: how the game is
 * built and what it is doing, without reading its code.
 *
 * - **Overview**: time per schedule tick, the busiest systems, entity counts
 *   over the last seconds, state machines, and alerts (failed systems, NaN or
 *   infinite numbers written, messages discarded by skipped systems).
 * - **Systems**: every schedule as its systems in order, grouped by run
 *   conditions, with what each reads, writes, emits, and spawns. A dot shows
 *   whether a system is working, idle, or skipped. Hover a name to light up
 *   the systems that write it (orange) and read it (blue).
 * - **Entity**: pick an entity on screen (or by id) to follow its components
 *   live and the changes systems make to it.
 *
 * The monitor observes the runtime only while it is open, so a closed monitor
 * costs nothing. While open it reduces trace events to counts and shows its
 * own cost per tick. It needs a runtime made with `debug: { hostClock }`, and the page passed as `host`.
 *
 * @module Monitor
 * @docGroup devtools
 *
 * @example
 * ```ts
 * const monitor = Monitor.attach(runtime, {
 *   host: window,
 *   schedules: { fixedUpdate: step, frame },
 *   pick: (event) => entityUnderPointer(event),
 *   locate: (entity) => screenPositionOf(entity)
 * })
 * // Toggle with the backslash key or the corner button.
 * ```
 */
import type * as Debug from "@typeonce/ritmo/Debug"
import type { AnyScheduleOrder, ExecutableScheduleDefinition } from "@typeonce/ritmo/Schedule"
import type { Schema } from "@typeonce/ritmo/Schema"

import * as Format from "./Format.ts"
import { Collector, recentSchedule, recentSystem } from "./internal/monitor.ts"
import type { Sample, SystemWindow } from "./internal/monitor.ts"

/**
 * The numbers behind the panel, without DOM: pass `collector.observe` to
 * `debug.observe`, call `sample(now)` periodically, read `history`, `alerts`,
 * spawn kinds, and the selected entity's changes. Use it for a custom UI or in
 * tests.
 */
export { Collector, recentSchedule, recentSystem }
export type { Alert, CollectorOptions, EntityLine, Sample, ScheduleWindow, SpawnKind, SystemWindow } from "./internal/monitor.ts"

/** What the monitor needs from a runtime: its debug handle. */
export interface Target<S extends Schema.Any, Root> {
  readonly debug: Debug.Handle<S, Root>
}

/** What `attach` shows, where, and how the panel is opened. */
export interface Options<S extends Schema.Any, Root> {
  /**
   * The schedules the game ticks, by name. They name the schedules in the
   * panel and make up the system map. Name the schedule objects actually
   * passed to `tick`: nested schedules are flattened into them.
   */
  readonly schedules: Readonly<Record<string, ExecutableScheduleDefinition<S, any, Root, any, any, AnyScheduleOrder>>>
  /**
   * The page the panel lives in, passed explicitly (`window`): its
   * `document`, timers, animation frames, keyboard events, and
   * `performance` clock. The monitor reads no globals.
   */
  readonly host: Window
  /** Where the panel is added. Defaults to `host.document.body`. */
  readonly mount?: HTMLElement
  /** `KeyboardEvent.code` that toggles the panel. Defaults to `Backslash`. */
  readonly key?: string
  /** Opens the panel right away. */
  readonly open?: boolean
  /** The entity under a pointer event, for "Pick on screen". */
  readonly pick?: (event: PointerEvent) => number | undefined
  /** An entity's position in client (viewport) pixels, to mark the selected entity. */
  readonly locate?: (entity: number) => { readonly x: number; readonly y: number } | undefined
  /** Milliseconds between panel refreshes. Defaults to 250. */
  readonly refreshMs?: number
  /**
   * A replay recorder (`Replay.recorder`): adds a "Save replay" button that
   * saves the last seconds of play with the reason "Save replay button".
   */
  readonly replay?: { readonly save: (reason: string) => unknown }
}

/** An attached monitor panel, from `attach`. */
export interface Monitor {
  readonly open: () => void
  readonly close: () => void
  readonly toggle: () => void
  /** Selects an entity in the Entity tab (`undefined` clears it). */
  readonly select: (entity: number | undefined) => void
  /** Removes the panel and stops observing. */
  readonly detach: () => void
}

type Tab = "overview" | "systems" | "entity"

/** Samples used for "recent" numbers (about two seconds at the default refresh). */
const RECENT = 8

const escape = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const number = (value: number, digits = 2): string =>
  !Number.isFinite(value) ? String(value) : value >= 100 ? value.toFixed(0) : value.toFixed(digits)

/** The most common `prefix/` among names, stripped for display. */
const commonPrefix = (names: ReadonlyArray<string>): string => {
  const counts = new Map<string, number>()
  for (const name of names) {
    const slash = name.indexOf("/")
    if (slash > 0) counts.set(name.slice(0, slash + 1), (counts.get(name.slice(0, slash + 1)) ?? 0) + 1)
  }
  let best = ""
  let bestCount = 0
  for (const [prefix, count] of counts) {
    if (count > bestCount) {
      best = prefix
      bestCount = count
    }
  }
  return bestCount >= names.length / 2 ? best : ""
}

const sparkline = (values: ReadonlyArray<number>, width = 96, height = 18): string => {
  if (values.length < 2) return `<svg class="btm-spark" width="${width}" height="${height}"></svg>`
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const points = values.map((value, index) =>
    `${((index / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((value - min) / span) * (height - 4)).toFixed(1)}`)
  return `<svg class="btm-spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><polyline points="${points.join(" ")}"/></svg>`
}

type Status = "failed" | "active" | "idle" | "skipped" | "stopped"

const statusOf = (window: SystemWindow): Status =>
  window.failures > 0 ? "failed"
  : window.runs > 0 && window.writes + window.events + window.commands + window.spawns + window.despawns > 0 ? "active"
  : window.runs > 0 ? "idle"
  : window.skips > 0 ? "skipped"
  : "stopped"

const statusText: Record<Status, string> = {
  failed: "failed recently",
  active: "running and changing things",
  idle: "running, changing nothing right now",
  skipped: "skipped by its run condition",
  stopped: "not running (other schedule, or never scheduled now)"
}

/** Reads and writes of one system, by kind, for the map's chips and highlighting. */
interface Access {
  readonly reads: ReadonlyArray<string>
  readonly writes: ReadonlyArray<string>
  readonly resourceReads: ReadonlyArray<string>
  readonly resourceWrites: ReadonlyArray<string>
  readonly eventReads: ReadonlyArray<string>
  readonly eventWrites: ReadonlyArray<string>
  readonly machineReads: ReadonlyArray<string>
  readonly machineWrites: ReadonlyArray<string>
}

const accessOf = (system: Debug.SystemDescription): Access => {
  const unique = (values: ReadonlyArray<string>) => [...new Set(values)]
  const writes = unique(system.queries.flatMap((query) => query.writes))
  return {
    reads: unique(system.queries.flatMap((query) => [...query.reads, ...query.optional, ...query.added, ...query.changed, ...query.anyOf.flatMap((members) => [...members.added, ...members.changed])])).filter((name) => !writes.includes(name)),
    writes,
    resourceReads: system.resources.reads.filter((name) => !system.resources.writes.includes(name)),
    resourceWrites: system.resources.writes,
    eventReads: system.events.reads,
    eventWrites: system.events.writes,
    machineReads: system.machines.reads.filter((name) => !system.machines.next.includes(name)),
    machineWrites: [...system.machines.next, ...system.machines.updates]
  }
}

const STYLE = `
.btm { font: 12px/1.35 "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; color: #e6edf3; }
.btm-toggle { position: fixed; left: 12px; bottom: 12px; z-index: 2147483000; font: inherit; font-size: 11px; color: #9da7b3; background: rgba(13,17,23,.85); border: 1px solid #30363d; border-radius: 12px; padding: 3px 10px; cursor: pointer; }
.btm-toggle:hover { color: #e6edf3; border-color: #4ecdc4; }
.btm-panel { position: fixed; top: 12px; left: 12px; bottom: 44px; width: 440px; z-index: 2147483000; display: flex; flex-direction: column; background: rgba(13,17,23,.95); border: 1px solid #30363d; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,.5); }
.btm-panel[hidden] { display: none; }
.btm-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid #30363d; }
.btm-title { color: #4ecdc4; font-weight: 700; margin-right: 6px; }
.btm-tab { font: inherit; color: #9da7b3; background: none; border: 1px solid transparent; border-radius: 4px; padding: 2px 8px; cursor: pointer; }
.btm-tab.is-on { color: #e6edf3; border-color: #30363d; background: #21262d; }
.btm-close { margin-left: auto; font: inherit; color: #9da7b3; background: none; border: none; cursor: pointer; font-size: 14px; }
.btm-status { padding: 4px 10px; color: #7d8590; font-size: 11px; border-bottom: 1px solid #21262d; }
.btm-controls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 10px; border-bottom: 1px solid #21262d; }
.btm-controls[hidden] { display: none; }
.btm-controls button, .btm-controls input, .btm-controls select { font: inherit; color: inherit; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; padding: 2px 6px; }
.btm-controls button { background: #21262d; cursor: pointer; }
.btm-controls button.is-on { border-color: #4ecdc4; color: #4ecdc4; }
.btm-controls input { width: 64px; }
.btm-body { overflow: auto; padding: 6px 10px 12px; flex: 1; }
.btm h3 { margin: 10px 0 4px; font-size: 11px; font-weight: 600; color: #7d8590; text-transform: uppercase; letter-spacing: .06em; }
.btm-hint { color: #7d8590; font-size: 11px; margin: 2px 0 6px; }
.btm-row { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; padding: 1px 0; }
.btm-row.is-wide { grid-template-columns: 1fr 64px 60px 100px; }
.btm-num { text-align: right; color: #c9d1d9; font-variant-numeric: tabular-nums; }
.btm-dim { color: #7d8590; }
.btm-bar { height: 6px; background: #4ecdc4; border-radius: 3px; min-width: 1px; }
.btm-barbox { width: 100px; background: #161b22; border-radius: 3px; }
.btm-spark polyline { fill: none; stroke: #4ecdc4; stroke-width: 1.3; }
.btm-alert { padding: 3px 6px; margin: 2px 0; border-left: 2px solid #ff7b72; background: rgba(255,123,114,.08); }
.btm-alert.is-info { border-left-color: #d29922; background: rgba(210,153,34,.08); }
.btm-group { margin: 6px 0; border: 1px solid #21262d; border-radius: 6px; }
.btm-group-head { padding: 3px 8px; color: #d2a8ff; font-size: 11px; border-bottom: 1px solid #21262d; }
.btm-marker { padding: 2px 8px; color: #7d8590; font-size: 11px; border-top: 1px dashed #30363d; }
.btm-sys { padding: 4px 8px; border-top: 1px solid #161b22; cursor: pointer; transition: opacity .15s; }
.btm-sys:first-child { border-top: none; }
.btm-sys-line { display: flex; align-items: center; gap: 6px; }
.btm-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: #30363d; }
.is-active > .btm-sys-line .btm-dot { background: #3fb950; box-shadow: 0 0 6px #3fb950; }
.is-idle > .btm-sys-line .btm-dot { background: #2f6f3a; }
.is-skipped > .btm-sys-line .btm-dot { background: transparent; border: 1px dashed #7d8590; box-sizing: border-box; }
.is-failed > .btm-sys-line .btm-dot { background: #ff7b72; box-shadow: 0 0 6px #ff7b72; }
.btm-name { flex: 1; }
.btm-sys .btm-ms { color: #7d8590; font-size: 11px; }
.btm-chips { display: flex; flex-wrap: wrap; gap: 3px; margin: 3px 0 0 14px; }
.btm-chip { font-size: 10.5px; padding: 0 5px; border-radius: 3px; border: 1px solid; cursor: default; white-space: nowrap; }
.btm-chip.is-read { color: #79c0ff; border-color: rgba(121,192,255,.35); }
.btm-chip.is-write { color: #ffa657; border-color: rgba(255,166,87,.45); }
.btm-chip.is-event { color: #d2a8ff; border-color: rgba(210,168,255,.4); }
.btm-chip.is-spawn { color: #3fb950; border-color: rgba(63,185,80,.4); }
.btm-chip.is-resource { font-style: italic; }
.btm-chip.is-machine { font-weight: 700; }
.btm-chip.is-lit { background: rgba(255,255,255,.12); }
.btm-map.has-focus .btm-sys { opacity: .28; }
.btm-map.has-focus .btm-sys.is-writer, .btm-map.has-focus .btm-sys.is-reader { opacity: 1; }
.btm-sys.is-writer { box-shadow: inset 3px 0 #ffa657; }
.btm-sys.is-reader { box-shadow: inset 3px 0 #79c0ff; }
.btm-details { margin: 4px 0 2px 14px; color: #9da7b3; font-size: 11px; }
.btm-legend { display: flex; flex-wrap: wrap; gap: 4px 10px; color: #7d8590; font-size: 11px; margin-bottom: 4px; }
.btm-kv { display: grid; grid-template-columns: 150px 1fr; gap: 2px 8px; }
.btm-kv > span:nth-child(odd) { color: #79c0ff; overflow: hidden; text-overflow: ellipsis; }
.btm-kv > span:nth-child(even) { word-break: break-all; }
.btm-flash { animation: btm-flash .6s ease-out; }
@keyframes btm-flash { from { background: rgba(247,201,72,.35); } to { background: transparent; } }
.btm-line { color: #9da7b3; font-size: 11px; padding: 1px 0; }
.btm-ids { display: flex; flex-wrap: wrap; gap: 3px; }
.btm-ids button { font: inherit; font-size: 11px; color: #79c0ff; background: #161b22; border: 1px solid #30363d; border-radius: 3px; padding: 0 5px; cursor: pointer; }
.btm-marker-ring { position: fixed; z-index: 2147482999; width: 40px; height: 40px; margin: -20px 0 0 -20px; border: 2px solid #f7c948; border-radius: 50%; pointer-events: none; box-shadow: 0 0 12px rgba(247,201,72,.7); }
.btm-marker-ring[hidden] { display: none; }
.btm-picking, .btm-picking * { cursor: crosshair !important; }
`

/**
 * Adds the monitor to the page. The panel starts closed unless `open` is set;
 * toggle it with the key (`Backslash` by default) or the corner button.
 */
export const attach = <S extends Schema.Any, Root>(runtime: Target<S, Root>, options: Options<S, Root>): Monitor => {
  const debug = runtime.debug
  debug.nameSchedules(options.schedules)
  const host = options.host
  const mount = options.mount ?? host.document.body
  const key = options.key ?? "Backslash"
  const refreshMs = options.refreshMs ?? 250

  if (host.document.getElementById("btm-style") === null) {
    const style = host.document.createElement("style")
    style.id = "btm-style"
    style.textContent = STYLE
    host.document.head.append(style)
  }

  const root = host.document.createElement("div")
  root.className = "btm"
  root.innerHTML = `
    <button class="btm-toggle" type="button" title="Toggle the Ritmo monitor">◉ monitor</button>
    <section class="btm-panel" hidden>
      <div class="btm-head">
        <span class="btm-title">Ritmo</span>
        <button class="btm-tab" data-tab="overview" type="button">Overview</button>
        <button class="btm-tab" data-tab="systems" type="button">Systems</button>
        <button class="btm-tab" data-tab="entity" type="button">Entity</button>
        ${options.replay === undefined ? "" : `<button class="btm-save-replay" type="button" title="Save the last seconds of play as a replay">Save replay</button>`}
        <button class="btm-close" type="button" title="Close">×</button>
      </div>
      <div class="btm-status"></div>
      <div class="btm-controls" hidden>
        <button class="btm-pick" type="button">Pick on screen</button>
        <input class="btm-id" type="number" min="1" placeholder="id" />
        <select class="btm-browse"><option value="">browse by component…</option></select>
        <button class="btm-clear" type="button">Clear</button>
      </div>
      <div class="btm-body"></div>
    </section>
    <div class="btm-marker-ring" hidden></div>`
  mount.append(root)

  const query = <E extends Element>(selector: string): E => root.querySelector<E>(selector)!
  const toggleButton = query<HTMLButtonElement>(".btm-toggle")
  const panel = query<HTMLElement>(".btm-panel")
  const status = query<HTMLElement>(".btm-status")
  const controls = query<HTMLElement>(".btm-controls")
  const body = query<HTMLElement>(".btm-body")
  const pickButton = query<HTMLButtonElement>(".btm-pick")
  const idInput = query<HTMLInputElement>(".btm-id")
  const browse = query<HTMLSelectElement>(".btm-browse")
  const ring = query<HTMLElement>(".btm-marker-ring")
  toggleButton.textContent = `◉ monitor (${key.replace(/^Key|^Digit/, "")})`
  if (options.pick === undefined) pickButton.disabled = true

  let tab: Tab = "overview"
  let collector: Collector | undefined
  let stopObserving: (() => void) | undefined
  let timer: number | undefined
  let openedAt = 0
  let description: Debug.Description | undefined
  /** How many systems read each component, to name what systems spawn. */
  let readers = new Map<string, number>()
  let prefix = ""
  let focus: string | undefined
  const expanded = new Set<string>()
  let selected: number | undefined
  let browsed: { readonly component: string; readonly ids: ReadonlyArray<number> } | undefined
  let previousValues = new Map<string, string>()
  let picking = false
  let renderMs = 0

  const short = (name: string) => (prefix !== "" && name.startsWith(prefix) ? name.slice(prefix.length) : name)

  // ── Overview ───────────────────────────────────────────────────────────

  const renderOverview = (history: ReadonlyArray<Sample>): string => {
    const parts: Array<string> = []
    const scheduleNames = Object.keys(options.schedules)
    parts.push("<h3>Schedules</h3>", `<div class="btm-hint">Time per tick of each schedule over the last ~2s, including tracing overhead (tracing runs only while this panel is open). The line shows the last ${history.length} samples.</div>`)
    parts.push(`<div class="btm-row is-wide btm-dim"><span>schedule</span><span class="btm-num">ticks/s</span><span class="btm-num">ms/tick</span><span></span></div>`)
    for (const name of scheduleNames) {
      const recent = recentSchedule(history, name, RECENT)
      const series = history.map((sample) => {
        const window = sample.schedules.get(name)
        return window === undefined || window.ticks === 0 ? 0 : window.ms / window.ticks
      })
      parts.push(`<div class="btm-row is-wide"><span>${escape(name)}</span><span class="btm-num">${recent.seconds === 0 ? "–" : number(recent.ticks / recent.seconds, 0)}</span><span class="btm-num" title="max ${number(recent.maxMs, 3)}ms">${recent.ticks === 0 ? "–" : number(recent.ms / recent.ticks, 3)}</span>${sparkline(series)}</div>`)
    }

    const names = new Set<string>()
    for (const sample of history.slice(-RECENT)) for (const name of sample.systems.keys()) names.add(name)
    const busiest = [...names]
      .map((name) => ({ name, recent: recentSystem(history, name, RECENT) }))
      .filter((entry) => entry.recent.runs > 0)
      .sort((left, right) => right.recent.ms - left.recent.ms)
      .slice(0, 8)
    const top = busiest[0]?.recent.ms ?? 0
    parts.push("<h3>Busiest systems</h3>", `<div class="btm-hint">Share of time over the last ~2s, and average ms per run.</div>`)
    for (const { name, recent } of busiest) {
      parts.push(`<div class="btm-row"><span title="${escape(name)}">${escape(short(name))}</span><span class="btm-barbox"><div class="btm-bar" style="width:${top === 0 ? 0 : (recent.ms / top) * 100}%"></div></span><span class="btm-num">${number(recent.ms / recent.runs, 3)}</span></div>`)
    }

    const latest = history[history.length - 1]
    if (latest !== undefined) {
      parts.push(`<h3>Population</h3>`, `<div class="btm-hint">Live entities, and entities per component. A line that only goes up is a leak.</div>`)
      parts.push(`<div class="btm-row"><span><b>entities</b></span><span class="btm-num">${latest.population.entities}</span>${sparkline(history.map((sample) => sample.population.entities))}</div>`)
      const components = Object.keys(latest.population.components)
        .filter((component) => history.some((sample) => (sample.population.components[component] ?? 0) > 0))
        .sort((left, right) => (latest.population.components[right] ?? 0) - (latest.population.components[left] ?? 0))
      for (const component of components) {
        parts.push(`<div class="btm-row"><span title="${escape(component)}">${escape(short(component))}</span><span class="btm-num">${latest.population.components[component] ?? 0}</span>${sparkline(history.map((sample) => sample.population.components[component] ?? 0))}</div>`)
      }
    }

    const machines = Object.entries(debug.dump({ limit: 0 }).machines)
    if (machines.length > 0) {
      parts.push("<h3>State machines</h3>")
      for (const [name, machine] of machines) {
        const pending = machine.pending === undefined ? "" : ` <span class="btm-dim">→ ${escape(Format.state(machine.pending))} (queued)</span>`
        parts.push(`<div class="btm-row"><span>${escape(short(name))}</span><span class="btm-num">${escape(Format.state(machine.current))}${pending}</span><span></span></div>`)
      }
    }

    parts.push("<h3>Alerts</h3>")
    const alerts = [...(collector?.alerts.values() ?? [])]
    if (alerts.length === 0) parts.push(`<div class="btm-dim">None since the monitor opened.</div>`)
    for (const alert of alerts) {
      parts.push(`<div class="btm-alert${alert.code === "discarded-messages" ? " is-info" : ""}">${escape(alert.message)} <span class="btm-dim">×${alert.count}, f${alert.firstFrame}–f${alert.lastFrame}</span></div>`)
    }
    return parts.join("")
  }

  // ── Systems map ────────────────────────────────────────────────────────

  const chip = (kind: string, subject: string, text: string, title: string) =>
    `<span class="btm-chip ${kind}${focus === subject ? " is-lit" : ""}" data-subject="${escape(subject)}" title="${escape(title)}">${escape(text)}</span>`

  const renderSystem = (system: Debug.SystemDescription, history: ReadonlyArray<Sample>, conditionReads: ReadonlyArray<string>): string => {
    const access = accessOf(system)
    const recent = recentSystem(history, system.name, 2)
    const longer = recentSystem(history, system.name, RECENT)
    const state = statusOf(recent)
    const writesFocus = focus !== undefined && [...access.writes, ...access.resourceWrites, ...access.eventWrites, ...access.machineWrites].includes(focus)
    const readsFocus = focus !== undefined && [...access.reads, ...access.resourceReads, ...access.eventReads, ...access.machineReads].includes(focus)
    // Name spawned entities by their most specific component: fewest live entities, then most readers.
    const counts = history[history.length - 1]?.population.components ?? {}
    const spawns = collector?.spawnNames(system.name, (left, right) =>
      (counts[left] ?? 0) - (counts[right] ?? 0) || (readers.get(right) ?? 0) - (readers.get(left) ?? 0)) ?? []
    const hidden = new Set(conditionReads)
    // What the system does first (writes, events, spawns), then what it reads.
    const chips = [
      ...access.writes.map((name) => chip("is-write", name, short(name), `writes component ${name}`)),
      ...access.resourceWrites.map((name) => chip("is-write is-resource", name, short(name), `writes resource ${name}`)),
      ...access.machineWrites.map((name) => chip("is-write is-machine", name, `→${short(name)}`, `queues the next state of ${name}`)),
      ...access.eventWrites.map((name) => chip("is-event", name, `${short(name)}→`, `emits event ${name}`)),
      ...(spawns.length === 0 ? [] : [chip("is-spawn", `spawn:${system.name}`, `+${spawns.map(short).join(", +")}`, "spawns entities (learned while running; details on click)")]),
      ...access.eventReads.map((name) => chip("is-event", name, `←${short(name)}`, `reads event ${name}`)),
      ...access.reads.map((name) => chip("is-read", name, short(name), `reads component ${name}`)),
      ...access.resourceReads.filter((name) => !hidden.has(name)).map((name) => chip("is-read is-resource", name, short(name), `reads resource ${name}`)),
      ...access.machineReads.filter((name) => !hidden.has(name)).map((name) => chip("is-read is-machine", name, short(name), `reads state machine ${name}`))
    ]
    const details: Array<string> = []
    if (expanded.has(system.name)) {
      const perSecond = (value: number) => number(value / Math.max(longer.seconds, 1e-6), 1)
      details.push(`<div class="btm-details">`)
      details.push(`<div>${statusText[state]}</div>`)
      details.push(`<div>${perSecond(longer.runs)} runs/s · ${longer.runs === 0 ? "–" : number(longer.ms / longer.runs, 3)} ms/run · max ${number(longer.maxMs, 3)} ms</div>`)
      if (longer.runs > 0) {
        details.push(`<div>per run: ${number(longer.writes / longer.runs, 1)} writes · ${number(longer.events / longer.runs, 1)} events · ${number(longer.commands / longer.runs, 1)} commands</div>`)
      }
      if (longer.spawns + longer.despawns > 0) details.push(`<div>${perSecond(longer.spawns)} spawns/s · ${perSecond(longer.despawns)} despawns/s</div>`)
      if (longer.skips > 0) details.push(`<div>${perSecond(longer.skips)} skips/s — ${escape(collector?.skippedBy.get(system.name) ?? "")}</div>`)
      for (const kind of collector?.spawnsOf(system.name) ?? []) {
        details.push(`<div>spawned ×${kind.count}: ${escape(kind.components.map(short).join(", "))}</div>`)
      }
      const error = collector?.lastError.get(system.name)
      if (error !== undefined) details.push(`<div style="color:#ff7b72">last error: ${escape(error)}</div>`)
      if (system.when.length > 0) details.push(`<div>runs when: ${escape(system.when.join(", "))}</div>`)
      if (system.pauseWhen.length > 0) details.push(`<div>pauses when: ${escape(system.pauseWhen.join(", "))}</div>`)
      if (system.local) details.push(`<div class="btm-dim">holds local state</div>`)
      details.push(`<div class="btm-dim">at ${escape(system.placements.join(", "))}</div>`)
      details.push(`</div>`)
    }
    const classes = ["btm-sys", `is-${state}`, writesFocus ? "is-writer" : "", readsFocus && !writesFocus ? "is-reader" : ""].filter(Boolean).join(" ")
    return `<div class="${classes}" data-system="${escape(system.name)}" title="${escape(statusText[state])}">
      <div class="btm-sys-line"><span class="btm-dot"></span><span class="btm-name">${escape(short(system.name))}</span><span class="btm-ms">${recent.runs === 0 ? "" : `${number(recent.ms / recent.runs, 3)}ms`}</span></div>
      <div class="btm-chips">${chips.join("")}</div>${details.join("")}
    </div>`
  }

  const renderSystems = (history: ReadonlyArray<Sample>): string => {
    if (description === undefined) return ""
    const byName = new Map(description.systems.map((system) => [system.name, system]))
    const parts: Array<string> = [
      `<div class="btm-legend"><span>● working</span><span style="color:#2f6f3a">● idle</span><span>◌ skipped</span><span style="color:#79c0ff">reads</span><span style="color:#ffa657">writes</span><span style="color:#d2a8ff">events</span><span style="color:#3fb950">spawns</span><span><i>italic</i> resource</span><span><b>bold</b> state</span></div>`,
      `<div class="btm-hint">Systems run top to bottom. Hover a name to see who writes it (orange edge) and who reads it (blue edge). Click a system for details.</div>`
    ]
    parts.push(`<div class="btm-map${focus === undefined ? "" : " has-focus"}">`)
    const runnable = new Set(Object.keys(options.schedules))
    const ordered = [...description.schedules].sort((left, right) => Number(runnable.has(right.name)) - Number(runnable.has(left.name)))
    for (const schedule of ordered) {
      parts.push(`<h3>${escape(schedule.name)}</h3>`)
      // Consecutive steps with the same run conditions form a group.
      const groups: Array<{ when: string; steps: Array<Debug.StepDescription> }> = []
      for (const step of schedule.steps) {
        const when = step.kind === "system" ? (byName.get(step.system)?.when.join(", ") ?? "") : undefined
        const last = groups[groups.length - 1]
        if (last !== undefined && (when === undefined || last.when === when)) last.steps.push(step)
        else groups.push({ when: when ?? "", steps: [step] })
      }
      for (const group of groups) {
        const members = group.steps.flatMap((step) => (step.kind === "system" ? [byName.get(step.system)!] : []))
        // Resources and machines every member reads come from the group's
        // conditions (a check's reads count as the gated system's reads).
        const conditionReads = !group.when.includes("check(") || members.length === 0
          ? []
          : [...members[0]!.resources.reads, ...members[0]!.machines.reads].filter((name) =>
            members.every((member) => member.resources.reads.includes(name) || member.machines.reads.includes(name)))
        const head = group.when === ""
          ? ""
          : `<div class="btm-group-head">when ${escape(group.when)}${conditionReads.length === 0 ? "" : ` <span class="btm-dim">· the condition reads ${escape(conditionReads.map(short).join(", "))}</span>`}</div>`
        const items = group.steps.map((step) => {
          if (step.kind === "system") return renderSystem(byName.get(step.system)!, history, conditionReads)
          const label = step.kind === "applyDeferred" ? "apply commands" : `apply state transitions${step.schedules.length > 0 ? ` (runs ${step.schedules.length} transition schedules)` : ""}`
          return `<div class="btm-marker">⟂ ${escape(label)}</div>`
        })
        parts.push(`<div class="btm-group">${head}${items.join("")}</div>`)
      }
    }
    parts.push("</div>")
    return parts.join("")
  }

  // ── Entity ─────────────────────────────────────────────────────────────

  const renderEntity = (): string => {
    const parts: Array<string> = []
    if (browsed !== undefined) {
      parts.push(`<h3>Entities with ${escape(short(browsed.component))} (${browsed.ids.length})</h3><div class="btm-ids">`)
      for (const id of browsed.ids.slice(0, 80)) parts.push(`<button type="button" data-entity="${id}">${Format.entity(id)}</button>`)
      parts.push(browsed.ids.length > 80 ? `<span class="btm-dim">…+${browsed.ids.length - 80}</span>` : "", "</div>")
    }
    if (selected === undefined) {
      parts.push(`<div class="btm-hint" style="margin-top:8px">${options.pick === undefined ? "Enter an entity id" : "Pick an entity on screen, enter an id,"} or browse by component.</div>`)
      return parts.join("")
    }
    const dumped = debug.dump({ entities: [selected] }).entities[0]
    parts.push(`<h3 style="text-transform:none">${Format.entity(selected)}</h3>`)
    if (dumped === undefined) {
      parts.push(`<div class="btm-dim">Not alive (despawned).</div>`)
    } else {
      const values = new Map<string, string>()
      parts.push(`<div class="btm-kv">`)
      for (const [component, value] of Object.entries(dumped.components)) {
        const text = Format.value(value, { depth: 2, items: 6 })
        values.set(component, text)
        const changed = previousValues.has(component) && previousValues.get(component) !== text
        parts.push(`<span title="${escape(component)}">${escape(short(component))}</span><span${changed ? ` class="btm-flash"` : ""}>${escape(text)}</span>`)
      }
      for (const [relation, target] of Object.entries(dumped.relations)) {
        parts.push(`<span>${escape(short(relation))}</span><span>→ ${Format.entity(target)}</span>`)
      }
      parts.push(`</div>`)
      previousValues = values
    }
    parts.push(`<h3>Recent changes</h3>`)
    const lines = [...(collector?.entityLines ?? [])].reverse()
    if (lines.length === 0) parts.push(`<div class="btm-dim">No changes since it was selected.</div>`)
    for (const line of lines) {
      parts.push(`<div class="btm-line"><span class="btm-dim">f${line.frame}</span> ${escape(short(line.system))}: ${escape(line.text)}</div>`)
    }
    return parts.join("")
  }

  // ── Refresh ────────────────────────────────────────────────────────────

  const render = () => {
    if (collector === undefined) return
    const started = host.performance.now()
    const history = collector.history
    const latest = history.slice(-RECENT)
    const overhead = latest.reduce((total, sample) => total + sample.overheadMs, 0)
    const ticks = latest.reduce((total, sample) => total + [...sample.schedules.values()].reduce((sum, window) => sum + window.ticks, 0), 0)
    status.textContent = `observing for ${Math.round((host.performance.now() - openedAt) / 1000)}s · frame ${debug.frame()} · panel ${ticks === 0 ? "–" : number(overhead / ticks, 3)} ms/tick + ${number(renderMs, 1)} ms/refresh`
    status.title = "The panel's own work. Tracing (on only while the panel is open) also slows every system run a little, and the times shown include it: compare them with each other, not with a closed-monitor run."
    body.innerHTML = tab === "overview" ? renderOverview(history) : tab === "systems" ? renderSystems(history) : renderEntity()
    renderMs = host.performance.now() - started
  }

  const refresh = () => {
    if (collector === undefined) return
    collector.sample(host.performance.now())
    render()
  }

  const placeRing = () => {
    const at = selected === undefined || options.locate === undefined || panel.hidden ? undefined : options.locate(selected)
    ring.hidden = at === undefined
    if (at !== undefined) {
      ring.style.left = `${at.x}px`
      ring.style.top = `${at.y}px`
    }
    if (!panel.hidden) host.requestAnimationFrame(placeRing)
  }

  const setTab = (next: Tab) => {
    tab = next
    for (const button of root.querySelectorAll<HTMLButtonElement>(".btm-tab")) button.classList.toggle("is-on", button.dataset["tab"] === next)
    controls.hidden = next !== "entity"
    render()
  }

  const open = () => {
    if (!panel.hidden) return
    description = debug.describe()
    readers = new Map(description.access.components.map((entry) => [entry.name, entry.readers.length]))
    prefix = commonPrefix([...description.systems.map((system) => system.name), ...description.components.map((component) => component.name)])
    browse.replaceChildren(new Option("browse by component…", ""), ...description.components.map((component) => new Option(short(component.name), component.name)))
    collector = new Collector(() => debug.population(), () => host.performance.now())
    collector.select(selected)
    stopObserving = debug.observe(collector.observe)
    openedAt = host.performance.now()
    panel.hidden = false
    timer = host.setInterval(refresh, refreshMs)
    setTab(tab)
    host.requestAnimationFrame(placeRing)
  }

  const close = () => {
    if (panel.hidden) return
    panel.hidden = true
    ring.hidden = true
    stopObserving?.()
    stopObserving = undefined
    if (timer !== undefined) host.clearInterval(timer)
    timer = undefined
    collector = undefined
    setPicking(false)
  }

  const select = (entity: number | undefined) => {
    selected = entity
    previousValues = new Map()
    collector?.select(entity)
    idInput.value = entity === undefined ? "" : String(entity)
    render()
  }

  const onPick = (event: PointerEvent) => {
    if (event.target instanceof Node && root.contains(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    const entity = options.pick?.(event)
    setPicking(false)
    if (entity !== undefined) {
      if (tab !== "entity") setTab("entity")
      select(entity)
    }
  }

  function setPicking(on: boolean) {
    if (picking === on) return
    picking = on
    pickButton.classList.toggle("is-on", on)
    pickButton.textContent = on ? "Click an entity… (Esc)" : "Pick on screen"
    host.document.documentElement.classList.toggle("btm-picking", on)
    if (on) host.addEventListener("pointerdown", onPick, { capture: true })
    else host.removeEventListener("pointerdown", onPick, { capture: true })
  }

  // ── Events ─────────────────────────────────────────────────────────────

  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (target !== null && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return
    if (event.code === key) {
      if (panel.hidden) open()
      else close()
    } else if (event.code === "Escape" && picking) {
      setPicking(false)
    }
  }
  host.addEventListener("keydown", onKey)
  toggleButton.addEventListener("click", () => (panel.hidden ? open() : close()))
  query<HTMLButtonElement>(".btm-close").addEventListener("click", close)
  const replay = options.replay
  if (replay !== undefined) {
    const button = query<HTMLButtonElement>(".btm-save-replay")
    button.addEventListener("click", () => {
      replay.save("Save replay button")
      button.textContent = "Saved"
      host.setTimeout(() => { button.textContent = "Save replay" }, 1500)
    })
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>(".btm-tab")) {
    button.addEventListener("click", () => setTab(button.dataset["tab"] as Tab))
  }
  pickButton.addEventListener("click", () => setPicking(!picking))
  idInput.addEventListener("keydown", (event) => event.stopPropagation())
  idInput.addEventListener("change", () => {
    const value = Number.parseInt(idInput.value, 10)
    select(Number.isFinite(value) && value > 0 ? value : undefined)
  })
  browse.addEventListener("change", () => {
    const component = browse.value
    browsed = component === ""
      ? undefined
      : { component, ids: debug.dump().entities.filter((entity) => component in entity.components).map((entity) => entity.id) }
    render()
  })
  query<HTMLButtonElement>(".btm-clear").addEventListener("click", () => {
    browsed = undefined
    browse.value = ""
    select(undefined)
  })
  body.addEventListener("click", (event) => {
    const target = event.target as HTMLElement
    const entity = target.closest<HTMLElement>("[data-entity]")
    if (entity !== null) {
      select(Number(entity.dataset["entity"]))
      return
    }
    const system = target.closest<HTMLElement>("[data-system]")
    if (system !== null && target.closest("[data-subject]") === null) {
      const name = system.dataset["system"]!
      if (expanded.has(name)) expanded.delete(name)
      else expanded.add(name)
      render()
    }
  })
  body.addEventListener("mouseover", (event) => {
    const subject = (event.target as HTMLElement).closest<HTMLElement>("[data-subject]")?.dataset["subject"]
    if (subject === focus || tab !== "systems") return
    focus = subject?.startsWith("spawn:") ? undefined : subject
    render()
  })
  body.addEventListener("mouseleave", () => {
    if (focus === undefined) return
    focus = undefined
    render()
  })

  setTab("overview")
  if (options.open === true) open()

  return {
    open,
    close,
    toggle: () => (panel.hidden ? open() : close()),
    select,
    detach: () => {
      close()
      host.removeEventListener("keydown", onKey)
      root.remove()
    }
  }
}
