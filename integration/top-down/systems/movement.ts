import * as Vector2 from "@typeonce/ritmo-math/Vector2"

import { PLAYER_SPEED } from "../constants.ts"
import { normalizeMovement, resolveHorizontalMovement, resolveVerticalMovement } from "../math.ts"
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
      if (player._tag === "Failure" || !player.success) {
        return
      }

      const direction = normalizeMovement(resources.input.get())
      player.success.data.velocity.updateRaw(() =>
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
      if (player._tag === "Failure" || !player.success) {
        return
      }

      const dt = resources.deltaTime.get()
      const velocity = player.success.data.velocity.get()
      if (velocity.x === 0 && velocity.y === 0) {
        return
      }

      const walls = queries.walls.each().map((match) => ({
        position: match.data.position.get(),
        collider: match.data.collider.get()
      }))

      const position = player.success.data.position.get()
      const collider = player.success.data.collider.get()
      const nextX = resolveHorizontalMovement(position, velocity.x * dt, collider, walls)
      const nextPosition = Vector2.result({
        x: nextX,
        y: position.y
      })
      if (nextPosition._tag === "Failure") {
        return
      }
      const nextY = resolveVerticalMovement(nextPosition.success, velocity.y * dt, collider, walls)

      player.success.data.position.setRaw({
        x: nextX,
        y: nextY
      })
    }
)
