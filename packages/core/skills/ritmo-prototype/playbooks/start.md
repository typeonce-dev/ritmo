# Start a prototype

**Goal:** in one change, a toy the human can play, with two variants of the feel the card names.

**Principles:** no question, no prototype; the toy before the game; the simulation is the game.

1. Write `PROTOTYPE.md` from [`../references/card.md`](../references/card.md) with the user. The question is required: when there is none (the user already knows what to build), it is not a prototype, so follow the `ritmo` skill. Propose what the user did not say, marked as a proposal, and build only once the user confirms the card; step 2 can run meanwhile.
2. When the project has no Ritmo yet, follow steps 1 and 2 of `node_modules/@typeonce/ritmo/SETUP.md` (packages and skill links), and add `@typeonce/ritmo-browser`. Step 3 (the lint and check setup) waits for graduation.
3. Build the toy: the verb and the feedback that shows its effect, with no goal, score, menu, or content yet. A simulation module (data and systems), `tuning.ts` with two variants that differ in the feel the card names, and a page that runs it.
4. Draw with shapes; art waits until the toy is fun. Draw the feedback that makes cause and effect readable (a flash on a hit, a trail on a dash, the tiles an attack will hit) before anything decorative. The variant's name is on screen.

**Check:** the check in `SKILL.md`, and the reply follows it.
