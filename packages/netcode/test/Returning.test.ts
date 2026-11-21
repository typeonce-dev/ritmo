import { describe, expect, it } from "vitest"
import { HostClock } from "@typeonce/ritmo"
import { Netcode, NetworkLink } from "@typeonce/ritmo-netcode"

import { idle, makePeer, simulate, step } from "./game.ts"
import { checksumOf, flaky, frame, leave, playOn, reload, setUpMatch, settleOn, staying, stepMS, wire } from "./match.ts"

const held = { dx: 1, fire: false }

type Match = ReturnType<typeof setUpMatch>

/** Every peer in the match again, in one epoch, on one tick, with one world, and no halt on the way. */
const expectTogether = (match: Match, epoch: number) => {
  expect(match.halts).toEqual([])
  const peers = staying(match)
  for (const peer of peers) {
    const status = peer.session.status()
    expect(status.epoch).toBe(epoch)
    expect(status.left).toEqual(peers.map(() => undefined))
    expect(status.verified).toBeGreaterThan(status.tick - 40)
  }
  expect(new Set(peers.map((peer) => peer.session.status().tick)).size).toBe(1)
  expect(new Set(peers.map(checksumOf)).size).toBe(1)
}

describe("a page that loads again mid-match", () => {
  for (const mode of ["rollback", "lockstep"] as const) {
    it(`gets its seat back with a save, in a match of two (${mode})`, () => {
      const match = setUpMatch({ mode, latencyMS: 20, jitterMS: 0, checksumEvery: 10 })
      playOn(match, 120)
      const before = match.peers[0]!.session.status().tick
      // Seat 1's page reloads: its earlier session stops, and a new one, with an empty world, says hello on its link.
      reload(match, 1)
      playOn(match, 120)
      settleOn(match)
      // On main, both sessions ended with Disconnected "restarted".
      expectTogether(match, 2)
      expect(match.peers[0]!.session.status().tick).toBeGreaterThan(before + 100)
    })
  }

  it("gets seat 0 back too: the next seat hosts while it is out, and gives it its seat", () => {
    const match = setUpMatch({ mode: "rollback", count: 3, latencyMS: 30, jitterMS: 20, checksumEvery: 10 })
    playOn(match, 120)
    reload(match, 0)
    playOn(match, 120)
    settleOn(match)
    expectTogether(match, 2)
    // Seat 0 hosts again: a resync a peer asks for is its to answer, from the world the save gave it.
    match.peers[2]!.session.resync()
    playOn(match, 90)
    settleOn(match)
    expectTogether(match, 3)
  })

  it("comes back after the others played on without it for a while (6 seats)", () => {
    const connection = flaky()
    const match = setUpMatch({ mode: "rollback", count: 6, seed: 4, latencyMS: 50, jitterMS: 40, loss: 0.05, maxRollback: 24, checkpoints: 24, timeoutMS: 500, checksumEvery: 10, wrap: connection.wrap })
    playOn(match, 120)
    // The tab closes, and ten seconds later the player opens the game again.
    connection.down.add(4)
    match.departed.add(4)
    playOn(match, 600)
    expect(match.halts).toEqual([])
    for (const peer of staying(match)) expect(peer.session.status().left[4]?.reason).toBe("timeout")
    connection.down.delete(4)
    match.departed.delete(4)
    reload(match, 4)
    playOn(match, 200)
    settleOn(match)
    expectTogether(match, 2)
  })

  it("ends its new session after timeoutMS when a match runs and nobody seats it", () => {
    const hostClock = HostClock.test()
    const inbox: Array<string> = []
    const link: NetworkLink.NetworkLink = { send: () => {}, receive: () => inbox.splice(0), status: () => NetworkLink.open }
    const peer = makePeer({ setUp: false })
    const made = Netcode.rollback(peer.runtime, { simulate, seats: peer.seats, seat: 1, links: [link], hostClock, step, timeoutMS: 1000 })
    if (!made.ok) throw new Error(made.error.reason)
    const session = made.value
    let ended: Netcode.SessionError<unknown> | undefined
    let frames = 0
    for (; frames < 200 && ended === undefined; frames++) {
      // Seat 0 is in epoch 3 and never answers this session.
      inbox.push(wire({ k: "inputs", from: 0, epoch: 3, roster: 0, next: 500, acks: [499, 480], start: 500, inputs: [idle] }))
      const advanced = session.advance(idle)
      if (!advanced.ok) ended = advanced.error
      hostClock.adjust(stepMS)
    }
    expect(ended).toMatchObject({ _tag: "Disconnected", who: "self", seat: 1, reason: "timeout" })
    expect(frames * stepMS).toBeGreaterThan(1000)
    expect(frames * stepMS).toBeLessThan(1100)
  })

  it("ends the earlier session, still running, with \"restarted\" when it hears the new one ask for its seat", () => {
    const match = setUpMatch({ mode: "rollback", latencyMS: 20, jitterMS: 0 })
    playOn(match, 60)
    // Another tab of seat 1 says hello where seat 1's session hears it.
    const asks = wire({ k: "hello", from: 1, epoch: 0, session: 123456 })
    const heard: Array<string> = [asks]
    const link = match.links[1]!
    const original = link.receive
    ;(link as { receive: NetworkLink.NetworkLink["receive"] }).receive = () => [...heard.splice(0), ...original()]
    const advanced = match.peers[1]!.session.advance(idle)
    expect(advanced.ok ? undefined : advanced.error).toMatchObject({ _tag: "Disconnected", who: "self", seat: 1, reason: "restarted" })
  })
})

