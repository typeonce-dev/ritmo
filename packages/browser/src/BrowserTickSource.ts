/**
 * The browser's animation frames as a core `FixedLoop.TickSource`.
 *
 * Each frame reports the milliseconds since the previous one; the first frame
 * reports zero because it establishes the clock. The window is passed in, so
 * nothing reads a global. To drive the loop from a renderer's own ticker
 * instead (such as Pixi's), wrap it with `FixedLoop.source`.
 *
 * The smallest whole game, in one file: a square the arrow keys move, the
 * rules reading actions, the page drawing what an `Inspector` returns.
 *
 * @example
 * ```ts
 * declare const ctx: CanvasRenderingContext2D
 * // ---cut---
 * // Input: actions, not keys, so tests, replays, and fuzzing can provide them.
 * const Actions = Controls.actions({ buttons: ["act"], vectors: ["move"] })
 * const keys = { move: Keyboard.vector({ up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"] }), act: [" "] } as const
 * const makeControls = (keyboard: Keyboard.Actions<typeof keys>) => Actions.merge({ keyboard })
 * const ControlsInput = Descriptor.Service<InputCapture.SourceOf<ReturnType<typeof makeControls>>>()("Toy/Controls")
 *
 * // Data
 * const step = Clock.hz(60)
 * const Time = Clock.resource("Toy/Time", step)
 * const Input = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof ControlsInput>>()("Toy/Input")
 * const Position = Descriptor.Component<{ x: number; y: number }>()("Toy/Position")
 * const Game = Schema.bind(Schema.fragment({ components: { Position }, resources: { Time, Input } }), Schema.defineRoot("Toy"))
 *
 * // Rules
 * const player = Game.Query({ selection: { position: Game.Query.write(Position) } })
 * const Spawn = Game.System("Toy/Spawn", { commands: Game.System.commands(Game.System.spawns(Position)) }, ({ commands }) => {
 *   commands.spawn(Game.Command.spawn(Game.Command.entry(Position, { x: 100, y: 100 })))
 * })
 * const Move = Game.System("Toy/Move", {
 *   queries: { player },
 *   resources: { time: Game.System.readResource(Time), input: Game.System.readResource(Input) }
 * }, ({ queries, resources }) => {
 *   const { dt } = resources.time.get()
 *   const input = resources.input.get()
 *   for (const { data } of queries.player.each()) {
 *     const { x, y } = data.position.get()
 *     // A button reads as `held` / `pressed` / `released`; `act` sends the square home.
 *     if (input.actions.act.pressed) data.position.set({ x: 100, y: 100 })
 *     else data.position.set({ x: x + input.vectors.move.x * 200 * dt, y: y + input.vectors.move.y * 200 * dt })
 *   }
 * })
 * const setup = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
 * const update = Game.Schedule(
 *   Clock.system(Game, { name: "Toy/AdvanceTime", resource: Time }),
 *   InputCapture.system(Game, { name: "Toy/CaptureInput", source: ControlsInput, resource: Input }),
 *   Move
 * )
 *
 * // What the page draws: plain data, read once per frame.
 * const ReadSquares = Game.Inspector("Toy/ReadSquares", {
 *   queries: { squares: Game.Query({ selection: { position: Game.Query.read(Position) } }) }
 * }, ({ queries }) => queries.squares.each().map(({ data }) => data.position.get()))
 *
 * // The page
 * const keyboard = Keyboard.actions(window, keys)
 * const made = Game.Runtime.make({
 *   services: Game.Runtime.services(Game.Runtime.service(ControlsInput, makeControls(keyboard))),
 *   resources: { Time: Clock.start(step), Input: Actions.idle({ keyboard: Keyboard.idle(keys) }) }
 * })
 * if (!made.ok) throw new Error("The toy could not start")
 * const runtime = made.value
 * runtime.tick(setup)
 * FixedLoop.start({
 *   source: BrowserTickSource.make(window),
 *   step,
 *   maxFrameSeconds: 0.25,
 *   maxStepsPerFrame: 5,
 *   update: () => runtime.tick(update),
 *   render: () => {
 *     ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
 *     for (const { x, y } of runtime.inspect(ReadSquares)) ctx.fillRect(x, y, 20, 20)
 *   },
 *   onFailure: (failure) => console.error(failure)
 * })
 * ```
 *
 * @module BrowserTickSource
 * @docGroup browser
 */
import * as FixedLoop from "@typeonce/ritmo/FixedLoop"

/** What the source needs from the window. */
export interface Host {
  requestAnimationFrame(callback: (timestamp: number) => void): number
  cancelAnimationFrame(handle: number): void
}

/** A tick source that schedules one `requestAnimationFrame` per frame until stopped. */
export const make = (host: Host): FixedLoop.TickSource => FixedLoop.source((onTick) => {
  let stopped = false
  let handle = 0
  let previous: number | undefined

  const frame = (timestamp: number): void => {
    if (stopped) {
      return
    }
    const deltaMS = previous === undefined ? 0 : timestamp - previous
    previous = timestamp
    onTick({ deltaMS })
    if (!stopped) {
      handle = host.requestAnimationFrame(frame)
    }
  }

  handle = host.requestAnimationFrame(frame)
  return {
    stop() {
      if (stopped) {
        return
      }
      stopped = true
      host.cancelAnimationFrame(handle)
    }
  }
})
