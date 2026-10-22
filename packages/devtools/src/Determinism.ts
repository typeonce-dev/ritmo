/**
 * Runs the same headless simulation twice and reports its first differing
 * value. Supply fresh runtimes and scripted input; services and host time
 * are inputs, not world state. Transient components are included, so this
 * works even when the schema cannot be snapshotted.
 *
 * A mismatch is rerun with tracing on the differing frame to name the first
 * system or schedule marker after which the worlds differ. If that rerun
 * does not reproduce it, `after` is undefined: the original mismatch still
 * fails the check. This checks repeatability on the current JS engine, not
 * equality between platforms or every possible input sequence.
 *
 * @example
 * ```ts
 * const result = Determinism.check(({ hostClock }) => makeSimulation(hostClock), {
 *   schedule: "update", frames: 1800, hostClock: HostClock.test()
 * })
 * if (!result.ok) throw new Error(JSON.stringify(result))
 * ```
 * @module Determinism
 * @docGroup devtools
 */
import type { Debug, HostClock } from "@typeonce/ritmo"
import type { Schema } from "@typeonce/ritmo/Schema"
import type { AnyScheduleOrder, ExecutableScheduleDefinition } from "@typeonce/ritmo/Schedule"
import type { Target as SessionTarget } from "./Session.ts"

/** A fresh debug runtime, already set up, and its runnable schedules. */
export interface Target<S extends Schema.Any, Root, Names extends string> {
  readonly runtime: Pick<SessionTarget<S, Root>, "debug" | "tryTick">
  readonly schedules: Readonly<Record<Names, ExecutableScheduleDefinition<S, any, Root, any, any, AnyScheduleOrder>>>
}

/** Inputs supplied to each build, including diagnostic reruns. */
export interface Context {
  readonly hostClock: HostClock.HostClock
}

/** Selects one schedule and a finite, whole number of frames to compare. */
export interface Options<Names extends string> extends Context {
  readonly schedule: Names
  readonly frames: number
}

/** A mismatch names the first value; execution errors remain explicit failures. */
export type CheckResult =
  | { readonly ok: true; readonly frames: number }
  | {
      readonly ok: false
      /** 0 means the initial worlds already differ. */
      readonly frame: number
      readonly reason: "difference"
      readonly difference: string
      readonly first: unknown
      readonly second: unknown
      readonly after: string | undefined
    }
  | {
      readonly ok: false
      readonly frame: number
      readonly reason: "invalid-options" | "shared-runtime" | "failure" | "defect"
      readonly run: "first" | "second"
      readonly error: unknown
    }

type Captured = { readonly kind: string; readonly value?: unknown; readonly entries?: ReadonlyArray<readonly [string, Captured]> }
type Difference = { readonly path: string; readonly first: unknown; readonly second: unknown }
type Trace = { readonly after: string; readonly state: Captured }

// Copy values immediately: dump values may be mutable and shared with the
// next tick. JSON would silently discard undefined, NaN, maps, and cycles.
const capture = (value: unknown, seen = new Map<object, number>()): Captured => {
  if (typeof value !== "object" || value === null) return { kind: typeof value, value }
  const previous = seen.get(value)
  if (previous !== undefined) return { kind: "reference", value: previous }
  seen.set(value, seen.size)
  if (value instanceof Date) return { kind: "Date", value: value.getTime() }
  if (value instanceof RegExp) return { kind: "RegExp", value: `${value.source}/${value.flags}/${value.lastIndex}` }
  if (value instanceof Map) return { kind: "Map", entries: [...value].map(([key, entry], index) => [String(index), capture([key, entry], seen)]) }
  if (value instanceof Set) return { kind: "Set", entries: [...value].map((entry, index) => [String(index), capture(entry, seen)]) }
  if (value instanceof ArrayBuffer) return { kind: "ArrayBuffer", entries: [...new Uint8Array(value)].map((entry, index) => [String(index), capture(entry, seen)]) }
  if (ArrayBuffer.isView(value)) return { kind: value.constructor.name, entries: [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)].map((entry, index) => [String(index), capture(entry, seen)]) }
  if (value instanceof WeakMap || value instanceof WeakSet || value instanceof Promise) {
    throw new Error(`Determinism cannot inspect ${value.constructor.name}; keep opaque host state in a service`)
  }
  return {
    kind: Array.isArray(value) ? "Array" : Object.getPrototypeOf(value)?.constructor?.name ?? "Object",
    entries: Reflect.ownKeys(value).map((key) => [String(key), capture(Reflect.get(value, key), seen)])
  }
}

