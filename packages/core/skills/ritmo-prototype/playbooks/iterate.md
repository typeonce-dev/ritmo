# Iterate on a prototype

**Goal:** each round changes what the last verdict asked for and puts it in front of the human.

**Principles:** the toy before the game; one change per round; the human judges the fun.

1. Read the log in `PROTOTYPE.md` first: the last verdict decides this round. On **kill**, stop and ask what to try instead. On **pivot**, rewrite the card's question with the user before changing code. When the card's **Stop when** is reached, or the same card has pivoted three times, ask the human whether to kill it and start a fresh prototype instead of another round.
2. Change as little as could answer the verdict, one thing per round: a tuned number when a number can answer it, code when it cannot, a new system last. Give the round two variants in `tuning.ts`, named by how they differ (`early-lock`, `late-lock`) and far enough apart to feel in one play: double or halve a number, never nudge it by a few percent.
3. Add a goal only once the human says the toy is fun, unless the card's question is about the goal, and grow it out of the verb (dash through gaps, not a timer bolted on). After that, develop the verb you have through new situations (new spaces, enemies, combinations) before adding verbs: the same 30 seconds, never twice in the same context.
4. Before the human judges feel, the input acts on the frame it arrives, and the feedback (flash, shake, particles, sound) is in render code, never the simulation. Render-only state follows the `ritmo` skill's `playbooks/ui-and-render.md`. Hit-stop pauses play, so it is a rule: a tuned number in the simulation.
5. When the prototype grows, strip it: take out what does not feed the loop. If it still plays, leave it out.
6. A bug the human reports is fixed this round; when reading the code does not explain it, reproduce it as `SKILL.md`'s check says.

**Check:** the check in `SKILL.md`, the log has this round, and the reply follows `SKILL.md`.
