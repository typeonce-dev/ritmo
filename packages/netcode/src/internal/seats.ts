/**
 * Seats and their input source. The source's current value and its owner
 * live in a module-private map, so only the session that took the seats
 * can set what the simulation reads.
 */
import type * as Descriptor from "@typeonce/ritmo/Descriptor"
import * as Result from "@typeonce/ritmo/Result"

import type { InvalidOptions, Seats, Source } from "../Netcode.ts"

/** What a codec makes of a value: decoded, or rejected (async schemas are rejected: a session decodes between ticks). */
export const decode = (codec: Descriptor.Codec<any, any>, raw: unknown): Result.Result<unknown, string> => {
  const outcome = codec["~standard"].validate(raw)
  if (outcome instanceof Promise) {
    // Avoid an unhandled rejection from the discarded promise.
    outcome.catch(() => {})
    return Result.failure("the input schema validates asynchronously; a session needs a synchronous one")
  }
  return outcome.issues === undefined ? Result.success(outcome.value) : Result.failure(outcome.issues.map((issue) => issue.message).join("; "))
}

/** The saved form of a value: through the codec's `"~encode"` when it has one. */
export const encode = (codec: Descriptor.Codec<any, any>, value: unknown): Result.Result<unknown, string> =>
  codec["~encode"] === undefined ? Result.success(value) : decode(codec["~encode"] as Descriptor.Codec<any, any>, value)

/** A canonical text of plain data (object keys sorted), for comparing inputs. */
export const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`
}

export interface SeatsState {
  readonly codec: Descriptor.Codec<any, any>
  current: ReadonlyArray<unknown>
  owner: object | undefined
}

const states = new WeakMap<object, SeatsState>()

/** The state behind seats {@link make} made, or `undefined` for anything else. */
export const stateOf = (seats: Seats<unknown>): SeatsState | undefined => states.get(seats)

export const make = (
  codec: Descriptor.Codec<any, any>,
  options: { readonly count: number; readonly idle: unknown }
): Result.Result<Seats<unknown>, InvalidOptions> => {
  if (!Number.isSafeInteger(options.count) || options.count < 2) {
    return Result.failure({ _tag: "InvalidOptions", field: "count", value: options.count, reason: "a networked game has 2 or more seats" })
  }
  const encoded = encode(codec, options.idle)
  const idle = encoded.ok ? decode(codec, encoded.value) : encoded
  if (!idle.ok) return Result.failure({ _tag: "InvalidOptions", field: "idle", value: options.idle, reason: `idle does not encode and decode with the input schema: ${idle.error}` })
  const state: SeatsState = { codec, current: Array.from({ length: options.count }, () => options.idle), owner: undefined }
  const source: Source<unknown> = { snapshot: () => state.current }
  const seats: Seats<unknown> = { count: options.count, idle: options.idle, source }
  states.set(seats, state)
  return Result.success(seats)
}
