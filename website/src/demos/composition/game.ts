// The composition demo: one world, told as three scenes, one at a time. A
// guard is stunned and recovers, a knight is handed a sword that moves with
// it, and an archer drops its target when the target despawns. Each scene
// says in one sentence what is happening, shows the components of the
// entities in it as chips (new ones light up, removed ones strike out), and
// prints the one line of Ritmo that made it happen.
import { ARM_AT, FALL_AT, HIT_AT, LANES, LOOP, makeArena } from "./sim.ts"
import type { Seen } from "./sim.ts"

const WIDTH = 960
const HEIGHT = 540
const STEP_MS = 1000 / 60
/** How long a chip that just arrived or left stays lit, in ms. */
const FLASH_MS = 1400

const FG = "#f3f1ec"
const MUTED = "#8a8f98"
const ACCENT = "#ff5a36"
const LINE = "#2f343c"
const BG = "#0e1013"
const CODE = "#16191e"
const MONO = "'JetBrains Mono', monospace"

/** Where each scene starts, and what it is about. */
const SCENES = [
  { from: 0, title: "A hit adds a component", lane: 0 },
  { from: ARM_AT - 40, title: "A sword joins a hand", lane: 1 },
  { from: FALL_AT - 110, title: "A target disappears", lane: 2 }
] as const
const sceneAt = (frame: number) => (frame >= SCENES[2].from ? 2 : frame >= SCENES[1].from ? 1 : 0)

/** Components worth a chip, by entity: the rest of an entity is not the story. */
const SHOWN: Record<string, ReadonlyArray<string>> = {
  guard: ["Guard", "Velocity", "Stunned"],
  knight: ["Knight", "Children"],
  sword: ["ChildOf", "Offset"],
  archer: ["Targeting", "Idle"],
  enemy: ["Enemy"]
}
const keyOf = (line: string) => line.split(" ")[0]!

