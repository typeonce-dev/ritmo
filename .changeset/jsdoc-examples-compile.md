---
"@typeonce/ritmo": patch
"@typeonce/ritmo-browser": patch
"@typeonce/ritmo-devtools": patch
"@typeonce/ritmo-math": patch
"@typeonce/ritmo-netcode": patch
"@typeonce/ritmo-pixi": patch
"@typeonce/ritmo-render": patch
---

**Every JSDoc `@example` now compiles against the current API.** Examples are type-checked in CI as a game would import them, so they no longer cite exports that do not exist or call them with the wrong arguments. What changed in meaning:

- `Game.Runtime.make(...)` with a constructed resource (a `Clock.resource`, a `Descriptor.ConstructedResource`) returns a `Result` that may fail: the examples check `ok` instead of reading `.value`.
- A captured input resource is typed from its source: `Descriptor.TransientResource<InputCapture.SnapshotOf<typeof KeyboardInput>>()`, not `Keyboard.Snapshot<...>`.
- `Netcode.seats(...)` returns a `Result`: check it instead of `.value!`.
- `Lint.Target<typeof Game.schema, typeof Root>` takes the schema root second.
- `NodeRegistry.make` infers the node type from `attach`'s parameter, with no explicit generic.
