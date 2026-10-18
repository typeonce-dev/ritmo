## Vision
- This library is agent-first: coding agents write all code that uses it; a human directs the game and does not read the code.
- The library is the agent's guardrail. Guarantees come in three layers: (1) compile time, a wrong call does not compile and the error names the fix; (2) runtime inspection via headless devtools sessions (lints, invariants, why/journal); (3) lock-in, every found bug becomes a test.
- One way to do each thing. Two APIs for one job is a safety bug: an agent will pick both.
- Names and JSDoc are part of the API: each export says what it is for, when to use it, and which neighbouring API to use instead.
- The library is early: breaking changes, removals, and renames are welcome. Do NOT keep deprecated aliases or re-exports. Long-term clean API first.

## Repo Structure
- [`packages/core`](./packages/core/): strict public ECS/runtime library surface, plus the platform-free fixed-step loop (`FixedLoop`).
- [`packages/browser`](./packages/browser/): browser host adapters (BrowserTickSource, BrowserHostClock) and keyboard, pointer, and touch input.
- [`packages/render`](./packages/render/): renderer-agnostic node registry and render-sync systems.
- [`packages/pixi`](./packages/pixi/): Pixi container adapter (`PixiNodeRegistry.make`) for the render package's registry contract.
- [`packages/math`](./packages/math/): validated math values (Scalar, Vector2, Size2, Aabb, InputAxis) and hot-path game helpers (Vec2, Box2, Collide2, SpatialGrid, FlowField, Random).
- [`packages/devtools`](./packages/devtools/): debug sessions, trace history, and text reports over the core `Debug` handle.
- [`packages/native`](./packages/native/): QuickJS-ng/SDL3 native hosts, numeric C kernels, and desktop/mobile builds.
- [`examples`](./examples/): workspace example apps that consume packages by package name.

