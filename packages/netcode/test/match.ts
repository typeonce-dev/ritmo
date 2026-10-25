/**
 * Plays a match between peers in one process over memory links, frame by
 * frame on one test clock, and the reference every peer must agree with:
 * one runtime ticked with the input each seat's session recorded.
 */
import { Clock, HostClock } from "@typeonce/ritmo"
import { MemoryNetworkLink, Netcode } from "@typeonce/ritmo-netcode"

import { Fired, Game, idle, makePeer, pressed, Seats, simulate, step, type Peer, type PlayerInput } from "./game.ts"

export interface MatchOptions {
  readonly mode: "rollback" | "lockstep"
  readonly count?: number
  readonly seed?: number
  readonly latencyMS?: number
  readonly jitterMS?: number
  readonly loss?: number
  readonly inputDelay?: number
  readonly adaptiveDelay?: Netcode.AdaptiveDelay
  readonly maxRollback?: number
  /** Frames each seat presses input on; idle afterwards. */
  readonly frames?: number
  /** Idle frames played after `frames`, so every guess settles. */
  readonly tail?: number
  /** How many frames late each seat starts calling `advance`. */
  readonly lateBy?: ReadonlyArray<number>
}

export interface MatchPeer extends Peer {
  readonly session: Netcode.Session<PlayerInput, unknown, typeof Fired>
  /** The input this seat's session recorded, by tick. */
  readonly recorded: Map<number, PlayerInput>
  readonly results: Array<Netcode.Advanced>
}

export const stepMS = step.dt * 1000

export const setUpMatch = (options: MatchOptions) => {
  const count = options.count ?? 2
  const hostClock = HostClock.test()
  const links = MemoryNetworkLink.make({
    peers: count,
    hostClock,
    seed: options.seed ?? 7,
    latencyMS: options.latencyMS ?? 50,
    jitterMS: options.jitterMS ?? 30,
    loss: options.loss ?? 0
  })
  if (!links.ok) throw new Error(links.error.field)
  const peers: Array<MatchPeer> = Array.from({ length: count }, (_, seat) => {
    const peer = makePeer({ count, setUp: seat === 0 })
    const shared = {
      seats: peer.seats,
      seat,
      links: [links.value[seat]!],
      hostClock,
      step,
      ...(options.adaptiveDelay !== undefined
        ? { adaptiveDelay: options.adaptiveDelay }
        : options.inputDelay === undefined ? {} : { inputDelay: options.inputDelay })
    }
    const session = options.mode === "rollback"
      ? Netcode.rollback(peer.runtime, { ...shared, simulate, ...(options.maxRollback === undefined ? {} : { maxRollback: options.maxRollback }) })
      : Netcode.lockstep(peer.runtime, { ...shared, simulate })
    if (!session.ok) throw new Error(session.error.reason)
    return { ...peer, session: session.value, recorded: new Map(), results: [] }
  })
  return { hostClock, links: links.value, peers }
}

/** One frame: every seat advances with its input, then the clock moves one step. */
export const frame = (
  match: ReturnType<typeof setUpMatch>,
  at: number,
  input: (seat: number) => PlayerInput,
  skip: (seat: number) => boolean = () => false
): void => {
  for (const [seat, peer] of match.peers.entries()) {
    if (skip(seat)) continue
    const local = input(seat)
    const advanced = peer.session.advance(local)
    if (!advanced.ok) throw new Error(`seat ${seat} at frame ${at}: ${JSON.stringify(advanced.error)}`)
    peer.results.push(advanced.value)
    if (advanced.value._tag !== "Waiting" && advanced.value.input !== undefined) peer.recorded.set(advanced.value.input, local)
  }
  const moved = match.hostClock.adjust(stepMS)
  if (!moved.ok) throw new Error("the test clock did not move")
}

/** Plays `frames` frames of pressed input and `tail` idle frames. */
export const play = (options: MatchOptions) => {
  const match = setUpMatch(options)
  const frames = options.frames ?? 240
  const tail = options.tail ?? 90
  const lateBy = options.lateBy ?? []
  for (let at = 0; at < frames + tail; at++) {
    frame(match, at, (seat) => at < frames ? pressed(seat, at) : idle, (seat) => at < (lateBy[seat] ?? 0))
  }
  return match
}

const ReadFired = Game.Inspector("NetTest/ReadFired", { events: { fired: Game.System.readEvent(Fired) } }, ({ events }) => events.fired.all())

/**
 * One runtime that knew every input: the setup, the save every peer
 * restored at tick 0, then each tick with the input each seat's session
 * recorded (idle otherwise). `sums` is the checksum at the start of each
 * tick, `fired` every `Fired` event with the tick that published it.
 */
export const reference = (peers: ReadonlyArray<MatchPeer>, ticks: number) => {
  const count = peers.length
  let current: ReadonlyArray<PlayerInput> = Array.from({ length: count }, () => idle)
  const source: Netcode.Source<PlayerInput> = { snapshot: () => current }
  const made = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(Seats, source)),
    resources: { Total: 0, Time: Clock.start(step), Inputs: [idle, idle], Drift: 0 }
  })
  if (!made.ok) throw new Error("the reference runtime did not start")
  const runtime = made.value
  const reference = makePeer({ count })
  // The same start as the peers: seat 0's set-up world, saved and restored.
  const saved = reference.runtime.snapshot()
  if (!saved.ok || !runtime.restore(JSON.parse(JSON.stringify(saved.value))).ok) throw new Error("the reference could not restore the start")
  const sums: Array<string> = []
  const fired: Array<{ readonly tick: number; readonly value: { readonly seat: number; readonly x: number } }> = []
  for (let tick = 0; tick <= ticks; tick++) {
    const sum = runtime.checksum()
    if (!sum.ok) throw new Error("the reference did not checksum")
    sums.push(sum.value)
    current = peers.map((peer) => peer.recorded.get(tick) ?? idle)
    const ran = runtime.tick(simulate)
    if (!ran.ok) throw new Error("the reference failed a tick")
    for (const value of runtime.inspect(ReadFired)) fired.push({ tick, value })
  }
  return { sums, fired }
}

/** The checksum at the start of each tick of the {@link reference} runtime. */
export const truth = (peers: ReadonlyArray<MatchPeer>, ticks: number): ReadonlyArray<string> => reference(peers, ticks).sums

export const checksumOf = (peer: Peer): string => {
  const sum = peer.runtime.checksum()
  if (!sum.ok) throw new Error("the peer did not checksum")
  return sum.value
}
