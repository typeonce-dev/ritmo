# Graduate a prototype

**Goal:** the prototype becomes the game: the same simulation under every check of the `ritmo` skill.

**Principles:** prove it headless; make the next mistake fail loudly; extend what exists before adding.

1. Pin the behaviour first. Each readout that showed the mechanic becomes a test that scripts the same input and asserts what it printed (`runtime.inspect`). A test runs `Fuzz.run` over the invariants. Each replay the fuzzer saved becomes a regression test (the `@typeonce/ritmo-devtools` README, "Fuzzing").
2. Finish the setup: step 3 of `node_modules/@typeonce/ritmo/SETUP.md` (`oxlint`, `ritmo-devtools lint`, one check script). Fix what it reports as each message says.
3. The chosen variant becomes the game's values, and each tuned number gets a unit and range in its descriptor's `meta` (the `ritmo` skill's `playbooks/content.md`). Remove the other variants, or keep the switch as a development-only key.
4. Restructure with the `ritmo` skill's `playbooks/refactor.md`: a file per system, closed sets, a home for every value, import rules. Delete host code written only to look at the toy.
5. Move what is worth keeping from the card (the fantasy, the loop) into the game's own design notes, then delete `PROTOTYPE.md`. From here the `ritmo` skill applies, checks included.

**Check:** the game's check passes, and the tests from step 1 pass unchanged after step 4.
