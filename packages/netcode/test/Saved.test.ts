/**
 * `session.events` across a save that seats a peer again mid-match: a page
 * that loads again, and a page that was hidden under `"resync-on-return"`.
 *
 * Every seat fires on every tick it presses, so every tick of the match
 * publishes events except the save's idle ones. The host's run of a tick is
 * the match's (every save is its world), so its confirmed events are the
 * reference: it must confirm every tick it ran, the save's ticks before it
 * included. Every other peer confirms each tick once, as the host ran it,
 * or says through `lost()` that it cannot; the peer the save seats confirms
 * every tick from the save on.
 */
import { describe, expect, it } from "vitest"
import { Random } from "@typeonce/ritmo"
import { Netcode, type NetworkLink } from "@typeonce/ritmo-netcode"

import { Fired, type PlayerInput } from "./game.ts"
import { playOn, reload, setUpMatch, settleOn, stepMS, type MatchPeer } from "./match.ts"

const firing = (seat: number, at: number): PlayerInput => ({ dx: ((at + seat) % 3) - 1, fire: true })

/** A reader on `peer` that keeps every record and report, and checks each read against the streams' rules. */
const watch = (peer: MatchPeer) => {
  const reader = peer.session.events(Fired)
  const from = peer.session.status().tick
  /** Confirmed records as `tick:seat:x`, by tick. */
  const confirmed = new Map<number, Array<string>>()
  const lost: Array<Netcode.EventsLost> = []
  const outstanding = new Set<number>()
  const read = () => {
    for (const { tick } of reader.withdrawn()) {
      expect(outstanding.has(tick)).toBe(true)
      outstanding.delete(tick)
    }
    for (const { tick } of reader.predicted()) {
      expect(confirmed.has(tick)).toBe(false)
      outstanding.add(tick)
    }
    const records = reader.confirmed()
    const ticks = new Set<number>()
    for (const { tick, value } of records) {
      // Each tick once: never one confirmed by an earlier read.
      expect(confirmed.has(tick) && !ticks.has(tick)).toBe(false)
      ticks.add(tick)
      const values = confirmed.get(tick) ?? []
      values.push(`${tick}:${value.seat}:${value.x}`)
      confirmed.set(tick, values)
      outstanding.delete(tick)
    }
    for (let report = reader.lost(); report !== undefined; report = reader.lost()) lost.push(report)
  }
  const isLost = (tick: number): boolean => lost.some((report) => tick >= report.from && tick < report.to)
  return { from, confirmed, lost, outstanding, read, isLost }
}

type Watcher = ReturnType<typeof watch>

/** Every save's tick, as each seat sent or heard it. */
const saves = () => {
  const ticks = new Set<number>()
  const wrap = (_seat: number, link: NetworkLink.NetworkLink): NetworkLink.NetworkLink => {
    const note = (text: string) => {
      // One bundle a frame: its messages in `m`.
      const bundle = JSON.parse(text) as { readonly m: ReadonlyArray<{ readonly k: string; readonly tick?: number }> }
      for (const message of bundle.m) if (message.k === "sync") ticks.add(message.tick!)
    }
    return {
      send: (text) => {
        note(text)
        link.send(text)
      },
      receive: () => {
        const arrived = link.receive()
        for (const text of arrived) note(text)
        return arrived
      },
      status: link.status
    }
  }
  return { ticks, wrap }
}

/**
 * The checks after a match. `seated` is the seat the last save seated again,
 * and `at` that save's tick; `fresh`, when the save seated a new session (a
 * page that loaded again), which is told nothing of the ticks before it.
 */