const difference = (first: Captured, second: Captured, path = "world"): Difference | undefined => {
  if (first.kind !== second.kind || !Object.is(first.value, second.value)) return { path, first: first.value ?? first.kind, second: second.value ?? second.kind }
  const a = first.entries ?? []
  const b = second.entries ?? []
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index]
    const right = b[index]
    if (left === undefined || right === undefined || left[0] !== right[0]) return { path: `${path}.keys[${index}]`, first: left?.[0], second: right?.[0] }
    const found = difference(left[1], right[1], `${path}[${JSON.stringify(left[0])}]`)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Checks a schedule with identical inputs on two independently built worlds.
 * The factory must make a fresh runtime each time (also on diagnostic
 * reruns); it must not read live keyboard, pointer, network, or wall time.
 * Values are compared structurally, with Object.is for primitives (NaN
 * equals NaN). Maps and sets include iteration order. Functions compare by
 * identity; weak collections and promises fail explicitly as uninspectable.
 */
export const check = <S extends Schema.Any, Root, const Names extends string>(
  make: (context: Context) => Target<S, Root, Names>,
  options: Options<NoInfer<Names>>
): CheckResult => {
  if (!Number.isSafeInteger(options.frames) || options.frames < 0) {
    return { ok: false, frame: 0, reason: "invalid-options", run: "first", error: "frames must be a finite whole number, 0 or more" }
  }
  const context: Context = { hostClock: options.hostClock }
  let run: "first" | "second" = "first"
  let frame = 0
  try {
    const first = make(context)
    run = "second"
    const second = make(context)
    if (first.runtime === second.runtime || first.runtime.debug === second.runtime.debug) {
      return { ok: false, frame: 0, reason: "shared-runtime", run, error: "the factory must build a fresh runtime each time" }
    }
    const a = first.schedules[options.schedule]
    const b = second.schedules[options.schedule]
    if (a === undefined || b === undefined) return { ok: false, frame: 0, reason: "invalid-options", run, error: `unknown schedule ${options.schedule}` }
    for (; frame <= options.frames; frame++) {
      if (frame > 0) {
        run = "first"
        const result = first.runtime.tryTick(a)
        if (result._tag === "Failure") return { ok: false, frame, reason: "failure", run, error: result.failure }
      }
      run = "first"
      const left = capture(first.runtime.debug.dump())
      if (frame > 0) {
        run = "second"
        const result = second.runtime.tryTick(b)
        if (result._tag === "Failure") return { ok: false, frame, reason: "failure", run, error: result.failure }
      }
      run = "second"
      const found = difference(left, capture(second.runtime.debug.dump()))
      if (found !== undefined) {
        const after = frame === 0 ? undefined : locate(make, context, options.schedule, frame)
        return { ok: false, frame, reason: "difference", difference: found.path, first: found.first, second: found.second, after }
      }
    }
    return { ok: true, frames: options.frames }
  } catch (error) {
    return { ok: false, frame, reason: "defect", run, error }
  }
}

const locate = <S extends Schema.Any, Root, Names extends string>(
  make: (context: Context) => Target<S, Root, Names>, context: Context, schedule: Names, frame: number
): string | undefined => {
  const stops: Array<() => void> = []
  try {
    const first = make(context)
    const second = make(context)
    const traces: [Array<Trace>, Array<Trace>] = [[], []]
    for (let index = 1; index <= frame; index++) {
      for (const [run, target] of [first, second].entries()) {
        if (index === frame) stops.push(target.runtime.debug.observe((event: Debug.TraceEvent) => {
          const after = event.type === "system" ? event.system : event.type === "deferred" ? "applyDeferred()" : event.type === "transition" ? "applyStateTransitions()" : undefined
          if (after !== undefined) traces[run as 0 | 1].push({ after, state: capture(target.runtime.debug.dump()) })
        }))
        if (target.runtime.tryTick(target.schedules[schedule])._tag === "Failure") return undefined
      }
    }
    for (let index = 0; index < Math.max(traces[0].length, traces[1].length); index++) {
      const a = traces[0][index]
      const b = traces[1][index]
      if (a === undefined || b === undefined || a.after !== b.after) return a?.after ?? b?.after
      if (difference(a.state, b.state) !== undefined) return a.after
    }
    return undefined
  } catch {
    // Diagnostic replay must not replace the original mismatch with a new error.
    return undefined
  } finally {
    for (const stop of stops) stop()
  }
}
