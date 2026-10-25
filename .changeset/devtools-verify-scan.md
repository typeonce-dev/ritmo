---
"@typeonce/ritmo-devtools": minor
---

**Breaking: `Replay.verify` is removed.** `Verify.acrossEngines(make, file)` is the one replay check: with no engines it plays the replay twice in this process and against the recording, as `Replay.verify` did; with engines it also runs browsers. It is async and fails with `NotVerified` (each outcome names the engine, tick, and values) instead of returning `deterministic: false`.

```diff
- const same = Replay.verify(make, file)
- expect(same.ok && same.value.data.deterministic).toBe(true)
+ const same = await Verify.acrossEngines(make, file)
+ expect(same.ok).toBe(true) // same.error.text says where it differs
```

**`ritmo-devtools scan <entry>` lists the determinism risks in dependencies.** oxlint skips `node_modules`, so a library the simulation calls can still use `Math.sin`. The scan resolves every file the simulation entry imports, `node_modules` included (with rolldown, which Vite 8 already brings), and runs `ritmo/use-ops-for-math`, `ritmo/use-clock-for-time`, and `ritmo/use-random-for-randomness` over them with the game's own oxlint. It prints the findings per package with `file:line:column`, or JSON with `--json`, and always exits 0 when it ran: it is a hint. `oxlint` and `rolldown` are optional peer dependencies.

```sh
ritmo-devtools scan src/simulation/index.ts
# fake-physics (2 findings)
#   node_modules/fake-physics/index.js:4:17  ritmo/use-ops-for-math  Math.sin
```
