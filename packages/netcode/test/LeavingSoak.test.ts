/**
 * Seeded matches of three to eight seats over a faulty link, in which seats
 * leave for good at any moment (their page gone, the others finding out by
 * its silence or told by `drop`) while others hitch: whatever the seed, the
 * peers still there never halt, name the same seats as left on the same
 * ticks, hold the world of one runtime that knew every input, and were each
 * handed that runtime's events once. `mixed` adds hides, resyncs, pages
 * that load again and connections that drop and come back, after which the
 * peers agree with each other. A failing seed fails the same way again.
 */
import { describe, expect, it } from "vitest"
import { Random } from "@typeonce/ritmo"
import type { Netcode } from "@typeonce/ritmo-netcode"

import { Fired, idle, pressed, type PlayerInput } from "./game.ts"
import { checksumOf, flaky, playOn, reference, reload, setUpMatch, settleOn, staying } from "./match.ts"

/**
 * Seeds per case, from `from` on, and the seats of the cases. A longer local
 * run raises them: 48 seeds of each case passed when this was written, with
 * 4, 6 and 8 seats leaving and 3, 5 and 8 seats in the mix.
 */
const seeds = 1
const from = 1
const leavingCounts = [4, 8]
const mixedCounts = [3, 8]

const left: PlayerInput = { dx: 2, fire: true }

const network = (random: Random.Random) => ({
  latencyMS: random.integer(20, 200),
  jitterMS: random.integer(0, 150),
  loss: random.integer(0, 11) / 100,
  ...(random.next() < 0.5 ? { inputDelay: random.integer(0, 12) } : { adaptiveDelay: { min: 0, max: random.integer(2, 12) } }),
  maxRollback: 40,
  checkpoints: 40,
  checksumEvery: 10
})

const leaving = (mode: "rollback" | "lockstep", count: number, seed: number) => {
  const random = Random.make(seed * 7919 + count * 31 + (mode === "rollback" ? 0 : 1))
  // No hitch here outlasts the timeout: a seat silent for longer is counted out and seated again with a save, which `mixed` plays.
  const match = setUpMatch({ mode, count, seed, ...network(random), timeoutMS: random.integer(1200, 2500), left })
  const script: Array<string> = []
  const seen = match.peers.map((peer) => ({ reader: peer.session.events(Fired), confirmed: [] as Array<Netcode.EventRecord<{ readonly seat: number; readonly x: number }>>, lost: [] as Array<Netcode.EventsLost> }))
  const read = () => {
    for (const [seat, one] of seen.entries()) {
      if (match.departed.has(seat)) continue
      one.confirmed.push(...one.reader.confirmed())
      one.reader.predicted()
      one.reader.withdrawn()
      const lost = one.reader.lost()
      if (lost !== undefined) one.lost.push(lost)
    }
  }
  let frame = 0
  const hitched: Array<number> = Array.from({ length: count }, () => 0)
  /** Per frame still to come, the sessions to tell that a seat is gone. */
  const tellAt = new Map<number, Array<readonly [number, number]>>()
  const play = (frames: number, press: boolean) => {
    for (let at = 0; at < frames; at++, frame++) {
      for (const [teller, gone] of tellAt.get(frame) ?? []) if (!match.departed.has(teller)) match.peers[teller]!.session.drop(gone)
      playOn(match, 1, { input: (seat) => press ? pressed(seat, frame) : idle, skip: (seat) => hitched[seat]! > 0 })
      read()
      for (let seat = 0; seat < count; seat++) hitched[seat] = Math.max(0, hitched[seat]! - 1)
    }
  }
  play(120, true)
  for (let phase = 0; phase < 8; phase++) {
    const event = random.integer(0, 3)
    const seat = random.integer(0, count)
    if (event === 0 && !match.departed.has(seat) && staying(match).length > 2) {
      match.links[seat]!.close("the page is gone")
      match.departed.add(seat)
      const how = random.integer(0, 3)
      // Nobody is told (its silence counts), one peer is, or each is after its own delay, as a relay's message arrives.
      const tellers = how === 0 ? [] : how === 1 ? [staying(match)[random.integer(0, staying(match).length)]!] : staying(match)
      for (const teller of tellers) {
        const at = frame + random.integer(0, 20)
        tellAt.set(at, [...tellAt.get(at) ?? [], [match.peers.indexOf(teller), seat]])
      }
      script.push(`${seat} leaves at ${frame} (${["silent", "one told", "all told"][how]})`)
    } else if (event === 1 && !match.departed.has(seat)) {
      hitched[seat] = random.integer(5, 30)
      script.push(`${seat} hitches at ${frame}`)
    }
    play(random.integer(30, 240), true)
  }
  play(200, false)
  settleOn(match)
  read()
  return { match, script, seen }
}

