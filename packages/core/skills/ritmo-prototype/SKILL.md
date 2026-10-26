---
name: ritmo-prototype
description: "Apply in place of the ritmo skill's checks while a game built on @typeonce/ritmo has a PROTOTYPE.md at its root, and to start one when the user asks to prototype, sketch, or try out a mechanic, or to find the fun. Gets a playable toy in front of the human fast: keeps Ritmo's shape, checks only that the build compiles and loads, and leaves whether it is fun to the human, who plays every round."
---

# Ritmo prototypes

A prototype answers one question about a game by putting something playable in front of the human fast. The human is the playtester: they find the fun, and most bugs, by playing. Your job is a build worth playing every round, quickly. Everything a finished game needs waits until the prototype graduates.

## The mode

- A `PROTOTYPE.md` at the game root puts the game in prototype mode. The `ritmo` skill's principles still hold; its playbooks' checks are replaced by the one below. Deleting the file is graduation ([`playbooks/graduate.md`](playbooks/graduate.md)).
- Start a prototype only when the user asks for one. Never put a game in prototype mode to skip its checks.
- `PROTOTYPE.md` holds the card (the question, the fantasy, the loop) and one line per round: [`references/card.md`](references/card.md). Read it before every change.

| Change | Playbook |
|---|---|
| Starting a prototype | [`playbooks/start.md`](playbooks/start.md) |
| Any change once the toy is playable | [`playbooks/iterate.md`](playbooks/iterate.md) |
| The human keeps it: it becomes the game | [`playbooks/graduate.md`](playbooks/graduate.md) |

## What stays

- **The simulation is the game; intents in, plain data out** (the `ritmo` skill). Rules are systems that read player intents, drawing reads plain data, and the simulation imports no page code. This is what keeps graduation a refactor, not a rewrite.
- **Every tuned number in one `tuning.ts`, as named variants** (`satisfies Record<string, Tuning>`), given to the simulation as a service, with a key in the page that switches variant and restarts. The human compares two feels in one round, without waiting for you.

## What waits for graduation

Tests, play scripts, invariants and fuzzing every round, schemas for saved state (plain `Descriptor.Component<T>()` is fine), `oxlint` and `ritmo-devtools lint` as gates, migrations, determinism and cross-engine checks, and a file per system. Do not add any of these on the way.

## The check

- The type check passes, and the page loads with no errors in the console.
- Nothing else. Do not drive the page, take screenshots, or script runs to see whether it plays: the human is about to play it.
- When the human reports something broken that reading the code does not explain, reproduce it headless: one invariant for that bug and a `Fuzz.run` (the `@typeonce/ritmo-devtools` README, "Fuzzing") shrink it to the input that causes it. Keep the replay for graduation.

## Where to read

- The `@typeonce/ritmo-browser` README: input devices, `Controls`, and `InputCapture`.
- In `node_modules/@typeonce/ritmo/src`, the module headers of `Schema`, `System`, and `Schedule` (declaring data, writing and ordering systems), `FixedLoop` (the frame loop, started with `BrowserTickSource`), and `Inspector` (reading what to draw).
- Nothing else unless a compiler error points there.

## The reply

After each playable build, the reply gives:

- the link to play, the keys, and the variant switch;
- what changed this round, in what the human will see;
- one question, built as [`references/card.md`](references/card.md) says: one moment of play, the variants it compares, and answers that each name the next change.

Never say it is fun or feels good: you have not played it. Add the round's line to `PROTOTYPE.md`, and record the verdict in the human's words once they give it. A round the human did not play gets `not played`, never a verdict you infer; the last verdict still decides the next round.

## Self-check

- Did I add something from the "waits for graduation" list?
- Can the human answer my question with one word after one play?
