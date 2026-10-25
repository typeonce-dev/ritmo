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
 * Hidden pages (`hidden.ts`): a seat played around has idle input after its
 * last sent one, on every peer, and counts as confirmed once that input
 * arrived; the others play on without waiting for it.
 */
import type { HostClock } from "@typeonce/ritmo"
import type * as Checkpoint from "@typeonce/ritmo/Checkpoint"
import type * as Clock from "@typeonce/ritmo/Clock"
import type { Descriptor } from "@typeonce/ritmo/Descriptor"
import * as Result from "@typeonce/ritmo/Result"
import type * as Snapshot from "@typeonce/ritmo/Snapshot"

import type { AdaptiveDelay, Advanced, Ended, Halted, HiddenOptions, InvalidOptions, Seats, Session, SessionError, Status } from "../Netcode.ts"
import * as Delay from "./delay.ts"
import * as Events from "./events.ts"
import { isHalted } from "./halted.ts"
import * as Hidden from "./hidden.ts"
import type { NetworkLink } from "../NetworkLink.ts"
import { canonical, decode, encode, stateOf } from "./seats.ts"
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

/** Most inputs one message carries: a peer far behind catches up over several frames. */
const maxInputsPerMessage = 64
const pingEveryMS = 250
const resendSyncEveryMS = 500
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
  const idle = options.seats.idle
  const predict = options.predict ?? ((previous: unknown) => previous)
  const clock = options.hostClock
  const stepMS = options.step.dt * 1000
  const host = seat === 0
  const keyOf = (value: unknown): string => {
    const encoded = encode(codec, value)
    return encoded.ok ? canonical(encoded.value) : `unencodable:${canonical(value)}`
  }
  const idleKey = keyOf(idle)
  const encodeLocal = (value: unknown): unknown => {
    const encoded = encode(codec, value)
    if (!encoded.ok) throw new Error(`Netcode: the local input does not encode with the input schema: ${encoded.error}`)
    return encoded.value
  }

  // Match state.
  let epoch = 0
  let syncTick = 0
  /** Inputs for ticks before this one are fixed by the last save. */
  let floorTick = 0
  let next = 0
  let localNext = 0
  const inputs: Array<Map<number, unknown>> = Array.from({ length: count }, () => new Map())
  /** This seat's inputs in their saved form, to send. */
  const sent = new Map<number, unknown>()
  const contiguous: Array<number> = Array.from({ length: count }, () => -1)
  /** Per seat, the key of the input each tick ran with. */
  const used: Array<Map<number, string>> = Array.from({ length: count }, () => new Map())
  let wrong: number | undefined
  /** Ticks a rise of the delay skipped, filled idle by the next `record`. */
  let raised = 0
  const history = new Map<number, Checkpoint.Checkpoint>()

  // Checksums.
  const sums = new Map<number, { readonly sum: string; readonly snapshot: Snapshot.WorldSnapshot | undefined }>()
  const sentSums = new Set<number>()
  const remoteSums = new Map<number, Map<number, string>>()

  // Peers.
  const heard = new Set<number>()
  const lastHeard: Array<number> = Array.from({ length: count }, () => clock.now())
  const acks: Array<ReadonlyArray<number>> = Array.from({ length: count }, () => Array.from({ length: count }, () => -1))
  const remoteNext: Array<{ readonly tick: number; readonly at: number } | undefined> = Array.from({ length: count }, () => undefined)
  const roundTrip: Array<number | undefined> = Array.from({ length: count }, () => undefined)
  const syncSentAt: Array<number> = Array.from({ length: count }, () => -Infinity)
  let lastPing = -Infinity
  let lastResyncAsk = -Infinity
  let syncMessage: Wire.Sync | undefined
  let pendingSync = false
  let wantSync = false

  // Outcomes.
  let ended: Ended | undefined
  let halted: Halted<unknown> | undefined
  let verified = -1
  let rollbacks = 0
  let again = 0
  let dropped = 0

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
  let unsubscribe: (() => void) | undefined

  const broadcast = (message: Wire.Message): void => {
    const text = Wire.write(message)
    for (const link of options.links) link.send(text)
  }

  /** Another seat this peer plays around: its input after `tracker.last` is idle. */
  const playedAround = (other: number): boolean => other !== seat && Hidden.away(tracker, other)

  /** A seat played around whose real input all arrived: nothing more to wait for. */
  const filled = (other: number): boolean => playedAround(other) && contiguous[other]! >= tracker.last[other]!

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
    if (tick > tracker.last[other]! && playedAround(other)) return idle
    const known = inputs[other]!.get(tick)
    return known !== undefined ? known : guess(other, tick)
  }

  /** Real input for a tick that ran: the earliest tick whose input now differs from the one it ran with is wrong. */
  const confirmRemote = (other: number, tick: number, input: unknown): void => {
    const known = inputs[other]!
    // Known already: confirmed (a save confirms the ticks before its floor), or out of order.
    if (tick <= contiguous[other]! || known.has(tick)) return
    // Played around: idle after its last input, whatever arrives.
    if (tick > tracker.last[other]! && playedAround(other)) return
    known.set(tick, input)
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

  /** Rollback: a seat now played around ran ticks after its last input with a guess that was not idle. */
  const lookAway = (): void => {
    for (let other = 0; other < count; other++) {
      const now = playedAround(other)
      if (now && !wasAway[other] && mode === "rollback") {
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
    if (mode === "rollback") history.set(tick, runtime.checkpoint(options.simulate))
    const current: Array<unknown> = []
    for (let other = 0; other < count; other++) {
      const input = inputFor(other, tick)
      current.push(input)
      if (other !== seat) used[other]!.set(tick, keyOf(input))
    }
    seatsState.current = current
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

  /** Restores a save every peer restores at `tick`, and runs again up to where this peer was. */
  const applySync = (newEpoch: number, tick: number, save: unknown, returned: ReadonlyArray<number>): void => {
    const restored = runtime.restore(save)
    if (!restored.ok) {
      end({ _tag: "SyncFailed", error: restored.error })
      return
    }
    const previous = next
    // Every unsettled tick is gone: the save replaces them.
    for (const ledger of ledgers.values()) ledger.reset()
    epoch = newEpoch
    syncTick = tick
    floorTick = tick + saveDelay
    next = tick
    history.clear()
    wrong = undefined
    halted = undefined
    wantSync = false
    sums.clear()
    sentSums.clear()
    remoteSums.clear()
    verified = -1
    const now = clock.now()
    for (let other = 0; other < count; other++) {
      for (let at = tick; at < floorTick; at++) inputs[other]!.set(at, idle)
      used[other]!.clear()
      contiguous[other] = Math.max(contiguous[other]!, floorTick - 1)
      extend(other)
      lastHeard[other] = now
    }
    for (let at = tick; at < floorTick; at++) sent.set(at, encodeLocal(idle))
    localNext = Math.max(localNext, floorTick)
    Hidden.synced(tracker, returned, floorTick)
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
    syncMessage = { k: "sync", from: seat, epoch: epoch + 1, tick: next, save, returned: tracker.shown.slice() }
    applySync(syncMessage.epoch, syncMessage.tick, save, syncMessage.returned)
    broadcast(syncMessage)
    syncSentAt.fill(clock.now())
  }

  const resendSync = (other: number): void => {
    if (!host || syncMessage === undefined) return
    const now = clock.now()
    if (now - syncSentAt[other]! < resendSyncEveryMS) return
    syncSentAt[other] = now
    broadcast(syncMessage)
  }

  const receive = (message: Wire.Message): void => {
    const other = message.from
    if (other === seat) return
    heard.add(other)
    lastHeard[other] = clock.now()
    if (host && message.epoch < epoch) resendSync(other)
    switch (message.k) {
      case "hello":
        return
      case "resync":
        if (host && epoch > 0 && message.epoch === epoch) pendingSync = true
        return
      case "sync":
        if (other === 0 && message.epoch > epoch) applySync(message.epoch, message.tick, message.save, message.returned)
        return
      case "inputs": {
        acks[other] = message.acks
        remoteNext[other] = { tick: message.next, at: clock.now() }
        for (let index = 0; index < message.inputs.length; index++) {
          const tick = message.start + index
          if (tick <= contiguous[other]! || inputs[other]!.has(tick)) continue
          const decoded = decode(codec, message.inputs[index])
          if (!decoded.ok) {
            dropped += 1
            return
          }
          confirmRemote(other, tick, decoded.value)
        }
        return
      }
      case "sum": {
        if (message.epoch !== epoch || message.tick < syncTick) return
        let bySeat = remoteSums.get(message.tick)
        if (bySeat === undefined) remoteSums.set(message.tick, bySeat = new Map())
        bySeat.set(other, message.sum)
        compare(message.tick)
        return
      }
      case "ping":
        broadcast({ k: "pong", from: seat, epoch, to: other, at: message.at })
        Hidden.pinged(tracker, other, message.shown)
        if (host && epoch > 0 && Hidden.returned(tracker, other)) pendingSync = true
        return
      case "hidden":
        Hidden.announced(tracker, message, floorTick)
        if (host && epoch > 0 && Hidden.returned(tracker, other)) pendingSync = true
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
    for (const link of options.links) {
      for (const text of link.receive()) {
        const parsed = Wire.parse(text, count)
        if (parsed._tag === "Malformed") dropped += 1
        else if (parsed._tag === "OtherVersion") end({ _tag: "ProtocolMismatch", version: parsed.version })
        else receive(parsed.message)
        if (ended !== undefined) return
      }
      const status = link.status()
      if (status._tag === "Closed") {
        end({ _tag: "Disconnected", seat: undefined, reason: "closed", detail: status.reason })
        return
      }
    }
    if (epoch === 0) return
    const now = clock.now()
    for (let other = 0; other < count; other++) {
      if (other === seat) continue
      const limit = Hidden.hidden(tracker, other) ? timeoutMS + graceMS : timeoutMS
      if (now - lastHeard[other]! > limit) {
        const what = limit === timeoutMS ? "sent nothing" : "hid and sent nothing"
        end({ _tag: "Disconnected", seat: other, reason: "timeout", detail: `seat ${other} ${what} for ${limit} ms` })
        return
      }
    }
  }

  const prune = (): void => {
    const done = confirmed()
    let acked = Infinity
    for (let other = 0; other < count; other++) if (other !== seat) acked = Math.min(acked, acks[other]![seat]!)
    // Inputs of ticks this peer has not run yet stay, and so does the last one before them: the guesses start from it.
    const base = Math.min(done, next - 1)
    for (let other = 0; other < count; other++) {
      const keepFrom = other === seat ? Math.min(base, acked + 1) : base
      for (const tick of inputs[other]!.keys()) if (tick < keepFrom) inputs[other]!.delete(tick)
      for (const tick of used[other]!.keys()) if (tick < base) used[other]!.delete(tick)
    }
    for (const tick of sent.keys()) if (tick <= acked) sent.delete(tick)
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
    for (let tick = start; tick < localNext && payload.length < maxInputsPerMessage; tick++) {
      const input = sent.get(tick)
      if (input === undefined) break
      payload.push(input)
    }
    return { k: "inputs", from: seat, epoch, next, acks: contiguous.slice(), start, inputs: payload }
  }

  const sendAll = (): void => {
    const now = clock.now()
    if (now - lastPing >= pingEveryMS) {
      lastPing = now
      broadcast({ k: "ping", from: seat, epoch, at: now, shown: tracker.shown[seat]! })
      // Repeated: the announcement may have been lost, and seat 0 needs it to answer the return.
      if (Hidden.hidden(tracker, seat) || Hidden.away(tracker, seat)) broadcast(Hidden.message(tracker, seat, epoch))
      adapt()
    }
    if (epoch === 0) {
      broadcast({ k: "hello", from: seat, epoch })
      return
    }
    if (wantSync && now - lastResyncAsk >= pingEveryMS) {
      lastResyncAsk = now
      broadcast({ k: "resync", from: seat, epoch })
    }
    broadcast(inputsMessage())
    // A checksum is final once every input before its tick is real.
    const done = confirmed()
    for (const [tick, { sum }] of sums) {
      if (sentSums.has(tick) || tick - 1 > done) continue
      sentSums.add(tick)
      broadcast({ k: "sum", from: seat, epoch, tick, sum })
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
      if (other === seat) continue
      const measured = roundTrip[other]
      if (measured === undefined) return
      slowest = Math.max(slowest, measured)
    }
    const before = policy.delay()
    const changed = policy.measure(slowest)
    if (changed !== undefined) raised += Math.max(0, changed - before)
  }

  /** Records `local` for the tick `inputDelay` ahead, and returns that tick (`undefined`: already that far ahead). */
  const record = (local: unknown): number | undefined => {
    const delay = policy.delay()
    if (localNext > next + delay) return undefined
    // After a rise, the ticks between the old delay and the new one get no input from this seat: idle, as after a save.
    const skipped = Math.min(raised, next + delay - localNext)
    raised = 0
    for (let index = 0; index < skipped; index++) {
      inputs[seat]!.set(localNext, idle)
      sent.set(localNext, encodeLocal(idle))
      localNext += 1
    }
    const tick = localNext
    inputs[seat]!.set(tick, local)
    sent.set(tick, encodeLocal(local))
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

  const advance = (local: unknown): Result.Result<Advanced, SessionError<unknown>> => {
    if (ended !== undefined) return Result.failure(ended)
    readLinks()
    if (ended !== undefined) return Result.failure(ended)
    lookAway()
    if (epoch === 0) {
      if (host && heard.size === count - 1) performSync()
      if (ended !== undefined) return Result.failure(ended)
      if (epoch === 0) {
        sendAll()
        return Result.success({ _tag: "Waiting" })
      }
    }
    // Played around: wait for the save that answers this seat's return.
    if (Hidden.away(tracker, seat)) {
      sendAll()
      return Result.success({ _tag: "Waiting" })
    }
    if (host && pendingSync) performSync()
    if (ended !== undefined) return Result.failure(ended)
    if (halted === undefined && mode === "rollback") correct()
    if (halted !== undefined) {
      sendAll()
      return Result.failure(halted)
    }
    const before = again
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
    return ran === 0 && ranAgain === 0
      ? Result.success({ _tag: "Stalled", input })
      : Result.success({ _tag: "Ran", tick: next, ticks: ran + ranAgain, again: ranAgain, input })
  }

  const session: Session<unknown, unknown, Descriptor<"event", string, any>> = {
    advance,
    resync: () => {
      if (ended !== undefined || epoch === 0) return
      if (host) pendingSync = true
      else wantSync = true
    },
    rate: () => {
      const lead = ahead()
      return lead <= 1 ? 1 : Math.max(slowestRate, 1 - (lead - 1) * 0.02)
    },
    update: (step) => {
      // One report per halt: the session stays halted until the resync's save arrives.
      let reported = false
      return () => {
        const advanced = advance(step.input())
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
      hidden: tracker.hides.map((_, other) => Hidden.hidden(tracker, other))
    }),
    events: (descriptor) => {
      let ledger = ledgers.get(descriptor)
      if (ledger === undefined) ledgers.set(descriptor, ledger = Events.make({ schema: runtime.schema, inspect: runtime.inspect, settled: () => settled }, descriptor))
      return ledger.reader(next) as never
    }
  }

  if (hiddenOptions !== undefined) {
    const visibility = hiddenOptions.visibility
    const resyncs = hiddenOptions.then === "resync-on-return"
    const hide = (): void => {
      // What the others have not acknowledged goes out first: the announcement says where this seat's input ends.
      let last = localNext - 1
      if (epoch > 0) {
        const message = inputsMessage()
        broadcast(message)
        last = message.start + message.inputs.length - 1
      }
      Hidden.hide(tracker, seat, last, resyncs)
    }
    if (visibility.hidden()) hide()
    unsubscribe = visibility.subscribe((nowHidden) => {
      if (ended !== undefined || nowHidden === Hidden.hidden(tracker, seat)) return
      if (nowHidden) {
        hide()
        // Now: a hidden page's frames stop, so this may be the last message for a while.
        broadcast(Hidden.message(tracker, seat, epoch))
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
