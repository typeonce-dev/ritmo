// Two bot peers of the netcode integration's shooter, joined by memory links
// on a test clock, so a whole match is a pure function of the frame count.
// The latency rises in steps over one loop; each peer keeps a log of which
// ticks it ran on a guess and which a rollback ran again. The page draws this;
// `node --import tsx sim.ts` (from website/) prints it.
import { HostClock, Random } from "@typeonce/ritmo"
import { MemoryNetworkLink, Netcode } from "@typeonce/ritmo-netcode"
import { Game, idle, makeRuntime, Player, playerInput, Position, setup, simulate, step } from "@typeonce/ritmo-integration-netcode/game.ts"
import type { PlayerInput } from "@typeonce/ritmo-integration-netcode/game.ts"

/** Frames in one loop of the story, and the latency from each frame on. */
export const LOOP = 600
export const phases = [
  { from: 0, latencyMS: 0 },
  { from: 120, latencyMS: 60 },
  { from: 270, latencyMS: 130 },
  { from: 430, latencyMS: 220 }
] as const

export const latencyAt = (frame: number): number =>
  phases.findLast((phase) => frame >= phase.from)!.latencyMS

const stepMS = step.dt * 1000

const ReadPlayers = Game.Inspector("Netcode/ReadPlayers", {
  queries: { players: Game.Query({ selection: { position: Game.Query.read(Position), player: Game.Query.read(Player) } }) }
}, ({ queries }) => queries.players.each().map(({ data }) => ({ seat: data.player.get().seat, ...data.position.get() })))

/** What one peer did to one tick: when a rollback last ran it again (frame), and how often. */
export interface TickLog {
  again: number
  lastAgain: number
}

export const makeMatch = () => {
  const hostClock = HostClock.test()
  const links = MemoryNetworkLink.make({ peers: 2, hostClock, seed: 3, latencyMS: 0, jitterMS: 12 })
  if (!links.ok) throw new Error(`links: ${links.error.field}`)
  const peers = ([0, 1] as const).map((seat) => {
    const seats = Netcode.seats(playerInput, { count: 2, idle })
    if (!seats.ok) throw new Error(seats.error.reason)
    const { runtime, screen } = makeRuntime(seats.value.source)
    if (seat === 0 && !runtime.tick(setup).ok) throw new Error("setup failed")
    const session = Netcode.rollback(runtime, { simulate, seats: seats.value, seat, links: [links.value[seat]!], hostClock, step, maxRollback: 16 })
    if (!session.ok) throw new Error(session.error.reason)
    const random = Random.make(11 + seat)
    let held: PlayerInput = idle
    /** A bot: wanders the arena and fires in bursts. */
    const input = (): PlayerInput => {
      const players = runtime.inspect(ReadPlayers)
      const me = players.find((player) => player.seat === seat)
      // Each frame, a small chance to change what it holds: a guess that
      // repeats the last input is right most of the time, as with people
      if (random.next() < 0.04) held = { ...held, dx: random.pick([-1, 0, 1] as const)! }
      if (random.next() < 0.03) held = { ...held, dy: random.pick([-1, 0, 1] as const)! }
      if (random.next() < 0.03) held = { ...held, fire: !held.fire }
      if (me === undefined) return idle
      // Turn back at the walls
      if ((me.x < 30 && held.dx < 0) || (me.x > 170 && held.dx > 0)) held = { ...held, dx: held.dx < 0 ? 1 : -1 }
      if ((me.y < 15 && held.dy < 0) || (me.y > 85 && held.dy > 0)) held = { ...held, dy: held.dy < 0 ? 1 : -1 }
      return held
    }
    return { seat, runtime, screen, session: session.value, input, log: new Map<number, TickLog>(), halts: 0, waiting: false }
  })
  let frame = 0

  /** One frame: both peers advance one step, then the clock moves one step. */
  const advance = () => {
    const latency = latencyAt(frame)
    for (const link of links.value) link.setLatency(latency)
    for (const peer of peers) {
      const advanced = peer.session.advance(peer.input())
      if (!advanced.ok) {
        peer.halts++
        peer.session.resync()
        continue
      }
      peer.waiting = advanced.value._tag !== "Ran"
      if (advanced.value._tag !== "Ran") continue
      const { tick, ticks, again } = advanced.value
      const present = tick - (ticks - again)
      for (let at = present - again; at < present; at++) {
        const entry = peer.log.get(at) ?? { again: 0, lastAgain: -1 }
        entry.again++
        entry.lastAgain = frame
        peer.log.set(at, entry)
      }
    }
    hostClock.adjust(stepMS)
    frame++
  }

  return { peers, advance, frame: () => frame, players: (seat: number) => peers[seat]!.runtime.inspect(ReadPlayers) }
}

export type Match = ReturnType<typeof makeMatch>

// Run alone: play one loop and print what each phase did.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("sim.ts")) {
  const match = makeMatch()
  let before = match.peers.map((peer) => peer.session.status())
  for (const [index, phase] of phases.entries()) {
    const until = phases[index + 1]?.from ?? LOOP
    while (match.frame() < until) match.advance()
    const after = match.peers.map((peer) => peer.session.status())
    console.log(`${phase.latencyMS} ms`, after.map((status, seat) => ({
      seat,
      tick: status.tick,
      confirmed: status.confirmed,
      verified: status.verified,
      rollbacks: status.rollbacks - before[seat]!.rollbacks,
      again: status.again - before[seat]!.again,
      halts: match.peers[seat]!.halts
    })))
    before = after
  }
  console.log("checksums", match.peers.map((peer) => peer.runtime.checksum()))
}
