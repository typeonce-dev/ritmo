<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./brand/assets/ritmo-lockup-padded-inverse.svg">
    <img alt="Ritmo" src="./brand/assets/ritmo-lockup-padded.svg" width="360">
  </picture>
</p>

# Ritmo

**The agent-first, type-safe ECS runtime for games.**

🎮 You direct the mechanics and feel. Your coding agent writes the simulation.

Ritmo keeps the agent on track: wrong code does not compile and the error
names the fix, and headless runs show lints, invariants, and why each value
changed.

Ritmo works with your renderer and game loop. Drawing stays in your game.

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="./brand/assets/ritmo-motion-still.svg">
    <img alt="Ritmo: The agent-first type safe ECS runtime" src="./brand/assets/ritmo-banner.gif" width="720">
  </picture>
</p>

## Quick start

```sh
pnpm add @typeonce/ritmo
```

Requires TypeScript 5.9 or newer. Leave `noErrorTruncation` off: errors name
the fix near their start, and an untruncated one can print a whole schema.

```ts
import { Clock, Descriptor, Schema } from "@typeonce/ritmo"

type Vec = { x: number; y: number }

// Define the world once: components, resources, and the fixed step.
const step = Clock.hz(60)
const Time = Clock.resource("Example/Time", step)
const Position = Descriptor.Component<Vec>()("Example/Position")
const Velocity = Descriptor.Component<Vec>()("Example/Velocity")

// Bind the schema to its game-facing APIs.
const Game = Schema.bind(
  Schema.fragment({
    components: { Position, Velocity },
    resources: { Time }
  })
)

const AdvanceTime = Clock.system(Game, {
  name: "Example/AdvanceTime",
  resource: Time
})

// Systems receive only the access they declare.
const Move = Game.System(
  "Example/Move",
  {
    queries: {
      moving: Game.Query({
        selection: {
          position: Game.Query.write(Position),
          velocity: Game.Query.read(Velocity)
        }
      })
    },
    resources: { time: Game.System.readResource(Time) }
  },
  ({ queries, resources }) => {
    const { dt } = resources.time.get()
    for (const match of queries.moving.each()) {
      const position = match.data.position.get()
      const velocity = match.data.velocity.get()
      match.data.position.set({
        x: position.x + velocity.x * dt,
        y: position.y + velocity.y * dt
      })
    }
  }
)

// Starting can fail (the clock is a validated resource),
// and so can a tick: both return a Result.
const made = Game.Runtime.make({
  services: Game.Runtime.services(),
  resources: { Time: Clock.start(step) }
})
if (made.ok) {
  const runtime = made.value
  const ticked = runtime.tick(Game.Schedule(AdvanceTime, Move))
  if (!ticked.ok) console.error(ticked.error)
}
```

## Packages

All packages are released together with the same version.

| Package | Contents |
|---|---|
| `@typeonce/ritmo` | ECS runtime and fixed-step loop |
| `@typeonce/ritmo-math` | Vectors, collision, spatial grid, flow field, seeded random, same-bits trig |
| `@typeonce/ritmo-browser` | Animation-frame ticks; keyboard, gamepad, pointer, and touch actions, merged into one input or split across local players |
| `@typeonce/ritmo-render` | Entity-to-node sync for any renderer |
| `@typeonce/ritmo-pixi` | Pixi adapter for the render node registry |
| `@typeonce/ritmo-devtools` | Headless debug sessions, reports, and `ritmo-devtools lint` |
| `@typeonce/oxlint-plugin-ritmo` | Lint rules for deterministic, headless simulation code |

## Get started with your agent

Paste this into your coding agent in the game's folder, then describe the game
you want:

```text
Set up Ritmo in this project by following
https://raw.githubusercontent.com/typeonce-dev/ritmo/main/packages/core/SETUP.md
```

[`SETUP.md`](./packages/core/SETUP.md) installs the packages and checks every
Ritmo game uses and links the [Ritmo skill](./packages/core/skills/ritmo/SKILL.md)
into the agent's skills folder. From then on, the agent follows the skill on
every change: where the docs are and how to structure the game.

## Games built with Ritmo

- [Inkline Town](https://github.com/SandroMaglione/inkline-town): a town
  simulation in isometric line art, rendered with Three.js.
- [Spirit Call](https://github.com/SandroMaglione/spirit-call): a
  top-down action game for the phone, with teams of elemental spirits.
- [Grand Theft Auto: Lunigiana](https://github.com/mastro993/gta-lunigiana):
  an open-world car-theft game in isometric pixel art, set in the real valleys
  of Lunigiana.
- [Bug Killer](https://github.com/giovannilondero/bug-killer): a top-down
  shooter against a (fictional) backlog, where tickets are the enemies,
  with bosses, demanding clients and multiplayer for up to 4 developers.

## Guarantees

- A schema rejects two descriptors of one kind with the same name at compile
  time.
- Commands and state transitions wait for an explicit `applyDeferred()` or
  `applyStateTransitions(...)` in the schedule.
- Each system sees what was published since its own previous run, exactly
  once.
- A failing system rolls back its writes, and the tick returns the failure.
- Queries visit only entities with their rarest required component and cache
  their matches. CI fails on runtime regressions over 25%.

<sub>[Brand assets and palette](./brand/README.md)</sub>
