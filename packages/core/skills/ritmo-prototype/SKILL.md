---
name: ritmo-prototype
description: "Apply in place of the ritmo skill's checks while a game built on @typeonce/ritmo has a PROTOTYPE.md at its root, and to start one when the user asks to prototype, sketch, or try out a mechanic, or to find the fun. Gets a playable toy in front of the human fast: keeps Ritmo's shape and a check of seconds that proves the mechanic works, and leaves whether it is fun to the human."
---

# Ritmo prototypes

A prototype answers one question about a game by putting something playable in front of the human fast. You prove the mechanic **works**: it runs, holds its invariants, and does what the play script shows. The human decides whether it is **fun**. Everything else waits until the prototype graduates.

## The mode

- A `PROTOTYPE.md` at the game root puts the game in prototype mode. The `ritmo` skill's principles still hold; its playbooks' checks are replaced by the two tiers below. Deleting the file is graduation ([`playbooks/graduate.md`](playbooks/graduate.md)).
- Start a prototype only when the user asks for one. Never put a game in prototype mode to skip its checks.
- `PROTOTYPE.md` holds the card (the question, the fantasy, the loop) and the log of every round with the human's verdict: [`references/card.md`](references/card.md). Read it before every change.

| Change | Playbook |
|---|---|
| Starting a prototype | [`playbooks/start.md`](playbooks/start.md) |
| Any change once the toy is playable | [`playbooks/iterate.md`](playbooks/iterate.md) |
| The human keeps it: it becomes the game | [`playbooks/graduate.md`](playbooks/graduate.md) |

## What stays

- **The simulation is the game; intents in, plain data out** (the `ritmo` skill). The play script, the fuzzer, and graduation all run the simulation headless.
- **Time from `Clock`, randomness from `Random`, transcendental math from `Ops`.** The fuzzer replays every input it tries; a run that does not replay comes back `Flaky` instead of a bug.
- **What setup spawns is constructed from the game's one schema library.** The fuzzer starts every run from the world saved after setup; a world that cannot be saved is `Unreplayable`.
- **Every tuned number in one `tuning.ts`, as named variants** (`satisfies Record<string, Tuning>`), given to the simulation as a service. Most rounds change a number, not code.
- **The type check.** It costs nothing and catches what the play script would not.

## What waits for graduation

Test files, `oxlint` and `ritmo-devtools lint` as gates, `Snapshot.migrations`, `Determinism.check`, cross-engine verify, import-direction rules, `meta` ranges, a file per system, and code a second reader would need. Do not add any of these on the way: each costs a round the human waits for.

## The check

- **Tier 0, every change:** the type check, then `node --import tsx play.ts`. The play script runs scripted input through a devtools `Session` with the invariants and prints a readout of what a player would see. The readout is the evidence; it asserts nothing. Start from [`references/play.ts`](references/play.ts).
- **Tier 1, before the human plays a build:** `node --import tsx play.ts fuzz`. `Fuzz.run` drives the game with seeded random input against the invariants and shrinks a failure to the few frames that cause it, saved as a replay (the `@typeonce/ritmo-devtools` README, "Fuzzing").
- **Invariants say the mechanic is not broken,** two to four of them: inside the world, speeds finite and bounded, counts that cannot go negative, a state the player can always leave. Never tuning ("a dash travels 120 units"): that is for the human to judge.
- **A tier 1 failure is fixed before the human plays.** Fix the system that wrote the value, or the invariant when it was wrong (floating-point rounding, a state it forgot), and say which.

## The reply

After each playable build, the reply gives:

- what changed this round;
- the evidence: the readout lines that show it, and the fuzz line;
- how to play: the command, the keys, and the variant switch;
- one question only playing can answer ("does `short-dash` let you chain past three enemies?").

Never say it is fun or feels good: you have not played it. Append the round to the log in `PROTOTYPE.md`, and record the verdict in the human's words once they give it.

## Self-check

- Does the readout show what this round changed?
- Did I add something from the "waits for graduation" list?
- Is the question to the human one that only playing can answer?
