/** Native frame deltas as the platform-free FixedLoop source. */
import { FixedLoop } from "@typeonce/ritmo"
import type { Host } from "./NativeHost.ts"
/** Subscribes until the returned loop is stopped. Deltas are milliseconds. */
export const make = (host: Pick<Host, "frames">): FixedLoop.TickSource =>
  FixedLoop.source((onTick) => host.frames.subscribe((deltaMS) => onTick({ deltaMS })))
