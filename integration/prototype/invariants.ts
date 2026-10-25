/** What must hold after every frame for the mechanic to work at all, for the play script and the fuzzer. */
import { Invariant } from "@typeonce/ritmo-devtools"

import { ARENA, DashCooldown, Game, Player, Position, Velocity } from "./schema.ts"
import { variants } from "./tuning.ts"

const fastest = Math.max(...Object.values(variants).map((variant) => Math.max(variant.dashSpeed, variant.runSpeed)))

const PlayerQuery = Game.Query({
  selection: { position: Game.Query.read(Position), velocity: Game.Query.read(Velocity), cooldown: Game.Query.read(DashCooldown) },
  with: [Player]
})

export const PlayerInArena = Invariant.fromInspector(Game.Inspector("Prototype/PlayerInArena", { queries: { player: PlayerQuery } }, ({ queries }) => {
  for (const { data } of queries.player.each()) {
    const { x, y } = data.position.get()
    if (!(x >= 0 && x <= ARENA.width && y >= 0 && y <= ARENA.height)) return `player at (${x}, ${y})`
  }
  return undefined
}))

export const SpeedBounded = Invariant.fromInspector(Game.Inspector("Prototype/SpeedBounded", { queries: { player: PlayerQuery } }, ({ queries }) => {
  for (const { data } of queries.player.each()) {
    const { x, y } = data.velocity.get()
    // A diagonal dash rounds to a hair over its speed.
    if (!(x * x + y * y <= fastest * fastest * (1 + 1e-9))) return `velocity (${x}, ${y}) above ${fastest}`
  }
  return undefined
}))

export const invariants = [PlayerInArena, SpeedBounded]
