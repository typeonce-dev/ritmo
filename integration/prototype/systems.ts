import { InputCapture } from "@typeonce/ritmo-browser"
import { Vec2 } from "@typeonce/ritmo-math"

import { ARENA, ControlsInput, DashCooldown, Game, InputState, Player, Position, STEP, Tuning, Velocity } from "./schema.ts"

export const CaptureInput = InputCapture.system(Game, { name: "Prototype/CaptureInput", source: ControlsInput, resource: InputState })

export const SpawnPlayer = Game.System("Prototype/SpawnPlayer", {
  commands: Game.System.commands(Game.System.spawns(Player))
}, ({ commands }) => {
  const draft = Game.Command.spawn(
    Game.Command.entryRaw(Position, { x: ARENA.width / 2, y: ARENA.height / 2 }),
    Game.Command.entryRaw(Velocity, Vec2.zero),
    Game.Command.entryRaw(DashCooldown, 0),
    Game.Command.entry(Player, {})
  )
  if (draft.ok) commands.spawn(draft.value)
})

/** Walks toward the move vector; a dash tap while ready and moving sets the dash speed and starts the cooldown. */
export const Steer = Game.System("Prototype/Steer", {
  queries: {
    player: Game.Query({ selection: { velocity: Game.Query.write(Velocity), cooldown: Game.Query.write(DashCooldown) }, with: [Player] })
  },
  resources: { input: Game.System.readResource(InputState) },
  services: { tuning: Game.System.service(Tuning) }
}, ({ queries, resources, services }) => {
  const { tuning } = services
  const input = resources.input.get()
  const move = input.vectors.move
  for (const { data } of queries.player.each()) {
    const cooldown = data.cooldown.get()
    if (input.actions.dash.pressed && cooldown === 0 && Vec2.lengthSquared(move) > 0) {
      data.velocity.setRaw(Vec2.scale(Vec2.normalizeOr(move, Vec2.zero), tuning.dashSpeed))
      data.cooldown.setRaw(tuning.dashCooldownTicks)
      continue
    }
    data.velocity.updateRaw((velocity) => Vec2.decayToward(velocity, Vec2.scale(move, tuning.runSpeed), tuning.acceleration, STEP.dt))
    if (cooldown > 0) data.cooldown.setRaw(cooldown - 1)
  }
})

/** Moves by velocity and stops at the arena edge. */
export const Move = Game.System("Prototype/Move", {
  queries: {
    player: Game.Query({ selection: { position: Game.Query.write(Position), velocity: Game.Query.write(Velocity) }, with: [Player] })
  }
}, ({ queries }) => {
  for (const { data } of queries.player.each()) {
    const velocity = data.velocity.get()
    const position = Vec2.add(data.position.get(), Vec2.scale(velocity, STEP.dt))
    const x = Math.min(Math.max(position.x, 0), ARENA.width)
    const y = Math.min(Math.max(position.y, 0), ARENA.height)
    data.position.setRaw({ x, y })
    if (x !== position.x || y !== position.y) data.velocity.setRaw({ x: x === position.x ? velocity.x : 0, y: y === position.y ? velocity.y : 0 })
  }
})

export const setup = Game.Schedule(SpawnPlayer, Game.Schedule.applyDeferred())
export const update = Game.Schedule(CaptureInput, Steer, Move)
