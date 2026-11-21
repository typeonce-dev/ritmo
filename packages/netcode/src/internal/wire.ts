/**
 * The session protocol: JSON messages, each with the protocol version, the
 * seat that sent it, and the save number (epoch) it knows. Parsed once
 * here; the session trusts the shapes after that. Inputs stay in their
 * saved form until the session decodes them with the game's schema.
 */

/** Bumped when a message changes shape; peers on another version fail with `ProtocolMismatch`. */
export const version = 4

/**
 * Why a seat is out of the match: it sent nothing for too long, its link
 * closed, another session took its seat (a reloaded page), or the game told
 * a session to drop it.
 */
export type Why = "timeout" | "closed" | "restarted" | "dropped"

const whys: ReadonlyArray<unknown> = ["timeout", "closed", "restarted", "dropped"]

/** Most inputs one message carries: a peer far behind catches up over several frames. A message with more is malformed. */
export const maxInputsPerMessage = 64

/** Most inputs of one seat a save carries (`Sync.ahead`): no honest peer is this far past a save. */
export const maxInputsAhead = 4096

/** The length of `runtime.checksum()`: two 32-bit halves in hex. A longer one is malformed. */
export const sumLength = 16

interface Base {
  readonly from: number
  readonly epoch: number
}

/**
 * Sent while the sender is not in a match: until the first save arrives,
 * and by a seat the match went on without, until a save seats it again.
 * `session`, here and in pings, tells this session from another one of the
 * same seat (a reloaded page): the sender's `hostClock` reading when it was
 * made. A match that hears one from a seat that left gives it its seat back.
 */
export interface Hello extends Base {
  readonly k: "hello"
  readonly session: number
}

/**
 * From the host: every peer restores `save` at `tick`, and the match
 * continues from there under `epoch`. `returned` is, per seat, how many of
 * its hidden spells the host had seen end when it saved: a seat away since a
 * later one stays away. `sessions` is, per seat, the session that plays it
 * (each one's `Hello.session`): a session of the same seat with another
 * number was not in the match. `left` is, per seat, why it is out of the
 * match from this save on (`null`: it plays), and `roster` the roster this
 * makes: a save is how a seat that left is seated again. `ahead` is, per
 * seat, the inputs the host holds for the ticks after the save's idle ones,
 * when the save seats a session: the seats stopped sending those every
 * earlier session acknowledged, and a new one has none of them.
 */
export interface Sync extends Base {
  readonly k: "sync"
  readonly tick: number
  readonly save: unknown
  readonly returned: ReadonlyArray<number>
  readonly sessions: ReadonlyArray<number>
  readonly roster: number
  readonly left: ReadonlyArray<Why | null>
  readonly ahead: ReadonlyArray<ReadonlyArray<unknown>>
}

/** Asks seat 0 for a new save. */
export interface Resync extends Base {
  readonly k: "resync"
}

/**
 * The sender's own inputs for ticks `start` onwards (in their saved form),
 * the next tick it will run (for pacing), and, per seat, the last tick up to
 * which it has every input of that seat (`-1`: none). `roster` is the roster
 * the sender had when it sent this (how many times the seats in the match
 * changed): a peer that has not caught up with it waits before it takes
 * these inputs.
 */
export interface Inputs extends Base {
  readonly k: "inputs"
  readonly roster: number
  readonly next: number
  readonly acks: ReadonlyArray<number>
  readonly start: number
  readonly inputs: ReadonlyArray<unknown>
}

