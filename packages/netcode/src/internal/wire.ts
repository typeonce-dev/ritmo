/**
 * The session protocol: what a session says in one frame goes out as one
 * text, a bundle: the protocol version, the seat that sent it, the save
 * number (epoch) it knows, and its messages, each of which names its own
 * epoch only when that is another one. A run of inputs is written as the
 * distinct inputs once and which of them each tick had (a held input is
 * one pair of numbers, not a value per tick), and acknowledgements as how
 * far behind the sender's next tick they are. Parsed once here; the
 * session trusts the shapes after that. Inputs stay in their saved form
 * until the session decodes them with the game's schema.
 */

/** Bumped when a message changes shape; peers on another version fail with `ProtocolMismatch`. */
export const version = 6

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
 *
 * `ran` is what the host's world went through before the save: from tick
 * `ranFrom` up to `tick`, the inputs of every seat each tick ran with, one
 * string a tick (a JSON array of their canonical forms, in seat order). A peer that ran a tick of it
 * on a guess, with the same inputs from a tick both had confirmed, ran it as
 * the save did: its events are the match's, and it confirms them.
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
  readonly ranFrom: number
  readonly ran: ReadonlyArray<string>
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

/**
 * A bundle's messages, and how many of them were malformed (dropped, the
 * rest kept), or a bundle that is malformed as a whole, or of another
 * version.
 */
export type Parsed =
  | { readonly _tag: "Bundle"; readonly messages: ReadonlyArray<Message>; readonly malformed: number }
  | { readonly _tag: "Malformed" }
  | { readonly _tag: "OtherVersion"; readonly version: unknown }


const isTick = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= -1
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const isWhy = (value: unknown): value is Why => whys.includes(value)

const isSeat = (value: unknown, seats: number): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < seats

const malformed = { _tag: "Malformed" } as const

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const isIndex = (index: unknown, length: number): index is number => Number.isSafeInteger(index) && (index as number) >= 0 && (index as number) < length

/**
 * A run of inputs as written: `d`, each distinct input once, and which of
 * them each tick had, as `i` (an index into `d` per tick) or as `r` (pairs
 * of an index and how many ticks in a row had it), whichever is shorter.
 * `undefined` when malformed or longer than `most`. Reads `i` in place: the
 * parsed array is this message's own.
 */
const readInputs = (value: Record<string, unknown>, most: number): ReadonlyArray<unknown> | undefined => {
  const distinct = value["d"]
  if (!Array.isArray(distinct)) return undefined
  let inputs: Array<unknown>
  if ("r" in value) {
    const runs = value["r"]
    if ("i" in value || !Array.isArray(runs) || runs.length % 2 !== 0) return undefined
    inputs = []
    for (let at = 0; at < runs.length; at += 2) {
      const index = runs[at]
      const length = runs[at + 1]
      if (!isIndex(index, distinct.length) || !Number.isSafeInteger(length) || length < 1 || inputs.length + length > most) return undefined
      for (let tick = 0; tick < length; tick++) inputs.push(distinct[index])
    }
  } else {
    const indices = value["i"]
    if (!Array.isArray(indices) || indices.length > most) return undefined
    for (let at = 0; at < indices.length; at++) {
      const index: unknown = indices[at]
      if (!isIndex(index, distinct.length)) return undefined
      indices[at] = distinct[index]
    }
    inputs = indices
  }
  // Every distinct input is one some tick had.
  return distinct.length > inputs.length ? undefined : inputs
}

/**
 * Whether two inputs in their saved form (plain JSON data) are the same
 * value: compared in place, since a session compares each of its inputs it
 * has not seen acknowledged in every frame's bundle.
 */
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let index = 0; index < a.length; index++) if (!same(a[index], b[index])) return false
    return true
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  let keys = 0
  for (const key in left) {
    keys += 1
    if (!(key in right) || !same(left[key], right[key])) return false
  }
  for (const _ in right) keys -= 1
  return keys === 0
}

/** Writes a run of inputs into `into` as `d` and `i` or `r` (see {@link readInputs}). */
const writeInputs = (inputs: ReadonlyArray<unknown>, into: Record<string, unknown>): void => {
  const d: Array<unknown> = []
  const indices: Array<number> = new Array<number>(inputs.length)
  let runs = 0
  for (let tick = 0; tick < inputs.length; tick++) {
    // A value JSON cannot write (a tick with no input) arrives as null, as it did in a plain array.
    const raw = inputs[tick]
    const input = raw === undefined ? null : raw
    // Few inputs are distinct: a search beats a map.
    let index = -1
    for (let at = 0; at < d.length && index === -1; at++) if (same(d[at], input)) index = at
    if (index === -1) {
      index = d.length
      d.push(input)
    }
    if (tick === 0 || indices[tick - 1] !== index) runs += 1
    indices[tick] = index
  }
  into["d"] = d
  // A held input is one run: a pair instead of an index per tick.
  if (runs * 2 >= indices.length) {
    into["i"] = indices
    return
  }
  const pairs: Array<number> = new Array<number>(runs * 2)
  let at = -2
  for (let tick = 0; tick < indices.length; tick++) {
    if (tick > 0 && indices[tick] === indices[tick - 1]) pairs[at + 1]! += 1
    else {
      at += 2
      pairs[at] = indices[tick]!
      pairs[at + 1] = 1
    }
  }
  into["r"] = pairs
}

