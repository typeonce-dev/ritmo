/** Native monotonic host time, for tools and diagnostics. */
import type { HostClock } from "@typeonce/ritmo"
import type { Host } from "./NativeHost.ts"
/** Simulation time continues to come from Clock resources. */
export const make = (host: Pick<Host, "clock">): HostClock.HostClock => ({ now: () => host.clock.now() })
