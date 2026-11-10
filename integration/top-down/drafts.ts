import { PLAYER_INTERACT_RADIUS, PLAYER_SIZE } from "./constants.ts"
import {
  Collider,
  Collectable,
  Game,
  Position,
  Player,
  Velocity,
  Wall
} from "./schema.ts"

export const makeWallDraft = (x: number, y: number, width: number, height: number) => {
  return Game.Command.spawn(
    Game.Command.entryRaw(Position, { x, y }),
    Game.Command.entryRaw(Collider, { width, height }),
    [Wall, {}]
  )
}

export const makePickupDraft = (x: number, y: number, label: string) => {
  return Game.Command.spawn(
    Game.Command.entryRaw(Position, { x, y }),
    Game.Command.entryRaw(Collider, { width: 28, height: 28 }),
    [Collectable, {
      label,
      radius: PLAYER_INTERACT_RADIUS
    }]
  )
}

/**
 * The player draft, validated once at module load through the constructed
 * descriptors. Drafts are plain values, so every spawn reuses it.
 */
export const playerDraft = Game.Command.spawn(
  Game.Command.entryRaw(Position, { x: 640, y: 260 }),
  Game.Command.entryRaw(Velocity, { x: 0, y: 0 }),
  Game.Command.entryRaw(Collider, { width: PLAYER_SIZE, height: PLAYER_SIZE }),
  [Player, {}]
)