/** The sentence and the line of code for the current step of each scene. */
const stepOf = (scene: number, frame: number, log: { readonly recovered: number | null; readonly dropped: number | null }) => {
  if (scene === 0) {
    if (frame < HIT_AT) return {
      say: "The guard patrols. Move reads every Guard without Stunned.",
      code: "Game.Query({ selection: { … }, with: [Guard], without: [Stunned] })"
    }
    if (log.recovered === null) return {
      say: "A hit inserts Stunned. Move's query skips the guard now.",
      code: "commands.insert(guard, [Stunned, { frames: 120 }])"
    }
    return {
      say: "Its frames run out: Stunned is removed, and one system hears it, once.",
      code: "removed: { recovered: Game.System.readRemoved(Stunned) }"
    }
  }
  if (scene === 1) {
    if (frame < ARM_AT) return {
      say: "The knight patrols, empty-handed.",
      code: "const { relation: ChildOf } = Descriptor.Hierarchy(…)"
    }
    return {
      say: "The sword is spawned as the knight's child, and moves with it.",
      code: "Game.Command.relate(sword, ChildOf, knight)"
    }
  }
  if (log.dropped === null) return {
    say: "The archer aims at the enemy through a Targeting relation.",
    code: "Game.Command.relate(archer, Targeting, enemy)"
  }
  return {
    say: "The enemy despawns. The edge drops, and the archer hears it once.",
    code: "droppedRelations: { lost: Game.System.readDroppedRelations(Targeting) }"
  }
}

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
  /** When each `name Component` chip appeared, and chips that just left. */
  let arrived = new Map<string, number>()
  let left = new Map<string, { readonly name: string; readonly line: string; readonly at: number }>()
  let previous = new Map<string, ReadonlyArray<string>>()

  const reset = () => {
    arena = makeArena()
    arrived = new Map()
    left = new Map()
    previous = new Map()
  }

  /** Notes which chips came and went since the last frame. */
  const track = (entities: ReadonlyArray<Seen>, now: number) => {
    const current = new Map<string, ReadonlyArray<string>>()
    for (const entity of entities) {
      const lines = entity.components.filter((line) => (SHOWN[entity.name] ?? []).includes(keyOf(line)))
      current.set(entity.name, lines)
      for (const line of lines) {
        const key = `${entity.name} ${keyOf(line)}`
        if (!arrived.has(key)) arrived.set(key, previous.size === 0 ? -Infinity : now)
        left.delete(key)
      }
    }
    for (const [name, lines] of previous) {
      const still = current.get(name) ?? []
      for (const line of lines) {
        const key = `${name} ${keyOf(line)}`
        if (!still.some((other) => keyOf(other) === keyOf(line)) && !left.has(key)) {
          left.set(key, { name, line, at: now })
          arrived.delete(key)
        }
      }
    }
    previous = current
  }

  const font = (weight: number, size: number) => `${weight} ${size}px ${MONO}`

  /** Chips under an entity: lit while new, struck out when they leave. */
  const chips = (name: string, lines: ReadonlyArray<string>, x: number, y: number, now: number) => {
    const all: Array<{ readonly line: string; readonly gone: boolean; readonly at: number }> = lines.map((line) => ({
      line,
      gone: false,
      at: arrived.get(`${name} ${keyOf(line)}`) ?? -Infinity
    }))
    for (const [key, gone] of left) if (key.startsWith(`${name} `) && now - gone.at < FLASH_MS * 1.5) all.push({ line: gone.line, gone: true, at: gone.at })
    g.font = font(600, 15)
    g.fillStyle = FG
    g.fillText(name, x - g.measureText(name).width / 2, y)
    // One row of chips, centred under the name
    g.font = font(400, 14)
    const widths = all.map((chip) => g.measureText(chip.line).width + 20)
    let cursor = x - (widths.reduce((sum, width) => sum + width, 0) + 8 * (all.length - 1)) / 2
    const top = y + 14
    all.forEach((chip, index) => {
      const width = widths[index]!
      const fresh = now - chip.at < FLASH_MS
      g.fillStyle = chip.gone ? "rgba(255,90,54,0.08)" : fresh ? "rgba(255,90,54,0.22)" : "#1b1f25"
      g.strokeStyle = chip.gone || fresh ? ACCENT : LINE
      g.lineWidth = 1.5
      g.beginPath()
      g.roundRect(cursor, top, width, 26, 13)
      g.fill()
      g.stroke()
      g.fillStyle = chip.gone || fresh ? ACCENT : FG
      g.fillText(chip.line, cursor + 10, top + 18)
      if (chip.gone) {
        g.strokeStyle = ACCENT
        g.beginPath()
        g.moveTo(cursor + 8, top + 13)
        g.lineTo(cursor + width - 8, top + 13)
        g.stroke()
      }
      cursor += width + 8
    })
  }

  const draw = (now: number) => {
    const frame = arena.frame()
    const scene = sceneAt(frame)
    const { lane } = SCENES[scene]
    const { entities, log } = arena.read()
    track(entities, now)

    g.fillStyle = BG
    g.fillRect(0, 0, WIDTH, HEIGHT)

    // Scene title and progress
    g.font = font(700, 24)
    g.fillStyle = FG
    g.fillText(SCENES[scene].title, 32, 48)
    SCENES.forEach((_, index) => {
      g.fillStyle = index === scene ? ACCENT : LINE
      g.beginPath()
      g.arc(WIDTH - 32 - (2 - index) * 22, 40, 6, 0, Math.PI * 2)
      g.fill()
    })

    // What is happening now
    const step = stepOf(scene, frame, log)
    g.font = font(400, 17)
    g.fillStyle = MUTED
    g.fillText(step.say, 32, 82)

    // The scene, zoomed on its lane
    const toX = (x: number) => WIDTH / 2 + (x - LANES[lane]) * 2.1
    const toY = (y: number) => 300 + (y - 205) * 1.5
    g.strokeStyle = LINE
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(64, 340)
    g.lineTo(WIDTH - 64, 340)
    g.stroke()

    const inScene = entities.filter((entity) => {
      if (scene === 0) return entity.name === "guard"
      if (scene === 1) return entity.name === "knight" || entity.name === "sword"
      return entity.name === "archer" || entity.name === "enemy"
    })
    const byName = new Map(inScene.map((entity) => [entity.name, entity] as const))

    // The archer's aim, while it has a target
    const archer = byName.get("archer")
    const enemy = byName.get("enemy")
    if (archer !== undefined && enemy !== undefined && archer.components.some((line) => line.startsWith("Targeting"))) {
      g.strokeStyle = ACCENT
      g.setLineDash([8, 8])
      g.beginPath()
      g.moveTo(toX(archer.x), toY(archer.y) - 40)
      g.lineTo(toX(enemy.x), toY(enemy.y))
      g.stroke()
      g.setLineDash([])
    }

    for (const entity of inScene) {
      const x = toX(entity.x)
      const y = toY(entity.y)
      const stunned = entity.components.some((line) => line.startsWith("Stunned"))
      if (entity.name === "sword") {
        g.strokeStyle = "#7fb3ff"
        g.lineWidth = 6
        g.lineCap = "round"
        g.beginPath()
        g.moveTo(x - 14, y + 4)
        g.lineTo(x + 26, y - 46)
        g.stroke()
        g.lineCap = "butt"
        continue
      }
      if (entity.name === "enemy") {
        g.fillStyle = ACCENT
        g.beginPath()
        g.moveTo(x, y - 24)
        g.lineTo(x + 24, y)
        g.lineTo(x, y + 24)
        g.lineTo(x - 24, y)
        g.closePath()
        g.fill()
        continue
      }
      const idle = entity.components.includes("Idle")
      g.fillStyle = stunned ? ACCENT : idle ? MUTED : FG
      g.beginPath()
      g.roundRect(x - 26, 340 - 96, 52, 96, 12)
      g.fill()
      g.fillStyle = BG
      g.fillRect(x + 4, 340 - 76, 9, 9)
      if (entity.name === "archer") {
        g.strokeStyle = idle ? MUTED : FG
        g.lineWidth = 4
        g.beginPath()
        g.arc(x + 30, 340 - 60, 26, -Math.PI / 2.4, Math.PI / 2.4)
        g.stroke()
      }
      if (stunned) {
        g.font = font(700, 18)
        g.fillStyle = ACCENT
        g.fillText("✦ ✦", x - 22, 340 - 108)
      }
    }

    // Chips, under each entity of the scene
    const placed = scene === 1
      ? [["knight", WIDTH / 2 - 150], ["sword", WIDTH / 2 + 150]] as const
      : scene === 2
        ? [["archer", WIDTH / 2 - 150], ["enemy", WIDTH / 2 + 150]] as const
        : [["guard", WIDTH / 2]] as const
    for (const [name, x] of placed) {
      const entity = entities.find((seen) => seen.name === name)
      const lines = entity === undefined ? [] : entity.components.filter((line) => (SHOWN[name] ?? []).includes(keyOf(line)))
      chips(entity === undefined ? `${name} (despawned)` : name, lines, x, 378, now)
    }

    // The line of Ritmo behind this step
    g.fillStyle = CODE
    g.beginPath()
    g.roundRect(32, HEIGHT - 66, WIDTH - 64, 40, 8)
    g.fill()
    g.font = font(400, 15)
    g.fillStyle = FG
    g.fillText(step.code, 48, HEIGHT - 40)
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
