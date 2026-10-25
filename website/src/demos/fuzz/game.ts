// The fuzzer, live: the controls demo's ball with a planted rule (it must never
// enter the red zone). `Fuzz.run` plays the real game with seeded random input
// until the rule breaks, the page replays that run fast, then the fuzzer
// shrinks it and the page replays the few frames that are left. Everything
// runs in this tab, headless, with the same code a test runs in Node.
import { HostClock } from "@typeonce/ritmo"
import { Gamepad, Keyboard, Pointer, Touch } from "@typeonce/ritmo-browser"
import { Fuzz, Invariant, Replay } from "@typeonce/ritmo-devtools"

import {
  Actions,
  ARENA,
  ControlsInput,
  createDebugSimulation,
  Game,
  keyBindings,
  mouseBindings,
  padBindings,
  Position,
  RADIUS,
  ReadLab,
  setupSchedule,
  touchNames,
  updateSchedule
} from "../controls/sim.ts"

/** The planted rule: the ball never enters this box. */
const ZONE = { x: 640, y: 200, width: 120, height: 140 } as const

const inZone = (p: { readonly x: number; readonly y: number }) =>
  p.x > ZONE.x && p.x < ZONE.x + ZONE.width && p.y > ZONE.y && p.y < ZONE.y + ZONE.height

const OutsideTheZone = Invariant.fromInspector(
  Game.Inspector(
    "the ball never enters the red zone",
    { queries: { ball: Game.Query({ selection: { position: Game.Query.read(Position) } }) } },
    ({ queries }) => {
      const position = queries.ball.each()[0]?.data.position.get()
      return position !== undefined && inZone(position)
        ? `ball at ${Math.round(position.x)}, ${Math.round(position.y)}`
        : undefined
    }
  )
)

const devices = {
  keyboard: Keyboard.idle(keyBindings),
  mouse: Pointer.idle(mouseBindings),
  gamepad: Gamepad.idle(padBindings),
  touch: Touch.idle(touchNames)
}

/** Random input any of the real devices could report, every frame. */
const FuzzedControls = Fuzz.input(ControlsInput, {
  generate: (random) => Actions.random(random, devices),
  neutral: Actions.idle(devices)
})

/** The game a replay or the fuzzer builds: recorded or generated input in place of the devices. */
const make = (playback: Replay.Playback) => {
  const hostClock = HostClock.test()
  const made = createDebugSimulation(playback.source(ControlsInput), hostClock)
  if (!made.ok) throw new Error("The fuzz demo could not build the world.")
  return { runtime: made.value, schedules: { setup: setupSchedule, update: updateSchedule }, hostClock }
}

interface Search {
  readonly seed: number
  readonly frames: number
  readonly original: ReadonlyArray<{ readonly x: number; readonly y: number }>
  readonly shrunk: ReadonlyArray<{ readonly x: number; readonly y: number }>
  readonly attempts: number
  readonly ms: number
}

/** The ball's position after every tick of a replay. */
const pathOf = (file: Replay.ReplayFile) => {
  let runtime: ReturnType<typeof make>["runtime"] | undefined
  const opened = Replay.session((playback) => {
    const target = make(playback)
    runtime = target.runtime
    return target
  }, file)
  if (!opened.ok || runtime === undefined) return []
  const first = file.ticks[0]?.tick ?? file.start.tick
  const last = file.ticks.at(-1)?.tick ?? file.start.tick
  const path = [runtime.inspect(ReadLab).position]
  for (let tick = first; tick <= last; tick++) {
    opened.value.play({ to: tick })
    path.push(runtime.inspect(ReadLab).position)
  }
  return path
}

const search = (seed: number): Search | undefined => {
  const options = {
    schedule: "update",
    setup: "setup",
    inputs: [FuzzedControls],
    invariants: [OutsideTheZone],
    frames: 1800,
    runs: 20,
    seed
  } as const
  const started = performance.now()
  const raw = Fuzz.run(make, { ...options, shrinkAttempts: 0 })
  const shrunk = Fuzz.run(make, options)
  const ms = performance.now() - started
  if (raw.ok || raw.error._tag !== "Found" || shrunk.ok || shrunk.error._tag !== "Found") return undefined
  return {
    seed: shrunk.error.seed,
    frames: raw.error.frame,
    original: pathOf(raw.error.replay),
    shrunk: pathOf(shrunk.error.replay),
    attempts: shrunk.error.shrink.attempts,
    ms
  }
}