const expectExact = (match: ReturnType<typeof setUpMatch>, watchers: ReadonlyArray<Watcher>, saved: ReadonlySet<number>, seated: number, at: number, fresh: boolean, delay = 4) => {
  // Up to the last tick any seat fired on: the idle frames that settle the match publish nothing.
  const fired = Math.max(...match.peers.flatMap((peer) => [...peer.recorded].filter(([, input]) => input.fire).map(([tick]) => tick)))
  const end = Math.min(fired + 1, ...match.peers.map((peer) => Math.min(peer.session.status().confirmed, peer.session.status().tick)))
  const idleTick = (tick: number): boolean => [...saved].some((save) => tick >= save && tick < save + delay)
  const [host] = watchers as [Watcher]
  // The host confirms every tick of the match it ran, a save's ticks before it included.
  const unconfirmed: Array<number> = []
  for (let tick = 0; tick < end; tick++) if (!idleTick(tick) && !host.confirmed.has(tick)) unconfirmed.push(tick)
  expect(unconfirmed).toEqual([])
  expect(host.lost).toEqual([])
  for (const [seat, watcher] of watchers.entries()) {
    // From the save that seated it, the seated page confirms every tick, with nothing lost.
    const start = seat === seated && fresh ? at : watcher.from
    const wrong: Array<string> = []
    for (let tick = start; tick < end; tick++) {
      const theirs = host.confirmed.get(tick)
      const mine = watcher.confirmed.get(tick)
      const same = JSON.stringify(mine) === JSON.stringify(theirs)
      // Not as the host ran it: only where `lost()` said so, and never on the seated page from its save on.
      if (!same && ((seat === seated && tick >= at) || !watcher.isLost(tick))) wrong.push(`${tick}: ${mine?.join(" ") ?? "missing"} / ${theirs?.join(" ") ?? "none"}`)
    }
    expect({ seat, wrong }).toEqual({ seat, wrong: [] })
    if (seat === seated) expect(watcher.lost.filter((report) => report.to > at)).toEqual([])
    expect(watcher.outstanding.size).toBe(0)
  }
}

