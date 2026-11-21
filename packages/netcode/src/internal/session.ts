/**
 * The engine behind `Netcode.rollback` and `Netcode.lockstep`.
 *
 * Ticks are numbered from 0 for the whole match. Each seat has one input per
 * tick; a seat's input for a tick is "confirmed" once it arrived (or is the
 * local seat's own). `confirmed(seat)` is the last tick up to which a seat's
 * inputs are all known, and the match is confirmed up to the lowest of them.
 *
 * A save (`sync`, from seat 0) starts the match, and every resync: all peers
 * restore it at its tick `T`, and the inputs of ticks `T` to `T + delay - 1`
 * are idle for every seat, so a peer that restores it late agrees with one
 * that restored it early. Inputs for earlier ticks are ignored from then on.
 * That `delay` is `inputDelay`, or `adaptiveDelay.max`, on every peer.
 *
 * Each seat's input delay is its own (`./delay.ts`): a seat records its
 * input for the tick its current delay names, and the other peers read the
 * tick from the message, so a seat moves its delay without telling anyone.
 *
 * Rollback: a peer runs tick `next` once its own input for it is known and
 * `next` is at most `maxRollback` past the confirmed tick, guessing the
 * others. Every tick starts with a checkpoint; when an input arrives that
 * differs from the guess a tick ran with, the earliest such tick is rewound
 * to and the ticks up to the present run again. Since a peer never runs
 * further than `maxRollback` past the confirmed tick, a wrong guess is never
 * older than the checkpoints the runtime keeps (checked when made).
 *
 * Lockstep: a tick runs only with every seat's input; nothing is guessed.
 *
 * Epochs: a message belongs to the epoch its sender was in. Inputs (and the
 * acknowledgements and pacing they carry) apply only in that epoch: those of
 * a newer one, which can overtake their save, wait for it (the sender sends
 * them again until acknowledged), and those of an older one are replaced by
 * the save. A hide is the exception: a page that hid sends nothing more, so
 * its announcement's inputs from the save's floor on count in a later epoch
 * too (they are the seat's own and do not change); one of a newer epoch
 * waits for its save.
 *
 * Hidden pages (`hidden.ts`): a seat played around has idle input after its
 * last sent one, on every peer, and counts as confirmed once that input
 * arrived; the others play on without waiting for it.
 *
 * The host is the lowest seat that plays (in the match, and not played
 * around): seat 0 until it leaves. It starts the match, and makes every
 * save after it.
 *
 * The roster: which seats are in the match. A seat leaves it without a
 * save, so no tick a peer confirmed runs again:
 *
 * 1. A peer stops waiting for a seat (it was silent for `timeoutMS`, its
 *    link closed, another session said hello for it, or the game called
 *    `drop`). It takes no more of that seat's inputs, so the last one it
 *    has is final, and reports it (`gone`) with the inputs another peer
 *    may lack.
 * 2. The lowest playing seat a peer does not suspect decides for it: that
 *    seat takes up any peer's report about a higher seat, and the others
 *    take up its own. A report about that seat itself needs a peer's own
 *    reason, so a seat leaves only when no playing peer hears it. A peer
 *    that reports the deciding seat while that seat hears it is the one
 *    that cannot hear, and goes; unless the deciding seat was silent itself
 *    (its page froze), which it knows from its own clock: then it decides
 *    nothing while it is reported, and the next seat puts it out.
 * 3. Once every playing peer reported, that seat sends the change (`left`):
 *    the seat's own inputs end at the furthest any of them had (`last`), it
 *    is idle after it, and from `tick` its input is the seats' `left` one.
 *    No peer confirmed a tick past its own report, so none has to undo one;
 *    ticks run on a guess past `last` run again, as after any wrong guess.
 *
 * Each change makes the next roster number. A peer takes no input sent
 * under a roster it has not reached (the sender sends again, and any peer
 * that sees one behind passes the change on), so a tick is never confirmed
 * with a roster the others do not have. A seat that is out and still plays
 * is told so (`out`).
 *
 * A seat comes back with a save: a session that is not in the match says
 * hello (a new one after a reload, or one that learned it was left out), and
 * the host's next save seats it again, as a resync does for a hidden seat.
 *
 * Sessions: each session tells itself apart from another of the same seat
 * (a reloaded page) by its `hostClock` reading when it was made, in its
 * hellos and pings; the saves name the session of every seat.
 */
import type { HostClock } from "@typeonce/ritmo"
import type * as Checkpoint from "@typeonce/ritmo/Checkpoint"
import type * as Clock from "@typeonce/ritmo/Clock"
import type { Descriptor } from "@typeonce/ritmo/Descriptor"
import * as Result from "@typeonce/ritmo/Result"
import type * as Snapshot from "@typeonce/ritmo/Snapshot"

import type { AdaptiveDelay, Advanced, Ended, Halted, HiddenOptions, InvalidOptions, Left, Seats, Session, SessionError, Status } from "../Netcode.ts"
import * as Delay from "./delay.ts"
import * as Events from "./events.ts"
import { isHalted } from "./halted.ts"
import * as Hidden from "./hidden.ts"
import type { NetworkLink } from "../NetworkLink.ts"
import { canonical, decode, encode, send, stateOf, type Sent } from "./seats.ts"
import * as Wire from "./wire.ts"

/** What a session calls on its runtime. The public constructors check the real types. */
export interface Driven {
  readonly schema: unknown
  readonly inspect: (inspector: unknown) => unknown
  readonly services: Readonly<Record<string, unknown>>
  readonly tick: (schedule: unknown) => Result.Result<void, unknown>
  readonly checkpoint: (schedule: unknown) => Checkpoint.Checkpoint
  readonly rewind: (checkpoint: Checkpoint.Checkpoint) => Result.Result<void, Checkpoint.RewindError>
  readonly snapshot: () => Result.Result<Snapshot.WorldSnapshot, Snapshot.SnapshotError>
  readonly restore: (data: unknown) => Result.Result<void, Snapshot.RestoreError>
  readonly checksum: () => Result.Result<string, Snapshot.SnapshotError>
}

export interface MakeOptions {
  readonly simulate: unknown
  readonly seats: Seats<unknown>
  readonly seat: number
  readonly links: ReadonlyArray<NetworkLink>
  readonly hostClock: HostClock.HostClock
  readonly step: Clock.Step
  readonly inputDelay?: number
  readonly adaptiveDelay?: AdaptiveDelay
  readonly checksumEvery?: number
  readonly timeoutMS?: number
  readonly keepSnapshots?: boolean
  readonly maxRollback?: number
  readonly predict?: (previous: unknown) => unknown
  readonly hidden?: HiddenOptions
}

type Mode = "rollback" | "lockstep"

const pingEveryMS = 250
const resendSyncEveryMS = 500
/** A message the others should not wait a ping for (a hide, a report of a seat gone, a change of the roster) goes out this many times, against loss. */
const copies = 5
/** Below this, `rate` would stretch a frame too far for a player to miss. */
const slowestRate = 0.9

const invalid = (field: string, value: unknown, reason: string): Result.Failure<InvalidOptions> =>
  Result.failure({ _tag: "InvalidOptions", field, value, reason })

const wholeNumber = (value: number, least: number): boolean => Number.isSafeInteger(value) && value >= least

