/**
 * The page side of `PlaywrightEngine`: loaded in a browser by the Vite dev
 * server it starts, it imports the game's entry and runs `Verify.trace` and
 * `Verify.snapshotAt` there with the entry's `replayTarget`. What it returns
 * crosses to Node as JSON, so it returns plain results and never throws a
 * value Node cannot read.
 */
import * as Result from "@typeonce/ritmo/Result"
import type * as Snapshot from "@typeonce/ritmo/Snapshot"

import type * as Replay from "../Replay.ts"
import * as Verify from "../Verify.ts"

/** What the page exposes to `PlaywrightEngine`. */
export interface Runner {
  readonly trace: (file: Replay.ReplayFile) => Result.Result<Verify.Hashes, string>
  readonly snapshotAt: (file: Replay.ReplayFile, tick: number) => Result.Result<Snapshot.WorldSnapshot, string>
}

const describe = (error: unknown): string => error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : JSON.stringify(error)

/** Imports the entry at `url` (a dev server path) and checks it exports `replayTarget`. */
export const start = async (url: string): Promise<Result.Result<Runner, string>> => {
  let loaded: unknown
  try {
    loaded = await import(/* @vite-ignore */ url)
  } catch (error) {
    return Result.failure(`the entry did not load in the browser: ${describe(error)}`)
  }
  const make: unknown = typeof loaded === "object" && loaded !== null ? Reflect.get(loaded, "replayTarget") : undefined
  if (typeof make !== "function") return Result.failure("the entry must export replayTarget: (playback) => { runtime, schedules, hostClock } (see the Verify module)")
  // The CLI checked the same entry in Node, where its type is checked too.
  const target = make as (playback: Replay.Playback) => Replay.Target<any, any>
  const guard = <A>(run: () => Result.Result<A, unknown>): Result.Result<A, string> => {
    try {
      const result = run()
      return result.ok ? result : Result.failure(`the replay did not open: ${JSON.stringify(result.error)}`)
    } catch (error) {
      return Result.failure(`the game threw: ${describe(error)}`)
    }
  }
  return Result.success({
    trace: (file) => guard(() => Verify.trace(target, file)),
    snapshotAt: (file, tick) => guard(() => Verify.snapshotAt(target, file, tick))
  })
}
