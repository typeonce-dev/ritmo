# @typeonce/ritmo-math

## 0.20.0

### Patch Changes

- Updated dependencies [b5f78e7]
- Updated dependencies [7b0dcd2]
- Updated dependencies [b101512]
- Updated dependencies [7853fea]
- Updated dependencies [72f2c40]
  - @typeonce/ritmo@0.20.0

## 0.19.1

### Patch Changes

- @typeonce/ritmo@0.19.1

## 0.19.0

### Patch Changes

- Updated dependencies [6e69a51]
- Updated dependencies [612c30a]
- Updated dependencies [832169a]
- Updated dependencies [818ad0b]
- Updated dependencies [1a36354]
  - @typeonce/ritmo@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [8322cd7]
  - @typeonce/ritmo@0.18.0

## 0.17.0

### Minor Changes

- 3d1f862: `Scalar.spring(current, target, { frequencyHz, dampingRatio }, dt)` moves a damped spring toward a target: a value with momentum that overshoots and wobbles back, for squash and stretch, a wobble, or a pop. Its state is a `Scalar.Spring` record (`{ value, velocity }`) that passes straight back in. The motion is computed exactly, so it is the same at any step rate and a long frame cannot make it blow up. A vector springs one axis at a time.

  `Collide2.moveCircle` and `MoveResult.blocked` now say that `blocked` does not tell which wall was touched or whether the circle stands on one, with an example of a grounded check that probes with `sweepCircle`.

  The `ritmo` skill's rendering playbook now says that a part that is not an entity (a procedural limb, a trail) is render state, and that cosmetic randomness uses its own `Random.make` stream, never the world's random resource.

### Patch Changes

- Updated dependencies [15c55ac]
- Updated dependencies [39aeaf4]
- Updated dependencies [9346953]
- Updated dependencies [db0804a]
- Updated dependencies [3d1f862]
  - @typeonce/ritmo@0.17.0

## 0.16.1

### Patch Changes

- @typeonce/ritmo@0.16.1

## 0.16.0

### Patch Changes

- 9b0379e: **Every JSDoc `@example` now compiles against the current API.** Examples are type-checked in CI as a game would import them, so they no longer cite exports that do not exist or call them with the wrong arguments. What changed in meaning:

  - `Game.Runtime.make(...)` with a constructed resource (a `Clock.resource`, a `Descriptor.ConstructedResource`) returns a `Result` that may fail: the examples check `ok` instead of reading `.value`.
  - A captured input resource is typed from its source: `Descriptor.TransientResource<InputCapture.SnapshotOf<typeof KeyboardInput>>()`, not `Keyboard.Snapshot<...>`.
  - `Netcode.seats(...)` returns a `Result`: check it instead of `.value!`.
  - `Lint.Target<typeof Game.schema, typeof Root>` takes the schema root second.
  - `NodeRegistry.make` infers the node type from `attach`'s parameter, with no explicit generic.

- Updated dependencies [9b0379e]
- Updated dependencies [be9af72]
- Updated dependencies [9b0379e]
- Updated dependencies [9290521]
- Updated dependencies [9290521]
- Updated dependencies [1b55d21]
  - @typeonce/ritmo@0.16.0

## 0.15.0

### Minor Changes

- c75daff: **Breaking: `Ops` and `Random` moved from `@typeonce/ritmo-math` into `@typeonce/ritmo`.** Determinism belongs to the runtime: every simulation needs same-bits math and a seeded generator, with or without the 2D helpers. The modules are unchanged; only the import path moves, and `@typeonce/ritmo-math` no longer exports them. The `Ops` header now states that its list is closed: the 22 functions engines may approximate and `**`; everything else on `Math` is already exact. `@typeonce/ritmo-devtools` and `@typeonce/ritmo-netcode` no longer depend on `@typeonce/ritmo-math`.

  ```diff
  - import { Ops, Random } from "@typeonce/ritmo-math"
  + import { Ops, Random } from "@typeonce/ritmo"
  - import * as Random from "@typeonce/ritmo-math/Random"
  + import * as Random from "@typeonce/ritmo/Random"
  - import * as Ops from "@typeonce/ritmo-math/Ops"
  + import * as Ops from "@typeonce/ritmo/Ops"
  ```

  `oxlint --fix` with `ritmo/use-ops-for-math` adds the new import where a `Math` call is rewritten; other imports need the path changed by hand.

