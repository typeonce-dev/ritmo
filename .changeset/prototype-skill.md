---
"@typeonce/ritmo": minor
"@typeonce/ritmo-devtools": minor
"@typeonce/ritmo-browser": patch
---

**A second skill for prototypes: `skills/ritmo-prototype`.** Ask the game's agent to prototype a mechanic, and it puts a playable toy in front of you every round instead of building the full verification for a game that may not survive the first playtest. You are the playtester: the agent checks only that the build compiles and the page loads, and ends each round with what changed and what to look for; you give the verdict in your own words. The game keeps Ritmo's shape (systems that read intents, a simulation separate from drawing) and every tuned number as named variants you switch with a key, so two feels compare in one play and the prototype can graduate without a rewrite. A bug you report that the code does not explain is shrunk with `Fuzz.run`.

A `PROTOTYPE.md` at the game root turns the mode on. It holds the question the prototype answers and one line per round with your verdict. The skill gives principles for finding the fun rather than a script, so each prototype takes the shape its game needs. The `ritmo` skill routes to the prototype skill while that file exists, and `playbooks/graduate.md` turns the prototype into the game: schemas for saved state, tests, invariants and fuzzing, the setup's checks, and then the file is deleted.

Existing projects link the new skill next to the `ritmo` one, as `SETUP.md` step 2 now shows:

```sh
ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-prototype .agents/skills/ritmo-prototype
```

`ritmo-devtools lint` notes each shipped skill the project does not link, so a project set up before this release sees `note  skill-not-linked  ritmo-prototype` until it adds the link. The note names its skill (`note  skill-not-linked  ritmo`), and never changes the exit code.

`SETUP.md` step 1 installs only `@typeonce/ritmo` and `@typeonce/ritmo-devtools`; step 3 installs `@typeonce/oxlint-plugin-ritmo` and `oxlint` with the lint setup, so a prototype installs the lint when it graduates. Nothing changes for a project that already has them. The `@typeonce/ritmo-devtools` README now says which optional peer each feature needs: none for `Session`, `Fuzz`, `Replay` and `ritmo-devtools lint`.

The `BrowserTickSource` module header now shows the smallest whole game in one file (controls, a component, a system, schedules, an `Inspector`, `Runtime.make`, and the `FixedLoop` page), compiled with the other examples. The prototype skill starts from it instead of a list of modules to read.
