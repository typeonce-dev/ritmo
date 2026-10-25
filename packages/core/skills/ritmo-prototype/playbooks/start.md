# Start a prototype

**Goal:** in one change, a toy the human can play, a play script that shows its core verb, and invariants the fuzzer holds.

**Principles:** no question, no prototype; the toy before the game; the simulation is the game.

1. Write `PROTOTYPE.md` from [`../references/card.md`](../references/card.md) with the user. The question is required: when there is none (the user already knows what to build), it is not a prototype, so follow the `ritmo` skill. Propose what the user did not say, marked as a proposal.
2. When the project has no Ritmo yet, follow steps 1 and 2 of `node_modules/@typeonce/ritmo/SETUP.md` (packages and skill links), and add `@typeonce/ritmo-browser`. Step 3 (the lint and check setup) waits for graduation.
3. Build the toy: the verb and the feedback that shows its effect, with no goal, score, menu, or content yet. A schema module, a systems module, `tuning.ts` with two variants that differ in the feel the card names, and a simulation module that makes the runtime over scripted input (`makeSimulation`) and over a replay's input (`makeReplaySimulation`, for the fuzzer). The `@typeonce/ritmo-browser` README has the controls, the loop, and the fuzzable input.
4. Write the invariants and copy [`../references/play.ts`](../references/play.ts). Change its timeline to the actions of the card's loop, and its readout to what the card's "fun looks like" line names.
5. Host it in the browser with shapes, not art: draw the feedback that makes cause and effect readable (a flash on a hit, a trail on a dash) before anything decorative. A key cycles the variants and restarts the run, and the variant's name is on screen.

**Check:** tiers 0 and 1 pass, the page runs, and the reply follows `SKILL.md`.
