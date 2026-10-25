---
"@typeonce/ritmo-netcode": minor
---

**`Netcode.syncTest` proves a rollback game rewinds exactly, on one peer with no network.** Each `advance(local)` runs the next tick with seat 0's input (every other seat gets `predict` of its previous one), then forces a rollback of `rewind` ticks and runs them again, comparing the world's checksum at the start of every tick with the first run's. State a rewind cannot put back (a module variable, a service with its own memory) fails with the new `RewindDiffers` error at the first tick whose world differs, carrying both checksums and, with `keepSnapshots: true`, both saves for `Desync.compare` (`@typeonce/ritmo-devtools`). It takes `rollback`'s types, so a schedule that cannot be rewound or a runtime that cannot save does not compile, and a `rewind` deeper than the runtime's checkpoints fails at construction. `status()` counts the forced rollbacks. Run it in the game's tests before shipping:

```ts
const test = Netcode.syncTest(runtime, { simulate, seats, rewind: 8 })
if (test.ok) for (const local of script) expect(test.value.advance(local).ok).toBe(true)
```
