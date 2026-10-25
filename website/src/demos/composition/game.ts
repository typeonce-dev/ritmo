// The composition demo: a village fire where the components are the picture.
// Each villager is drawn as a stack of blocks, one per component: white is
// Villager, orange Burning, blue Wet. A system inserting a component drops a
// block onto the stack; removing one knocks it off. Each rule on the right
// is drawn as the blocks its query asks for (crossed out: `without`), with
// how many villagers it matches right now. The card shows one villager whole.
import { AREA, FOUNTAIN, makeVillage } from "./fire.ts"

const WIDTH = 960
const HEIGHT = 540
const STEP_MS = 1000 / 60
/** After the last fire is out, hold the calm this long, then start again. */
const HOLD = 200
/** How long a block takes to drop on or fall off, in frames. */
const SNAP = 14

const FG = "#f3f1ec"
const MUTED = "#8a8f98"
const FIRE = "#ff5a36"
const WATER = "#5aa9ff"
const GREY = "#4b515b"
const LINE = "#2f343c"
const BG = "#0e1013"
const PANEL = "#16191e"
const MONO = "'JetBrains Mono', monospace"
const font = (weight: number, size: number) => `${weight} ${size}px ${MONO}`

const SQUARE = { x: 20, y: 76 }
const BLOCK = 16

/** When each villager last gained or lost a block, to animate the snap. */
type Change = { burnOn: number; burnOff: number; wetOn: number; burning: boolean; wet: boolean }

/** One glyph in a rule: a component block, crossed out when the query excludes it, or a word. */
type Glyph = { block: string; crossed?: boolean; sign?: "+" | "−" } | { word: string }
const RULES: ReadonlyArray<{ name: string; glyphs: ReadonlyArray<Glyph> }> = [
  { name: "Wander", glyphs: [{ block: FG }, { block: FIRE, crossed: true }, { word: "→ stroll" }] },
  {
    name: "Spread",
    glyphs: [{ block: FG }, { block: FIRE, crossed: true }, { block: WATER, crossed: true }, { word: "near" }, { block: FIRE }, { word: "→" }, { block: FIRE, sign: "+" }]
  },
  { name: "Panic", glyphs: [{ block: FG }, { block: FIRE }, { word: "→ run to water" }] },
  {
    name: "Douse",
    glyphs: [{ block: FG }, { block: FIRE }, { word: "at water →" }, { block: FIRE, sign: "−" }, { block: WATER, sign: "+" }]
  }
]

