
import { CollectableQuery, PlayerPositionQuery } from "../queries.ts"
import {
  CollectedCount,
  Collectable,
  FocusedCollectable,
  Game,
  InputState
} from "../schema.ts"
import { makeEmptyFocusedCollectable } from "../runtime.ts"

export const UpdateFocusedCollectableSystem = Game.System(
  "TopDown/UpdateFocusedCollectable",
  {
    queries: {
      player: PlayerPositionQuery,
      collectables: CollectableQuery
    },
    resources: {
      focused: Game.System.writeResource(FocusedCollectable)
    }
  },
  ({ queries, resources }) =>
    {
      const player = queries.player.singleOptional()
      if (player._tag === "Failure" || !player.success) {
        return
      }

      const playerPosition = player.success.data.position.get()
      let current: import("../schema.ts").FocusedCollectableValue["current"] = null
      let label: string | null = null
      let bestDistanceSquared = Number.POSITIVE_INFINITY

      for (const collectable of queries.collectables.each()) {
        const position = collectable.data.position.get()
        const data = collectable.data.collectable.get()
        const dx = position.x - playerPosition.x
        const dy = position.y - playerPosition.y
        const distanceSquared = dx * dx + dy * dy

        if (distanceSquared > data.radius * data.radius || distanceSquared >= bestDistanceSquared) {
          continue
        }

        bestDistanceSquared = distanceSquared
        current = Game.Entity.handle(collectable.entity.id, Collectable)
        label = data.label
      }

      resources.focused.set({
        current,
        label,
        distance: current === null ? null : Math.sqrt(bestDistanceSquared)
      })
    }
)

export const CollectFocusedCollectableSystem = Game.System(
  "TopDown/CollectFocusedCollectable",
  {
    queries: {
      collectables: CollectableQuery
    },
    resources: {
      input: Game.System.readResource(InputState),
      focused: Game.System.writeResource(FocusedCollectable),
      collectedCount: Game.System.writeResource(CollectedCount)
    },
    commands: Game.System.commands(Game.System.despawns(Collectable))
  },
  ({ queries, resources, commands }) =>
    {
      if (!resources.input.get().interact.pressed) {
        return
      }

      const focused = resources.focused.get()
      if (!focused.current) {
        return
      }

      const result = queries.collectables.getHandle(focused.current)
      if (result._tag === "Failure") {
        resources.focused.set(makeEmptyFocusedCollectable())
        return
      }

      commands.despawn(result.success.entity)
      resources.collectedCount.update((value) => value + 1)
      resources.focused.set(makeEmptyFocusedCollectable())
    }
)
