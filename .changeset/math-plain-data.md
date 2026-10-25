---
"@typeonce/ritmo-math": minor
---

**Breaking: `@typeonce/ritmo-math` holds plain-data 2D helpers only.** It holds the 2D helpers most games would otherwise rewrite, as plain data in and out, built on `Ops` so they replay the same on every engine. Validated value types are the game's schema's job, so these are removed:

- **`Vector2`, `Size2`, `Aabb`, and `InputAxis`.** Declare the shape with the game's schema library and use `Vec2` / `Box2` for the arithmetic:
  ```diff
  - const Position = Descriptor.ConstructedComponent(Vector2.codec)("Game/Position")
  + const Position = Descriptor.ConstructedComponent(z.object({ x: z.number(), y: z.number() }))("Game/Position")
  - Vector2.add(a, b), Vector2.normalizeOrZero(v), Vector2.length(v)
  + Vec2.add(a, b), Vec2.normalizeOr(v, Vec2.zero), Vec2.length(v)
  - Aabb.intersects(first, second)
  + Math.abs(a.x - b.x) * 2 < a.width + b.width && Math.abs(a.y - b.y) * 2 < a.height + b.height // or Box2 edges
  - InputAxis.vectorFromAxes(keys)
  + Keyboard.vector({ up, down, left, right }) from @typeonce/ritmo-browser, read as input.vectors.<name>
  ```
  To keep a branded value, brand it with the schema (`z.object({ ... }).brand<"Position">()`); the skill's "Branded values" section has each library's form.
- **`Scalar`'s brands (`Finite`, `NonNegative`, `Positive`, their constructors and codecs, `Error`, `InterpolationError`, `FiniteResult`), and `Scalar.clamp`, `inverseLerp`, `remap`.** `Scalar` is now three functions on plain numbers. `approach` is renamed:
  ```diff
  - Scalar.approach(speed, target, step)
  + Scalar.moveToward(speed, target, step)
  - Scalar.clamp(value, min, max)
  + Math.min(Math.max(value, min), max)
  - Scalar.remap(value, a, b, c, d)  // Result
  + Scalar.lerp(c, d, (value - a) / (b - a)) // check b !== a where it can be equal
  ```
  `Scalar.lerp` takes and returns plain numbers.
- **`SpatialGrid`.** A broad phase is game code now: copy the module from the skill's `playbooks/spatial-grid.md` (same `clear` / `insert` / `forEachIn` shape, `make(cellSize: number)` returns a `Result`).

**Breaking: `FlowField.make(cellSize: number)` returns `Result<FlowField, InvalidCellSize>`** instead of taking a `Scalar.Positive`. A size that is not a finite number above 0 is the typed failure `{ _tag: "InvalidCellSize", value }`.

```diff
- const paths = FlowField.make(Scalar.Positive.option(30)!)
+ const made = FlowField.make(30)
+ if (!made.ok) return made
+ const paths = made.value
```

**New helpers games kept rewriting**, each total over finite numbers:

- `Angle.wrap(angle)` into [-π, π) (both ±π give -π), exact; `Angle.turnToward(angle, target, maxStep)` the short way, never overshooting. The difference of two headings is `Angle.wrap(to - from)`.
- `Vec2.perpendicular(a)` (`{ x: -a.y, y: a.x }`; the 2D cross product is `dot(perpendicular(a), b)`), `Vec2.fromAngle(angle)` (a unit vector through `Ops.cos`/`sin`), `Vec2.angle(a)` (through `Ops.atan2`: 0 for the zero vector, never `-0`), and `Vec2.decayToward(current, target, rate, dt)`.
- `Scalar.moveToward(current, target, maxDelta)`, `Scalar.lerp(start, end, amount)` (unclamped), `Scalar.decayToward(current, target, rate, dt)` (`target + (current - target) * Ops.exp(-rate * dt)`, the same at any step rate).
- `Box2.closestPoint(box, point)` (a point inside comes back unchanged) and `Collide2.overlapsCircleCircle(center, radius, other, otherRadius)` (touching counts).
