# Graduate a prototype

**Goal:** the prototype becomes the game: the same simulation under every check of the `ritmo` skill.

**Principles:** prove it headless; make the next mistake fail loudly; each piece of state has an owner and a lifetime.

1. Give saved state its schemas: each component and resource the world keeps is constructed from the game's one schema library (the `ritmo` skill's `playbooks/state-and-upgrades.md`), so the world can be saved and replayed.
2. Pin the behaviour. A headless test per rule the human kept scripts the input and asserts what a player sees. Write the invariants the mechanic must never break, and a test that runs `Fuzz.run` over them (the `@typeonce/ritmo-devtools` README, "Fuzzing"); a game on one keyboard merges it as one `Controls` device so `Actions.random` fuzzes it. Each replay kept from a reported bug becomes a regression test.
3. Finish the setup: step 3 of `node_modules/@typeonce/ritmo/SETUP.md` (install and configure `oxlint`, `ritmo-devtools lint`, one check script). Fix what it reports as each message says.
4. The chosen variant becomes the game's values, and each tuned number gets a unit and range in its descriptor's `meta` (the `ritmo` skill's `playbooks/content.md`). Remove the other variants, or keep the switch as a development-only key.
5. Restructure with the `ritmo` skill's `playbooks/refactor.md`: a file per system, closed sets, a home for every value, import rules. Delete host code written only to look at the toy.
6. Move what is worth keeping from the card (the fantasy, the loop) into the game's own design notes, then delete `PROTOTYPE.md`. From here the `ritmo` skill applies, checks included.

**Check:** the game's check passes, and the tests from step 2 pass unchanged after step 5.
