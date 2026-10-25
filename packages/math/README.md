# `@typeonce/ritmo-math`

Math for ritmo games, in two kinds:

- **Validated values**: `Scalar` (`Finite`, `NonNegative`, `Positive`), `Vector2`, `Size2`, and `Aabb`. Each has constructors that validate input (`result`, `option`), a guard `is`, and one `codec`, a Standard Schema: `Descriptor.ConstructedComponent(Vector2.codec)` saves the value and checks it on restore. Inside a game's own schema, build the field from the guard with a schema that narrows to its type (`Schema.declare(Vector2.is)` in Effect, `z.unknown().refine(Vector2.is)` in Zod, `v.pipe(v.unknown(), v.guard(Vector2.is))` in Valibot). `Random.codec` does the same for a generator kept in a resource.
- **Hot-path helpers** on plain numbers, for code that runs every step: `Vec2` vector arithmetic (validated `Vector2` values pass straight in), `Box2` edge boxes, `Segment2` walls at any angle, `Collide2` swept circle collision against both that slides along walls and never tunnels through them, a `SpatialGrid` broad phase that allocates nothing per step, a `FlowField` that leads bodies around walls, a deterministic `Random` whose whole state is one integer (keep it in a resource, so runs replay), and `Ops`, math functions that return the same bits on every engine.

```ts
import { Collide2, FlowField, Random, SpatialGrid, Vec2 } from "@typeonce/ritmo-math"

// Each step: chase the player around the walls, sliding along them.
paths.setWalls(walls, radius)
paths.setGoal(player)
const way = paths.way(enemy) ?? Vec2.normalizeOr(Vec2.subtract(player, enemy), Vec2.zero)
const moved = Collide2.moveCircle(enemy, Vec2.scale(way, speed * dt), radius, { boxes: walls })
```

```sh
pnpm add @typeonce/ritmo-math @typeonce/ritmo
```

## Determinism across devices

JavaScript engines may approximate `Math.sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `exp`, `expm1`, `log`, `log2`, `log10`, `log1p`, `cbrt`, `pow`, `hypot`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, and `a ** b`, and they do: Chrome, Safari, macOS, and Linux disagree in the last bit, and a simulation grows that bit into a different run, so a session recorded on a phone stops replaying on a server. `Ops` has the same functions as pure-JavaScript ports of fdlibm, built only from operations every engine rounds exactly, so they return the same bits everywhere (within an ulp of the exact value). Use them in simulation code; `Math.abs`, `min`, `max`, `floor`, `ceil`, `round`, `trunc`, `sign`, `sqrt`, `+ - * /`, and `x ** 2` are already exact. `Vec2`, `Collide2`, and `FlowField` use `Ops` themselves, and the `ritmo/use-ops-for-math` rule of [`@typeonce/oxlint-plugin-ritmo`](https://github.com/typeonce-dev/ritmo/blob/main/packages/oxlint-plugin/README.md) reports the `Math` calls left in simulation code.

```ts
import { Ops } from "@typeonce/ritmo-math"

const heading = Ops.atan2(target.y - position.y, target.x - position.x)
const velocity = { x: Ops.cos(heading) * speed, y: Ops.sin(heading) * speed }
const damping = Ops.exp(-friction * dt)
```

Released together with [`@typeonce/ritmo`](https://github.com/typeonce-dev/ritmo/blob/main/packages/core/README.md), always with the same version.

Source: https://github.com/typeonce-dev/ritmo
