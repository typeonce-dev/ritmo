/**
 * The netcode shooter, built for a replay: the recorded input instead of a
 * `Netcode` session's, on a runtime with the debug handle. The entry
 * `ritmo-devtools verify` loads, in Node and in each browser:
 *
 *   ritmo-devtools verify integration/netcode/replay/target.ts integration/netcode/replay/match.json --engines node,chromium,webkit,firefox
 *
 * `record.ts` writes the match it replays.
 */
import { Clock, HostClock, Random } from "@typeonce/ritmo"
import type { Replay } from "@typeonce/ritmo-devtools"
import type { Netcode } from "@typeonce/ritmo-netcode"

import { Game, idle, InputSource, Round, simulate, step, type PlayerInput } from "../game.ts"

/** The schedule a replay of the match records, by the name in the file. */
export const schedules = { simulate }

/** A runtime of the game reading input from `source`, with the debug handle a recorder and a replay need. */
export const makeDebugRuntime = (source: Netcode.Source<PlayerInput>, hostClock: HostClock.HostClock) => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(InputSource, source)),
    resources: { Time: Clock.start(step), Rng: Random.seed(7), Score: [0, 0], Inputs: [idle, idle] },
    machines: Game.Runtime.machines(Game.Runtime.machine(Round, { _tag: "Playing" })),
    debug: { hostClock }
  })
  // The values above are valid by construction; the Result covers validated resources in general.
  if (!made.ok) throw new Error("the starting resources did not validate")
  return made.value
}

/** What `Replay.session` and `ritmo-devtools verify` build the game with. */
export const replayTarget = (playback: Replay.Playback) => {
  const hostClock = HostClock.test()
  return { runtime: makeDebugRuntime(playback.source(InputSource), hostClock), schedules, hostClock }
}
