// The composition demo: four guards, one lane each, their components beside
// them. Hits keep landing: a Stunned chip snaps on, Move stops touching that
// guard because its query says `without: [Stunned]`, and when the chip
// drains away the guard walks again. No steps, one line of code on top.
import { EDGES, LANES, STUN, makeGuards } from "./guard.ts"

const WIDTH = 960
const HEIGHT = 540
const STEP_MS = 1000 / 60

const FG = "#f3f1ec"
const MUTED = "#8a8f98"
const ACCENT = "#ff5a36"
const OK = "#7fd18b"
const LINE = "#2f343c"
const BG = "#0e1013"
const CHIP = "#1b1f25"
const MONO = "'JetBrains Mono', monospace"
const font = (weight: number, size: number) => `${weight} ${size}px ${MONO}`

const TOP = 110
const LANE = (HEIGHT - TOP - 20) / LANES
const TRACK = { from: 430, to: 920 }
/** How long a hit's flash stays, in frames. */
const FLASH = 24

export const mount = async (host: HTMLElement) => {
  const canvas = document.createElement("canvas")
  canvas.width = WIDTH
  canvas.height = HEIGHT
  canvas.style.cssText = `width:100%;height:100%;display:block;background:${BG}`
  host.append(canvas)
  const g = canvas.getContext("2d")!

  const guards = makeGuards()
  /** Frames left on each lane's hit flash. */
  const flash = Array.from({ length: LANES }, () => 0)
  let raf = 0
  let stopped = false
  let last = performance.now()
  let carry = 0

  const step = () => {
    for (let lane = 0; lane < LANES; lane++) flash[lane] = Math.max(0, flash[lane]! - 1)
    const hit = guards.step()
    if (hit !== null) flash[hit] = FLASH
  }

  const chip = (text: string, x: number, y: number, style: "on" | "lit" | "empty", fill = 1) => {
    g.font = font(500, 14)
    const width = g.measureText(text).width + 20
    g.lineWidth = 1.5
    g.beginPath()
    g.roundRect(x, y, width, 28, 14)
    if (style === "empty") {
      g.setLineDash([4, 4])
      g.strokeStyle = LINE
      g.stroke()
      g.setLineDash([])
      g.fillStyle = LINE
    } else {
      g.fillStyle = style === "lit" ? "rgba(255,90,54,0.18)" : CHIP
      g.fill()
      // How much of the stun is left, drained from the right
      if (style === "lit") {
        g.save()
        g.clip()
        g.fillStyle = "rgba(255,90,54,0.35)"
        g.fillRect(x, y, width * fill, 28)
        g.restore()
      }
      g.strokeStyle = style === "lit" ? ACCENT : LINE
      g.stroke()
      g.fillStyle = FG
    }
    g.fillText(text, x + 10, y + 19)
    return x + width + 8
  }

  const draw = () => {
    const seen = guards.read()
    const walking = seen.guards.filter((guard) => guard.stunned === null).length

    g.fillStyle = BG
    g.fillRect(0, 0, WIDTH, HEIGHT)

    // The one line that decides who moves
    g.font = font(700, 20)
    g.fillStyle = FG
    g.fillText("Move", 40, 58)
    g.font = font(400, 20)
    g.fillStyle = MUTED
    const query = "Query({ with: [Guard], without: [Stunned] })"
    g.fillText(query, 110, 58)
    g.font = font(600, 16)
    g.fillStyle = OK
    g.textAlign = "right"
    g.fillText(`runs on ${walking} of ${LANES}`, WIDTH - 40, 58)
    g.textAlign = "left"

    for (const guard of seen.guards) {
      const y = TOP + guard.lane * LANE
      const middle = y + LANE / 2
      const stunned = guard.stunned !== null

      g.strokeStyle = LINE
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(40, y + LANE)
      g.lineTo(WIDTH - 40, y + LANE)
      g.stroke()

      // What the guard holds: three chips, and a slot for Stunned
      let x = chip("Guard", 40, middle - 14, "on")
      x = chip("Position", x, middle - 14, "on")
      x = chip("Velocity", x, middle - 14, "on")
      if (stunned) chip("Stunned", x, middle - 14, "lit", guard.stunned! / STUN)
      else chip("Stunned", x, middle - 14, "empty")

      // The guard on its track
      const at = TRACK.from + ((guard.x - EDGES.min) / (EDGES.max - EDGES.min)) * (TRACK.to - TRACK.from)
      const flashing = flash[guard.lane]!
      if (flashing > 0) {
        g.strokeStyle = ACCENT
        g.globalAlpha = flashing / FLASH
        g.lineWidth = 3
        g.beginPath()
        g.arc(at, middle, 22 + (FLASH - flashing) * 1.5, 0, Math.PI * 2)
        g.stroke()
        g.globalAlpha = 1
      }
      g.fillStyle = stunned ? ACCENT : FG
      g.beginPath()
      g.roundRect(at - 16, middle - 26, 32, 52, 9)
      g.fill()
      if (stunned) {
        g.font = font(700, 14)
        g.fillStyle = ACCENT
        g.fillText("✦ ✦", at - 18, middle - 34)
      }
    }
  }

  const tick = (now: number) => {
    if (stopped) return
    carry += Math.min(now - last, 250)
    last = now
    while (carry >= STEP_MS) {
      step()
      carry -= STEP_MS
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
