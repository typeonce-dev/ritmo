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

/** A local input as every peer simulates it: the form its message carries, and that form decoded. */
export interface Sent {
  readonly wire: unknown
  readonly value: unknown
}

/**
 * Takes a local input the path a remote one takes: its saved form, through
 * the JSON of a message, decoded with the codec. The error says which step
 * failed, to follow "the local input" or "idle".
 */
export const send = (codec: Descriptor.Codec<any, any>, value: unknown): Result.Result<Sent, string> => {
  const encoded = encode(codec, value)
  if (!encoded.ok) return Result.failure(`does not encode with the input schema: ${encoded.error}`)
  // In a message's array, a value JSON cannot write arrives as null.
  const text = JSON.stringify(encoded.value)
  const wire: unknown = text === undefined ? null : JSON.parse(text)
  const decoded = decode(codec, wire)
  if (!decoded.ok) return Result.failure(`does not decode with the input schema: ${decoded.error}`)
  return Result.success({ wire, value: decoded.value })
}

/** A canonical text of plain data (object keys sorted), for comparing inputs. */
export const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`
}

export interface SeatsState {
  readonly codec: Descriptor.Codec<any, any>
  /** `idle` as every peer simulates it. */
  readonly idle: Sent
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
  const idle = send(codec, options.idle)
  if (!idle.ok) return Result.failure({ _tag: "InvalidOptions", field: "idle", value: options.idle, reason: `idle ${idle.error}` })
  const state: SeatsState = { codec, idle: idle.value, current: Array.from({ length: options.count }, () => options.idle), owner: undefined }
  const source: Source<unknown> = { snapshot: () => state.current }
  const seats: Seats<unknown> = { count: options.count, idle: options.idle, source }
  states.set(seats, state)
  return Result.success(seats)
}
