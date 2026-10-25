# Iterate on a prototype

**Goal:** each round changes what the last verdict asked for and puts it in front of the human.

**Principles:** the toy before the game; one change per round; the human judges the fun.

1. Read the log in `PROTOTYPE.md` first: the last verdict decides this round. On **kill**, stop and ask what to try instead. On **pivot**, rewrite the card's question with the user before changing code.
2. Change the cheapest thing that could answer the verdict: a number before code, code before a new system. Give the round two variants in `tuning.ts`, named by how they differ (`early-lock`, `late-lock`), so one play compares them.
3. Add a goal only once the human says the toy is fun, and grow it out of the verb (dash through gaps, not a timer bolted on). After that, vary the loop (new spaces, enemies, combinations) before adding verbs: the same 30 seconds in changing situations.
4. Before the human judges feel, the input acts on the frame it arrives, and the feedback (flash, shake, hit-stop, particles, sound) is in render code, never the simulation. Render-only state follows the `ritmo` skill's `playbooks/ui-and-render.md`.
5. When the prototype grows, strip it: take out what does not feed the loop. If it still plays, leave it out.
6. A bug the human reports is fixed this round; when reading the code does not explain it, reproduce it as `SKILL.md`'s check says.

**Check:** the check in `SKILL.md`, the log has this round, and the reply follows `SKILL.md`.
