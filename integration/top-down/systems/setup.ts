
import { pickupLayout, wallLayout } from "../content.ts"
import { makePickupDraft, playerDraft, makeWallDraft } from "../drafts.ts"
import { Collectable, Game, Player, Wall } from "../schema.ts"

export const SetupWorldSystem = Game.System(
  "TopDown/SetupWorld",
  {
    commands: Game.System.commands(Game.System.spawns(Player, Wall, Collectable))
  },
  ({ commands }) =>
    {
      if (playerDraft._tag === "Success") {
        commands.spawn(playerDraft.success)
      }

      for (const wall of wallLayout) {
        const wallDraft = makeWallDraft(wall.x, wall.y, wall.width, wall.height)
        if (wallDraft._tag === "Success") {
          commands.spawn(wallDraft.success)
        }
      }

      for (const pickup of pickupLayout) {
        const pickupDraft = makePickupDraft(pickup.x, pickup.y, pickup.label)
        if (pickupDraft._tag === "Success") {
          commands.spawn(pickupDraft.success)
        }
      }
    }
)
