// A replay target that plays differently in a browser: from tick 3 on, the mover there moves one further each tick.
import type { Replay } from "@typeonce/ritmo-devtools"

import { Input, makeGame } from "./replay-entry.ts"

export const replayTarget = (playback: Replay.Playback) => {
  const inBrowser = typeof Reflect.get(globalThis, "process") === "undefined"
  let ticks = 0
  return makeGame(playback.source(Input), () => (++ticks >= 3 && inBrowser ? 1 : 0))
}
