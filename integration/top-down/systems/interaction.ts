
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
      if (!player.ok || !player.value) {
        return
      }

      const playerPosition = queries.player.data.position.get(player.value)
      let current: import("../schema.ts").FocusedCollectableValue["current"] = null
      let label: string | null = null
      let bestDistanceSquared = Number.POSITIVE_INFINITY

      const { data } = queries.collectables
      for (const collectable of queries.collectables.each()) {
        const position = data.position.get(collectable)
        const details = data.collectable.get(collectable)
        const dx = position.x - playerPosition.x
        const dy = position.y - playerPosition.y
        const distanceSquared = dx * dx + dy * dy

        if (distanceSquared > details.radius * details.radius || distanceSquared >= bestDistanceSquared) {
          continue
        }

        bestDistanceSquared = distanceSquared
        current = Game.Entity.handle(collectable.id, Collectable)
        label = details.label
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
      if (!resources.input.get().actions.interact.pressed) {
        return
      }

      const focused = resources.focused.get()
      if (!focused.current) {
        return
      }

      const result = queries.collectables.getHandle(focused.current)
      if (!result.ok) {
        resources.focused.set(makeEmptyFocusedCollectable())
        return
      }

      commands.despawn(result.value)
      resources.collectedCount.update((value) => value + 1)
      resources.focused.set(makeEmptyFocusedCollectable())
    }
)
