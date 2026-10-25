---
"@typeonce/ritmo": minor
"@typeonce/ritmo-devtools": minor
---

**A second skill for prototypes: `skills/ritmo-prototype`.** Ask the game's agent to prototype a mechanic, and it gets a playable toy in front of you fast instead of building the full verification for a game that may not survive the first playtest. The game keeps Ritmo's shape (systems, intents, a headless simulation, `Clock` and `Random`, constructed state) so the prototype can graduate without a rewrite. The checks shrink to two tiers that take seconds: a play script that runs scripted input through a devtools `Session` with the game's invariants and prints what a player would see (`references/play.ts`), then `Fuzz.run` over the same invariants before you play a build. The agent proves the mechanic works and asks you one question about the feel; it never decides that something is fun.

A `PROTOTYPE.md` at the game root turns the mode on. It holds the card (the question, the fantasy, the 30-second loop, what fun looks like) and a log of each round with your verdict. The `ritmo` skill routes to the prototype skill while that file exists, and `playbooks/graduate.md` turns the prototype into the game: readouts become tests, the setup's checks come on, and the file is deleted.

Existing projects link the new skill next to the `ritmo` one, as `SETUP.md` step 2 now shows:

```sh
ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-prototype .agents/skills/ritmo-prototype
```

`ritmo-devtools lint` notes each shipped skill the project does not link, so a project set up before this release sees `note  skill-not-linked  ritmo-prototype` until it adds the link. The note names its skill (`note  skill-not-linked  ritmo`), and never changes the exit code.
