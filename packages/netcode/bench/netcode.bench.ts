/**
 * Runtime benchmark cases for networked sessions.
 *
 * `advance` runs once per fixed step on every peer: it reads the links,
 * rolls back when real input contradicts a guess, ticks, and sends. The
 * cases play two peers over memory links with latency and jitter, so the
 * rollbacks and messages of a real match are in every measured frame.
 */
import type { BenchCase } from "../../core/bench/harness.ts"
import { setUpMatch, stepMS } from "../test/match.ts"
import { pressed } from "../test/game.ts"

const peersFrame = (mode: "rollback" | "lockstep"): BenchCase["setup"] => () => {
  const match = setUpMatch({ mode, latencyMS: 50, jitterMS: 30 })
  let at = 0
  const frame = () => {
    for (const [seat, peer] of match.peers.entries()) {
      const advanced = peer.session.advance(pressed(seat, at))
      if (!advanced.ok) throw new Error(JSON.stringify(advanced.error))
    }
    match.hostClock.adjust(stepMS)
    at++
  }
  // Past the first save, into the steady state.
  for (let warm = 0; warm < 120; warm++) frame()
  return { run: frame }
}

export const cases: ReadonlyArray<BenchCase> = [
  {
    name: "netcode/rollback-frame-2-peers",
    description: "One frame of two rollback peers over a 50 ms link: read, roll back, tick, send",
    critical: true,
    setup: peersFrame("rollback")
  },
  {
    name: "netcode/lockstep-frame-2-peers",
    description: "One frame of two lockstep peers over a 50 ms link: read, tick when ready, send",
    setup: peersFrame("lockstep")
  }
]
