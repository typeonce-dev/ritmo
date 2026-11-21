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
export const version = 5

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

/**
 * A bundle's messages, and how many of them were malformed (dropped, the
 * rest kept), or a bundle that is malformed as a whole, or of another
 * version.
 */
export type Parsed =
  | { readonly _tag: "Bundle"; readonly messages: ReadonlyArray<Message>; readonly malformed: number }
  | { readonly _tag: "Malformed" }
  | { readonly _tag: "OtherVersion"; readonly version: unknown }

/** One message as parsed, before the bundle's `from` and `epoch` are added. */
type ParsedOne = { readonly _tag: "Message"; readonly message: Message } | { readonly _tag: "Malformed" }

const isTick = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= -1
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const isWhy = (value: unknown): value is Why => whys.includes(value)

const isSeat = (value: unknown, seats: number): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < seats

const malformed = { _tag: "Malformed" } as const

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * A run of inputs as written: `d`, each distinct input once, and which of
 * them each tick had, as `i` (an index into `d` per tick) or as `r` (pairs
 * of an index and how many ticks in a row had it), whichever is shorter.
 * `undefined` when malformed or longer than `most`.
 */
const readInputs = (value: Record<string, unknown>, most: number): ReadonlyArray<unknown> | undefined => {
  const distinct = value["d"]
  if (!Array.isArray(distinct)) return undefined
  const isIndex = (index: unknown): index is number => Number.isSafeInteger(index) && (index as number) >= 0 && (index as number) < distinct.length
  const inputs: Array<unknown> = []
  if ("r" in value) {
    const runs = value["r"]
    if ("i" in value || !Array.isArray(runs) || runs.length % 2 !== 0) return undefined
    for (let at = 0; at < runs.length; at += 2) {
      const index = runs[at]
      const length = runs[at + 1]
      if (!isIndex(index) || !Number.isSafeInteger(length) || (length as number) < 1 || inputs.length + (length as number) > most) return undefined
      for (let tick = 0; tick < (length as number); tick++) inputs.push(distinct[index])
    }
  } else {
    const indices = value["i"]
    if (!Array.isArray(indices) || indices.length > most) return undefined
    for (const index of indices) {
      if (!isIndex(index)) return undefined
      inputs.push(distinct[index])
    }
  }
  // Every distinct input is one some tick had.
  return distinct.length > inputs.length ? undefined : inputs
}

/**
 * What tells an input in its saved form from another: itself for a
 * primitive (`undefined`: compare the values), its JSON for an object,
 * kept with it, since a session writes each of its own inputs in every
 * frame's bundle until the others acknowledge it.
 */
const keys = new WeakMap<object, string>()
const keyOf = (input: unknown): string | undefined => {
  if (typeof input !== "object" || input === null) return undefined
  let key = keys.get(input)
  if (key === undefined) keys.set(input, key = JSON.stringify(input))
  return key
}

/** Writes a run of inputs into `written` as `d` and `i` or `r` (see {@link readInputs}). */
const writeInputs = (inputs: ReadonlyArray<unknown>, written: Record<string, unknown>): void => {
  const d: Array<unknown> = []
  const seen: Array<string | undefined> = []
  const i: Array<number> = []
  let runs = 0
  for (const raw of inputs) {
    // A value JSON cannot write (a tick with no input) arrives as null, as it did in a plain array.
    const input = raw === undefined ? null : raw
    const key = keyOf(input)
    // Few inputs are distinct: a search beats a map.
    let index = key === undefined ? d.indexOf(input) : seen.indexOf(key)
    if (index === -1) {
      index = d.length
      seen.push(key)
      d.push(input)
    }
    if (i.length === 0 || i[i.length - 1] !== index) runs += 1
    i.push(index)
  }
  written["d"] = d
  // A held input is one run: a pair instead of an index per tick.
  if (runs * 2 >= i.length) {
    written["i"] = i
    return
  }
  const r: Array<number> = []
  for (let at = 0; at < i.length; at++) {
    if (at > 0 && i[at] === i[at - 1]) r[r.length - 1]! += 1
    else r.push(i[at]!, 1)
  }
  written["r"] = r
}

/**
 * Acknowledgements as written: per seat, how far behind `next` the tick is
 * (a small number, where the tick itself grows all match long).
 */
