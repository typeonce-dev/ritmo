import { describe, expect, it } from "vitest"
import { HostClock } from "@typeonce/ritmo"
import { MemoryNetworkLink, NetworkLink } from "@typeonce/ritmo-netcode"

const linksOf = (options: Omit<MemoryNetworkLink.Options, "hostClock">) => {
  const hostClock = HostClock.test()
  const made = MemoryNetworkLink.make({ ...options, hostClock })
  if (!made.ok) throw new Error(made.error.field)
  return { hostClock, links: made.value }
}

describe("MemoryNetworkLink.make", () => {
  it("delivers each message to every other peer after the latency", () => {
    const { hostClock, links } = linksOf({ peers: 3, seed: 1, latencyMS: 50 })
    links[0]!.send("hi")
    hostClock.adjust(49)
    expect(links[1]!.receive()).toEqual([])
    hostClock.adjust(1)
    expect(links[1]!.receive()).toEqual(["hi"])
    expect(links[2]!.receive()).toEqual(["hi"])
    expect(links[0]!.receive()).toEqual([])
    // Received once.
    expect(links[1]!.receive()).toEqual([])
  })

  it("changes one peer's latency for what it sends next, and rejects a negative one", () => {
    const { hostClock, links } = linksOf({ peers: 2, seed: 1, latencyMS: 50 })
    links[0]!.send("slow")
    expect(links[0]!.setLatency(10).ok).toBe(true)
    links[0]!.send("fast")
    links[1]!.send("back")
    hostClock.adjust(10)
    expect(links[1]!.receive()).toEqual(["fast"])
    expect(links[0]!.receive()).toEqual([])
    hostClock.adjust(40)
    expect(links[1]!.receive()).toEqual(["slow"])
    expect(links[0]!.receive()).toEqual(["back"])
    expect(links[0]!.setLatency(-1)).toMatchObject({ ok: false, error: { _tag: "InvalidOptions", field: "latencyMS", value: -1 } })
  })

  it("lets a later message overtake an earlier one, the same way for the same seed", () => {
    const order = (seed: number) => {
      const { hostClock, links } = linksOf({ peers: 2, seed, latencyMS: 10, jitterMS: 100 })
      for (let index = 0; index < 20; index++) links[0]!.send(String(index))
      hostClock.adjust(200)
      return links[1]!.receive()
    }
    expect(order(3)).toEqual(order(3))
    expect(order(3)).not.toEqual(Array.from({ length: 20 }, (_, index) => String(index)))
    expect([...order(3)].sort()).toEqual(Array.from({ length: 20 }, (_, index) => String(index)).sort())
  })

  it("loses a share of the messages", () => {
    const { hostClock, links } = linksOf({ peers: 2, seed: 5, latencyMS: 0, loss: 0.5 })
    for (let index = 0; index < 400; index++) links[0]!.send(String(index))
    hostClock.adjust(1)
    const arrived = links[1]!.receive().length
    expect(arrived).toBeGreaterThan(150)
    expect(arrived).toBeLessThan(250)
  })

  it("closes one peer's link: what it sent is lost, and the others stay open", () => {
    const { hostClock, links } = linksOf({ peers: 2, seed: 1, latencyMS: 10 })
    links[0]!.send("lost")
    links[0]!.close("left")
    links[0]!.send("dropped")
    hostClock.adjust(20)
    expect(links[0]!.status()).toEqual(NetworkLink.closed("left"))
    expect(links[1]!.status()).toEqual(NetworkLink.open)
    expect(links[1]!.receive()).toEqual([])
  })

  it("rejects too few peers, and negative or non-finite timings", () => {
    const hostClock = HostClock.test()
    expect(MemoryNetworkLink.make({ peers: 1, hostClock, seed: 1, latencyMS: 0 })).toMatchObject({ ok: false, error: { field: "peers" } })
    expect(MemoryNetworkLink.make({ peers: 2, hostClock, seed: 1, latencyMS: -1 })).toMatchObject({ ok: false, error: { field: "latencyMS" } })
    expect(MemoryNetworkLink.make({ peers: 2, hostClock, seed: 1, latencyMS: 0, jitterMS: Infinity })).toMatchObject({ ok: false, error: { field: "jitterMS" } })
    expect(MemoryNetworkLink.make({ peers: 2, hostClock, seed: 1, latencyMS: 0, loss: 1 })).toMatchObject({ ok: false, error: { field: "loss" } })
  })
})