- c75daff: **Breaking: `@typeonce/ritmo-math` holds plain-data 2D helpers only.** It holds the 2D helpers most games would otherwise rewrite, as plain data in and out, built on `Ops` so they replay the same on every engine. Validated value types are the game's schema's job, so these are removed:

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
  - **`SpatialGrid`.** A broad phase is game code now: copy the module from the skill's `references/spatial-grid.ts` (same `clear` / `insert` / `forEachIn` shape, `make(cellSize: number)` returns a `Result`).

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

### Patch Changes

- d01a735: **Zod schemas work with Ritmo: the schema back to the saved form is under `"~encode"`, not `encode`.** Zod (from 4.1) gives every schema an `encode()` method, which Ritmo read as its encode schema: `Descriptor.ConstructedComponent(z.object(...))` did not compile, and with a cast `runtime.snapshot()` threw `Cannot read properties of undefined (reading 'validate')`. The key now starts with `~`, like Standard Schema's own `~standard`, so no library's methods collide with it. A Zod, Valibot, or ArkType schema of plain data passes as it is; Ritmo's tests now save and load a schema of each, and of Effect, through JSON.

  - **Breaking: a codec carries its encode schema as `"~encode"`.** The Effect helper from the skill's `references/effect.md` (or a hand-written codec) renames the key:

    ```diff
     return {
       "~standard": Schema.toStandardSchemaV1(json)["~standard"],
    -  encode: Schema.toStandardSchemaV1(Schema.flip(json))
    +  "~encode": Schema.toStandardSchemaV1(Schema.flip(json))
     }
    ```

    A transforming schema without it fails with `give it a ~encode schema back to the saved form`.

  - **Values that transform** (a `Date`, a `Map`) save through a `"~encode"` from any library. Zod's comes from the new `references/zod.md` helper, built on Zod's own `safeEncode`: `Descriptor.ConstructedComponent(codec(z.codec(z.iso.datetime(), z.date(), { decode, encode })))`. With Valibot, ArkType, or any other Standard Schema library, write the reverse schema by hand:

    ```ts
    const Born = Descriptor.ConstructedComponent({
      "~standard": v.pipe(
        v.string(),
        v.isoTimestamp(),
        v.transform((text) => new Date(text))
      )["~standard"],
      "~encode": v.pipe(
        v.date(),
        v.transform((date) => date.toISOString())
      ),
    })("Game/Born");
    ```

  - **Handles and deadlines inside a game's schema** are built from their guards with a schema that narrows to the guard's type: `z.unknown().refine(Entity.isHandle(Root))` in Zod, `v.pipe(v.unknown(), v.guard(...))` in Valibot, `type("unknown").narrow(...)` in ArkType, `Schema.declare(...)` in Effect. The docs said `z.custom(guard)`, which types the value as `unknown`.

- Updated dependencies [3a195b7]
- Updated dependencies [d01a735]
- Updated dependencies [45458dc]
- Updated dependencies [c75daff]
- Updated dependencies [b77b17d]
- Updated dependencies [c20f20b]
- Updated dependencies [01959dd]
- Updated dependencies [637fa1f]
- Updated dependencies [44e9b42]
  - @typeonce/ritmo@0.15.0

## 0.14.0

### Minor Changes