const expectLeaving = ({ match, script, seen }: ReturnType<typeof leaving>) => {
  const label = `${script.join(", ")} ${JSON.stringify([...match.ended])}`
  expect(match.halts, label).toEqual([])
  const peers = staying(match)
  const out = peers[0]!.session.status().left
  expect(out.map((one, seat) => one === undefined ? undefined : seat).filter((seat) => seat !== undefined), label).toEqual([...match.departed].sort((a, b) => a - b))
  for (const peer of peers) expect(peer.session.status().left, label).toEqual(out)
  const settledOf = (seat: number) => Math.min(match.peers[seat]!.session.status().confirmed, match.peers[seat]!.session.status().tick)
  const top = Math.max(...peers.map((peer) => peer.session.status().tick))
  const { sums, fired } = reference(match.peers, top, out, left)
  for (const [seat, peer] of match.peers.entries()) {
    if (match.departed.has(seat)) continue
    expect(checksumOf(peer), `${label}: seat ${seat}`).toBe(sums[peer.session.status().tick])
    expect(seen[seat]!.lost, label).toEqual([])
    const settled = settledOf(seat)
    const mine = seen[seat]!.confirmed
    const theirs = fired.filter(({ tick }) => tick < settled)
    // The first event that differs says more than two long arrays.
    const differs = theirs.findIndex((record, index) => record.tick !== mine[index]?.tick || record.value.seat !== mine[index]?.value.seat || record.value.x !== mine[index]?.value.x)
    expect({ differs, length: mine.length }, `${label}: seat ${seat}`).toEqual({ differs: -1, length: theirs.length })
  }
}

const mixed = (mode: "rollback" | "lockstep", count: number, seed: number) => {
  const random = Random.make(seed * 104729 + count * 31 + (mode === "rollback" ? 0 : 1))
  const then = random.next() < 0.5 ? "resync-on-return" as const : "stall" as const
  const connection = flaky()
  const match = setUpMatch({ mode, count, seed, ...network(random), timeoutMS: random.integer(600, 1500), left, hidden: { afterMS: random.integer(0, 2000), then }, wrap: connection.wrap })
  const script: Array<string> = [then]
  let frame = 0
  const hitched: Array<number> = Array.from({ length: count }, () => 0)
  const hidden: Array<number> = Array.from({ length: count }, () => 0)
  const away: Array<number> = Array.from({ length: count }, () => 0)
  /** How each session that ended did. */
  const endings: Array<string> = []
  const play = (frames: number) => {
    for (let at = 0; at < frames; at++, frame++) {
      playOn(match, 1, { input: (seat) => pressed(seat, frame), skip: (seat) => hitched[seat]! > 0 })
      for (let seat = 0; seat < count; seat++) {
        hitched[seat] = Math.max(0, hitched[seat]! - 1)
        if (hidden[seat]! > 0 && --hidden[seat]! === 0) match.peers[seat]!.visibility.show()
        if (away[seat]! > 0 && --away[seat]! === 0) connection.down.delete(seat)
        // A session that ended while its seat could reach nobody (it timed every other seat out): the game starts a new one, as after a reload.
        const over = match.ended.get(seat)
        if (over !== undefined && away[seat] === 0 && !match.departed.has(seat)) {
          endings.push(`seat ${seat}: ${over._tag === "Disconnected" ? `${over.who}, ${over.reason} of ${over.seat}` : over._tag}`)
          reload(match, seat)
        }
      }
    }
  }
  play(120)
  for (let phase = 0; phase < 10; phase++) {
    const event = random.integer(0, 7)
    const seat = random.integer(0, count)
    const hereNow = (one: number) => !match.departed.has(one) && !match.ended.has(one) && hidden[one] === 0 && away[one] === 0
    // Two other seats stay, so one of them always plays: a match whose every page is gone, hidden or cut off at once has nobody to go on with, and ends.
    const here = hereNow(seat) && match.peers.filter((_, other) => other !== seat && hereNow(other)).length >= 2
    if (event === 0 && here) {
      connection.down.add(seat)
      match.departed.add(seat)
      if (random.next() < 0.5) for (const peer of staying(match)) peer.session.drop(seat)
      script.push(`${seat} leaves at ${frame}`)
    } else if (event === 1 && hereNow(seat)) {
      hitched[seat] = random.integer(5, 60)
      script.push(`${seat} hitches at ${frame}`)
    } else if (event === 2 && here) {
      hidden[seat] = random.integer(20, 300)
      match.peers[seat]!.visibility.hide()
      script.push(`${seat} hides at ${frame} for ${hidden[seat]}`)
    } else if (event === 3 && hereNow(seat)) {
      match.peers[seat]!.session.resync()
      script.push(`${seat} resyncs at ${frame}`)
    } else if (event === 4 && here) {
      reload(match, seat)
      script.push(`${seat} reloads at ${frame}`)
    } else if (event === 5 && here) {
      // Its connection drops, and the relay tells the others, or does not.
      away[seat] = random.integer(10, 200)
      connection.down.add(seat)
      const told = random.next() < 0.5
      if (told) for (const [other, peer] of match.peers.entries()) if (other !== seat && !match.departed.has(other)) peer.session.drop(seat)
      script.push(`${seat} is cut off at ${frame} for ${away[seat]}${told ? ", told" : ""}`)
    } else if (event === 6 && match.departed.has(seat)) {
      // The player opens the game again.
      connection.down.delete(seat)
      match.departed.delete(seat)
      reload(match, seat)
      script.push(`${seat} comes back at ${frame}`)
    }
    play(random.integer(60, 300))
  }
  play(320)
  for (const peer of match.peers) peer.visibility.show()
  play(400)
  try {
    settleOn(match)
  } catch (error) {
    throw new Error(`${script.join(", ")}; ended: ${endings.join(", ")}: ${String(error)} ${JSON.stringify(match.peers.map((peer) => ({ ...peer.session.status(), roundTripMS: undefined, hidden: undefined })))}`)
  }
  return { match, script, endings }
}

