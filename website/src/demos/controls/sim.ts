// The controls demo without a page: one ball, moved and dashed by whatever
// device the player picks up. Keyboard and mouse, a gamepad, and on-screen
// touch controls all merge into one input source; the rules read actions,
// never keys. The browser host (game.ts) and the determinism fingerprint
// (fingerprint.ts) build this same world.
import type { HostClock } from "@typeonce/ritmo"
import { Clock, Descriptor, Schema } from "@typeonce/ritmo"
import { Controls, Gamepad, InputCapture, Keyboard, Pointer, Touch } from "@typeonce/ritmo-browser"
import * as Ops from "@typeonce/ritmo-math/Ops"
import { Schema as S } from "effect"

import { codec } from "../codec.ts"

/** One fixed update: 60 per second, shared by the clock and the host loop. */
export const step = Clock.hz(60)

/** The arena, in world units; the host scales it to fit. */
export const ARENA = { width: 960, height: 540 } as const
export const RADIUS = 20
const SPEED = 300
/** How fast the ball reaches the speed the stick asks for: a little glide, not a jump. */
const GRIP = 10
const DASH_SPEED = 1100
/** Steps between two dashes. */
const DASH_COOLDOWN = 24

// ── Input ───────────────────────────────────────────────────────────────

/** What the player can do, whatever the device. */
export const Actions = Controls.actions({ buttons: ["dash", "pause"], vectors: ["move"] })

export const keyBindings = {
  move: Keyboard.vector({ up: ["ArrowUp", "w"], down: ["ArrowDown", "s"], left: ["ArrowLeft", "a"], right: ["ArrowRight", "d"] }),
  dash: [" "],
  pause: ["Escape", "p"]
} as const

/** A click dashes too. The mouse is grouped with the keyboard: using both is one device in use. */
export const mouseBindings = { dash: ["primary"] } as const

export const padBindings = {
  move: Gamepad.vector({ stick: "left", up: ["dpadUp"], down: ["dpadDown"], left: ["dpadLeft"], right: ["dpadRight"] }),
  dash: ["south"],
  pause: ["start"]
} as const

/** On a touch screen: a floating stick on the left half, and one dash button. No pause button. */
export const touchNames = { buttons: ["dash"], sticks: ["move"] } as const

export type KeyboardDevice = Keyboard.Actions<typeof keyBindings>
export type MouseDevice = Pointer.Actions<typeof mouseBindings>
export type GamepadDevice = Gamepad.Actions<typeof padBindings>
export type TouchDevice = Touch.Actions<"dash", "move">

/** The one input source: every device merged, built the same way in the page and headless. */
export const makeControls = (devices: {
  readonly keyboard: KeyboardDevice
  readonly mouse: MouseDevice
  readonly gamepad: GamepadDevice
  readonly touch: TouchDevice
}) => Actions.merge({
  desktop: Actions.group({ keyboard: devices.keyboard, mouse: devices.mouse }),
  gamepad: devices.gamepad,
  // The touch layout has no pause button, and says so.
  touch: Actions.lacking(devices.touch, ["pause"])
})

/**
 * What the rules need from the controls: one snapshot per update. The page
 * keeps the whole merge (to rebind it); a replay provides its recorded
 * snapshots in its place.
 */
export type ControlsSource = InputCapture.SourceOf<ReturnType<typeof makeControls>>

export const ControlsInput = Descriptor.Service<ControlsSource>()("Controls/Input")

// ── World ───────────────────────────────────────────────────────────────

// Constructed from a schema, so a saved world (a snapshot, a replay's start) is checked as it loads.
const point = codec(S.Struct({ x: S.Finite, y: S.Finite }))

export const Position = Descriptor.ConstructedComponent(point)("Controls/Position")
export const Velocity = Descriptor.ConstructedComponent(point)("Controls/Velocity")
/** Where the ball points, in radians, and the steps until it can dash again. */
export const Ball = Descriptor.ConstructedComponent(codec(S.Struct({ heading: S.Finite, cooldown: S.Finite })))("Controls/Ball")

export const Time = Clock.resource("Controls/Time", step)
/** Captured from the devices at the start of each update. */
export const Input = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof ControlsInput>>()("Controls/InputState")
/** How many dashes so far: the one number the page shows from the rules. */
export const Dashes = Descriptor.ConstructedResource(codec(S.Finite))("Controls/Dashes")

export const Game = Schema.bind(
  Schema.fragment({
    components: { Position, Velocity, Ball },
    requires: [Schema.requires(Ball, Position, Velocity)],
    resources: { Time, Input, Dashes }
  }),
  Schema.defineRoot("Controls")
)

export const Mode = Game.StateMachine("Controls/Mode", { Playing: {}, Paused: {} })

// ── Rules ───────────────────────────────────────────────────────────────

const SpawnBall = Game.System(
  "Controls/SpawnBall",
  { commands: Game.System.commands(Game.System.spawns(Ball)) },
  ({ commands }) => {
    commands.spawn(Game.Command.spawn(
      Game.Command.entry(Ball, { heading: 0, cooldown: 0 }),
      Game.Command.entry(Position, { x: ARENA.width / 2, y: ARENA.height / 2 }),
      Game.Command.entry(Velocity, { x: 0, y: 0 })
    ))
  }
)

/** Pause on any device that has a pause button. */
const TogglePause = Game.System(
  "Controls/TogglePause",
  {
    resources: { input: Game.System.readResource(Input) },
    machines: { mode: Game.System.machine(Mode) },
    nextMachines: { mode: Game.System.nextState(Mode) }
  },
  ({ resources, machines, nextMachines }) => {
    if (resources.input.get().actions.pause.pressed) nextMachines.mode.set({ _tag: machines.mode.is("Playing") ? "Paused" : "Playing" })
  }
)