export const mount = async (host: HTMLElement) => {
  const canvas = document.createElement("canvas")
  canvas.width = ARENA.width
  canvas.height = ARENA.height
  canvas.style.cssText = "width:100%;height:100%;display:block;background:#0e1013"
  const again = document.createElement("button")
  again.type = "button"
  again.textContent = "Search with another seed"
  again.style.cssText =
    "position:absolute;right:16px;bottom:16px;font:600 14px 'JetBrains Mono',monospace;" +
    "padding:8px 12px;border-radius:6px;border:1px solid #2f343c;background:#16191e;color:#f3f1ec;cursor:pointer"
  host.style.position = "relative"
  host.append(canvas, again)
  const g = canvas.getContext("2d")!

  let frame = 0
  let stopped = false
  let seed = 1
  let shown: Search | undefined
  // Which path is on screen, how far along it is, and the caption.
  let phase: "searching" | "original" | "shrinking" | "shrunk" = "searching"
  let at = 0
  let phaseStarted = performance.now()

  const draw = () => {
    g.fillStyle = "#0e1013"
    g.fillRect(0, 0, ARENA.width, ARENA.height)
    g.strokeStyle = "#2f343c"
    g.lineWidth = 2
    g.strokeRect(1, 1, ARENA.width - 2, ARENA.height - 2)
    g.fillStyle = "rgba(255, 90, 54, 0.18)"
    g.fillRect(ZONE.x, ZONE.y, ZONE.width, ZONE.height)
    g.strokeStyle = "#ff5a36"
    g.strokeRect(ZONE.x, ZONE.y, ZONE.width, ZONE.height)
    g.fillStyle = "#ff5a36"
    g.font = "600 14px 'JetBrains Mono', monospace"
    g.fillText("never enter", ZONE.x + 8, ZONE.y + 22)

    const path = shown === undefined ? [] : phase === "original" ? shown.original : phase === "shrunk" ? shown.shrunk : []
    const end = Math.min(Math.floor(at), path.length - 1)
    if (end >= 0) {
      g.strokeStyle = phase === "shrunk" ? "rgba(243, 241, 236, 0.85)" : "rgba(138, 143, 152, 0.55)"
      g.lineWidth = 2
      g.beginPath()
      for (let i = 0; i <= end; i++) {
        const p = path[i]!
        if (i === 0) g.moveTo(p.x, p.y)
        else g.lineTo(p.x, p.y)
      }
      g.stroke()
      const ball = path[end]!
      g.fillStyle = inZone(ball) ? "#ff5a36" : "#f3f1ec"
      g.beginPath()
      g.arc(ball.x, ball.y, RADIUS, 0, Math.PI * 2)
      g.fill()
    }

    g.fillStyle = "#f3f1ec"
    g.font = "600 20px 'JetBrains Mono', monospace"
    const lines: Array<[string, string]> = []
    if (phase === "searching") lines.push(["Playing at random…", "#f3f1ec"])
    if (shown !== undefined && phase === "original") {
      lines.push([`Random play, seed ${shown.seed}`, "#f3f1ec"])
      lines.push([`frame ${Math.min(end, shown.frames)} of ${shown.frames}`, "#8a8f98"])
    }
    if (shown !== undefined && phase === "shrinking") {
      lines.push([`Rule broken after ${shown.frames} frames`, "#ff5a36"])
      lines.push(["Shrinking…", "#8a8f98"])
    }
    if (shown !== undefined && phase === "shrunk") {
      lines.push([`${shown.frames} frames → ${shown.shrunk.length - 1} frames`, "#f3f1ec"])
      lines.push([`${shown.attempts} shrink attempts, ${Math.round(shown.ms)} ms`, "#8a8f98"])
      lines.push(["This replay is now a test.", "#8a8f98"])
    }
    lines.forEach(([text, color], i) => {
      g.fillStyle = color
      g.font = i === 0 ? "600 20px 'JetBrains Mono', monospace" : "400 16px 'JetBrains Mono', monospace"
      g.fillText(text, 24, 40 + i * 28)
    })
  }

  const run = () => {
    phase = "searching"
    shown = undefined
    at = 0
    draw()
    // Let the "Playing at random…" frame paint before the search blocks.
    setTimeout(() => {
      shown = search(seed)
      phase = "original"
      at = 0
      phaseStarted = performance.now()
    }, 50)
  }

  // Timed in wall-clock time, so a throttled tab still reaches every phase.
  const ORIGINAL_MS = 3000
  const SHRINKING_MS = 1200
  const SHRUNK_FPS = 30
  const HOLD_MS = 1500
  const tick = () => {
    if (stopped) return
    const now = performance.now()
    const elapsed = now - phaseStarted
    if (shown !== undefined) {
      if (phase === "original") {
        at = (elapsed / ORIGINAL_MS) * (shown.original.length - 1)
        if (elapsed >= ORIGINAL_MS) {
          at = shown.original.length - 1
          phase = "shrinking"
          phaseStarted = now
        }
      } else if (phase === "shrinking") {
        if (elapsed >= SHRINKING_MS) {
          phase = "shrunk"
          phaseStarted = now
        }
      } else if (phase === "shrunk") {
        const playing = (shown.shrunk.length / SHRUNK_FPS) * 1000
        at = Math.min(elapsed / 1000 * SHRUNK_FPS, shown.shrunk.length - 1)
        if (elapsed >= playing + HOLD_MS) phaseStarted = now
      }
    }
    draw()
    frame = requestAnimationFrame(tick)
  }

  again.addEventListener("click", () => {
    seed += 20
    run()
  })
  run()
  frame = requestAnimationFrame(tick)

  return () => {
    stopped = true
    cancelAnimationFrame(frame)
    host.replaceChildren()
  }
}
