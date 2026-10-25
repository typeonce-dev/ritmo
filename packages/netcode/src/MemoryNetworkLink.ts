/**
 * Links between peers in one process, for headless tests of networked play.
 *
 * `make({ peers, hostClock, ... })` returns one link per peer, joined like
 * a relay: a message sent on one arrives on every other, after a latency
 * plus a seeded jitter, so later messages can overtake earlier ones, and a
 * share of them can be lost. Time is the injected `HostClock` (a
 * `HostClock.test()` the test moves), and the jitter and loss come from
 * `seed`, so a test that fails fails the same way again. A link's
 * `setLatency` changes its peer's latency mid-match, and `close` makes it
 * leave.
 *
 * @module MemoryNetworkLink
 * @docGroup netcode
 *
 * @example
 * ```ts
 * const hostClock = HostClock.test()
 * const links = MemoryNetworkLink.make({ peers: 2, hostClock, seed: 7, latencyMS: 60, jitterMS: 30, loss: 0.05 })
 * if (!links.ok) throw new Error(links.error.field)
 * const [left, right] = links.value
 * ```
 */
import { type HostClock, Random } from "@typeonce/ritmo"
import * as Result from "@typeonce/ritmo/Result"

import * as NetworkLink from "./NetworkLink.ts"

/** A link of {@link make}, which a test can close and slow down. */
export interface MemoryNetworkLink extends NetworkLink.NetworkLink {
  /**
   * Closes this peer's link, as when it leaves: it reads `Closed` with
   * `reason` from then on, its messages still flying are lost, and the other
   * peers hear nothing more from it (their links stay open, like a relay's).
   */
  readonly close: (reason: string) => void
  /**
   * Sets the latency of the messages this peer sends from now on (those
   * already flying keep theirs), as when its connection gets better or
   * worse mid-match. Fails, changing nothing, unless 0 or more.
   */
  readonly setLatency: (latencyMS: number) => Result.Result<void, InvalidOptions>
}

/** How the links behave. */
export interface Options {
  /** How many peers, 2 or more: one link each. */
  readonly peers: number
  /** What delivery times are read from. */
  readonly hostClock: HostClock.HostClock
  /** Seeds the jitter and the loss. */
  readonly seed: number
  /** Milliseconds every message takes at least (0 or more). */
  readonly latencyMS: number
  /** Up to this many milliseconds more, drawn per message (0 or more). */
  readonly jitterMS?: number
  /** The share of messages lost, from 0 (none, the default) to below 1. */
  readonly loss?: number
}

/** An option {@link make} or `setLatency` rejected. */
export interface InvalidOptions {
  readonly _tag: "InvalidOptions"
  readonly field: "peers" | "latencyMS" | "jitterMS" | "loss"
  readonly value: number
}

interface Flying {
  readonly from: number
  readonly at: number
  readonly order: number
  readonly message: string
}

/** One link per peer, joined like a relay. */
export const make = (options: Options): Result.Result<ReadonlyArray<MemoryNetworkLink>, InvalidOptions> => {
  const jitterMS = options.jitterMS ?? 0
  const loss = options.loss ?? 0
  if (!Number.isSafeInteger(options.peers) || options.peers < 2) return Result.failure({ _tag: "InvalidOptions", field: "peers", value: options.peers })
  if (!(options.latencyMS >= 0 && Number.isFinite(options.latencyMS))) return Result.failure({ _tag: "InvalidOptions", field: "latencyMS", value: options.latencyMS })
  if (!(jitterMS >= 0 && Number.isFinite(jitterMS))) return Result.failure({ _tag: "InvalidOptions", field: "jitterMS", value: jitterMS })
  if (!(loss >= 0 && loss < 1)) return Result.failure({ _tag: "InvalidOptions", field: "loss", value: loss })

  const random = Random.make(options.seed)
  const inboxes: Array<Array<Flying>> = Array.from({ length: options.peers }, () => [])
  let order = 0
  const closedReasons: Array<string | undefined> = Array.from({ length: options.peers }, () => undefined)
  const latencies: Array<number> = Array.from({ length: options.peers }, () => options.latencyMS)

  const link = (self: number): MemoryNetworkLink => ({
    send: (message) => {
      if (closedReasons[self] !== undefined) return
      const now = options.hostClock.now()
      for (let peer = 0; peer < options.peers; peer++) {
        if (peer === self || closedReasons[peer] !== undefined) continue
        // Both draws are made for every message, so the sequence does not depend on which are lost.
        const lost = random.next() < loss
        const delay = latencies[self]! + random.next() * jitterMS
        if (!lost) inboxes[peer]!.push({ from: self, at: now + delay, order: order++, message })
      }
    },
    receive: () => {
      if (closedReasons[self] !== undefined) return []
      const now = options.hostClock.now()
      const inbox = inboxes[self]!
      const arrived = inbox.filter((entry) => entry.at <= now).sort((a, b) => a.at - b.at || a.order - b.order)
      inboxes[self] = inbox.filter((entry) => entry.at > now)
      return arrived.map((entry) => entry.message)
    },
    status: () => {
      const reason = closedReasons[self]
      return reason === undefined ? NetworkLink.open : NetworkLink.closed(reason)
    },
    close: (reason) => {
      if (closedReasons[self] !== undefined) return
      closedReasons[self] = reason
      inboxes[self] = []
      // What it sent and is still on its way is lost with it.
      for (let peer = 0; peer < options.peers; peer++) inboxes[peer] = inboxes[peer]!.filter((entry) => entry.from !== self)
    },
    setLatency: (latencyMS) => {
      if (!(latencyMS >= 0 && Number.isFinite(latencyMS))) return Result.failure({ _tag: "InvalidOptions", field: "latencyMS", value: latencyMS })
      latencies[self] = latencyMS
      return Result.success(undefined)
    }
  })

  return Result.success(Array.from({ length: options.peers }, (_, peer) => link(peer)))
}
