# Graduate a prototype

The human keeps the prototype: it becomes the game, the same simulation under every check of the `ritmo` skill.

1. **Schemas and state:** pick the simulation's one entry module, which the tests will import. Each component and resource the world keeps is constructed from the game's one schema library (the `ritmo` skill's `playbooks/state-and-upgrades.md`), so the world can be saved and replayed. Here float timers become `Clock` deadlines, and mode flags become an `EntityState` or a state machine: most of the rewrite is this step.
2. **Tests:** a headless test per rule the human kept, invariants the mechanic must never break, and a test that runs `Fuzz.run` over them (the `@typeonce/ritmo-devtools` README, "Fuzzing"). A replay kept from a reported bug becomes a regression test. To start a test from a given situation, edit a `runtime.snapshot()` and `runtime.restore` it.
3. **Setup:** step 3 of `node_modules/@typeonce/ritmo/SETUP.md` (the lint and one check script).
4. **Values:** the chosen variant becomes the game's values, each tuned number with a unit and range in its descriptor's `meta` (the `ritmo` skill's `playbooks/content.md`).
5. **Structure:** the `ritmo` skill's `playbooks/refactor.md`.
6. Keep what is worth keeping from `PROTOTYPE.md` in the game's design notes, then delete it. From here the `ritmo` skill applies.

The game's check passes, and the tests from step 2 pass unchanged after step 5.
