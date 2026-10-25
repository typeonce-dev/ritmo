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
      player.value.data.velocity.updateRaw(() =>
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
      const velocity = player.value.data.velocity.get()
      if (velocity.x === 0 && velocity.y === 0) {
        return
      }

      const walls = queries.walls.each().map((match) => ({
        position: match.data.position.get(),
        collider: match.data.collider.get()
      }))

      const position = player.value.data.position.get()
      const collider = player.value.data.collider.get()
      const nextX = resolveHorizontalMovement(position, velocity.x * dt, collider, walls)
      const nextY = resolveVerticalMovement({ x: nextX, y: position.y }, velocity.y * dt, collider, walls)

      player.value.data.position.setRaw({
        x: nextX,
        y: nextY
      })
    }
)
