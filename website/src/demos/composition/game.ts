// The composition demo: a village fire made of components. A spark gives one
// villager Burning; four small systems do the rest (Wander, Spread, Panic,
// Douse), and each rule on the right lights up when it acts. The point: the
// behaviour is what entities hold, and changes when that changes.
import { AREA, FOUNTAIN, REACH, makeVillage } from "./fire.ts"

const WIDTH = 960
const HEIGHT = 540
const STEP_MS = 1000 / 60
/** After the last fire is out, hold the calm this long, then start again. */
const HOLD = 180

const FG = "#f3f1ec"
const MUTED = "#8a8f98"
const FIRE = "#ff5a36"
const WATER = "#5aa9ff"
const LINE = "#2f343c"
const BG = "#0e1013"
const PANEL = "#16191e"
const MONO = "'JetBrains Mono', monospace"
const font = (weight: number, size: number) => `${weight} ${size}px ${MONO}`

const SQUARE = { x: 20, y: 96 }

type Part = readonly [text: string, color: string]
const RULES: ReadonlyArray<{ name: string; lines: ReadonlyArray<ReadonlyArray<Part>> }> = [
  { name: "Wander", lines: [[["without ", MUTED], ["Burning", FIRE], [" → stroll", MUTED]]] },
  {
    name: "Spread",
    lines: [[["near ", MUTED], ["Burning", FIRE], [", without ", MUTED], ["Wet", WATER]], [["→ insert ", MUTED], ["Burning", FIRE]]]
  },
  { name: "Panic", lines: [[["with ", MUTED], ["Burning", FIRE], [" → run to water", MUTED]]] },
  {
    name: "Douse",
    lines: [[["with ", MUTED], ["Burning", FIRE], [", at water", MUTED]], [["→ remove ", MUTED], ["Burning", FIRE], [", insert ", MUTED], ["Wet", WATER]]]
  }
]

export const mount = async (host: HTMLElement) => {
  const canvas = document.createElement("canvas")
  canvas.width = WIDTH
  canvas.height = HEIGHT
  canvas.style.cssText = `width:100%;height:100%;display:block;background:${BG}`
  host.append(canvas)
  const g = canvas.getContext("2d")!

  let village = makeVillage()
  let frame = 0
  let calm = 0
  let started = false
  /** Glow left on each rule, in frames. */
  const glow = [0, 0, 0, 0]
  let raf = 0
  let stopped = false
  let last = performance.now()
  let carry = 0

  const step = () => {
    village.step()
    frame++
    const seen = village.read()
    const burning = seen.villagers.filter((villager) => villager.burning).length
    for (let rule = 0; rule < glow.length; rule++) glow[rule] = Math.max(0, glow[rule]! - 1)
    glow[0] = seen.villagers.length - burning > 0 ? 20 : glow[0]!
    if (seen.fired.spread > 0) glow[1] = 40
    if (burning > 0) glow[2] = 20
    if (seen.fired.douse > 0) glow[3] = 40
    if (burning > 0) started = true
    calm = started && burning === 0 ? calm + 1 : 0
    if (calm > HOLD) {
      village = makeVillage()
      frame = 0
      calm = 0
      started = false
    }
  }

  const parts = (line: ReadonlyArray<Part>, x: number, y: number) => {
    g.font = font(400, 13)
    for (const [text, color] of line) {
      g.fillStyle = color
      g.fillText(text, x, y)
      x += g.measureText(text).width
    }
  }

  const draw = () => {
    const seen = village.read()
    const burning = seen.villagers.filter((villager) => villager.burning).length
    const wet = seen.villagers.filter((villager) => villager.wet).length

    g.fillStyle = BG
    g.fillRect(0, 0, WIDTH, HEIGHT)

    g.font = font(700, 22)
    g.fillStyle = FG
    g.fillText("Nothing scripts this fire.", 40, 46)
    g.font = font(400, 16)
    g.fillStyle = MUTED
    g.fillText("Four systems, each reading what a villager holds.", 40, 74)

    // The square and the fountain
    g.strokeStyle = LINE
    g.lineWidth = 2
    g.strokeRect(SQUARE.x, SQUARE.y, AREA.width, AREA.height)
    g.fillStyle = "rgba(90,169,255,0.15)"
    g.strokeStyle = WATER
    g.beginPath()
    g.arc(SQUARE.x + FOUNTAIN.x, SQUARE.y + FOUNTAIN.y, FOUNTAIN.radius, 0, Math.PI * 2)
    g.fill()
    g.stroke()

    const flicker = (frame % 12) / 12
    for (const villager of seen.villagers) {
      const x = SQUARE.x + villager.x
      const y = SQUARE.y + villager.y
      if (villager.burning) {
        g.fillStyle = "rgba(255,90,54,0.12)"
        g.beginPath()
        g.arc(x, y, REACH, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = "#ffb03a"
        g.beginPath()
        g.moveTo(x - 6, y - 7)
        g.lineTo(x, y - 20 - flicker * 5)
        g.lineTo(x + 6, y - 7)
        g.fill()
      }
      g.fillStyle = villager.burning ? FIRE : villager.wet ? WATER : FG
      g.beginPath()
      g.arc(x, y, 9, 0, Math.PI * 2)
      g.fill()
    }

    // The rules, each lit while it acts
    const panel = { x: 650, y: SQUARE.y, width: 290 }
    let y = panel.y
    RULES.forEach((rule, index) => {
      const lit = glow[index]! / 40
      const height = 30 + rule.lines.length * 20
      g.fillStyle = PANEL
      g.beginPath()
      g.roundRect(panel.x, y, panel.width, height, 8)
      g.fill()
      if (lit > 0) {
        g.strokeStyle = `rgba(243,241,236,${Math.min(1, lit * 1.5)})`
        g.lineWidth = 1.5
        g.stroke()
      }
      g.font = font(700, 15)
      g.fillStyle = lit > 0 ? FG : MUTED
      g.fillText(rule.name, panel.x + 14, y + 22)
      rule.lines.forEach((line, row) => parts(line, panel.x + 14, y + 44 + row * 20))
      y += height + 12
    })

    // What the village holds right now
    g.font = font(600, 14)
    const counts: ReadonlyArray<Part> = [[`Burning ${burning}`, FIRE], ["   ", MUTED], [`Wet ${wet}`, WATER]]
    let x = panel.x + 14
    for (const [text, color] of counts) {
      g.fillStyle = color
      g.fillText(text, x, SQUARE.y + AREA.height - 4)
      x += g.measureText(text).width
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
