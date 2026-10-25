/**
 * The session protocol: JSON messages, each with the protocol version, the
 * seat that sent it, and the save number (epoch) it knows. Parsed once
 * here; the session trusts the shapes after that. Inputs stay in their
 * saved form until the session decodes them with the game's schema.
 */

/** Bumped when a message changes shape; peers on another version fail with `ProtocolMismatch`. */
export const version = 2

interface Base {
  readonly from: number
  readonly epoch: number
}

/** Sent until the first save arrives: the sender is here. */
export interface Hello extends Base {
  readonly k: "hello"
}

/**
 * From seat 0: every peer restores `save` at `tick`, and the match continues
 * from there under `epoch`. `returned` is, per seat, how many of its hidden
 * spells seat 0 had seen end when it saved: a seat away since a later one
 * stays away.
 */
export interface Sync extends Base {
  readonly k: "sync"
  readonly tick: number
  readonly save: unknown
  readonly returned: ReadonlyArray<number>
}

/** Asks seat 0 for a new save. */
export interface Resync extends Base {
  readonly k: "resync"
}

/**
 * The sender's own inputs for ticks `start` onwards (in their saved form),
 * the next tick it will run (for pacing), and, per seat, the last tick up to
 * which it has every input of that seat (`-1`: none).
 */
export interface Inputs extends Base {
  readonly k: "inputs"
  readonly next: number
  readonly acks: ReadonlyArray<number>
  readonly start: number
  readonly inputs: ReadonlyArray<unknown>
}

/** The sender's checksum of the world at the start of `tick`, a confirmed tick. */
export interface Sum extends Base {
  readonly k: "sum"
  readonly tick: number
  readonly sum: string
}

/** `shown`: how many of the sender's hidden spells have ended. */
export interface Ping extends Base {
  readonly k: "ping"
  readonly at: number
  readonly shown: number
}

/**
 * The sender's page went hidden, its `n`th time. Its inputs end at `last`;
 * with `away`, the others play on without it, with idle input after `last`,
 * until seat 0 answers its return with a save. Sent when it hides, and again
 * with every ping while hidden or waiting for that save.
 */
export interface Hidden extends Base {
  readonly k: "hidden"
  readonly n: number
  readonly last: number
  readonly away: boolean
}

/** The answer to `to`'s ping sent at `at` (its own clock). */
export interface Pong extends Base {
  readonly k: "pong"
  readonly to: number
  readonly at: number
}

export type Message = Hello | Sync | Resync | Inputs | Sum | Ping | Pong | Hidden

export type Parsed =
  | { readonly _tag: "Message"; readonly message: Message }
  | { readonly _tag: "Malformed" }
  | { readonly _tag: "OtherVersion"; readonly version: unknown }

const isTick = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= -1
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0

const malformed: Parsed = { _tag: "Malformed" }

/** Parses one message for a match of `seats` seats. */
export const parse = (text: string, seats: number): Parsed => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return malformed
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return malformed
  const value = raw as Record<string, unknown>
  if (value["v"] !== version) return { _tag: "OtherVersion", version: value["v"] }
  const from = value["from"]
  const epoch = value["epoch"]
  if (!Number.isSafeInteger(from) || (from as number) < 0 || (from as number) >= seats || !isTick(epoch) || (epoch as number) < 0) return malformed
  const base = { from: from as number, epoch: epoch as number }
  switch (value["k"]) {
    case "hello":
      return { _tag: "Message", message: { k: "hello", ...base } }
    case "resync":
      return { _tag: "Message", message: { k: "resync", ...base } }
    case "sync": {
      const returned = value["returned"]
      if (!isTick(value["tick"]) || (value["tick"] as number) < 0 || !("save" in value)) return malformed
      if (!Array.isArray(returned) || returned.length !== seats || !returned.every(isCount)) return malformed
      return { _tag: "Message", message: { k: "sync", ...base, tick: value["tick"] as number, save: value["save"], returned } }
    }
    case "inputs": {
      const acks = value["acks"]
      const inputs = value["inputs"]
      if (!isTick(value["next"]) || !isTick(value["start"]) || (value["start"] as number) < 0) return malformed
      if (!Array.isArray(acks) || acks.length !== seats || !acks.every(isTick) || !Array.isArray(inputs)) return malformed
      return { _tag: "Message", message: { k: "inputs", ...base, next: value["next"] as number, acks, start: value["start"] as number, inputs } }
    }
    case "sum":
      if (!isTick(value["tick"]) || typeof value["sum"] !== "string") return malformed
      return { _tag: "Message", message: { k: "sum", ...base, tick: value["tick"] as number, sum: value["sum"] } }
    case "ping":
      if (!isTime(value["at"]) || !isCount(value["shown"])) return malformed
      return { _tag: "Message", message: { k: "ping", ...base, at: value["at"] as number, shown: value["shown"] as number } }
    case "pong": {
      const to = value["to"]
      if (!isTime(value["at"]) || !Number.isSafeInteger(to) || (to as number) < 0 || (to as number) >= seats) return malformed
      return { _tag: "Message", message: { k: "pong", ...base, to: to as number, at: value["at"] as number } }
    }
    case "hidden":
      if (!isCount(value["n"]) || (value["n"] as number) < 1 || !isTick(value["last"]) || typeof value["away"] !== "boolean") return malformed
      return { _tag: "Message", message: { k: "hidden", ...base, n: value["n"] as number, last: value["last"] as number, away: value["away"] } }
    default:
      return malformed
  }
}

/** The text of a message. */
export const write = (message: Message): string => JSON.stringify({ v: version, ...message })
