// The online demo that plays itself: two bot peers of one match over a fake
// network whose latency rises every few seconds. Each peer shows its own
// screen and a strip of its last ticks: run on real input, run on a guess,
// run again by a rollback, and the last tick both checksums agree on.
import { arena, draw as drawShots } from "@typeonce/ritmo-integration-netcode/game.ts"
import { latencyAt, LOOP, makeMatch, phases } from "./sim.ts"
import type { Match } from "./sim.ts"

const WIDTH = 960
const HEIGHT = 540
const STEP_MS = 1000 / 60
/** Wall-clock time the closing totals stay up before the story starts again. */
const HOLD_MS = 2600
/** How long a tick run again by a rollback stays lit. */
const FLASH_FRAMES = 24
const SCALE = 2
const CELLS = 84
const CELL = 9

const color = {
  background: "#0e1013",
  floor: "#16191e",
  edge: "#2f343c",
  ink: "#f3f1ec",
  muted: "#8a8f98",
  confirmed: "#3a3f48",
  agree: "#5fd38d",
  seats: ["#ff5a36", "#4fb3ff"],
  /** A tick a rollback ran again, once it settled. */
  seatsDim: ["#7a3424", "#285b80"]
} as const

const captions: Record<number, string> = {
  0: "No latency: every input arrives in time, nothing is guessed",
  60: "Input arrives late: each peer guesses it and plays on",
  130: "A wrong guess rolls back: the ticks since run again",
  220: "More latency, longer rollbacks: the checksums still agree"
}

const font = (size: number, weight = 400) => `${weight} ${size}px 'JetBrains Mono', monospace`

