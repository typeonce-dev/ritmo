// The composition demo: one world, three lanes, played left to right. A guard
// is stunned and recovers, a knight is handed a sword that moves with it, and
// an archer drops its target when the target falls. Each entity's live
// components are printed under its lane, and a change flashes when it lands.
import { ARM_AT, FALL_AT, HIT_AT, LANES, LOOP, makeArena, STUN_FRAMES } from "./sim.ts"
import type { Seen } from "./sim.ts"

const WIDTH = 960
const HEIGHT = 540
const LANE = WIDTH / 3
const STEP_MS = 1000 / 60
/** How long a component that just arrived or left stays lit, in ms. */
const FLASH_MS = 1600

const FG = "#f3f1ec"
const MUTED = "#8a8f98"
const ACCENT = "#ff5a36"
const LINE = "#2f343c"
const BG = "#0e1013"
const MONO = "'JetBrains Mono', monospace"

/** Which lane the story is in on a frame. */
const laneAt = (frame: number) => (frame < ARM_AT - 30 ? 0 : frame < FALL_AT - 30 ? 1 : 2)

export const mount = async (host: HTMLElement) => {
  const canvas = document.createElement("canvas")
  canvas.width = WIDTH
  canvas.height = HEIGHT
  canvas.style.cssText = `width:100%;height:100%;display:block;background:${BG}`
  host.append(canvas)
  const g = canvas.getContext("2d")!

  let arena = makeArena()
  let raf = 0
  let stopped = false
  let last = performance.now()
  let carry = 0
  /** When each `#id Component` line first appeared, and lines that just left. */
  let arrived = new Map<string, number>()
  let left = new Map<string, { readonly line: string; readonly at: number }>()
  let previous = new Map<number, ReadonlyArray<string>>()

  const reset = () => {
    arena = makeArena()
    arrived = new Map()
    left = new Map()
    previous = new Map()
  }

  const keyOf = (line: string) => line.split(" ")[0]!

  /** Notes which component lines came and went since the last frame. */
  const track = (entities: ReadonlyArray<Seen>, now: number) => {
    const current = new Map<number, ReadonlyArray<string>>()
    for (const entity of entities) {
      current.set(entity.id, entity.components)
      const before = previous.get(entity.id)
      for (const line of entity.components) {
        const key = `${entity.id} ${keyOf(line)}`
        if (!arrived.has(key)) arrived.set(key, before === undefined && previous.size === 0 ? -Infinity : now)
      }
      for (const line of before ?? []) {
        const key = `${entity.id} ${keyOf(line)}`
        if (!entity.components.some((next) => keyOf(next) === keyOf(line))) {
          left.set(key, { line, at: now })
          arrived.delete(key)
        }
      }
    }
    previous = current
  }

  const text = (value: string, x: number, y: number, color: string, size = 14, weight = 400) => {
    g.fillStyle = color
    g.font = `${weight} ${size}px ${MONO}`
    g.fillText(value, x, y)
  }

  /** One entity's card: its id and name, then its components one per line. */
  const card = (entity: Seen | undefined, id: number, name: string, x: number, y: number, now: number) => {
    text(`#${id} ${name}`, x, y, entity === undefined ? MUTED : FG, 14, 600)
    if (entity === undefined) {
      text("despawned", x, y + 20, MUTED, 13)
      return y + 44
    }
    let row = y + 20
    for (const line of entity.components) {
      const since = now - (arrived.get(`${id} ${keyOf(line)}`) ?? -Infinity)
      text(line, x, row, since < FLASH_MS ? ACCENT : MUTED, 13)
      row += 19
    }
    for (const [key, gone] of left) {
      if (!key.startsWith(`${id} `) || now - gone.at > FLASH_MS) continue
      text(gone.line, x, row, ACCENT, 13)
      const width = g.measureText(gone.line).width
      g.strokeStyle = ACCENT
      g.lineWidth = 1.5
      g.beginPath()
      g.moveTo(x, row - 4)
      g.lineTo(x + width, row - 4)
      g.stroke()
      row += 19
    }
    return row + 10
  }

  const body = (x: number, y: number, color: string) => {
    g.fillStyle = color
    g.beginPath()
    g.roundRect(x - 14, y - 22, 28, 44, 8)
    g.fill()
  }

  const draw = (now: number) => {
    const frame = arena.frame()
    const { entities, log } = arena.read()
    track(entities, now)
    const byName = (name: string) => entities.find((entity) => entity.name === name)
    const active = laneAt(frame)

    g.fillStyle = BG
    g.fillRect(0, 0, WIDTH, HEIGHT)
    g.strokeStyle = LINE
    g.lineWidth = 2
    for (const x of [LANE, LANE * 2]) {
      g.beginPath()
      g.moveTo(x, 20)
      g.lineTo(x, HEIGHT - 20)
      g.stroke()
    }

    const titles = [
      ["Stunned, then not", "insert and remove a component"],
      ["A sword in a hand", "Descriptor.Hierarchy"],
      ["An archer's target", "Descriptor.Relation"]
    ] as const
    titles.forEach(([title, sub], lane) => {
      const x = lane * LANE + 24
      text(title, x, 44, lane === active ? ACCENT : FG, 16, 600)
      text(sub, x, 66, MUTED, 13)
      // The floor each lane walks on
      g.strokeStyle = LINE
      g.beginPath()
      g.moveTo(lane * LANE + 24, 214)
      g.lineTo((lane + 1) * LANE - 24, 214)
      g.stroke()
    })

    // Lane 1: the guard, with stars while stunned
    const guard = byName("guard")
    if (guard !== undefined) {
      const stunned = guard.components.some((line) => line.startsWith("Stunned"))
      body(guard.x, guard.y, stunned ? ACCENT : FG)
      if (stunned) {
        for (let i = 0; i < 3; i++) {
          const angle = now / 300 + (i * Math.PI * 2) / 3
          g.fillStyle = "#ffd166"
          g.beginPath()
          g.arc(guard.x + Math.cos(angle) * 18, guard.y - 34 + Math.sin(angle) * 5, 3.5, 0, Math.PI * 2)
          g.fill()
        }
      }
    }

    // Lane 2: the knight, and the sword it holds
    const knight = byName("knight")
    if (knight !== undefined) body(knight.x, knight.y, FG)
    const sword = byName("sword")
    if (sword !== undefined) {
      g.strokeStyle = "#9ad1ff"
      g.lineWidth = 4
      g.lineCap = "round"
      g.beginPath()
      g.moveTo(sword.x - 10, sword.y + 4)
      g.lineTo(sword.x + 14, sword.y - 30)
      g.stroke()
      g.lineCap = "butt"
    }

    // Lane 3: the enemy, and the archer aiming at it until it stands down
    const enemy = byName("enemy")
    const archer = byName("archer")
    if (enemy !== undefined) {
      g.fillStyle = "#e5484d"
      g.beginPath()
      g.moveTo(enemy.x, enemy.y - 18)
      g.lineTo(enemy.x + 18, enemy.y)
      g.lineTo(enemy.x, enemy.y + 18)
      g.lineTo(enemy.x - 18, enemy.y)
      g.closePath()
      g.fill()
    }
    if (archer !== undefined) {
      const idle = archer.components.includes("Idle")
      body(archer.x, archer.y, idle ? MUTED : FG)
      if (enemy !== undefined && !idle) {
        g.strokeStyle = ACCENT
        g.lineWidth = 1.5
        g.setLineDash([6, 6])
        g.beginPath()
        g.moveTo(archer.x, archer.y - 24)
        g.lineTo(enemy.x, enemy.y + 20)
        g.stroke()
        g.setLineDash([])
      }
    }

    // The live components of every entity, under its lane
    const top = 266
    card(guard, 1, "guard", 24, top, now)
    card(knight, 2, "knight", LANE + 24, top, now)
    if (sword !== undefined) card(sword, 5, "sword", LANE + 172, top, now)
    card(archer, 4, "archer", LANE * 2 + 24, top, now)
    card(enemy, 3, "enemy", LANE * 2 + 172, top, now)

    // What each lane's reacting system heard, and how many times
    const heard = (lane: number, lines: ReadonlyArray<string>, lit: boolean) => {
      lines.forEach((line, i) => text(line, lane * LANE + 24, HEIGHT - 96 + i * 20, lit ? ACCENT : MUTED, 13))
    }
    const stunnedAt = frame >= HIT_AT && frame < HIT_AT + STUN_FRAMES
    heard(0, log.recovered === null
      ? stunnedAt ? ["Move skips it:", "without: [Stunned]"] : ["patrolling", ""]
      : [`readRemoved heard #1`, `on tick ${log.recovered}, ${log.recoveredHeard}×`], log.recovered !== null && frame < log.recovered + 90)
    heard(1, sword === undefined
      ? ["empty-handed", ""]
      : ["sword spawned ChildOf #2:", "it moves with its parent"], sword !== undefined && frame < ARM_AT + 90)
    heard(2, log.dropped === null
      ? ["aiming at #3", ""]
      : [`readDroppedRelations: #4→#3`, `on tick ${log.dropped}, ${log.droppedHeard}×: Idle`], log.dropped !== null && frame < log.dropped + 90)

    text(`tick ${frame}`, WIDTH - 96, HEIGHT - 14, LINE, 12)
  }

  const tick = (now: number) => {
    if (stopped) return
    carry += Math.min(now - last, 250)
    last = now
    while (carry >= STEP_MS) {
      arena.step()
      carry -= STEP_MS
      if (arena.frame() >= LOOP) reset()
    }
    draw(now)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  return () => {
    stopped = true
    cancelAnimationFrame(raf)
    host.replaceChildren()
  }
}
