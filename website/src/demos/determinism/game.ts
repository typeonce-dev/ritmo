// The determinism demo: two pairs of worlds, stepped together. In each pair
// one copy is drawn as filled balls and the other as rings over them. The
// left pair draws its gusts from a seeded `Random` and stays one picture; the
// right pair calls `Math.random()` and splits at its first gust. Each copy's
// checksum is printed under its pair.
import { BOX, FIRST_GUST, LOOP, makePair, RADIUS } from "./sim.ts"
import type { Kind } from "./sim.ts"

const WIDTH = 960
const HEIGHT = 540
const STEP_MS = 1000 / 60
const SCALE = 0.9
const SIDE = BOX * SCALE
const TOP = 86

const FG = "#f3f1ec"
const MUTED = "#8a8f98"
const ACCENT = "#ff5a36"
const RING = "#9ad1ff"
const LINE = "#2f343c"
const BG = "#0e1013"
const MONO = "'JetBrains Mono', monospace"

const panels: ReadonlyArray<{ readonly kind: Kind; readonly x: number; readonly title: string; readonly sub: string }> = [
  { kind: "exact", x: 50, title: "Random + Ops", sub: "gusts from a seeded Random.draw" },
  { kind: "drifting", x: WIDTH / 2 + 30, title: "Math.random()", sub: "the same gusts, unseeded" }
]

export const mount = async (host: HTMLElement) => {
  const canvas = document.createElement("canvas")
  canvas.width = WIDTH
  canvas.height = HEIGHT
  canvas.style.cssText = `width:100%;height:100%;display:block;background:${BG}`
  host.append(canvas)
  const g = canvas.getContext("2d")!

  let pairs = panels.map((panel) => makePair(panel.kind))
  let raf = 0
  let stopped = false
  let last = performance.now()
  let carry = 0

  const text = (value: string, x: number, y: number, color: string, size = 14, weight = 400) => {
    g.fillStyle = color
    g.font = `${weight} ${size}px ${MONO}`
    g.fillText(value, x, y)
  }

  const draw = () => {
    g.fillStyle = BG
    g.fillRect(0, 0, WIDTH, HEIGHT)
    g.strokeStyle = LINE
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(WIDTH / 2, 20)
    g.lineTo(WIDTH / 2, HEIGHT - 20)
    g.stroke()

    panels.forEach((panel, index) => {
      const { tick, differsSince, copies } = pairs[index]!.read()
      const same = differsSince === null
      text(panel.title, panel.x, 40, FG, 16, 600)
      text(panel.sub, panel.x, 62, MUTED, 13)

      g.strokeStyle = LINE
      g.lineWidth = 2
      g.strokeRect(panel.x, TOP, SIDE, SIDE)

      // Copy one, filled; copy two, a ring on top
      const [first, second] = copies
      g.fillStyle = FG
      for (const ball of first.balls) {
        g.beginPath()
        g.arc(panel.x + ball.x * SCALE, TOP + ball.y * SCALE, RADIUS * SCALE - 2, 0, Math.PI * 2)
        g.fill()
      }
      g.strokeStyle = same ? RING : ACCENT
      g.lineWidth = 2.5
      for (const ball of second.balls) {
        g.beginPath()
        g.arc(panel.x + ball.x * SCALE, TOP + ball.y * SCALE, RADIUS * SCALE, 0, Math.PI * 2)
        g.stroke()
      }

      const below = TOP + SIDE + 26
      text(`copy 1  ${first.checksum}`, panel.x, below, FG, 14)
      text(`copy 2  ${second.checksum}`, panel.x, below + 20, same ? RING : ACCENT, 14)
      const verdict = same
        ? `same for ${tick} ticks`
        : `differs since tick ${differsSince}`
      text(verdict, panel.x + 210, below + 10, same ? RING : ACCENT, 14, 600)
      if (tick < FIRST_GUST) text(`first gust at tick ${FIRST_GUST}`, panel.x + SIDE - 190, TOP - 8, MUTED, 12)
    })
  }

  const tick = (now: number) => {
    if (stopped) return
    carry += Math.min(now - last, 250)
    last = now
    while (carry >= STEP_MS) {
      for (const pair of pairs) pair.step()
      carry -= STEP_MS
      if (pairs[0]!.read().tick >= LOOP) pairs = panels.map((panel) => makePair(panel.kind))
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
