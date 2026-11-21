/**
 * What sessions send over a slow, lossy link (120 ms, up to 60 ms of
 * jitter, 5% lost), driven by `FixedLoop` on pages whose frames sometimes
 * run two or three steps. Before sessions bundled a frame's messages, a
 * page handed its link up to 8 messages in one frame, and 2 peers sent
 * about 140 messages and 62 KiB a second (8 peers: 730 and 290 KiB).
 */
import { describe, expect, it } from "vitest"

import { pressed } from "./game.ts"
import { playOn, setUpMatch } from "./match.ts"
import { held, traffic } from "./traffic.ts"

describe("what a session sends", () => {
  for (const count of [2, 8]) {
    it(`is at most one message per link per frame, however many steps the frame ran: ${count} peers`, { timeout: 60_000 }, () => {
      const measured = traffic({ count, seconds: 10 })
      expect(measured.halts).toEqual([])
      expect(measured.mostInAFrame).toBe(1)
      // The pages played the match together: every seat's checksums agreed, and none fell behind.
      for (const page of measured.pages) expect(page.session.status().verified).toBeGreaterThan(500)
      const ticks = measured.pages.map((page) => page.session.status().tick)
      expect(Math.max(...ticks) - Math.min(...ticks)).toBeLessThan(10)
    })
  }

  it("is lighter: inputs written once per distinct value, acknowledgements as small numbers", { timeout: 60_000 }, () => {
    // An input new almost every frame, and one held for 20 frames.
    expect(traffic({ count: 2, seconds: 10 }).bytesPerSecond).toBeLessThan(25 * 1024)
    expect(traffic({ count: 2, seconds: 10, input: held }).bytesPerSecond).toBeLessThan(17 * 1024)
  })

  it("counts in status() what it handed its links", () => {
    let handed = 0
    let bytes = 0
    const match = setUpMatch({
      mode: "rollback",
      latencyMS: 80,
      loss: 0.05,
      wrap: (seat, link) => ({
        ...link,
        send: (message) => {
          if (seat === 1) {
            handed += 1
            bytes += new TextEncoder().encode(message).length
          }
          link.send(message)
        }
      })
    })
    playOn(match, 300, { input: pressed })
    const sent = match.peers[1]!.session.status().sent
    expect(sent).toEqual({ messages: handed, bytes })
    // `advance` called directly is a frame of its own: one message each.
    expect(sent.messages).toBe(300)
  })
})
