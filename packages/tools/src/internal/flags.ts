/**
 * Number flags that take a range, the same way in every tool: a value
 * outside it is refused where the flag is parsed, as a usage error that
 * names the flag, the value, and the range (`Invalid value for flag
 * --count: "99". Expected: a whole number from 1 to 12`), exit 2. Never clamped: a value the tool
 * would change is a value the agent did not mean.
 */
import { Flag } from "effect/cli"

const between = (min: number, max: number): string => (max === Number.MAX_SAFE_INTEGER ? `${min} or more` : `from ${min} to ${max}`)

/** A whole-number flag from `min` to `max` (no upper bound when `max` is left out). */
export const intFlag = (name: string, min: number, max = Number.MAX_SAFE_INTEGER): Flag.Flag<number> =>
  Flag.Int(name).pipe(Flag.filter((n) => n >= min && n <= max, () => `a whole number ${between(min, max)}`))

/** A number flag from `min` to `max`, ends included. */
export const numberFlag = (name: string, min: number, max: number): Flag.Flag<number> =>
  Flag.Finite(name).pipe(Flag.filter((n) => n >= min && n <= max, () => `a number from ${min} to ${max}`))