/**
 * Acknowledgements as written: per seat, how far behind `next` the tick is
 * (a small number, where the tick itself grows all match long). Read in
 * place: the parsed array is this message's own.
 */
const readAcks = (value: unknown, next: number, seats: number): ReadonlyArray<number> | undefined => {
  if (!Array.isArray(value) || value.length !== seats) return undefined
  for (let seat = 0; seat < seats; seat++) {
    const behind: unknown = value[seat]
    if (!Number.isSafeInteger(behind)) return undefined
    const ack = next - (behind as number)
    if (!isTick(ack)) return undefined
    value[seat] = ack
  }
  return value as Array<number>
}

/** Parses one bundle for a match of `seats` seats. */
export const parse = (text: string, seats: number): Parsed => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return malformed
  }
  if (!isRecord(raw)) return malformed
  if (raw["v"] !== version) return { _tag: "OtherVersion", version: raw["v"] }
  const from = raw["from"]
  const epoch = raw["epoch"]
  const list = raw["m"]
  if (!Number.isSafeInteger(from) || (from as number) < 0 || (from as number) >= seats || !isTick(epoch) || epoch < 0 || !Array.isArray(list)) return malformed
  // Each message takes the place of its text in the parsed list, and a malformed one is dropped from it.
  let kept = 0
  for (let index = 0; index < list.length; index++) {
    const parsed = parseOne(list[index], from as number, epoch, seats)
    if (parsed !== undefined) list[kept++] = parsed
  }
  const dropped = list.length - kept
  if (dropped > 0) list.length = kept
  return { _tag: "Bundle", messages: list as Array<Message>, malformed: dropped }
}

/** One message of a bundle from `from`, whose epoch is the bundle's unless the message names its own (`undefined`: malformed). */
const parseOne = (raw: unknown, from: number, bundleEpoch: number, seats: number): Message | undefined => {
  if (!isRecord(raw)) return undefined
  const value = raw
  const epoch = "epoch" in value ? value["epoch"] : bundleEpoch
  if (!isTick(epoch) || epoch < 0) return undefined
  switch (value["k"]) {
    case "hello":
      if (!isTime(value["session"])) return undefined
      return { k: "hello", from, epoch, session: value["session"] }
    case "resync":
      return { k: "resync", from, epoch }
    case "sync": {
      const returned = value["returned"]
      const sessions = value["sessions"]
      if (!isTick(value["tick"]) || value["tick"] < 0 || !("save" in value)) return undefined
      if (!Array.isArray(returned) || returned.length !== seats || !returned.every(isCount)) return undefined
      if (!Array.isArray(sessions) || sessions.length !== seats || !sessions.every(isTime)) return undefined
      const left = value["left"]
      if (!isCount(value["roster"]) || !Array.isArray(left) || left.length !== seats || !left.every((why) => why === null || isWhy(why))) return undefined
      const ahead = value["ahead"]
      if (!Array.isArray(ahead) || ahead.length !== seats || !ahead.every((inputs) => Array.isArray(inputs) && inputs.length <= maxInputsAhead)) return undefined
      const ran = value["ran"]
      if (!isTick(value["ranFrom"]) || value["ranFrom"] < 0 || !Array.isArray(ran) || ran.length > maxInputsAhead || !ran.every((key) => typeof key === "string")) return undefined
      if (value["ranFrom"] + ran.length !== value["tick"]) return undefined
      return { k: "sync", from, epoch, tick: value["tick"], save: value["save"], returned, sessions, roster: value["roster"], left, ahead, ranFrom: value["ranFrom"], ran }
    }
    case "inputs": {
      const inputs = readInputs(value, maxInputsPerMessage)
      if (!isCount(value["roster"]) || !isTick(value["next"]) || !isTick(value["start"]) || value["start"] < 0) return undefined
      const acks = readAcks(value["acks"], value["next"], seats)
      if (acks === undefined || inputs === undefined) return undefined
      return { k: "inputs", from, epoch, roster: value["roster"], next: value["next"], acks, start: value["start"], inputs }
    }
    case "sum":
      if (!isCount(value["roster"]) || !isTick(value["tick"]) || typeof value["sum"] !== "string" || value["sum"].length > sumLength) return undefined
      return { k: "sum", from, epoch, roster: value["roster"], tick: value["tick"], sum: value["sum"] }
    case "ping":
      if (!isTime(value["session"]) || !isTime(value["at"]) || !isCount(value["shown"])) return undefined
      return { k: "ping", from, epoch, session: value["session"], at: value["at"], shown: value["shown"] }
    case "pong": {
      const to = value["to"]
      if (!isTime(value["at"]) || !Number.isSafeInteger(to) || (to as number) < 0 || (to as number) >= seats) return undefined
      return { k: "pong", from, epoch, to: to as number, at: value["at"] }
    }
    case "hidden": {
      const seat = value["seat"]
      const inputs = readInputs(value, maxInputsPerMessage)
      if (!Number.isSafeInteger(seat) || (seat as number) < 0 || (seat as number) >= seats) return undefined
      if (!isCount(value["roster"]) || !isCount(value["n"]) || value["n"] < 1 || !isTick(value["last"]) || typeof value["away"] !== "boolean") return undefined
      if (!isCount(value["start"]) || inputs === undefined) return undefined
      // The inputs it carries are its own, so they end at `last` at the latest.
      if (value["start"] + inputs.length - 1 > value["last"]) return undefined
      return { k: "hidden", from, epoch, roster: value["roster"], seat: seat as number, n: value["n"], last: value["last"], away: value["away"], start: value["start"], inputs }
    }
    case "gone": {
      const seat = value["seat"]
      const inputs = readInputs(value, maxInputsPerMessage)
      if (!isSeat(seat, seats) || seat === from || !isWhy(value["why"]) || !isTick(value["have"])) return undefined
      if (!isCount(value["start"]) || inputs === undefined) return undefined
      // It reports what it has, so the inputs it carries end at `have` at the latest.
      if (value["start"] + inputs.length - 1 > value["have"]) return undefined
      return { k: "gone", from, epoch, seat, why: value["why"], have: value["have"], start: value["start"], inputs }
    }
    case "out":
      if (!isSeat(value["seat"], seats) || value["seat"] === from || !isWhy(value["why"]) || !isTick(value["last"]) || !isCount(value["tick"])) return undefined
      return { k: "out", from, epoch, seat: value["seat"], why: value["why"], last: value["last"], tick: value["tick"] }
    case "left": {
      const by = value["by"]
      const out = value["seats"]
      const why = value["why"]
      const last = value["last"]
      const tick = value["tick"]
      const seat = value["seat"]
      const inputs = readInputs(value, maxInputsPerMessage)
      if (!isCount(value["roster"]) || value["roster"] < 1 || !isSeat(by, seats)) return undefined
      if (!Array.isArray(out) || out.length < 1 || out.length >= seats || !out.every((one) => isSeat(one, seats) && one !== by) || new Set(out).size !== out.length) return undefined
      if (!Array.isArray(why) || why.length !== out.length || !why.every(isWhy)) return undefined
      if (!Array.isArray(last) || last.length !== out.length || !last.every(isTick)) return undefined
      // Its input is the `left` one only after its last own one.
      if (!Array.isArray(tick) || tick.length !== out.length || !tick.every((first, index) => isCount(first) && first > (last[index] as number))) return undefined
      const index = out.indexOf(seat)
      if (index === -1 || !isCount(value["start"]) || inputs === undefined) return undefined
      if (value["start"] + inputs.length - 1 > (last[index] as number)) return undefined
      return { k: "left", from, epoch, roster: value["roster"], by, seats: out, why, last, tick, seat: seat as number, start: value["start"], inputs }
    }
    default:
      return undefined
  }
}

