/**
 * Every number the prototype tunes, as named variants. The host switches
 * variants with a key and restarts the run; the play script and the fuzzer
 * pick one by name.
 */
export interface Tuning {
  /** Top walking speed, in units per second. */
  readonly runSpeed: number
  /** How fast velocity moves toward the walking target, per second (higher is snappier). */
  readonly acceleration: number
  /** Speed at the start of a dash, in units per second. */
  readonly dashSpeed: number
  /** Fixed steps after a dash before the next one. */
  readonly dashCooldownTicks: number
}

export const variants = {
  snappy: { runSpeed: 260, acceleration: 18, dashSpeed: 900, dashCooldownTicks: 30 },
  floaty: { runSpeed: 220, acceleration: 4, dashSpeed: 700, dashCooldownTicks: 20 }
} as const satisfies Record<string, Tuning>

export type Variant = keyof typeof variants
