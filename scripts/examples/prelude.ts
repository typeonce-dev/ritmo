/**
 * The game every JSDoc `@example` may assume (see scripts/check-examples.ts).
 * A block that uses one of these names without declaring it gets it from
 * here, so examples stay short and still compile against the real API.
 *
 * Keep it a typical small game: the descriptors most examples talk about,
 * one bound schema, and a runtime. Something only one example needs belongs
 * in that example, above its `// ---cut---` line.
 */
import * as Clock from "@typeonce/ritmo/Clock"
import * as Descriptor from "@typeonce/ritmo/Descriptor"
import * as HostClock from "@typeonce/ritmo/HostClock"
import * as Schema from "@typeonce/ritmo/Schema"
import * as Keyboard from "@typeonce/ritmo-browser/Keyboard"
import { Schema as EffectSchema } from "effect"
import * as v from "valibot"
import { z } from "zod"

// The schema libraries, under the names their docs use. Effect's `Schema`
// shares its name with Ritmo's module, so a block imports it itself.
export { v, z }

/** An Effect schema as a Ritmo codec, the helper of the skill's Effect playbook. */
export const codec = <S extends EffectSchema.Top & { readonly DecodingServices: never; readonly EncodingServices: never }>(
  schema: S
) => {
  const json = EffectSchema.toCodecJson(schema)
  return {
    "~standard": EffectSchema.toStandardSchemaV1(json)["~standard"],
    "~encode": EffectSchema.toStandardSchemaV1(EffectSchema.flip(json))
  }
}

// Every component and resource is constructed from a schema (or transient),
// so the world can be saved: `runtime.snapshot()` compiles.
export const Root = Schema.defineRoot("Game")
export const step = Clock.hz(60)
export const Time = Clock.resource("Game/Time", step)

const vector = z.object({ x: z.number(), y: z.number() })
export const Position = Descriptor.ConstructedComponent(vector)("Game/Position")
export const Velocity = Descriptor.ConstructedComponent(vector)("Game/Velocity")
export const Health = Descriptor.ConstructedComponent(z.number())("Game/Health")
export const Weapon = Descriptor.ConstructedComponent(z.object({ ready: z.unknown().refine(Clock.isDeadline(step)).nullable() }))("Game/Weapon")
export const Contact = Descriptor.EntityState("Game/Contact", {
  ground: z.object({ platform: z.int().nullable() }),
  air: z.object({ vy: z.number(), coyote: z.int() })
}, { transitions: { ground: ["air"], air: ["ground"] } })
export const Sprite = Descriptor.TransientComponent<{ frame: number }>()("Game/Sprite")
export const Renderable = Descriptor.ConstructedComponent(z.object({ texture: z.string() }))("Game/Renderable")
export const Player = Descriptor.Tag("Game/Player")
export const Enemy = Descriptor.Tag("Game/Enemy")
export const Frozen = Descriptor.Tag("Game/Frozen")
export const Idle = Descriptor.Tag("Game/Idle")
export const { relation: Targeting } = Descriptor.Relation("Game/Targeting", "Game/TargetedBy")

export const DeltaTime = Descriptor.TransientResource<number>()("Game/DeltaTime")
export const Score = Descriptor.ConstructedResource(z.int())("Game/Score")
export const Gold = Descriptor.ConstructedResource(z.int().nonnegative())("Game/Gold")
export const EnemyCount = Descriptor.ConstructedResource(z.int().nonnegative())("Game/EnemyCount")
export const Tuning = Descriptor.ConstructedResource(z.object({ speed: z.number(), waves: z.array(z.object({ rate: z.number() })) }))("Game/Tuning")

export const Hit = Descriptor.Event<{ amount: number }>()("Game/Hit")
export const Damage = Descriptor.Event<{ amount: number }>()("Game/Damage")

export const Logger = Descriptor.Service<{ log: (message: string) => void }>()("Game/Logger")
export const Audio = Descriptor.Service<{ play: (sound: string) => void }>()("Game/Audio")
export const Hud = Descriptor.Service<{ score: { textContent: string } }>()("Game/Hud")

export const Game = Schema.bind(
  Schema.fragment({
    components: { Position, Velocity, Health, Weapon, Contact, Sprite, Renderable, Player, Enemy, Frozen, Idle },
    resources: { Time, DeltaTime, Score, Gold, EnemyCount, Tuning },
    events: { Hit, Damage },
    relations: { Targeting }
  }),
  Root
)

export const GameFlow = Game.StateMachine("Game/GameFlow", { Menu: {}, Playing: z.object({ level: z.int() }) })

export const AdvanceTime = Clock.system(Game, { name: "Game/AdvanceTime", resource: Time })

export const Move = Game.System("Game/Move", {
  queries: {
    moving: Game.Query({ selection: { position: Game.Query.write(Position), velocity: Game.Query.read(Velocity) } })
  },
  resources: { time: Game.System.readResource(Time) }
}, ({ queries, resources }) => {
  const { dt } = resources.time.get()
  for (const { data } of queries.moving.each()) {
    const velocity = data.velocity.get()
    data.position.update((position) => ({ x: position.x + velocity.x * dt, y: position.y + velocity.y * dt }))
  }
})

export const setup = Game.Schedule(Game.Schedule.applyDeferred())
/** The deterministic gameplay step, the schedule rollback and replays tick. */
export const simulate = Game.Schedule(AdvanceTime, Move)
export const update = simulate

export const services = Game.Runtime.services(
  Game.Runtime.service(Logger, { log: (message) => console.log(message) }),
  Game.Runtime.service(Audio, { play: () => {} }),
  Game.Runtime.service(Hud, { score: { textContent: "" } })
)

const made = Game.Runtime.make({
  services,
  resources: { Time: Clock.start(step), DeltaTime: 1 / 60, Score: 0, Gold: 0, EnemyCount: 0, Tuning: { speed: 120, waves: [] } },
  machines: Game.Runtime.machines(Game.Runtime.machine(GameFlow, { _tag: "Menu" })),
  debug: { hostClock: HostClock.standard }
})
if (!made.ok) throw new Error("the example game does not start")
export const runtime = made.value

/** The keys of the game's keyboard actions. */
export const bindings = {
  left: ["ArrowLeft", "a"],
  right: ["ArrowRight", "d"],
  jump: [" ", "ArrowUp", "w"]
} as const

export const keyboard = Keyboard.scripted(bindings, [])
