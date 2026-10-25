# `@typeonce/ritmo-math`

ritmo-math holds the 2D helpers most games would otherwise rewrite, as plain data in and plain data out, built on Ops so they replay the same on every engine; it never ports a third-party algorithm, and determinism alone is never a reason to add one.

- `Vec2`: vector arithmetic on `{ x, y }`, lengths, `perpendicular`, `fromAngle` and `angle`, `moveToward`, `clampLength`, and `decayToward`, an ease that is the same at any step rate.
- `Angle`: `wrap` into [-π, π) and `turnToward` the short way at a capped rate, for headings stored as one number.
- `Scalar`: `moveToward`, `lerp`, and `decayToward` on plain numbers.
- `Box2` edge boxes and `Segment2` walls at any angle, with circle overlap tests and `Box2.closestPoint`.
- `Collide2`: swept circle collision against boxes and segments that slides along walls and never tunnels through them, circle against circle, and `pushOut`.
- `FlowField`: one search toward a goal that leads every body around the walls.

```ts
import { Collide2, FlowField, Vec2 } from "@typeonce/ritmo-math"

// Once: a flow field with 30-unit cells (a typed failure for a bad size).
const made = FlowField.make(30)
if (!made.ok) throw new Error(`bad cell size ${made.error.value}`)
const paths = made.value

// Each step: chase the player around the walls, sliding along them.
paths.setWalls(walls, radius)
paths.setGoal(player)
const way = paths.way(enemy) ?? Vec2.normalizeOr(Vec2.subtract(player, enemy), Vec2.zero)
const moved = Collide2.moveCircle(enemy, Vec2.scale(way, speed * dt), radius, { boxes: walls })
```

```sh
pnpm add @typeonce/ritmo-math @typeonce/ritmo
```

Values come in already validated: a position is a component the game's own schema checked when it entered the world (`z.object({ x: z.number(), y: z.number() })` and the like), and every helper reads and returns that plain shape. There are no math value types to construct and no codecs here.

## Determinism

Every helper that needs a non-exact function (`cos`, `sin`, `atan2`, `exp`, `hypot`) calls [`Ops`](https://github.com/typeonce-dev/ritmo/blob/main/packages/core/README.md) from `@typeonce/ritmo`, so a session recorded in one browser replays on any other engine. `Angle`, `Box2`, `Segment2`, `perpendicular`, and the rest use only operations every engine rounds exactly. Game code that needs other math calls `Ops` directly; the `ritmo/use-ops-for-math` rule of [`@typeonce/oxlint-plugin-ritmo`](https://github.com/typeonce-dev/ritmo/blob/main/packages/oxlint-plugin/README.md) reports a `Math` call left in simulation code, and `oxlint --fix` rewrites it.

A broad phase (a spatial grid) is not here: the [skill](https://github.com/typeonce-dev/ritmo/blob/main/packages/core/skills/ritmo/playbooks/spatial-grid.md) has one to copy into the game, sized to its own data.

Released together with [`@typeonce/ritmo`](https://github.com/typeonce-dev/ritmo/blob/main/packages/core/README.md), always with the same version.

Source: https://github.com/typeonce-dev/ritmo
