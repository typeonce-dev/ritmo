// The states demo: the same script plays two fighters side by side. Left, the
// body is one record and a guard lifts it for good; right, the body is an
// entity state and the guard has nothing to lift. Each fighter's live state
// is printed under it.
import { makeFighter, recordBody, recordStep } from "./sim.ts"
import type { RecordBody } from "./sim.ts"

const WIDTH = 960
const HEIGHT = 540
const GROUND = 400
const LOOP = 360
const JUMP_AT = 40
const GUARD_AT = 170
const STEP_MS = 1000 / 60

export const mount = async (host: HTMLElement) => {
  const canvas = document.createElement("canvas")
  canvas.width = WIDTH
  canvas.height = HEIGHT
  canvas.style.cssText = "width:100%;height:100%;display:block;background:#0e1013"
  host.append(canvas)
  const g = canvas.getContext("2d")!

  let frame = 0
  let record: RecordBody = recordBody()
  let ritmo = makeFighter()
  let raf = 0
  let stopped = false
  let last = performance.now()
  let carry = 0

  const reset = () => {
    frame = 0
    record = recordBody()
    ritmo = makeFighter()
  }

  const step = () => {
    const input = { jump: frame === JUMP_AT, guard: frame === GUARD_AT }
    recordStep(record, input)
    ritmo.step(input)
    frame++
    if (frame >= LOOP) reset()
  }

  const fighter = (x: number, height: number, color: string) => {
    const top = GROUND - 90 - Math.min(height, GROUND)
    g.fillStyle = color
    g.beginPath()
    g.roundRect(x - 22, top, 44, 90, 10)
    g.fill()
    g.fillStyle = "#0e1013"
    g.fillRect(x + 4, top + 18, 8, 8)
  }

  const label = (x: number, lines: ReadonlyArray<readonly [string, string]>, y: number) => {
    lines.forEach(([text, color], i) => {
      g.fillStyle = color
      g.font = i === 0 ? "600 16px 'JetBrains Mono', monospace" : "400 15px 'JetBrains Mono', monospace"
      g.fillText(text, x, y + i * 24)
    })
  }

  const draw = () => {
    g.fillStyle = "#0e1013"
    g.fillRect(0, 0, WIDTH, HEIGHT)
    g.strokeStyle = "#2f343c"
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(WIDTH / 2, 20)
    g.lineTo(WIDTH / 2, HEIGHT - 20)
    g.stroke()

    // Titles
    label(32, [["One record", "#f3f1ec"], ["{ grounded, vy }", "#8a8f98"]], 44)
    label(WIDTH / 2 + 32, [["Entity states", "#f3f1ec"], ["ground | air { vy }", "#8a8f98"]], 44)

    // Ground
    g.strokeStyle = "#8a8f98"
    g.beginPath()
    g.moveTo(32, GROUND)
    g.lineTo(WIDTH / 2 - 32, GROUND)
    g.moveTo(WIDTH / 2 + 32, GROUND)
    g.lineTo(WIDTH - 32, GROUND)
    g.stroke()

    const impossible = record.grounded && record.vy !== 0
    fighter(WIDTH / 4, record.y, impossible ? "#ff5a36" : "#f3f1ec")
    const body = ritmo.read()
    fighter((WIDTH * 3) / 4, body.y, "#f3f1ec")

    // Live state under each fighter
    label(32, [
      [`grounded: ${record.grounded}   vy: ${record.vy.toFixed(1)}`, impossible ? "#ff5a36" : "#f3f1ec"],
      [impossible ? "on the ground and rising: can't happen, did" : " ", "#ff5a36"]
    ], GROUND + 44)
    const state = body.contact._tag === "air"
      ? `_tag: "air"   vy: ${body.contact.vy.toFixed(1)}`
      : `_tag: "ground"   platform: null`
    label(WIDTH / 2 + 32, [[state, "#f3f1ec"], [body.contact._tag === "ground" ? "no vy on the ground to set" : " ", "#8a8f98"]], GROUND + 44)

    // What the script just did
    const cue = frame >= JUMP_AT && frame < JUMP_AT + 40 ? "jump" : frame >= GUARD_AT && frame < GUARD_AT + 60 ? "guard" : ""
    if (cue !== "") {
      g.fillStyle = "#ff5a36"
      g.font = "600 18px 'JetBrains Mono', monospace"
      const width = g.measureText(cue).width
      g.fillStyle = "#0e1013"
      g.fillRect(WIDTH / 2 - width / 2 - 12, HEIGHT - 54, width + 24, 32)
      g.fillStyle = "#ff5a36"
      g.fillText(cue, WIDTH / 2 - width / 2, HEIGHT - 32)
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