/**
 * One message as a bundle writes it: no `from` (the bundle's), no `epoch`
 * when it is the bundle's, its inputs as `d` and `i` or `r`, and an
 * `inputs`' acknowledgements as how far behind its `next` they are.
 */
const writeOne = (message: Message, epoch: number): object => {
  const own = message.epoch === epoch ? undefined : message.epoch
  if (message.k === "inputs") {
    // The message every frame says, built member by member.
    const acks: Array<number> = new Array<number>(message.acks.length)
    for (let seat = 0; seat < acks.length; seat++) acks[seat] = message.next - message.acks[seat]!
    const written: Record<string, unknown> = { k: "inputs", epoch: own, roster: message.roster, next: message.next, acks, start: message.start }
    writeInputs(message.inputs, written)
    return written
  }
  const written: Record<string, unknown> = {}
  const fields = message as unknown as Record<string, unknown>
  for (const key in fields) if (key !== "from" && key !== "epoch" && key !== "inputs") written[key] = fields[key]
  written["epoch"] = own
  if ("inputs" in message) writeInputs(message.inputs, written)
  return written
}

/** The bundle {@link write} fills: writing is synchronous, so one serves every session. */
const none: ReadonlyArray<object> = []
const scratch: { v: number; from: number; epoch: number; m: ReadonlyArray<object> } = { v: version, from: 0, epoch: 0, m: none }

/** The text of a bundle: `messages`, all sent by `from`, which knows `epoch`. */
export const write = (from: number, epoch: number, messages: ReadonlyArray<Message>): string => {
  const m: Array<object> = new Array<object>(messages.length)
  for (let index = 0; index < messages.length; index++) m[index] = writeOne(messages[index]!, epoch)
  scratch.from = from
  scratch.epoch = epoch
  scratch.m = m
  // Members left undefined (an `epoch` that is the bundle's) are not written.
  const text = JSON.stringify(scratch)
  scratch.m = none
  return text
}

/** The length of `text` in UTF-8, as a transport counts it. */
export const utf8Length = (text: string): number => {
  let bytes = 0
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code < 0xdc00 && index + 1 < text.length) {
      // A surrogate pair: one character of four bytes.
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}
