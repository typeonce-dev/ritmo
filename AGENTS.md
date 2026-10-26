## Vision
- Agent-first: coding agents write all code that uses Ritmo; a human directs the game and does not read the code.
- The library is the agent's guardrail, in three layers: a wrong call does not compile and the error names the fix; headless devtools sessions expose lints, invariants, and why a value changed; every found bug becomes a test.
- One way to do each thing. Two APIs for one job is a safety bug: an agent will use both.
- Names and JSDoc are API: each export says what it is for, when to use it, and which neighbouring API to use instead.
- Early library: break, remove, and rename freely. No deprecated aliases or re-exports.

## Repo
- `packages/*`: the published packages (see each `package.json` description). Each has `src`, `test`, `dtslint`, and core, math, and render have `bench`.
- `integration/*`: headless game simulations with tests, using the packages by name.
- `bench/compare`: Ritmo against bitECS, Koota, and Miniplex on the community ECS benchmark cases (`pnpm bench:compare`). Internal, not a gate; run it before and after a storage or hot-path change. `test/` checks every claim the website's comparison page makes about the other libraries.
- `website/`: the guide for humans (Astro), built from the workspace packages and deployed after each release.
- `.changeset/README.md`: releases and adding a package.

## Verify
- Every change: `pnpm run check`.
- Changes to public APIs, or to `website/`: `pnpm --dir website build` (Node 22.23.4 or newer).
- JSDoc `@example` blocks compile in `pnpm check` (`pnpm check-examples`): modules are in scope by name, the game from `scripts/examples/prelude.ts`, anything else above a `// ---cut---` line. The header of `scripts/check-examples.ts` is the convention.
- Changes to what a package publishes (exports, `package.json`, build config): `pnpm pack:check`.
- Every change to a published package: a changeset (`pnpm changeset`). A breaking entry carries its fix.
- Changes to runtime internals or public types: `pnpm bench:check`; record an intended shift with `pnpm bench:update`. For runtime work, compare with your own machine: `pnpm bench --json .bench/before.json`, then `pnpm bench --compare .bench/before.json` (`--filter <text>` for one case). Under about 20% is noise; do not report it. Add a bench case for a new per-frame hot path.

## API rules
- Type safety comes first. If a runtime failure can be made impossible by types, it must be; when a guarantee depends on runtime state, the type says it can fail.
- No user-facing casts, no explicit generic arguments for normal use, no splitting schedules or features only to satisfy the compiler.
- Expected failure is a typed `Result`, not an exception. No broad overloads or ambiguous semantics.
- Small composable pieces, each type-safe on its own.
- Validate exact structure at the constructor boundary, derive a normalized carried type once, and reuse it. Optimize internal types only when the public API and its guarantees stay the same.
- Ritmo exports no codec builders. Values are Standard Schemas the game brings. A Ritmo-owned type comes with its guard (`Random.is`, `Clock.isDeadline`), and `Random` also with one codec constant for itself. `packages/core/dtslint/NoCodecBuilders.tst.ts` fails on an export that returns a schema.
- ritmo-math holds the 2D helpers most games would otherwise rewrite, plain data in and out, built on `Ops`; it never ports a third-party algorithm, and determinism alone is never a reason to add one.
- A new system access category gets a runtime provision only if the runtime must validate it (one nominal requirement token); otherwise it stays local to the system spec.
- Runtime semantics stay explicit: handles are storage-safe, not proof of liveness; lookups that depend on runtime state are fallible; commands and state transitions apply only at `applyDeferred()` / `applyStateTransitions(...)`; reads (changes, events, transitions, relation failures) are per-reader streams that show each system what was published since its own previous run, once.

## Type tests
- TSTyche in `packages/*/dtslint/*.tst.ts`. Every public API gets an inferred-type test (`expect(...).type.toBe<...>()`) and a failing test per constraint.
- A failing test names its error: `// @ts-expect-error <fragment>` or `expect(fn).type.not.toBeCallableWith(...)` next to a passing call. Pick fragments that name the cause, not printed unions.

## Package scope
- Packages never draw. They hand games the data to draw (like `Touch`'s `view()`) and own glue every game would repeat: bridges to renderers and platforms (nodes, positions, input, timing).
- A package owns an integration boundary, holds infrastructure (not gameplay), and is varied through typed inputs and callbacks. Feature bundles stay in games.
- A plugin is `(Game, options) => System | Schedule`: no plugin objects, registries, or composition steps.
- Generic contracts have generic names (`NodeRegistry`); adapters name their implementation (`PixiNodeRegistry`) and export only it. The host provides the adapter as a service.
- Core and generic modules call no platform API (`performance`, `window`, timers, file system, network): a platform detail is a contract with injected implementations (`HostClock` / `BrowserHostClock`). Package configs get only the ES2022 lib; a host package that needs DOM types lists `"DOM"` itself.
- Package and simulation code read time from `Clock`, randomness from `Random`, and transcendental math from `Ops`; `pnpm lint` enforces this with the repo's own plugin. Disable a rule only with `// oxlint-disable-next-line ritmo/<rule> -- <reason>`.
- A pattern games must follow that types and devtools cannot catch becomes a rule in `packages/oxlint-plugin`, tested with real code, whose message says what goes wrong and the API to use instead.

## Docs
- A game's agent sees only what npm ships: `src` JSDoc, each `README.md` and `CHANGELOG.md`, `packages/core/SETUP.md` (one-time setup), and the skills in `packages/core/skills`: `ritmo` (every change, with playbooks) and `ritmo-prototype` (while a game is a prototype). Guidance a game needs goes there, never in a repo-only file, and says nothing a JSDoc, README, or lint message already says. `packages/core/PROTOTYPE.md` (repo-only) quotes the source behind each `ritmo-prototype` rule; a change to that skill updates it, and a rule with no source does not go in.
- Humans read the root `README.md` and the website (`website/`, see its README): a guide with running demos and snippets compiled by Twoslash, never an API reference. A change that breaks a website snippet or demo fixes it in the same change; the website build in CI fails until it does.
- Package READMEs link other packages' docs by GitHub URL (`https://github.com/typeonce-dev/ritmo/blob/main/packages/<name>/README.md`), never by relative path or into `integration/`.

## Debugging
- Reproduce headless first, as the skill's `playbooks/bug-fix.md` describes; `integration/top-down/debug.ts` is a script to copy (`node --import tsx <script>`).

## Design reference: Effect
Follow [Effect](https://github.com/Effect-TS/effect) for how APIs are shaped, keeping Ritmo's stricter rule (user-facing safety and explicitness first):
- **Dependencies are in the type.** What a system needs (services, resources, machines) is declared and carried as a requirement; the runtime provides it, and a missing provision does not compile. No globals, singletons, or ambient context.
- **Failures are in the type.** Expected errors are typed values in the return type (`Result`), named and narrowable; exceptions are only for defects.
- **Contracts and implementations are separate.** A generic service (`NodeRegistry`, `HostClock`) is implemented per platform (`PixiNodeRegistry`, `BrowserHostClock`) and provided by the host, like Effect's `FileSystem` / `NodeFileSystem`.
- **Validate at the boundary, then trust the type.** Constructors decode untrusted input once; the carried type is derived once and reused.
- **Modules are namespaces of small composable functions** (`Clock.hz`, `Random.draw`), each independently type-safe, with inference doing the work and no explicit generics in normal use.
