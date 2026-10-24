# Plan: `@typeonce/ritmo-native`, native hosts and compiled systems

Run games written with ritmo outside the browser, as native desktop and mobile
apps, without a webview, while games stay TypeScript-only. Later, the same
host carries them to consoles. Hot systems are compiled ahead of time to C,
so an interpreted host keeps native speed where the frame time is spent.

This plan is written for an agent that implements it end to end. It records
every decision already made, the reasons, the assumptions, and how each
phase is verified. Read it fully before starting. Read `AGENTS.md` (CLAUDE.md
links to it) as well: its rules apply to every step here.

## 1. Goal, in one paragraph

A game made only with `@typeonce/ritmo*` packages adds one entry file
(`native.ts`), one config file, and a native drawing layer, then runs
`ritmo-native build --target <platform>` and gets a native app. The app is a
small C program that embeds a JavaScript interpreter (QuickJS-ng) to run the
game's bundled code, uses SDL3 for window, input, timing and 2D drawing, and
links C code generated from the game's hot systems. The generated code
produces bit-identical worlds to the JavaScript runtime, checked frame by
frame by tests.

## 2. Background and decisions already made

These were decided with the user. Do not reopen them; if one proves
impossible, stop and report with evidence (see section 12).

1. **Games stay in TypeScript.** The type checker is the product's first
   guarantee. No other language for game code.
2. **No webview, no WebAssembly core.** The game runs in an embedded
   interpreter inside a native program.
3. **Interpreter: QuickJS-ng** (pure C, ES2023, precompiled bytecode with
   `qjsc`, trivially embeddable, builds on any C toolchain including console
   SDKs). Keep the engine behind one internal C interface (`rn_engine.h`) so
   Hermes can be added later without touching the rest.
4. **Platform layer: SDL3** for window, input, audio-ready event loop,
   timing and 2D drawing (`SDL_Renderer`). SDL ships console backends to
   licensed developers, which is the console path. Use SDL3's built-in
   `SDL_RenderDebugText` for text in the MVP; use `stb_image` for PNG
   loading (single header, no extra library).
5. **Generated code is C (C11)**, because every console toolchain compiles
   C. The build-time compiler is written in TypeScript and uses the
   TypeScript 6 JavaScript API (`typescript6` is already a root dev
   dependency; TypeScript 7 has no stable JS API).
6. **Compile only a subset: hot systems.** Not the TypeScript language. The
   subset (section 7) is per-entity numeric work over query matches. Every
   other system stays interpreted. A system outside the subset is never an
   error unless the config requires it to compile.
7. **The JavaScript runtime is the oracle.** Compiled output must produce the
   same world snapshot as the interpreted run, every frame, for scripted
   input. Any mismatch is a bug in the compiler, and it becomes a test.
8. **No new public API in core.** Core gets internal seams (section 6) that
   only the native package uses. Game code does not change.
9. **One way to do each thing.** The native host reuses existing modules
   where their contracts are structural: `Keyboard.actions(host, ...)` and
   `Pointer.track(...)` from `@typeonce/ritmo-browser` take structural hosts,
   so the native host implements `KeyboardHost`, `PointerTarget` and
   `BlurHost` instead of adding a second input module. `FixedLoop` (core)
   drives the loop with a native `TickSource`.

### Measured motivation

