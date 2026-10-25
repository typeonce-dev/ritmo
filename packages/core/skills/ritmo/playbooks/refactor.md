# Refactor

**Goal:** the structure changes and the behaviour does not.

**Principles:** each piece of state has an owner and a lifetime; the simulation is the game; make the next mistake fail loudly.

1. Pin the behaviour before moving code: the headless tests pass, and a `Determinism.check` or a recorded scripted run gives a baseline to compare against.
2. Move along what changes together: one closed set per module, a file per system once systems grow, a module per screen. Keep the simulation in its one folder (`ritmo-devtools lint` reports a module it loads from outside), each shared cache, pool, or registry single with one owner, and state from module variables moved to its home ([`state-and-upgrades.md`](state-and-upgrades.md)).
3. Encode the new boundaries: a `no-restricted-imports` rule per folder whose message names where the code belongs.

**Check:** the tests pass unchanged, the scripted run matches the baseline, and the game's check passes.
