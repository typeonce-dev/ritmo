# @typeonce/ritmo-native

Run a TypeScript Ritmo simulation in a native C11 application, with QuickJS-ng
and SDL3, without a webview. The native host provides drawing, input and timing;
the game's schema, systems and schedules remain TypeScript.

## Desktop quick start

Install Node 22.18+, pnpm, CMake 3.24+, and a C compiler (Xcode command-line
tools on macOS, Visual Studio C++ on Windows, GCC or Clang on Linux). Linux
window builds also need SDL's X11 or Wayland development dependencies.

```sh
pnpm add -D @typeonce/ritmo-native
```

Create `native.ts` exporting `NativeHost.main((host) => { ... })`. Construct the
simulation with `Keyboard.actions(host.keyboard, bindings)`, use
`NativeTickSource.make(host)` with `FixedLoop`, and draw with `host.gfx`.
Register `host.snapshots(() => runtime.snapshot())` to enable oracle checking.
For schemas without persistence validators, a debug runtime's `debug.dump()`
is an alternative world-state oracle; it includes transient resources and ticks.

Create `ritmo-native.config.ts`:

```ts
export default {
  entry: "./native.ts",
  app: { name: "My Game", id: "dev.example.game", version: "0.1.0" },
  window: { width: 1280, height: 720, resizable: true },
  assets: "./assets",
  targets: ["linux", "macos", "windows"],
  requireCompiled: []
}
```

```sh
pnpm exec ritmo-native doctor
pnpm exec ritmo-native build --target desktop
pnpm exec ritmo-native check --frames 600 --input timeline.json
pnpm exec ritmo-native dev --target desktop
```

`build` writes `.ritmo-native/<target>/game` (`game.exe` on Windows), a bundled
asset directory, generated C and the CMake build. Run from that directory or pass
`--assets /absolute/path/to/assets`. `dev` builds its shell on first use, then
rebundles source and restarts it on saves, with kernels disabled. Subsequent
source reloads do not invoke the C compiler.

The executable accepts `--headless --frames 600 --input timeline.json
--snapshots out.jsonl --screenshot out.bmp`. Headless mode uses SDL's software
renderer in a memory surface, so it needs no display. Input is plain JSON passed
to `host.input`; validate it with the game's existing scripted input module.

In this repository:

```sh
pnpm native check --config examples/top-down/ritmo-native.config.ts
node --import tsx scripts/native-inkline.ts ../inkline-town 600
```

The inkline-town adapter runs that checkout's real simulation with the current
workspace core. Its native view draws the town's tiles and allows road placement
by clicking. It is a 2D integration view; the game's Three.js renderer requires a
separate native rendering backend.

## Host surface

| Surface | Contract |
| --- | --- |
| `clock.now()` | Monotonic milliseconds, for host timing and tools |
| `frames.subscribe(callback)` | Frame delta milliseconds; subscription owns `stop()` |
| `keyboard`, `pointer`, `blur` | Structural hosts for the existing Keyboard and Pointer modules |
| `gfx.layer(name)` | Retained layers in creation order; attach detached nodes with `addChild` |
| `layer.rect`, `sprite`, `text` | Rectangles, PNG sprites, SDL debug text; drawing remains game code |
| Node properties | Position, dimensions, scale, rotation in radians, anchors, tint, alpha, visibility, sprite frame |
| `gfx.texture(path)` | PNG relative to the packaged assets directory; explicit destruction |
| `NativeNodeRegistry.make(layer)` | Attach once per entity, detach and destroy on removal |
| `snapshots(read)` | World's state after each frame for the exact oracle |
| `fail(message)` | Stop with a diagnostic and nonzero exit status |

Rotation and frame rectangles apply to sprites. Rectangles are axis-aligned;
debug text uses SDL's fixed-size font. Layers currently provide ordering,
translation and visibility. Scaling, anchors and opacity are node properties;
negative scale and sprite flipping are not implemented.

Static `new URL("./asset", import.meta.url).href` expressions are resolved by the
bundler, since QuickJS has no DOM URL global. Use `gfx.texture` with asset-relative
paths for packaged native assets. All runtime-facing types use ES2022 without
DOM or Node globals; CLI/compiler types are built separately.

