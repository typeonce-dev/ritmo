/**
 * The session protocol: JSON messages, each with the protocol version, the
 * seat that sent it, and the save number (epoch) it knows. Parsed once
 * here; the session trusts the shapes after that. Inputs stay in their
 * saved form until the session decodes them with the game's schema.
 */

/** Bumped when a message changes shape; peers on another version fail with `ProtocolMismatch`. */
export const version = 3

/** Most inputs one message carries: a peer far behind catches up over several frames. A message with more is malformed. */
export const maxInputsPerMessage = 64

/** The length of `runtime.checksum()`: two 32-bit halves in hex. A longer one is malformed. */
export const sumLength = 16

interface Base {
  readonly from: number
  readonly epoch: number
}

/**
 * Sent until the first save arrives: the sender is here. `session`, here
 * and in pings, tells this session from another one of the same seat (a
 * reloaded page): the sender's `hostClock` reading when it was made.
 */
export interface Hello extends Base {
  readonly k: "hello"
  readonly session: number
}

/**
 * From seat 0: every peer restores `save` at `tick`, and the match continues
 * from there under `epoch`. `returned` is, per seat, how many of its hidden
 * spells seat 0 had seen end when it saved: a seat away since a later one
 * stays away. `sessions` is, per seat, the session that plays it (each
 * one's `Hello.session`): a session of the same seat with another number
 * was not in the match.
 */
export interface Sync extends Base {
  readonly k: "sync"
  readonly tick: number
  readonly save: unknown
  readonly returned: ReadonlyArray<number>
  readonly sessions: ReadonlyArray<number>
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

/** `shown`: how many of the sender's hidden spells have ended. `session` as in {@link Hello}. */
export interface Ping extends Base {
  readonly k: "ping"
  readonly session: number
  readonly at: number
  readonly shown: number
}

/**
 * `seat`'s page went hidden, its `n`th time, in `epoch`. Its inputs end at
 * `last`, and the message carries those from `start` on (a page that hid
 * sends nothing again, so the announcement holds what the others still
 * need; several messages share it when that is more than one message
 * carries). With `away`, the others play on without it, with idle input
 * after `last`, until seat 0 answers its return with a save. Sent by the
 * seat when it hides, several times, and again with every ping while it
 * waits for that save; every other peer that knows of it passes it on
 * (`from` is then that peer) with its pings while the seat is hidden, so
 * one peer that heard is enough.
 */
export interface Hidden extends Base {
  readonly k: "hidden"
  readonly seat: number
  readonly n: number
  readonly last: number
  readonly away: boolean
  readonly start: number
  readonly inputs: ReadonlyArray<unknown>
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
  if (!Number.isSafeInteger(from) || (from as number) < 0 || (from as number) >= seats || !isTick(epoch) || epoch < 0) return malformed
  const base = { from: from as number, epoch }
  switch (value["k"]) {
    case "hello":
      if (!isTime(value["session"])) return malformed
      return { _tag: "Message", message: { k: "hello", ...base, session: value["session"] } }
    case "resync":
      return { _tag: "Message", message: { k: "resync", ...base } }
    case "sync": {
      const returned = value["returned"]
      const sessions = value["sessions"]
      if (!isTick(value["tick"]) || value["tick"] < 0 || !("save" in value)) return malformed
      if (!Array.isArray(returned) || returned.length !== seats || !returned.every(isCount)) return malformed
      if (!Array.isArray(sessions) || sessions.length !== seats || !sessions.every(isTime)) return malformed
      return { _tag: "Message", message: { k: "sync", ...base, tick: value["tick"], save: value["save"], returned, sessions } }
    }
    case "inputs": {
      const acks = value["acks"]
      const inputs = value["inputs"]
      if (!isTick(value["next"]) || !isTick(value["start"]) || value["start"] < 0) return malformed
      if (!Array.isArray(acks) || acks.length !== seats || !acks.every(isTick) || !Array.isArray(inputs)) return malformed
      if (inputs.length > maxInputsPerMessage) return malformed
      return { _tag: "Message", message: { k: "inputs", ...base, next: value["next"], acks, start: value["start"], inputs } }
    }
    case "sum":
      if (!isTick(value["tick"]) || typeof value["sum"] !== "string" || value["sum"].length > sumLength) return malformed
      return { _tag: "Message", message: { k: "sum", ...base, tick: value["tick"], sum: value["sum"] } }
    case "ping":
      if (!isTime(value["session"]) || !isTime(value["at"]) || !isCount(value["shown"])) return malformed
      return { _tag: "Message", message: { k: "ping", ...base, session: value["session"], at: value["at"], shown: value["shown"] } }
    case "pong": {
      const to = value["to"]
      if (!isTime(value["at"]) || !Number.isSafeInteger(to) || (to as number) < 0 || (to as number) >= seats) return malformed
      return { _tag: "Message", message: { k: "pong", ...base, to: to as number, at: value["at"] } }
    }
    case "hidden": {
      const seat = value["seat"]
      const inputs = value["inputs"]
      if (!Number.isSafeInteger(seat) || (seat as number) < 0 || (seat as number) >= seats) return malformed
      if (!isCount(value["n"]) || value["n"] < 1 || !isTick(value["last"]) || typeof value["away"] !== "boolean") return malformed
      if (!isCount(value["start"]) || !Array.isArray(inputs) || inputs.length > maxInputsPerMessage) return malformed
      // The inputs it carries are its own, so they end at `last` at the latest.
      if (value["start"] + inputs.length - 1 > value["last"]) return malformed
      return {
        _tag: "Message",
        message: { k: "hidden", ...base, seat: seat as number, n: value["n"], last: value["last"], away: value["away"], start: value["start"], inputs }
      }
    }
    default:
      return malformed
  }
}

/** The text of a message. */
export const write = (message: Message): string => JSON.stringify({ v: version, ...message })
