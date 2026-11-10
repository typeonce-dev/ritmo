import { describe, expect, it } from "vitest"

import { checksumOf, playOn, setUpMatch, settleOn } from "./match.ts"

/**
 * Three seats over a slow link whose jitter lets seat 0's messages after a
 * resync overtake its save: inputs of the new epoch reached a peer still in
 * the old one, which took them (and the acknowledgements they carry) into
 * timelines the save then replaced.
 */
describe("inputs of another epoch", () => {
  const resyncAfterHitch = (options: { readonly loss: number; readonly hitch: number }) => {
    const match = setUpMatch({ mode: "rollback", count: 3, seed: 11, latencyMS: 250, jitterMS: 200, loss: options.loss, inputDelay: 0, maxRollback: 60, checkpoints: 60, checksumEvery: 10 })
    playOn(match, 300)
    // Seat 0 hitches while the others run ahead, then resyncs.
    playOn(match, options.hitch, { skip: (seat) => seat === 0 })
    match.peers[0]!.session.resync()
    playOn(match, 300)
    settleOn(match)
    return match
  }

  it("wait for their save, so no peer stalls for good after a resync", () => {
    const match = resyncAfterHitch({ loss: 0, hitch: 100 })
    expect(match.halts).toEqual([])
    // On main, seat 2 pruned its own inputs for ticks the save ran again and never ran past tick 281: the others then timed it out.
    for (const peer of match.peers) expect(peer.session.status().tick).toBeGreaterThan(550)
    expect(match.peers.map((peer) => peer.session.status().epoch)).toEqual([2, 2, 2])
    expect(new Set(match.peers.map((peer) => peer.session.status().tick)).size).toBe(1)
    expect(new Set(match.peers.map(checksumOf)).size).toBe(1)
  })

  it("wait for their save, so the peers agree after a resync over a lossy link", () => {
    const match = resyncAfterHitch({ loss: 0.1, hitch: 20 })
    // On main, every seat ended Desynced after the resync.
    expect(match.halts).toEqual([])
    expect(match.peers.map((peer) => peer.session.status().epoch)).toEqual([2, 2, 2])
    expect(new Set(match.peers.map((peer) => peer.session.status().tick)).size).toBe(1)
    expect(new Set(match.peers.map(checksumOf)).size).toBe(1)
  })
})
