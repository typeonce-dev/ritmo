// Two fighters, one bug. The "record" fighter keeps its body in one object
// ({ grounded, vy }), as a game might; a guard sets a small `vy` and leaves
// `grounded` true, and gravity skips a grounded body, so it drifts up for
// good. The Ritmo fighter keeps its body in a `Descriptor.EntityState`: on the
// ground there is no `vy` to set, so the same guard cannot lift it.
import { Descriptor, Schema } from "@typeonce/ritmo"
import { Schema as S } from "effect"

import { codec } from "../codec.ts"

/** Upward speed of a jump, gravity per step, and the hop the guard animation adds. */
export const JUMP = 9
export const GRAVITY = 0.45
export const GUARD_HOP = 2

// ── The record fighter: plain code, the bug as it was ────────────────────

export interface RecordBody {
  y: number
  vy: number
  grounded: boolean
}

export const recordBody = (): RecordBody => ({ y: 0, vy: 0, grounded: true })

export const recordStep = (body: RecordBody, input: { readonly jump: boolean; readonly guard: boolean }) => {
  if (input.jump && body.grounded) {
    body.grounded = false
    body.vy = JUMP
  }
  // The guard's small hop: it sets a speed and forgets that the body is grounded
  if (input.guard) body.vy = GUARD_HOP
  if (!body.grounded) body.vy -= GRAVITY
  body.y += body.vy
  if (!body.grounded && body.y <= 0) {
    body.y = 0
    body.vy = 0
    body.grounded = true
  }
}

// ── The Ritmo fighter: each state holds only its own fields ─────────────

export const Height = Descriptor.ConstructedComponent(codec(S.Finite))("States/Height")
export const Contact = Descriptor.EntityState("States/Contact", {
  ground: codec(S.Struct({ platform: S.NullOr(S.Int) })),
  air: codec(S.Struct({ vy: S.Finite }))
}, { transitions: { ground: ["air"], air: ["ground"] } })
export const Jump = Descriptor.Event<{}>()("States/Jump")
export const Guard = Descriptor.Event<{}>()("States/Guard")

export const Game = Schema.bind(Schema.fragment({
  components: { Height, Contact },
  events: { Jump, Guard }
}))

const Bodies = Game.Query({
  selection: { height: Game.Query.write(Height), contact: Game.Query.write(Contact) }
})

const Spawn = Game.System(
  "States/Spawn",
  { commands: Game.System.commands(Game.System.spawns(Height, Contact)) },
  ({ commands }) => {
    commands.spawn(Game.Command.spawn(
      Game.Command.entry(Height, 0),
      Game.Command.entry(Contact, { _tag: "ground", platform: null })
    ))
  }
)

/** Jump leaves the ground; a guard in the air keeps falling, on the ground it has nothing to lift. */
const Act = Game.System(
  "States/Act",
  {
    queries: { bodies: Bodies },
    events: { jump: Game.System.readEvent(Jump), guard: Game.System.readEvent(Guard) }
  },
  ({ queries, events }) => {
    const jumped = events.jump.all().length > 0
    for (const { data } of queries.bodies.each()) {
      if (jumped && data.contact.get()._tag === "ground") {
        data.contact.transition({ from: "ground", to: "air", data: { vy: JUMP } })
      }
      // The guard's hop exists only in the air: on the ground there is no vy to set
      if (events.guard.all().length > 0 && data.contact.get()._tag === "air") {
        data.contact.update({ state: "air", data: (air) => ({ vy: Math.max(air.vy, GUARD_HOP) }) })
      }
    }
  }
)

const Fall = Game.System("States/Fall", { queries: { bodies: Bodies } }, ({ queries }) => {
  for (const { data } of queries.bodies.each()) {
    const contact = data.contact.get()
    if (contact._tag !== "air") continue
    const vy = contact.vy - GRAVITY
    const y = data.height.get() + vy
    if (y <= 0) {
      data.height.set(0)
      data.contact.transition({ from: "air", to: "ground", data: { platform: null } })
    } else {
      data.height.set(y)
      data.contact.update({ state: "air", data: () => ({ vy }) })
    }
  }
})

export const setup = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
export const update = Game.Schedule(Act, Fall)

const Seen = Game.Query({
  selection: { height: Game.Query.read(Height), contact: Game.Query.read(Contact) }
})

export const ReadBody = Game.Inspector("States/ReadBody", { queries: { bodies: Seen } }, ({ queries }) => {
  const found = queries.bodies.each()[0]
  return { y: found?.data.height.get() ?? 0, contact: found?.data.contact.get() ?? { _tag: "ground" as const, platform: null } }
})

export const makeFighter = () => {
  const made = Game.Runtime.make({ services: Game.Runtime.services() })
  if (!made.ok) throw new Error("The states demo could not build the world.")
  const runtime = made.value
  runtime.tick(setup)
  return {
    step: (input: { readonly jump: boolean; readonly guard: boolean }) => {
      if (input.jump) runtime.send(Jump, {})
      if (input.guard) runtime.send(Guard, {})
      runtime.tick(update)
    },
    read: () => runtime.inspect(ReadBody)
  }
}
