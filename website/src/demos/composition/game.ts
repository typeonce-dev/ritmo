// The composition demo: one guard, four slow steps. The left half is the
// guard walking; the right half is what it has (its components) and which
// systems ran on it this tick. A hit adds Stunned, Move skips the guard
// because its query says `without: [Stunned]`, and when Stunned is removed
// Move picks it up again and Recover hears the removal once.
import { EDGES, makeGuard } from "./guard.ts"

const WIDTH = 960
const HEIGHT = 540
const STEP_MS = 1000 / 60

/** The script, in frames at 60 per second. */
const HIT_AT = 240
const STUN = 240
const SKIP_AT = HIT_AT + 90
const REMOVED_AT = HIT_AT + STUN
const LOOP = REMOVED_AT + 330

const FG = "#f3f1ec"
const MUTED = "#8a8f98"
const ACCENT = "#ff5a36"
const OK = "#7fd18b"
const LINE = "#2f343c"
const BG = "#0e1013"
const PANEL = "#16191e"
const MONO = "'JetBrains Mono', monospace"
const font = (weight: number, size: number) => `${weight} ${size}px ${MONO}`

const STEPS = [
  {
    from: 0,
    say: ["The guard is an entity with three components.", "Move runs on every Guard that is not Stunned."],
    code: "Game.Query({ selection: { … }, with: [Guard], without: [Stunned] })"
  },
  {
    from: HIT_AT,
    say: ["A hit adds a fourth component: Stunned.", "A command inserts it, at a known point in the tick."],
    code: "commands.insert(guard, [Stunned, { frames: 240 }])"
  },
  {
    from: SKIP_AT,
    say: ["Move asks for guards without Stunned, so it skips this one.", "The guard stops. There is no if-statement in Move."],
    code: "Game.Query({ selection: { … }, with: [Guard], without: [Stunned] })"
  },
  {
    from: REMOVED_AT,
    say: ["Stunned runs out and is removed. Move picks the guard up again,", "and Recover hears the removal exactly once."],
    code: "removed: { recovered: Game.System.readRemoved(Stunned) }"
  }
] as const
const stepAt = (frame: number) => STEPS.reduce((at, step, index) => (frame >= step.from ? index : at), 0)

export const mount = async (host: HTMLElement) => {
  const canvas = document.createElement("canvas")
  canvas.width = WIDTH
  canvas.height = HEIGHT
  canvas.style.cssText = `width:100%;height:100%;display:block;background:${BG}`
  host.append(canvas)
  const g = canvas.getContext("2d")!

  let guard = makeGuard()
  let frame = 0
  let raf = 0
  let stopped = false
  let last = performance.now()
  let carry = 0

  const step = () => {
    if (frame === HIT_AT) guard.hit(STUN)
    guard.step()
    frame++
    if (frame >= LOOP) {
      guard = makeGuard()
      frame = 0
    }
  }

  const chip = (text: string, x: number, y: number, lit: boolean) => {
    g.font = font(500, 16)
    const width = g.measureText(text).width + 24
    g.fillStyle = lit ? "rgba(255,90,54,0.2)" : "#1b1f25"
    g.strokeStyle = lit ? ACCENT : LINE
    g.lineWidth = 1.5
    g.beginPath()
    g.roundRect(x, y, width, 30, 15)
    g.fill()
    g.stroke()
    g.fillStyle = lit ? ACCENT : FG
    g.fillText(text, x + 12, y + 20)
  }

  const draw = () => {
    const seen = guard.read()
    const at = stepAt(frame)
    const current = STEPS[at]!

    g.fillStyle = BG
    g.fillRect(0, 0, WIDTH, HEIGHT)

    // Step counter and the sentence for this step
    g.font = font(600, 14)
    g.fillStyle = MUTED
    g.fillText(`step ${at + 1} of ${STEPS.length}`, 40, 40)
    STEPS.forEach((_, index) => {
      g.fillStyle = index === at ? ACCENT : index < at ? MUTED : LINE
      g.fillRect(180 + index * 34, 32, 26, 6)
    })
    current.say.forEach((line, index) => {
      g.font = index === 0 ? font(700, 22) : font(400, 18)
      g.fillStyle = index === 0 ? FG : MUTED
      g.fillText(line, 40, 82 + index * 32)
    })

    // Left: the arena
    const arena = { x: 40, y: 150, width: 520, height: 260 }
    g.strokeStyle = LINE
    g.lineWidth = 2
    g.strokeRect(arena.x, arena.y, arena.width, arena.height)
    const ground = arena.y + arena.height - 40
    g.beginPath()
    g.moveTo(arena.x + 20, ground)
    g.lineTo(arena.x + arena.width - 20, ground)
    g.stroke()
    const x = arena.x + 30 + ((seen.x - EDGES.min) / (EDGES.max - EDGES.min)) * (arena.width - 60)
    const stunned = seen.stunned !== null
    g.fillStyle = stunned ? ACCENT : FG
    g.beginPath()
    g.roundRect(x - 24, ground - 90, 48, 90, 12)
    g.fill()
    g.fillStyle = BG
    g.fillRect(x + 4, ground - 72, 9, 9)
    if (stunned) {
      g.font = font(700, 20)
      g.fillStyle = ACCENT
      g.fillText("✦ ✦", x - 24, ground - 104)
    }
    g.font = font(600, 14)
    g.fillStyle = MUTED
    g.fillText("the game", arena.x, arena.y - 12)

    // Right: what the guard has, and which systems ran on it
    const panel = { x: 600, y: 150, width: 320, height: 260 }
    g.fillStyle = PANEL
    g.beginPath()
    g.roundRect(panel.x, panel.y, panel.width, panel.height, 10)
    g.fill()
    g.font = font(600, 14)
    g.fillStyle = MUTED
    g.fillText("the guard, this tick", panel.x, panel.y - 12)
    g.fillText("components", panel.x + 20, panel.y + 30)
    chip("Guard", panel.x + 20, panel.y + 42, false)
    chip("Position", panel.x + 106, panel.y + 42, false)
    chip("Velocity", panel.x + 20, panel.y + 80, false)
    if (stunned) chip(`Stunned { frames: ${seen.stunned} }`, panel.x + 20, panel.y + 118, frame - HIT_AT < 90)

    g.font = font(600, 14)
    g.fillStyle = MUTED
    g.fillText("systems", panel.x + 20, panel.y + 182)
    g.font = font(600, 16)
    g.fillStyle = FG
    g.fillText("Move", panel.x + 20, panel.y + 210)
    g.fillStyle = seen.ran.move ? OK : ACCENT
    g.fillText(seen.ran.move ? "runs on it" : "skips it", panel.x + 110, panel.y + 210)
    g.fillStyle = FG
    g.fillText("Recover", panel.x + 20, panel.y + 240)
    g.fillStyle = seen.ran.heard > 0 ? ACCENT : MUTED
    g.fillText(`heard ${seen.ran.heard} removal${seen.ran.heard === 1 ? "" : "s"}`, panel.x + 110, panel.y + 240)

    // Bottom: the line of Ritmo behind this step
    g.fillStyle = PANEL
    g.beginPath()
    g.roundRect(40, HEIGHT - 82, WIDTH - 80, 46, 8)
    g.fill()
    g.font = font(400, 16)
    g.fillStyle = FG
    g.fillText(current.code, 60, HEIGHT - 52)
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