const expectMixed = ({ match, script, endings }: ReturnType<typeof mixed>) => {
  const label = `${script.join(", ")}; ended: ${endings.join(", ")}`
  // No session halts: the peers never disagree. One ends only when its seat is out of the match and no save seats it (its connection was down for longer than `timeoutMS`).
  expect(match.halts.filter((halt) => !halt.endsWith("Disconnected")), label).toEqual([])
  expect([...match.ended.keys()], label).toEqual([])
  const peers = staying(match)
  const out = peers[0]!.session.status().left.map((one) => one?.reason !== undefined)
  expect(out, label).toEqual(match.peers.map((_, seat) => match.departed.has(seat)))
  for (const peer of peers) expect(peer.session.status().left.map((one) => one?.reason !== undefined), label).toEqual(out)
  expect(new Set(peers.map((peer) => peer.session.status().epoch)).size, label).toBe(1)
  expect(new Set(peers.map((peer) => peer.session.status().tick)).size, label).toBe(1)
  expect(new Set(peers.map(checksumOf)).size, label).toBe(1)
}

describe("a seeded soak of seats that leave", () => {
  for (const mode of ["rollback", "lockstep"] as const) for (const count of leavingCounts) for (let seed = from; seed < from + seeds; seed++) {
    it(`agrees on who left and when, and hands out every event once: seed ${seed}, ${count} seats (${mode})`, { timeout: 60_000 }, () => {
      expectLeaving(leaving(mode, count, seed))
    })
  }
})

describe("a seeded soak of seats that leave, hide, reload and come back", () => {
  /**
   * A seed a longer run found: the host's page froze for longer than
   * `timeoutMS`, and when it woke it held every peer that had reported it
   * silent to be the one that could not hear, and put them all out.
   */
  it("never halts and ends on one world: seed 18 found by a longer run, 8 seats (rollback)", { timeout: 60_000 }, () => {
    expectMixed(mixed("rollback", 8, 18))
  })
  for (const mode of ["rollback", "lockstep"] as const) for (const count of mixedCounts) for (let seed = from; seed < from + seeds; seed++) {
    it(`never halts and ends on one world: seed ${seed}, ${count} seats (${mode})`, { timeout: 60_000 }, () => {
      expectMixed(mixed(mode, count, seed))
    })
  }
})
