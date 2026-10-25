// The devtools demo: a headless session plays a scripted run of the controls
// ball, prints each write to its position as the trace records it, stops on
// the frame that breaks the rule, and asks why. The run is recorded once in
// this tab (sim.ts, the same code `probe.ts` runs in Node), then replayed.
import { ARENA, RADIUS } from "../controls/sim.ts"
import { inZone, record, ZONE } from "./sim.ts"

const WIDTH = 960
const HEIGHT = 540
/** The arena, drawn at half size in the top left. */
const SCALE = 0.5
const ARENA_AT = { x: 24, y: 24 } as const
const TERMINAL_TOP = 304
const FONT = "'JetBrains Mono', monospace"
const LINE = 17
const WRAP = 104

// Timed in wall-clock time, so a throttled tab still reaches every phase.
const FRAME_MS = 1000 / 20
const STOPPED_MS = 900
const LINE_MS = 260
const HOLD_MS = 4200

/** Splits a long line, indenting what follows like a terminal would. */
const wrap = (text: string): ReadonlyArray<string> => {
  const lines: Array<string> = []
  for (const line of text.split("\n")) {
    let rest = line
    let first = true
    while (rest.length > 0) {
      const room = first ? WRAP : WRAP - 4
      const cut = rest.length <= room ? rest.length : Math.max(rest.lastIndexOf(" ", room), 1)
      lines.push((first ? "" : "    ") + rest.slice(0, cut))
      rest = rest.slice(cut).trimStart()
      first = false
    }
  }
  return lines
}

type Out = readonly [text: string, color: string]

export const mount = async (host: HTMLElement) => {
  const canvas = document.createElement("canvas")
  canvas.width = WIDTH
  canvas.height = HEIGHT
  canvas.style.cssText = "width:100%;height:100%;display:block;background:#0e1013"
  host.append(canvas)
  const g = canvas.getContext("2d")!

  const run = record()
  const last = run.frames.length - 1
  const answer: ReadonlyArray<Out> = [
    ["> session.run(\"update\", { frames: 240 })", "#8a8f98"],
    ...wrap(run.stop).map((text): Out => [text, "#ff5a36"]),
    ["> session.why(ball, Position, { limit: 3 })", "#8a8f98"],
    ...wrap(run.why).map((text): Out => [text, "#f3f1ec"]),
    ["> session.whyResource(Dashes, { limit: 1 })", "#8a8f98"],
    ...wrap(run.dashes).map((text): Out => [text, "#f3f1ec"])
  ]

  let raf = 0
  let stopped = false
  let started = performance.now()

  const text = (value: string, x: number, y: number, color: string, size = 14, weight = 400) => {
    g.fillStyle = color
    g.font = `${weight} ${size}px ${FONT}`
    g.fillText(value, x, y)
  }

  const drawArena = (at: number) => {
    const sx = (x: number) => ARENA_AT.x + x * SCALE
    const sy = (y: number) => ARENA_AT.y + y * SCALE
    g.strokeStyle = "#2f343c"
    g.lineWidth = 2
    g.strokeRect(sx(0), sy(0), ARENA.width * SCALE, ARENA.height * SCALE)
    g.fillStyle = "rgba(255, 90, 54, 0.18)"
    g.fillRect(sx(ZONE.x), sy(ZONE.y), ZONE.width * SCALE, ZONE.height * SCALE)
    g.strokeStyle = "#ff5a36"
    g.strokeRect(sx(ZONE.x), sy(ZONE.y), ZONE.width * SCALE, ZONE.height * SCALE)
    text("never enter", sx(ZONE.x) + 4, sy(ZONE.y) - 8, "#ff5a36", 12, 600)

    g.strokeStyle = "rgba(138, 143, 152, 0.55)"
    g.beginPath()
    for (let i = 0; i <= at; i++) {
      const p = run.frames[i]!.position
      if (i === 0) g.moveTo(sx(p.x), sy(p.y))
      else g.lineTo(sx(p.x), sy(p.y))
    }
    g.stroke()
    const ball = run.frames[at]!.position
    g.fillStyle = inZone(ball) ? "#ff5a36" : "#f3f1ec"
    g.beginPath()
    g.arc(sx(ball.x), sy(ball.y), RADIUS * SCALE, 0, Math.PI * 2)
    g.fill()
  }

  const drawState = (at: number) => {
    const frame = run.frames[at]!
    const x = ARENA_AT.x + ARENA.width * SCALE + 32
    const dashed = run.frames.slice(Math.max(0, at - 8), at + 1).some((f) => f.dash)
    text("headless session", x, 44, "#f3f1ec", 18, 600)
    text("no page, scripted keyboard,", x, 72, "#8a8f98")
    text("rule checked every frame", x, 92, "#8a8f98")
    text(`frame   f${frame.frame}`, x, 136, "#f3f1ec", 16)
    text(`ball    ${Math.round(frame.position.x)}, ${Math.round(frame.position.y)}`, x, 162, inZone(frame.position) ? "#ff5a36" : "#f3f1ec", 16)
    text(`input   ${dashed ? "dash pressed" : at < 20 ? "move right" : "none"}`, x, 188, dashed ? "#ff5a36" : "#f3f1ec", 16)
    if (inZone(frame.position)) text("rule broken: the run stops", x, 228, "#ff5a36", 16, 600)
  }

  const drawTerminal = (lines: ReadonlyArray<Out>) => {
    g.fillStyle = "#16191e"
    g.fillRect(16, TERMINAL_TOP, WIDTH - 32, HEIGHT - TERMINAL_TOP - 16)
    g.strokeStyle = "#2f343c"
    g.lineWidth = 1
    g.strokeRect(16.5, TERMINAL_TOP + 0.5, WIDTH - 33, HEIGHT - TERMINAL_TOP - 17)
    const room = Math.floor((HEIGHT - TERMINAL_TOP - 32) / LINE)
    lines.slice(-room).forEach(([value, color], i) => text(value, 28, TERMINAL_TOP + 24 + i * LINE, color, 12.5))
  }

  const draw = (now: number) => {
    const elapsed = Math.max(0, now - started)
    const playing = last * FRAME_MS
    const at = Math.min(Math.floor(elapsed / FRAME_MS), last)
    g.fillStyle = "#0e1013"
    g.fillRect(0, 0, WIDTH, HEIGHT)
    drawArena(at)
    drawState(at)
    if (elapsed < playing + STOPPED_MS) {
      // The trace, one write per frame, as the session records it.
      const trace = run.frames.slice(0, at + 1).map((f): Out => [f.line, f.dash ? "#ff5a36" : "#8a8f98"])
      drawTerminal(trace.flatMap(([line, color]) => wrap(line).map((value): Out => [value, color])))
    } else {
      const shown = Math.floor((elapsed - playing - STOPPED_MS) / LINE_MS) + 1
      drawTerminal(answer.slice(0, shown))
      if (elapsed > playing + STOPPED_MS + answer.length * LINE_MS + HOLD_MS) started = now
    }
  }

  const tick = (now: number) => {
    if (stopped) return
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