describe("session.events across a save that seats a peer", () => {
  for (const mode of ["rollback", "lockstep"] as const) {
    for (const count of mode === "rollback" ? [2, 3, 8] : [2, 3]) {
      it(`a page that loads again: every peer confirms each tick once, as the host ran it (${mode}, ${count} seats)`, { timeout: 30_000 }, () => {
        const { ticks: saved, wrap } = saves()
        const match = setUpMatch({ mode, count, seed: 4, latencyMS: 60, jitterMS: 30, loss: 0.05, inputDelay: 4, maxRollback: 24, checkpoints: 24, checksumEvery: 10, wrap })
        const watchers = match.peers.map(watch)
        const readAll = () => watchers.forEach((watcher) => watcher.read())
        for (let at = 0; at < 120; at++) {
          playOn(match, 1, { input: (seat) => firing(seat, at) })
          readAll()
        }
        const seated = count - 1
        const before = new Set(saved)
        reload(match, seated)
        watchers[seated] = watch(match.peers[seated]!)
        for (let at = 120; at < 360; at++) {
          playOn(match, 1, { input: (seat) => firing(seat, at) })
          readAll()
        }
        settleOn(match)
        readAll()
        expect(match.halts).toEqual([])
        const at = Math.max(...[...saved].filter((tick) => !before.has(tick)))
        expect(match.peers[0]!.session.status().epoch).toBe(2)
        expectExact(match, watchers, saved, seated, at, true)
      })

      it(`a page hidden under "resync-on-return": every peer confirms each tick once, as the host ran it (${mode}, ${count} seats)`, { timeout: 30_000 }, () => {
        const { ticks: saved, wrap } = saves()
        const match = setUpMatch({ mode, count, seed: 5, latencyMS: 60, jitterMS: 30, loss: 0.05, inputDelay: 4, maxRollback: 24, checkpoints: 24, checksumEvery: 10, hidden: { afterMS: 30_000, then: "resync-on-return" }, wrap })
        const watchers = match.peers.map(watch)
        const readAll = () => watchers.forEach((watcher, seat) => {
          if (!match.peers[seat]!.visibility.hidden()) watcher.read()
        })
        const seated = count - 1
        for (let at = 0; at < 120; at++) {
          playOn(match, 1, { input: (seat) => firing(seat, at) })
          readAll()
        }
        match.peers[seated]!.visibility.hide()
        for (let at = 120; at < 200; at++) {
          playOn(match, 1, { input: (seat) => firing(seat, at) })
          readAll()
        }
        const before = new Set(saved)
        match.peers[seated]!.visibility.show()
        for (let at = 200; at < 400; at++) {
          playOn(match, 1, { input: (seat) => firing(seat, at) })
          readAll()
        }
        settleOn(match)
        readAll()
        expect(match.halts).toEqual([])
        const at = Math.max(...[...saved].filter((tick) => !before.has(tick)))
        expect(match.peers[0]!.session.status().epoch).toBe(2)
        expectExact(match, watchers, saved, seated, at, false)
      })
    }
  }

  /**
   * Seeded matches with hitches (a page that draws nothing for a while, then
   * runs every step it owes in one frame, as `FixedLoop` does) and an
   * adaptive delay. The seeds are ones that failed before: under lockstep, a
   * peer ahead of the host confirms up to the host's own inputs, one tick
   * further than the ledger kept, so `lost()` missed the save's own tick.
   */
  describe("with hitches and an adaptive delay", () => {
    const cases = [
      { path: "hidden", mode: "lockstep", count: 3, seed: 3 },
      { path: "hidden", mode: "lockstep", count: 4, seed: 6 },
      { path: "hidden", mode: "lockstep", count: 4, seed: 7 },
      { path: "reload", mode: "rollback", count: 4, seed: 5 },
      { path: "hidden", mode: "rollback", count: 3, seed: 8 }
    ] as const
    for (const { path, mode, count, seed } of cases) {
      it(`${path === "reload" ? "a page that loads again" : "a hidden page"} (${mode}, ${count} seats, seed ${seed})`, { timeout: 30_000 }, () => {
        const { ticks: saved, wrap } = saves()
        const latencyMS = 30 + (seed % 4) * 25
        const random = Random.make(seed * 7919)
        const match = setUpMatch({ mode, count, seed, latencyMS, jitterMS: latencyMS / 2, loss: 0.05, checksumEvery: 10, timeoutMS: 3000, adaptiveDelay: { min: 2, max: 6 }, maxRollback: 48, checkpoints: 48, wrap, ...(path === "hidden" ? { hidden: { afterMS: 30_000, then: "resync-on-return" as const } } : {}) })
        const watchers = match.peers.map(watch)
        const seated = 1 + (seed % (count - 1))
        const owed = match.peers.map(() => 0)
        let at = 0
        const play = (frames: number) => {
          for (let n = 0; n < frames; n++, at++) {
            for (const [seat, peer] of match.peers.entries()) {
              if (peer.visibility.hidden()) continue
              owed[seat]! += 1
              // A hitch: this page draws nothing for a while, then catches up in one frame.
              if (random.next() < 0.08) continue
              if (random.next() < 0.02) {
                owed[seat]! += random.integer(0, 24)
                continue
              }
              const steps = Math.min(30, owed[seat]!)
              owed[seat] = 0
              for (let step = 0; step < steps; step++) {
                const input = firing(seat, at)
                const advanced = peer.session.advance(input)
                if (!advanced.ok) match.halts.push(`seat ${seat}: ${advanced.error._tag}`)
                else if (advanced.value._tag !== "Waiting" && advanced.value.input !== undefined) peer.recorded.set(advanced.value.input, input)
              }
              watchers[seat]!.read()
            }
            match.hostClock.adjust(stepMS)
          }
        }
        play(100 + seed * 7)
        const before = new Set(saved)
        if (path === "reload") {
          reload(match, seated)
          watchers[seated] = watch(match.peers[seated]!)
        } else {
          match.peers[seated]!.visibility.hide()
          play(30 + seed * 5)
          match.peers[seated]!.visibility.show()
        }
        play(300)
        settleOn(match)
        for (const watcher of watchers) watcher.read()
        expect(match.halts).toEqual([])
        const after = [...saved].filter((tick) => !before.has(tick))
        expect(after.length).toBeGreaterThan(0)
        expectExact(match, watchers, saved, seated, Math.max(...after), path === "reload", 6)
      })
    }
  })
})