/** The sender's checksum of the world at the start of `tick`, a confirmed tick, under its `roster`. */
export interface Sum extends Base {
  readonly k: "sum"
  readonly roster: number
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
  /** The roster `seat` had when it hid: its inputs wait for a peer that has not caught up with it. */
  readonly roster: number
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

/**
 * The sender stopped waiting for `seat`, and why: it takes no more of its
 * inputs, so `have`, the last tick up to which it has them all, is final
 * for this epoch. The message carries those from `start` on, which another
 * peer may lack (several messages share a report when that is more than one
 * carries). Sent again with every ping until `seat` is out of the match.
 */
export interface Gone extends Base {
  readonly k: "gone"
  readonly seat: number
  readonly why: Why
  readonly have: number
  readonly start: number
  readonly inputs: ReadonlyArray<unknown>
}

/**
 * `seats` are out of the match, which makes roster `roster`: decided by
 * `by`, the lowest seat still playing, once every other playing peer
 * reported them `gone`. Per seat of `seats`: `why`, the `last` tick of its
 * own input (the furthest any of those peers had, so none ran a tick the
 * others cannot), and the `tick` from which its input is the seats' `left`
 * one (idle in between). The message carries the inputs of `seat`, one of
 * `seats`, from `start` up to its `last`; several messages share a change.
 * Every peer passes it on (`from`) to one it sees behind.
 */
export interface Left extends Base {
  readonly k: "left"
  readonly roster: number
  readonly by: number
  readonly seats: ReadonlyArray<number>
  readonly why: ReadonlyArray<Why>
  readonly last: ReadonlyArray<number>
  readonly tick: ReadonlyArray<number>
  readonly seat: number
  readonly start: number
  readonly inputs: ReadonlyArray<unknown>
}

/**
 * `seat` is out of the sender's match, why, and from when (`last` and
 * `tick` as in {@link Left}): sent to a seat that left and still plays (it
 * missed the change, or the save after it), so it asks for its seat again
 * instead of waiting for inputs nobody takes.
 */
export interface Out extends Base {
  readonly k: "out"
  readonly seat: number
  readonly why: Why
  readonly last: number
  readonly tick: number
}

export type Message = Hello | Sync | Resync | Inputs | Sum | Ping | Pong | Hidden | Gone | Left | Out

export type Parsed =
  | { readonly _tag: "Message"; readonly message: Message }
  | { readonly _tag: "Malformed" }
  | { readonly _tag: "OtherVersion"; readonly version: unknown }

const isTick = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= -1
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const isWhy = (value: unknown): value is Why => whys.includes(value)

const isSeat = (value: unknown, seats: number): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < seats

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
      const left = value["left"]
      if (!isCount(value["roster"]) || !Array.isArray(left) || left.length !== seats || !left.every((why) => why === null || isWhy(why))) return malformed
      const ahead = value["ahead"]
      if (!Array.isArray(ahead) || ahead.length !== seats || !ahead.every((inputs) => Array.isArray(inputs) && inputs.length <= maxInputsAhead)) return malformed
      return { _tag: "Message", message: { k: "sync", ...base, tick: value["tick"], save: value["save"], returned, sessions, roster: value["roster"], left, ahead } }
    }
    case "inputs": {
      const acks = value["acks"]
      const inputs = value["inputs"]
      if (!isCount(value["roster"]) || !isTick(value["next"]) || !isTick(value["start"]) || value["start"] < 0) return malformed
      if (!Array.isArray(acks) || acks.length !== seats || !acks.every(isTick) || !Array.isArray(inputs)) return malformed
      if (inputs.length > maxInputsPerMessage) return malformed
      return { _tag: "Message", message: { k: "inputs", ...base, roster: value["roster"], next: value["next"], acks, start: value["start"], inputs } }
    }
    case "sum":
      if (!isCount(value["roster"]) || !isTick(value["tick"]) || typeof value["sum"] !== "string" || value["sum"].length > sumLength) return malformed
      return { _tag: "Message", message: { k: "sum", ...base, roster: value["roster"], tick: value["tick"], sum: value["sum"] } }
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
      if (!isCount(value["roster"]) || !isCount(value["n"]) || value["n"] < 1 || !isTick(value["last"]) || typeof value["away"] !== "boolean") return malformed
      if (!isCount(value["start"]) || !Array.isArray(inputs) || inputs.length > maxInputsPerMessage) return malformed
      // The inputs it carries are its own, so they end at `last` at the latest.
      if (value["start"] + inputs.length - 1 > value["last"]) return malformed
      return {
        _tag: "Message",
        message: { k: "hidden", ...base, roster: value["roster"], seat: seat as number, n: value["n"], last: value["last"], away: value["away"], start: value["start"], inputs }
      }
    }
    case "gone": {
      const seat = value["seat"]
      const inputs = value["inputs"]
      if (!isSeat(seat, seats) || seat === from || !isWhy(value["why"]) || !isTick(value["have"])) return malformed
      if (!isCount(value["start"]) || !Array.isArray(inputs) || inputs.length > maxInputsPerMessage) return malformed
      // It reports what it has, so the inputs it carries end at `have` at the latest.
      if (value["start"] + inputs.length - 1 > value["have"]) return malformed
      return { _tag: "Message", message: { k: "gone", ...base, seat, why: value["why"], have: value["have"], start: value["start"], inputs } }
    }
    case "out":
      if (!isSeat(value["seat"], seats) || value["seat"] === from || !isWhy(value["why"]) || !isTick(value["last"]) || !isCount(value["tick"])) return malformed
      return { _tag: "Message", message: { k: "out", ...base, seat: value["seat"], why: value["why"], last: value["last"], tick: value["tick"] } }
    case "left": {
      const by = value["by"]
      const out = value["seats"]
      const why = value["why"]
      const last = value["last"]
      const tick = value["tick"]
      const seat = value["seat"]
      const inputs = value["inputs"]
      if (!isCount(value["roster"]) || value["roster"] < 1 || !isSeat(by, seats)) return malformed
      if (!Array.isArray(out) || out.length < 1 || out.length >= seats || !out.every((one) => isSeat(one, seats) && one !== by) || new Set(out).size !== out.length) return malformed
      if (!Array.isArray(why) || why.length !== out.length || !why.every(isWhy)) return malformed
      if (!Array.isArray(last) || last.length !== out.length || !last.every(isTick)) return malformed
      // Its input is the `left` one only after its last own one.
      if (!Array.isArray(tick) || tick.length !== out.length || !tick.every((first, index) => isCount(first) && first > (last[index] as number))) return malformed
      const index = out.indexOf(seat)
      if (index === -1 || !isCount(value["start"]) || !Array.isArray(inputs) || inputs.length > maxInputsPerMessage) return malformed
      if (value["start"] + inputs.length - 1 > (last[index] as number)) return malformed
      return {
        _tag: "Message",
        message: { k: "left", ...base, roster: value["roster"], by, seats: out, why, last, tick, seat: seat as number, start: value["start"], inputs }
      }
    }
    default:
      return malformed
  }
}

/** The text of a message. */
export const write = (message: Message): string => JSON.stringify({ v: version, ...message })