- e169263: **`Collide2` collides circles with line segments, so walls can run at any angle.** The new `Segment2` module is the plain segment `Collide2` reads every frame (`Segment2.between(a, b)`, `closestPoint`, `overlapsCircle`), like `Box2` for boxes. A segment is a two-sided wall with round ends; both ends at one point make a round post. `Collide2.sweepCircleSegment` finds the first contact with one, next to `sweepCircleBox`. A map traced from survey data, a slanted fence, or a polygon's edges no longer need a hand-written port of `moveCircle`.

  ```ts
  const fence = Segment2.between({ x: 0, y: 0 }, { x: 40, y: 30 });
  const moved = Collide2.moveCircle(position, delta, radius, {
    boxes: rooms,
    segments: [fence],
  });
  ```

  - **Breaking: `moveCircle` and `pushOut` take the walls by kind, as `Collide2.Walls`** (`{ boxes?, segments? }`), instead of an array of boxes. An array no longer compiles (`pass walls by kind: { boxes: walls } or { segments: walls }`):

    ```diff
    -Collide2.moveCircle(position, delta, radius, walls)
    +Collide2.moveCircle(position, delta, radius, { boxes: walls })
    -Collide2.pushOut(position, radius, walls)
    +Collide2.pushOut(position, radius, { boxes: walls })
    ```

  - **Breaking: `sweepCircleBoxes` is `sweepCircle`**, the first contact with any of the walls (line of sight with a radius of 0, as before):

    ```diff
    -Collide2.sweepCircleBoxes(eye, Vec2.subtract(target, eye), 0, walls) === undefined
    +Collide2.sweepCircle(eye, Vec2.subtract(target, eye), 0, { boxes: walls }) === undefined
    ```

    Results against boxes are unchanged.

### Patch Changes

- Updated dependencies [c3719a5]
- Updated dependencies [70d054e]
- Updated dependencies [adb4066]
- Updated dependencies [97e95fb]
- Updated dependencies [dbfbd9d]
- Updated dependencies [343660e]
- Updated dependencies [d24258e]
- Updated dependencies [cfe332a]
- Updated dependencies [8aa1e85]
  - @typeonce/ritmo@0.14.0

## 0.13.0

### Minor Changes

- 835f6ba: **Each validated type has one `codec`, a Standard Schema, and a guard `is` that takes `unknown`.** `Vector2.codec`, `Size2.codec`, `Aabb.codec`, `Random.codec`, and `Scalar.Finite.codec` / `NonNegative.codec` / `Positive.codec` go straight into `Descriptor.ConstructedComponent(...)` or `ConstructedResource(...)`; inside a game's own schema, build the field from `is` (`Schema.declare(Vector2.is)`, `z.custom(Vector2.is)`). The scalar constructors are typed `Scalar.Constructor<T>`, which replaces `Brand.Constructor`.

  - **Breaking: `Vector2.decode`, `Size2.decode`, `Aabb.decode`, `Random.decode`, and their `DecodeError` are removed.** `Descriptor.ConstructedComponent(Vector2)` becomes `Descriptor.ConstructedComponent(Vector2.codec)`; to check a value, use `Vector2.is(raw)` or `Vector2.result(raw)`, which stay.

### Patch Changes

- Updated dependencies [791b52a]
- Updated dependencies [b3d6502]
- Updated dependencies [835f6ba]
  - @typeonce/ritmo@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [04a2ac7]
  - @typeonce/ritmo@0.12.0

## 0.11.0

### Patch Changes

- e46f284: **Documentation pass over every public module.** Every export has JSDoc saying what it is for and which neighbouring API to use instead; examples that no longer compiled (`Session.make` without `hostClock`, `Replay.session`, the `Pointer` rebind) are fixed; `Debug.Lint` lists every lint code the runtime emits. The `stale-target` lint's fix now names `queries.x.getHandle(handle)`.
- Updated dependencies [778301a]
- Updated dependencies [866bcff]
- Updated dependencies [e46f284]
  - @typeonce/ritmo@0.11.0

## 0.10.0

### Patch Changes

- 7002f4d: **Everything a game's agent needs now ships with the packages, and `ritmo-devtools lint` reports simulation modules the lint rules miss.**

  - **Breaking: `ritmo-devtools lint` fails on an uncovered simulation module.** Every module the entry loads that the `ritmo/keep-simulation-headless` override in `.oxlintrc.json` does not cover is reported as `uncovered-simulation-module`, and the command exits 1. Add the module (or its folder) to the simulation override's `"files"`, or stop importing values from it. Modules loaded only inside `lintTarget` are not checked. Requires Node 22.15 or newer (`engines.node` is now `>=22.15`).
  - **An agent skill ships with `@typeonce/ritmo`** in `skills/ritmo/SKILL.md`, for every change: where the docs are, and principles for where a game's code and state belong. Link it into the folder the game's agent reads skills from, for example `ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo .agents/skills/ritmo`. `SETUP.md` in `@typeonce/ritmo` is the one-time setup: the base packages and checks every game uses, the add-ons, and linking the skill.
  - **Every package ships its `CHANGELOG.md`.** The upgrade notes for 0.8.0 and 0.9.0 are in the `@typeonce/ritmo` changelog.
  - **JSDoc corrections.** Examples no longer provide randomness or time as services (use the `Random` resource and `Clock`), the `Command` module example declares its commands, inspector docs state that `added`/`changed` reads report records since the inspector's previous evaluation, and every example uses prefixed names (`"Game/Position"`). Guidance that lived only in the repository's guides (spawn order, `ReadonlyValue` helpers, re-entering a state, `thisTick` and plugin systems, service effects and rollback) is now in the JSDoc.
  - Package READMEs link other packages' READMEs by GitHub URL, so the links work on npm.

