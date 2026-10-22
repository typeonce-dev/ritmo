import { Result } from "@typeonce/ritmo"

/** The world a snapshot saved, for tests whose schema has no failing encoder. */
export const worldOf = <A>(result: Result.Result<A, unknown>): A => {
  if (result._tag === "Failure") throw new Error(`snapshot failed: ${JSON.stringify(result.failure)}`)
  return result.success
}