export const mount = async (host: HTMLElement) => {
  const canvas = document.createElement("canvas")
  canvas.width = WIDTH
  canvas.height = HEIGHT
  canvas.style.cssText = `width:100%;height:100%;display:block;background:${color.background}`
  host.append(canvas)
  const g = canvas.getContext("2d")!

  let match: Match = makeMatch()
  let held = 0
  let raf = 0
  let stopped = false
  let last = performance.now()
  let carry = 0

  const screen = (seat: number, x: number, y: number) => {
    const peer = match.peers[seat]!
    g.fillStyle = color.ink
    g.font = font(15, 600)
    g.fillText(`Peer ${seat === 0 ? "A" : "B"}`, x, y - 10)
    g.fillStyle = color.muted
    g.font = font(13)
    g.fillText(`plays seat ${seat}, its own screen`, x + 70, y - 10)
    g.fillStyle = color.floor
    g.fillRect(x, y, arena.width * SCALE, arena.height * SCALE)
    g.strokeStyle = color.edge
    g.strokeRect(x + 0.5, y + 0.5, arena.width * SCALE - 1, arena.height * SCALE - 1)
    for (const player of match.players(seat)) {
      g.fillStyle = color.seats[player.seat]!
      g.fillRect(x + player.x * SCALE - 7, y + player.y * SCALE - 7, 14, 14)
    }
    // Draws outside the simulation, so a rollback reaches it as changes
    peer.runtime.tick(drawShots)
    g.fillStyle = color.ink
    for (const shot of peer.screen.sprites.values()) g.fillRect(x + shot.x * SCALE - 2, y + shot.y * SCALE - 2, 4, 4)
  }

  const strip = (seat: number, x: number, y: number) => {
    const peer = match.peers[seat]!
    const status = peer.session.status()
    const end = status.tick
    const first = end - CELLS
    const frame = match.frame()
    g.fillStyle = color.ink
    g.font = font(13, 600)
    g.fillText(`Peer ${seat === 0 ? "A" : "B"}`, x, y + 19)
    const left = x + 64
    for (let index = 0; index < CELLS; index++) {
      const tick = first + index
      if (tick < 0) continue
      const cx = left + index * CELL
      const entry = peer.log.get(tick)
      const lit = entry !== undefined && frame - entry.lastAgain < FLASH_FRAMES
      if (tick >= status.confirmed) {
        // Run on a guess: outlined, it may still run again
        g.strokeStyle = color.seats[seat]!
        g.lineWidth = 1.5
        g.strokeRect(cx + 1, y + 4, CELL - 3, 22)
        if (lit) {
          g.fillStyle = color.seats[seat]!
          g.fillRect(cx + 1, y + 4, CELL - 3, 22)
        }
      } else {
        g.fillStyle = lit ? color.seats[seat]! : entry !== undefined ? color.seatsDim[seat]! : color.confirmed
        g.fillRect(cx, y + 3, CELL - 1, 24)
      }
    }
    // The last tick both peers' checksums agree on
    if (status.verified >= first) {
      const vx = left + (status.verified - first) * CELL + CELL - 1
      g.fillStyle = color.agree
      g.fillRect(vx, y - 2, 2, 34)
    }
    g.font = font(13)
    g.fillStyle = color.muted
    g.fillText(`tick ${status.tick}`, left + CELLS * CELL + 10, y + 19)
    g.fillStyle = color.ink
    g.fillText(`rollbacks ${status.rollbacks}`, x + 64, y + 50)
    g.fillText(`ticks run again ${status.again}`, x + 230, y + 50)
    g.fillStyle = color.agree
    g.fillText(status.verified < 0 ? "agree: not yet" : `agree up to tick ${status.verified}`, x + 470, y + 50)
  }

  const header = () => {
    const frame = match.frame()
    const latency = latencyAt(Math.min(frame, LOOP - 1))
    g.fillStyle = color.muted
    g.font = font(14)
    g.fillText("latency", 32, 40)
    phases.forEach((phase, index) => {
      const on = phase.latencyMS === latency
      const px = 110 + index * 92
      g.fillStyle = on ? color.ink : color.floor
      g.beginPath()
      g.roundRect(px, 22, 82, 26, 6)
      g.fill()
      g.fillStyle = on ? color.background : color.muted
      g.font = font(14, on ? 600 : 400)
      g.fillText(`${phase.latencyMS} ms`, px + 14, 40)
    })
    g.fillStyle = color.ink
    g.font = font(16, 600)
    g.fillText(captions[latency] ?? "", 32, 80)
  }

  const legend = (y: number) => {
    g.font = font(13)
    let x = 96
    const item = (label: string, paint: (x: number) => void) => {
      paint(x)
      g.fillStyle = color.muted
      g.fillText(label, x + 16, y + 11)
      x += g.measureText(label).width + 44
    }
    item("real input", (at) => {
      g.fillStyle = color.confirmed
      g.fillRect(at, y, 9, 14)
    })
    item("guessed", (at) => {
      g.strokeStyle = color.ink
      g.lineWidth = 1.5
      g.strokeRect(at + 1, y + 1, 7, 12)
    })
    item("run again by a rollback", (at) => {
      g.fillStyle = color.ink
      g.fillRect(at, y, 9, 14)
    })
    item("checksums agree", (at) => {
      g.fillStyle = color.agree
      g.fillRect(at + 4, y - 2, 2, 18)
    })
  }

  const totals = () => {
    const statuses = match.peers.map((peer) => peer.session.status())
    const rollbacks = statuses.reduce((sum, status) => sum + status.rollbacks, 0)
    const again = statuses.reduce((sum, status) => sum + status.again, 0)
    const halts = match.peers.reduce((sum, peer) => sum + peer.halts, 0)
    g.fillStyle = "rgba(14, 16, 19, 0.88)"
    g.fillRect(0, 96, WIDTH, HEIGHT - 96)
    g.textAlign = "center"
    g.fillStyle = color.ink
    g.font = font(26, 600)
    g.fillText(`${rollbacks} rollbacks, ${again} ticks run again`, WIDTH / 2, 230)
    g.fillStyle = color.agree
    g.font = font(20)
    g.fillText(`Both peers agree up to tick ${Math.min(...statuses.map((status) => status.verified))}`, WIDTH / 2, 280)
    g.fillStyle = color.muted
    g.font = font(16)
    g.fillText(`${halts} desyncs, over ${LOOP} ticks and four latencies`, WIDTH / 2, 320)
    g.textAlign = "start"
  }

  const draw = () => {
    g.fillStyle = color.background
    g.fillRect(0, 0, WIDTH, HEIGHT)
    header()
    screen(0, 64, 124)
    screen(1, WIDTH - 64 - arena.width * SCALE, 124)
    strip(0, 32, 346)
    strip(1, 32, 416)
    legend(506)
    if (match.frame() >= LOOP) totals()
  }

  const tick = (now: number) => {
    if (stopped) return
    const elapsed = Math.min(now - last, 250)
    last = now
    if (match.frame() >= LOOP) {
      held += elapsed
      if (held >= HOLD_MS) {
        match = makeMatch()
        held = 0
        carry = 0
      }
    } else {
      carry += elapsed
      while (carry >= STEP_MS && match.frame() < LOOP) {
        match.advance()
        carry -= STEP_MS
      }
    }
    draw()
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  return () => {
    stopped = true
    cancelAnimationFrame(raf)
    host.replaceChildren()
  }
}
