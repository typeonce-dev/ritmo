# Type architecture

The compiler should reject an invalid ECS program without making ordinary code hard to infer. That rules out carrying every query slot and access record through the whole program.

The current design has one rule: validate detailed input where the user creates it, then carry a smaller type.

## Descriptors and machines

Resources, services, and state machines are runtime requirement tokens. A system stores the actual tokens it needs in `requirements`.

Descriptor identity is `(kind, name)`, and that is deliberate: descriptor types are structural over the same pair, so runtime identity has to match what the compiler can distinguish. Two declarations with the same kind, name, and value type are the same descriptor.

The rules that keep this sound:

- A schema rejects two descriptors of one kind with the same name, and two entries with the same registry key, at compile time (`ValidateFragments` in `Schema.ts`) and again at runtime for erased types.
- The descriptor value type is invariant, so a look-alike descriptor with a narrower or wider value type is not accepted where the registered one is expected.
- Machine names are unique per bound `Game`, checked when `Game.StateMachine(...)` runs.

Systems are different: they own no storage, so each `Game.System(...)` value has its own identity and two systems may share a display name. Only the same system value twice in one schedule is rejected.

## Systems

`Game.System(...)` infers the complete access declaration once. The callback context comes from that exact declaration, so an undeclared query, resource, service, state, or machine is unavailable.

The resulting system carries two different views:

- `spec` keeps the exact access declaration for execution.
- `requirements` keeps only the union of resource, state, service, and machine tokens needed for provisioning.

Schedules never reconstruct requirement maps from `spec`. A system's expected
error is normalized once into a named `SystemFailure` and carried separately
from its access declaration.

## Schedules

A schedule contains normalized `steps`, the systems in those steps, and a deduplicated requirement-token array. Fragments, phases, nested schedules, and transition bundles all use the same shape.

Composition is a union operation. Adding a system adds its requirement tokens to the carried union. It does not intersect object maps or recursively fold the full system specification.

Expected failures use the same derive-once, carry-later rule. A system signals
one by returning `Result.failure(error)`; the error type is inferred from its
return type once and normalized into `SystemFailure<Name, Error>`. Nested
schedules, gated groups, transition plans, and transition bundles carry a union
of named system failures. The runtime returns that union; it does not
recalculate it from nested system specs.

`thisTick` reads follow the same rule. A schedule carries its entries as a phantom (no computation) and one flag: whether any entry has a `Game.System.thisTick` read. Only `runtime.tick(...)` with a read walks the entries: per read it finds the reader's position at each nesting level, slices the entries after it once, and looks for writers in the union of the systems there. It never folds over a tuple element by element, which was several times more expensive on a 150-system tick.

Structural work is applied only at explicit markers:

- `applyDeferred()` applies queued world commands.
- `applyStateTransitions()` applies queued commands, then commits queued machine transitions.

Reads need no marker. Change detection (`added`/`changed` filters, removed/despawned reads), events, transition events, and relation failures are per-reader streams: entries are stamped with the change tick at which they were published, and each system sees the entries after its previous completed run (see Storage). A system's events are published when it commits, so a failed system publishes nothing, and a failed reader sees the same entries again. `added`/`changed` filters compare slot ticks, so they see any change since the reader's previous run. Removed/despawned records, events, transition events, and relation-failure entries are kept for the current and previous `tick(...)` call, and beyond it until every system that reads them has run, so schedules ticked at different rates (a fixed update below the render rate) never drop messages or despawns. A system skipped by its run conditions discards the messages published meanwhile, but keeps its change-detection position, including removed/despawned reads. Each stream is capped at `Runtime.streamCapacity` entries; past it the oldest are dropped and readers that missed them see `lagged() === true`. Inspectors do not hold entries.

Nothing is flushed when a schedule ends. Queued work stays in the runtime, across schedule runs, until a marker applies it.

## Runtimes

`tick` is the static path. TypeScript compares the schedule's token union with the services, resources, and machines supplied to the runtime. Missing or incompatible provisions fail compilation.

`tryTick` is the dynamic path for tools that hold schedules whose exact type has been erased, such as devtools sessions. It checks the real tokens before execution and returns `MissingRuntimeRequirements` as data. It does not throw for missing provisions. Games use `tick`.

## Plugins

There is no plugin or feature object. A plugin is a function `(Game, options) => System | Schedule`: it receives the bound `Game` and returns systems or schedules built from it, like `RenderSync.system(Game, ...)` and `InputCapture.system(Game, ...)`. Its descriptors are a `Schema.fragment(...)` the game lists in its one `Schema.bind(...)` call. The result is an ordinary system or schedule, so it composes, carries requirements, and is checked by `tick` like any other; nothing needs a second composition step.

Runtime-dependent entity lookups stay fallible. An entity handle is safe to store, but it is not proof that the entity still exists.

