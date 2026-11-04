import { PLAYER_SPEED } from "../constants.ts"
import { resolveHorizontalMovement, resolveVerticalMovement } from "../math.ts"
import { PlayerMovementQuery, WallCollisionQuery } from "../queries.ts"
import { DeltaTime, Game, InputState } from "../schema.ts"

export const PlanPlayerVelocitySystem = Game.System(
  "TopDown/PlanPlayerVelocity",
  {
    queries: {
      player: PlayerMovementQuery
    },
    resources: {
      input: Game.System.readResource(InputState)
    }
  },
  ({ queries, resources }) =>
    {
      const player = queries.player.singleOptional()
      if (!player.ok || !player.value) {
        return
      }

      // Length at most 1: keys and the d-pad give a unit direction, the stick keeps its tilt.
      const direction = resources.input.get().vectors.move
      queries.player.data.velocity.updateRaw(player.value, () =>
        ({
          x: direction.x * PLAYER_SPEED,
          y: direction.y * PLAYER_SPEED
        })
      )
    }
)

export const MovePlayerSystem = Game.System(
  "TopDown/MovePlayer",
  {
    queries: {
      player: PlayerMovementQuery,
      walls: WallCollisionQuery
    },
    resources: {
      deltaTime: Game.System.readResource(DeltaTime)
    }
  },
  ({ queries, resources }) =>
    {
      const player = queries.player.singleOptional()
      if (!player.ok || !player.value) {
        return
      }

      const dt = resources.deltaTime.get()
      const velocity = queries.player.data.velocity.get(player.value)
      if (velocity.x === 0 && velocity.y === 0) {
        return
      }

      const walls = queries.walls.each().map((entity) => ({
        position: queries.walls.data.position.get(entity),
        collider: queries.walls.data.collider.get(entity)
      }))

      const position = queries.player.data.position.get(player.value)
      const collider = queries.player.data.collider.get(player.value)
      const nextX = resolveHorizontalMovement(position, velocity.x * dt, collider, walls)
      const nextY = resolveVerticalMovement({ x: nextX, y: position.y }, velocity.y * dt, collider, walls)

      queries.player.data.position.setRaw(player.value, {
        x: nextX,
        y: nextY
      })
    }
)
