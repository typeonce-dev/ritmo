import { describe, expect, it } from "vitest"

import { Random } from "@typeonce/ritmo-math"
import { Netcode } from "@typeonce/ritmo-netcode"

import { draw, idle, makeRuntime, playerInput, setup, simulate, type GameRuntime, type PlayerInput, type Screen } from "../game.ts"
import { match, truth, type Peer } from "../match.ts"

/** A player who holds a direction for a while, then picks another, and fires now and then. */
const player = (seed: number, frames: number): ReadonlyArray<PlayerInput> => {
  const random = Random.make(seed)
  const inputs: Array<PlayerInput> = []
  let held: PlayerInput = { dx: 0, dy: 0, fire: false }
  for (let frame = 0; frame < frames; frame++) {
    if (random.next() < 0.1) {
      const pick = (): -1 | 0 | 1 => random.pick([-1, 0, 1] as const)!
      held = { dx: pick(), dy: pick(), fire: false }
    }
    inputs.push({ ...held, fire: random.next() < 0.3 })
  }
  return inputs
}

const script = [player(1, 600), player(2, 600)] as const

/** The whole world's checksum: equal checksums are equal worlds. */
const world = (runtime: GameRuntime) => {
  const sum = runtime.checksum()
  if (!sum.ok) throw new Error("checksum failed")
  return sum.value
}

/** What the screen shows: every sprite and where. */
const shown = (screen: Screen) => [...screen.sprites.entries()].sort(([a], [b]) => a - b)

/** Each peer is on the reference's world at its own tick (in lockstep, a peer waits on its own messages). */
const agree = (peers: readonly [Peer, Peer]) =>
  peers.map((peer) => {
    const expected = truth(peers, peer.session.status().tick)
    expect(world(peer.runtime)).toBe(world(expected.runtime))
    expect(shown(peer.screen)).toEqual(shown(expected.screen))
    return expected
  })[0]!

describe("two peers play the shooter over a slow, reordering network", () => {
  it("agrees with one runtime that knew every input, in lockstep", () => {
    const peers = match({ mode: "lockstep", script, latencyMS: 50, jitterMS: 80 })
    const expected = agree(peers)
    // Something to compare: shots were fired and drawn.
    expect(expected.screen.draws.flatMap((drawn) => drawn.created).length).toBeGreaterThan(20)
    expect(peers[0].session.status().rollbacks).toBe(0)
  })

  it("agrees with it when rolling back, after running more than 100 ticks again", () => {
    const peers = match({ mode: "rollback", script, latencyMS: 50, jitterMS: 80, loss: 0.1 })
    for (const peer of peers) expect(peer.session.status().again).toBeGreaterThan(100)
    agree(peers)
  })

  // A rewind that takes a shot away, and ticks that bring it back under the
  // same id, reach the screen as one change: never as a sprite taken down
  // and made again in the same draw.
  it("never takes down and remakes a sprite in one draw", () => {
    const peers = match({ mode: "rollback", script, latencyMS: 50, jitterMS: 80 })
    for (const peer of peers) {
      for (const drawn of peer.screen.draws) expect(drawn.destroyed.filter((entity) => drawn.created.includes(entity))).toEqual([])
    }
  })

  // The host plays a sound per confirmed hit and flashes predicted ones:
  // under rollback, every hit is heard exactly once, as it really happened,
  // and every flash left standing is a hit that happened on its tick.
  it("hears every hit once, and flashes only the ones that stood", () => {
    const peers = match({ mode: "rollback", script, latencyMS: 50, jitterMS: 80 })
    for (const peer of peers) {
      const { confirmed, tick } = peer.session.status()
      const settled = Math.min(confirmed, tick)
      const expected = truth(peers, tick).hits
      expect(peer.heard.length).toBeGreaterThan(2)
      expect(peer.heard).toEqual(expected.filter((hit) => hit.tick < settled))
      // No flash of a hit a rollback undid is left standing.
      expect(peer.flashes.size).toBeGreaterThan(0)
      for (const [at, values] of peer.flashes) expect(values).toEqual(expected.filter((hit) => hit.tick === at).map((hit) => hit.value))
    }
  })

  it("keeps agreeing through resyncs in the middle of the match", () => {
    const peers = match({ mode: "rollback", script, latencyMS: 50, jitterMS: 80, resyncAt: [200, 400] })
    for (const peer of peers) {
      const status = peer.session.status()
      expect(status.epoch).toBe(3)
      expect(status.verified).toBeGreaterThan(400)
    }
    expect(world(peers[0].runtime)).toBe(world(peers[1].runtime))
  })
})

describe("the shooter rewinds exactly", () => {
  // Before shipping a rollback game: every tick is rewound and run again, and must come out the same.
  it("passes a sync test that rolls back 8 ticks after every tick, drawing in between", () => {
    const seats = Netcode.seats(playerInput, { count: 2, idle })
    if (!seats.ok) throw new Error(seats.error.reason)
    const { runtime, screen } = makeRuntime(seats.value.source)
    expect(runtime.tick(setup).ok).toBe(true)
    const test = Netcode.syncTest(runtime, { simulate, seats: seats.value, rewind: 8 })
    if (!test.ok) throw new Error(test.error.reason)
    for (const [frame, local] of script[0].entries()) {
      const advanced = test.value.advance(local)
      if (!advanced.ok) throw new Error(`frame ${frame}: ${JSON.stringify(advanced.error)}`)
      expect(runtime.tick(draw).ok).toBe(true)
    }
    expect(test.value.status()).toMatchObject({ tick: 600, verified: 600, rollbacks: 600 })
    expect(screen.draws.flatMap((drawn) => drawn.created).length).toBeGreaterThan(20)
  })
})
