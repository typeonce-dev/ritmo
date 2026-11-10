import { describe, expect, it } from "vitest"
import { Clock, HostClock } from "@typeonce/ritmo"
import { MemoryNetworkLink, Netcode } from "@typeonce/ritmo-netcode"
import { Replay, Session } from "@typeonce/ritmo-devtools"
import { Game, idle, Player, PlayerInput, pressed, Seats, simulate, step, Total } from "../../netcode/test/game.ts"

// Two rollback peers over a link with latency and jitter: each rewinds and
// ticks again whenever the other's input for an earlier tick arrives late.

type TestClock = ReturnType<typeof HostClock.test>

const Join = Game.System("RewindTest/Join", { commands: Game.System.commands(Game.System.spawns(Player)) }, ({ commands }) => {
  for (let seat = 0; seat < 2; seat++) commands.spawn(Game.Command.spawn([Player, { seat, x: seat * 100 }]))
})
const setup = Game.Schedule(Join, Game.Schedule.applyDeferred())

const runtimeOf = (source: Netcode.Source<PlayerInput>, hostClock: HostClock.HostClock) => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(Seats, source)),
    resources: { Total: 0, Time: Clock.start(step), Inputs: [idle, idle], Drift: 0 },
    debug: { hostClock }
  })
  if (!made.ok) throw new Error("the starting resources did not validate")
  return made.value
}

/** Two set-up peers of the netcode test game, each in a rollback session. */
const rollbackPeers = (hostClock: TestClock) => {
  const links = MemoryNetworkLink.make({ peers: 2, hostClock, seed: 7, latencyMS: 60, jitterMS: 30 })
  if (!links.ok) throw new Error("links")
  return [0, 1].map((seat) => {
    const seats = Netcode.seats(PlayerInput, { count: 2, idle })
    if (!seats.ok) throw new Error(seats.error.reason)
    const runtime = runtimeOf(seats.value.source, hostClock)
    if (!runtime.tick(setup).ok) throw new Error("setup failed")
    const session = Netcode.rollback(runtime, { simulate, seats: seats.value, seat, links: [links.value[seat]!], hostClock, step })
    if (!session.ok) throw new Error(session.error.reason)
    return { runtime, session: session.value }
  })
}

/** Advances both peers one frame each with `input`, then the clock by a step. */
const advance = (hostClock: TestClock, peers: ReturnType<typeof rollbackPeers>, input: (seat: number) => PlayerInput) => {
  for (const [seat, peer] of peers.entries()) {
    const advanced = peer.session.advance(input(seat))
    if (!advanced.ok) throw new Error(JSON.stringify(advanced.error))
  }
  hostClock.adjust(step.dt * 1000)
}

describe("rewinds on a rollback peer", () => {
  it("a replay recorded on it replays to the recording: each tick is kept as it last ran", () => {
    const hostClock = HostClock.test()
    const peers = rollbackPeers(hostClock)
    const recorder = Replay.recorder(peers[0]!.runtime, {
      schedule: simulate, name: "simulate", keep: 60, step, every: 1, sink: Replay.memorySink(), hostClock
    })
    let rewinds = 0
    const stop = peers[0]!.runtime.debug.observeHost((event) => {
      if (event.type === "rewind" && event.ok) rewinds += 1
    })
    for (let at = 0; at < 300; at++) advance(hostClock, peers, (seat) => at < 200 ? pressed(seat, at) : idle)
    stop()
    const file = recorder.save("match")
    recorder.stop()
    expect(rewinds).toBeGreaterThan(10)
    // Ticks counted once each, however often they ran.
    expect(file.ticks.map((record) => record.tick)).toEqual(file.ticks.map((_, index) => file.start.tick + index + 1))
    const opened = Replay.session((playback) => ({
      runtime: runtimeOf(playback.source(Seats), HostClock.test()),
      schedules: { simulate },
      hostClock: HostClock.test()
    }), file)
    if (!opened.ok) throw new Error(JSON.stringify(opened.error))
    expect(opened.value.play().data.diverged).toEqual([])
  })

  it("why shows each rewind between the changes it separates", () => {
    const hostClock = HostClock.test()
    const peers = rollbackPeers(hostClock)
    const session = Session.make(peers[0]!.runtime, { hostClock, schedules: { simulate } })
    for (let at = 0; at < 40; at++) advance(hostClock, peers, (seat) => pressed(seat, at))
    const why = session.whyResource(Total, { limit: 100 })
    const lines = why.data
    const rewound = lines.filter((line) => line.kind === "rewind")
    expect(rewound.length).toBeGreaterThan(0)
    expect(rewound[0]!.text).toMatch(/^rewind to tick \d+, undoing f\d+-f\d+$/)
    // A change whose value before is not the previous one's after has a rewind line between them.
    const changes = lines.map((line) => line.kind === "resource" ? /resource NetTest\/Total (\S+) -> (\S+)/.exec(line.text) : null)
    let previous: string | undefined
    let rewoundSince = false
    for (const [index, line] of lines.entries()) {
      if (line.kind === "rewind") {
        rewoundSince = true
        continue
      }
      const change = changes[index]
      if (change === null || change === undefined) continue
      if (previous !== undefined && change[1] !== previous) expect({ line: line.text, rewoundSince }).toEqual({ line: line.text, rewoundSince: true })
      previous = change[2]
      rewoundSince = false
    }
    expect(session.report().text).toMatch(/\d+ rewinds/)
    session.close()
  })
})