- 388a696: **The Ritmo skill routes each change to a playbook, and simulation code names no renderer type.**

  - **Breaking: `ritmo/keep-simulation-headless` reports type-only renderer imports** (`import type { Container } from "pixi.js"`, `export type ... from "three"`) and subpath imports of `@typeonce/ritmo-render` and `@typeonce/ritmo-pixi`. A schema that names a renderer type ties the simulation to that renderer. Move the renderer service (a `Descriptor.Service<NodeRegistry.NodeRegistry<Sprite>>()(...)`) and the systems that use it into render code; services are not registered in the schema, so nothing else changes:

    ```diff
    -// src/game/schema.ts
    -import type { Sprite } from "pixi.js"
    -export const Sprites = Descriptor.Service<NodeRegistry.NodeRegistry<Sprite>>()("Game/Sprites")
    +// src/render/sprites.ts
    +import type { Sprite } from "pixi.js"
    +export const Sprites = Descriptor.Service<NodeRegistry.NodeRegistry<Sprite>>()("Game/Sprites")
    ```

  - **The skill in `skills/ritmo` now has playbooks**: one per kind of change (a mechanic, content, UI and rendering, a bug fix, a refactor, state and upgrades), each a short list of steps that ends with the check that proves it. `SKILL.md` routes to them and keeps the principles. A game that already links the skill folder gets them on upgrade.

- Updated dependencies [7002f4d]
- Updated dependencies [388a696]
  - @typeonce/ritmo@0.10.0

## 0.9.0

### Minor Changes

