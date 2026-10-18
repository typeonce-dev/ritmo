# Platform Packages

`ritmo` core stays platform-agnostic and renderer-agnostic.

Extra packages are allowed when they stay platform-specific and encapsulate a stable integration boundary that user code would otherwise have to rewrite in every project. These packages must be composable lego blocks: they own lifecycle and plumbing, while callers keep control over schema, resources, services, schedules, and game semantics.

## The plugin rule

A plugin is a function `(Game, options) => System | Schedule`. It takes the game's bound `Game` and typed options (descriptors, services, conditions) and returns ordinary systems or schedules that the game places in its own schedules. `RenderSync.system(Game, ...)` and `InputCapture.system(Game, ...)` are the pattern. There is no plugin object, registry, or composition step: descriptors a plugin needs are declared by the game (or exported as a `Schema.fragment(...)` the game lists in `Schema.bind(...)`), and the returned systems carry their requirements like any other, so `runtime.tick(...)` checks them.

## Good Packages

### `@typeonce/ritmo-browser`

Own browser-specific infrastructure:

- browser tick sources for the core `FixedLoop` (`BrowserTickSource.make(window)`) and the browser host clock
- mount lifecycle and teardown helpers
- viewport and frame-time capture
- browser input source helpers that produce caller-defined snapshots

This package must not own gameplay resources or feature flow.

### `@typeonce/ritmo-render`

Own renderer-agnostic render infrastructure:

- entity-keyed render node registry lifecycle (create once, attach, detach, destroy, teardown), with attach and detach supplied by the caller
- the generic render sync systems: create, re-apply, and destroy nodes in step with the world, and interpolate fixed-step movement between steps

This package imports no renderer. It must not own what a node looks like, HUD semantics, or camera policy.

### `@typeonce/ritmo-pixi`

Own Pixi-specific infrastructure implementing the contracts in `@typeonce/ritmo-render`:

- registries whose nodes are children of a Pixi container and are destroyed with their children (`PixiNodeRegistry.make`)
- the Pixi-shaped surfaces those need (`ContainerLike`, `Destroyable`), without importing `pixi.js`

This package must not own sprite conventions, HUD semantics, actor kinds, or camera policy.

### Adapter names and service provision

Generic contracts have generic names, such as `NodeRegistry`. Adapter modules
include their implementation in the name, such as `PixiNodeRegistry`, so both
can be imported together without aliases. Adapter packages export their own
implementations; generic APIs are imported from the package that owns them.

This follows Effect's separation of `FileSystem` from `NodeFileSystem`, and
`KeyValueStore` from `BrowserKeyValueStore`. The host constructs an adapter and
provides it through `Game.Runtime.service`; systems declare the generic service
descriptor. Ritmo's synchronous services use that existing provision API.

```ts
import { NodeRegistry, RenderSync } from "@typeonce/ritmo-render"
import { PixiNodeRegistry } from "@typeonce/ritmo-pixi"

const Sprites = Descriptor.Service<NodeRegistry.NodeRegistry<Sprite>>()("Game/Sprites")
const services = Game.Runtime.services(
  Game.Runtime.service(Sprites, PixiNodeRegistry.make(actorLayer))
)
// RenderSync.system(Game, { ..., registry: Sprites }) uses the generic contract.
```

### `@typeonce/ritmo-devtools`

Own debugging infrastructure over the core `Debug` handle:

- headless debug sessions that drive named schedules
- bounded trace history and text rendering for terminals and agents
- invariants checked between frames

This package reads the world; it must not mutate it or require games to change their runtime shape beyond `debug: { hostClock }`.

### `@typeonce/ritmo-native`

A native host injects clock, frames, structural input targets and a retained SDL3
scene into the game. `NativeHostClock`, `NativeTickSource` and `NativeNodeRegistry`
implement the existing core/render contracts. The build-time CLI bundles TypeScript
for QuickJS-ng, emits eligible numeric systems as C11, and reports every fallback.
Drawing and gameplay stay in games. See [setup and contracts](packages/native/README.md).

## Bad Packages

These do not belong as public platform packages:

- `@typeonce/ritmo-platformer-hud`
- `@typeonce/ritmo-browser-runtime`
- `@typeonce/ritmo-browser-rendered`
- `@typeonce/ritmo-pixi-top-down-player`
- any package that bundles input, rendering, state, and gameplay into one opinionated runtime

Those abstractions are feature-specific, not platform-specific. They stop being composable as soon as a game has slightly different behavior.

## Inclusion Rule

A package is a good fit only if:

1. The owned responsibility is defined by the host platform or integration boundary.
2. The repeated logic is infrastructure, not gameplay.
3. Variation can be expressed through strict typed inputs, descriptors, and callbacks.
4. Users can compose the package without casts, broad overloads, or explicit generic arguments for normal usage.

If an abstraction mainly exists to hide game-specific decisions, it should stay in app code or examples, not in a public package.