Each system execution is atomic for ECS-owned writes. A successful system
commits its component, resource, state, event, queued-machine, and deferred
command changes. An expected failure rolls those changes back or discards them.
The schedule itself is not one large transaction: earlier successful systems
remain committed when a later system fails.

Entity scopes are ownership tokens, not liveness proofs. They let deferred
commands assign and remove scene-owned entities without adding a marker
component solely for cleanup.

Inspectors reuse the system access model but admit only read capabilities. They
return a projection directly and do not advance schedule visibility.

`debug: { hostClock }` attaches a read-only `Debug.Handle`; without it the
runtime has no `debug` member at all. Core reads no platform clock: trace
timings come from the injected `HostClock` (`HostClock.test()` in tests,
`BrowserHostClock.make(window)` in the browser). Tracing is enabled only while an `observe` listener is
registered: system, schedule, and marker boundaries check one boolean, and
component writes are reported from the rollback journal each system already
keeps, so untraced runs do no extra work per write.

Values obtained through read cells are deeply readonly. This prevents in-place
object or collection mutation from bypassing write capabilities, validation,
lifecycle tracking, and system rollback. Updates go through `set`, `update`,
`setRaw`, or their result-returning variants.

## Storage

The runtime lives in `packages/core/src/internal/`:

- `world.ts` stores every live entity as one record with component values in a dense array indexed by a per-world component ordinal. Each ordinal keeps the set of records that have it, and a membership version that changes on add or remove. Relations keep source-to-target and target-to-sources maps with their own versions.
- `queries.ts` compiles each query spec once per world. It caches the ordered match set and recomputes it only when a component or relation it depends on changed membership. The recompute walks the smallest required component set. Match objects (entity view plus cells) are created once per entity and query and reused. Cells read live storage, so reuse never exposes stale values. Results are in ascending entity id, which is spawn order.
- Change detection uses ticks. The world tick advances for every system run and every command flush; each component slot stores the tick it was added and last changed at. Each system remembers the tick of its previous completed run, and `added`/`changed` filters compare against it, so every system sees each change exactly once, independently of other systems. Per-component change logs let sparse `changed` queries skip unchanged entities. Removed and despawned reads use the same per-system cursor over logs that keep entries until every registered reader has passed them (capped at `Runtime.streamCapacity`).
- `cells.ts` holds the prototype-based cell objects used by query slots, resources, and states.

System contexts are built once per system and runtime, then reused.

## Performance baseline

`pnpm bench` runs every `packages/<name>/bench/*.bench.ts` suite (core, math, render): runtime cases, each in a fresh process, timed against a calibration workload, and checker metrics (types, instantiations) for the generated `bench/types/stress.ts` program. `packages/core/bench/baseline.json` is the committed reference. CI compares each pull request with its base commit on the same runner. Update the baseline with `pnpm bench:update` when a change intentionally shifts the numbers.

## Extension rule

New system access categories should answer one question before they become public: does the runtime need a provision for this access?

If yes, add one nominal requirement token and teach the runtime how to validate it. If no, keep the access local to `SystemSpec`. Do not add another schedule-level object map or a recursive type fold.

## Verification

`pnpm run check` runs the TypeScript 7 compiler (`typescript`), type assertions through TSTyche on the TypeScript 6 JavaScript API (`typescript6`, which TypeScript 7 no longer ships; the docs generator uses it too), and runtime tests. `pnpm pack:check` type-checks the published packages from a consumer project with both TypeScript 7 and 6. `packages/core/dtslint/Architecture.tst.ts` composes a wide schedule to guard against the dependency-depth failures that stopped earlier development. `pnpm bench:check` guards runtime and checker performance.

## Native seams

The private `Symbol.for("@typeonce/ritmo/native@0.8")` on bound games registers
numeric layouts before runtime construction. The symbol is absent from public
types. Unregistered worlds keep ordinary arrays and the existing read/write path.
Registered worlds install numeric-column accessors into those arrays; snapshots,
restore, cells, debug dumps, membership and transaction journals share that storage.
Columns double on growth and reuse entity slots after despawn. Record-local presence
keeps stale reads invalid when a slot is reused. Numeric object reads are fresh,
frozen objects; scalar and object field shapes are checked on writes.

Query handles expose the same symbol only for registered worlds. Its view provides
cached entity slots, raw Float64 columns, Int32 marks, layout descriptors and the
current system tick. Kernels journal old double values natively; core's transaction
commit/rollback owns the native journal. Native writes invalidate sparse change
logs, making filtered readers scan authoritative marks. Exit phases and debug
traces use the original callback, preserving their ordered rollback and trace
contracts. Kernels check buffer types, extents and layout hashes before entering C.
`pnpm test:native-columns` runs the core suite with numeric layouts enabled.
