# Iterate on a prototype

**Goal:** each round changes what the last verdict asked for, shows it, and records the next verdict.

**Principles:** the toy before the game; one change per round; the human judges the fun.

1. Read the log in `PROTOTYPE.md` first: the last verdict decides this round. On **kill**, stop and ask what to try instead. On **pivot**, rewrite the card's question with the user before changing code.
2. Change the cheapest thing that could answer the verdict: a number before code, code before a new system. When the human finds something off, offer two or three variants in `tuning.ts`, named by how they differ (`short-dash`, `long-dash`), and compare them with the switch.
3. Add a goal only once the human says the toy is fun, and grow it out of the verb (dash through gaps, not a timer bolted on). After that, vary the loop (new spaces, enemies, combinations) before adding verbs: the same 30 seconds in changing situations.
4. Before the human judges feel, the input acts on the frame it arrives, and the feedback (flash, shake, hit-stop, particles, sound) is in render code, never the simulation. Render-only state follows the `ritmo` skill's `playbooks/ui-and-render.md`.
5. When the prototype grows, strip it: take out what does not feed the loop. If it still plays, leave it out.
6. Update the play script's timeline and readout to show this round's change. Add an invariant when the round adds a rule that can break (a count, a state the player must leave).

**Check:** tiers 0 and 1 pass, the log has this round, and the reply follows `SKILL.md`.
