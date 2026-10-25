// The scan fixture's simulation entry: its own code is clean; the dependency is not.
import type { Body } from "fake-physics"
import { step } from "fake-physics"

import * as Ops from "./ops.ts"

export const tick = (body: Body): Body => {
  const next = step(body)
  return { x: next.x + Ops.sin(Math.sqrt(Ops.square(next.x))), y: Math.abs(next.y) }
}
