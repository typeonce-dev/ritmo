/**
 * What must hold after every frame of the top-down game, for debug
 * sessions, replays, and the fuzzer. An invariant is an inspector that
 * returns a violation message, or `undefined` while it holds. It declares
 * its reads like a system, so `Session.make` rejects one that reads what
 * the runtime does not provide.
 */
import { Invariant } from "@typeonce/ritmo-devtools"

import { WORLD_HEIGHT, WORLD_WIDTH } from "./constants.ts"
import { PlayerPositionQuery } from "./queries.ts"
import { CollectedCount, Game, TotalCollectables } from "./schema.ts"

export const PlayerInsideWorld = Invariant.fromInspector(Game.Inspector("player inside world", { queries: { player: PlayerPositionQuery } }, ({ queries }) => {
  for (const match of queries.player.each()) {
    const position = match.data.position.get()
    if (position.x < 0 || position.x > WORLD_WIDTH || position.y < 0 || position.y > WORLD_HEIGHT) {
      return `player at (${position.x}, ${position.y})`
    }
  }
  return undefined
}))

export const CollectedAtMostTotal = Invariant.fromInspector(Game.Inspector("collected at most total", {
  resources: { collected: Game.System.readResource(CollectedCount), total: Game.System.readResource(TotalCollectables) }
}, ({ resources }) => {
  const collected = resources.collected.get()
  const total = resources.total.get()
  return collected <= total ? undefined : `collected ${collected} of ${total}`
}))