- 003b902: **`Ops` covers every `Math` function engines approximate.** New: `Ops.expm1`, `log`, `log2`, `log10`, `log1p`, `cbrt`, `sinh`, `cosh`, `asinh`, `acosh`, and `atanh`, each a pure-JavaScript fdlibm port that returns the same bits on every engine and CPU (checked on V8 for macOS arm64, Linux x64, and Linux arm64, and on JavaScriptCore), within 1 ulp of the exact value. Simulation code no longer needs any `Math` function except the exact ones (`sqrt`, `abs`, `min`, `max`, `floor`, `ceil`, `round`, `trunc`, `sign`).
- 6cd9771: **`Ops`: math that returns the same bits on every engine.**

  JavaScript engines may approximate `Math.sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `exp`, `tanh`, `pow`, `hypot`, and `a ** b`, and they do: V8 on macOS arm64 and on Linux x64, and JavaScriptCore (Safari, every iOS browser), return different last bits, and a simulation grows that bit into a different run. `Ops` from `@typeonce/ritmo-math` has the same functions as pure-JavaScript ports of fdlibm (musl libm), built only from operations every engine rounds exactly, so a run replays bit for bit on any device. Each is within 1 ulp of the exact value (`tanh` within 2, like the native one); `Ops.hypot` takes exactly two numbers and never overflows.

  ```ts
  import { Ops } from "@typeonce/ritmo-math";

  const heading = Ops.atan2(dy, dx);
  const step = { x: Ops.cos(heading) * speed, y: Ops.sin(heading) * speed };
  ```

  Use `Ops` in simulation code instead of those `Math` functions; `Math.abs`, `min`, `max`, `floor`, `ceil`, `round`, `trunc`, `sign`, `sqrt`, `+ - * /`, and `x ** 2` are already exact everywhere.

  `Vec2.rotate`, `length`, `distance`, `normalizeOr`, `moveToward`, `clampLength`, `Collide2` corner normals, and `FlowField.way` now use `Ops`. Their results can differ from the previous version in the last bit, so a replay recorded on an earlier version may diverge. `Touch` (browser) measures stick and aim offsets with `Math.sqrt(x * x + y * y)` instead of `Math.hypot`, for the same reason.

- 886ba39: **Support package fixes from a second review.**

  - **Random state in a resource.** `Random` is now a validator for its own state (`Descriptor.ConstructedResource(Random)("Game/Rng")`, saved and checked like any constructed resource), `Random.seed(n)` is its starting value, and `Random.draw(resources.rng)` gives a generator over the system's write cell that writes every draw back, so a system no longer stores the state by hand and a failed run rolls its draws back. `Random.make(state)` stays for state kept outside the world.
  - **Preconditions are checked.** `Random.integer` throws unless both bounds are whole with `min < maxExclusive` (it drew outside both bounds), and `Random.range` throws when `min > max` or a bound is not finite (equal bounds still return `min`). `SpatialGrid.insert` / `forEachIn` throw on non-finite numbers (an infinite box never returned), and a box covering more cells than are occupied scans the occupied cells. `Random.weighted` calls `weight` once per item.
  - **Input edges.** `Touch`: a `pointerdown` for a pointer id still held (its up was lost) cancels what that id held first, instead of leaving a button held until blur. `Keyboard.scripted`: pressing an action that is already held is not a new press, as with a live keyboard.

### Patch Changes

- 9cca78b: **One shape for `Runtime.make`, and runtime guards from a review of 0.8.0.** See Upgrading under 0.9.0 in the `@typeonce/ritmo` CHANGELOG.md.

  - **Breaking: `Runtime.make` always returns a `Result`.** It returned the bare runtime or a `Result` depending on the resource values present at runtime, while its type decided from the keys of the provided type, so resources typed `{ Score?: ... }` produced a bare runtime the type called a `Result`. The type is now `Success<Runtime>` when nothing provided can fail (read `.value`), and a `Result` to check when a constructed resource may be provided.
  - **`thisTick` checks a writer that shares its reader's display name.** Systems may share a display name; the static check skipped any writer named like the reader. It now tells the reader apart by its system type.
  - **New lint `next-state-replaced`** (warning, debug runtimes): a next state one system queued and another replaced with a different value before the same `applyStateTransitions(...)`, naming both. Observed lints (this one and `requirement-violated`) no longer need `nameSchedules` to appear. `Debug.NextStateReplacement` describes an entry.
  - **A query match used after its run throws a named error.** Reading through a match kept past its run (in `local`) returned the internal absent marker once the entity was despawned, and writing put a removed component back without the insert path.
  - **A query descriptor that behaves unlike the registered one throws**: a look-alike (same kind and name) that adds or drops entity-state transitions, a constructor, immutability, or transience. Look-alikes that behave the same keep working.
  - `Scalar.Finite` and the `Vector2` / `Scalar` arithmetic helpers document that results keep the brand without re-validating, finite while they stay within `±Number.MAX_VALUE`.

- d47a4f9: **Runtime fixes from a review of 0.8.0.** No API changes; each fix restores what the docs already promised.

  - **Sub-states enter with their parent.** A sub-state now gets its entry value at the parent's commit, before any `onEnter` schedule runs. A failing `onEnter` of the parent no longer leaves it without a value (`inState` false and `set` failing with `SubStateInactive` until the parent came back), and its `despawnOnEnter` scopes no longer despawn what the parent's `onEnter` just spawned. The `onEnter` schedules still run parents first.
  - **A queued transition survives a transition schedule setting the same machine.** A value queued before `applyStateTransitions(...)` is committed there even when an `onEnter` / `onExit` of an earlier machine also calls `set` on it; that newer value waits for the next marker.
  - **`snapshot` and `restore` throw while a schedule is running**, like `send`. A restore from a system let its queued spawns overwrite restored entities, and a snapshot captured writes a failing system then rolled back. `tryTick` now sets the same guard, so `send` inside `tryTick` throws too.
  - **`restore` rejects an unknown scope name** with the new `UnknownScope` error, instead of putting entities in a scope nothing can name.
  - **`describe()` counts reads inside `Query.anyOf`**, so `component-never-read` no longer fires for a component read only through `anyOf`, and `read-before-write` sees it. A system placed directly and under `Schedule.when` / `pauseWhen` is one entry with both placements and the conditions of each.
  - **`Collide2` stops a circle that starts exactly touching a wall** and moves into it, instead of moving it through the wall: `sweepCircleBox` / `sweepCircleBoxes` now report a hit at time 0, and `moveCircle` blocks. This happens whenever a game places a body exactly at a wall without a skin (a snapped spawn point, or a projectile set to a sweep's contact point). Moving away from the wall or sliding along it is unchanged. A game that fingerprints its simulation will see fights that touched a wall this way play differently: re-record the fingerprints with the upgrade.
  - **Replays carry input into their window.** A replay saved after unchanged input (holding a direction longer than `keep`) had no input on its first ticks and handed systems `undefined` when played.
  - **`Session.run` stops with `invariant-threw`** when an invariant throws, naming the invariant and the error, instead of throwing out of `run` and losing the run's text.
  - The `Snapshot` docs now say that unread `runtime.send` events survive a restore, as they always did.

- Updated dependencies [c2c32e0]
- Updated dependencies [9cca78b]
- Updated dependencies [6c09482]
- Updated dependencies [ecfd0f1]
- Updated dependencies [d47a4f9]
- Updated dependencies [330246e]
- Updated dependencies [7f2b2dd]
  - @typeonce/ritmo@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [0b22113]
- Updated dependencies [a0fac0a]
- Updated dependencies [0b22113]
- Updated dependencies [a0fac0a]
- Updated dependencies [a580c9c]
- Updated dependencies [a580c9c]
  - @typeonce/ritmo@0.8.0

## 0.7.0

### Patch Changes

- 358401a: Link the bevy-ts migration guide from each published package README.
- Updated dependencies [84eac37]
- Updated dependencies [7ebd9af]
- Updated dependencies [358401a]
  - @typeonce/ritmo@0.7.0

## 0.6.0

### Minor Changes

- 130cb6e: Rename the package family from `@typeonce/bevy-ts*` to `@typeonce/ritmo*`.
  Update imports, workspace dependencies, type identity markers, examples, and
  documentation together. There are no compatibility aliases; use the matching
  Ritmo package for each previous Bevy TS package. The separate release preparation
  change coordinates the repository rename and retirement of the generated
  documentation site.
  Use "The agent-first type safe ECS runtime" in package metadata,
  documentation, and brand assets.

### Patch Changes

- c20bbc0: Document line of sight with `Collide2.sweepCircleBoxes` and a radius of 0.
- a8e0473: Retire the generated documentation site and point package homepages, source links,
  and issue links to the Ritmo repository in the Typeonce GitHub organization.
  Keep source JSDoc and repository guides, including the Pixi walkthrough in its
  example README.
- Updated dependencies [a8e0473]
- Updated dependencies [130cb6e]
- Updated dependencies [a1f18a8]
  - @typeonce/ritmo@0.6.0

## 0.5.0

### Minor Changes

- c5bd6d3: Add hot-path game helpers, lifted from a shipped top-down game: `Vec2` plain vector arithmetic (accepts validated `Vector2` values), `Box2` edge boxes, `Collide2` swept circle collision with sliding (no tunneling through thin walls, rounded corners), a `SpatialGrid` broad phase that allocates nothing per step, a `FlowField` that leads bodies around walls with clearance, and a deterministic `Random` whose whole state is one integer.

### Patch Changes

- @typeonce/bevy-ts@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [e2b2275]
  - @typeonce/bevy-ts@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [2b0fb7e]
- Updated dependencies [c4d1add]
- Updated dependencies [bd9bdd5]
- Updated dependencies [bd9bdd5]
- Updated dependencies [94bdc32]
- Updated dependencies [bd9bdd5]
  - @typeonce/bevy-ts@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [4b3a312]
- Updated dependencies [4b3a312]
- Updated dependencies [4b3a312]
  - @typeonce/bevy-ts@0.2.0

## 0.1.1

### Patch Changes

- c95a102: First release published from CI through npm trusted publishing, with provenance attestations. Declarations are now verified against consumers on both TypeScript 7 and TypeScript 6. No API or output changes.
- Updated dependencies [c95a102]
  - @typeonce/bevy-ts@0.1.1