const readAcks = (value: unknown, next: number, seats: number): ReadonlyArray<number> | undefined => {
  if (!Array.isArray(value) || value.length !== seats) return undefined
  const acks: Array<number> = []
  for (const behind of value) {
    const ack = next - behind
    if (!Number.isSafeInteger(behind) || !isTick(ack)) return undefined
    acks.push(ack)
  }
  return acks
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
  const messages: Array<Message> = []
  let dropped = 0
  for (const one of list) {
    const parsed = parseOne(one, from as number, epoch, seats)
    if (parsed._tag === "Message") messages.push(parsed.message)
    else dropped += 1
  }
  return { _tag: "Bundle", messages, malformed: dropped }
}

/** One message of a bundle from `from`, whose epoch is `epoch` unless the message names its own. */
const parseOne = (raw: unknown, from: number, bundleEpoch: number, seats: number): ParsedOne => {
  if (!isRecord(raw)) return malformed
  const value = raw
  const epoch = "epoch" in value ? value["epoch"] : bundleEpoch
  if (!isTick(epoch) || epoch < 0) return malformed
  const base = { from, epoch }
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
      const inputs = readInputs(value, maxInputsPerMessage)
      if (!isCount(value["roster"]) || !isTick(value["next"]) || !isTick(value["start"]) || value["start"] < 0) return malformed
      const acks = readAcks(value["acks"], value["next"], seats)
      if (acks === undefined || inputs === undefined) return malformed
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
      const inputs = readInputs(value, maxInputsPerMessage)
      if (!Number.isSafeInteger(seat) || (seat as number) < 0 || (seat as number) >= seats) return malformed
      if (!isCount(value["roster"]) || !isCount(value["n"]) || value["n"] < 1 || !isTick(value["last"]) || typeof value["away"] !== "boolean") return malformed
      if (!isCount(value["start"]) || inputs === undefined) return malformed
      // The inputs it carries are its own, so they end at `last` at the latest.
      if (value["start"] + inputs.length - 1 > value["last"]) return malformed
      return {
        _tag: "Message",
        message: { k: "hidden", ...base, roster: value["roster"], seat: seat as number, n: value["n"], last: value["last"], away: value["away"], start: value["start"], inputs }
      }
    }
    case "gone": {
      const seat = value["seat"]
      const inputs = readInputs(value, maxInputsPerMessage)
      if (!isSeat(seat, seats) || seat === from || !isWhy(value["why"]) || !isTick(value["have"])) return malformed
      if (!isCount(value["start"]) || inputs === undefined) return malformed
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
      const inputs = readInputs(value, maxInputsPerMessage)
      if (!isCount(value["roster"]) || value["roster"] < 1 || !isSeat(by, seats)) return malformed
      if (!Array.isArray(out) || out.length < 1 || out.length >= seats || !out.every((one) => isSeat(one, seats) && one !== by) || new Set(out).size !== out.length) return malformed
      if (!Array.isArray(why) || why.length !== out.length || !why.every(isWhy)) return malformed
      if (!Array.isArray(last) || last.length !== out.length || !last.every(isTick)) return malformed
      // Its input is the `left` one only after its last own one.
      if (!Array.isArray(tick) || tick.length !== out.length || !tick.every((first, index) => isCount(first) && first > (last[index] as number))) return malformed
      const index = out.indexOf(seat)
      if (index === -1 || !isCount(value["start"]) || inputs === undefined) return malformed
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

/** One message as a bundle writes it: no `from` (the bundle's), no `epoch` when it is the bundle's, its inputs as `d` and `i` or `r`, and an `inputs`' acknowledgements behind its `next`. */
const writeOne = (message: Message, epoch: number): Record<string, unknown> => {
  const written: Record<string, unknown> = {}
  if (message.epoch !== epoch) written["epoch"] = message.epoch
  const fields = message as unknown as Record<string, unknown>
  for (const key in fields) {
    if (key === "from" || key === "epoch") continue
    if (key === "inputs") writeInputs(fields[key] as ReadonlyArray<unknown>, written)
    else if (key === "acks" && message.k === "inputs") {
      const behind: Array<number> = []
      for (const ack of message.acks) behind.push(message.next - ack)
      written[key] = behind
    } else written[key] = fields[key]
  }
  return written
}

/** The text of a bundle: `messages`, all sent by `from`, which knows `epoch`. */
export const write = (from: number, epoch: number, messages: ReadonlyArray<Message>): string => {
  const m: Array<Record<string, unknown>> = []
  for (const message of messages) m.push(writeOne(message, epoch))
  return JSON.stringify({ v: version, from, epoch, m })
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
