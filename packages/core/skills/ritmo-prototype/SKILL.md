---
name: ritmo-prototype
description: "Apply in place of the ritmo skill's checks while a game built on @typeonce/ritmo has a PROTOTYPE.md at its root, and to start one when the user asks to prototype, sketch, or try out a mechanic, or to find the fun. Gets a playable toy in front of the human fast: keeps Ritmo's shape, checks only that the build compiles and loads, and leaves whether it is fun to the human, who plays every round."
---

# Ritmo prototypes

A prototype answers one question about a game by putting something playable in front of the human, fast. The human plays every round and judges the fun; your job is a build worth playing, quickly.

## The mode

A `PROTOTYPE.md` at the game root puts the game in prototype mode: write it with the user when they ask for a prototype, never to skip checks. It holds the question the prototype answers, in terms of what the player will do, and a line per round with the human's verdict in their words. When there is no question (the user knows what to build), follow the `ritmo` skill instead. Deleting the file is graduation: [`playbooks/graduate.md`](playbooks/graduate.md).

## Keep, and leave for graduation

- **The simulation is the game:** rules are systems that read player intents, drawing reads plain data, and the simulation imports no page code. This keeps graduation a refactor, not a rewrite.
- **Tuned numbers live in one `tuning.ts`, as named variants** the page switches with a key, the variant's name on screen, so the human compares feels in one play.
- **Everything else waits:** tests, play scripts, invariants, fuzzing, schemas for saved state, lint gates, a file per system. For a new project, follow steps 1 and 2 of `node_modules/@typeonce/ritmo/SETUP.md` and add `@typeonce/ritmo-browser`.

## The check

The type check passes and the page loads with no console errors. Nothing more: do not drive the page or take screenshots, the human is about to play it. When the human reports a bug that reading the code does not explain, reproduce it headless with an invariant and `Fuzz.run` (the `@typeonce/ritmo-devtools` README).

To build, read the `@typeonce/ritmo-browser` README and the module headers of `Schema`, `System`, `Schedule`, `FixedLoop`, and `Inspector` in `node_modules/@typeonce/ritmo/src`; other docs only when a compiler error points there.

## Finding the fun

- Build the toy first: the verb and the feedback that shows its effect, with no goal yet. Start from the feeling the user wants, and draw shapes; art waits.
- Change little per round, but far enough to feel: double or halve a number, not 5%.
- Grow the verb you have through new situations before adding verbs.
- What the human reports is a symptom. A case they name is often one instance of a broader problem, and a fix they propose points at what is wrong: find the cause and fix that, building their fix too.
- Cut early: a dead end is a result. Say when the rounds stop converging, and let the human decide.

## Each round

Reply with the link, the keys, the variants, and what changed in what the human will see. End with one question about one moment of play, whose answer is something the player did, not an opinion, and decides the next change. Never say it is fun: you have not played it. Log the round; a round the human did not play has no verdict.
