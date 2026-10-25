// The devtools demo's run, with no page: the controls demo's ball, scripted
// to dash into a red zone it must never enter. A devtools session checks the
// rule every frame, stops on the frame that breaks it, and says why the ball
// is there. The page (game.ts) draws this run; `node --import tsx` on
// probe.ts prints the same text.
import { HostClock } from "@typeonce/ritmo"
import { Gamepad, Keyboard, Pointer, Touch } from "@typeonce/ritmo-browser"
import { Invariant, Session } from "@typeonce/ritmo-devtools"

import {
  Actions,
  createDebugSimulation,
  Dashes,
  Game,
  keyBindings,
  mouseBindings,
  padBindings,
  Position,
  ReadLab,
  setupSchedule,
  touchNames,
  updateSchedule
} from "../controls/sim.ts"

/** The rule: the ball never enters this box. */
export const ZONE = { x: 640, y: 200, width: 120, height: 140 } as const

export const inZone = (p: { readonly x: number; readonly y: number }) =>
  p.x > ZONE.x && p.x < ZONE.x + ZONE.width && p.y > ZONE.y && p.y < ZONE.y + ZONE.height

const OutsideTheZone = Invariant.fromInspector(
  Game.Inspector(
    "ball outside the red zone",
    { queries: { ball: Game.Query({ selection: { position: Game.Query.read(Position) } }) } },
    ({ queries }) => {
      const position = queries.ball.each()[0]?.data.position.get()
      return position !== undefined && inZone(position)
        ? `ball at ${Math.round(position.x)}, ${Math.round(position.y)}`
        : undefined
    }
  )
)

/** One frame of the run: where the ball is, and the trace line that moved it. */
export interface Frame {
  readonly frame: number
  readonly position: { readonly x: number; readonly y: number }
  /** The dash was pressed this frame. */
  readonly dash: boolean
  readonly line: string
}

export interface Run {
  readonly frames: ReadonlyArray<Frame>
  /** The run summary: the frame it stopped on and the broken rule. */
  readonly stop: string
  /** `session.why(ball, Position, { limit: 3 })`. */
  readonly why: string
  /** `session.whyResource(Dashes, { limit: 1 })`. */
  readonly dashes: string
  /** `session.why(ball, Position, { depth: 2, limit: 1 })`. */
  readonly deeper: string
}

/** A fresh world and session over the same scripted keyboard. */
const open = () => {
  const keyboard = Keyboard.scripted(keyBindings, [
    { frame: 0, press: ["move.right"] },
    { frame: 20, release: ["move.right"] },
    { frame: 60, press: ["dash"], release: ["dash"] }
  ])
  const controls = Actions.merge({
    desktop: Actions.group({ keyboard, mouse: Pointer.scripted(mouseBindings, []) }),
    gamepad: Gamepad.scripted(padBindings, []),
    touch: Actions.lacking(Touch.scripted(touchNames, []), ["pause"])
  })
  const hostClock = HostClock.test()
  const made = createDebugSimulation(controls, hostClock)
  if (!made.ok) throw new Error("The devtools demo could not build the world.")
  const runtime = made.value
  const session = Session.make(runtime, {
    hostClock,
    schedules: { setup: setupSchedule, update: updateSchedule },
    invariants: [OutsideTheZone]
  })
  session.run("setup")
  return { runtime, session, ball: runtime.inspect(ReadLab).ball ?? 1 }
}

export const record = (): Run => {
  // Frame by frame, for the path the page draws.
  const stepped = open()
  const frames: Array<Frame> = []
  for (let i = 0; i < 240; i++) {
    const ran = stepped.session.run("update", { frames: 1 })
    const frame = ran.data.range?.[1] ?? 0
    const journal = stepped.session.journal({ frames: [frame, frame], entity: stepped.ball, component: Position })
    const lab = stepped.runtime.inspect(ReadLab)
    frames.push({
      frame,
      position: lab.position,
      dash: lab.input.actions.dash.pressed,
      line: journal.text.split("\n").slice(1).join("\n")
    })
    if (!ran.data.ok) break
  }
  // The same run in one call, as a test or an agent runs it.
  const whole = open()
  const ran = whole.session.run("update", { frames: 240 })
  return {
    frames,
    stop: ran.text,
    why: whole.session.why(whole.ball, Position, { limit: 3 }).text,
    dashes: whole.session.whyResource(Dashes, { limit: 1 }).text,
    deeper: whole.session.why(whole.ball, Position, { depth: 2, limit: 1 }).text
  }
}
