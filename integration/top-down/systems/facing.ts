
import { lengthSquared } from "../math.ts"
import { PlayerVelocityQuery } from "../queries.ts"
import { Facing, Game, Locomotion } from "../schema.ts"

export const ResolveFacingSystem = Game.System(
  "TopDown/ResolveFacing",
  {
    queries: {
      player: PlayerVelocityQuery
    },
    machines: {
      facing: Game.System.machine(Facing)
    },
    nextMachines: {
      facing: Game.System.nextState(Facing)
    }
  },
  ({ queries, machines, nextMachines }) =>
    {
      const player = queries.player.singleOptional()
      if (player._tag === "Failure" || !player.success) {
        return
      }

      const velocity = player.success.data.velocity.get()
      const ax = Math.abs(velocity.x)
      const ay = Math.abs(velocity.y)
      if (ax === 0 && ay === 0) {
        return
      }

      const current = machines.facing.get()
      const nextFacing =
        ax > ay ? (velocity.x < 0 ? "Left" : "Right")
        : ay > ax ? (velocity.y < 0 ? "Up" : "Down")
        : current

      nextMachines.facing.setIfChanged(nextFacing)
    }
)

export const ResolveLocomotionSystem = Game.System(
  "TopDown/ResolveLocomotion",
  {
    queries: {
      player: PlayerVelocityQuery
    },
    nextMachines: {
      locomotion: Game.System.nextState(Locomotion)
    }
  },
  ({ queries, nextMachines }) =>
    {
      const player = queries.player.singleOptional()
      if (player._tag === "Failure" || !player.success) {
        return
      }

      const velocity = player.success.data.velocity.get()
      nextMachines.locomotion.setIfChanged(
        lengthSquared(velocity) > 0 ? "Walking" : "Idle"
      )
    }
)
