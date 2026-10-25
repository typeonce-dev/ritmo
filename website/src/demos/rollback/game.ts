// The rollback demo: two peers of the netcode integration's shooter in one
// page, each with its own runtime, session, and screen, joined by memory
// links with the latency picked in the corner. You play seat 0; a bot plays
// seat 1. Both views run the same match: when your input reaches the other
// peer late, it rolls back and runs the ticks again, and the HUD counts it.
import { type HostClock, Random } from "@typeonce/ritmo"
import * as FixedLoop from "@typeonce/ritmo/FixedLoop"
import * as Result from "@typeonce/ritmo/Result"
import { BrowserHostClock, BrowserTickSource, Keyboard } from "@typeonce/ritmo-browser"
import { MemoryNetworkLink, Netcode } from "@typeonce/ritmo-netcode"
import { arena, draw, Game, idle, makeRuntime, Player, playerInput, Position, setup, simulate, step } from "@typeonce/ritmo-integration-netcode/game.ts"
import type { PlayerInput, Screen } from "@typeonce/ritmo-integration-netcode/game.ts"

const palette = {
  background: "#0e1013",
  floor: "#16191e",
  edge: "#3a3f48",
  ink: "#f3f1ec",
  muted: "#8a8f98",
  seats: ["#ff5a36", "#4fb3ff"]
} as const

const SCALE = 3
const latencies = [0, 50, 100, 200] as const

const bindings = {
  move: Keyboard.vector({ up: ["w", "ArrowUp"], down: ["s", "ArrowDown"], left: ["a", "ArrowLeft"], right: ["d", "ArrowRight"] }),
  fire: [" "]
} as const

const ReadPlayers = Game.Inspector("Rollback/ReadPlayers", {
  queries: { players: Game.Query({ selection: { position: Game.Query.read(Position), player: Game.Query.read(Player) } }) }
}, ({ queries }) => queries.players.each().map(({ data }) => ({ seat: data.player.get().seat, ...data.position.get() })))

const axis = (value: number): -1 | 0 | 1 => value > 0.5 ? 1 : value < -0.5 ? -1 : 0

interface Peer {
  readonly runtime: ReturnType<typeof makeRuntime>["runtime"]
  readonly screen: Screen
  readonly session: Netcode.Session<PlayerInput, unknown>
}

/** Two peers over links with `latencyMS`, seat 0 set up, both waiting for the first save. */
const makeMatch = (latencyMS: number, hostClock: HostClock.HostClock): readonly [Peer, Peer] => {
  const links = MemoryNetworkLink.make({ peers: 2, hostClock, seed: 1, latencyMS, jitterMS: latencyMS / 3 })
  if (!links.ok) throw new Error(`links: ${links.error.field}`)
  const peer = (seat: 0 | 1): Peer => {
    const seats = Netcode.seats(playerInput, { count: 2, idle })
    if (!seats.ok) throw new Error(seats.error.reason)
    const { runtime, screen } = makeRuntime(seats.value.source)
    if (seat === 0 && !runtime.tick(setup).ok) throw new Error("setup failed")
    const session = Netcode.rollback(runtime, { simulate, seats: seats.value, seat, links: [links.value[seat]!], hostClock, step, maxRollback: 16 })
    if (!session.ok) throw new Error(session.error.reason)
    return { runtime, screen, session: session.value }
  }
  return [peer(0), peer(1)]
}

/** The bot on seat 1: drifts toward your row, wanders, and fires now and then. */
const bot = (random: Random.Random, peer: Peer) => {
  let held: PlayerInput = idle
  return (): PlayerInput => {
    const players = peer.runtime.inspect(ReadPlayers)
    const me = players.find((player) => player.seat === 1)
    const you = players.find((player) => player.seat === 0)
    if (random.next() < 0.08) held = { dx: random.pick([-1, 0, 1] as const)!, dy: 0, fire: false }
    const dy = me === undefined || you === undefined ? 0 : axis((you.y - me.y) / 6)
    return { dx: held.dx, dy, fire: random.next() < 0.12 }
  }
}

