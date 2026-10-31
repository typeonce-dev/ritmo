# Set up Ritmo in a project

Follow these steps once in a new project, and for any step an existing project is missing. Use the project's package manager.

1. Install the runtime and the debug sessions:
   ```sh
   pnpm add @typeonce/ritmo
   pnpm add -D @typeonce/ritmo-devtools
   ```
2. Link the Ritmo skills from the installed package into the folder your agent reads skills from (`.agents/skills`, `.claude/skills`, ...), so they update with every Ritmo upgrade:
   ```sh
   mkdir -p .agents/skills
   ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo .agents/skills/ritmo
   ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-prototype .agents/skills/ritmo-prototype
   ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-onboarding .agents/skills/ritmo-onboarding
   ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-polish .agents/skills/ritmo-polish
   ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-pixel-art .agents/skills/ritmo-pixel-art
   ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-sounds .agents/skills/ritmo-sounds
   ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-music .agents/skills/ritmo-music
   ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-fx .agents/skills/ritmo-fx
   ```
3. Install the lint, `pnpm add -D @typeonce/oxlint-plugin-ritmo oxlint`, then set up `.oxlintrc.json` from the `@typeonce/oxlint-plugin-ritmo` README and a `ritmo-devtools lint` entry from the `@typeonce/ritmo-devtools` README. One check script runs the type check, `oxlint`, `ritmo-devtools lint`, and the tests.
   After every Ritmo upgrade, compare `.oxlintrc.json` with that README's config: a new rule is not on until the config lists it, so an existing project does not get it by upgrading.

Add-ons, installed only when the game needs them:
- `@typeonce/ritmo-math`: 2D helpers on plain data (vectors, angles, swept circle collision, a flow field).
- `@typeonce/ritmo-browser`: a browser host (animation-frame loop; keyboard, gamepad, pointer, and touch input, local multiplayer).
- `@typeonce/ritmo-render`: mirrors entities into any renderer's nodes.
- `@typeonce/ritmo-pixi`: the Pixi adapter for `@typeonce/ritmo-render`.
- `@typeonce/ritmo-netcode`: online multiplayer (rollback or lockstep sessions over WebSocket, WebRTC, or any transport).
- `@typeonce/ritmo-tools` (dev): the `ritmo-tools` command for assets, `pixel` for pixel art and animations, `sound` for sound effects, `music` for game music, `fx` for pixel art effects. Its skills are linked above and load only when the game's assets are worked on.

Then use the `ritmo` skill for every change: it says where the docs are and how to structure the game. To try a mechanic before building the game around it, ask for a prototype: the `ritmo-prototype` skill iterates fast with a lighter check until the prototype graduates. Before anyone else plays the game (a playtest, a jam), the `ritmo-onboarding` skill says how the first minute teaches the rule and how to prove it headless. When the game is done and should feel finished, the `ritmo-polish` skill audits its feedback, motion, sound, and UI, and keeps every effect out of the simulation.