Node with `--jitless` (V8's interpreter only) stands in for a no-JIT
platform (consoles, iOS). Same machine, same commit:

| Benchmark case | With JIT | Interpreter only |
|---|---|---|
| `frame/50-systems-5k` | 4.2 ms | 36.9 ms |
| `query/iterate-write-10k` | 0.8 ms | 5.3 ms |
| `render/sync-1k-changed-of-10k` | 0.65 ms | 3.2 ms |
| `math/collide-move-circle-1k` | 0.76 ms | 14.4 ms |
| `schedule/100-systems-x10` | 0.21 ms | 0.91 ms |

Scheduling overhead stays small when interpreted. Per-entity loops are where
the frame goes, and those are what the compiler targets. QuickJS is expected
to be slower than V8's interpreter; Phase 0 measures it.

## 3. Assumptions

State in the PR description any assumption that turns out false.

- The work happens in this monorepo. The new package is
  `packages/native` (`@typeonce/ritmo-native`), versioned with the other
  packages (changesets `fixed` group in `.changeset/config.json`).
- Third-party C code is vendored with pinned versions, not fetched at user
  build time: QuickJS-ng and `stb_image` as source under
  `packages/native/vendor/`, SDL3 as a pinned source tarball fetched by CMake
  `FetchContent` with a SHA256, cached in CI. Record versions and licenses
  (all MIT/zlib/public domain) in `packages/native/vendor/README.md`.
- The implementation environment is a Linux container without a display.
  Desktop verification there uses SDL3's `offscreen` video driver and the
  software renderer, which allows reading pixels back for screenshot tests.
  macOS and Windows builds are verified on GitHub Actions runners.
  Android and iOS are verified by building for the emulator and simulator on
  GitHub Actions; no signing accounts are needed for that.
- If the container's network policy blocks downloading SDL3, QuickJS-ng or
  toolchains, read the environment documentation (network topic) and report
  what is blocked; do not replace a decided dependency silently.
- `esbuild` is the bundler (already in the lockfile through `tsx` and
  `vite`); add it as a direct dependency of `packages/native`.
- The `examples/top-down` game is the reference game for every phase. It
  already separates simulation from host (`simulation.ts`, `browser.ts`,
  `host.ts`, `render/`) and has scripted input tests.
- Consoles are out of scope for code in this repository (NDA). The plan
  must keep them possible: everything on device is C, the platform layer is
  isolated behind `rn_platform.h`, and nothing assumes a JIT.

## 4. Architecture

```
 build time (developer machine, Node)                 run time (device)
 ┌──────────────────────────────────────┐           ┌──────────────────────────────────┐
 │ ritmo-native CLI (TypeScript)         │           │ app binary (C)                    │
 │  1. typecheck (tsc -b)                │           │  rn_main.c     entry, frame loop  │
 │  2. analyze systems (TS6 API)         │──C code──▶│  generated/    compiled systems   │
 │  3. emit kernels.c + layouts          │           │  rn_kernel.c   kernel ABI, tables │
 │  4. bundle game (esbuild, ES2022)     │──bytecode▶│  rn_engine_qjs QuickJS-ng binding │
 │  5. qjsc → bytecode as C array        │           │  rn_host.c     host object for JS │
 │  6. cmake configure + build           │           │  rn_platform_sdl3.c window/input/ │
 └──────────────────────────────────────┘           │                gfx/clock/files     │
                                                     └──────────────────────────────────┘
```

At run time the ritmo runtime (core, in the interpreter) still owns every
semantic: schedules, run conditions, markers, state machines, commands,
events, change detection, snapshots, debug. When it reaches a compiled
system, the system's callback (rewritten at bundle time) hands raw column
memory to the C kernel and returns. Everything else is unchanged JavaScript.

### Device-side C modules (`packages/native/runtime/`)

| File | Owns |
|---|---|
| `rn_main.c` | `main`, startup, loading the bytecode, calling the game's exported `main(host)`, the SDL event loop and frame pacing |
| `rn_engine.h`, `rn_engine_qjs.c` | the only code that includes QuickJS headers: create context, load bytecode, call functions, expose host functions, read `ArrayBuffer` pointers without copying |
| `rn_host.c` | the `host` object passed to the game: `clock.now()`, `frames.subscribe/stop`, keyboard/pointer/blur event targets, `gfx`, `assets`, `kernels.run` |
| `rn_platform.h`, `rn_platform_sdl3.c` | the only code that includes SDL: window, events, renderer, textures, timing. A console port replaces this file |
| `rn_gfx.c` | retained 2D scene: layers, sprite/rect/text nodes, draw order, one draw pass per frame |
| `rn_kernel.h`, `rn_kernel.c` | kernel ABI (section 7.4), registry of generated kernels by id, failure reporting |
| `generated/` | written by the CLI per game: `kernels.c`, `bundle.c` (bytecode array), `assets.c` or an asset directory manifest |

### TypeScript side (`packages/native/src/`)

Follow the adapter naming rule in `PLATFORM.md`: generic contracts keep
generic names, implementations carry the platform name.

| Module | Export | Purpose |
|---|---|---|
| `NativeHost.ts` | `main(entry)`, `Host` type | declares the entry point the C program calls; the host is passed in, never read from a global |
| `NativeTickSource.ts` | `make(host)` | `FixedLoop.TickSource` over the native frame callback |
| `NativeHostClock.ts` | `make(host)` | core `HostClock` over the platform's monotonic clock |
| `NativeNodeRegistry.ts` | `make(layer)` | `NodeRegistry` (render package) whose nodes are native scene nodes; removal destroys the node |
| `NativeGfx.ts` | types only | the `host.gfx` surface: layers, sprites, rects, text, textures. A thin binding over the C scene; it draws only what the game creates, like `pixi.js` |
| `cli.ts` | `ritmo-native` bin | `doctor`, `dev`, `check`, `build` (section 9) |
| `compiler/` | internal | system analysis, subset checking, C emission, bundle transform |

`packages/native/tsconfig.json` uses the ES2022-only `lib` from the base
config. The CLI and compiler need Node types: put them in a separate
project (`tsconfig.cli.json`) with `"types": ["node"]`, as devtools does for
its CLI, so the runtime-facing modules never see Node or DOM globals.

The game's `native.ts` looks like this (the reference to aim for):

```ts
import { Clock, FixedLoop } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { NativeHost, NativeHostClock, NativeNodeRegistry, NativeTickSource } from "@typeonce/ritmo-native"

export default NativeHost.main((host) => {
  const keyboard = Keyboard.actions(host.keyboard, inputBindings)
  const actors = NativeNodeRegistry.make(host.gfx.layer("actors"))
  const runtime = createTopDownRuntime({ keyboard, actors, hostClock: NativeHostClock.make(host) })
  if (!runtime.ok) return host.fail(runtime.error.message)
  runtime.value.tick(setupSchedule)
  return FixedLoop.start({
    source: NativeTickSource.make(host),
    step: FIXED_STEP,
    maxFrameSeconds: MAX_FRAME_SECONDS,
    maxStepsPerFrame: MAX_STEPS_PER_FRAME,
    update: () => runtime.value.tick(updateSchedule),
    render: (frame) => runtime.value.tick(renderSchedule),
    onFailure: (failure) => host.fail(failure.kind)
  })
})
```

Exact names may change during implementation; the shape may not: one
exported entry function, the host injected, adapters named `Native*`, and
the game's schema, systems and schedules untouched.

## 5. Rules for every step

1. **Repo rules first.** `pnpm run check` after every step; `pnpm pack:check`
   for any change to what a package publishes; `pnpm bench:check` (and the
   same-machine `pnpm bench --compare`) for any change to core internals;
   a changeset for every published change; no deprecated aliases.
2. **Lock-in first.** Write the failing test, run it red, fix, run it green.
   Type tests state their expected message fragment
   (`// @ts-expect-error <fragment>`). Pair every rejection with a passing
   call.
3. **Core seams must not slow the browser path.** The seams in section 6 are
   off unless the native bundle turns them on. Same-machine bench compare
   against `main` must show no regression over 20% on any case.
4. **Each phase ends green and usable.** Commit per step with a message that
   says what it adds and how it was verified. One PR per phase, merged before
   the next phase starts, so `main` never holds half a phase.
5. **C code**: C11, warnings as errors (`-Wall -Wextra -Werror`, `/W4 /WX`),
   no global mutable state outside `rn_main.c`, every allocation freed on
   shutdown, AddressSanitizer and UBSan builds in CI on Linux. Never compile
   generated kernels with `-ffast-math`; always pass
   `-ffp-contract=off` (MSVC: `/fp:precise`) so results match JavaScript.
6. **Generated code is deterministic**: the same input produces byte-identical
   C files, sorted by system name, so diffs are reviewable.
7. **Errors name the fix.** Every CLI and compiler message says what to change,
   in the style of the library's compile errors.

## 6. Core seams (internal, no public API)

Core is published code and its contracts are strict. These seams are
reachable only through a well-known symbol,
`Symbol.for("@typeonce/ritmo/native@<major.minor>")`, so they are invisible
to game code, absent from public types, and versioned with the packages.
Document each seam in `ARCHITECTURE.md` under a new "Native seams" section.

### 6.1 Columnar storage for fixed-layout components

Today each entity keeps component values in `EntityRecord.values`
(`packages/core/src/internal/world.ts`, about line 31), one JS value per
component, with change ticks in `EntityRecord.marks` (`MARK_STRIDE = 3`). The
storage is read directly at about 29 sites:

| File | Sites |
|---|---|
| `internal/world.ts` | 14 |
| `internal/cells.ts` | 7 |
| `Runtime.ts` | 3 |
| `internal/debug.ts` | 2 |
| `Decode.ts`, `internal/order.ts`, `internal/queries.ts` | 1 each |

Add an internal layout registration on a bound `Game`:
`Game[nativeSymbol].layouts({ "TopDown/Position": ["x", "y"], ... })`, called
by the generated bundle prelude before `Runtime.make`. A registered
component's values live in one `Float64Array` per field, indexed by a dense
entity slot, plus its marks in an `Int32Array`. Requirements:

- Unregistered components and every runtime without registrations behave
  exactly as today, through the same code path or a branch that the bench
  shows is free.
- A read cell on a columnar component returns a fresh frozen-shape object
  built from the columns (interpreted systems keep working); a write cell
  writes the fields. Immutable components, constructed-component validation,
  stale-read errors, transactions and rollback (`setComponentValue`, the
  journal) keep their current semantics.
- Snapshots, restore, debug dumps, `why`/`journal`, lints and despawn all see
  the same values as before. The existing core test suite must pass with
  every eligible component in the core tests registered as columnar: add a
  test mode (vitest project or environment flag) that runs the whole suite
  that way.
- Columns grow by doubling; slots are reused after despawn with the existing
  generation scheme.
- Only components whose value type is an object of `number` fields (or a
  single `number`) are eligible. The compiler decides eligibility from types;
  core trusts the registration but validates field names on first spawn and
  throws a defect naming the component if they do not match.

### 6.2 Query views for kernels

A kernel needs, for one query in one run: the matching slots as an
`Int32Array` and their count, plus the columns and marks of each selected
component. Expose through the symbol on a query context:
`queries.x[nativeSymbol].view()` returning those buffers (no copies of
component data; the slot array may be rebuilt from membership when the
query's membership version changed). Queries with `added`/`changed` filters,
`anyOf`, or optional slots are not exposed in the MVP (section 7 keeps those
systems interpreted).

### 6.3 Kernel writes and change ticks

Writes inside a kernel must be indistinguishable from writes through cells:
the change tick is the system's `thisRun` tick (`Runtime.ts`, `runSystem`,
about line 1806), and a failed run rolls back. The view therefore also
exposes the current tick and a journal hook: the kernel records
`(slot, field, old value)` in a native journal and the wrapper calls
`commit(writtenSlots)` or `rollback()` through the seam, which applies the
marks or restores the values. Prefer this over JS-side journaling: the point
is to keep the loop out of the interpreter.

### 6.4 No-JIT benchmark

Add `pnpm bench:jitless` (runs `scripts/bench.ts` under
`node --jitless --expose-gc`) and a CI job that records it as an artifact
next to the existing performance job, without a pass/fail threshold yet.

## 7. The compiled subset

### 7.1 Eligibility of a system (all must hold)

- Declared through `Game.System(name, spec, callback)` with an inline arrow
  or function callback, statically resolvable (no callback passed in from a
  variable that the analyzer cannot follow to one definition).
- `spec` has only `queries` and `resources`. Queries use only
  `read`/`write`/`with`/`without` with eligible components (6.1). Resources
  are read (`readResource`) and hold a `number` or an eligible object.
  No `commands`, events, machines, `nextMachines`, `when`/`pauseWhen` gates
  (gated systems may be compiled later; the gate itself is evaluated by core
  anyway, so allow them if trivial, but not in the first cut), no `thisTick`
  reads, no relations, no lookups.
- The callback returns nothing (cannot fail), or returns
  `Result.failure(...)` only from the validation of a constructed component,
  which the kernel reports through the failure flag (7.4).

### 7.2 Allowed statements and expressions in the callback

- `for (const m of queries.q.each())` and `for (const { data } of ...)`, at
  most two nesting levels (pairwise loops such as collision against walls).
- `queries.q.singleOptional()` with the `ok`/`value` checks used in
  `examples/top-down/systems/movement.ts`.
- `cell.get()` and field access on its result; `cell.set({ ... })`,
  `cell.update((v) => ({ ... }))`, `cell.updateRaw(...)` with object
  literals of numeric fields.
- `resources.r.get()`.
- `const`/`let` of type `number` or `boolean`, or of an eligible object type
  that never escapes (scalar-replaced into locals).
- Arithmetic `+ - * / %`, unary `-`, comparisons, `&& || !`, ternaries,
  `if`/`else`, `return`, `continue`, `break`, `while`, `for (let i = ...)`
  over numbers.
- `Math.abs`, `Math.min`, `Math.max`, `Math.sqrt`, `Math.floor`,
  `Math.ceil`, `Math.round`, `Math.trunc`, `Math.sign`, `Math.hypot` (two
  arguments, implemented exactly as V8 does or excluded), module-level
  `const` numbers, and calls to module-level functions that are themselves
  in the subset (inlined or emitted as `static` C functions).
- Everything else (strings, arrays, `.map`, closures that escape, `new`,
  `Math.sin` and other transcendental functions, `Random`, `console`,
  exceptions) makes the system ineligible. Transcendental functions are
  excluded because C `libm` and V8 may differ in the last bit.

Write the subset as a table in `packages/native/README.md`; the compiler's
diagnostics link to it.

### 7.3 Numeric semantics

- JS numbers are IEEE doubles: emit `double`. Integer-looking code stays
  double. `%` uses `fmod`. Comparisons with `NaN` follow IEEE, as in JS.
- `Math.round` must follow JS (`floor(x + 0.5)` with the JS edge cases for
  `-0.5` and large values), `Math.max`/`Math.min` must follow JS for `NaN`
  and `-0`, `Math.sign` likewise. Each has a test against V8 on edge inputs.
- `-0` must survive where JS keeps it (division, multiplication), because
  snapshots are compared bit for bit.

### 7.4 Kernel ABI

```c
typedef struct {
  int32_t count; const int32_t* slots;        /* matching entity slots */
  double* const* columns;                    /* one per selected field, in emission order */
  int32_t* const* marks;                     /* one per written component */
} rn_query_view;

typedef struct {
  const rn_query_view* queries;              /* in the spec's query order */
  const double* resources;                   /* flattened numeric resource fields */
  int32_t tick;                              /* the run's change tick */
  rn_journal* journal;                       /* records old values before each write */
  int32_t failed;                            /* set to 1 on a validation failure */
} rn_kernel_args;

typedef void (*rn_kernel_fn)(rn_kernel_args* args);
```

The CLI emits one `rn_kernel_fn` per compiled system and a table
`{ system name, layout hash, fn }`. At startup the host checks each entry's
layout hash against the layouts registered by the bundle and refuses to run
(clear message) on mismatch, so a stale binary never writes wrong memory.

### 7.5 Bundle transform

During bundling, an esbuild plugin rewrites each compiled system's callback
into a wrapper that: reads the query views and resources through the seam,
calls `host.kernels.run(id, args)`, then commits or rolls back and returns
`Result.failure(...)` with the same error value the interpreted code would
have produced. The original callback stays in the bundle and runs instead
when `RITMO_NATIVE_KERNELS=off` (used by `ritmo-native check` and `dev`), so
the oracle comparison uses the same bundle.

### 7.6 Compile report

Every build prints, and writes as JSON to `.ritmo-native/report.json`:
compiled systems, and for each interpreted system the first blocking
construct with file, line and the subset rule it breaks. The config field
`requireCompiled: ["TopDown/MovePlayer", ...]` turns those into build errors.

## 8. Correctness: the oracle

- **Reference run**: the game's headless simulation (`simulation.ts`) with
  scripted input (`Keyboard.scripted`), in Node, interpreted.
- **Native run**: the same bundle in the native host with kernels on, driven
  by the same timeline, in headless mode (no window, fixed step, no frame
  pacing): `app --headless --frames N --input timeline.json --snapshots out.jsonl`.
- **Comparison**: `runtime.snapshot()` after every frame, serialized with a
  number encoding that preserves `-0` and `NaN` bits, compared exactly. The
  first differing frame is reported with the entity, component and field.
- **Coverage**: the top-down timelines in `examples/top-down/test/`, plus a
  generated stress game in `packages/native/test/fixtures/` that uses every
  subset construct, 5k entities, collisions, despawns between frames (slot
  reuse) and a validation failure (rollback path).
- **Fuzzing**: a test generates random subset-only systems (expression trees
  over numeric fields) and compares interpreted and compiled results for
  random inputs, including `NaN`, `±Infinity`, `-0` and subnormals.
- Every mismatch found becomes a fixture test before it is fixed.

## 9. CLI and user setup

```sh
pnpm add -D @typeonce/ritmo-native
ritmo-native doctor                    # toolchains present for each configured target
ritmo-native dev --target desktop      # prebuilt dev shell, interpreted, reload on save
ritmo-native check                     # typecheck, compile report, oracle comparison
ritmo-native build --target linux      # also macos, windows, android, ios
```

`ritmo-native.config.ts` (validated at load; errors name the field):

```ts
export default {
  entry: "./native.ts",
  simulation: "./simulation.ts",      // used by `check` for the oracle
  app: { name: "Top Down", id: "dev.typeonce.topdown", version: "0.1.0", icon: "./assets/icon.png" },
  window: { width: 1280, height: 720, resizable: true },
  assets: "./assets",
  targets: ["linux", "macos", "windows", "android", "ios"],
  requireCompiled: []
}
```

- `dev` uses a prebuilt shell binary for the host platform (built once into
  `.ritmo-native/cache`), so iteration needs no C compiler: it loads the
  bundle as source (QuickJS compiles at load) and reloads on file change.
- `build` creates `.ritmo-native/<target>/` with the generated sources and a
  CMake project, then builds it. Output: Linux binary plus assets folder;
  macOS `.app`; Windows `.exe` plus assets; Android: a Gradle project in
  `native/android/` that the user owns after generation, built with Gradle to
  an APK; iOS: an Xcode project in `native/ios/`, built with `xcodebuild`
  for the simulator, or opened in Xcode for signing.
- `doctor` checks: Node and pnpm versions, a C compiler and CMake (desktop),
  Xcode command-line tools (macOS, iOS), Android SDK, NDK and Java (Android).

| Target | Developer installs | Account to ship |
|---|---|---|
| Linux, Windows | C compiler and CMake (or a bundled Zig toolchain, see section 12) | none; Windows code signing optional |
| macOS | Xcode command-line tools, CMake | Apple Developer ID |
| Android | Android Studio (SDK, NDK, Java) | Google Play developer account |
| iOS | Xcode on a Mac | Apple Developer Program |
| Consoles | vendor SDK and devkit, private platform layer | approved vendor developer account |

## 10. Phases

### Phase 0: de-risk (no published change except the bench script)

| Step | Work | Verified by |
|---|---|---|
| 0.1 | Add `pnpm bench:jitless` and its CI job (6.4). | job runs on the PR, artifact uploaded |
| 0.2 | Spike: bundle `examples/top-down/simulation.ts` with esbuild (ES2022, ESM, single file) and run 600 frames of scripted input in the `qjs` CLI of the vendored QuickJS-ng. Fix nothing in core yet; list every incompatibility found. | spike script in `packages/native/spikes/`, report in the PR |
| 0.3 | Run the core runtime benchmarks under QuickJS-ng (bundle `scripts/bench.ts` cases that use only the public API). | table of QuickJS vs `--jitless` vs JIT in the PR |
| 0.4 | Build SDL3 from the pinned source with only the offscreen and dummy video drivers in the container; render a rectangle and read pixels back. | spike test passes in CI |

Gate: QuickJS-ng runs the unmodified simulation and matches Node's final
snapshot exactly. If it does not, fix core only where the cause is a
non-standard dependency; otherwise stop and report.

### Phase 1: native host, interpreted only (desktop)

| Step | Work | Verified by |
|---|---|---|
| 1.1 | Create `packages/native` (package.json, tsconfigs, README, LICENSE, vendor folder, CMake skeleton). Add it to `tsconfig.packages.json`, `tsconfig.json` paths, `tsconfig.tstyche.json` paths, the changesets fixed group, `scripts/pack-check.ts`. | `pnpm run check`, `pnpm pack:check` |
| 1.2 | C runtime: `rn_engine_qjs`, `rn_platform_sdl3`, `rn_main` with `--headless`. Load a bundle, call `main(host)`, pump frames. | C unit tests (CTest), ASan/UBSan build |
| 1.3 | Host surface: `clock`, `frames`, `keyboard`/`blur` as `KeyboardHost`, `pointer` as `PointerTarget`, `fail(message)`. TS adapters `NativeHost`, `NativeTickSource`, `NativeHostClock` with type tests and runtime tests against a fake host. | `pnpm run check`, dtslint for every export with a failing case per constraint |
| 1.4 | `rn_gfx` and `NativeGfx`, `NativeNodeRegistry`: layers, textures from PNG, sprites (position, scale, rotation, anchor, tint, frame rect), rects, debug text. | TS tests with a fake gfx; C screenshot tests in offscreen mode compared to committed PNGs with a small per-pixel tolerance |
| 1.5 | `ritmo-native build --target linux` and `dev`: bundle, `qjsc`, CMake build, assets copy. | building the top-down example in CI |
| 1.6 | Port `examples/top-down` to native: add `native.ts`, `render/native/` (backdrop, nodes, player sheet, HUD with debug text), `ritmo-native.config.ts`. Systems, schema, schedules, simulation unchanged. | headless run: 600 frames of the existing scripted timelines produce the same snapshots as Node; screenshot at frame 300 matches a committed image |
| 1.7 | CI matrix: build and run the headless test on `ubuntu-latest`, `macos-latest`, `windows-latest`. | green matrix |
| 1.8 | Docs: package README (setup, commands, host surface), GAME_API.md section "Run natively", PLATFORM.md entry for the native package, AGENTS.md repo structure line, changeset (minor). | review, `pnpm run check` |

Gate: the top-down example runs as a native desktop app on three operating
systems and matches the Node oracle frame by frame. This phase alone gives
the console path, at interpreter speed.

### Phase 2: compiled systems

| Step | Work | Verified by |
|---|---|---|
| 2.1 | Core seam 6.1 (columnar storage), behind the symbol. Add the "all columnar" test mode. | full core suite in both modes; same-machine bench compare shows no regression; `pnpm bench:check` type metrics |
| 2.2 | Core seams 6.2 and 6.3 (query views, tick, journal commit/rollback). | core tests that write through views and compare with cell writes, including rollback |
| 2.3 | Compiler analysis: find systems, resolve callbacks, classify eligibility, produce the report (7.6). | fixture tests: one fixture per subset rule, each with the expected diagnostic text |
| 2.4 | C emission for the subset (7.2, 7.3), kernel table and ABI (7.4). | golden-file tests of generated C; compiled with warnings as errors |
| 2.5 | Bundle transform (7.5) and layout registration prelude. | bundle tests: kernels off reproduces the original behaviour exactly |
| 2.6 | Oracle tooling (section 8): headless snapshot stream, comparator, `ritmo-native check`. | the stress fixture and top-down match; the fuzz test runs 10k cases per CI run |
| 2.7 | Mark the top-down movement and collision systems `requireCompiled`; add a native benchmark: stress fixture at 1k, 5k, 10k entities, interpreted vs compiled, plus the same game in Node with JIT. | numbers recorded in `packages/native/bench/results.md`; compiled per-frame time at 5k must be at or below Node with JIT on the same machine, otherwise investigate before closing the phase |
| 2.8 | Docs: subset table, report format, how to make a system compile, ARCHITECTURE.md "Native seams". Changeset (minor). | review |

Gate: compiled kernels pass the oracle on all fixtures and the fuzz suite,
and the benchmark target in 2.7 holds.

### Phase 3: mobile

| Step | Work | Verified by |
|---|---|---|
| 3.1 | Android: generate a Gradle project using SDL3's Android template (SDLActivity), the NDK CMake build of the runtime, assets in the APK. Touch arrives through `PointerTarget` (`pointerType: "touch"`). | CI builds a debug APK; an emulator job boots it, runs headless mode via an intent extra, and checks the snapshot stream |
| 3.2 | iOS: generate an Xcode project with SDL3 and the runtime as a static library, assets in the bundle. | CI builds for the simulator and runs the headless test with `xcrun simctl` |
| 3.3 | Lifecycle: pause on background, resume, safe-area insets in `host.gfx`, orientation from the config. | tests with simulated lifecycle events in the host |
| 3.4 | Port the top-down HUD to touch controls through the existing `Touch` module where its host is structural; if `Touch` needs DOM-only types, report and propose the smallest contract change instead of duplicating it. | emulator and simulator runs |
| 3.5 | Docs and changeset. | review |

Gate: the top-down example runs on the Android emulator and iOS simulator
and matches the oracle.

## 11. Done when

- `pnpm run check`, `pnpm pack:check`, `pnpm bench:check` are green, and the
  same-machine bench compare against `main` shows no regression over 20%.
- CI builds and runs the native top-down example on Linux, macOS, Windows,
  Android emulator and iOS simulator, each matching the Node oracle.
- The oracle, stress fixture and fuzz suite pass with kernels on.
- Compiled per-frame time at 5k entities is at or below Node with JIT on the
  same machine (step 2.7), and the numbers are committed.
- A new game can follow `packages/native/README.md` from install to a
  running desktop binary without reading source code.
- Changesets and MIGRATION.md entries exist for every published change.
- This file is deleted in the last PR, as with previous plans.

## 12. Open decisions with defaults

Proceed with the default and note it in the PR. Stop and ask only where the
default proves impossible.

| Decision | Default |
|---|---|
| Interpreter if QuickJS-ng cannot run the bundle unmodified | fix core only if the cause is non-standard code; otherwise stop and report |
| Desktop C toolchain for users | system compiler plus CMake; bundling Zig as a zero-setup compiler is a follow-up |
| Input modules living in `@typeonce/ritmo-browser` | reuse them through their structural hosts; propose moving them to a platform-neutral package as a separate change after Phase 1 |
| Renderer beyond `SDL_Renderer` (shaders, batching, GPU) | out of scope; `rn_gfx` is the seam where `SDL_GPU` goes later |
| Kernels for gated systems, commands, events | out of scope for the first cut; record demand in the compile report |
| Hot math helpers (`Collide2`, `SpatialGrid`, `FlowField`) as native functions | out of scope; Phase 2 numbers decide whether it is next |

## 13. Not in this plan

- Console platform layers (NDA, private repositories).
- Audio, gamepads, networking, save files beyond what SDL3 gives with no
  extra API (add later behind host contracts, per `PLATFORM.md`).
- Ahead-of-time compilation of the whole game (Static Hermes or similar).
  Revisit only if Phase 2 shows interpreted systems dominate frame time.
- Publishing prebuilt binaries per platform; Phase 1 builds from source.

## 14. Quick reference

- System execution and transactions: `packages/core/src/Runtime.ts`,
  `runSystem` (about line 1806).
- Component storage and change marks: `packages/core/src/internal/world.ts`
  (`EntityRecord`, `MARK_STRIDE`, `setComponentValue`).
- Cells: `packages/core/src/internal/cells.ts` (`ComponentReadCell`,
  `ComponentWriteCell`).
- Loop: `packages/core/src/FixedLoop.ts`; browser counterpart
  `packages/browser/src/BrowserTickSource.ts` is the model for
  `NativeTickSource`.
- Structural input hosts: `KeyboardHost` in
  `packages/browser/src/Keyboard.ts`, `PointerTarget` and `BlurHost` in
  `packages/browser/src/Pointer.ts`.
- Adapter model: `packages/pixi/src/PixiNodeRegistry.ts`.
- Reference game: `examples/top-down` (`simulation.ts`, `test/`, `render/`).
- Benchmarks: `scripts/bench.ts`, `packages/*/bench/`.
