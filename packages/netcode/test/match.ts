/**
 * Plays a match between peers in one process over memory links, frame by
 * frame on one test clock, and the reference every peer must agree with:
 * one runtime ticked with the input each seat's session recorded.
 */
import { Clock, HostClock } from "@typeonce/ritmo"
import { MemoryNetworkLink, MemoryVisibility, Netcode } from "@typeonce/ritmo-netcode"

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
  /** The runtime's checkpoint window (the runtime's default when omitted). */
  readonly checkpoints?: number
  /** Frames each seat presses input on; idle afterwards. */
  readonly frames?: number
  /** Idle frames played after `frames`, so every guess settles. */
  readonly tail?: number
  /** How many frames late each seat starts calling `advance`. */
  readonly lateBy?: ReadonlyArray<number>
  readonly checksumEvery?: number
  readonly timeoutMS?: number
  /** The `hidden` option of every peer, on its own page (`peer.visibility`). */
  readonly hidden?: { readonly afterMS: number; readonly then: Netcode.HiddenPolicy }
}

export interface MatchPeer extends Peer {
  readonly session: Netcode.Session<PlayerInput, unknown, typeof Fired>
  /** The input this seat's session recorded, by tick. */
  readonly recorded: Map<number, PlayerInput>
  readonly results: Array<Netcode.Advanced>
  /** This peer's page: hidden only when the test hides it. */
  readonly visibility: MemoryVisibility.MemoryVisibility
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
    const peer = makePeer({ count, setUp: seat === 0, ...(options.checkpoints === undefined ? {} : { checkpoints: options.checkpoints }) })
    const visibility = MemoryVisibility.make()
    const shared = {
      seats: peer.seats,
      seat,
      links: [links.value[seat]!],
      hostClock,
      step,
      ...(options.adaptiveDelay !== undefined
        ? { adaptiveDelay: options.adaptiveDelay }
        : options.inputDelay === undefined ? {} : { inputDelay: options.inputDelay }),
      ...(options.checksumEvery === undefined ? {} : { checksumEvery: options.checksumEvery }),
      ...(options.timeoutMS === undefined ? {} : { timeoutMS: options.timeoutMS }),
      ...(options.hidden === undefined ? {} : { hidden: { visibility, ...options.hidden } })
    }
    const session = options.mode === "rollback"
      ? Netcode.rollback(peer.runtime, { ...shared, simulate, ...(options.maxRollback === undefined ? {} : { maxRollback: options.maxRollback }) })
      : Netcode.lockstep(peer.runtime, { ...shared, simulate })
    if (!session.ok) throw new Error(session.error.reason)
    return { ...peer, session: session.value, recorded: new Map(), results: [], visibility }
  })
  /** Every failed `advance` of {@link playOn}, as `seat <n>: <tag>`. */
  const halts: Array<string> = []
  return { hostClock, links: links.value, peers, halts }
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

/**
 * Plays `frames` frames on which every peer whose page is shown advances
 * (`skip` leaves a seat out, as a hitch does), recording failures in
 * `match.halts` instead of throwing: for matches over a faulty link.
 */
export const playOn = (
  match: ReturnType<typeof setUpMatch>,
  frames: number,
  options: { readonly input?: (seat: number, at: number) => PlayerInput; readonly skip?: (seat: number) => boolean } = {}
): void => {
  const input = options.input ?? pressed
  for (let at = 0; at < frames; at++) {
    for (const [seat, peer] of match.peers.entries()) {
      if (peer.visibility.hidden() || options.skip?.(seat) === true) continue
      const advanced = peer.session.advance(input(seat, at))
      if (!advanced.ok) match.halts.push(`seat ${seat}: ${advanced.error._tag}`)
    }
    match.hostClock.adjust(stepMS)
  }
}

/**
 * Idle frames until every guess is right, then the peers behind catch up:
 * every shown peer ends on one tick. When one behind has waited half a
 * second (`status().waiting`), every peer advances once, so what the link
 * lost is sent again.
 */
export const settleOn = (match: ReturnType<typeof setUpMatch>): void => {
  playOn(match, 90, { input: () => idle })
  const shown = (seat: number): boolean => !match.peers[seat]!.visibility.hidden()
  for (let at = 0; at < 1200; at++) {
    const ticks = match.peers.map((peer) => peer.session.status().tick)
    const lowest = Math.min(...ticks.filter((_, seat) => shown(seat)))
    if (ticks.every((tick, seat) => !shown(seat) || tick === lowest)) return
    const stuck = match.peers.some((peer, seat) => ticks[seat] === lowest && (peer.session.status().waiting?.forMS ?? 0) > 500)
    playOn(match, 1, { input: () => idle, skip: (seat) => ticks[seat] !== lowest && !stuck })
  }
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