describe("a seat the others played on without", () => {
  for (const mode of ["rollback", "lockstep"] as const) {
    it(`is seated again with a save when its session reaches them again (${mode})`, () => {
      const connection = flaky()
      const match = setUpMatch({ mode, count: 4, latencyMS: 30, jitterMS: 20, checksumEvery: 10, wrap: connection.wrap })
      playOn(match, 120)
      // Seat 3's connection drops for a second, and the relay tells the others at once.
      connection.down.add(3)
      for (const seat of [0, 1, 2]) match.peers[seat]!.session.drop(3)
      playOn(match, 60)
      expect(match.peers[0]!.session.status().left[3]?.reason).toBe("dropped")
      // Seat 3 does not know yet: it hears nobody.
      expect(match.peers[3]!.session.status().left).toEqual([undefined, undefined, undefined, undefined])
      const ahead = match.peers[0]!.session.status().tick
      expect(ahead).toBeGreaterThan(match.peers[3]!.session.status().tick + 20)
      connection.down.delete(3)
      playOn(match, 8)
      // It learned it was left out, and waits for the save.
      expect(match.peers[3]!.results.at(-1)?._tag ?? "Waiting").toBe("Waiting")
      expect(match.peers[3]!.session.status().left[3]?.reason).toBe("dropped")
      playOn(match, 120)
      settleOn(match)
      expectTogether(match, 2)
    })
  }

  it("ends with Disconnected for its own seat when no save seats it within timeoutMS", () => {
    const connection = flaky()
    const match = setUpMatch({ mode: "rollback", count: 3, latencyMS: 20, jitterMS: 0, timeoutMS: 1000, wrap: connection.wrap })
    playOn(match, 60)
    // The others are told seat 2 is gone. It hears that it was left out, and nothing it sends arrives.
    connection.mute.add(2)
    for (const seat of [0, 1]) match.peers[seat]!.session.drop(2)
    playOn(match, 20)
    expect(match.peers[2]!.session.status().left[2]?.reason).toBe("dropped")
    leave(match, 0)
    leave(match, 1)
    let ended: Netcode.SessionError<unknown> | undefined
    let frames = 0
    for (; frames < 200 && ended === undefined; frames++) {
      const advanced = match.peers[2]!.session.advance(idle)
      if (!advanced.ok) ended = advanced.error
      match.hostClock.adjust(stepMS)
    }
    expect(ended).toMatchObject({ _tag: "Disconnected", who: "self", seat: 2, reason: "dropped" })
    // A second after it learned, some frames before the others left.
    expect(frames * stepMS).toBeGreaterThan(600)
    expect(frames * stepMS).toBeLessThan(1000)
  })

  for (const frozen of [0, 2]) {
    it(`is seated again when its page froze for longer than timeoutMS and wakes (seat ${frozen})`, () => {
      const match = setUpMatch({ mode: "rollback", count: 4, latencyMS: 30, jitterMS: 20, timeoutMS: 500, checksumEvery: 10 })
      playOn(match, 120)
      // Its page runs nothing for a second and a half: a suspended laptop, a debugger.
      playOn(match, 90, { skip: (seat) => seat === frozen })
      for (const [seat, peer] of match.peers.entries()) {
        if (seat !== frozen) expect(peer.session.status().left[frozen]?.reason).toBe("timeout")
      }
      const ahead = match.peers[frozen === 0 ? 1 : 0]!.session.status().tick
      expect(ahead).toBeGreaterThan(match.peers[frozen]!.session.status().tick + 40)
      // It wakes to every other peer's report that it went silent. It was: it puts nobody out for saying so, and asks for its seat.
      playOn(match, 120)
      settleOn(match)
      expectTogether(match, 2)
    })
  }

  it("is seated again when its hidden page shows after it was counted out", () => {
    const match = setUpMatch({ mode: "rollback", count: 3, latencyMS: 30, jitterMS: 20, timeoutMS: 500, checksumEvery: 10, hidden: { afterMS: 500, then: "resync-on-return" } })
    playOn(match, 90)
    match.peers[2]!.visibility.hide()
    playOn(match, 150)
    expect(match.peers[0]!.session.status().left[2]?.reason).toBe("timeout")
    match.peers[2]!.visibility.show()
    playOn(match, 150)
    settleOn(match)
    expectTogether(match, 2)
  })
})

describe("status().waiting", () => {
  for (const mode of ["rollback", "lockstep"] as const) {
    it(`names the seat and tick a stalled peer waits for, and for how long (${mode})`, () => {
      const match = setUpMatch({ mode, latencyMS: 20, jitterMS: 0, maxRollback: 8 })
      const [host] = match.peers
      let at = 0
      for (; at < 60; at++) frame(match, at, () => held)
      expect(host!.session.status().waiting).toBeUndefined()
      // Seat 1 stops sending: seat 0 runs what it may, then stalls.
      let stalls = 0
      for (let n = 0; n < 60; n++, at++) {
        frame(match, at, () => held, (seat) => seat === 1)
        if (host!.results.at(-1)?._tag === "Stalled") stalls += 1
      }
      expect(stalls).toBeGreaterThan(30)
      const waiting = host!.session.status().waiting
      const last = host!.session.status().confirmed
      expect(waiting).toEqual({ seat: 1, tick: mode === "rollback" ? last : host!.session.status().tick, forMS: expect.closeTo(stalls * stepMS, 6) })
      // Running again: nothing to wait for.
      for (let n = 0; n < 30; n++, at++) frame(match, at, () => held)
      expect(host!.session.status().waiting).toBeUndefined()
    })
  }
})