## Package Scope
- Packages never draw. Drawing, particles, and effects stay in games.
- Bridge code that hands a renderer or the platform what it needs (nodes, positions, input, timing) and glue that would otherwise repeat in every game belong in the support packages.
- Hand the game the data it needs to draw (like `Touch`'s `view()`), never the drawing itself.
- Core and generic package modules never call a platform API (`performance`, `window`, `document`, timers, file system, network). A platform detail is a generic contract in the owning package with platform implementations injected (like `NodeRegistry` / `PixiNodeRegistry`, `HostClock` / `BrowserHostClock`, `FixedLoop.TickSource` / `BrowserTickSource`). A default may use only what JavaScript itself guarantees in every engine. The compiler enforces this: package configs get only the ES2022 library, so a DOM or Node global does not compile; a host package that needs DOM types lists `"DOM"` in its own `lib`, as `packages/devtools` does for `Monitor`.
- Simulation code reads time from `Clock` and randomness from `Random`; host time (`HostClock`) is for hosts, tools, and debug timing, never for systems.

## Core Principles
- Type safety is the first and absolute priority.
- Public APIs must be as strict as possible.
- If a runtime failure can be made impossible by types, it must be.
- If a guarantee depends on runtime state, that uncertainty must be explicit in the type surface.
- Prefer explicit APIs over overloaded, implicit, heuristic, or convenience-first APIs.
- Build APIs as small composable lego blocks that remain independently type-safe.

All changes to be complete MUST BE VERIFIED by running `pnpm run check`.
Changes to what a package publishes (exports, `package.json`, build config) must also pass `pnpm pack:check`.
Every change to a published package needs a changeset (`pnpm changeset`); all `@typeonce/ritmo*` packages share one version.
Changes to runtime internals or public types must also pass `pnpm bench:check`; if a change intentionally moves the numbers, record it with `pnpm bench:update` and commit the new baseline.

## Performance
- Runtime cases live in `packages/<name>/bench/*.bench.ts` (core, math, render) and use only the public API; add a case when a change creates a new per-frame hot path.
- The committed baseline (`packages/core/bench/baseline.json`) is the target for type-checker metrics on any machine; its runtime scores only compare on similar hardware.
- For runtime work, compare against your own machine: run `pnpm bench --json .bench/before.json` before the change, then `pnpm bench --compare .bench/before.json` after it (exits 1 on a regression over the tolerance). Use `--filter <text>` to iterate on one case.
- Differences under about 20% are within noise; do not report them as wins or losses.

## Type Tests
- Public types are tested with TSTyche in `packages/*/dtslint/*.tst.ts` (`pnpm test-types`).
- Every public API gets a test of its inferred type (`expect(...).type.toBe<...>()`) and a failing test for each constraint.
- A failing test states the error it expects: `// @ts-expect-error <fragment of the message>`, or `expect(fn).type.not.toBeCallableWith(...)` paired with a passing call. `// @ts-expect-error!` (message not checked) is rejected by `pnpm test-types`, because such a test also passes for unrelated errors.
- Pick fragments that name the cause (the missing requirement, the conflicting name, the wrong value) and avoid printed unions, whose order is not stable.

## Public API Rules
- Do not require user-facing casts.
- Do not require explicit generic arguments for normal usage.
- Do not require users to split schedules, features, or flows into pieces only to satisfy the compiler.
- Do not hide normal failure behind exceptions.
- Do not make the wrong call easy through broad overloads or ambiguous semantics.

## Internal Type Rules
- Validate exact structure at the constructor boundary.
- Derive normalized carried types once, then reuse them.
- Relax only internal post-validation precision when that precision is not user-meaningful.
- Never trade away root safety, requirement safety, or explicit runtime-failure semantics for compiler performance.
- Internal type optimization is allowed only when the user-facing API stays unchanged and requires no casts or scaffolding.

```ts
const A = Game.System("A", { queries: { moving: Moving } }, ...)
const B = Game.System("B", { resources: { score: Game.System.writeResource(Score) } }, ...)

const schedule = Game.Schedule(A, Game.Schedule.applyDeferred(), B)

// Acceptable internal strategy:
// 1. Validate exact references here.
// 2. Carry a cheaper normalized schedule type afterward.
// 3. Keep the same public guarantees.
```

## Explicit Runtime Semantics
- Long-lived references are storage-safe handles, not proof of liveness.
- Lookups and dynamic reads must stay explicit and typed as fallible when they depend on current runtime state.
- Schedule boundaries stay explicit: deferred commands and state transitions are applied only by explicit schedule markers (`applyDeferred()`, `applyStateTransitions(...)`).
- Reads are per-reader streams, not marker-driven: change detection, events, transition events, and relation failures show each system what was published since its own previous run, once. Change detection compares each write's tick with each reader's previous run, so a reader skipped for any number of ticks still sees it; events, transition events, and relation failures are kept until every reading system has run (capped, with `lagged()` reporting loss).

```ts
const target = lookup.getHandle(handle, query)
if (!target.ok) {
  return
}
```

## Debugging Game Behavior
- Reproduce headless before changing code: build the game's simulation schedules on a runtime made with `debug: { hostClock: HostClock.test() }` and scripted input (`Keyboard.scripted`). [`examples/top-down/simulation.ts`](./examples/top-down/simulation.ts) is the reference; copy [`examples/top-down/debug.ts`](./examples/top-down/debug.ts) and run it with `node --import tsx <script>`.
- Use `@typeonce/ritmo-devtools` sessions: read the lints at the top of `describe()` first, then orient, `run(name, { frames })` with an `Invariant` that encodes the bug, then `why(entity, Component)`, `journal({ frames, entity })`, and `report()` to explain it. See [`packages/devtools/README.md`](./packages/devtools/README.md).
- Once the script reproduces the bug, turn it into a test next to the game.

## Design References
- [`bevy`](./.agents/bevy/): ECS concepts, scheduling, states, and relationships. Reference for the problem space, not a mandate to copy engine-owned ergonomics.
- [`effect-smol`](./.agents/effect-smol/): explicit dependencies, canonical carried types, derive-once/carry-later type architecture.
- [`arktype`](./.agents/arktype/): TypeScript performance patterns, normalization strategy, merge-over-intersection when valid, and avoidance of reflective type machinery.

Use these references to guide design decisions, but preserve this library's stricter rule: user-facing safety and explicitness come first.