export const make = (mode: Mode, runtime: Driven, options: MakeOptions): Result.Result<Session<unknown, unknown, Descriptor<"event", string, any>>, InvalidOptions> => {
  const seatsState = stateOf(options.seats)
  if (seatsState === undefined) return invalid("seats", options.seats, "make seats with Netcode.seats")
  if (seatsState.owner !== undefined) return invalid("seats", options.seats, "these seats already belong to a session: make one Netcode.seats for each runtime")
  if (!Object.values(runtime.services).includes(options.seats.source)) {
    return invalid("seats", options.seats, "the runtime does not provide seats.source: give it to Game.Runtime.service(...) for the service the simulation captures")
  }
  const count = options.seats.count
  const seat = options.seat
  if (!Number.isSafeInteger(seat) || seat < 0 || seat >= count) return invalid("seat", seat, `a seat is a whole number from 0 to ${count - 1}`)
  if (options.links.length === 0) return invalid("links", options.links, "a session needs a link to the other peers")
  if (options.inputDelay !== undefined && options.adaptiveDelay !== undefined) {
    return invalid("adaptiveDelay", options.adaptiveDelay, "give inputDelay or adaptiveDelay, not both")
  }
  const fixedDelay = options.inputDelay ?? 2
  if (options.adaptiveDelay === undefined && !wholeNumber(fixedDelay, 0)) return invalid("inputDelay", fixedDelay, "a whole number of ticks, 0 or more")
  const madePolicy = options.adaptiveDelay === undefined ? Result.success(Delay.fixed(fixedDelay)) : Delay.make(options.adaptiveDelay, options.step.dt * 1000)
  if (!madePolicy.ok) return madePolicy
  const policy = madePolicy.value
  /** The idle ticks after a save: the same on every peer, whatever delay each uses now. */
  const saveDelay = policy.delay()
  const every = options.checksumEvery ?? 30
  if (!wholeNumber(every, 1)) return invalid("checksumEvery", every, "a whole number of ticks, 1 or more")
  const timeoutMS = options.timeoutMS ?? 5000
  if (!(timeoutMS > 0 && Number.isFinite(timeoutMS))) return invalid("timeoutMS", timeoutMS, "a positive number of milliseconds")
  const hiddenOptions = options.hidden
  if (hiddenOptions !== undefined) {
    const visibility = hiddenOptions.visibility as Partial<HiddenOptions["visibility"]> | undefined
    if (typeof visibility?.hidden !== "function" || typeof visibility.subscribe !== "function") {
      return invalid("hidden.visibility", visibility, "a Visibility: BrowserVisibility.make(document) in the browser, MemoryVisibility.make() in tests")
    }
    if (!(hiddenOptions.afterMS >= 0 && Number.isFinite(hiddenOptions.afterMS))) return invalid("hidden.afterMS", hiddenOptions.afterMS, "a number of milliseconds, 0 or more")
    if (hiddenOptions.then !== "stall" && hiddenOptions.then !== "resync-on-return") return invalid("hidden.then", hiddenOptions.then, "\"stall\" or \"resync-on-return\"")
  }
  const maxRollback = options.maxRollback ?? 8
  /**
   * How far past this peer's `localNext` an honest peer's input or checksum
   * can be. A peer runs at most `maxRollback` past the inputs it has of
   * this seat, which end before `localNext`, and records its own input up
   * to `saveDelay` ahead of the tick it runs. Before this peer restores a
   * save, seat 0 may already run from it: the save's tick is at most
   * `maxRollback` past this seat's inputs, and its idle ticks reach
   * `saveDelay` further, so both terms count twice. A message's worth of
   * inputs on top is margin. Lockstep runs nothing on guesses, so its
   * peers stay within `2 * saveDelay`. Further ahead is not an honest peer:
   * dropped, so a peer cannot make this one keep inputs and checksums
   * without bound. (A peer given a larger `maxRollback` than this one can
   * be further: its inputs are dropped until they are in reach, and it
   * sends them again until acknowledged.)
   */
  const furthestAhead = 2 * (maxRollback + saveDelay) + Wire.maxInputsPerMessage
  if (mode === "rollback") {
    if (!wholeNumber(maxRollback, 1)) return invalid("maxRollback", maxRollback, "a whole number of ticks, 1 or more")
    // The runtime must hold `maxRollback` checkpoints: take that many and go back to the first.
    const probe: Array<Checkpoint.Checkpoint> = []
    for (let index = 0; index < maxRollback; index++) probe.push(runtime.checkpoint(options.simulate))
    if (!runtime.rewind(probe[0]!).ok) {
      return invalid("maxRollback", maxRollback, "the runtime keeps fewer checkpoints than maxRollback: give Game.Runtime.make a checkpoints option of at least maxRollback")
    }
  }
  seatsState.owner = {}

  const { codec } = seatsState
  // Idle as the other peers decode it, like every local input.
  const idleSent = seatsState.idle
  const idle = idleSent.value
  /** What the simulation reads for a seat that left. */
  const leftInput = seatsState.left.value
  const predict = options.predict ?? ((previous: unknown) => previous)
  const clock = options.hostClock
  const stepMS = options.step.dt * 1000
  const keyOf = (value: unknown): string => {
    const encoded = encode(codec, value)
    return encoded.ok ? canonical(encoded.value) : `unencodable:${canonical(value)}`
  }
  const idleKey = keyOf(idle)
  const leftKey = keyOf(leftInput)

  // Match state.
  let epoch = 0
  let syncTick = 0
  /** Inputs for ticks before this one are fixed by the last save. */
  let floorTick = 0
  let next = 0
  let localNext = 0
  const inputs: Array<Map<number, unknown>> = Array.from({ length: count }, () => new Map())
  /** The other seats' inputs as their messages carried them, for the peer that lacks them when a seat is gone. */
  const raw: Array<Map<number, unknown>> = Array.from({ length: count }, () => new Map())
  /** Per seat, the first tick `raw` may still hold: what is before it was let go. */
  const rawFrom: Array<number> = Array.from({ length: count }, () => 0)
  /** This seat's inputs in their saved form, to send. */
  const sent = new Map<number, unknown>()
  const contiguous: Array<number> = Array.from({ length: count }, () => -1)
  /** Per seat, the key of the input each tick ran with. */
  const used: Array<Map<number, string>> = Array.from({ length: count }, () => new Map())
  /**
   * Per tick, the keys of every seat's input it last ran with, in seat order,
   * as one JSON array: a save carries the host's (`Wire.Sync.ran`), so a
   * peer that ran those ticks on a guess knows which of its runs were the
   * host's.
   */
  const ranKeys = new Map<number, string>()
  let wrong: number | undefined
  /** Ticks a rise of the delay skipped, filled idle by the next `record`. */
  let raised = 0
  const history = new Map<number, Checkpoint.Checkpoint>()

  // Checksums.
  const sums = new Map<number, { readonly sum: string; readonly snapshot: Snapshot.WorldSnapshot | undefined }>()
  const sentSums = new Set<number>()
  const remoteSums = new Map<number, Map<number, string>>()

  // Peers.
  /** This session, told apart from another of the same seat (a reloaded page): there is no other source to draw it from. */
  const sessionId = clock.now()
  /** Per seat, the session that plays it: from hellos on seat 0 before the first save, from the saves after. */
  let sessions: ReadonlyArray<number | undefined> = Array.from({ length: count }, (_, other) => other === seat ? sessionId : undefined)
  /** Before its first save, when this peer first heard a peer of a match already running. */
  let matchSeenAt: number | undefined
  const lastHeard: Array<number> = Array.from({ length: count }, () => clock.now())
  const acks: Array<Array<number>> = Array.from({ length: count }, () => Array.from({ length: count }, () => -1))
  const remoteNext: Array<{ readonly tick: number; readonly at: number } | undefined> = Array.from({ length: count }, () => undefined)
  const roundTrip: Array<number | undefined> = Array.from({ length: count }, () => undefined)
  const syncSentAt: Array<number> = Array.from({ length: count }, () => -Infinity)
  let lastPing = -Infinity
  let lastResyncAsk = -Infinity
  let syncMessage: Wire.Sync | undefined
  /** The seat whose save started this epoch. */
  let syncFrom = 0
  let pendingSync = false
  let wantSync = false

  // The roster.
  /** How many times the seats in the match changed. */
  let roster = 0
  /** Per seat, once it is out of the match: why, its last own input, and the first tick its input is the `left` one. */
  const gone: Array<Left | undefined> = Array.from({ length: count }, () => undefined)
  /** Per seat this peer stopped waiting for and that is still in the match: why. It takes no more of its inputs. */
  const suspected: Array<Wire.Why | undefined> = Array.from({ length: count }, () => undefined)
  let suspects = 0
  /** Reports go out at once, not with the next ping. */
  let reportNow = false
  /** The frames a new report still goes out in, against loss. */
  let reportFrames = 0
  /** Per seat, what each peer reported of it in this epoch: its last input there, and the inputs it carried. */
  const reports: Array<Map<number, { have: number; readonly inputs: Map<number, unknown> }>> = Array.from({ length: count }, () => new Map())
  /** The changes of the roster in this epoch, by the roster each made, to pass on. */
  const changes = new Map<number, Array<Wire.Left>>()
  /** The next change, while its messages have not all arrived. */
  let pendingChange: { readonly parts: Array<Wire.Left>; readonly inputs: Map<number, Map<number, unknown>> } | undefined
  const changeSentAt: Array<number> = Array.from({ length: count }, () => -Infinity)
  /** Sessions that said hello for a seat that is not theirs in the match, and when. */
  const asking = new Map<number, { readonly session: number; readonly at: number }>()
  /** This seat is out of the match (the others went on without it), since when, and why: it asks for a save that seats it. */
  let out: { readonly since: number; readonly why: Wire.Why } | undefined
  /** Per seat, when it last reported this seat gone. */
  const accusedAt: Array<number> = Array.from({ length: count }, () => -Infinity)
  /** When this session last ran `advance`: a long gap is this page's own silence (a hitch, a frozen tab), not the others'. */
  let lastAdvance = clock.now()
  /** After such a gap, until when a report of this seat is taken as fair. */
  let excusedUntil = -Infinity
  /** Per seat, the link its messages arrive on (-1: none yet). */
  const linkOf: Array<number> = Array.from({ length: count }, () => -1)
  const linkClosed: Array<boolean> = options.links.map(() => false)

  // Outcomes.
  let ended: Ended | undefined
  let halted: Halted<unknown> | undefined
  let verified = -1
  let rollbacks = 0
  let again = 0
  let dropped = 0
  /** What the last stalled `advance` waited for (`waitingSeat` -1: it did not stall). */
  let waitingSeat = -1
  let waitingTick = -1
  let waitingSince = 0

  // Host event readers (`events(...)`): one ledger per descriptor.
  const ledgers = new Map<unknown, Events.Ledger>()
  /** Every tick before this one will not run again. */
  let settled = 0
  const settle = (): void => {
    const now = Math.min(confirmed() + 1, next)
    if (now <= settled) return
    const previous = settled
    settled = now
    for (const ledger of ledgers.values()) ledger.settle(previous, now)
  }
  // Hidden pages.
  const tracker = Hidden.make(count)
  const graceMS = hiddenOptions?.afterMS ?? 0
  /** Per seat, whether it was played around when last looked at. */
  const wasAway: Array<boolean> = Array.from({ length: count }, () => false)
  /** Per seat, the messages of its latest announced spell: this seat's own to repeat, the others' to pass on while they are hidden. */
  const announcements: Array<ReadonlyArray<Wire.Hidden>> = Array.from({ length: count }, () => [])
  /** Hides announced in an epoch whose save has not arrived: applied once it does. */
  let held: Array<Wire.Hidden> = []
  let unsubscribe: (() => void) | undefined

  // What this session says goes out once per frame, as one bundle per link.
  /** The messages said since the last flush. */
  const outbox: Array<Wire.Message> = []
  /** Messages to say again with the next flushes, once each (`left` stays in the outbox `copies - 1` more frames), against loss. */
  let repeats: Array<{ readonly message: Wire.Message; left: number }> = []
  /** Bundles handed to the links, and their UTF-8 bytes: one per open link per flush. */
  let sentMessages = 0
  let sentBytes = 0

  /**
   * Says `message` with this frame's bundle. An `inputs` or `hello` replaces
   * the one said before it in the frame: each says everything the earlier
   * one did, and more.
   */
  const broadcast = (message: Wire.Message): void => {
    if (message.k === "inputs" || message.k === "hello") {
      for (let earlier = 0; earlier < outbox.length; earlier++) {
        if (outbox[earlier]!.k !== message.k) continue
        outbox[earlier] = message
        return
      }
    }
    outbox.push(message)
  }

  /** Says `messages` now and with each of the next `copies - 1` flushes: one bundle more lost does not lose them. */
  const broadcastCopies = (messages: ReadonlyArray<Wire.Message>): void => {
    for (const message of messages) {
      broadcast(message)
      repeats.push({ message, left: copies - 1 })
    }
  }

  /** Hands the outbox to every open link as one bundle. */
  const flush = (): void => {
    if (outbox.length === 0) return
    const text = Wire.write(seat, epoch, outbox)
    outbox.length = 0
    const bytes = Wire.utf8Length(text)
    for (let index = 0; index < options.links.length; index++) {
      if (linkClosed[index]) continue
      options.links[index]!.send(text)
      sentMessages += 1
      sentBytes += bytes
    }
  }

  /** At the start of a frame's bundle: the copies still owed. */
  const sayRepeats = (): void => {
    if (repeats.length === 0) return
    for (const repeat of repeats) {
      outbox.push(repeat.message)
      repeat.left -= 1
    }
    repeats = repeats.filter((repeat) => repeat.left > 0)
  }

  /** Whether `other` plays: in the match, and not played around while its page is hidden. */
  const plays = (other: number): boolean => gone[other] === undefined && !Hidden.away(tracker, other)

  /** The lowest seat that plays makes the saves (`-1`: none does). */
  const hostSeat = (): number => {
    for (let other = 0; other < count; other++) if (plays(other)) return other
    return -1
  }
  const isHost = (): boolean => out === undefined && hostSeat() === seat

  /** Another seat this peer plays around: it left, or its page is hidden. Its input after its last own one is not its own. */
  const playedAround = (other: number): boolean => other !== seat && (gone[other] !== undefined || Hidden.away(tracker, other))

  /** The last tick of a played-around seat's own input. */
  const lastOf = (other: number): number => gone[other]?.lastInput ?? tracker.last[other]!

  /** A seat played around whose real input all arrived: nothing more to wait for. */
  const filled = (other: number): boolean => playedAround(other) && contiguous[other]! >= lastOf(other)

  const confirmed = (): number => {
    let lowest = Infinity
    for (let other = 0; other < count; other++) if (!filled(other)) lowest = Math.min(lowest, contiguous[other]!)
    return lowest
  }

  const extend = (other: number): void => {
    const known = inputs[other]!
    let last = contiguous[other]!
    while (known.has(last + 1)) last += 1
    contiguous[other] = last
  }

  /** The input `other` is guessed to have on `tick`: `predict` of its last known one before it. */
  const guess = (other: number, tick: number): unknown => {
    const known = inputs[other]!
    for (let at = tick - 1; at >= syncTick; at--) {
      const input = known.get(at)
      if (input !== undefined) return predict(input)
    }
    return predict(idle)
  }

  const inputFor = (other: number, tick: number): unknown => {
    const left = gone[other]
    if (left !== undefined) {
      if (tick >= left.tick) return leftInput
      if (tick > left.lastInput) return idle
    } else if (tick > tracker.last[other]! && playedAround(other)) return idle
    const known = inputs[other]!.get(tick)
    return known !== undefined ? known : guess(other, tick)
  }

  /** Real input for a tick that ran: the earliest tick whose input now differs from the one it ran with is wrong. */
  const confirmRemote = (other: number, tick: number, input: unknown, wire: unknown): void => {
    const known = inputs[other]!
    // Known already: confirmed (a save confirms the ticks before its floor), or out of order.
    if (tick <= contiguous[other]! || known.has(tick)) return
    // This peer stopped waiting for it: what it has of it is what it reported.
    if (suspected[other] !== undefined) return
    // Played around: not its own after its last input, whatever arrives.
    if (tick > lastOf(other) && playedAround(other)) return
    known.set(tick, input)
    raw[other]!.set(tick, wire)
    extend(other)
    if (mode !== "rollback" || tick >= next) return
    const ran = used[other]!
    for (let at = tick; at < next; at++) {
      // Past the next known input, the guesses do not depend on this one.
      if (at > tick && known.has(at)) break
      const before = ran.get(at)
      if (before !== undefined && before !== keyOf(inputFor(other, at))) {
        wrong = wrong === undefined ? at : Math.min(wrong, at)
        break
      }
    }
  }

  const end = (error: Ended): void => {
    ended ??= error
    unsubscribe?.()
    unsubscribe = undefined
  }

  /**
   * Stops waiting for `other`, for `why`: this peer takes no more of its
   * inputs, and reports the last one it has until the seat is out of the
   * match.
   */
  const suspect = (other: number, why: Wire.Why): void => {
    if (other === seat || epoch === 0 || out !== undefined || gone[other] !== undefined || suspected[other] !== undefined) return
    suspected[other] = why
    suspects += 1
    reportNow = true
  }

  const trust = (other: number): void => {
    if (suspected[other] === undefined) return
    suspected[other] = undefined
    suspects -= 1
  }

  /** The others went on without this seat: it waits for a save that seats it again, as long as `timeoutMS`. */
  const leaveMatch = (why: Wire.Why, detail: string): void => {
    if (why === "restarted") {
      end({ _tag: "Disconnected", who: "self", seat, reason: "restarted", detail })
      return
    }
    // One link per peer, and the one to a seat that plays is closed: no save could bring this seat back to it.
    for (let other = 0; other < count; other++) {
      if (other === seat || gone[other] !== undefined || linkOf[other] === -1 || !linkClosed[linkOf[other]!]) continue
      end({ _tag: "Disconnected", who: "self", seat, reason: why, detail: `${detail}, and its link to seat ${other} is closed` })
      return
    }
    out ??= { since: clock.now(), why }
  }

  /** Rollback: a seat now played around ran ticks after its last input with a guess that was not idle. */
  const lookAway = (): void => {
    for (let other = 0; other < count; other++) {
      const now = playedAround(other)
      // A seat that left was looked at when it did (`applyChange`).
      if (now && !wasAway[other] && mode === "rollback" && gone[other] === undefined) {
        const ran = used[other]!
        for (let at = tracker.last[other]! + 1; at < next; at++) {
          const before = ran.get(at)
          if (before !== undefined && before !== idleKey) {
            wrong = wrong === undefined ? at : Math.min(wrong, at)
            break
          }
        }
      }
      wasAway[other] = now
    }
  }

  const compare = (tick: number): void => {
    const mine = sums.get(tick)
    const theirs = remoteSums.get(tick)
    if (mine === undefined || theirs === undefined || !sentSums.has(tick)) return
    for (const [other, sum] of theirs) {
      // A seat that left may have run on with its own input.
      if (gone[other] !== undefined) continue
      if (sum !== mine.sum) {
        halted ??= { _tag: "Desynced", tick, seat: other, mine: mine.sum, theirs: sum, snapshot: mine.snapshot }
        return
      }
    }
    let all = true
    for (let other = 0; other < count; other++) if (other !== seat && !playedAround(other) && !theirs.has(other)) all = false
    if (all) {
      verified = Math.max(verified, tick)
      sums.delete(tick)
      remoteSums.delete(tick)
    }
  }

  /**
   * How far back `ranKeys` reaches: past every tick a save's `ran` can name.
   * A save names its host's ticks from `maxRollback` before its settled
   * ones, which are at most `maxRollback` before its next tick; a peer runs
   * up to `furthestAhead` past that.
   */
  const ranReach = furthestAhead + 2 * maxRollback

  /** Ticks `tick` with the input of every seat, after its checksum and checkpoint. */
  const runTick = (tick: number): boolean => {
    if ((tick - syncTick) % every === 0) {
      const sum = runtime.checksum()
      if (!sum.ok) {
        end({ _tag: "SyncFailed", error: sum.error })
        return false
      }
      const snapshot = options.keepSnapshots === true ? runtime.snapshot() : undefined
      sums.set(tick, { sum: sum.value, snapshot: snapshot?.ok === true ? snapshot.value : undefined })
    }
    // After a rollback the checkpoint it rewound to is still held and is this tick's: taking another would spend a slot of the runtime's window for nothing.
    if (mode === "rollback" && !history.has(tick)) history.set(tick, runtime.checkpoint(options.simulate))
    const current: Array<unknown> = []
    const keys: Array<string> = []
    for (let other = 0; other < count; other++) {
      const input = inputFor(other, tick)
      current.push(input)
      const key = keyOf(input)
      keys.push(key)
      if (other !== seat) used[other]!.set(tick, key)
    }
    seatsState.current = current
    // Each key is the canonical JSON of an input, so the list is a JSON array: two runs with other inputs never share it.
    ranKeys.set(tick, `[${keys.join(",")}]`)
    ranKeys.delete(tick - ranReach)
    for (const ledger of ledgers.values()) ledger.skip()
    const ticked = runtime.tick(options.simulate)
    if (ticked.ok) for (const ledger of ledgers.values()) ledger.record(tick)
    if (!ticked.ok) {
      halted ??= { _tag: "TickFailed", tick, error: ticked.error }
      return false
    }
    return true
  }

  const canRun = (tick: number): boolean => {
    if (!inputs[seat]!.has(tick)) return false
    if (mode === "rollback") return tick <= confirmed() + maxRollback
    for (let other = 0; other < count; other++) {
      if (!inputs[other]!.has(tick) && !(filled(other) && tick > tracker.last[other]!)) return false
    }
    return true
  }

  /** Runs ticks from `next` up to `until` (excluded) while they can run. */
  const runUpTo = (until: number): number => {
    let ran = 0
    while (next < until && halted === undefined && ended === undefined && canRun(next)) {
      if (!runTick(next)) break
      next += 1
      ran += 1
    }
    return ran
  }

  /**
   * The tick up to which this peer's runs before `message`'s save were the
   * host's: from a tick both confirmed with every seat's real input, each
   * tick ran with the same inputs as the host's (`ran`), so the world went
   * through it the same way. The ticks after it, up to the save, are lost
   * to this peer's readers. The host's own save is its world: every tick
   * it ran. A session the save seats for its first match has no ticks
   * before it to lose.
   */
  const ranAsSaved = (message: Wire.Sync): number => {
    if (message.from === seat || epoch === 0) return message.tick
    // Another history than the save's: a save between missed, or ticks run while out of the match.
    if (message.epoch !== epoch + 1 || out !== undefined) return settled
    // The host's ticks before `ranFrom` ran with real inputs, as this peer's settled ones did: the worlds agree up to the first of either.
    if (message.ranFrom > settled) return settled
    const until = Math.min(message.tick, next)
    for (let at = message.ranFrom; at < until; at++) if (ranKeys.get(at) !== message.ran[at - message.ranFrom]) return at
    return until
  }

  /** Restores a save every peer restores at its tick, takes its roster, and runs again up to where this peer was. */
  const applySync = (message: Wire.Sync): void => {
    const restored = runtime.restore(message.save)
    if (!restored.ok) {
      end({ _tag: "SyncFailed", error: restored.error })
      return
    }
    const tick = message.tick
    const previous = next
    // The ticks before the save are final, as the host's world went through them: the ones this peer ran as the host did are confirmed.
    const final = ranAsSaved(message)
    for (const ledger of ledgers.values()) {
      // Ticks a resync ran again before this save, and not settled yet: compared with what was handed out of them.
      ledger.settle(settled, settled)
      ledger.save(tick, final)
    }
    settled = Math.max(settled, tick)
    ranKeys.clear()
    epoch = message.epoch
    syncFrom = message.from
    syncTick = tick
    floorTick = tick + saveDelay
    next = tick
    history.clear()
    wrong = undefined
    halted = undefined
    wantSync = false
    // Seated again: what this peer made of the others while they played without it is of no use.
    if (out !== undefined) for (let other = 0; other < count; other++) trust(other)
    out = undefined
    sums.clear()
    sentSums.clear()
    remoteSums.clear()
    verified = -1
    // The roster is the save's: the changes before it are in it, and reports are of an epoch.
    roster = message.roster
    changes.clear()
    pendingChange = undefined
    for (const told of reports) told.clear()
    const now = clock.now()
    for (let other = 0; other < count; other++) {
      const why = message.left[other]!
      const before = gone[other]
      if (why !== null) {
        // Out from this save on, whatever inputs of its own were still to run.
        gone[other] = { reason: before?.reason ?? why, lastInput: Math.min(before?.lastInput ?? Infinity, tick - 1), tick: Math.min(before?.tick ?? Infinity, tick) }
        trust(other)
      } else if (before !== undefined || message.sessions[other] !== sessions[other]) {
        // Seated by this save.
        const same = message.sessions[other] === sessions[other]
        gone[other] = undefined
        trust(other)
        asking.delete(other)
        Hidden.seated(tracker, other, same)
        announcements[other] = []
        held = held.filter((hide) => hide.seat !== other)
        // Another session (a reloaded page): nothing its earlier one sent or acknowledged is its own.
        if (!same && other !== seat) {
          inputs[other]!.clear()
          raw[other]!.clear()
          contiguous[other] = -1
          acks[other]!.fill(-1)
          remoteNext[other] = undefined
          roundTrip[other] = undefined
        }
      }
    }
    sessions = message.sessions
    for (let other = 0; other < count; other++) {
      for (let at = tick; at < floorTick; at++) {
        inputs[other]!.set(at, idle)
        if (other !== seat) raw[other]!.set(at, idleSent.wire)
      }
      rawFrom[other] = Math.min(rawFrom[other]!, tick)
      used[other]!.clear()
      contiguous[other] = Math.max(contiguous[other]!, floorTick - 1)
      extend(other)
      lastHeard[other] = now
    }
    for (let at = tick; at < floorTick; at++) sent.set(at, idleSent.wire)
    localNext = Math.max(localNext, floorTick)
    // What the host held past the idle ticks, for a session this save seats: the seats no longer send what its earlier session acknowledged.
    for (let other = 0; other < count; other++) if (other !== seat) takeInputs(other, floorTick, message.ahead[other]!)
    // Messages of the epoch before are still on their way: whoever hosts now gives the save time to arrive before it sends another.
    syncSentAt.fill(now)
    Hidden.synced(tracker, message.returned, floorTick)
    releaseHeld()
    for (let other = 0; other < count; other++) wasAway[other] = playedAround(other)
    if (mode === "rollback") runUpTo(previous)
  }

  const performSync = (): void => {
    pendingSync = false
    const saved = runtime.snapshot()
    if (!saved.ok) {
      end({ _tag: "SyncFailed", error: saved.error })
      return
    }
    // Restore what the others will parse, not the object itself, so every peer restores the same data.
    const save: unknown = JSON.parse(JSON.stringify(saved.value))
    // A seat that left and says hello gets its seat back with this save.
    const now = clock.now()
    const left: Array<Wire.Why | null> = gone.map((one) => one?.reason ?? null)
    const named = sessions.slice() as Array<number>
    let seated = 0
    for (const [other, ask] of asking) {
      if (now - ask.at > timeoutMS) asking.delete(other)
      else if (gone[other] !== undefined) {
        left[other] = null
        named[other] = ask.session
        seated += 1
      }
    }
    // For a session it seats: every seat's inputs past the save's idle ticks, as far as this peer has them all.
    const ahead: Array<Array<unknown>> = Array.from({ length: count }, () => [])
    if (seated > 0) {
      for (let other = 0; other < count; other++) {
        // Not those of a seat's earlier session.
        if (gone[other] !== undefined || named[other] !== sessions[other]) continue
        const known = other === seat ? sent : raw[other]!
        const last = other === seat ? localNext - 1 : contiguous[other]!
        for (let at = next + saveDelay; at <= last && known.has(at) && ahead[other]!.length < Wire.maxInputsAhead; at++) ahead[other]!.push(known.get(at))
      }
    }
    // What this world went through before the save, from `maxRollback` before the ticks it settled (a peer may have settled fewer): the inputs of every tick a peer may have run on a guess. Lockstep runs none on a guess.
    let ranFrom = next
    const lowest = mode === "rollback" ? Math.max(syncTick, settled - maxRollback) : next
    while (ranFrom > lowest && ranKeys.has(ranFrom - 1)) ranFrom -= 1
    const ran: Array<string> = []
    for (let at = ranFrom; at < next; at++) ran.push(ranKeys.get(at)!)
    syncMessage = { k: "sync", from: seat, epoch: epoch + 1, tick: next, save, returned: tracker.shown.slice(), sessions: named, roster: roster + (seated > 0 ? 1 : 0), left, ahead, ranFrom, ran }
    applySync(syncMessage)
    broadcast(syncMessage)
    syncSentAt.fill(clock.now())
  }

  /** For the host: `other` is behind this epoch. The save that started it again, or a new one when another seat made that one. */
  const resendSync = (other: number): void => {
    if (!isHost()) return
    const now = clock.now()
    if (now - syncSentAt[other]! < resendSyncEveryMS) return
    syncSentAt[other] = now
    if (syncMessage !== undefined && syncMessage.epoch === epoch) broadcast(syncMessage)
    else pendingSync = true
  }

  /** A message for ticks no honest peer is at yet. Not counted while this seat is played around: the others ran on without it, and the save that ends it moves this seat to them. */
  const tooFarAhead = (): void => {
    if (!Hidden.away(tracker, seat)) dropped += 1
  }

  /** `other`'s inputs from `start`, as a message carries them. */
  const takeInputs = (other: number, start: number, carried: ReadonlyArray<unknown>): void => {
    for (let index = 0; index < carried.length; index++) {
      const tick = start + index
      if (tick <= contiguous[other]! || inputs[other]!.has(tick)) continue
      // The rest are further still: an honest peer sends them again once they are in reach.
      if (tick > localNext + furthestAhead) {
        tooFarAhead()
        return
      }
      const decoded = decode(codec, carried[index])
      if (!decoded.ok) {
        dropped += 1
        return
      }
      confirmRemote(other, tick, decoded.value, carried[index])
    }
  }

  /** Acknowledgements only grow: a message overtaken by a later one says less, not that inputs were lost. */
  const takeAcks = (other: number, received: ReadonlyArray<number>): void => {
    const known = acks[other]!
    for (let index = 0; index < count; index++) if (received[index]! > known[index]!) known[index] = received[index]!
  }

  /** Whether `other` is hidden as far as this peer knows: a hide held for its save counts, since that it hid does not depend on the epoch. */
  const hiddenNow = (other: number): boolean =>
    Hidden.hidden(tracker, other) || (held.length > 0 && held.some((message) => message.seat === other && message.n > tracker.shown[other]!))

  /** A hide of a newer epoch: it waits for that epoch's save. A peer holds a spell or two per seat; past that, the oldest goes. */
  const hold = (message: Wire.Hidden): void => {
    if (held.some((known) => known.seat === message.seat && known.n === message.n && known.start === message.start && known.epoch === message.epoch)) return
    if (held.length >= count * 4) held.shift()
    held.push(message)
  }

  /** After a save or a change of the roster: the hides that waited for it. */
  const releaseHeld = (): void => {
    if (held.length === 0) return
    const ready = held.filter((message) => message.epoch <= epoch && message.roster <= roster)
    held = held.filter((message) => message.epoch > epoch || message.roster > roster)
    for (const message of ready) heardHidden(message)
  }

  /** A hide of `message.seat`, from itself or passed on by another peer. */
  const heardHidden = (message: Wire.Hidden): void => {
    const other = message.seat
    if (other === seat || gone[other] !== undefined) return
    // A newer epoch's waits for its save: until then this peer's floor is not that epoch's. One of a roster this peer has not reached waits for it too.
    if (message.epoch > epoch || message.roster > roster) {
      hold(message)
      return
    }
    // Its own inputs, which it never sends again: of an older epoch, those from this save's floor on (the ones before are skipped as known).
    takeInputs(other, message.start, message.inputs)
    const latest = Hidden.announced(tracker, other, message.n, message.away, Math.max(message.last, floorTick - 1))
    if (latest) {
      const known = announcements[other]!
      const same = known.length > 0 && known[0]!.n === message.n
      if (!same) announcements[other] = [message]
      else if (!known.some((part) => part.start === message.start)) announcements[other] = [...known, message]
    }
    if (isHost() && epoch > 0 && Hidden.returned(tracker, other)) pendingSync = true
  }

  /** Before this peer's first save: a hello or ping names its session, and a peer already in a match shows there is one. */
  const beforeMatch = (message: Wire.Message): void => {
    const other = message.from
    // Seat 0 starts a match: it names the session of every seat that is not in one yet.
    if (seat === 0 && (message.k === "hello" || message.k === "ping") && message.epoch === 0) {
      sessions = sessions.map((known, at) => at === other ? message.session : known)
    }
    // A match already runs: this session's hellos ask for its seat in it.
    if (message.epoch > 0) matchSeenAt ??= clock.now()
  }

  /** The lowest seat that plays and that this peer does not suspect: the one that decides who is out (`-1`: none). */
  const decider = (): number => {
    for (let other = 0; other < count; other++) if (plays(other) && suspected[other] === undefined) return other
    return -1
  }

  /**
   * This peer's report on `about`, a seat it stopped waiting for: the last
   * input it has of it, and those from the first one a playing peer may
   * lack, as far back as this peer still holds them.
   */
  const reportOn = (about: number): ReadonlyArray<Wire.Gone> => {
    const have = contiguous[about]!
    let lowest = have
    for (let other = 0; other < count; other++) {
      if (other !== seat && other !== about && plays(other)) lowest = Math.min(lowest, acks[other]![about]!)
    }
    const known = raw[about]!
    let start = have + 1
    while (start - 1 > lowest && start - 1 >= floorTick && known.has(start - 1)) start -= 1
    const parts: Array<Wire.Gone> = []
    do {
      const carried: Array<unknown> = []
      for (let tick = start; tick <= have && carried.length < Wire.maxInputsPerMessage; tick++) carried.push(known.get(tick))
      parts.push({ k: "gone", from: seat, epoch, seat: about, why: suspected[about]!, have, start, inputs: carried })
      start += carried.length
    } while (start <= have)
    return parts
  }

  /** `message.from` stopped waiting for `message.seat`. */
  const heardGone = (message: Wire.Gone): void => {
    const other = message.from
    const about = message.seat
    // A seat this peer stopped waiting for has no say, nor one whose page is hidden: a save replaces its world.
    if (message.epoch !== epoch || suspected[other] !== undefined || Hidden.away(tracker, other) || gone[about] !== undefined) return
    const decides = decider()
    if (about === seat) {
      accusedAt[other] = clock.now()
      // This peer hears it, so it is the one that cannot hear: of the two, the seat that decides stays. Not when this peer was silent itself: then the report is fair.
      if (decides === seat && clock.now() >= excusedUntil) suspect(other, "timeout")
      return
    }
    if (message.have > localNext + furthestAhead) {
      tooFarAhead()
      return
    }
    const told = reports[about]!
    let report = told.get(other)
    if (report === undefined) told.set(other, report = { have: message.have, inputs: new Map() })
    report.have = message.have
    // Kept as carried: decoded if the seat goes, with the change that says how far its inputs count.
    for (let index = 0; index < message.inputs.length; index++) {
      const tick = message.start + index
      if (tick > contiguous[about]!) report.inputs.set(tick, message.inputs[index])
    }
    // The seat that decides says so, or this peer decides and any playing peer does: stop waiting for it too.
    if (other === decides || decides === seat) suspect(about, message.why)
  }

  const sameChange = (one: Wire.Left, other: Wire.Left): boolean =>
    one.roster === other.roster && one.by === other.by && one.seats.length === other.seats.length &&
    one.seats.every((out, index) => out === other.seats[index] && one.last[index] === other.last[index] && one.tick[index] === other.tick[index])

  /** After a change of the roster: the session ends when no other seat is in the match and none asks for its seat. */
  const alone = (lastOut: number, why: Wire.Why): void => {
    for (let other = 0; other < count; other++) if (other !== seat && gone[other] === undefined) return
    const now = clock.now()
    for (const [other, ask] of asking) {
      if (gone[other] !== undefined && now - ask.at <= timeoutMS) {
        // A session waits for the seat (a page reloaded): the next save seats it.
        pendingSync = true
        return
      }
    }
    end({ _tag: "Disconnected", who: "others", seat: lastOut, reason: why, detail: `seat ${lastOut} left the match (${why}), and no other seat is in it` })
  }

  /** Takes a change of the roster: the seats' inputs up to their last one, then nothing of their own. */
  const applyChange = (head: Wire.Left, carried: ReadonlyMap<number, ReadonlyMap<number, unknown>>): void => {
    roster = head.roster
    pendingChange = undefined
    let mine: Wire.Why | undefined
    let lastOut = -1
    for (const [index, about] of head.seats.entries()) {
      const left: Left = { reason: head.why[index]!, lastInput: head.last[index]!, tick: head.tick[index]! }
      if (about === seat) {
        mine = left.reason
        gone[seat] = left
        continue
      }
      lastOut = about
      trust(about)
      reports[about]!.clear()
      const known = inputs[about]!
      // More than the others agreed on (this peer was not asked): past the last one, they do not count.
      for (let tick = contiguous[about]!; tick > left.lastInput; tick--) {
        known.delete(tick)
        raw[about]!.delete(tick)
      }
      contiguous[about] = Math.min(contiguous[about]!, left.lastInput)
      const more = carried.get(about)
      for (let tick = contiguous[about] + 1; tick <= left.lastInput; tick++) {
        if (known.has(tick)) continue
        const wire = more?.get(tick)
        const decoded = decode(codec, wire)
        // Every peer decodes the same message, so every peer falls back the same way.
        if (!decoded.ok) dropped += 1
        confirmRemote(about, tick, decoded.ok ? decoded.value : idle, wire)
      }
      gone[about] = left
      // Rollback: ticks past its last input ran with a guess of it.
      if (mode === "rollback") {
        const ran = used[about]!
        for (let at = left.lastInput + 1; at < next; at++) {
          const before = ran.get(at)
          if (before !== undefined && before !== (at >= left.tick ? leftKey : idleKey)) {
            wrong = wrong === undefined ? at : Math.min(wrong, at)
            break
          }
        }
      }
      wasAway[about] = true
    }
    if (mine !== undefined) {
      leaveMatch(mine, `seat ${head.by} and the seats with it went on without seat ${seat} (${mine})`)
      return
    }
    releaseHeld()
    alone(lastOut, head.why[head.seats.indexOf(lastOut)]!)
  }

  /**
   * Whether `head` is the next change as this peer sees the match: made by
   * the lowest seat that plays once its seats are out.
   */
  const validChange = (head: Wire.Left): boolean => {
    if (gone[head.by] !== undefined || Hidden.away(tracker, head.by)) return false
    for (const about of head.seats) if (gone[about] !== undefined) return false
    for (let lower = 0; lower < head.by; lower++) if (plays(lower) && !head.seats.includes(lower)) return false
    return true
  }

  const heardLeft = (message: Wire.Left): void => {
    if (message.epoch !== epoch) return
    if (message.roster <= roster) {
      const mine = changes.get(message.roster)?.[0]
      // Two seats each put the other out, and this peer took the higher one's change: the lower seat's match is the one that goes on.
      if (mine !== undefined && message.by < mine.by && !sameChange(mine, message)) {
        leaveMatch("dropped", `seat ${message.by} and seat ${mine.by} each went on without the other, and seat ${message.by}'s match stands`)
      }
      return
    }
    if (message.roster !== roster + 1 || !validChange(message)) return
    if (pendingChange === undefined || !sameChange(pendingChange.parts[0]!, message)) pendingChange = { parts: [], inputs: new Map() }
    const pending = pendingChange
    if (!pending.parts.some((part) => part.seat === message.seat && part.start === message.start)) pending.parts.push(message)
    let carried = pending.inputs.get(message.seat)
    if (carried === undefined) pending.inputs.set(message.seat, carried = new Map())
    for (let index = 0; index < message.inputs.length; index++) carried.set(message.start + index, message.inputs[index])
    // Complete once this peer has every seat's inputs up to its last one.
    for (const [index, about] of message.seats.entries()) {
      if (about === seat) continue
      const more = pending.inputs.get(about)
      for (let tick = contiguous[about]! + 1; tick <= message.last[index]!; tick++) {
        if (!inputs[about]!.has(tick) && more?.has(tick) !== true) return
      }
    }
    changes.set(message.roster, pending.parts)
    applyChange(message, pending.inputs)
  }

  /** `other` is behind this peer's roster: the changes it missed, passed on. */
  const resendChanges = (other: number, theirs: number): void => {
    if (theirs >= roster) return
    const now = clock.now()
    if (now - changeSentAt[other]! < pingEveryMS) return
    changeSentAt[other] = now
    for (const [made, parts] of changes) {
      if (made > theirs) for (const part of parts) broadcast(part.from === seat ? part : { ...part, from: seat })
    }
  }

  /**
   * When this peer decides (it is the lowest playing seat it does not
   * suspect) and every other playing peer reported the seats it stopped
   * waiting for: they are out. Each seat's own inputs end at the furthest
   * one any of those peers has, so no peer confirmed a tick past it.
   */
  const decide = (): void => {
    if (suspects === 0 || epoch === 0 || out !== undefined || decider() !== seat) return
    // A playing peer reports this seat gone, and this peer does not hold it wrong: the others may be putting this seat out, and two changes at once would split the match.
    const now = clock.now()
    for (let other = 0; other < count; other++) {
      if (other !== seat && plays(other) && suspected[other] === undefined && now - accusedAt[other]! <= 2 * pingEveryMS) return
    }
    const out_: Array<number> = []
    const voters: Array<number> = []
    for (let other = 0; other < count; other++) {
      if (other === seat || gone[other] !== undefined) continue
      if (suspected[other] !== undefined) out_.push(other)
      else if (plays(other)) voters.push(other)
    }
    const why: Array<Wire.Why> = []
    const last: Array<number> = []
    const tick: Array<number> = []
    const lowest: Array<number> = []
    const carried = new Map<number, Map<number, unknown>>()
    for (const about of out_) {
      const told = reports[about]!
      let furthest = contiguous[about]!
      let least = furthest
      for (const voter of voters) {
        const report = told.get(voter)
        if (report === undefined) return
        furthest = Math.max(furthest, report.have)
        least = Math.min(least, report.have)
      }
      const known = raw[about]!
      const more = new Map<number, unknown>()
      for (let at = least + 1; at <= furthest; at++) {
        if (known.has(at)) {
          more.set(at, known.get(at))
          continue
        }
        let found = false
        for (const voter of voters) {
          const report = told.get(voter)!
          if (!report.inputs.has(at)) continue
          more.set(at, report.inputs.get(at))
          found = true
          break
        }
        // A report that carries it is still to come.
        if (!found) return
      }
      carried.set(about, more)
      why.push(suspected[about]!)
      last.push(furthest)
      lowest.push(least)
      // A seat already played around was idle on ticks the peers confirmed: its input changes on a tick none has, the next one this peer sends an input for.
      tick.push(Hidden.away(tracker, about) ? Math.max(furthest + 1, localNext) : furthest + 1)
    }
    const head = { k: "left" as const, from: seat, epoch, roster: roster + 1, by: seat, seats: out_, why, last, tick }
    const parts: Array<Wire.Left> = []
    for (const [index, about] of out_.entries()) {
      const more = carried.get(about)!
      let start = lowest[index]! + 1
      do {
        const some: Array<unknown> = []
        for (let at = start; at <= last[index]! && some.length < Wire.maxInputsPerMessage; at++) some.push(more.get(at))
        parts.push({ ...head, seat: about, start, inputs: some })
        start += some.length
      } while (start <= last[index]!)
    }
    changes.set(head.roster, parts)
    applyChange(parts[0]!, carried)
    if (ended !== undefined) return
    broadcastCopies(parts)
  }

  /** A save: this peer's match starts again from it, when it is in it. */
  const heardSync = (message: Wire.Sync): void => {
    const from = message.from
    if (from === seat || message.left[from] !== null) return
    // A newer epoch, or this one from a lower seat: two seats that both made a save settle on the lower seat's.
    if (!(message.epoch > epoch || (message.epoch === epoch && epoch > 0 && from < syncFrom))) return
    // A seat out of this peer's match makes saves of its own until it learns: only a later roster says it came back.
    if (out === undefined && gone[from] !== undefined && message.roster <= roster) return
    const why = message.left[seat]!
    if (why !== null) {
      // The save's match goes on without this seat.
      if (epoch > 0) {
        gone[seat] ??= { reason: why, lastInput: message.tick - 1, tick: message.tick }
        leaveMatch(why, `seat ${from}'s save is of a match without seat ${seat} (${why})`)
      }
      return
    }
    if (message.sessions[seat] !== sessionId) {
      // Before its first save, it may be one made before this session asked: it goes on asking. After it, another session has the seat.
      if (epoch > 0) end({ _tag: "Disconnected", who: "self", seat, reason: "restarted", detail: `the match has another session of seat ${seat} (another page took its place)` })
      return
    }
    applySync(message)
  }

  const receive = (message: Wire.Message, link: number): void => {
    const other = message.from
    if (other === seat) {
      // Another session says hello for this seat while this one plays: another page took its place.
      if (message.k === "hello" && message.session !== sessionId && epoch > 0 && out === undefined) {
        end({ _tag: "Disconnected", who: "self", seat, reason: "restarted", detail: `another session of seat ${seat} asks for its place (a reloaded page, another tab)` })
      }
      return
    }
    linkOf[other] = link
    // Out of the match: only a save that seats this session matters.
    if (out !== undefined) {
      if (message.k === "sync") heardSync(message)
      return
    }
    if (epoch > 0 && message.k === "hello") {
      const known = message.session === sessions[other]
      if (gone[other] !== undefined || !known) {
        // A session that is not in the match asks for its seat: the next save gives it, once the seat's earlier session is out.
        asking.set(other, { session: message.session, at: clock.now() })
        if (gone[other] === undefined) suspect(other, "restarted")
        else if (isHost()) pendingSync = true
        return
      }
      lastHeard[other] = clock.now()
      // In the match as this peer has it, and asking: it missed a save, or its own match went another way.
      if (message.epoch < epoch) resendSync(other)
      else if (isHost() && clock.now() - syncSentAt[other]! >= resendSyncEveryMS) {
        syncSentAt[other] = clock.now()
        pendingSync = true
      }
      return
    }
    // A ping of a session that is not the seat's in the match: its hellos ask, and nothing else of it counts.
    if (epoch > 0 && message.k === "ping" && message.session !== sessions[other]) return
    if (gone[other] !== undefined) {
      // It is out and plays on (it missed the change, or the save after it): tell it, so it asks for its seat. Its saves are of its own match, unless a later roster seats it.
      if (message.k === "inputs" && clock.now() - changeSentAt[other]! >= pingEveryMS) {
        changeSentAt[other] = clock.now()
        const left = gone[other]
        broadcast({ k: "out", from: seat, epoch, seat: other, why: left.reason, last: left.lastInput, tick: left.tick })
      } else if (message.k === "sync") heardSync(message)
      return
    }
    lastHeard[other] = clock.now()
    if (epoch === 0) beforeMatch(message)
    if (ended !== undefined) return
    if (message.epoch < epoch) resendSync(other)
    switch (message.k) {
      case "hello":
        return
      case "resync":
        if (isHost() && epoch > 0 && message.epoch === epoch) pendingSync = true
        return
      case "sync":
        heardSync(message)
        return
      case "inputs": {
        // Another epoch's: an older one's are replaced by the save, a newer one's wait for it.
        if (message.epoch !== epoch) return
        // Sent under a roster this peer has not reached: they wait for the change, so no tick is confirmed without it.
        if (message.roster > roster) return
        if (message.roster < roster) resendChanges(other, message.roster)
        takeAcks(other, message.acks)
        remoteNext[other] = { tick: message.next, at: clock.now() }
        takeInputs(other, message.start, message.inputs)
        return
      }
      case "sum": {
        // Of a roster this peer has not reached: it may count a seat out that this peer still runs.
        if (message.epoch !== epoch || message.tick < syncTick || message.roster > roster) return
        if (message.tick > localNext + furthestAhead) {
          tooFarAhead()
          return
        }
        let bySeat = remoteSums.get(message.tick)
        if (bySeat === undefined) remoteSums.set(message.tick, bySeat = new Map())
        bySeat.set(other, message.sum)
        compare(message.tick)
        return
      }
      case "ping":
        broadcast({ k: "pong", from: seat, epoch, to: other, at: message.at })
        Hidden.pinged(tracker, other, message.shown)
        if (isHost() && epoch > 0 && Hidden.returned(tracker, other)) pendingSync = true
        return
      case "hidden":
        heardHidden(message)
        return
      case "gone":
        heardGone(message)
        return
      case "left":
        heardLeft(message)
        return
      case "out":
        // The sender's match, as far on as this peer's or further, goes on without this seat.
        if (message.seat === seat && message.epoch >= epoch) {
          gone[seat] ??= { reason: message.why, lastInput: message.last, tick: message.tick }
          leaveMatch(message.why, `seat ${other}'s match goes on without seat ${seat} (${message.why})`)
        }
        return
      case "pong": {
        if (message.to !== seat) return
        const sample = Math.max(0, clock.now() - message.at)
        const previous = roundTrip[other]
        roundTrip[other] = previous === undefined ? sample : previous * 0.875 + sample * 0.125
        return
      }
    }
  }

  const readLinks = (): void => {
    let open = 0
    let closed: string | undefined
    for (let index = 0; index < options.links.length; index++) {
      if (linkClosed[index]) continue
      const link = options.links[index]!
      for (const text of link.receive()) {
        const parsed = Wire.parse(text, count)
        if (parsed._tag === "Malformed") dropped += 1
        else if (parsed._tag === "OtherVersion") end({ _tag: "ProtocolMismatch", version: parsed.version })
        else {
          dropped += parsed.malformed
          for (const message of parsed.messages) {
            receive(message, index)
            if (ended !== undefined) return
          }
        }
        if (ended !== undefined) return
      }
      const status = link.status()
      if (status._tag === "Open") {
        open += 1
        continue
      }
      linkClosed[index] = true
      closed = status.reason
      // Before the match no seat can be played around; in it, the seats this link carried are gone.
      if (epoch === 0) break
      for (let other = 0; other < count; other++) if (linkOf[other] === index) suspect(other, "closed")
    }
    if (closed !== undefined && (open === 0 || epoch === 0)) {
      end({ _tag: "Disconnected", who: "self", seat, reason: "closed", detail: closed })
      return
    }
    if (epoch === 0) {
      // A match runs and gave this session no seat: its earlier session is still in it, or nobody answers.
      if (matchSeenAt !== undefined && clock.now() - matchSeenAt > timeoutMS) {
        end({ _tag: "Disconnected", who: "self", seat, reason: "timeout", detail: `a match is running and did not seat this session for ${timeoutMS} ms` })
      }
      return
    }
    if (out !== undefined) {
      if (clock.now() - out.since > timeoutMS) {
        end({ _tag: "Disconnected", who: "self", seat, reason: out.why, detail: `the match went on without seat ${seat} (${out.why}) and did not seat it again for ${timeoutMS} ms` })
      }
      return
    }
    const now = clock.now()
    for (let other = 0; other < count; other++) {
      if (other === seat || gone[other] !== undefined || suspected[other] !== undefined) continue
      const limit = hiddenNow(other) ? timeoutMS + graceMS : timeoutMS
      if (now - lastHeard[other]! > limit) suspect(other, "timeout")
    }
  }

  const prune = (): void => {
    const done = confirmed()
    let acked = Infinity
    for (let other = 0; other < count; other++) if (other !== seat && gone[other] === undefined) acked = Math.min(acked, acks[other]![seat]!)
    // Inputs of ticks this peer has not run yet stay, and so does the last one before them: the guesses start from it.
    const base = Math.min(done, next - 1)
    for (let other = 0; other < count; other++) {
      const keepFrom = other === seat ? Math.min(base, acked + 1) : base
      for (const tick of inputs[other]!.keys()) if (tick < keepFrom) inputs[other]!.delete(tick)
      for (const tick of used[other]!.keys()) if (tick < base) used[other]!.delete(tick)
      if (other === seat) continue
      // Another seat's inputs stay, as carried, until every playing peer has them: if the seat goes, this peer may be the one that holds them.
      let held = base
      for (let peer = 0; peer < count; peer++) if (peer !== seat && peer !== other && plays(peer)) held = Math.min(held, acks[peer]![other]! + 1)
      // They arrive in order past the ones this peer has, so what it lets go is a run of ticks.
      for (let tick = rawFrom[other]!; tick < held; tick++) raw[other]!.delete(tick)
      if (held > rawFrom[other]!) rawFrom[other] = held
    }
    // This seat's own stay as sent from the tick it runs next: a save that seats a session carries them.
    for (const tick of sent.keys()) if (tick <= acked && tick < base) sent.delete(tick)
    for (const tick of history.keys()) if (tick < next - maxRollback - 1) history.delete(tick)
    // A seat that never answers a checksum does not keep the others' forever.
    for (const tick of sums.keys()) if (tick < done - every * 4) sums.delete(tick)
    for (const tick of remoteSums.keys()) if (tick < done - every * 4) remoteSums.delete(tick)
  }

  /** This seat's inputs not yet acknowledged by every seat it waits on, from `start`. */
  const inputsMessage = (): Wire.Inputs => {
    let acked = Infinity
    // A seat played around acknowledges nothing until its save: the others' inputs move on without it.
    for (let other = 0; other < count; other++) if (other !== seat && !playedAround(other)) acked = Math.min(acked, acks[other]![seat]!)
    const start = Math.max(floorTick, acked + 1)
    const payload: Array<unknown> = []
    for (let tick = start; tick < localNext && payload.length < Wire.maxInputsPerMessage; tick++) {
      const input = sent.get(tick)
      if (input === undefined) break
      payload.push(input)
    }
    return { k: "inputs", from: seat, epoch, roster, next, acks: contiguous.slice(), start, inputs: payload }
  }

  /** This seat's announcement of its latest spell: its inputs from the first one a seat it waits on has not acknowledged, up to `last`. */
  const announcement = (): ReadonlyArray<Wire.Hidden> => {
    const last = tracker.last[seat]!
    let acked = Infinity
    for (let other = 0; other < count; other++) if (other !== seat && !playedAround(other)) acked = Math.min(acked, acks[other]![seat]!)
    let start = Math.max(floorTick, Math.min(acked + 1, last + 1))
    const parts: Array<Wire.Hidden> = []
    do {
      const carried: Array<unknown> = []
      for (let tick = start; tick <= last && carried.length < Wire.maxInputsPerMessage; tick++) carried.push(sent.get(tick))
      parts.push({ k: "hidden", from: seat, epoch, roster, seat, n: tracker.hides[seat]!, last, away: tracker.away[seat]!, start, inputs: carried })
      start += carried.length
    } while (start <= last)
    return parts
  }

  /**
   * At the ping cadence: this seat's own spell while it is hidden or waits
   * for its save, and another seat's while it is hidden, so a hide reaches
   * every peer once one peer heard it.
   */
  const announce = (): void => {
    for (let other = 0; other < count; other++) {
      const parts = announcements[other]!
      if (parts.length === 0 || parts[0]!.n !== tracker.hides[other] || gone[other] !== undefined) continue
      if (other === seat) {
        if (Hidden.hidden(tracker, seat) || Hidden.away(tracker, seat)) for (const part of parts) broadcast(part)
      } else if (Hidden.hidden(tracker, other)) {
        for (const part of parts) broadcast({ ...part, from: seat })
      }
    }
  }

  const sendAll = (): void => {
    const now = clock.now()
    if (now - lastPing >= pingEveryMS) {
      lastPing = now
      // To the millisecond: a round trip needs no finer, and the digits would go out four times a second.
      broadcast({ k: "ping", from: seat, epoch, session: sessionId, at: Math.round(now), shown: tracker.shown[seat]! })
      announce()
      adapt()
    }
    const pinged = lastPing === now
    // Not in a match: this session asks for its seat.
    if (epoch === 0 || out !== undefined) {
      broadcast({ k: "hello", from: seat, epoch, session: sessionId })
      return
    }
    // The seats this peer stopped waiting for, until they are out: at once, then with every ping. A peer played around has no say.
    // A new report goes out with the next `copies` frames, then with every ping.
    if (reportNow) reportFrames = copies
    reportNow = false
    if (suspects > 0 && (reportFrames > 0 || pinged) && !Hidden.away(tracker, seat)) {
      for (let other = 0; other < count; other++) if (suspected[other] !== undefined) for (const part of reportOn(other)) broadcast(part)
    }
    if (reportFrames > 0) reportFrames -= 1
    if (wantSync && now - lastResyncAsk >= pingEveryMS) {
      lastResyncAsk = now
      broadcast({ k: "resync", from: seat, epoch })
    }
    broadcast(inputsMessage())
    // A checksum is final once every input before its tick is real. A seat played around sends none: its world goes on with its own input, and the save it waits for replaces it.
    const done = confirmed()
    if (!Hidden.away(tracker, seat)) for (const [tick, { sum }] of sums) {
      if (sentSums.has(tick) || tick - 1 > done) continue
      sentSums.add(tick)
      broadcast({ k: "sum", from: seat, epoch, roster, tick, sum })
      compare(tick)
    }
    prune()
  }

  const correct = (): void => {
    if (wrong === undefined) return
    const from = wrong
    wrong = undefined
    if (from >= next) return
    const checkpoint = history.get(from)
    const rewound = checkpoint === undefined
      ? Result.failure<Checkpoint.RewindError>({ _tag: "Released", reason: "window" })
      : runtime.rewind(checkpoint)
    if (!rewound.ok) {
      halted ??= { _tag: "CheckpointLost", error: rewound.error }
      return
    }
    // The rewind released every checkpoint newer than `from` and kept this one: the ticks run again take theirs.
    for (const tick of history.keys()) if (tick > from) history.delete(tick)
    for (const ledger of ledgers.values()) ledger.rewind(from)
    const present = next
    next = from
    rollbacks += 1
    again += runUpTo(present)
    for (const ledger of ledgers.values()) ledger.resolve()
  }

  /** One measurement for the delay policy, at the ping cadence: the round trip to the slowest other seat. */
  const adapt = (): void => {
    let slowest = 0
    for (let other = 0; other < count; other++) {
      if (other === seat || gone[other] !== undefined) continue
      const measured = roundTrip[other]
      if (measured === undefined) return
      slowest = Math.max(slowest, measured)
    }
    const before = policy.delay()
    const changed = policy.measure(slowest)
    if (changed !== undefined) raised += Math.max(0, changed - before)
  }

  /** Records `local` for the tick `inputDelay` ahead, and returns that tick (`undefined`: already that far ahead). */
  const record = (local: Sent): number | undefined => {
    const delay = policy.delay()
    if (localNext > next + delay) return undefined
    // After a rise, the ticks between the old delay and the new one get no input from this seat: idle, as after a save.
    const skipped = Math.min(raised, next + delay - localNext)
    raised = 0
    for (let index = 0; index < skipped; index++) {
      inputs[seat]!.set(localNext, idle)
      sent.set(localNext, idleSent.wire)
      localNext += 1
    }
    const tick = localNext
    inputs[seat]!.set(tick, local.value)
    sent.set(tick, local.wire)
    extend(seat)
    localNext += 1
    return tick
  }

  const ahead = (): number => {
    const now = clock.now()
    let slowest = Infinity
    for (let other = 0; other < count; other++) {
      if (other === seat || playedAround(other)) continue
      const known = remoteNext[other]
      if (known === undefined) return 0
      const oneWay = (roundTrip[other] ?? 0) / 2
      slowest = Math.min(slowest, known.tick + (now - known.at + oneWay) / stepMS)
    }
    return slowest === Infinity ? 0 : next - slowest
  }

  /**
   * After an `advance` that ran nothing: the seat whose input this peer
   * cannot run past, and that tick. Rollback waits for the seat furthest
   * behind once `maxRollback` ticks past it; lockstep for any seat without
   * input for `next`.
   */
  const noteWaiting = (waitedOn: number): void => {
    let other = -1
    let tick = -1
    if (mode === "rollback") {
      let lowest = Infinity
      for (let at = 0; at < count; at++) {
        if (at !== seat && !filled(at) && contiguous[at]! < lowest) {
          lowest = contiguous[at]!
          other = at
        }
      }
      if (next <= lowest + maxRollback) other = -1
      tick = lowest + 1
    } else {
      for (let at = 0; at < count && other === -1; at++) {
        if (at !== seat && !inputs[at]!.has(next) && !(filled(at) && next > tracker.last[at]!)) other = at
      }
      tick = next
    }
    if (other === -1) return
    if (other !== waitedOn || tick !== waitingTick) waitingSince = clock.now()
    waitingSeat = other
    waitingTick = tick
  }

  /** Whether this frame's bundle is open: a step of the frame ran, and its last one has not. */
  let inFrame = false

  /**
   * One step of a frame: `last` is false while more steps of the same frame
   * follow, and what the step says waits for the frame's bundle.
   */
  const advanceStep = (pressed: unknown, last: boolean): Result.Result<Advanced, SessionError<unknown>> => {
    if (!inFrame) {
      inFrame = true
      sayRepeats()
    }
    const advanced = advanceOnce(pressed)
    if (last) {
      inFrame = false
      flush()
    }
    return advanced
  }

  const advance = (pressed: unknown): Result.Result<Advanced, SessionError<unknown>> => advanceStep(pressed, true)

  const advanceOnce = (pressed: unknown): Result.Result<Advanced, SessionError<unknown>> => {
    const waitedOn = waitingSeat
    waitingSeat = -1
    if (ended !== undefined) return Result.failure(ended)
    // This peer simulates what every other peer will: the input as it decodes from its message.
    const sentInput = send(codec, pressed)
    if (!sentInput.ok) throw new Error(`Netcode: the local input ${sentInput.error}`)
    const local = sentInput.value
    // This page ran nothing for a while (a hitch, a frozen tab): the others' silence was not theirs, and their reports of this seat are fair.
    const now = clock.now()
    if (epoch > 0 && now - lastAdvance > timeoutMS / 2) {
      lastHeard.fill(now)
      excusedUntil = now + timeoutMS
    }
    lastAdvance = now
    // Read before correct() and performSync(): the ticks they run again are this advance's too
    const before = again
    readLinks()
    if (ended !== undefined) return Result.failure(ended)
    // Out of the match: wait for a save that seats this session again.
    if (out !== undefined) {
      sendAll()
      return Result.success({ _tag: "Waiting" })
    }
    decide()
    if (ended !== undefined) return Result.failure(ended)
    lookAway()
    if (epoch === 0) {
      if (seat === 0 && sessions.every((known) => known !== undefined)) performSync()
      if (ended !== undefined) return Result.failure(ended)
      if (epoch === 0) {
        sendAll()
        return Result.success({ _tag: "Waiting" })
      }
    }
    // Played around: wait for the save that answers this seat's return.
    if (Hidden.away(tracker, seat)) {
      // No seat plays that could make it: the ones that did are gone.
      if (decider() === -1) {
        let lost = -1
        for (let other = count - 1; other >= 0; other--) if (other !== seat && (suspected[other] !== undefined || gone[other] !== undefined)) lost = other
        if (lost !== -1) {
          const why = suspected[lost] ?? gone[lost]!.reason
          end({ _tag: "Disconnected", who: "others", seat: lost, reason: why, detail: `seat ${lost} is gone (${why}), and no seat plays that could make the save seat ${seat} waits for` })
          return Result.failure(ended!)
        }
      }
      sendAll()
      return Result.success({ _tag: "Waiting" })
    }
    if (isHost() && (pendingSync || wantSync)) performSync()
    if (ended !== undefined) return Result.failure(ended)
    if (halted === undefined && mode === "rollback") correct()
    if (halted !== undefined) {
      sendAll()
      return Result.failure(halted)
    }
    let ran = 0
    let input: number | undefined
    if (mode === "rollback") {
      if (next <= confirmed() + maxRollback) {
        input = record(local)
        ran = runUpTo(next + 1)
      }
    } else {
      input = record(local)
      ran = runUpTo(localNext)
    }
    sendAll()
    if (ended !== undefined) return Result.failure(ended)
    if (halted !== undefined) return Result.failure(halted)
    settle()
    const ranAgain = again - before
    if (ran === 0 && ranAgain === 0) {
      noteWaiting(waitedOn)
      return Result.success({ _tag: "Stalled", input })
    }
    return Result.success({ _tag: "Ran", tick: next, ticks: ran + ranAgain, again: ranAgain, input })
  }

  const session: Session<unknown, unknown, Descriptor<"event", string, any>> = {
    advance,
    resync: () => {
      if (ended !== undefined || epoch === 0) return
      if (isHost()) pendingSync = true
      else wantSync = true
    },
    drop: (other) => {
      if (!Number.isSafeInteger(other) || other < 0 || other >= count || other === seat) {
        throw new Error(`Netcode: drop(${other}) names no other seat of this match: give another seat's number, 0 to ${count - 1}, not this session's own (${seat})`)
      }
      if (ended === undefined) suspect(other, "dropped")
    },
    rate: () => {
      const lead = ahead()
      return lead <= 1 ? 1 : Math.max(slowestRate, 1 - (lead - 1) * 0.02)
    },
    update: (step) => {
      // One report per halt: the session stays halted until the resync's save arrives.
      let reported = false
      return (_stepSeconds, at) => {
        const advanced = advanceStep(step.input(), at.last)
        if (advanced.ok) {
          reported = false
          return Result.success(undefined)
        }
        const error = advanced.error
        if (!isHalted(error)) return Result.failure(error)
        if (!reported) {
          reported = true
          step.onHalted(error)
          session.resync()
        }
        return Result.success(undefined)
      }
    },
    status: (): Status => ({
      epoch,
      tick: next,
      confirmed: confirmed() + 1,
      verified,
      again,
      rollbacks,
      dropped,
      ahead: ahead(),
      inputDelay: policy.delay(),
      delayChanges: policy.changes(),
      roundTripMS: roundTrip.map((value, other) => other === seat ? 0 : value),
      hidden: tracker.hides.map((_, other) => gone[other] === undefined && hiddenNow(other)),
      left: gone.slice(),
      waiting: waitingSeat === -1 ? undefined : { seat: waitingSeat, tick: waitingTick, forMS: Math.max(0, clock.now() - waitingSince) },
      sent: { messages: sentMessages, bytes: sentBytes }
    }),
    events: (descriptor) => {
      let ledger = ledgers.get(descriptor)
      // A peer ahead of the host settles up to the host's own inputs, which reach `saveDelay` past the tick it saves at: a resync runs that tick and the `saveDelay` after it again (`resyncReach`).
      if (ledger === undefined) ledgers.set(descriptor, ledger = Events.make({ schema: runtime.schema, inspect: runtime.inspect, settled: () => settled, resyncReach: saveDelay + 1 }, descriptor))
      return ledger.reader(next) as never
    }
  }

  if (hiddenOptions !== undefined) {
    const visibility = hiddenOptions.visibility
    const resyncs = hiddenOptions.then === "resync-on-return"
    const hide = (): void => {
      // Every input recorded is real: the announcement carries those the others may not have, since this page may send nothing more.
      // The host is never played around: the saves are its world.
      Hidden.hide(tracker, seat, localNext - 1, resyncs && hostSeat() !== seat)
      announcements[seat] = announcement()
    }
    if (visibility.hidden()) hide()
    unsubscribe = visibility.subscribe((nowHidden) => {
      if (ended !== undefined || nowHidden === Hidden.hidden(tracker, seat)) return
      if (nowHidden) {
        hide()
        // Now, and more than once: a hidden page's frames stop, so these may be its last messages for a while.
        // Each copy is a bundle of its own: no frame follows to carry the next.
        for (let copy = 0; copy < copies; copy++) {
          for (const part of announcements[seat]!) broadcast(part)
          flush()
        }
        return
      }
      Hidden.show(tracker, seat)
      // This peer read nothing while hidden: the others' silence does not count, and they hear at once that it is back.
      lastHeard.fill(clock.now())
      lastPing = -Infinity
    })
  }
  return Result.success(session)
}