const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3

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
  let changes = new Map<number, Change>()
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
    for (const villager of seen.villagers) {
      const change = changes.get(villager.id) ?? { burnOn: -99, burnOff: -99, wetOn: -99, burning: false, wet: false }
      if (villager.burning && !change.burning) change.burnOn = frame
      if (!villager.burning && change.burning) change.burnOff = frame
      if (villager.wet && !change.wet) change.wetOn = frame
      change.burning = villager.burning
      change.wet = villager.wet
      changes.set(villager.id, change)
    }
    const burning = seen.villagers.filter((villager) => villager.burning).length
    for (let rule = 0; rule < glow.length; rule++) glow[rule] = Math.max(0, glow[rule]! - 1)
    if (seen.villagers.length > burning) glow[0] = 20
    if (seen.fired.spread > 0) glow[1] = 40
    if (burning > 0) glow[2] = 20
    if (seen.fired.douse > 0) glow[3] = 40
    if (burning > 0) started = true
    calm = started && burning === 0 ? calm + 1 : 0
    if (calm > HOLD) {
      village = makeVillage()
      changes = new Map()
      frame = 0
      calm = 0
      started = false
    }
  }

  const block = (x: number, y: number, size: number, color: string, alpha = 1) => {
    g.globalAlpha = alpha
    g.fillStyle = color
    g.beginPath()
    g.roundRect(x, y, size, size, size / 4)
    g.fill()
    g.globalAlpha = 1
  }

  /** A villager: a stack of blocks, bottom up, each dropping on or falling off. */
  const villager = (cx: number, base: number, change: Change, size: number) => {
    block(cx - size / 2, base - size, size, FG)
    let top = base - size
    const layer = (color: string, on: number, present: boolean) => {
      if (present) {
        const t = ease((frame - on) / SNAP)
        block(cx - size / 2, top - size - 1 - (1 - t) * size * 2.5, size, color, t)
        top -= size + 1
      }
    }
    layer(FIRE, change.burnOn, change.burning)
    // Burning knocked off: it tumbles sideways and fades
    if (!change.burning && frame - change.burnOff < SNAP * 2) {
      const t = (frame - change.burnOff) / (SNAP * 2)
      block(cx - size / 2 + t * size * 2, top - size - 1 + t * size * 1.5, size, FIRE, 1 - t)
    }
    layer(WATER, change.wetOn, change.wet)
  }

  const draw = () => {
    const seen = village.read()
    const burning = seen.villagers.filter((villager) => villager.burning).length
    const wet = seen.villagers.filter((villager) => villager.wet).length
    const counts = [seen.villagers.length - burning, seen.villagers.length - burning - wet, burning, burning]

    g.fillStyle = BG
    g.fillRect(0, 0, WIDTH, HEIGHT)

    g.font = font(700, 22)
    g.fillStyle = FG
    g.fillText("A villager is the components it holds.", 40, 46)
    // The key: one colour per component
    g.font = font(600, 14)
    let key = 610
    for (const [name, color] of [["Villager", FG], ["Burning", FIRE], ["Wet", WATER]] as const) {
      block(key, 33, 16, color)
      g.fillStyle = color
      g.fillText(name, key + 22, 46)
      key += 22 + g.measureText(name).width + 22
    }

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

    const ordered = [...seen.villagers].sort((a, b) => a.y - b.y)
    for (const one of ordered) {
      const change = changes.get(one.id)
      if (change === undefined) continue
      const x = SQUARE.x + one.x
      const y = SQUARE.y + one.y + BLOCK / 2
      if (one.burning) {
        g.fillStyle = "rgba(255,90,54,0.14)"
        g.beginPath()
        g.arc(x, y - BLOCK, 24, 0, Math.PI * 2)
        g.fill()
      }
      villager(x, y, change, BLOCK)
      // The one the card below the rules shows
      if (one.id === 0) {
        g.strokeStyle = FG
        g.lineWidth = 1.5
        g.setLineDash([3, 3])
        g.beginPath()
        g.arc(x, y - BLOCK * 1.2, BLOCK * 2.1, 0, Math.PI * 2)
        g.stroke()
        g.setLineDash([])
      }
    }

    // The rules, drawn as the blocks their queries ask for
    const panel = { x: 650, y: SQUARE.y, width: 290 }
    let y = panel.y
    RULES.forEach((rule, index) => {
      const lit = glow[index]! / 40
      const height = 64
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
      g.fillText(rule.name, panel.x + 14, y + 23)
      g.font = font(600, 14)
      g.textAlign = "right"
      g.fillText(`matches ${counts[index]}`, panel.x + panel.width - 14, y + 23)
      g.textAlign = "left"
      let x = panel.x + 14
      const row = y + 36
      for (const glyph of rule.glyphs) {
        if ("word" in glyph) {
          g.font = font(400, 13)
          g.fillStyle = MUTED
          g.fillText(glyph.word, x, row + 13)
          x += g.measureText(glyph.word).width + 7
          continue
        }
        if (glyph.sign !== undefined) {
          g.font = font(700, 14)
          g.fillStyle = FG
          g.fillText(glyph.sign, x, row + 13)
          x += 11
        }
        block(x, row, 16, glyph.block, glyph.crossed === true ? 0.35 : 1)
        if (glyph.crossed === true) {
          g.strokeStyle = FG
          g.lineWidth = 2
          g.beginPath()
          g.moveTo(x - 2, row + 18)
          g.lineTo(x + 18, row - 2)
          g.stroke()
        }
        x += 23
      }
      y += height + 8
    })

    // One villager, whole: every component it holds, named
    const card = { x: panel.x, y, width: panel.width, height: SQUARE.y + AREA.height - y }
    g.fillStyle = PANEL
    g.beginPath()
    g.roundRect(card.x, card.y, card.width, card.height, 8)
    g.fill()
    g.font = font(600, 13)
    g.fillStyle = MUTED
    g.fillText("the circled villager, whole", card.x + 14, card.y + 22)
    const first = changes.get(0)
    const names: Array<{ name: string; color: string; text: string; on: number }> = [
      { name: "Villager", color: FG, text: BG, on: -99 },
      { name: "Position", color: GREY, text: FG, on: -99 },
      { name: "Velocity", color: GREY, text: FG, on: -99 }
    ]
    if (first?.burning === true) names.push({ name: "Burning", color: FIRE, text: BG, on: first.burnOn })
    if (first?.wet === true) names.push({ name: "Wet", color: WATER, text: BG, on: first.wetOn })
    names.forEach((entry, index) => {
      const column = index % 3
      const line = Math.floor(index / 3)
      const t = ease((frame - entry.on) / SNAP)
      const bx = card.x + 14 + column * 90
      const by = card.y + 36 + line * 36 - (1 - t) * 30
      g.globalAlpha = t
      g.fillStyle = entry.color
      g.beginPath()
      g.roundRect(bx, by, 84, 28, 6)
      g.fill()
      g.font = font(600, 13)
      g.fillStyle = entry.text
      g.fillText(entry.name, bx + 9, by + 19)
      g.globalAlpha = 1
    })
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