const ball = Game.Query({
  selection: { position: Game.Query.write(Position), velocity: Game.Query.write(Velocity), ball: Game.Query.write(Ball) }
})

/** Steers toward the stick, dashes on a press, and bounces off the arena's edges. */
const MoveBall = Game.System(
  "Controls/MoveBall",
  {
    queries: { ball },
    resources: { time: Game.System.readResource(Time), input: Game.System.readResource(Input), dashes: Game.System.writeResource(Dashes) }
  },
  ({ queries, resources }) => {
    const dt = resources.time.get().dt
    if (dt === 0) return
    const input = resources.input.get()
    // Keys, d-pad, stick, or touch stick: length at most 1, whichever is used.
    const move = input.vectors.move
    for (const { data } of queries.ball.each()) {
      const state = data.ball.get()
      const position = data.position.get()
      let { x: vx, y: vy } = data.velocity.get()
      vx += (move.x * SPEED - vx) * GRIP * dt
      vy += (move.y * SPEED - vy) * GRIP * dt
      const moving = move.x !== 0 || move.y !== 0
      const heading = moving ? Ops.atan2(move.y, move.x) : state.heading
      let cooldown = Math.max(0, state.cooldown - 1)
      if (input.actions.dash.pressed && cooldown === 0) {
        vx = Ops.cos(heading) * DASH_SPEED
        vy = Ops.sin(heading) * DASH_SPEED
        cooldown = DASH_COOLDOWN
        resources.dashes.update((count) => count + 1)
      }
      let x = position.x + vx * dt
      let y = position.y + vy * dt
      if (x < RADIUS || x > ARENA.width - RADIUS) {
        x = Math.min(Math.max(x, RADIUS), ARENA.width - RADIUS)
        vx = -vx
      }
      if (y < RADIUS || y > ARENA.height - RADIUS) {
        y = Math.min(Math.max(y, RADIUS), ARENA.height - RADIUS)
        vy = -vy
      }
      data.position.set({ x, y })
      data.velocity.set({ x: vx, y: vy })
      data.ball.set({ heading, cooldown })
    }
  }
)

// The clock holds while paused, so nothing that reads it moves.
const AdvanceTime = Clock.system(Game, { name: "Controls/AdvanceTime", resource: Time, hold: [Game.Condition.inState(Mode, "Paused")] })
const CaptureInput = InputCapture.system(Game, { name: "Controls/CaptureInput", source: ControlsInput, resource: Input })

export const setupSchedule = Game.Schedule(SpawnBall, Game.Schedule.applyDeferred())
export const updateSchedule = Game.Schedule(AdvanceTime, CaptureInput, TogglePause, MoveBall, Game.Schedule.applyStateTransitions())

// ── Reading it back ─────────────────────────────────────────────────────

/** What the page draws: the ball, the input this step, and whether the game is paused. */
export interface Lab {
  /** The ball's entity, for asking a debug session about it. */
  readonly ball: number | null
  readonly position: { readonly x: number; readonly y: number }
  readonly heading: number
  /** The dash is ready again. */
  readonly ready: boolean
  readonly dashes: number
  readonly paused: boolean
  readonly input: InputCapture.SnapshotOf<typeof ControlsInput>
}

export const ReadLab = Game.Inspector("Controls/ReadLab", {
  queries: { ball: Game.Query({ selection: { position: Game.Query.read(Position), ball: Game.Query.read(Ball) } }) },
  resources: { input: Game.System.readResource(Input), dashes: Game.System.readResource(Dashes) },
  machines: { mode: Game.System.machine(Mode) }
}, ({ queries, resources, machines }): Lab => {
  const found = queries.ball.each()[0]
  return {
    ball: found?.entity.id ?? null,
    position: found?.data.position.get() ?? { x: 0, y: 0 },
    heading: found?.data.ball.get().heading ?? 0,
    ready: (found?.data.ball.get().cooldown ?? 0) === 0,
    dashes: resources.dashes.get(),
    paused: machines.mode.is("Paused"),
    input: resources.input.get()
  }
})


export const initialResources = () => ({
  Time: Clock.start(step),
  Dashes: 0,
  Input: Actions.idle({
    keyboard: Keyboard.idle(keyBindings),
    mouse: Pointer.idle(mouseBindings),
    gamepad: Gamepad.idle(padBindings),
    touch: Touch.idle(touchNames)
  })
} as const)

export const initialMachines = () => Game.Runtime.machines(Game.Runtime.machine(Mode, { _tag: "Playing" }))

const world = (controls: ControlsSource) => ({
  services: Game.Runtime.services(Game.Runtime.service(ControlsInput, controls)),
  resources: initialResources(),
  machines: initialMachines()
})

/** The world over merged controls: live devices in the page, scripted ones headless. */
export const createControlsSimulation = (controls: ControlsSource) => Game.Runtime.make(world(controls))

/** The same world with the debug handle on, for replays and headless sessions. */
export const createDebugSimulation = (controls: ControlsSource, hostClock: HostClock.HostClock) => {
  const made = Game.Runtime.make({ ...world(controls), debug: { hostClock } })
  // Named, a debug session can say which system spawned what.
  if (made.ok) made.value.debug.nameSchedules({ setup: setupSchedule, update: updateSchedule })
  return made
}

/** A runtime made by {@link createDebugSimulation}: one that replays can record. */
export type DebugRuntime = Extract<ReturnType<typeof createDebugSimulation>, { readonly ok: true }>["value"]
