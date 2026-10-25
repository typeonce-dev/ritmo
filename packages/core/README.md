# `@typeonce/ritmo`

The agent-first type safe ECS runtime

Closed schemas, declared system access, explicit schedule boundaries, typed
services, and no user-facing casts for normal usage.

```sh
pnpm add @typeonce/ritmo
```

```ts
import { Descriptor, Schema } from "@typeonce/ritmo"

const Position = Descriptor.Component<{ x: number; y: number }>()("Example/Position")
const Game = Schema.bind(Schema.fragment({ components: { Position } }))
```

A component or resource can say what its number fields mean with `meta`:
a unit, an expected range, and a one-sentence hint per top-level field.
Keys are checked against the value's fields, and `range` compiles only on
number fields. It is advisory, never validation: the schema decides what is
valid, `describe()` lists the metadata, and a
[devtools](https://github.com/typeonce-dev/ritmo/blob/main/packages/devtools/README.md)
session warns (`out-of-range`) when a write leaves the range. Snapshots do
not save it, and production runtimes never read it.

```ts
const Health = Descriptor.ConstructedComponent(z.object({ hp: z.number() }))("Example/Health", {
  meta: { hp: { unit: "points", range: [0, 100], hint: "Hit points left; 0 despawns the entity." } }
})
```

Modules are also importable by path, for example `@typeonce/ritmo/Result`.

## Determinism across devices

JavaScript engines may approximate `Math.sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `exp`, `expm1`, `log`, `log2`, `log10`, `log1p`, `cbrt`, `pow`, `hypot`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, and `a ** b`, and they do: Chrome, Safari, macOS, and Linux disagree in the last bit, and a simulation grows that bit into a different run, so a session recorded on a phone stops replaying on a server. `Ops` has the same functions as pure-JavaScript ports of fdlibm, built only from operations every engine rounds exactly, so they return the same bits everywhere (within an ulp of the exact value). The list is closed: `Math.abs`, `min`, `max`, `floor`, `ceil`, `round`, `trunc`, `sign`, `sqrt`, the constants, `+ - * /`, and `x ** 2` are already exact. The `ritmo/use-ops-for-math` rule of [`@typeonce/oxlint-plugin-ritmo`](https://github.com/typeonce-dev/ritmo/blob/main/packages/oxlint-plugin/README.md) reports the `Math` calls left in simulation code, and `oxlint --fix` rewrites them and adds the import.

```ts
import { Ops } from "@typeonce/ritmo"

const heading = Ops.atan2(target.y - position.y, target.x - position.x)
const velocity = { x: Ops.cos(heading) * speed, y: Ops.sin(heading) * speed }
const damping = Ops.exp(-friction * dt)
```

Randomness is `Random`, a generator (mulberry32) whose whole state is one integer, kept in a resource so a run replays and saves with the world: `Descriptor.ConstructedResource(Random.codec)`, started with `Random.seed(n)`, drawn in a system with `Random.draw(resources.rng)`.

Agents: set up a project with `SETUP.md`, then follow the skill at `skills/ritmo/SKILL.md` on every change.

Related packages, released together with the same version:

- [`@typeonce/ritmo-math`](https://github.com/typeonce-dev/ritmo/blob/main/packages/math/README.md): 2D helpers on plain data, built on `Ops`: vectors, angles, swept circle collision, and a flow field
- [`@typeonce/ritmo-browser`](https://github.com/typeonce-dev/ritmo/blob/main/packages/browser/README.md): animation-frame ticks for the fixed-step loop; keyboard, gamepad, pointer, and touch actions, merged into one input or split across local players
- [`@typeonce/ritmo-render`](https://github.com/typeonce-dev/ritmo/blob/main/packages/render/README.md): entity-to-node sync for any renderer
- [`@typeonce/ritmo-pixi`](https://github.com/typeonce-dev/ritmo/blob/main/packages/pixi/README.md): Pixi container adapter for the render-node registry
- [`@typeonce/ritmo-netcode`](https://github.com/typeonce-dev/ritmo/blob/main/packages/netcode/README.md): online multiplayer: rollback and lockstep sessions over any transport
- [`@typeonce/ritmo-devtools`](https://github.com/typeonce-dev/ritmo/blob/main/packages/devtools/README.md): headless debug sessions and trace reports
- [`@typeonce/oxlint-plugin-ritmo`](https://github.com/typeonce-dev/ritmo/blob/main/packages/oxlint-plugin/README.md): oxlint rules that keep simulation code deterministic and headless

Source: https://github.com/typeonce-dev/ritmo