export const mount = async (host: HTMLElement): Promise<() => void> => {
  host.innerHTML = ""
  host.style.cssText = `display:grid;place-items:center;height:100%;background:${palette.background};color:${palette.ink};font:13px "JetBrains Mono",monospace`
  const panel = document.createElement("div")
  panel.style.cssText = "display:grid;gap:8px;justify-items:start"
  const picker = document.createElement("label")
  picker.textContent = "Latency "
  const select = document.createElement("select")
  for (const latency of latencies) select.append(new Option(`${latency} ms`, String(latency), latency === 100, latency === 100))
  picker.append(select)
  const canvas = document.createElement("canvas")
  canvas.width = arena.width * SCALE
  canvas.height = arena.height * SCALE * 2 + 40
  canvas.style.cssText = "max-width:100%;max-height:calc(100vh - 60px)"
  panel.append(picker, canvas)
  host.append(panel)
  const context = canvas.getContext("2d")
  if (context === null) throw new Error("no 2D canvas")

  const hostClock = BrowserHostClock.make(window)
  const keyboard = Keyboard.actions(window, bindings)
  let halted = ""
  const yourInput = (): PlayerInput => {
    const keys = keyboard.snapshot()
    return { dx: axis(keys.vectors.move.x), dy: axis(keys.vectors.move.y), fire: keys.actions.fire.held }
  }
  /** Each peer's FixedLoop update: a halt is shown, and answered with a resync. */
  const start = (latencyMS: number) => {
    const match = makeMatch(latencyMS, hostClock)
    const onHalted = (error: Netcode.Halted<unknown>) => {
      halted = `${error._tag}: resyncing`
    }
    const inputs = [yourInput, bot(Random.make(7), match[1])] as const
    return { peers: match, updates: match.map((peer, seat) => peer.session.update({ input: inputs[seat]!, onHalted })) }
  }
  let match = start(Number(select.value))
  select.addEventListener("change", () => {
    match = start(Number(select.value))
    halted = ""
  })

  const drawPeer = (peer: Peer, seat: number, top: number) => {
    context.fillStyle = palette.floor
    context.fillRect(0, top, arena.width * SCALE, arena.height * SCALE)
    context.strokeStyle = palette.edge
    context.strokeRect(0.5, top + 0.5, arena.width * SCALE - 1, arena.height * SCALE - 1)
    for (const player of peer.runtime.inspect(ReadPlayers)) {
      context.fillStyle = palette.seats[player.seat]!
      context.fillRect(player.x * SCALE - 6, top + player.y * SCALE - 6, 12, 12)
    }
    context.fillStyle = palette.ink
    for (const shot of peer.screen.sprites.values()) context.fillRect(shot.x * SCALE - 2, top + shot.y * SCALE - 2, 4, 4)
    const status = peer.session.status()
    context.fillStyle = palette.muted
    context.fillText(
      status.epoch === 0
        ? `seat ${seat}: waiting for the first save`
        : `seat ${seat} · tick ${status.tick} · rollbacks ${status.rollbacks} · ticks run again ${status.again} · checksums agree up to ${status.verified}`,
      8,
      top + arena.height * SCALE + 14
    )
  }

  const loop = FixedLoop.start({
    source: BrowserTickSource.make(window),
    step,
    maxFrameSeconds: 0.25,
    maxStepsPerFrame: 5,
    // One loop drives both peers here, so they never drift apart: a real peer
    // passes its session's `rate` and its update straight to its own loop.
    update: () => {
      for (const update of match.updates) {
        const ran = update()
        if (!ran.ok) return ran
      }
      return Result.success(undefined)
    },
    render: () => {
      context.fillStyle = palette.background
      context.fillRect(0, 0, canvas.width, canvas.height)
      for (const [seat, peer] of match.peers.entries()) {
        if (!peer.runtime.tick(draw).ok) halted = `seat ${seat}: the draw failed`
        drawPeer(peer, seat, seat * (arena.height * SCALE + 20))
      }
      if (halted !== "") {
        context.fillStyle = palette.seats[0]
        context.fillText(halted, 8, canvas.height - 4)
      }
    },
    onFailure: (failure) => {
      halted = failure.kind === "UpdateFailure" ? `the session ended: ${failure.error._tag}` : failure.kind
    }
  })
  if (!loop.ok) throw new Error(loop.error.field)
  return () => {
    loop.value.stop()
    keyboard.dispose()
  }
}
