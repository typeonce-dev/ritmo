# Native MVP checkpoint

The stable checkpoint is published in
[draft PR #48](https://github.com/typeonce-dev/ritmo/pull/48).
Everything remains on `codex/native-runtime`, based on PR #47's head
`05f177d07959c9cf1a72ce73d27196e98cdd3f02`. The implementation commit is
`ea7d0be`; subsequent checkpoint commits contain only stabilization and handoff
updates. The branch is pushed to `origin/codex/native-runtime`. Nothing has been
merged into `main`, and auto-merge is disabled.

GitHub initially rejected writes with `403: Resource not accessible by integration`.
The user installed the connection for the `typeonce-dev` organization, restoring
write access. All implementation work stays in #48. Do not merge #47 or #48.
Keep `PLAN.md` until its remaining gates are met.

## Working scope

- Linux C11 executable embedding pinned QuickJS-ng and SDL3, with keyboard,
  pointer/touch adapters, retained 2D graphics, lifecycle handling and a native
  top-down entry. The existing TypeScript simulation remains unchanged.
- Numeric component columns, private query/transaction seams, a conservative
  TypeScript-to-C system compiler, deterministic reports and explicit
  `requireCompiled` enforcement. Unsupported callbacks run in QuickJS.
- `doctor`, `build`, `dev`, and streaming per-frame Node oracle checks, including
  runs with kernels on and off. Only NaNs are normalized, as approved by the
  user; every other IEEE-754 bit, including signed zero, compares exactly.
- An external inkline-town adapter that builds its real simulation against the
  current workspace core and supplies a native 2D town view with road placement.
  Its existing Three.js renderer is not ported.
- Android/iOS project generators, build/oracle launchers, and platform CI jobs.
  Generation was checked locally; mobile builds and execution remain unverified.

## Verification at this checkpoint

The Linux environment uses Node 24.19.0, pnpm 10.17.1, GCC, pinned SDL 3.2.28 and
vendored QuickJS-ng 0.12.0. Successful checks include:

- `pnpm run check`: typecheck, type tests, 74 runtime test files / 446 tests.
- `pnpm pack:check`: all seven packages, downstream type/runtime checks, and the
  published native and devtools CLIs.
- `pnpm test:native-columns`: all 44 core test files / 272 tests.
- CTest: help, numeric/journal semantics, and retained-graphics screenshot.
- Top-down: 600-frame Node/native oracles with kernels on and off; frame-300
  screenshot golden; an SDL offscreen-window smoke run.
- Inkline-town: 600-frame Node/native oracle.
- Numeric fuzz: 100 generated programs over 100 inputs (10,000 cases), including
  non-finite numbers, signed zero and subnormals, with ASan/UBSan enabled and
  kernels both on and off. The compiled run executed 100 C kernels.
- The 5,000-entity, 60-frame stress oracle with ASan leak detection and UBSan,
  with kernels on and off.
- `pnpm bench:check --compare .bench/before.json` passed: browser-path runtime
  differences stayed within the 20% noise band; type metrics were +3.4% / +2.0%,
  within the committed 5% tolerance. The raw command without `--compare` flagged
  six runtime cases against the Apple M1 baseline on this AMD Linux host;
  several already exceeded that baseline before the implementation. Both outputs
  and the pre-change baseline are saved under `packages/native/bench/browser-*`.
  The committed shared baseline has not been rewritten.
- Native benchmark results in `packages/native/bench/results.md` meet the
  5,000-entity target (0.0817 ms/frame versus Node JIT 0.2712 ms/frame).

The configured GitHub Actions matrix started when #48 was opened. The results
above record local verification; check the PR for current CI results. A local
check is not evidence that the corresponding mobile or other desktop job passes.

## Reproduce locally

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm pack:check
pnpm test:native-columns
pnpm bench:check
# On this same AMD Linux host, compare with the saved pre-change measurement:
pnpm bench:check --compare packages/native/bench/browser-before.json
pnpm native check --config examples/top-down/ritmo-native.config.ts --frames 600
pnpm native check --config examples/top-down/ritmo-native.config.ts --frames 600 --input examples/top-down/test/native/pickup.json
pnpm native check --config packages/native/test/fixtures/ritmo-native.config.ts --frames 60
node --import tsx scripts/native-fuzz.ts
node --import tsx scripts/native-screenshot.ts examples/top-down/.ritmo-native/linux/game
node --import tsx scripts/native-inkline.ts ../inkline-town 600
```

In the current container, add these environment settings to native commands:

```sh
export CMAKE=/tmp/ritmo-tools/cmake/data/bin/cmake
export RITMO_NATIVE_HEADLESS=1
export FETCHCONTENT_SOURCE_DIR_SDL3=/tmp/ritmo-sdl
export PATH=/tmp/ritmo-pnpm-cli/node_modules/.bin:$PATH
```

For sanitizer checks, additionally set `RITMO_NATIVE_SANITIZE=1`,
`ASAN_OPTIONS=detect_leaks=1`, and `UBSAN_OPTIONS=halt_on_error=1`. Build and run C
tests with:

```sh
"$CMAKE" --build examples/top-down/.ritmo-native/linux/build --target rn_kernel_test rn_gfx_test
/tmp/ritmo-tools/cmake/data/bin/ctest --test-dir examples/top-down/.ritmo-native/linux/build --output-on-failure
```

Remove the build directory before switching from headless-only SDL to desktop
video drivers.
The `/tmp` tools and logs are session conveniences; source dependencies and pins
are recorded in the repository and package vendor documentation.

`scripts/native-inkline.ts` expects an installed checkout of
`SandroMaglione/inkline-town` beside this repository. It writes only ignored
`.ritmo-native/integration` files into that checkout.

## Remaining plan gates

1. Finish the compiler subset and its coverage. `singleOptional`, constructed
   component raw validation, helper calls and numeric for-loops currently stay
   interpreted. Top-down's movement also uses arrays/map, outside the initial
   subset; resolve this against the original plan without changing simulation
   behavior. Its movement/collision `requireCompiled` gate is not met.
2. Expand compiler fixtures and generated-C goldens to cover every planned
   supported and rejected construct. Finish the phase-0 QuickJS versus
   jitless/JIT runtime benchmark table.
3. Run and fix the desktop matrix on macOS and Windows, plus sanitizer/fuzz CI.
   Linux headless and offscreen checks do not replace those platform runs.
4. Build and run the Android emulator and iOS simulator jobs. Verify packaged
   assets, touch controls, lifecycle, safe areas and orientation on those hosts.
   Mobile project generation alone does not meet the phase-3 gate.
5. Address any failures, rerun the repository's required checks, and keep the
   one implementation PR open and unmerged for review.

See `packages/native/README.md` for the implemented public surface and compiler
subset, and `PLAN.md` for the complete original acceptance criteria.