The host supplies a data-only `structuredClone` adapter when the engine lacks
one. It covers plain objects, arrays, cycles, collections, dates, regular
expressions and numeric buffers/views. Transfer lists, host objects and full
Web API clone semantics are outside this adapter's scope.

## Mobile projects

Android and iOS project generation is available, with build and oracle launchers:

```sh
pnpm native build --config examples/top-down/ritmo-native.config.ts --target android --generate-only
pnpm native build --config examples/top-down/ritmo-native.config.ts --target ios --generate-only
```

Generated projects live in the game's `native/android` and `native/ios` folders.
Remove `--generate-only` to build with the platform toolchain; use `check` to
install and compare snapshots on an already running emulator or simulator.
Android requires Java, SDK 35, NDK 27.2.12479018 and CMake 3.31.6, with
`ANDROID_HOME` set. iOS requires Xcode on macOS. Add the target to the config's
`targets` before building. `doctor --target android` checks the Android tools.

These projects have been generated locally. APK builds, simulator builds and
device execution remain unverified; the CI jobs are provided for that validation.
macOS and Windows desktop execution also await their CI runs. Linux desktop is
the locally verified MVP.

## Compiled subset

Each build writes `.ritmo-native/report.json` with compiled system ids, layout
hashes, and the first blocking construct (file and line) for each interpreted
system. `requireCompiled` turns a fallback for a named system into a build error.
Generated C is deterministic, compiled with contraction disabled and without
fast-math. Numeric fields are doubles; `%` uses `fmod`; Math rounding/min/max/sign
preserve JavaScript's signed-zero and NaN behavior.

| Construct | Current lowering |
| --- | --- |
| Statically declared `Game.System(name, spec, blockCallback)` | Supported |
| Numeric component objects/scalars; read/write queries | Supported; numeric columns are registered through a private versioned symbol |
| Numeric `readResource` | Supported, flattened in declared order |
| `for (const m of queries.q.each())`, `{ data }` binding | Supported, up to two nested query loops |
| `get()`, `set(...)`, inline expression `update(...)` | Supported, object writes evaluate all fields before mutation |
| Numeric/boolean locals, object locals, destructuring | Supported; object locals are scalar-replaced |
| Arithmetic, comparisons, logical operators, ternary, if/else, while, continue/break, return | Supported |
| Math abs/min/max/sqrt/floor/ceil/round/trunc/sign | Supported |
| Gates, commands, services, events, machines, lookups, optional/lifecycle query slots | Interpreted |
| `singleOptional`, `setRaw`/`updateRaw` validation, helper function calls, numeric for-loops | Interpreted in the initial compiler |
| Strings, arrays, map, escaping closures, exceptions, async, random, transcendentals | Interpreted |

Constructed components may use typed `set`/`update`; raw validation callbacks stay
interpreted. Kernels also fall back during exit phases or debug tracing, keeping
core's rollback and complete journal behavior. Turning `RITMO_NATIVE_KERNELS=off`
keeps the original callback and uses the same bundle. Query buffers are checked
before entering C, and a stale layout hash refuses execution.

The top-down movement system currently remains interpreted: its wall `.map`
and raw-vector validation are outside this initial subset. The numeric stress
fixture requires a compiled kernel and is checked against Node.

## Verification and dependencies

`pnpm check` covers adapters, compiler and core behavior. `pnpm test:native-columns`
runs the entire core suite with numeric column storage. Native builds additionally
exercise the generated C against the Node oracle, comparing every frame with
IEEE-754 number encodings that retain signed zero, infinities and subnormals.
NaNs are normalized to one canonical NaN: JavaScript engines may choose different
NaN sign/payload bits even for interpreted code. Every other bit compares exactly.
Dependencies, exact versions and licenses are in [vendor/README.md](vendor/README.md).

Set `CMAKE` to a CMake executable when it is not on PATH. For a display-free Linux
build without desktop development libraries, set `RITMO_NATIVE_HEADLESS=1`.
`FETCHCONTENT_SOURCE_DIR_SDL3` points to an already extracted SDL3 3.2.28 tree for
offline builds. SDL is fetched from a pinned archive otherwise.

Set `RITMO_NATIVE_SANITIZE=1` for an AddressSanitizer/UBSan build. A subsequent
build without it turns sanitizers off. When switching from a headless-only SDL
build to a desktop SDL build, remove `.ritmo-native/<target>/build` first to
clear SDL's cached video-driver options.
