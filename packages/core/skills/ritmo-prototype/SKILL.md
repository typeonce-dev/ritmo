---
name: ritmo-prototype
description: "Apply in place of the ritmo skill's checks while a game built on @typeonce/ritmo has a PROTOTYPE.md at its root, and to start one when the user asks to prototype, sketch, or try out a mechanic, or to find the fun. Gets a playable toy in front of the human fast: keeps Ritmo's shape, checks only that the build compiles and loads, and leaves whether it is fun to the human, who plays every round."
---

# Ritmo prototypes

A prototype finds the fun, fast; the question and the path to it can change at any time. The human plays every round and judges the fun; your job is a build worth playing, quickly.

## The mode

A `PROTOTYPE.md` at the game root puts the game in prototype mode: write it with the user when they ask for one, never to skip checks. It holds the question tested now, as what the player will do (a change of course rewrites it), and a line per round with the human's verdict in their words. When there is no question (the user knows what to build), follow the `ritmo` skill instead. Deleting the file is graduation: [`playbooks/graduate.md`](playbooks/graduate.md).

## Keep, and leave for graduation

- **The simulation is the game:** rules are systems that read player intents, drawing reads plain data, and the simulation imports no page code. This keeps graduation a refactor, not a rewrite.
- **Variants live in one `tuning.ts`:** named settings (numbers or rules), switched with a key, compared in one play; one can switch off what the question is about.
- **Everything else waits:** tests, play scripts, invariants, fuzzing, schemas for saved state, lint gates, a file per system. For a new project, follow steps 1 and 2 of `node_modules/@typeonce/ritmo/SETUP.md` and add `@typeonce/ritmo-browser`.

## The check

The type check passes and the page loads with no console errors. Nothing more: the human is about to play it, so do not drive the page or take screenshots. When the human reports a bug that reading the code does not explain, reproduce it headless with an invariant and `Fuzz.run` (the `@typeonce/ritmo-devtools` README).

To build, start from the whole game in the `BrowserTickSource` module header (`node_modules/@typeonce/ritmo-browser/src`); read other docs only when a compiler error points there.

## Finding the fun

- Start from the feeling the user wants and the smallest thing that can be fun: the verb and the feedback that shows its effect, or the smallest goal when the game is about goals. Draw shapes; art waits.
- Explore broadly. Read all the verdicts together, not only the last: when they keep pointing the same way, propose a change of course (the shape, the verb, the genre) and let the human pick. Tune numbers (double or halve, not 5%) only in a direction the human likes.
- Some fun lives in content (story, characters, a mystery): test it with a small hand-written slice, not more mechanics.
- What the human reports is a symptom: find the cause and fix that, building any fix they propose too.

## Each round

Reply briefly: the link, the direction being tried, and any open question; the keys and the variant's name are on screen in the game. The human gives the verdict in their own words. Ask only when one answer would decide the next change: about one moment of play, answered by what the player did. Never say it is fun: you have not played it. Log the round; a round the human did not play has no verdict.
